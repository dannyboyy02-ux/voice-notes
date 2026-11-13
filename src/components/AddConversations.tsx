"use client";

import { useEffect, useState } from "react";
import { duration } from "@/lib/format";
import type { Folder } from "@/lib/types";
import { useApp } from "./AppShell";

type Row = { id: string; title: string | null; started_at: string; duration_ms: number | null; folder_id: string | null };

const dateLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Picks conversations to put in a folder. It lists every conversation that is not already in it,
 * newest first. A conversation sits in one folder at a time, so one picked from another folder moves.
 */
export default function AddConversations({ folder, onClose, onAdded }: { folder: Folder; onClose: () => void; onAdded: () => void | Promise<void> }) {
  const { db, trash } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      let q = db.from("recordings").select("id, title, started_at, duration_ms, folder_id").eq("is_test", false);
      if (trash) q = q.is("deleted_at", null);
      const [r, f] = await Promise.all([q.order("started_at", { ascending: false }).limit(300), db.from("folders").select("id, name")]);
      if (!live) return;
      setRows(((r.data as Row[]) ?? []).filter((x) => x.folder_id !== folder.id));
      setNames(Object.fromEntries(((f.data as { id: string; name: string }[]) ?? []).map((x) => [x.id, x.name])));
    })();
    return () => { live = false; };
  }, [db, trash, folder.id]);

  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const add = async () => {
    if (!picked.length) return;
    setBusy(true);
    setProblem("");
    const { error } = await db.from("recordings").update({ folder_id: folder.id }).in("id", picked);
    setBusy(false);
    if (error) return setProblem(`Could not add them: ${error.message}`);
    await onAdded();
    onClose();
  };

  const needle = filter.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !needle || (r.title ?? "untitled recording").toLowerCase().includes(needle));

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Add conversations to ${folder.name}`} onClick={(e) => e.stopPropagation()} data-testid="add-sheet">
        <div className="sheet-title">
          <b className="two-line">Add conversations to {folder.name}</b>
          <span className="small muted">A conversation sits in one folder at a time, so one from another folder moves here.</span>
        </div>
        {problem && <div className="banner rec">{problem}</div>}
        {!rows ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Every conversation is already in this folder.</p>
        ) : (
          <>
            {rows.length > 8 && <input className="input" type="search" placeholder="Filter by title" aria-label="Filter by title" value={filter} onChange={(e) => setFilter(e.target.value)} />}
            <div className="group" data-testid="add-choices">
              {shown.map((r) => (
                <label className="line pick" key={r.id}>
                  <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                  <span>
                    <span className="two-line">{r.title ?? "Untitled recording"}</span>
                    <span className="small muted">
                      {dateLabel(r.started_at)}
                      {r.duration_ms ? ` · ${duration(r.duration_ms / 1000)}` : ""}
                      {r.folder_id && names[r.folder_id] ? ` · now in ${names[r.folder_id]}` : ""}
                    </span>
                  </span>
                </label>
              ))}
              {shown.length === 0 && <div className="line"><span className="muted">No title matches.</span></div>}
            </div>
          </>
        )}
        <div className="row sheet-foot">
          <button className="btn" style={{ flex: 1 }} disabled={busy || picked.length === 0} onClick={add}>{busy ? "Adding…" : picked.length ? `Add ${picked.length}` : "Add"}</button>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
