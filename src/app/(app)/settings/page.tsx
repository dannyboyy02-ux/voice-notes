"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useApp } from "@/components/AppShell";
import { APPLE_SHORTCUT_NAME } from "@/lib/apple";
import { enablePush } from "@/lib/client/push";
import { api } from "@/lib/client/supabase";
import { applyTheme, readTheme, type Theme } from "@/lib/client/theme";
import { ago, duration } from "@/lib/format";
import type { ModelMode } from "@/lib/models";

type Status = { scheduler_last_run_at: string | null; last_tick_at: string | null; connected: boolean };
type Usage = { seconds: number; cost: number; count: number };
const MODES: { id: ModelMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "best", label: "Best" },
  { id: "cheapest", label: "Cheapest" },
];
const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "auto", label: "Phone" },
];
const PUSH_LABEL = { on: "On", off: "Off", denied: "Blocked", unsupported: "Not supported here", "needs-install": "Needs Home Screen", "not-configured": "Not set up" };
const noSubscribe = () => () => {};

export default function SettingsPage() {
  const { db, userId, email, trash, push, setPush } = useApp();
  const savedTheme = useSyncExternalStore(noSubscribe, readTheme, () => "dark" as Theme);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [mode, setMode] = useState<ModelMode>("auto");
  const [apple, setApple] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [stale, setStale] = useState(false);
  const [inTrash, setInTrash] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const [s, st, u, t] = await Promise.all([
        db.from("settings").select("model_mode, apple_reminders").maybeSingle(),
        db.rpc("server_status"),
        // Usage counts everything recorded this month, including recordings now in Trash: they were still paid for.
        db.from("recordings").select("duration_ms, llm_cost_usd, stt_cost_usd").eq("is_test", false).gte("started_at", monthStart.toISOString()),
        trash
          ? db.from("recordings").select("id", { count: "exact", head: true }).not("deleted_at", "is", null).eq("is_test", false)
          : Promise.resolve({ count: null }),
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
      setInTrash(t.count ?? null);
    })();
    return () => { live = false; };
  }, [db, trash]);

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
  const currentTheme = theme ?? savedTheme;
  const heartbeat = status?.scheduler_last_run_at;
  // The audio meter is a rough guide: 20 hours is about what the plan expected for a heavy month.
  const hours = (usage?.seconds ?? 0) / 3600;

  return (
    <>
      <section style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="avatar" aria-hidden="true">{(email[0] ?? "V").toUpperCase()}</div>
        <div data-testid="account-email">{email || "Signed in"}</div>
      </section>

      <section className="card" data-testid="usage">
        <div className="spread"><b>This month</b><span className="small muted">{usage ? `${usage.count} recording${usage.count === 1 ? "" : "s"}` : "…"}</span></div>
        <div className="small muted">{usage ? `${duration(usage.seconds)} of audio • about $${usage.cost.toFixed(2)} at list prices` : "Adding it up…"}</div>
        <div className="meter"><i style={{ width: `${Math.min(100, (hours / 20) * 100)}%` }} /></div>
        <div className="small muted">An estimate from this app&apos;s own log, not your AssemblyAI or Claude bill. Zeus chats are not included.</div>
      </section>

      {message && <div className="banner">{message}</div>}

      <div className="group-title">Preferences</div>
      <section className="group">
        <div className="line">
          <span>Appearance</span>
          <div className="seg" data-testid="theme">
            {THEMES.map((t) => (
              <button key={t.id} className={currentTheme === t.id ? "on" : ""} onClick={() => { applyTheme(t.id); setTheme(t.id); }}>{t.label}</button>
            ))}
          </div>
        </div>
        <div className="line">
          <span>Notifications</span>
          <span className="row">
            {push === "off" && <button className="btn small" onClick={async () => setPush(await enablePush())}>Turn on</button>}
            {push === "on" && <button className="btn small secondary" onClick={testPush}>Send a test</button>}
            <span className={`pill ${push === "on" ? "ok" : "warn"}`} data-testid="push-state">{PUSH_LABEL[push]}</span>
          </span>
        </div>
        <label className="line">
          <span>Also send to Apple Reminders</span>
          <input type="checkbox" checked={apple} onChange={(e) => save({ apple_reminders: e.target.checked })} style={{ width: 24, height: 24 }} data-testid="apple-toggle" />
        </label>
        {apple && (
          <div className="note small muted">
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

      <div className="group-title">AI</div>
      <section className="group">
        <div className="line">
          <span>AI model</span>
          <div className="seg" data-testid="model-mode">
            {MODES.map((m) => <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => save({ model_mode: m.id })}>{m.label}</button>)}
          </div>
        </div>
        <div className="note small muted">
          Auto uses Claude Haiku 5.5 for one speaker and 10 minutes or less, Claude Opus 5.5 for anything else, and reruns on Opus when the cheap pass is unsure. Any recording also has a “Redo with best model” button. Zeus always uses Claude Sonnet 5.5.
        </div>
      </section>

      <div className="group-title">Data</div>
      <section className="group">
        <Link className="line" href="/trash" data-testid="trash-link">
          <span>Trash</span>
          <span className="muted">{!trash ? "Not switched on" : inTrash === null ? "" : inTrash === 0 ? "Empty" : `${inTrash} recording${inTrash === 1 ? "" : "s"}`} ›</span>
        </Link>
        <div className="line"><span>Delete audio after</span><span className="muted">30 days</span></div>
        <div className="line">
          <span>Server last checked in</span>
          <span className={`pill ${stale ? "warn" : "ok"}`} data-testid="heartbeat">{ago(heartbeat)}</span>
        </div>
        {stale && <div className="note small muted">The scheduler runs every minute. If this stays old, the database may be paused or the setup script has not been run.</div>}
      </section>

      <div className="group-title">About</div>
      <section className="group">
        <div className="note small muted" style={{ paddingTop: 12 }}>
          Audio is sent to AssemblyAI to be transcribed, and the transcript is sent to the Claude API to find the summary and items. When you ask Zeus a question, the relevant transcripts, summaries and items are sent to the Claude API too. Zeus can also add, change or remove your to-dos and reminders when you ask it to. Zeus conversations are saved on this phone only. Audio is deleted from storage 30 days after processing; transcripts and items stay until you delete the recording. Recording other people can require their consent where you are.
        </div>
        <Link className="line" href="/phone-check"><span>Phone check</span><span className="muted">›</span></Link>
        <div className="line"><span>Account id</span><span className="mono muted">{userId.slice(0, 8)}…</span></div>
        <button className="line" style={{ width: "100%", background: "none", border: 0, cursor: "pointer", color: "var(--rec)", font: "inherit" }} onClick={async () => { await db.auth.signOut(); window.location.reload(); }}>
          Sign out
        </button>
      </section>
    </>
  );
}
