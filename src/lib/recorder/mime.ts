/** Formats in preference order. iPhone Safari records audio/mp4; Chromium records webm/opus. */
export const MIME_CANDIDATES = [
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

export const TARGET_BITS_PER_SECOND = 48_000;
/** Supabase Free caps one file at 50 MB. Roll to a new part before that. */
export const PART_BYTE_CAP = 45 * 1024 * 1024;
export const CHUNK_MS = 5_000;

export function pickMimeType(isSupported: (t: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find((t) => isSupported(t));
}

export function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.startsWith("audio/webm")) return "webm";
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  // Formats that only arrive by import.
  if (mimeType.startsWith("audio/mpeg")) return "mp3";
  if (mimeType.startsWith("audio/wav")) return "wav";
  if (mimeType.startsWith("audio/aac")) return "aac";
  if (mimeType.startsWith("audio/flac")) return "flac";
  if (mimeType.startsWith("video/mp4")) return "mp4";
  return "bin";
}

/** Seconds of recording left in this part at the measured byte rate. */
export function secondsLeft(bytes: number, elapsedMs: number, cap = PART_BYTE_CAP): number | null {
  if (elapsedMs < 4_000 || bytes <= 0) return null;
  const bytesPerSecond = bytes / (elapsedMs / 1000);
  return Math.max(0, Math.floor((cap - bytes) / bytesPerSecond));
}
