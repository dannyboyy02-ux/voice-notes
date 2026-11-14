"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppShell";
import { outcomeLine, splitConfirm, type ConfirmAction } from "@/lib/zeus-confirm";

type Found = { text: string; state: string } | null;

/**
 * A change Zeus proposed and the owner has not decided on. The item's wording is read from the database
 * here, not taken from Zeus's answer, so the card always names the item that would really change. The
 * change is made under the owner's own login, and only when they tap.
 */
function ConfirmChange({ action, id, disabled, onSettle }: { action: ConfirmAction; id: string; disabled: boolean; onSettle: (outcome: string) => void }) {
  const { db, refreshOverdue } = useApp();
  const [item, setItem] = useState<Found | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await db.from("items").select("text, state").eq("id", id).maybeSingle();
      if (live) setItem((data as Found) ?? null);
    })();
    return () => { live = false; };
  }, [db, id]);

  if (item === undefined) return <div className="small muted">Checking…</div>;
  if (item === null) return <div className="small muted" data-testid="zeus-confirm-gone">That item is no longer in your lists.</div>;
  if (action === "remove" ? item.state === "dismissed" : item.state === "done") return <div>{outcomeLine(action, item.text, true)}</div>;

  const verb = action === "remove" ? "Remove" : "Mark done";
  const decide = async (yes: boolean) => {
    setWorking(true);
    setError(null);
    if (yes) {
      // Removal is a soft delete, as everywhere in the app: the row is kept as dismissed.
      const values = action === "remove" ? { state: "dismissed" } : { state: "done", needs_review: false };
      const { error: failed } = await db.from("items").update(values).eq("id", id);
      if (failed) { setError(`Could not change it: ${failed.message}`); setWorking(false); return; }
      refreshOverdue();
    }
    onSettle(outcomeLine(action, item.text, yes));
  };

  return (
    <div className="card" style={{ margin: "8px 0", whiteSpace: "normal" }} data-testid="zeus-confirm">
      <div>{verb}: <b>{item.text}</b>?</div>
      <div className="small muted">Nothing changes until you tap.</div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => void decide(true)} disabled={disabled || working}>{verb}</button>
        <button className="btn small secondary" onClick={() => void decide(false)} disabled={disabled || working}>Keep as is</button>
      </div>
      {error && <div className="small" style={{ color: "var(--rec)" }}>{error}</div>}
    </div>
  );
}

/** One of Zeus's answers: its words, with a card for each change waiting for the owner. */
export default function ZeusAnswer({ content, disabled, onSettle }: { content: string; disabled: boolean; onSettle: (raw: string, outcome: string) => void }) {
  const parts = splitConfirm(content);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "confirm") {
          return <ConfirmChange key={`${i}-${p.raw}`} action={p.action} id={p.id} disabled={disabled} onSettle={(outcome) => onSettle(p.raw, outcome)} />;
        }
        // The line breaks that frame a card are the card's own spacing.
        let text = p.text;
        if (parts[i + 1]?.kind === "confirm") text = text.replace(/\n$/, "");
        if (parts[i - 1]?.kind === "confirm") text = text.replace(/^\n/, "");
        return text ? <span key={i}>{text}</span> : null;
      })}
    </>
  );
}
