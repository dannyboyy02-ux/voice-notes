"use client";
import { CHUNK_MS, PART_BYTE_CAP, TARGET_BITS_PER_SECOND, pickMimeType, secondsLeft } from "./mime";
import { patchSession, putChunk, putSession, type LocalSession } from "./store";

export type RecorderView = {
  recording: boolean;
  paused: boolean;
  /** Milliseconds actually recorded so far, not counting time spent paused. */
  activeMs: number;
  /** When activeMs was measured, so a ticking clock can add the time since. */
  at: number;
  startedAt: number;
  bytes: number; // bytes in the current part
  totalBytes: number;
  part: number;
  secondsLeft: number | null;
  wakeLock: "on" | "off" | "unsupported";
  notice: string | null;
};

type Part = { session: LocalSession; recorder: MediaRecorder; startedAt: number; seq: number; bytes: number; writes: Promise<void>; activeBefore: number; runStart: number | null };

/**
 * Records the microphone into on-phone storage, one chunk every few seconds.
 * If the app dies, everything up to the last chunk is still on the phone.
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private part: Part | null = null;
  private wake: WakeLockSentinel | null = null;
  private firstStartedAt = 0;
  private totalBytes = 0;
  private notice: string | null = null;
  private finished: string[] = [];
  private stopping = false;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;
  /** Recorded time in parts that are already finished. */
  private earlierMs = 0;

  private partMs(p: Part): number {
    return p.activeBefore + (p.runStart === null ? 0 : Date.now() - p.runStart);
  }

  constructor(
    private userId: string,
    private onView: (v: RecorderView) => void,
    private onEnded: (sessionIds: string[], reason: "stopped" | "interrupted") => void,
    private cap = PART_BYTE_CAP,
  ) {}

  private emit() {
    const p = this.part;
    this.onView({
      recording: !!p && !this.stopping,
      paused: !!p && this.paused,
      activeMs: this.earlierMs + (p ? this.partMs(p) : 0),
      at: Date.now(),
      startedAt: this.firstStartedAt,
      bytes: p?.bytes ?? 0,
      totalBytes: this.totalBytes,
      part: p?.session.part ?? 1,
      secondsLeft: p ? secondsLeft(p.bytes, this.partMs(p), this.cap) : null,
      wakeLock: !("wakeLock" in navigator) ? "unsupported" : this.wake && !this.wake.released ? "on" : "off",
      notice: this.notice,
    });
  }

  /** True while a part is open, including during a roll from one part to the next. */
  get active(): boolean {
    return this.part !== null;
  }

  async start(): Promise<void> {
    try {
      await this.begin();
    } catch (err) {
      // A start that fails part-way must not leave the microphone open or listeners behind.
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      await this.wake?.release().catch(() => {});
      this.wake = null;
      throw err;
    }
  }

  private async begin(): Promise<void> {
    // Low-bitrate mono keeps an hour near 22 MB. The real rate is measured, not assumed.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const track = this.stream.getAudioTracks()[0];
    track.addEventListener("ended", () => void this.stop("interrupted"));
    track.addEventListener("mute", () => {
      this.notice = "The microphone was interrupted.";
      this.emit();
      // A phone call or Siri mutes the track. If it does not come back, save what we have.
      this.muteTimer = setTimeout(() => { if (track.muted) void this.stop("interrupted"); }, 4000);
    });
    track.addEventListener("unmute", () => {
      if (this.muteTimer) clearTimeout(this.muteTimer);
      this.notice = null;
      this.emit();
    });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.firstStartedAt = Date.now();
    await this.startPart(1);
    await this.acquireWakeLock();
    this.emit();
  }

  private onVisibility = () => {
    if (document.visibilityState !== "visible" || !this.part) return;
    const track = this.stream?.getAudioTracks()[0];
    if (!track || track.readyState === "ended" || this.part.recorder.state === "inactive") void this.stop("interrupted");
    else void this.acquireWakeLock().then(() => this.emit());
  };

  private async acquireWakeLock() {
    if (!("wakeLock" in navigator) || (this.wake && !this.wake.released)) return;
    try {
      this.wake = await navigator.wakeLock.request("screen");
      this.wake.addEventListener("release", () => this.emit());
    } catch {
      this.wake = null;
    }
  }

  private async startPart(partNumber: number) {
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(this.stream!, { mimeType, audioBitsPerSecond: TARGET_BITS_PER_SECOND });
    const session: LocalSession = {
      id: crypto.randomUUID(),
      userId: this.userId,
      startedAt: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      mimeType: (recorder.mimeType || mimeType || "audio/mp4").split(";")[0],
      part: partNumber,
      bytes: 0,
      chunks: 0,
      lastChunkAt: Date.now(),
      durationMs: null,
      state: "recording",
    };
    await putSession(session);
    const part: Part = { session, recorder, startedAt: Date.now(), seq: 0, bytes: 0, writes: Promise.resolve(), activeBefore: 0, runStart: Date.now() };
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      const seq = part.seq++;
      part.bytes += e.data.size;
      this.totalBytes += e.data.size;
      part.writes = part.writes.then(() => putChunk(session.id, seq, e.data)).catch(() => {
        this.notice = "Could not save to the phone's storage. Stop and upload now.";
      });
      this.emit();
      // One file must stay under the storage cap, so a long recording rolls into a new part.
      if (part.bytes > this.cap && this.part === part && !this.stopping) void this.roll();
    };
    recorder.start(CHUNK_MS);
    this.part = part;
  }

  private async finishPart(part: Part): Promise<void> {
    await new Promise<void>((resolve) => {
      if (part.recorder.state === "inactive") return resolve();
      part.recorder.addEventListener("stop", () => resolve(), { once: true });
      try { part.recorder.stop(); } catch { resolve(); }
      setTimeout(resolve, 4000);
    });
    await new Promise((r) => setTimeout(r, 50)); // let the last dataavailable land
    await part.writes;
    const recorded = this.partMs(part);
    part.activeBefore = recorded;
    part.runStart = null;
    this.earlierMs += recorded;
    await patchSession(part.session.id, { state: "stopped", durationMs: recorded });
    this.finished.push(part.session.id);
  }

  private async roll() {
    const old = this.part!;
    await this.startPart(old.session.part + 1);
    this.notice = `Part ${old.session.part} was full, so recording continued in part ${old.session.part + 1}.`;
    await this.finishPart(old);
    this.onEnded([old.session.id], "stopped");
    this.finished = this.finished.filter((id) => id !== old.session.id);
    this.emit();
  }

  /** Pauses without ending the recording. What was said so far is flushed to the phone's storage first. */
  pause(): void {
    const p = this.part;
    if (!p || this.paused || this.stopping || p.recorder.state !== "recording") return;
    try { p.recorder.requestData(); } catch { /* the next chunk will carry it */ }
    p.recorder.pause();
    p.activeBefore = this.partMs(p);
    p.runStart = null;
    this.paused = true;
    this.emit();
  }

  resume(): void {
    const p = this.part;
    if (!p || !this.paused || this.stopping) return;
    if (p.recorder.state === "paused") p.recorder.resume();
    p.runStart = Date.now();
    this.paused = false;
    void this.acquireWakeLock().then(() => this.emit());
    this.emit();
  }

  async stop(reason: "stopped" | "interrupted" = "stopped"): Promise<void> {
    if (this.stopping || !this.part) return;
    this.stopping = true;
    this.emit();
    const part = this.part;
    await this.finishPart(part);
    if (reason === "interrupted") await patchSession(part.session.id, { note: "Stopped by an interruption. Everything up to that moment was saved." });
    this.part = null;
    this.paused = false;
    if (this.muteTimer) clearTimeout(this.muteTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.wake?.release().catch(() => {});
    this.wake = null;
    this.stopping = false;
    this.emit();
    this.onEnded(this.finished.splice(0), reason);
  }
}
