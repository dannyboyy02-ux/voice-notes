/** One reminder as handed to the "Add From Voice Notes" Shortcut. */
export type AppleItem = { title: string; due?: string; notes?: string };

export const APPLE_SHORTCUT_NAME = "Add From Voice Notes";
/** Keep links short: Shortcuts URLs with very long text inputs fail to open. */
export const APPLE_MAX_ITEMS = 10;

/**
 * Builds the link the "Send to Apple Reminders" button opens.
 * The Shortcut receives the items as JSON text and adds one reminder per entry.
 */
export function appleRemindersLink(items: AppleItem[]): string {
  const batch = items.slice(0, APPLE_MAX_ITEMS).map((i) => {
    const out: AppleItem = { title: i.title };
    if (i.due) out.due = i.due;
    if (i.notes) out.notes = i.notes;
    return out;
  });
  const text = encodeURIComponent(JSON.stringify(batch));
  const name = encodeURIComponent(APPLE_SHORTCUT_NAME);
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${text}`;
}
