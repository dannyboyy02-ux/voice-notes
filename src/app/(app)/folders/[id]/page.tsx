"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AddConversations from "@/components/AddConversations";
import { useApp } from "@/components/AppShell";
import ConversationList, { CONVERSATION_COLUMNS, type ConversationRow } from "@/components/ConversationList";
import { BackIcon, ImportIcon, MoreIcon, SearchIcon } from "@/components/icons";
import ImportButton from "@/components/ImportButton";
import { useRecorder } from "@/components/RecorderProvider";
import SearchScreen from "@/components/SearchScreen";
import type { Folder } from "@/lib/types";

/**
 * One folder. Along the top: back, the folder's name, then search (this folder only), import (the file
 * is filed here) and three dots for Add conversations, Rename folder and Delete folder.
 */
export default function FolderPage() {
  const { db, trash } = useApp();
  const { changed } = useRecorder();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [folder, setFolder] = useState<Folder | null | undefined>(undefined);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [panel, setPanel] = useState<"menu" | "add" | "search" | null>(null);

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
  // Reloads on open and whenever an upload (an import made here, say) finishes.
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load, changed]);

  // While something here is still being transcribed, keep its status fresh.
  const busy = rows.some((r) => r.status !== "ready" && r.status !== "failed");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  const back = <Link className="icon-btn" href="/folders" aria-label="Back to folders" data-testid="back"><BackIcon /></Link>;
  if (folder === undefined) return <p className="muted">Loading…</p>;
  if (folder === null) return <><div className="row">{back}<h1>Folder</h1></div><p className="muted">This folder was not found.</p></>;

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
    setPanel(null);
    if (!confirm(`Delete the folder "${folder.name}"? Its ${rows.length} conversation${rows.length === 1 ? "" : "s"} are kept and go back to Home.`)) return;
    const { error } = await db.from("folders").delete().eq("id", id);
    if (error) return setProblem(`Could not delete the folder: ${error.message}`);
    router.push("/folders");
  };

  return (
    <>
      <div className="folder-head">
        {back}
        <h1 data-testid="folder-name">{folder.name}</h1>
        <div className="row">
          <button className="icon-btn" onClick={() => setPanel("search")} aria-label="Search this folder" data-testid="search-button"><SearchIcon /></button>
          <ImportButton className="icon-btn" place="in this folder" folderId={folder.id} onMessage={(text, ok) => setNotice({ text, ok })}><ImportIcon /></ImportButton>
          <button className="icon-btn" onClick={() => setPanel("menu")} aria-label="Folder options" aria-haspopup="dialog" data-testid="folder-options"><MoreIcon /></button>
        </div>
      </div>
      {problem && <div className="banner rec">{problem}</div>}
      {notice && <div className={`banner ${notice.ok ? "ok" : "rec"}`} data-testid="import-message">{notice.text}</div>}
      {renaming !== null && (
        <form className="row" onSubmit={rename}>
          <input className="input" maxLength={60} value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Folder name" autoFocus />
          <button className="btn" disabled={!renaming.trim()}>Save</button>
          <button type="button" className="btn secondary" onClick={() => setRenaming(null)}>Cancel</button>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="muted">Nothing here yet. Tap the three dots and choose Add conversations, or tap the cloud to import an audio file into this folder.</p>
      ) : (
        <section className="card">
          <ConversationList rows={rows} testid="note" showFolder={false} onChanged={load} />
        </section>
      )}

      {panel === "menu" && (
        <div className="sheet-back" onClick={() => setPanel(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={`Options for the folder ${folder.name}`} onClick={(e) => e.stopPropagation()} data-testid="folder-menu">
            <div className="sheet-title">
              <b className="two-line">{folder.name}</b>
              <span className="small muted">{rows.length} conversation{rows.length === 1 ? "" : "s"}</span>
            </div>
            <div className="group">
              <button className="line" onClick={() => setPanel("add")}><span>Add conversations</span><span className="muted">›</span></button>
              <button className="line" onClick={() => { setPanel(null); setProblem(""); setRenaming(folder.name); }}><span>Rename folder</span></button>
              <button className="line danger" onClick={remove}><span>Delete folder</span><span className="muted">Conversations are kept</span></button>
            </div>
            <button className="btn secondary" onClick={() => setPanel(null)}>Close</button>
          </div>
        </div>
      )}
      {panel === "add" && <AddConversations folder={folder} onClose={() => setPanel(null)} onAdded={load} />}
      {panel === "search" && <SearchScreen folder={{ id: folder.id, name: folder.name, recordingIds: rows.map((r) => r.id) }} onClose={() => setPanel(null)} />}
    </>
  );
}
