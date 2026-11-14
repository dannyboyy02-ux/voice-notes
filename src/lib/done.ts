/**
 * Completed items show under "Done today" until midnight on the phone, then only under "Show earlier",
 * inside their conversation, in search and to Zeus. Nothing is deleted.
 */
export const startOfToday = (now = new Date()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; };

/**
 * True for a completed item that belongs under "Done today". An item read from a database without the
 * done_at column (undefined) counts, so that the screen behaves as it did before until the setup script
 * has been run again.
 */
export function doneToday(item: { state: string; done_at?: string | null }, now = new Date()): boolean {
  if (item.state !== "done") return false;
  if (item.done_at === undefined) return true;
  return item.done_at !== null && new Date(item.done_at).getTime() >= startOfToday(now).getTime();
}

/** Most recently completed first; items without a completion time keep their order, after the rest. */
export const byDoneAt = (a: { done_at?: string | null }, b: { done_at?: string | null }) => (b.done_at ?? "").localeCompare(a.done_at ?? "");
