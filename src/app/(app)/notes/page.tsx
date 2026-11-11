"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { duration, stamp } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/pipeline/steps";
import type { Recording } from "@/lib/types";

type Hit = { recording_id: string; title: string | null; started_at: string; kind: string; at_ms: number | null; snippet: string };

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
  const { db } = useApp();
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await db.from("recordings").select("*").eq("is_test", false).order("started_at", { ascending: false }).limit(100);
      if (live) setRecordings((data as Recording[]) ?? []);
    })();
    return () => { live = false; };
  }, [db]);

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
      <h1>Notes</h1>
      <input className="input" type="search" placeholder="Search everything you have said" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="search" />
      {hits ? (
        <section className="card">
          <div className="label">{hits.length} result{hits.length === 1 ? "" : "s"}</div>
          {hits.map((h, i) => (
            <Link key={i} className="item list-link" href={`/notes/${h.recording_id}${h.at_ms !== null ? `?t=${h.at_ms}` : ""}`} data-testid="hit">
              <div>
                <div className="small muted">{h.title ?? "Recording"} · {new Date(h.started_at).toLocaleDateString()} · {h.kind}{h.at_ms !== null ? ` at ${stamp(h.at_ms)}` : ""}</div>
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
          {recordings.map((r) => (
            <Link key={r.id} className="item list-link" href={`/notes/${r.id}`} data-testid="note">
              <div style={{ flex: 1 }}>
                <div>{r.title ?? "Recording"}{r.part > 1 ? ` (part ${r.part})` : ""}</div>
                <div className="small muted">
                  {new Date(r.started_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                  {r.duration_ms ? ` · ${duration(r.duration_ms / 1000)}` : ""}
                </div>
              </div>
              {r.status !== "ready" && <span className={`pill ${r.status === "failed" ? "rec" : ""}`}>{STATUS_LABEL[r.status]}</span>}
            </Link>
          ))}
        </section>
      )}
    </>
  );
}
