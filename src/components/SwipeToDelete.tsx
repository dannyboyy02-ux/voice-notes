"use client";

import { useRef, useState } from "react";

const OPEN = 92;

const HOLD_MS = 500;

/**
 * A list row that slides left to reveal a Delete button. Vertical scrolling is left alone.
 * With onLongPress, holding the row still for half a second (or a right-click) calls it instead of opening the row.
 */
export default function SwipeToDelete({ children, onDelete, label, onLongPress }: { children: React.ReactNode; onDelete: () => void | Promise<void>; label: string; onLongPress?: () => void }) {
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; base: number; moved: boolean; locked: boolean } | null>(null);
  // Letting go of a swipe also produces a click on the row. That click must be swallowed, not treated as a tap.
  const justSwiped = useRef(false);
  // A hold has fired: the click that follows letting go must not open the row.
  const held = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; };

  const down = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, base: offset, moved: false, locked: false };
    held.current = false;
    cancelHold();
    if (onLongPress && offset === 0 && e.button === 0) {
      holdTimer.current = setTimeout(() => { holdTimer.current = null; drag.current = null; held.current = true; onLongPress(); }, HOLD_MS);
    }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      cancelHold();
      // A mostly vertical move is a scroll, not a swipe.
      if (Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      d.locked = true;
    }
    d.moved = true;
    setDragging(true);
    setOffset(Math.max(-OPEN, Math.min(0, d.base + dx)));
  };
  const up = () => {
    cancelHold();
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d?.moved) {
      justSwiped.current = true;
      setTimeout(() => { justSwiped.current = false; }, 350);
      setOffset((o) => (o < -OPEN / 2 ? -OPEN : 0));
    }
  };

  return (
    <div className="swipe" data-testid="swipe-row">
      <button
        className="swipe-delete"
        aria-label={`Delete ${label}`}
        tabIndex={offset ? 0 : -1}
        disabled={busy}
        onClick={async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); setOffset(0); } }}
      >
        {busy ? "…" : "Delete"}
      </button>
      <div
        className="swipe-front"
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? "none" : "transform 0.18s ease" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // A swipe must not also open the row's link; a tap on an open row closes it.
        onContextMenu={(e) => {
          if (!onLongPress) return;
          // The phone's own long-press menu (link preview, copy) gives way to the app's.
          e.preventDefault();
          cancelHold();
          if (!held.current) { held.current = true; onLongPress(); }
        }}
        onClickCapture={(e) => {
          if (held.current) { held.current = false; e.preventDefault(); e.stopPropagation(); return; }
          if (justSwiped.current) { justSwiped.current = false; e.preventDefault(); e.stopPropagation(); return; }
          if (offset !== 0) { e.preventDefault(); e.stopPropagation(); setOffset(0); }
        }}
      >
        {children}
      </div>
    </div>
  );
}
