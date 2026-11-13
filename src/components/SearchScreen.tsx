"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { clearSearches, keepSearch, loadSearches } from "@/lib/client/searches";
import { shortDay, stamp } from "@/lib/format";
import { useApp } from "./AppShell";

type Hit = { recording_id: string; title: string | null; started_at: string; kind: string; at_ms: number | null; snippet: string };

const KIND: Record<string, string> = { summary: "Summary", transcript: "Transcript", todo: "To-do", reminder: "Reminder" };

/** The search function marks matches with [[ ]]. Rendered as text, so transcript content can never inject markup. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\[.*?\]\])/g).map((part, i) =>
        part.startsWith("[[") ? <mark key={i}>{part.slice(2, -2)}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

/** The search function returns at most this many matches. */
const MOST = 50;

/**
 * Search, opened from a magnifying glass. It covers the screen, shows results as you type, and lists
 * your recent searches while the box is empty. A search is kept when you press Search, open a result,
 * or leave after it found something. Opened from inside a folder, it searches that folder only.
 */
export default function SearchScreen({ onClose, folder }: { onClose: () => void; folder?: { id: string; name: string; recordingIds: string[] } }) {
  const { db } = useApp();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  // True when an older database could not search the folder itself, so some matches may be missing.
  const [partial, setPartial] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadSearches());
  const folderId = folder?.id;
  const idsKey = folder?.recordingIds.join(",") ?? "";
  const inFolder = useMemo(() => new Set(idsKey ? idsKey.split(",") : []), [idsKey]);

  useEffect(() => {
    const q = query.trim();
    let live = true;
    const t = setTimeout(async () => {
      if (q.length < 2) { setHits(null); setPartial(false); return; }
      let found: Hit[] = [];
      let cut = false;
      const scoped = folderId ? await db.rpc("search_notes", { q, folder: folderId }) : null;
      if (scoped && !scoped.error) {
        found = (scoped.data as Hit[]) ?? [];
      } else {
        const all = (((await db.rpc("search_notes", { q })).data as Hit[]) ?? []);
        // A database set up before folder search existed: search everything and keep this folder's matches.
        found = folderId ? all.filter((h) => inFolder.has(h.recording_id)) : all;
        cut = Boolean(folderId) && all.length >= MOST;
      }
      if (live) { setHits(found); setPartial(cut); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [db, query, folderId, inFolder]);

  // The page behind stays still while search is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = before; };
  }, []);

  const close = () => {
    if (hits?.length) keepSearch(query);
    onClose();
  };

  return (
    <div className="search-screen" role="dialog" aria-modal="true" aria-label={folder ? `Search in ${folder.name}` : "Search"} data-testid="search-screen">
      <div className="search-inner">
        <form className="row" role="search" onSubmit={(e) => { e.preventDefault(); setRecent(keepSearch(query)); }}>
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            autoFocus
            placeholder={folder ? `Search in ${folder.name}` : "Search everything you said"}
            aria-label={folder ? `Search in ${folder.name}` : "Search everything you said"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") close(); }}
            data-testid="search"
          />
          <button type="button" className="btn small secondary" onClick={close}>Cancel</button>
        </form>

        {hits ? (
          <section className="card">
            <div className="label">{hits.length} result{hits.length === 1 ? "" : "s"}</div>
            {hits.map((h, i) => (
              <Link key={i} className="item list-link" href={`/notes/${h.recording_id}${h.at_ms !== null ? `?t=${h.at_ms}` : ""}`} onClick={() => keepSearch(query)} data-testid="hit">
                <div>
                  <div className="small muted">{h.title ?? "Untitled recording"} • {shortDay(h.started_at)} • {KIND[h.kind] ?? h.kind}{h.at_ms !== null ? ` at ${stamp(h.at_ms)}` : ""}</div>
                  <div><Snippet text={h.snippet} /></div>
                </div>
              </Link>
            ))}
            {hits.length === 0 && <p className="muted">{folder ? "No matches in this folder." : "No matches."}</p>}
            {partial && <div className="small muted" data-testid="search-partial">Only the strongest matches were checked, so some in this folder may be missing. Run the newest supabase/setup.sql once to search folders in full.</div>}
          </section>
        ) : recent.length > 0 ? (
          <section className="card">
            <div className="spread">
              <span className="label">Recent searches</span>
              <button className="btn small secondary" onClick={() => setRecent(clearSearches())}>Clear</button>
            </div>
            <div>
              {recent.map((s) => (
                <button key={s} className="recent-search" onClick={() => setQuery(s)} data-testid="recent-search">{s}</button>
              ))}
            </div>
            <div className="small muted">Kept on this phone only.</div>
          </section>
        ) : (
          <p className="muted">{folder ? "Searches the summaries, transcripts, to-dos and reminders in this folder." : "Searches your summaries, transcripts, to-dos and reminders."}</p>
        )}
      </div>
    </div>
  );
}
