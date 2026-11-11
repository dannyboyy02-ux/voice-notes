/** Plain-text material Zeus is given. Kept free of server imports so it can be tested. */
export type CtxRecording = { id: string; title: string | null; summary: string | null; started_at: string; time_zone: string; duration_ms: number | null };
export type CtxLine = { recording_id: string; speaker: string; start_ms: number; text: string };
export type CtxItem = { id: string; recording_id: string | null; type: string; text: string; due_at: string | null; state: string; said: string | null };

const stamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function when(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function itemLine(i: CtxItem, timeZone: string): string {
  const due = i.due_at ? ` (due ${when(i.due_at, timeZone)})` : i.said ? ` (said: "${i.said}", no date set)` : "";
  return `- [${i.state}] ${i.type}: ${i.text}${due} (id: ${i.id})`;
}

/** One recording: header, summary, items, and either its full transcript or only the matching lines. */
export function formatRecording(rec: CtxRecording, items: CtxItem[], lines: CtxLine[], full: boolean): string {
  const mine = items.filter((i) => i.recording_id === rec.id);
  const said = lines.filter((l) => l.recording_id === rec.id).sort((a, b) => a.start_ms - b.start_ms);
  const parts = [
    `<recording id="${rec.id}">`,
    `Title: ${rec.title ?? "Untitled"}`,
    `Recorded: ${when(rec.started_at, rec.time_zone)}${rec.duration_ms ? `, ${Math.max(1, Math.round(rec.duration_ms / 60000))} min` : ""}`,
    `Summary: ${rec.summary ?? "none"}`,
  ];
  if (mine.length) parts.push("Items:", ...mine.map((i) => itemLine(i, rec.time_zone)));
  if (said.length) {
    parts.push(full ? "Transcript:" : "Matching transcript lines:");
    parts.push(...said.map((l) => `[${stamp(l.start_ms)}] Speaker ${l.speaker}: ${l.text}`));
  }
  parts.push("</recording>");
  return parts.join("\n");
}

/** Items the owner added by hand or through Zeus, which belong to no recording. */
export function formatLooseItems(items: CtxItem[], timeZone: string): string {
  const loose = items.filter((i) => !i.recording_id);
  return loose.length ? ["<items-without-a-recording>", ...loose.map((i) => itemLine(i, timeZone)), "</items-without-a-recording>"].join("\n") : "";
}

/** Words worth searching for in a question. */
export function searchTerms(question: string): string {
  const stop = new Set(["the", "and", "for", "that", "this", "with", "what", "when", "where", "who", "why", "how", "did", "does", "was", "were", "are", "about", "from", "have", "has", "had", "you", "your", "can", "could", "would", "should", "tell", "say", "said", "any", "all", "our", "they", "them", "there", "not"]);
  const words = (question.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []).filter((w) => !stop.has(w));
  return [...new Set(words)].slice(0, 8).join(" or ");
}
