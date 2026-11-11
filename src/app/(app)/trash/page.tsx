"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { eraseRecording, restoreRecording } from "@/lib/client/recordings";

type Trashed = { id: string; title: string | null; started_at: string; deleted_at: string; storage_path: string | null };
const KEEP_DAYS = 30;

export default function TrashPage() {
  const { db, trash } = useApp();
  const [list, setList] = useState<Trashed[] | null>(null);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!trash) return;
    let live = true;
    (async () => {
      const { data } = await db.from("recordings").select("id, title, started_at, deleted_at, storage_path")
        .not("deleted_at", "is", null).eq("is_test", false).order("deleted_at", { ascending: false });
      if (!live) return;
      setList((data as Trashed[]) ?? []);
      setNow(Date.now());
    })();
    return () => { live = false; };
  }, [db, trash]);

  const drop = (id: string) => setList((l) => l?.filter((x) => x.id !== id) ?? null);
  const daysLeft = (deletedAt: string) => Math.max(0, KEEP_DAYS - Math.floor((now - new Date(deletedAt).getTime()) / 86_400_000));

  return (
    <>
      <div className="spread">
        <h1>Trash</h1>
        <Link className="btn small secondary" href="/settings">Back</Link>
      </div>
      {!trash ? (
        <div className="banner">Trash is not switched on yet. Run the newest supabase/setup.sql in Supabase once, then reopen the app. Until then, deleting a recording erases it at once.</div>
      ) : (
        <>
          <p className="small muted">Deleted recordings stay here for {KEEP_DAYS} days, then are erased for good along with their transcript and items.</p>
          {message && <div className="banner">{message}</div>}
          {!list ? (
            <p className="muted">Loading…</p>
          ) : list.length === 0 ? (
            <p className="muted">Trash is empty.</p>
          ) : (
            <section className="card">
              {list.map((r) => (
                <div className="item" key={r.id} data-testid="trashed">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{r.title ?? "Recording"}</div>
                    <div className="small muted">
                      Recorded {new Date(r.started_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} • erased in {daysLeft(r.deleted_at)} days
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="btn small" onClick={async () => { const p = await restoreRecording(db, r.id); if (p) setMessage(p); else drop(r.id); }}>Restore</button>
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (!confirm("Erase this recording for good? This cannot be undone.")) return;
                          const p = await eraseRecording(db, r);
                          if (p) setMessage(p); else drop(r.id);
                        }}
                      >
                        Erase now
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
