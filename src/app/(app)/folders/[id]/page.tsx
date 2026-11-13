"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import ConversationList, { CONVERSATION_COLUMNS, type ConversationRow } from "@/components/ConversationList";
import type { Folder } from "@/lib/types";

export default function FolderPage() {
  const { db, trash } = useApp();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    let q = db.from("recordings").select(`${CONVERSATION_COLUMNS}, folder_id`).eq("is_test", false).eq("folder_id", id);
    if (trash) q = q.is("deleted_at", null);
    const [f, r] = await Promise.all([
      db.from("folders").select("id, name, created_at").eq("id", id).maybeSingle(),
      q.order("started_at", { ascending: false }).limit(200),
    ]);
    setFolder((f.data as Folder) ?? null);
    setRows((r.data as unknown as ConversationRow[]) ?? []);
  }, [db, trash, id]);
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load]);

  const back = <Link className="btn small secondary" href="/folders">Back</Link>;
  if (folder === undefined) return <p className="muted">Loading…</p>;
  if (folder === null) return <><div className="spread"><h1>Folder</h1>{back}</div><p className="muted">This folder was not found.</p></>;

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = (renaming ?? "").trim();
    if (!clean) return;
    const { error } = await db.from("folders").update({ name: clean }).eq("id", id);
    if (error) return setProblem(`Could not rename: ${error.message}`);
    setRenaming(null);
    await load();
  };
  const remove = async () => {
    if (!confirm(`Delete the folder "${folder.name}"? Its ${rows.length} conversation${rows.length === 1 ? "" : "s"} are kept and go back to Home.`)) return;
    const { error } = await db.from("folders").delete().eq("id", id);
    if (error) return setProblem(`Could not delete the folder: ${error.message}`);
    router.push("/folders");
  };

  return (
    <>
      <div className="spread">
        <h1 data-testid="folder-name">{folder.name}</h1>
        {back}
      </div>
      {problem && <div className="banner rec">{problem}</div>}
      {renaming !== null ? (
        <form className="row" onSubmit={rename}>
          <input className="input" maxLength={60} value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Folder name" autoFocus />
          <button className="btn" disabled={!renaming.trim()}>Save</button>
          <button type="button" className="btn secondary" onClick={() => setRenaming(null)}>Cancel</button>
        </form>
      ) : (
        <div className="row">
          <button className="btn small secondary" onClick={() => setRenaming(folder.name)}>Rename</button>
          <button className="btn small secondary" onClick={remove}>Delete folder</button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="muted">Nothing here yet. Press and hold a conversation on Home and choose Move to folder.</p>
      ) : (
        <section className="card">
          <ConversationList rows={rows} testid="note" onChanged={load} />
        </section>
      )}
    </>
  );
}
