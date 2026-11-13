"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { useRecorder } from "@/components/RecorderProvider";
import ConversationList, { CONVERSATION_COLUMNS, type ConversationRow } from "@/components/ConversationList";
import ImportButton from "@/components/ImportButton";
import { useRecordedMs } from "@/components/TabBar";
import { clock, duration, megabytes } from "@/lib/format";
import { deleteSession, patchSession, type LocalSession } from "@/lib/recorder/store";

export default function RecordPage() {
  const { db, trash, folders } = useApp();
  const { view, recording, paused, engaged, error, local, progress, upload, refreshLocal, changed } = useRecorder();
  const recorded = useRecordedMs();
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [recent, setRecent] = useState<ConversationRow[]>([]);

  const refresh = useCallback(async () => {
    let q = db.from("recordings").select(`${CONVERSATION_COLUMNS}${folders ? ", folder_id" : ""}`).eq("is_test", false);
    if (trash) q = q.is("deleted_at", null);
    const { data } = await q.order("started_at", { ascending: false }).limit(10);
    setRecent((data as unknown as ConversationRow[]) ?? []);
  }, [db, trash, folders]);

  // Reload the list on open and whenever an upload finishes.
  useEffect(() => {
    let live = true;
    (async () => { if (live) await refresh(); })();
    return () => { live = false; };
  }, [refresh, changed]);

  // While something is processing, refresh its status.
  const busy = recent.some((r) => r.status !== "ready" && r.status !== "failed");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const recover = async (s: LocalSession) => {
    await patchSession(s.id, { state: "stopped", durationMs: Math.max(0, s.lastChunkAt - new Date(s.startedAt).getTime()), note: "Recovered after the app closed while recording." });
    await refreshLocal();
    void upload(s.id);
  };

  // "Unfinished" means left over from an earlier launch, never the recording that is in progress or still saving.
  const orphans = local.filter((s) => s.state === "recording" && !engaged);
  const pending = local.filter((s) => s.state !== "recording");

  return (
    <>
      {orphans.map((s) => (
        <div className="card" key={s.id} data-testid="recover">
          <h2>Unfinished recording found</h2>
          <p className="small">The app closed while recording on {new Date(s.startedAt).toLocaleString()}. {megabytes(s.bytes)} was saved on this phone.</p>
          <div className="row">
            <button className="btn" onClick={() => recover(s)}>Recover and upload</button>
            <button className="btn secondary" onClick={async () => { if (confirm("Delete this audio from the phone?")) { await deleteSession(s.id); await refreshLocal(); } }}>Discard</button>
          </div>
        </div>
      ))}

      <section className="card">
        <div className="timer" data-testid="timer">{clock(recorded)}</div>
        {recording && view ? (
          <>
            <p className="small muted" style={{ textAlign: "center" }} data-testid="rec-stats">
              {paused ? "Paused. " : ""}Saved on phone: {megabytes(view.totalBytes)}{view.part > 1 ? ` · part ${view.part}` : ""}
              <br />
              {view.secondsLeft === null ? "Measuring size…" : `About ${duration(view.secondsLeft)} left in this file`}
            </p>
            <div className="banner">
              {paused
                ? "Paused. Tap the microphone to carry on, or the red square to finish."
                : "Tap the microphone to pause. Keep this screen open: locking the phone or switching apps stops the recording."}
              {!paused && view.wakeLock !== "on" && " The screen may dim: tap it now and then."}
            </div>
            {view.notice && <div className="banner rec">{view.notice}</div>}
          </>
        ) : (
          <>
            <p className="small muted" style={{ textAlign: "center" }}>Tap the blue microphone below to record. Audio is saved on this phone every few seconds.</p>
            <div style={{ textAlign: "center" }}><ImportButton onMessage={(text, ok) => setNotice({ text, ok })} /></div>
          </>
        )}
        {error && <div className="banner rec">{error}</div>}
        {notice && <div className={`banner ${notice.ok ? "ok" : "rec"}`} data-testid="import-message">{notice.text}</div>}
      </section>

      {pending.length > 0 && (
        <section className="card">
          <div className="label">On this phone</div>
          {pending.map((s) => (
            <div className="item" key={s.id} data-testid="local-session">
              <div style={{ flex: 1 }}>
                <div>{new Date(s.startedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}{s.part > 1 ? ` · part ${s.part}` : ""} · {megabytes(s.bytes)}</div>
                <div className="small muted">
                  {s.state === "uploading" ? `Uploading ${Math.round((progress[s.id] ?? 0) * 100)}%` : "Saved on phone"}
                  {s.note ? ` · ${s.note}` : ""}
                </div>
              </div>
              {s.state === "stopped" && (
                <span className="row">
                  <button className="btn small" onClick={() => upload(s.id)}>Upload</button>
                  {/* A recording that can never upload (empty, say) would otherwise sit here for ever. */}
                  {s.note?.startsWith("Upload did not finish") && (
                    <button className="btn small secondary" onClick={async () => { if (confirm("Delete this audio from the phone? It has not been uploaded.")) { await deleteSession(s.id); await refreshLocal(); } }}>Discard</button>
                  )}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <section className="card">
          <div className="spread"><span className="label">Latest</span><span className="small muted">Swipe left to delete · hold for more</span></div>
          <ConversationList rows={recent} testid="recent" showStatus onChanged={refresh} />
        </section>
      )}
    </>
  );
}
