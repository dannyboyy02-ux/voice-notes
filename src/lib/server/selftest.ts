import "server-only";
import { adminDb, AUDIO_BUCKET } from "./db";
import { appUrl, missingEnv, need } from "./env";
import { after } from "next/server";
import { CHAT_MODEL } from "../models";
import { deleteTranscript } from "./stt";
import { runUntilIdle } from "./tick";
import { buildContext, streamAnswer } from "./zeus";

type Report = Record<string, unknown> & { timeline: { at: string; saw: string }[] };
const now = () => new Date().toISOString();
const SAMPLE_WORDS =
  "Note to self. I need to email Sam the property survey. Also, remind me tomorrow at nine in the morning to call the county about the permit.";

async function removeTestData(owner: string) {
  const db = adminDb();
  const { data: recs } = await db.from("recordings").select("id, storage_path, aai_transcript_id").eq("is_test", true);
  const paths = (recs ?? []).map((r) => r.storage_path).filter(Boolean) as string[];
  if (paths.length) await db.storage.from(AUDIO_BUCKET).remove(paths);
  for (const r of recs ?? []) if (r.aai_transcript_id) await deleteTranscript(r.aai_transcript_id).catch(() => {});
  await db.from("items").delete().eq("is_test", true);
  await db.from("recordings").delete().eq("is_test", true);
  const [{ count: recordingsLeft }, { count: itemsLeft }, files] = await Promise.all([
    db.from("recordings").select("id", { count: "exact", head: true }).eq("is_test", true),
    db.from("items").select("id", { count: "exact", head: true }).eq("is_test", true),
    db.storage.from(AUDIO_BUCKET).list(owner, { search: "selftest-" }),
  ]);
  return { test_recordings_left: recordingsLeft ?? 0, test_items_left: itemsLeft ?? 0, test_audio_files_left: files.data?.length ?? 0 };
}

/**
 * A real end-to-end check against the live services. Nothing here is simulated:
 * a spoken sample is uploaded, the database scheduler drives it through the pipeline,
 * and a due reminder is left for the scheduler's tick to send. Call again to see progress.
 */
export async function selftest(req: Request, action: string | null): Promise<Record<string, unknown>> {
  const missing = missingEnv();
  if (missing.length) {
    return { ok: false, done: false, blocked: "environment variables are missing in Vercel", missing };
  }
  const db = adminDb();
  const owner = need("OWNER_USER_ID");

  const probe = await db.rpc("scheduler_state");
  if (probe.error) {
    // Say which project the app is talking to and which pieces it can see, so a wrong project or a half-run script is obvious.
    const tables: Record<string, string> = {};
    for (const t of ["recordings", "utterances", "items", "push_subscriptions", "settings", "llm_runs", "selftest_runs"]) {
      const r = await db.from(t).select("*", { count: "exact", head: true });
      tables[t] = r.error ? `missing or unreadable: ${r.error.message || r.error.code || r.status}` : "present";
    }
    const bucket = await db.storage.getBucket(AUDIO_BUCKET);
    const users = await db.auth.admin.getUserById(owner);
    let host = "unreadable";
    try { host = new URL(need("SUPABASE_URL")).host; } catch { host = "SUPABASE_URL is not a valid URL"; }
    return {
      ok: false, done: false,
      blocked: "the database is not set up: run supabase/setup.sql in the Supabase SQL editor",
      database_error: probe.error.message,
      connected_to: host,
      tables,
      audio_bucket: bucket.error ? `missing: ${bucket.error.message}` : "present",
      owner_user_found: users.error ? `no: ${users.error.message}` : Boolean(users.data.user),
    };
  }
  const user = await db.auth.admin.getUserById(owner);
  if (user.error || !user.data.user) {
    return { ok: false, done: false, blocked: "OWNER_USER_ID does not match a user in Supabase Authentication", detail: user.error?.message };
  }
  await db.rpc("set_app_url", { p_url: appUrl(req) });

  const { data: last } = await db.from("selftest_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();

  if (action === "start" || !last) {
    if (last && !last.done && Date.now() - new Date(last.started_at).getTime() < 15 * 60_000 && action !== "restart") {
      return { ok: false, note: "a self-test is already running; call without action=start to follow it", run: last.id };
    }
    await removeTestData(owner);
    const sample = await fetch(`${new URL(req.url).origin}/selftest-sample.mp3`);
    if (!sample.ok) throw new Error(`Could not load the sample audio (${sample.status})`);
    const bytes = new Uint8Array(await sample.arrayBuffer());
    const { data: run, error: runErr } = await db.from("selftest_runs").insert({}).select("id").single();
    if (runErr) throw new Error(runErr.message);
    const path = `${owner}/selftest-${run.id}.mp3`;
    const up = await db.storage.from(AUDIO_BUCKET).upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
    if (up.error) throw new Error(`Sample upload failed: ${up.error.message}`);
    const startedAt = now();
    const { data: rec, error: recErr } = await db.from("recordings").insert({
      user_id: owner, started_at: startedAt, time_zone: "America/New_York", storage_path: path,
      mime_type: "audio/mpeg", bytes: bytes.length, status: "uploaded", is_test: true,
    }).select("id").single();
    if (recErr) throw new Error(recErr.message);
    const report: Report = {
      run: run.id, recording: rec.id, sample_words: SAMPLE_WORDS, sample_bytes: bytes.length,
      recording_started_at: startedAt, time_zone: "America/New_York",
      timeline: [{ at: startedAt, saw: "uploaded" }],
    };
    // fast=1 uses the same fast path the phone triggers after an upload; without it, only the scheduler drives the run.
    const fast = new URL(req.url).searchParams.get("fast") === "1";
    report.driven_by = fast ? "fast path (as after a phone upload), with the scheduler as backup" : "the database scheduler only";
    await db.from("selftest_runs").update({ report }).eq("id", run.id);
    if (fast) after(() => runUntilIdle(owner).then(() => undefined));
    return { ok: true, done: false, phase: "pipeline", next: fast ? "call /api/selftest again in about 20 seconds" : "call /api/selftest again in about a minute", ...report };
  }

  if (last.done) return last.report as Record<string, unknown>;

  const report = last.report as Report;
  const saw = (s: string) => {
    if (report.timeline[report.timeline.length - 1]?.saw !== s) report.timeline.push({ at: now(), saw: s });
  };
  const save = (done = false) => db.from("selftest_runs").update({ report, done }).eq("id", last.id);
  const scheduler = (await db.rpc("scheduler_state")).data;
  const { data: rec } = await db.from("recordings").select("*").eq("id", report.recording as string).maybeSingle();
  if (!rec) return { ok: false, done: false, blocked: "the test recording disappeared; call with action=restart", ...report };
  saw(rec.status);

  if (rec.status === "failed") {
    report.ok = false; report.failed_step = rec.failed_step; report.error = rec.last_error; report.scheduler = scheduler;
    report.cleanup = await removeTestData(owner);
    await save(true);
    return { done: true, ...report };
  }
  if (rec.status !== "ready") {
    await save();
    const stalled = !scheduler?.cron_job
      ? "the scheduler job is missing: run supabase/setup.sql"
      : !scheduler?.scheduler_last_run_at
        ? "the scheduler has not run yet; it runs once a minute"
        : undefined;
    return { ok: true, done: false, phase: "pipeline", status: rec.status, attempts: rec.attempts, last_error: rec.last_error, stalled, scheduler, ...report };
  }

  // Pipeline finished. Record what it produced.
  const [{ data: items }, { data: utterances }, { data: runs }] = await Promise.all([
    db.from("items").select("id, type, text, due_at, due_local, said, state, needs_review, notified_at, notified_via").eq("recording_id", rec.id),
    db.from("utterances").select("speaker, start_ms, text").eq("recording_id", rec.id).order("idx"),
    db.from("llm_runs").select("model, reason, input_tokens, output_tokens, cost_usd, confidence").eq("recording_id", rec.id),
  ]);
  const extracted = (items ?? []).filter((i) => i.said !== "selftest-due");
  const todo = extracted.find((i) => i.type === "todo");
  const dated = extracted.find((i) => i.type === "reminder" && i.due_at);
  report.result = {
    status: rec.status, title: rec.title, summary: rec.summary, speakers: rec.speakers, duration_ms: rec.duration_ms,
    transcript: utterances, model_used: rec.model_used, llm_runs: runs,
    llm_cost_usd: Number(rec.llm_cost_usd), stt_cost_usd_estimate: Number(rec.stt_cost_usd),
    todo: todo ?? null, dated_reminder: dated ?? null, all_items: extracted,
  };

  // Ask Zeus one question about the test recording, once, to prove the chat works against the live model.
  if (!report.zeus) {
    const question = "What do I need to do, and when?";
    try {
      const context = await buildContext(owner, rec.id, question);
      const answer = await new Response(streamAnswer(context, [{ role: "user", content: question }])).text();
      report.zeus = { model: CHAT_MODEL, question, answer: answer.trim() };
    } catch (e) {
      report.zeus = { model: CHAT_MODEL, question, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Second half: leave a reminder that is already due and wait for the scheduler's tick to send it.
  let due = (items ?? []).find((i) => i.said === "selftest-due");
  if (!due) {
    const { data: made, error } = await db.from("items").insert({
      recording_id: rec.id, user_id: owner, type: "reminder", text: "Voice Notes self-test reminder",
      due_at: new Date(Date.now() - 1000).toISOString(), said: "selftest-due", state: "active", is_test: true,
    }).select("id, type, text, due_at, said, state, needs_review, notified_at, notified_via").single();
    if (error) throw new Error(error.message);
    due = made as NonNullable<typeof due>;
    report.due_reminder_created_at = now();
    saw("due reminder created, waiting for the scheduler's tick");
  }
  if (!due.notified_at) {
    await save();
    return { ok: true, done: false, phase: "reminder", next: "call again in about a minute", scheduler, ...report };
  }

  saw("tick sent the due reminder");
  report.due_reminder = {
    id: due.id, due_at: due.due_at, notified_at: due.notified_at, delivery: due.notified_via,
    sent_by: "/api/tick, called by the database scheduler (the only caller that holds its secret)",
  };
  report.scheduler = scheduler;
  report.cleanup = await removeTestData(owner);
  const c = report.cleanup as { test_recordings_left: number; test_items_left: number; test_audio_files_left: number };
  report.checks = {
    went_uploaded_to_ready: rec.status === "ready",
    has_todo: Boolean(todo),
    has_dated_reminder: Boolean(dated),
    // Only /api/tick marks reminders as notified, and it accepts only the secret held by the database scheduler.
    tick_sent_due_reminder: Boolean(due.notified_at),
    test_rows_removed: c.test_recordings_left === 0 && c.test_items_left === 0 && c.test_audio_files_left === 0,
    zeus_answered: typeof (report.zeus as { answer?: string } | undefined)?.answer === "string"
      && !/could not answer|declined/.test((report.zeus as { answer: string }).answer)
      && (report.zeus as { answer: string }).answer.length > 20,
  };
  report.ok = Object.values(report.checks as Record<string, boolean>).every(Boolean);
  report.finished_at = now();
  await save(true);
  return { done: true, ...report };
}
