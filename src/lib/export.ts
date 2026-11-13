/** Plain-text versions of a conversation, for the share sheet and for export. */

export type ExportItem = { text: string; done: boolean; due?: string | null };
export type ExportLine = { speaker: string; start_ms: number; text: string };
export type ExportHead = { title: string | null; dateLabel: string; summary: string | null; items: ExportItem[] };

const stamp = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
};

/** Title, date, summary and action items: what gets shared. */
export function shareText(head: ExportHead): string {
  const out = [head.title ?? "Untitled recording", head.dateLabel];
  if (head.summary) out.push("", head.summary);
  if (head.items.length) {
    out.push("", "Action items");
    for (const i of head.items) out.push(`${i.done ? "[x]" : "[ ]"} ${i.text}${i.due ? ` (${i.due})` : ""}`);
  }
  return out.join("\n");
}

/** The same, followed by the whole transcript with times and speakers: what gets exported. */
export function transcriptText(head: ExportHead, lines: ExportLine[]): string {
  const out = [shareText(head), "", "Transcript"];
  if (!lines.length) out.push("(no transcript yet)");
  for (const l of lines) out.push(`[${stamp(l.start_ms)}] Speaker ${l.speaker}: ${l.text}`);
  return out.join("\n") + "\n";
}

/** A file name that is safe on any phone or computer. */
export function exportFileName(title: string | null, extension: string): string {
  const base = (title ?? "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, " ").slice(0, 60).trim();
  return `${base || "Recording"}.${extension}`;
}
