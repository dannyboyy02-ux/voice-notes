"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { PlusIcon } from "@/components/icons";
import type { Folder } from "@/lib/types";

export default function FoldersPage() {
  const { db, trash, folders } = useApp();
  const [list, setList] = useState<Folder[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unfiled, setUnfiled] = useState(0);
  // null while the new-folder box is closed; the typed name while it is open.
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    if (!folders) return;
    let q = db.from("recordings").select("folder_id").eq("is_test", false);
    if (trash) q = q.is("deleted_at", null);
    const [f, r] = await Promise.all([db.from("folders").select("id, name, created_at").order("name"), q.limit(1000)]);
    const tally: Record<string, number> = {};
    let none = 0;
    for (const row of (r.data as { folder_id: string | null }[]) ?? []) {
      if (row.folder_id) tally[row.folder_id] = (tally[row.folder_id] ?? 0) + 1;
      else none += 1;
    }
    setList((f.data as Folder[]) ?? []);
    setCounts(tally);
    setUnfiled(none);
  }, [db, trash, folders]);
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = (name ?? "").trim();
    if (!clean) return;
    setProblem("");
    const { error } = await db.from("folders").insert({ name: clean });
    if (error) return setProblem(`Could not create the folder: ${error.message}`);
    setName(null);
    await load();
  };

  const count = (n: number) => `${n} conversation${n === 1 ? "" : "s"}`;

  return (
    <>
      <div className="spread">
        <h1>Folders</h1>
        {folders && (
          <button className="icon-btn" onClick={() => { setProblem(""); setName(""); }} aria-label="New folder" data-testid="new-folder"><PlusIcon /></button>
        )}
      </div>
      {!folders ? (
        <div className="banner">Folders are not switched on yet. Run the newest supabase/setup.sql in Supabase once, then reopen the app.</div>
      ) : (
        <>
          {name !== null && (
            <form className="row" onSubmit={create}>
              <input className="input" placeholder="New folder name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="New folder name" autoFocus />
              <button className="btn" disabled={!name.trim()}>Create</button>
              <button type="button" className="btn secondary" onClick={() => { setName(null); setProblem(""); }}>Cancel</button>
            </form>
          )}
          {problem && <div className="banner rec">{problem}</div>}
          {!list ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="group">
              {list.map((f) => (
                <Link className="line" href={`/folders/${f.id}`} key={f.id} data-testid="folder">
                  <span>{f.name}</span><span className="muted">{count(counts[f.id] ?? 0)} ›</span>
                </Link>
              ))}
              <Link className="line" href="/notes"><span className="muted">Not in a folder</span><span className="muted">{count(unfiled)} ›</span></Link>
            </div>
          )}
        </>
      )}
    </>
  );
}
