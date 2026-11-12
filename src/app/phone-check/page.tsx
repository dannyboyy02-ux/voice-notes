"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { appleRemindersLink } from "@/lib/apple";
import { CHUNK_MS, MIME_CANDIDATES, PART_BYTE_CAP, TARGET_BITS_PER_SECOND, pickMimeType } from "@/lib/recorder/mime";

type Env = {
  userAgent: string;
  standalone: boolean;
  mediaRecorder: boolean;
  formats: { type: string; ok: boolean }[];
  picked: string | null;
  wakeLock: boolean;
  indexedDb: boolean;
  serviceWorker: boolean;
  push: boolean;
  notifications: string;
};

let envCache: Env | null = null;
function readEnv(): Env {
  if (envCache) return envCache;
  const hasRecorder = typeof MediaRecorder !== "undefined";
  const supported = (t: string) => hasRecorder && MediaRecorder.isTypeSupported(t);
  envCache = {
    userAgent: navigator.userAgent,
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    mediaRecorder: hasRecorder,
    formats: MIME_CANDIDATES.map((type) => ({ type, ok: supported(type) })),
    picked: pickMimeType(supported) ?? null,
    wakeLock: "wakeLock" in navigator,
    indexedDb: "indexedDB" in window,
    serviceWorker: "serviceWorker" in navigator,
    push: "PushManager" in window,
    notifications: "Notification" in window ? Notification.permission : "unsupported",
  };
  return envCache;
}
const noSubscribe = () => () => {};
const serverEnv = () => null;

const DB_NAME = "voice-notes-phone-check";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("chunks", { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type RecResult = {
  mimeType: string;
  seconds: number;
  chunks: number;
  bytes: number;
  bytesPerSecond: number;
  kbps: number;
  requestedKbps: number;
  minutesPerPart: number;
  decodedSeconds: number | null;
  decodeError: string | null;
  idbBytes: number | null;
  idbError: string | null;
  wakeLock: string;
};

type Session = {
  stream: MediaStream;
  recorder: MediaRecorder;
  blobs: Blob[];
  startedAt: number;
  wake: WakeLockSentinel | null;
  wakeState: string;
  cleanup: () => void;
};

const t = () => new Date().toLocaleTimeString([], { hour12: false });

export default function PhoneCheck() {
  const env = useSyncExternalStore(noSubscribe, readEnv, serverEnv);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "timed" | "interrupt">("");
  const [result, setResult] = useState<RecResult | null>(null);
  const [interruptResult, setInterruptResult] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [shortcut, setShortcut] = useState<string>("not tried");
  const [copied, setCopied] = useState(false);
  const session = useRef<Session | null>(null);

  const say = useCallback((line: string) => setLog((l) => [...l, `${t()}  ${line}`]), []);

  const begin = useCallback(
    async (label: string): Promise<Session> => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const mimeType = pickMimeType((x) => MediaRecorder.isTypeSupported(x));
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: TARGET_BITS_PER_SECOND });
      const db = await openDb().catch(() => null);
      if (db) await idbRequest(db.transaction("chunks", "readwrite").objectStore("chunks").clear()).catch(() => {});
      const s: Session = { stream, recorder, blobs: [], startedAt: Date.now(), wake: null, wakeState: "not supported", cleanup: () => {} };
      const track = stream.getAudioTracks()[0];
      say(`${label}: recording as ${recorder.mimeType || mimeType || "default"}; recorder reports ${recorder.audioBitsPerSecond} bps`);
      say(`track settings: ${JSON.stringify(track.getSettings())}`);

      recorder.ondataavailable = (e) => {
        if (!e.data.size) return;
        s.blobs.push(e.data);
        say(`chunk ${s.blobs.length}: ${e.data.size} bytes`);
        if (db) {
          const store = db.transaction("chunks", "readwrite").objectStore("chunks");
          store.add(e.data).onerror = () => say("IndexedDB write failed");
        }
      };
      recorder.onerror = (e) => say(`recorder error: ${(e as ErrorEvent).message || "unknown"}`);
      recorder.onpause = () => say("recorder paused");
      recorder.onresume = () => say("recorder resumed");
      track.onmute = () => say("microphone track MUTED (interruption)");
      track.onunmute = () => say("microphone track unmuted");
      track.onended = () => say("microphone track ENDED (interruption)");
      const onVis = () => {
        say(`page ${document.visibilityState}; recorder ${recorder.state}; track ${track.readyState}${track.muted ? " muted" : ""}`);
        if (document.visibilityState === "visible" && "wakeLock" in navigator && (!s.wake || s.wake.released)) {
          navigator.wakeLock.request("screen").then(
            (w) => { s.wake = w; say("wake lock re-acquired"); },
            (err) => say(`wake lock re-acquire failed: ${err.name}`),
          );
        }
      };
      const onHide = () => say("pagehide");
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pagehide", onHide);
      s.cleanup = () => {
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("pagehide", onHide);
      };

      if ("wakeLock" in navigator) {
        try {
          s.wake = await navigator.wakeLock.request("screen");
          s.wakeState = "acquired";
          s.wake.addEventListener("release", () => say("wake lock released"));
          say("wake lock acquired");
        } catch (err) {
          s.wakeState = `failed: ${(err as Error).name}`;
          say(`wake lock failed: ${(err as Error).name}`);
        }
      } else say("wake lock not supported");

      recorder.start(CHUNK_MS);
      session.current = s;
      return s;
    },
    [say],
  );

  const finish = useCallback(async (): Promise<RecResult | null> => {
    const s = session.current;
    if (!s) return null;
    session.current = null;
    const stopped = new Promise<void>((resolve) => {
      if (s.recorder.state === "inactive") return resolve();
      s.recorder.onstop = () => resolve();
      try { s.recorder.stop(); } catch { resolve(); }
    });
    await Promise.race([stopped, new Promise((r) => setTimeout(r, 3000))]);
    await new Promise((r) => setTimeout(r, 300));
    const seconds = (Date.now() - s.startedAt) / 1000;
    s.stream.getTracks().forEach((x) => x.stop());
    s.cleanup();
    await s.wake?.release().catch(() => {});

    const mimeType = s.recorder.mimeType || s.blobs[0]?.type || "";
    const joined = new Blob(s.blobs, { type: mimeType });
    const bytesPerSecond = joined.size / seconds;
    const out: RecResult = {
      mimeType,
      seconds,
      chunks: s.blobs.length,
      bytes: joined.size,
      bytesPerSecond,
      kbps: (bytesPerSecond * 8) / 1000,
      requestedKbps: TARGET_BITS_PER_SECOND / 1000,
      minutesPerPart: bytesPerSecond > 0 ? PART_BYTE_CAP / bytesPerSecond / 60 : 0,
      decodedSeconds: null,
      decodeError: null,
      idbBytes: null,
      idbError: null,
      wakeLock: s.wakeState,
    };
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const buf = await ctx.decodeAudioData(await joined.arrayBuffer());
      out.decodedSeconds = buf.duration;
      await ctx.close();
    } catch (err) {
      out.decodeError = (err as Error).message || String(err);
    }
    try {
      const db = await openDb();
      const saved = await idbRequest(db.transaction("chunks").objectStore("chunks").getAll());
      out.idbBytes = (saved as Blob[]).reduce((n, b) => n + b.size, 0);
    } catch (err) {
      out.idbError = (err as Error).message || String(err);
    }
    setAudioUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(joined);
    });
    say(`stopped: ${out.chunks} chunks, ${out.bytes} bytes in ${seconds.toFixed(1)} s = ${out.kbps.toFixed(1)} kbps`);
    return out;
  }, [say]);

  const runTimed = async () => {
    setBusy("timed");
    setResult(null);
    try {
      await begin("20-second test");
      await new Promise((r) => setTimeout(r, 20_000));
      setResult(await finish());
    } catch (err) {
      say(`test failed: ${(err as Error).name}: ${(err as Error).message}`);
      await finish().catch(() => {});
    }
    setBusy("");
  };

  const startInterrupt = async () => {
    setBusy("interrupt");
    setInterruptResult("");
    try {
      await begin("interruption test");
    } catch (err) {
      say(`could not start: ${(err as Error).name}: ${(err as Error).message}`);
      setBusy("");
    }
  };
  const stopInterrupt = async () => {
    const s = session.current;
    const track = s?.stream.getAudioTracks()[0];
    const before = `recorder ${s?.recorder.state}, track ${track?.readyState}${track?.muted ? " muted" : ""}`;
    const r = await finish();
    setInterruptResult(
      r
        ? `At stop: ${before}. Kept ${r.chunks} chunks, ${r.bytes} bytes over ${r.seconds.toFixed(0)} s of wall time; decoded audio ${r.decodedSeconds === null ? `failed (${r.decodeError})` : `${r.decodedSeconds.toFixed(1)} s`}; saved on phone ${r.idbBytes ?? "?"} bytes.`
        : "No result.",
    );
    setBusy("");
  };

  const shortcutHref = appleRemindersLink([
    { title: "Voice Notes phone check", notes: "Safe to delete. Sent by the phone check." },
    { title: "Second test item", due: "2030-01-01T09:00" },
  ]);
  const tryShortcut = () => {
    setShortcut("tapped; page did not go to the background (link may not have opened)");
    const started = Date.now();
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        setShortcut("opened: the app went to the background after the tap");
        say("shortcuts link: page hidden (Shortcuts opened)");
      } else {
        setShortcut(`opened, and came back to this page after ${Math.round((Date.now() - started) / 1000)} s`);
        say("shortcuts link: returned to the page");
        document.removeEventListener("visibilitychange", onVis);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    say("shortcuts link tapped");
  };

  const report = [
    "VOICE NOTES PHONE CHECK",
    env ? `UA: ${env.userAgent}` : "",
    env ? `Home-screen app: ${env.standalone ? "yes" : "no (opened in a browser tab)"}` : "",
    env ? `Formats: ${env.formats.map((f) => `${f.type}=${f.ok ? "yes" : "no"}`).join(", ")} | picked ${env.picked}` : "",
    env ? `Wake lock API: ${env.wakeLock} | IndexedDB: ${env.indexedDb} | Service worker: ${env.serviceWorker} | Push: ${env.push} | Notifications: ${env.notifications}` : "",
    result
      ? `20 s test: ${result.mimeType}; ${result.chunks} chunks; ${result.bytes} bytes; ${result.bytesPerSecond.toFixed(0)} bytes/s = ${result.kbps.toFixed(1)} kbps (asked ${result.requestedKbps}); ${result.minutesPerPart.toFixed(0)} min per 45 MB part; joined decode ${result.decodedSeconds === null ? `FAILED: ${result.decodeError}` : `${result.decodedSeconds.toFixed(1)} s of ${result.seconds.toFixed(1)} s`}; IndexedDB ${result.idbBytes === null ? `FAILED: ${result.idbError}` : `${result.idbBytes} bytes`}; wake lock ${result.wakeLock}`
      : "20 s test: not run",
    `Interruption test: ${interruptResult || "not run"}`,
    `Shortcuts link: ${shortcut}`,
    "--- log ---",
    ...log,
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      say("copy failed: select the report text and copy it by hand");
    }
  };

  const decodeOk = result && result.decodedSeconds !== null && Math.abs(result.decodedSeconds - result.seconds) < 3;

  return (
    <main className="page">
      <div className="spread">
        <h1>Phone check</h1>
        <Link className="btn small secondary" href="/settings" data-testid="back">Back</Link>
      </div>
      <p className="muted">
        Five quick tests of what this iPhone allows. Best run from the Home Screen icon: Share, then Add to Home Screen, then open it from there. Takes about 10 minutes. At the end, tap Copy report and paste it to Claude.
      </p>

      <section className="card" data-testid="env">
        <h2>1. Formats and features</h2>
        {env ? (
          <>
            <div className="row wrap">
              <span className={`pill ${env.standalone ? "ok" : "warn"}`}>{env.standalone ? "Home-screen app" : "Browser tab"}</span>
              <span className={`pill ${env.mediaRecorder ? "ok" : "rec"}`}>Recorder {env.mediaRecorder ? "yes" : "no"}</span>
              <span className={`pill ${env.wakeLock ? "ok" : "warn"}`}>Wake lock {env.wakeLock ? "yes" : "no"}</span>
              <span className={`pill ${env.push ? "ok" : "warn"}`}>Push {env.push ? "yes" : "no"}</span>
            </div>
            {env.formats.map((f) => (
              <div className="spread small" key={f.type}>
                <span className="mono">{f.type}</span>
                <span className={`pill ${f.ok ? "ok" : ""}`}>{f.ok ? "supported" : "no"}</span>
              </div>
            ))}
            <p className="small">Will record as <b>{env.picked ?? "nothing: no supported format"}</b>.</p>
            {!env.push && <p className="small muted">Push shows &quot;no&quot; in a browser tab on iPhone. It appears only in the Home Screen app.</p>}
          </>
        ) : (
          <p className="muted">Checking…</p>
        )}
      </section>

      <section className="card">
        <h2>2. Size, joined playback, wake lock</h2>
        <p className="small muted">Records 20 seconds. Talk normally and leave the screen alone: it should not dim or lock.</p>
        <button className="btn" onClick={runTimed} disabled={busy !== ""} data-testid="run-timed">
          {busy === "timed" ? "Recording 20 seconds…" : "Run 20-second test"}
        </button>
        {result && (
          <div className="small" data-testid="timed-result">
            <div className="spread"><span>Real size</span><b>{result.bytesPerSecond.toFixed(0)} bytes/s ({result.kbps.toFixed(1)} kbps, asked {result.requestedKbps})</b></div>
            <div className="spread"><span>One 45 MB part holds</span><b>{result.minutesPerPart.toFixed(0)} minutes</b></div>
            <div className="spread"><span>Chunks joined</span><b>{result.chunks}</b></div>
            <div className="spread"><span>Joined file decodes</span><span className={`pill ${decodeOk ? "ok" : "rec"}`}>{result.decodedSeconds === null ? "failed" : `${result.decodedSeconds.toFixed(1)} s of ${result.seconds.toFixed(1)} s`}</span></div>
            <div className="spread"><span>Saved on phone</span><span className={`pill ${result.idbBytes === result.bytes ? "ok" : "rec"}`}>{result.idbBytes === null ? "failed" : `${result.idbBytes} bytes`}</span></div>
            <div className="spread"><span>Wake lock</span><span className={`pill ${result.wakeLock === "acquired" ? "ok" : "warn"}`}>{result.wakeLock}</span></div>
          </div>
        )}
        {audioUrl && (
          <>
            <p className="small muted">Play it. You should hear all 20 seconds, start to end, with no gaps:</p>
            <audio controls src={audioUrl} style={{ width: "100%" }} />
          </>
        )}
      </section>

      <section className="card">
        <h2>3. Interruption</h2>
        <p className="small muted">
          Tap Start, talk for 10 seconds, then lock the phone for 10 seconds (or switch to another app). Unlock, come back here, talk 5 more seconds and tap Stop.
        </p>
        {busy === "interrupt" ? (
          <button className="btn danger" onClick={stopInterrupt}>Stop interruption test</button>
        ) : (
          <button className="btn" onClick={startInterrupt} disabled={busy !== ""}>Start interruption test</button>
        )}
        {interruptResult && <p className="small">{interruptResult}</p>}
      </section>

      <section className="card">
        <h2>4. Shortcuts link</h2>
        <p className="small muted">
          Tap the button. The Shortcuts app should open and say it cannot find a shortcut named &quot;Add From Voice Notes&quot;. That is a pass: it proves the link opens. Then return here.
        </p>
        <a className="btn" href={shortcutHref} onClick={tryShortcut} data-testid="shortcut-link">Open Shortcuts</a>
        <p className="small">Result: {shortcut}</p>
      </section>

      <section className="card">
        <h2>5. Send the report</h2>
        <button className="btn" onClick={copy}>{copied ? "Copied" : "Copy report"}</button>
        <pre className="log" data-testid="report">{report}</pre>
      </section>
    </main>
  );
}
