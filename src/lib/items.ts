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
