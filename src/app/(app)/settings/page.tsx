"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { APPLE_SHORTCUT_NAME } from "@/lib/apple";
import { enablePush } from "@/lib/client/push";
import { api } from "@/lib/client/supabase";
import { ago, duration } from "@/lib/format";
import type { ModelMode } from "@/lib/models";

type Status = { scheduler_last_run_at: string | null; last_tick_at: string | null; connected: boolean };
type Usage = { seconds: number; cost: number; count: number };
const MODES: { id: ModelMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "best", label: "Best" },
  { id: "cheapest", label: "Cheapest" },
];
const PUSH_LABEL = { on: "On", off: "Off", denied: "Blocked", unsupported: "Not supported here", "needs-install": "Needs Home Screen", "not-configured": "Not set up" };

export default function SettingsPage() {
  const { db, userId, push, setPush } = useApp();
  const [mode, setMode] = useState<ModelMode>("auto");
  const [apple, setApple] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const [s, st, u] = await Promise.all([
        db.from("settings").select("model_mode, apple_reminders").maybeSingle(),
        db.rpc("server_status"),
        db.from("recordings").select("duration_ms, llm_cost_usd, stt_cost_usd").eq("is_test", false).gte("started_at", monthStart.toISOString()),
      ]);
      if (!live) return;
      if (s.data) { setMode(s.data.model_mode); setApple(s.data.apple_reminders); }
      const state = (st.data as Status) ?? null;
      setStatus(state);
      setStale(!state?.scheduler_last_run_at || Date.now() - new Date(state.scheduler_last_run_at).getTime() > 5 * 60_000);
      const rows = u.data ?? [];
      setUsage({
        count: rows.length,
        seconds: rows.reduce((n, r) => n + (r.duration_ms ?? 0) / 1000, 0),
        cost: rows.reduce((n, r) => n + Number(r.llm_cost_usd ?? 0) + Number(r.stt_cost_usd ?? 0), 0),
      });
    })();
    return () => { live = false; };
  }, [db]);

  const save = async (patch: { model_mode?: ModelMode; apple_reminders?: boolean }) => {
    const next = { model_mode: patch.model_mode ?? mode, apple_reminders: patch.apple_reminders ?? apple };
    setMode(next.model_mode);
    setApple(next.apple_reminders);
    const { error } = await db.from("settings").upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() });
    if (error) setMessage(`Could not save: ${error.message}`);
  };
  const testPush = async () => {
    const res = await api<{ sent?: number; subscriptions?: number; errors?: string[]; error?: string }>("/api/push/test");
    setMessage(
      res.status !== 200 ? `Test failed: ${res.data.error ?? res.status}`
        : res.data.sent ? "Test notification sent. It should appear in a few seconds."
          : `Nothing was sent (${res.data.subscriptions} phone subscribed${res.data.errors?.length ? `; ${res.data.errors[0]}` : ""}).`,
    );
  };
  const heartbeat = status?.scheduler_last_run_at;

  return (
    <>
      <h1>Settings</h1>
      {message && <div className="banner">{message}</div>}

      <section className="card">
        <div className="spread">
          <span>AI model</span>
          <div className="seg" data-testid="model-mode">
            {MODES.map((m) => <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => save({ model_mode: m.id })}>{m.label}</button>)}
          </div>
        </div>
        <p className="small muted">
          Auto uses Claude Haiku 5.5 for one speaker and 10 minutes or less, Claude Opus 5.5 for anything else, and reruns on Opus when the cheap pass is unsure. Any recording also has a “Redo with best model” button.
        </p>
      </section>

      <section className="card">
        <div className="spread">
          <span>Notifications</span>
          <span className={`pill ${push === "on" ? "ok" : "warn"}`} data-testid="push-state">{PUSH_LABEL[push]}</span>
        </div>
        <div className="row">
          {push === "off" && <button className="btn small" onClick={async () => setPush(await enablePush())}>Turn on</button>}
          {push === "on" && <button className="btn small secondary" onClick={testPush}>Send a test</button>}
        </div>
      </section>

      <section className="card">
        <label className="spread">
          <span>Also send to Apple Reminders</span>
          <input type="checkbox" checked={apple} onChange={(e) => save({ apple_reminders: e.target.checked })} style={{ width: 24, height: 24 }} data-testid="apple-toggle" />
        </label>
        {apple && (
          <div className="small muted">
            <p>Adds a “Send to Apple Reminders” button on the To-dos tab. It needs one Shortcut, made once in the Shortcuts app:</p>
            <ol style={{ paddingLeft: "1.2em", margin: "6px 0" }}>
              <li>New shortcut, named exactly <b>{APPLE_SHORTCUT_NAME}</b>.</li>
              <li>Add “Get Dictionary from Input” and set its input to Shortcut Input.</li>
              <li>Add “Repeat with Each” over that result.</li>
              <li>Inside the repeat, add “Add New Reminder”. Set the title to Repeat Item’s <b>title</b>, notes to its <b>notes</b>, and the alert time to its <b>due</b>.</li>
            </ol>
            <p>Items you send are marked, with Undo. Sent items do not also alert in this app.</p>
          </div>
        )}
      </section>

      <section className="card">
        <div className="spread"><span>Delete audio after</span><span>30 days</span></div>
        <div className="spread">
          <span>Server last checked in</span>
          <span className={`pill ${stale ? "warn" : "ok"}`} data-testid="heartbeat">{ago(heartbeat)}</span>
        </div>
        {stale && <p className="small muted">The scheduler runs every minute. If this stays old, the database may be paused or the setup script has not been run.</p>}
        {usage && (
          <p className="small muted" data-testid="usage">
            This month: {usage.count} recording{usage.count === 1 ? "" : "s"}, {duration(usage.seconds)} of audio, about ${usage.cost.toFixed(2)} at list prices.
          </p>
        )}
      </section>

      <section className="card">
        <div className="label">Privacy</div>
        <p className="small muted">
          Audio is sent to AssemblyAI to be transcribed, and the transcript is sent to the Claude API to find the summary and items. Audio is deleted from storage 30 days after processing; transcripts and items stay until you delete the recording. Recording other people can require their consent where you are.
        </p>
      </section>

      <section className="card">
        <div className="small muted mono">Account id: {userId}</div>
        <div className="row wrap">
          <Link className="btn small secondary" href="/phone-check">Phone check</Link>
          <button className="btn small secondary" onClick={async () => { await db.auth.signOut(); window.location.reload(); }}>Sign out</button>
        </div>
      </section>
    </>
  );
}
