/**
 * Stopping a recording that has gone quiet: a meeting ended and nobody tapped stop.
 * The choice is kept on this phone, like the look, so it needs no database change.
 */

export const QUIET_KEY = "voice-notes-quiet-stop";
/** Minutes of no talking before a recording stops. 0 means never. */
export const QUIET_CHOICES = [0, 5, 10, 15, 30] as const;
export const QUIET_DEFAULT_MINUTES = 10;

export function readQuietMinutes(): number {
  try {
    const raw = localStorage.getItem(QUIET_KEY);
    if (raw === null) return QUIET_DEFAULT_MINUTES;
    const n = Number(raw);
    // Any value from 0 to 2 hours is honoured (the browser tests use a few seconds); anything else falls back.
    return Number.isFinite(n) && n >= 0 && n <= 120 ? n : QUIET_DEFAULT_MINUTES;
  } catch {
    return QUIET_DEFAULT_MINUTES;
  }
}
export function saveQuietMinutes(minutes: number): void {
  try { localStorage.setItem(QUIET_KEY, String(minutes)); } catch { /* applies to this visit only */ }
}

/** The warning before an automatic stop: a minute, or a third of the limit when that is shorter. */
export function warnWindowMs(limitMs: number): number {
  return Math.min(60_000, limitMs / 3);
}

/** Loudness of one block of samples, in decibels below full scale. Null when every sample is exactly zero. */
export function levelDb(samples: ArrayLike<number>): number | null {
  let sum = 0;
  let any = false;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s !== 0) any = true;
    sum += s * s;
  }
  // A real microphone always carries some noise. Pure zeros mean the audio is not reaching us
  // (a suspended audio engine), and that must never be mistaken for a quiet room.
  if (!any || !samples.length) return null;
  return 10 * Math.log10(sum / samples.length);
}

/**
 * Decides whether someone is talking, against a background level it learns as it goes.
 * The background follows quiet stretches down at once and drifts up slowly, so a steady hum
 * (air conditioning, a fan) becomes the new quiet, while speech stands clearly above it.
 */
export class QuietDetector {
  private floor: number | null = null;
  /** When sound was last heard, or when listening began. */
  private lastSound: number;

  constructor(now: number, private readonly riseDbPerSecond = 0.05, private readonly marginDb = 10, private readonly minSpeechDb = -50) {
    this.lastSound = now;
  }

  /** Feeds one measurement. Returns true when it counts as sound. */
  hear(db: number | null, now: number, sinceLastMs: number): boolean {
    if (db === null) {
      // No real measurement: do not let this count towards an automatic stop.
      this.lastSound = now;
      return false;
    }
    if (this.floor === null || db < this.floor) this.floor = db;
    else this.floor = Math.min(db, this.floor + (this.riseDbPerSecond * sinceLastMs) / 1000);
    const sound = db > Math.max(this.floor + this.marginDb, this.minSpeechDb);
    if (sound) this.lastSound = now;
    return sound;
  }

  /** Starts the quiet count again: after a pause, or when the owner taps Keep recording. */
  reset(now: number): void {
    this.lastSound = now;
  }

  quietMs(now: number): number {
    return Math.max(0, now - this.lastSound);
  }

  get background(): number | null {
    return this.floor;
  }
}
