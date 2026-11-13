"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteRecording } from "@/lib/client/recordings";
import { exportFileName, shareText, transcriptText, type ExportHead, type ExportLine } from "@/lib/export";
import { duration } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/pipeline/steps";
import type { Folder, Recording } from "@/lib/types";
import { useApp } from "./AppShell";
import SwipeToDelete from "./SwipeToDelete";

export type ConversationRow = Pick<Recording, "id" | "title" | "summary" | "started_at" | "duration_ms" | "status" | "part" | "storage_path"> & { speakers?: number | null; folder_id?: string | null };
export const CONVERSATION_COLUMNS = "id, title, summary, started_at, duration_ms, status, part, storage_path, speakers";

const dateLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * A list of conversations. Swipe a row left to delete it; press and hold it for a closer look at it
 * (when, how long, how many speakers, its summary) with Share, Move to folder, Export and Delete beneath.
 */
export default function ConversationList({ rows, testid, showStatus = false, showFolder = true, onChanged }: { rows: ConversationRow[]; testid: string; showStatus?: boolean; /** False inside a folder, where naming the folder on every row says nothing. */ showFolder?: boolean; onChanged: () => void | Promise<void> }) {
  const { db, trash, folders, email } = useApp();
  const [folderList, setFolderList] = useState<Folder[]>([]);
  const [open, setOpen] = useState<ConversationRow | null>(null);
  const [view, setView] = useState<"menu" | "move">("menu");
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  // A share the phone refused because too long had passed since the tap: one more tap finishes it.
  const [pending, setPending] = useState<{ label: string; run: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!folders) return;
    let live = true;
    db.from("folders").select("id, name, created_at").order("name").then(({ data }) => { if (live) setFolderList((data as Folder[]) ?? []); });
    return () => { live = false; };
  }, [db, folders]);

  const close = () => { setOpen(null); setView("menu"); setMessage(""); setPending(null); setNewName(""); };
  const show = (r: ConversationRow) => { setMessage(""); setPending(null); setView("menu"); setOpen(r); };

  /** Runs something that needs the phone's share sheet. A cancel is not an error. */
  const deliver = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
      setPending(null);
    } catch (e) {
      const name = (e as Error).name;
      if (name === "AbortError") return;
      if (name === "NotAllowedError") setPending({ label, run });
      else setMessage(`Could not ${label.toLowerCase()}: ${(e as Error).message}`);
    }
  };

  const head = async (r: ConversationRow): Promise<ExportHead> => {
    const { data } = await db.from("items").select("text, state, due_at").eq("recording_id", r.id).in("state", ["suggested", "active", "done"]).order("created_at");
    const items = ((data as { text: string; state: string; due_at: string | null }[]) ?? []).map((i) => ({ text: i.text, done: i.state === "done", due: i.due_at ? dateLabel(i.due_at) : null }));
    return { title: r.title, dateLabel: dateLabel(r.started_at), summary: r.summary, items };
  };

  const share = async (r: ConversationRow) => {
    setBusy(true);
    const h = await head(r);
    setBusy(false);
    const text = shareText(h);
    if (typeof navigator.share === "function") return deliver("Share", () => navigator.share({ title: h.title ?? "Recording", text }));
    try {
      await navigator.clipboard.writeText(text);
      setMessage("This device has no share sheet, so the summary was copied instead. Paste it where you need it.");
    } catch {
      setMessage("This device has no share sheet and would not allow copying.");
    }
  };

  const exportTranscript = async (r: ConversationRow) => {
    setBusy(true);
    const [h, lines] = await Promise.all([
      head(r),
      db.from("utterances").select("speaker, start_ms, text").eq("recording_id", r.id).order("idx"),
    ]);
    setBusy(false);
    const name = exportFileName(r.title, "txt");
    const blob = new Blob([transcriptText(h, (lines.data as ExportLine[]) ?? [])], { type: "text/plain" });
    const file = new File([blob], name, { type: "text/plain" });
    // On a phone the share sheet is how a file reaches Files, Mail or another app. Elsewhere it downloads.
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      return deliver("Export", () => navigator.share({ files: [file], title: name }));
    }
    saveBlob(blob, name);
    setMessage(`Saved ${name}.`);
  };

  const exportAudio = async (r: ConversationRow) => {
    if (!r.storage_path) return;
    setBusy(true);
    const name = exportFileName(r.title, r.storage_path.split(".").pop() ?? "m4a");
    const { data, error } = await db.storage.from("audio").createSignedUrl(r.storage_path, 300, { download: name });
    setBusy(false);
    if (error || !data) return setMessage("Could not load the audio.");
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMessage("The audio download has started.");
  };

  const move = async (r: ConversationRow, folderId: string | null) => {
    setBusy(true);
    const { error } = await db.from("recordings").update({ folder_id: folderId }).eq("id", r.id);
    setBusy(false);
    if (error) return setMessage(`Could not move it: ${error.message}`);
    close();
    await onChanged();
  };

  const createAndMove = async (r: ConversationRow) => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const { data, error } = await db.from("folders").insert({ name }).select("id, name, created_at").single();
    setBusy(false);
    if (error || !data) return setMessage(`Could not create the folder: ${error?.message ?? "no reply"}`);
    setFolderList((list) => [...list, data as Folder].sort((a, b) => a.name.localeCompare(b.name)));
    await move(r, (data as Folder).id);
  };

  const remove = async (r: ConversationRow) => {
    const failed = await deleteRecording(db, r, trash);
    if (failed) setMessage(`Could not delete: ${failed}`);
    else close();
    await onChanged();
  };

  const folderName = (id: string | null | undefined) => (id ? folderList.find((f) => f.id === id)?.name : undefined);
  const folderLabel = (id: string | null | undefined) => (showFolder ? folderName(id) : undefined);

  return (
    <>
      {rows.map((r) => {
        const title = r.title ?? "Untitled recording";
        const inFolder = folderLabel(r.folder_id);
        return (
          <SwipeToDelete key={r.id} label={r.title ?? "recording"} onLongPress={() => show(r)} onDelete={() => remove(r)}>
            <Link className="item list-link" href={`/notes/${r.id}`} data-testid={testid} draggable={false}>
              <span className="avatar small" aria-hidden="true">{(email[0] ?? "V").toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{title}{r.part > 1 ? ` (part ${r.part})` : ""}</div>
                <div className="small muted">
                  {dateLabel(r.started_at)}
                  {r.duration_ms ? ` · ${duration(r.duration_ms / 1000)}` : ""}
                  {inFolder ? <> · <span data-testid="row-folder">{inFolder}</span></> : null}
                </div>
                {r.summary && <div className="small muted two-line">{r.summary}</div>}
              </div>
              {(showStatus || r.status !== "ready") && (
                <span className={`pill ${r.status === "ready" ? "ok" : r.status === "failed" ? "rec" : ""}`} data-testid="upload-status">{STATUS_LABEL[r.status]}</span>
              )}
            </Link>
          </SwipeToDelete>
        );
      })}

      {open && (
        <div className="sheet-back" onClick={close} data-testid="sheet-back">
          <div className="sheet" role="dialog" aria-modal="true" aria-label={`Options for ${open.title ?? "recording"}`} onClick={(e) => e.stopPropagation()} data-testid="sheet">
            <div className="card peek" data-testid="peek">
              <b className="two-line">{open.title ?? "Untitled recording"}{open.part > 1 ? ` (part ${open.part})` : ""}</b>
              <span className="small muted">
                {dateLabel(open.started_at)}
                {open.duration_ms ? ` · ${duration(open.duration_ms / 1000)}` : ""}
                {open.speakers ? ` · ${open.speakers} speaker${open.speakers === 1 ? "" : "s"}` : ""}
                {folderLabel(open.folder_id) ? ` · ${folderLabel(open.folder_id)}` : ""}
              </span>
              {open.summary ? (
                <p className="small peek-summary">{open.summary}</p>
              ) : (
                <p className="small muted">{open.status === "ready" ? "No summary was written for this one." : `${STATUS_LABEL[open.status]}. Its summary appears here once it is ready.`}</p>
              )}
            </div>
            {message && <div className="banner" data-testid="sheet-message">{message}</div>}
            {pending ? (
              <button className="btn" onClick={() => deliver(pending.label, pending.run)}>Ready. Tap to {pending.label.toLowerCase()}</button>
            ) : view === "menu" ? (
              <div className="group">
                <button className="line" disabled={busy} onClick={() => share(open)}><span>Share</span><span className="muted">Summary and action items</span></button>
                <button className="line" disabled={busy} onClick={() => { setMessage(""); setView("move"); }}><span>Move to folder</span><span className="muted">{folderName(open.folder_id) ?? "›"}</span></button>
                <button className="line" disabled={busy} onClick={() => exportTranscript(open)}><span>Export transcript</span><span className="muted">Text file</span></button>
                <button className="line" disabled={busy || !open.storage_path} onClick={() => exportAudio(open)}><span>Export audio</span><span className="muted">{open.storage_path ? "Original file" : "No longer kept"}</span></button>
                <button className="line danger" disabled={busy} onClick={() => remove(open)}><span>{trash ? "Move to Trash" : "Delete"}</span></button>
              </div>
            ) : !folders ? (
              <div className="banner">Folders are not switched on yet. Run the newest supabase/setup.sql in Supabase once, then reopen the app.</div>
            ) : (
              <>
                <div className="group" data-testid="folder-choices">
                  {folderList.map((f) => (
                    <button className="line" key={f.id} disabled={busy} onClick={() => move(open, f.id)}>
                      <span>{f.name}</span><span className="muted">{open.folder_id === f.id ? "Here now" : ""}</span>
                    </button>
                  ))}
                  {open.folder_id && <button className="line" disabled={busy} onClick={() => move(open, null)}><span>Remove from folder</span></button>}
                  {folderList.length === 0 && <div className="line"><span className="muted">No folders yet. Make the first one below.</span></div>}
                </div>
                <form className="row" onSubmit={(e) => { e.preventDefault(); void createAndMove(open); }}>
                  <input className="input" placeholder="New folder name" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New folder name" />
                  <button className="btn" disabled={busy || !newName.trim()}>Create</button>
                </form>
              </>
            )}
            <button className="btn secondary" onClick={view === "move" && !pending ? () => { setView("menu"); setMessage(""); } : close}>{view === "move" && !pending ? "Back" : "Close"}</button>
          </div>
        </div>
      )}
    </>
  );
}
