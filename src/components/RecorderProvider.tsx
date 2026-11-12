"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Recorder, type RecorderView } from "@/lib/recorder/recorder";
import { listSessions, type LocalSession } from "@/lib/recorder/store";
import { uploadSession } from "@/lib/recorder/upload";

type RecorderApi = {
  view: RecorderView | null;
  recording: boolean;
  paused: boolean;
  error: string;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  /** Recordings still on this phone, and how far each upload has got. */
  local: LocalSession[];
  progress: Record<string, number>;
  upload: (id: string) => Promise<void>;
  refreshLocal: () => Promise<void>;
  /** Goes up whenever an upload finishes or fails, so screens know to reload their lists. */
  changed: number;
};

const Ctx = createContext<RecorderApi | null>(null);
export function useRecorder(): RecorderApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useRecorder outside RecorderProvider");
  return api;
}

/** Owns the recorder, so the tab bar can control it and a recording carries on whichever screen is showing. */
export default function RecorderProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const recorder = useRef<Recorder | null>(null);
  const uploading = useRef(new Set<string>());
  const [view, setView] = useState<RecorderView | null>(null);
  const [error, setError] = useState("");
  const [local, setLocal] = useState<LocalSession[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [changed, setChanged] = useState(0);

  const refreshLocal = useCallback(async () => { setLocal(await listSessions().catch(() => [])); }, []);

  const upload = useCallback(async (id: string) => {
    if (uploading.current.has(id)) return;
    uploading.current.add(id);
    try {
      await uploadSession(id, (f) => setProgress((p) => ({ ...p, [id]: f })));
    } catch {
      // The session keeps its audio and shows the reason with an Upload button.
    } finally {
      uploading.current.delete(id);
      await refreshLocal();
      setChanged((n) => n + 1);
    }
  }, [refreshLocal]);

  // On open: finished recordings that never uploaded are sent now. Unfinished ones wait for a tap on Recover.
  useEffect(() => {
    let live = true;
    (async () => {
      const sessions = await listSessions().catch(() => []);
      if (!live) return;
      setLocal(sessions);
      for (const s of sessions) if (s.state === "stopped" || s.state === "uploading") void upload(s.id);
    })();
    const onOnline = () => listSessions().then((all) => all.filter((s) => s.state === "stopped").forEach((s) => void upload(s.id)));
    window.addEventListener("online", onOnline);
    return () => { live = false; window.removeEventListener("online", onOnline); };
  }, [upload]);

  const start = useCallback(async () => {
    if (recorder.current) return;
    setError("");
    try {
      const r = new Recorder(userId, setView, (ids) => {
        void (async () => {
          await refreshLocal();
          setChanged((n) => n + 1);
          for (const id of ids) void upload(id);
        })();
      });
      recorder.current = r;
      await r.start();
    } catch (e) {
      recorder.current = null;
      const name = (e as Error).name;
      setError(name === "NotAllowedError" ? "Microphone access was refused. Allow it in Settings > Voice Notes." : `Could not start: ${(e as Error).message}`);
    }
  }, [userId, refreshLocal, upload]);

  const stop = useCallback(async () => {
    const r = recorder.current;
    recorder.current = null;
    await r?.stop();
  }, []);
  const pause = useCallback(() => recorder.current?.pause(), []);
  const resume = useCallback(() => recorder.current?.resume(), []);

  // An interruption ends the recording from inside the recorder; let go of it here too.
  const active = view?.recording ?? false;
  useEffect(() => { if (!active && view) recorder.current = null; }, [active, view]);

  return (
    <Ctx.Provider value={{ view, recording: active, paused: view?.paused ?? false, error, start, pause, resume, stop, local, progress, upload, refreshLocal, changed }}>
      {children}
    </Ctx.Provider>
  );
}
