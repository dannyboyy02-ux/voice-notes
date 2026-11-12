"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { useRecorder } from "@/components/RecorderProvider";
import SwipeToDelete from "@/components/SwipeToDelete";
import { useRecordedMs } from "@/components/TabBar";
import { deleteRecording } from "@/lib/client/recordings";
import { clock, duration, megabytes } from "@/lib/format";
import { STATUS_LABEL, type Status } from "@/lib/pipeline/steps";
import { deleteSession, patchSession, type LocalSession } from "@/lib/recorder/store";

type Recent = { id: string; status: Status; title: string | null; summary: string | null; started_at: string; storage_path: string | null };

export default function RecordPage() {
  const { db, trash } = useApp();
  const { view, recording, paused, error, local, progress, upload, refreshLocal, changed } = useRecorder();
  const recorded = useRecordedMs();
  const [problem, setProblem] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);

  const refresh = useCallback(async () => {
    let q = db.from("recordings").select("id, status, title, summary, started_at, storage_path").eq("is_test", false);
    if (trash) q = q.is("deleted_at", null);
    const { data } = await q.order("started_at", { ascending: false }).limit(10);
    setRecent((data as Recent[]) ?? []);
  }, [db, trash]);

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

  const orphans = local.filter((s) => s.state === "recording" && !recording);
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
                ? "Paused. Tap the blue microphone to carry on, or the red square to finish."
                : "Keep this screen open. Locking the phone or switching apps stops the recording."}
              {!paused && view.wakeLock !== "on" && " The screen may dim: tap it now and then."}
            </div>
            {view.notice && <div className="banner rec">{view.notice}</div>}
          </>
        ) : (
          <p className="small muted" style={{ textAlign: "center" }}>Tap the blue microphone below to record. Audio is saved on this phone every few seconds.</p>
        )}
        {(error || problem) && <div className="banner rec">{error || problem}</div>}
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
              {s.state === "stopped" && <button className="btn small" onClick={() => upload(s.id)}>Upload</button>}
            </div>
          ))}
        </section>
      )}

      {recent.length > 0 && (
        <section className="card">
          <div className="spread"><span className="label">Latest</span><span className="small muted">{trash ? "Swipe left to move to Trash" : "Swipe left to delete"}</span></div>
          {recent.map((r) => {
            const fallback = new Date(r.started_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
            return (
              <SwipeToDelete
                key={r.id}
                label={r.title ?? fallback}
                onDelete={async () => {
                  const failed = await deleteRecording(db, r, trash);
                  if (failed) setProblem(`Could not delete: ${failed}`);
                  await refresh();
                }}
              >
                <Link href={`/notes/${r.id}`} className="item list-link" data-testid="recent" draggable={false}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{r.title ?? fallback}</div>
                    {r.summary && <div className="small muted two-line">{r.summary}</div>}
                    {r.title && <div className="small muted">{fallback}</div>}
                  </div>
                  <span className={`pill ${r.status === "ready" ? "ok" : r.status === "failed" ? "rec" : ""}`} data-testid="upload-status">{STATUS_LABEL[r.status]}</span>
                </Link>
              </SwipeToDelete>
            );
          })}
        </section>
      )}
    </>
  );
}
