/**
 * Changes Zeus may only propose: removing an item or marking it done. The server writes a marker into the
 * answer instead of making the change, and the chat shows a button; nothing changes until the owner taps it.
 * The marker brackets are stripped from everything the model writes, so only the server can produce one.
 * Kept free of server imports so the chat screen and the tests can use it.
 */
export type ConfirmAction = "remove" | "complete";
export type ConfirmPart = { kind: "text"; text: string } | { kind: "confirm"; action: ConfirmAction; id: string; raw: string };

const OPEN = "⟦"; // ⟦
const CLOSE = "⟧"; // ⟧
const MARKER = new RegExp(`${OPEN}confirm:(remove|complete):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})${CLOSE}`, "gi");

export const confirmMarker = (action: ConfirmAction, id: string) => `${OPEN}confirm:${action}:${id.toLowerCase()}${CLOSE}`;

/** Removes the marker brackets from model-written text, so a recording or the model cannot forge a marker. */
export const stripMarkerChars = (text: string) => text.replace(/[⟦⟧]/g, "");

/** Splits an answer into its text and the changes waiting for the owner. */
export function splitConfirm(content: string): ConfirmPart[] {
  const parts: ConfirmPart[] = [];
  let at = 0;
  for (const m of content.matchAll(MARKER)) {
    if (m.index > at) parts.push({ kind: "text", text: content.slice(at, m.index) });
    parts.push({ kind: "confirm", action: m[1].toLowerCase() as ConfirmAction, id: m[2].toLowerCase(), raw: m[0] });
    at = m.index + m[0].length;
  }
  // A marker still arriving in the stream is not shown half-written.
  const tail = content.slice(at).replace(/\u27E6[^\u27E7]*$/, "");
  if (tail) parts.push({ kind: "text", text: tail });
  return parts;
}

/** The answer with one waiting change replaced by what became of it, as it is kept in the saved chat. */
export const settleConfirm = (content: string, raw: string, outcome: string) => {
  const at = content.indexOf(raw);
  return at < 0 ? content : content.slice(0, at) + outcome + content.slice(at + raw.length);
};

/** The line kept in the chat once the owner has decided. */
export function outcomeLine(action: ConfirmAction, text: string, confirmed: boolean): string {
  if (!confirmed) return `Not changed: ${text}`;
  return action === "remove" ? `✓ Removed: ${text}` : `✓ Marked done: ${text}`;
}

/** What the tool result tells the model, so it does not claim the change was made. */
export const WAITING_FOR_OWNER =
  "Not done yet. The app is showing the owner a button to confirm this change; it happens only if they tap it. Tell the owner in a few words that it is waiting for their tap, and do not say it is done.";
