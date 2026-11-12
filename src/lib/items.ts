import { resolveDue } from "./dates";
import type { ExtractionResult } from "./extract-schema";

export type ItemRow = {
  recording_id: string;
  user_id: string;
  type: "todo" | "reminder";
  text: string;
  due_at: string | null;
  due_local: string | null;
  said: string | null;
  quote: string | null;
  at_ms: number | null;
  state: "suggested" | "active";
  needs_review: boolean;
  is_test: boolean;
};

/**
 * Turns Claude's items into rows. Clear items become active straight away.
 * Unclear ones, and reminders whose date cannot be pinned down, wait in Review with no alarm.
 */
export function buildItemRows(
  extraction: ExtractionResult,
  rec: { id: string; user_id: string; started_at: string; time_zone: string; is_test?: boolean },
): ItemRow[] {
  return extraction.items
    .filter((i) => i.text.trim())
    .map((i) => {
      let dueAt: string | null = null;
      let review = i.needs_review;
      if (i.type === "reminder") {
        const r = resolveDue(i.due_local, rec.time_zone, rec.started_at);
        dueAt = r.needsReview ? null : r.dueAt;
        review = review || r.needsReview;
      }
      return {
        recording_id: rec.id,
        user_id: rec.user_id,
        type: i.type,
        text: i.text.trim(),
        // An item sent to Review never keeps an alarm.
        due_at: review ? null : dueAt,
        due_local: i.due_local,
        said: i.said,
        quote: i.quote,
        at_ms: i.at_ms === null ? null : Math.max(0, Math.round(i.at_ms)),
        state: review ? "suggested" : "active",
        needs_review: review,
        is_test: rec.is_test ?? false,
      };
    });
}

const FILLER = new Set(["the", "a", "an", "to", "of", "for", "and", "about", "on", "in", "with", "my", "your", "his", "her", "their", "our", "that", "this"]);
const words = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !FILLER.has(w)));

/** Whether two item texts describe the same task, allowing for small rewording between model runs. */
export function sameTask(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  // Same if most of the shorter one appears in the longer one, and they overlap well overall.
  return shared / Math.min(x.size, y.size) >= 0.8 && shared / (x.size + y.size - shared) >= 0.5;
}

/**
 * On a repeat or a redo, the items already on a recording are kept: the owner may have edited,
 * dated, completed or dismissed them. Only genuinely new tasks from the fresh run are added.
 */
export function onlyNewItems<T extends { text: string }>(fresh: T[], existingTexts: string[]): T[] {
  const kept: T[] = [];
  for (const row of fresh) {
    if (existingTexts.some((t) => sameTask(t, row.text))) continue;
    if (kept.some((k) => sameTask(k.text, row.text))) continue;
    kept.push(row);
  }
  return kept;
}
