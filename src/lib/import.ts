/** Importing an audio file made elsewhere (an export from another notes app, a voice memo). */

/** The audio bucket takes files up to 50 MB (the Supabase Free limit for one file). */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;

const BY_EXTENSION: Record<string, string> = {
  m4a: "audio/mp4", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", flac: "audio/flac",
};
const BY_TYPE: Record<string, string> = {
  "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "video/mp4": "video/mp4",
  "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav", "audio/aac": "audio/aac", "audio/ogg": "audio/ogg", "audio/webm": "audio/webm",
  "audio/flac": "audio/flac", "audio/x-flac": "audio/flac",
};

/**
 * The format a picked file is stored as, or null when it is not audio this app can take.
 * The file name wins over the browser's guess: iPhone often reports no type at all for files from the Files app.
 */
export function audioKind(name: string, type: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext];
  return BY_TYPE[type.split(";")[0].trim().toLowerCase()] ?? null;
}

/** Why a file cannot be imported, in plain words, or null when it can. */
export function importProblem(file: { name: string; type: string; size: number }): string | null {
  if (!audioKind(file.name, file.type)) return `"${file.name}" is not an audio file this app can read. Use m4a, mp3, wav, aac, ogg, webm, flac or mp4.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > IMPORT_MAX_BYTES) return `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit for one file is 50 MB; export it at a lower quality or split it.`;
  return null;
}

/** When the conversation took place, as far as a file can say: its modified time if that is believable, otherwise now. */
export function importStartedAt(lastModified: number, now: number): string {
  const tenYears = 10 * 365 * 86_400_000;
  return new Date(lastModified > now - tenYears && lastModified <= now ? lastModified : now).toISOString();
}
