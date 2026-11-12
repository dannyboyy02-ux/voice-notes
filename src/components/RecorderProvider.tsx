"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Recorder, type RecorderView } from "@/lib/recorder/recorder";
import { listSessions, type LocalSession } from "@/lib/recorder/store";
import { uploadSession } from "@/lib/recorder/upload";

type RecorderApi = {
  view: RecorderView | null;
  recording: boolean;
  paused: boolean;
  /** True from the tap on the microphone until the recording has fully finished saving. */
  engaged: boolean;
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
  const [engaged, setEngaged] = useState(false);

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
    // One recorder at a time: a tap while the last recording is still saving is ignored.
    if (recorder.current) return;
    setError("");
    setEngaged(true);
    // Updates are accepted only from the recorder that is current, so a late message from a
    // recording that has just ended can never disturb the next one.
    const r: Recorder = new Recorder(
      userId,
      (v) => { if (recorder.current === r) setView(v); },
      (ids) => {
        if (!r.active && recorder.current === r) {
          recorder.current = null;
          setEngaged(false);
        }
        void (async () => {
          await refreshLocal();
          setChanged((n) => n + 1);
          for (const id of ids) void upload(id);
        })();
      },
    );
    recorder.current = r;
    try {
      await r.start();
    } catch (e) {
      if (recorder.current === r) recorder.current = null;
      setEngaged(false);
      const name = (e as Error).name;
      setError(name === "NotAllowedError" ? "Microphone access was refused. Allow it in Settings > Voice Notes." : `Could not start: ${(e as Error).message}`);
    }
  }, [userId, refreshLocal, upload]);

  // The recorder lets go of itself when it has finished saving (see above), whether it was stopped here or by an interruption.
  const stop = useCallback(async () => { await recorder.current?.stop(); }, []);
  const pause = useCallback(() => recorder.current?.pause(), []);
  const resume = useCallback(() => recorder.current?.resume(), []);
  const active = view?.recording ?? false;

  return (
    <Ctx.Provider value={{ view, recording: active, paused: view?.paused ?? false, engaged, error, start, pause, resume, stop, local, progress, upload, refreshLocal, changed }}>
      {children}
    </Ctx.Provider>
  );
}
