import "server-only";
import { buildItemRows, onlyNewItems } from "../items";
import { llmCostUsd, pickModel, shouldEscalate, sttCostUsd, BEST_MODEL, type ModelId, type ModelMode } from "../models";
import { onStepFailure, onStepSuccess, type WorkStep } from "../pipeline/steps";
import { adminDb, AUDIO_BUCKET } from "./db";
import { runExtraction, type ExtractOutput } from "./extract";
import { sendPush } from "./push";
import { deleteTranscript, getTranscript, submitTranscript } from "./stt";
import { hasTrash } from "./trash";

type Rec = {
  id: string; user_id: string; status: string; attempts: number; started_at: string; time_zone: string;
  duration_ms: number | null; storage_path: string | null; aai_transcript_id: string | null;
  speakers: number | null; model_override: string | null; is_test: boolean; title: string | null;
  deleted_at?: string | null;
};

export type TickReport = {
  reminders_sent: { id: string; push: string }[];
  swept: number;
  polled: { id: string; result: string }[];
  steps: { id: string; step: string; result: string }[];
  audio_deleted: number;
  trash_emptied: number;
  /** Transcripts deleted at the speech service once their text was saved here. */
  transcripts_deleted: number;
  /** True when a step failed in this pass; the retry belongs to the scheduler, a minute later. */
  step_failed: boolean;
  errors: string[];
};

const SIGNED_URL_SECONDS = 3 * 3600;
const POLL_ERROR_LIMIT = 8;
/** The speech service deletes transcripts after 30 days by default; past this, a failing delete stops being retried. */
const SERVICE_KEEPS_MS = 31 * 24 * 3600 * 1000;
/** Statuses whose transcript is saved in this database, so the speech service's copy is no longer needed. */
const TRANSCRIPT_SAVED = ["transcribed", "extracting", "ready"];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** True when a recording's audio path is inside its owner's own folder of the bucket. */
export const inOwnFolder = (r: { user_id: string; storage_path: string | null }) =>
  Boolean(r.storage_path && r.user_id && r.storage_path.startsWith(`${r.user_id}/`) && !r.storage_path.includes(".."));

async function fail(rec: Rec, step: WorkStep, error: string) {
  const patch = onStepFailure(step, rec.attempts, error);
  await adminDb().from("recordings").update(patch).eq("id", rec.id).eq("status", step);
  return patch.status;
}

/** uploaded > transcribing: hand the speech service a short-lived link. Safe to repeat. */
async function startTranscription(rec: Rec): Promise<string> {
  const db = adminDb();
  if (rec.aai_transcript_id) return "already submitted";
  if (!rec.storage_path) throw new Error("The recording has no audio file.");
  // The service role can sign any path, so only ever sign a file inside this recording's own folder.
  if (!inOwnFolder(rec)) throw new Error("The audio file does not belong to this recording.");
  const signed = await db.storage.from(AUDIO_BUCKET).createSignedUrl(rec.storage_path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data) throw new Error(`Could not sign the audio link: ${signed.error?.message}`);
  const id = await submitTranscript(signed.data.signedUrl);
  const { error } = await db.from("recordings").update({ aai_transcript_id: id, locked_until: null }).eq("id", rec.id).eq("status", "transcribing");
  if (error) throw new Error(error.message);
  return "submitted";
}

/** transcribing > transcribed: poll the job; when done, save the transcript. Safe to repeat. */
async function pollTranscription(rec: Rec): Promise<string> {
  const db = adminDb();
  const state = await getTranscript(rec.aai_transcript_id!);
  if (state.status === "waiting") {
    await db.from("recordings").update({ locked_until: null }).eq("id", rec.id).eq("status", "transcribing");
    return "waiting";
  }
  if (state.status === "error") {
    // A new job is needed, so forget the old id and let the retry count decide.
    await db.from("recordings").update({ aai_transcript_id: null }).eq("id", rec.id);
    return `error > ${await fail(rec, "transcribing", state.error)}`;
  }
  await db.from("utterances").delete().eq("recording_id", rec.id);
  if (state.utterances.length) {
    const rows = state.utterances.map((u, idx) => ({
      recording_id: rec.id, user_id: rec.user_id, idx, speaker: u.speaker, start_ms: u.start, end_ms: u.end, text: u.text,
    }));
    const { error } = await db.from("utterances").insert(rows);
    if (error) throw new Error(error.message);
  }
  const durationMs = state.durationMs ?? rec.duration_ms ?? 0;
  const { error } = await db.from("recordings").update({
    ...onStepSuccess("transcribing"),
    duration_ms: durationMs,
    speakers: state.speakers,
    stt_cost_usd: sttCostUsd(durationMs),
  }).eq("id", rec.id).eq("status", "transcribing");
  if (error) throw new Error(error.message);
  // The transcript is saved here now, so the speech service's copy is deleted. If that fails, the id is
  // kept and a later pass (step 7) tries again.
  const jobId = rec.aai_transcript_id!;
  try {
    await deleteTranscript(jobId);
  } catch (e) {
    return `transcribed (the speech service's copy is deleted later: ${msg(e).slice(0, 120)})`;
  }
  await db.from("recordings").update({ aai_transcript_id: null }).eq("id", rec.id).eq("aai_transcript_id", jobId);
  return "transcribed";
}

/** transcribed > extracting > ready: ask Claude, save items, log cost. Safe to repeat. */
async function extract(rec: Rec): Promise<string> {
  const db = adminDb();
  const [{ data: lines, error: e1 }, { data: settings }] = await Promise.all([
    db.from("utterances").select("speaker, start_ms, text").eq("recording_id", rec.id).order("idx"),
    db.from("settings").select("model_mode").eq("user_id", rec.user_id).maybeSingle(),
  ]);
  if (e1) throw new Error(e1.message);
  const mode: ModelMode = rec.model_override === "best" ? "best" : ((settings?.model_mode as ModelMode) ?? "auto");
  const minutes = (rec.duration_ms ?? 0) / 60000;
  const speakers = rec.speakers ?? new Set((lines ?? []).map((l) => l.speaker)).size;
  let model: ModelId = pickModel({ minutes, speakers }, mode);

  const runs: { out: ExtractOutput; model: ModelId; reason: string }[] = [];
  let out: ExtractOutput;
  if (!lines?.length) {
    out = {
      result: { title: "Empty recording", summary: "No speech was found in this recording.", confidence: "high", items: [] },
      modelUsed: "none", inputTokens: 0, outputTokens: 0,
    };
  } else {
    const input = { lines, startedAt: rec.started_at, timeZone: rec.time_zone };
    out = await runExtraction({ ...input, model });
    runs.push({ out, model, reason: rec.model_override === "best" ? "redo with best model" : `mode ${mode}` });
    if (shouldEscalate(model, mode, out.result)) {
      model = BEST_MODEL;
      out = await runExtraction({ ...input, model });
      runs.push({ out, model, reason: "cheap pass reported low confidence" });
    }
  }

  const cost = runs.reduce((n, r) => n + llmCostUsd(r.model, r.out.inputTokens, r.out.outputTokens), 0);
  if (runs.length) {
    await db.from("llm_runs").insert(runs.map((r) => ({
      recording_id: rec.id, user_id: rec.user_id, model: r.out.modelUsed, reason: r.reason,
      input_tokens: r.out.inputTokens, output_tokens: r.out.outputTokens,
      cost_usd: llmCostUsd(r.model, r.out.inputTokens, r.out.outputTokens), confidence: r.out.result.confidence,
    })));
  }

  // Items already on the recording are kept as they are: the owner may have edited, dated, completed or
  // dismissed them, here or through Zeus. Only suggestions nobody has acted on are replaced, and only
  // genuinely new tasks are added, so a repeat or a redo never loses work and never doubles an item.
  await db.from("items").delete().eq("recording_id", rec.id).eq("state", "suggested").is("notified_at", null).is("apple_sent_at", null);
  const { data: kept } = await db.from("items").select("text").eq("recording_id", rec.id);
  const rows = onlyNewItems(buildItemRows(out.result, rec), (kept ?? []).map((k) => k.text));
  if (rows.length) {
    const { error } = await db.from("items").insert(rows);
    if (error) throw new Error(error.message);
  }

  const firstReady = !rec.title;
  const { data: prev } = await db.from("recordings").select("llm_cost_usd, input_tokens, output_tokens, ready_at").eq("id", rec.id).single();
  const { error } = await db.from("recordings").update({
    ...onStepSuccess("extracting"),
    title: out.result.title, summary: out.result.summary, confidence: out.result.confidence,
    model_used: out.modelUsed, model_override: null,
    input_tokens: (prev?.input_tokens ?? 0) + runs.reduce((n, r) => n + r.out.inputTokens, 0),
    output_tokens: (prev?.output_tokens ?? 0) + runs.reduce((n, r) => n + r.out.outputTokens, 0),
    llm_cost_usd: Number(prev?.llm_cost_usd ?? 0) + cost,
    ready_at: prev?.ready_at ?? new Date().toISOString(),
  }).eq("id", rec.id).eq("status", "extracting");
  if (error) throw new Error(error.message);

  // No announcement for a recording that was moved to Trash while it was being processed.
  if (firstReady && !rec.is_test && !rec.deleted_at) {
    const n = rows.length;
    await sendPush(rec.user_id, {
      title: "Your recording is ready",
      body: `${out.result.title}${n ? ` · ${n} item${n === 1 ? "" : "s"}` : ""}`,
      url: `/notes/${rec.id}`, tag: `rec-${rec.id}`,
    }).catch(() => {});
  }
  return `ready (${out.modelUsed}${runs.length > 1 ? ", escalated" : ""})`;
}

/**
 * One pass of the worker. Called by the database scheduler each minute while work is waiting.
 * Every part is claimed atomically in the database, so overlapping ticks never do a step twice.
 */
export async function runTick(budgetMs = 240_000): Promise<TickReport> {
  const db = adminDb();
  const started = Date.now();
  const owner = process.env.OWNER_USER_ID?.trim() || null;
  const report: TickReport = { reminders_sent: [], swept: 0, polled: [], steps: [], audio_deleted: 0, trash_emptied: 0, transcripts_deleted: 0, step_failed: false, errors: [] };

  // 1. Due reminders first: they are time-sensitive and quick.
  try {
    const { data: due, error } = await db.rpc("claim_due_reminders");
    if (error) throw new Error(error.message);
    for (const item of due ?? []) {
      if (owner && item.user_id !== owner) continue;
      let via = "in-app only";
      try {
        // A reminder taken from a recording says so, so one planted by someone else's words is easy to spot.
        const title = item.recording_id ? "Reminder from a recording" : "Reminder";
        const r = await sendPush(item.user_id, { title, body: item.text, url: "/todos", tag: `item-${item.id}` });
        via = r.subscriptions === 0 ? "in-app only (no phone subscribed)" : `push sent to ${r.sent} of ${r.subscriptions}`;
        if (r.errors.length) via += `; ${r.errors[0]}`;
      } catch (e) {
        via = `in-app only (push failed: ${msg(e).slice(0, 120)})`;
      }
      await db.from("items").update({ notified_via: via }).eq("id", item.id);
      report.reminders_sent.push({ id: item.id, push: via });
    }
  } catch (e) { report.errors.push(`reminders: ${msg(e)}`); }

  // 2. Steps that crashed three times stop as failed.
  try {
    const { data, error } = await db.rpc("sweep_stuck");
    if (error) throw new Error(error.message);
    report.swept = data ?? 0;
  } catch (e) { report.errors.push(`sweep: ${msg(e)}`); }

  // 3. Poll transcriptions that are with the speech service.
  try {
    const { data: polling, error } = await db.rpc("claim_poll");
    if (error) throw new Error(error.message);
    for (const rec of (polling ?? []) as Rec[]) {
      // As in step 4: a transcript is saved only for the owner's recordings, whatever is in the table.
      if (owner && rec.user_id !== owner) {
        if (rec.aai_transcript_id) await deleteTranscript(rec.aai_transcript_id).catch(() => {});
        await db.from("recordings").update({ status: "failed", failed_step: "transcribing", aai_transcript_id: null, locked_until: null, last_error: "Not the owner's recording." }).eq("id", rec.id);
        report.polled.push({ id: rec.id, result: "skipped: not the owner's" });
        continue;
      }
      try { report.polled.push({ id: rec.id, result: await pollTranscription(rec) }); }
      catch (e) {
        // A poll that keeps failing must not leave the recording "Transcribing" for ever: count it, and
        // after several, stop as failed so the note shows Retry. Retry submits a fresh job.
        const tries = rec.attempts + 1;
        if (tries >= POLL_ERROR_LIMIT) {
          // The id is about to be forgotten, so try once to delete the job at the speech service.
          if (rec.aai_transcript_id) await deleteTranscript(rec.aai_transcript_id).catch(() => {});
          await db.from("recordings").update({ status: "failed", failed_step: "transcribing", aai_transcript_id: null, locked_until: null, last_error: `Could not read the transcript: ${msg(e)}`.slice(0, 500) }).eq("id", rec.id).eq("status", "transcribing");
        } else {
          await db.from("recordings").update({ attempts: tries, locked_until: null, last_error: msg(e).slice(0, 500) }).eq("id", rec.id).eq("status", "transcribing");
        }
        report.polled.push({ id: rec.id, result: `error ${tries} of ${POLL_ERROR_LIMIT}: ${msg(e)}` });
      }
    }
  } catch (e) { report.errors.push(`poll: ${msg(e)}`); }

  // 4. Claim and run steps, one recording at a time, until none are left or time is short.
  while (Date.now() - started < budgetMs && report.steps.length < 10) {
    const { data, error } = await db.rpc("claim_recording");
    if (error) { report.errors.push(`claim: ${error.message}`); break; }
    const rec = (data as Rec[] | null)?.[0];
    if (!rec) break;
    const step = rec.status as WorkStep;
    // Only the owner's recordings are ever sent to the paid services, whatever is in the table.
    if (owner && rec.user_id !== owner) {
      await db.from("recordings").update({ status: "failed", failed_step: step, locked_until: null, last_error: "Not the owner's recording." }).eq("id", rec.id);
      report.steps.push({ id: rec.id, step, result: "skipped: not the owner's" });
      continue;
    }
    try {
      const result = step === "transcribing" ? await startTranscription(rec) : await extract(rec);
      report.steps.push({ id: rec.id, step, result });
    } catch (e) {
      const next = await fail(rec, step, msg(e));
      report.steps.push({ id: rec.id, step, result: `attempt ${rec.attempts} failed > ${next}: ${msg(e).slice(0, 200)}` });
      // Leave the retry to the next tick, a minute away, rather than burning all three attempts at once.
      report.step_failed = true;
      break;
    }
  }

  // 5. Audio deletes itself 30 days after the transcript is ready. The transcript and items stay.
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    let q = db.from("recordings").select("id, user_id, storage_path").eq("status", "ready")
      .not("storage_path", "is", null).is("audio_deleted_at", null).lt("ready_at", cutoff);
    if (owner) q = q.eq("user_id", owner);
    const { data: old } = await q.limit(20);
    for (const r of old ?? []) {
      // The service role can delete any file, so only ever delete one inside the recording's own folder.
      // A link to a file elsewhere is dropped and the file is left alone.
      if (!inOwnFolder(r)) {
        await db.from("recordings").update({ storage_path: null }).eq("id", r.id);
        report.errors.push(`audio delete: recording ${r.id} pointed outside its own folder; the link was dropped and no file was deleted`);
        continue;
      }
      const { error } = await db.storage.from(AUDIO_BUCKET).remove([r.storage_path]);
      if (error) { report.errors.push(`audio delete: ${error.message}`); continue; }
      await db.from("recordings").update({ audio_deleted_at: new Date().toISOString(), storage_path: null }).eq("id", r.id);
      report.audio_deleted++;
    }
  } catch (e) { report.errors.push(`audio cleanup: ${msg(e)}`); }

  // 6. Recordings in Trash for more than 30 days are erased for good: audio, transcript and items.
  try {
    if (await hasTrash()) {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      let q = db.from("recordings").select("id, user_id, storage_path, aai_transcript_id").lt("deleted_at", cutoff);
      if (owner) q = q.eq("user_id", owner);
      const { data: gone } = await q.limit(20);
      for (const r of gone ?? []) {
        if (r.storage_path && !inOwnFolder(r)) {
          report.errors.push(`trash audio: recording ${r.id} pointed outside its own folder; no file was deleted`);
        } else if (r.storage_path) {
          // If the audio cannot be removed, keep the row so the next tick tries again instead of orphaning the file.
          const gone = await db.storage.from(AUDIO_BUCKET).remove([r.storage_path]);
          if (gone.error) { report.errors.push(`trash audio: ${gone.error.message}`); continue; }
        }
        // Usually gone already (deleted when the transcript was saved); this catches any copy left behind.
        if (r.aai_transcript_id) await deleteTranscript(r.aai_transcript_id).catch(() => {});
        const { error } = await db.from("recordings").delete().eq("id", r.id);
        if (error) report.errors.push(`trash: ${error.message}`); else report.trash_emptied++;
      }
    }
  } catch (e) { report.errors.push(`trash: ${msg(e)}`); }

  // 7. Transcripts the speech service still holds although their text is saved here: recordings made before
  //    deletion on save existed, and any delete that failed. A recording that failed while transcribing keeps
  //    its job, because Retry reuses it and it may be the only copy.
  try {
    let q = db.from("recordings").select("id, aai_transcript_id, created_at").not("aai_transcript_id", "is", null).in("status", TRANSCRIPT_SAVED);
    if (owner) q = q.eq("user_id", owner);
    const { data: held } = await q.limit(20);
    for (const r of held ?? []) {
      try {
        await deleteTranscript(r.aai_transcript_id);
        report.transcripts_deleted++;
      } catch (e) {
        // Past the service's own retention the copy is gone anyway, so stop retrying; otherwise try next pass.
        if (!(Date.now() - Date.parse(r.created_at) >= SERVICE_KEEPS_MS)) { report.errors.push(`transcript delete: ${msg(e).slice(0, 200)}`); continue; }
      }
      await db.from("recordings").update({ aai_transcript_id: null }).eq("id", r.id).eq("aai_transcript_id", r.aai_transcript_id);
    }
  } catch (e) { report.errors.push(`transcript cleanup: ${msg(e)}`); }

  return report;
}

/**
 * The fast path: runs worker passes a few seconds apart until nothing of this owner's is in flight.
 * Used right after an upload so a short memo does not wait for the scheduler's next minute.
 */
export async function runUntilIdle(userId: string, limitMs = 90_000, passMs = 3000): Promise<number> {
  const started = Date.now();
  let passes = 0;
  while (Date.now() - started < limitMs) {
    const report = await runTick(60_000);
    passes++;
    if (report.errors.length) console.warn("fast path", JSON.stringify(report.errors));
    // A failed step is retried by the scheduler a minute later. Retrying here every few seconds would
    // use up all three attempts during a brief outage and leave the recording failed.
    if (report.step_failed) break;
    const { count } = await adminDb().from("recordings").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("status", ["uploaded", "transcribing", "transcribed", "extracting"]);
    if (!count) break;
    await new Promise((r) => setTimeout(r, passMs));
  }
  return passes;
}
