"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import ConversationList from "@/components/ConversationList";
import HomeHeader from "@/components/HomeHeader";
import ImportButton from "@/components/ImportButton";
import { useRecorder } from "@/components/RecorderProvider";
import { shortDay, stamp } from "@/lib/format";
import type { Recording } from "@/lib/types";

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

export default function NotesPage() {
  const { db, trash } = useApp();
  const { changed } = useRecorder();
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);

  const load = useCallback(async () => {
    let q = db.from("recordings").select("*").eq("is_test", false);
    if (trash) q = q.is("deleted_at", null);
    const { data } = await q.order("started_at", { ascending: false }).limit(100);
    setRecordings((data as Recording[]) ?? []);
  }, [db, trash]);
  // Reloads on open and whenever an upload (a recording or an import) finishes.
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load, changed]);

  // While something is still being transcribed, keep its status fresh.
  const busy = recordings?.some((r) => r.status !== "ready" && r.status !== "failed") ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  useEffect(() => {
    const q = query.trim();
    let live = true;
    const t = setTimeout(async () => {
      if (q.length < 2) return setHits(null);
      const { data } = await db.rpc("search_notes", { q });
      if (live) setHits((data as Hit[]) ?? []);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [db, query]);

  return (
    <>
      <HomeHeader action={<ImportButton onMessage={(text, ok) => setNotice({ text, ok })} />} />
      {notice && <div className={`banner ${notice.ok ? "ok" : "rec"}`} data-testid="import-message">{notice.text}</div>}
      <input className="input" type="search" placeholder="Search everything you have said" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="search" />
      {hits ? (
        <section className="card">
          <div className="label">{hits.length} result{hits.length === 1 ? "" : "s"}</div>
          {hits.map((h, i) => (
            <Link key={i} className="item list-link" href={`/notes/${h.recording_id}${h.at_ms !== null ? `?t=${h.at_ms}` : ""}`} data-testid="hit">
              <div>
                <div className="small muted">{h.title ?? "Untitled recording"} • {shortDay(h.started_at)} • {KIND[h.kind] ?? h.kind}{h.at_ms !== null ? ` at ${stamp(h.at_ms)}` : ""}</div>
                <div><Snippet text={h.snippet} /></div>
              </div>
            </Link>
          ))}
          {hits.length === 0 && <p className="muted">No matches.</p>}
        </section>
      ) : !recordings ? (
        <p className="muted">Loading…</p>
      ) : recordings.length === 0 ? (
        <p className="muted">No recordings yet.</p>
      ) : (
        <section className="card">
          <div className="small muted">Swipe left to delete · press and hold for share, folders and export</div>
          <ConversationList rows={recordings} testid="note" onChanged={load} />
        </section>
      )}
    </>
  );
}
