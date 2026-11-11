"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import SwipeToDelete from "@/components/SwipeToDelete";
import { deleteRecording } from "@/lib/client/recordings";
import { clock, duration, megabytes } from "@/lib/format";
import { STATUS_LABEL, type Status } from "@/lib/pipeline/steps";
import { Recorder, type RecorderView } from "@/lib/recorder/recorder";
import { deleteSession, listSessions, patchSession, type LocalSession } from "@/lib/recorder/store";
import { uploadSession } from "@/lib/recorder/upload";

type Recent = { id: string; status: Status; title: string | null; summary: string | null; started_at: string; storage_path: string | null };

export default function RecordPage() {
  const { db, userId, trash } = useApp();
  const recorder = useRef<Recorder | null>(null);
  const [view, setView] = useState<RecorderView | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [local, setLocal] = useState<LocalSession[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Recent[]>([]);
  const uploading = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    setLocal(await listSessions().catch(() => []));
    let q = db.from("recordings").select("id, status, title, summary, started_at, storage_path").eq("is_test", false);
    if (trash) q = q.is("deleted_at", null);
    const { data } = await q.order("started_at", { ascending: false }).limit(10);
    setRecent((data as Recent[]) ?? []);
  }, [db, trash]);

  const upload = useCallback(async (id: string) => {
    if (uploading.current.has(id)) return;
    uploading.current.add(id);
    try {
      await uploadSession(id, (f) => setProgress((p) => ({ ...p, [id]: f })));
    } catch {
      // The session keeps its audio and shows the reason with a Retry button.
    } finally {
      uploading.current.delete(id);
      await refresh();
    }
  }, [refresh]);

  // On open: finished recordings that never uploaded are sent now. Unfinished ones wait for a tap on Recover.
  useEffect(() => {
    let live = true;
    (async () => {
      const sessions = await listSessions().catch(() => []);
      if (!live) return;
      for (const s of sessions) if (s.state === "stopped" || s.state === "uploading") void upload(s.id);
      await refresh();
    })();
    const onOnline = () => listSessions().then((all) => all.filter((s) => s.state === "stopped").forEach((s) => void upload(s.id)));
    window.addEventListener("online", onOnline);
    return () => { live = false; window.removeEventListener("online", onOnline); };
  }, [refresh, upload]);

  const recording = view?.recording ?? false;
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [recording]);
  // While something is processing, refresh its status.
  const busy = recent.some((r) => r.status !== "ready" && r.status !== "failed");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const start = async () => {
    setError("");
    try {
      const r = new Recorder(userId, setView, (ids) => {
        void (async () => {
          await refresh();
          for (const id of ids) void upload(id);
        })();
      });
      await r.start();
      recorder.current = r;
      setNow(Date.now());
    } catch (e) {
      const name = (e as Error).name;
      setError(name === "NotAllowedError" ? "Microphone access was refused. Allow it in Settings > Voice Notes." : `Could not start: ${(e as Error).message}`);
    }
  };
  const stop = async () => {
    await recorder.current?.stop();
    recorder.current = null;
  };
  const recover = async (s: LocalSession) => {
    await patchSession(s.id, { state: "stopped", durationMs: Math.max(0, s.lastChunkAt - new Date(s.startedAt).getTime()), note: "Recovered after the app closed while recording." });
    await refresh();
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
            <button className="btn secondary" onClick={async () => { if (confirm("Delete this audio from the phone?")) { await deleteSession(s.id); await refresh(); } }}>Discard</button>
          </div>
        </div>
      ))}

      <section className="card">
        <div className="timer" data-testid="timer">{clock(recording && view ? now - view.startedAt : 0)}</div>
        <button className={`recbtn ${recording ? "stop" : ""}`} onClick={recording ? stop : start} aria-label={recording ? "Stop recording" : "Start recording"} data-testid="record-button">
          <span />
        </button>
        {recording && view ? (
          <>
            <p className="small muted" style={{ textAlign: "center" }} data-testid="rec-stats">
              Saved on phone: {megabytes(view.totalBytes)}{view.part > 1 ? ` · part ${view.part}` : ""}
              <br />
              {view.secondsLeft === null ? "Measuring size…" : `About ${duration(view.secondsLeft)} left in this file`}
            </p>
            <div className="banner">
              Keep this screen open. Locking the phone or switching apps stops the recording.
              {view.wakeLock !== "on" && " The screen may dim: tap it now and then."}
            </div>
            {view.notice && <div className="banner rec">{view.notice}</div>}
          </>
        ) : (
          <p className="small muted" style={{ textAlign: "center" }}>Tap to record. Audio is saved on this phone every few seconds.</p>
        )}
        {error && <div className="banner rec">{error}</div>}
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
                  const problem = await deleteRecording(db, r, trash);
                  if (problem) setError(`Could not delete: ${problem}`);
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
