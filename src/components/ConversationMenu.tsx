"use client";

import { useEffect, useState } from "react";
import { deleteRecording } from "@/lib/client/recordings";
import { exportFileName, shareText, transcriptText, type ExportHead, type ExportLine } from "@/lib/export";
import { duration } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/pipeline/steps";
import type { Folder, Recording } from "@/lib/types";
import { useApp } from "./AppShell";

export type ConversationRow = Pick<Recording, "id" | "title" | "summary" | "started_at" | "duration_ms" | "status" | "part" | "storage_path"> & { speakers?: number | null; folder_id?: string | null };

export const dateLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

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
 * What can be done with one conversation: Share, Copy transcript, Move to folder, Export and Delete.
 * It rises from the foot of the screen. Opened by pressing and holding a row in a list (where it starts
 * with a card about the conversation), or from the three dots on the conversation's own screen.
 */
export default function ConversationMenu({ row, peek = true, showFolder = true, onClose, onChanged, onDeleted }: {
  row: ConversationRow;
  /** The card saying what the conversation is. Left out on the conversation's own screen, which already says it. */
  peek?: boolean;
  showFolder?: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  /** Called after the conversation is deleted, in place of onChanged, by a screen that must then leave. */
  onDeleted?: () => void;
}) {
  const { db, trash, folders } = useApp();
  const [folderList, setFolderList] = useState<Folder[]>([]);
  const [view, setView] = useState<"menu" | "move">("menu");
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  // Something the phone refused because too long had passed since the tap: one more tap finishes it.
  const [pending, setPending] = useState<{ label: string; run: () => Promise<void>; done?: string } | null>(null);

  useEffect(() => {
    if (!folders) return;
    let live = true;
    db.from("folders").select("id, name, created_at").order("name").then(({ data }) => { if (live) setFolderList((data as Folder[]) ?? []); });
    return () => { live = false; };
  }, [db, folders]);

  /** Runs something that needs the phone's share sheet or clipboard. A cancel is not an error. */
  const deliver = async (label: string, run: () => Promise<void>, done?: string) => {
    try {
      await run();
      setPending(null);
      if (done) setMessage(done);
    } catch (e) {
      const name = (e as Error).name;
      if (name === "AbortError") return;
      if (name === "NotAllowedError") setPending({ label, run, done });
      else setMessage(`Could not ${label.toLowerCase()}: ${(e as Error).message}`);
    }
  };

  const head = async (): Promise<ExportHead> => {
    const { data } = await db.from("items").select("text, state, due_at").eq("recording_id", row.id).in("state", ["suggested", "active", "done"]).order("created_at");
    const items = ((data as { text: string; state: string; due_at: string | null }[]) ?? []).map((i) => ({ text: i.text, done: i.state === "done", due: i.due_at ? dateLabel(i.due_at) : null }));
    return { title: row.title, dateLabel: dateLabel(row.started_at), summary: row.summary, items };
  };
  const transcript = async (): Promise<{ h: ExportHead; text: string }> => {
    const [h, lines] = await Promise.all([head(), db.from("utterances").select("speaker, start_ms, text").eq("recording_id", row.id).order("idx")]);
    return { h, text: transcriptText(h, (lines.data as ExportLine[]) ?? []) };
  };

  const share = async () => {
    setBusy(true);
    const h = await head();
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

  const copyTranscript = async () => {
    setBusy(true);
    const { text } = await transcript();
    setBusy(false);
    // Fetching the transcript takes a moment, and a phone may then want a fresh tap before it lets anything be copied.
    return deliver("Copy", () => navigator.clipboard.writeText(text), "Transcript copied. Paste it where you need it.");
  };

  const exportTranscript = async () => {
    setBusy(true);
    const { text } = await transcript();
    setBusy(false);
    const name = exportFileName(row.title, "txt");
    const blob = new Blob([text], { type: "text/plain" });
    const file = new File([blob], name, { type: "text/plain" });
    // On a phone the share sheet is how a file reaches Files, Mail or another app. Elsewhere it downloads.
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      return deliver("Export", () => navigator.share({ files: [file], title: name }));
    }
    saveBlob(blob, name);
    setMessage(`Saved ${name}.`);
  };

  const exportAudio = async () => {
    if (!row.storage_path) return;
    setBusy(true);
    const name = exportFileName(row.title, row.storage_path.split(".").pop() ?? "m4a");
    const { data, error } = await db.storage.from("audio").createSignedUrl(row.storage_path, 300, { download: name });
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

  const move = async (folderId: string | null) => {
    setBusy(true);
    const { error } = await db.from("recordings").update({ folder_id: folderId }).eq("id", row.id);
    setBusy(false);
    if (error) return setMessage(`Could not move it: ${error.message}`);
    onClose();
    await onChanged();
  };

  const createAndMove = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const { data, error } = await db.from("folders").insert({ name }).select("id, name, created_at").single();
    setBusy(false);
    if (error || !data) return setMessage(`Could not create the folder: ${error?.message ?? "no reply"}`);
    await move((data as Folder).id);
  };

  const remove = async () => {
    const failed = await deleteRecording(db, row, trash);
    if (failed) return setMessage(`Could not delete: ${failed}`);
    onClose();
    if (onDeleted) onDeleted();
    else await onChanged();
  };

  const folderName = (id: string | null | undefined) => (id ? folderList.find((f) => f.id === id)?.name : undefined);
  const title = row.title ?? "Untitled recording";

  return (
    <div className="sheet-back" onClick={onClose} data-testid="sheet-back">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Options for ${row.title ?? "recording"}`} onClick={(e) => e.stopPropagation()} data-testid="sheet">
        {peek ? (
          <div className="card peek" data-testid="peek">
            <b className="two-line">{title}{row.part > 1 ? ` (part ${row.part})` : ""}</b>
            <span className="small muted">
              {dateLabel(row.started_at)}
              {row.duration_ms ? ` · ${duration(row.duration_ms / 1000)}` : ""}
              {row.speakers ? ` · ${row.speakers} speaker${row.speakers === 1 ? "" : "s"}` : ""}
              {showFolder && folderName(row.folder_id) ? ` · ${folderName(row.folder_id)}` : ""}
            </span>
            {row.summary ? (
              <p className="small peek-summary">{row.summary}</p>
            ) : (
              <p className="small muted">{row.status === "ready" ? "No summary was written for this one." : `${STATUS_LABEL[row.status]}. Its summary appears here once it is ready.`}</p>
            )}
          </div>
        ) : (
          <div className="sheet-title"><b className="two-line">{title}</b></div>
        )}
        {message && <div className="banner" data-testid="sheet-message">{message}</div>}
        {pending ? (
          <button className="btn" onClick={() => deliver(pending.label, pending.run, pending.done)}>Ready. Tap to {pending.label.toLowerCase()}</button>
        ) : view === "menu" ? (
          <div className="group">
            <button className="line" disabled={busy} onClick={share}><span>Share</span><span className="muted">Summary and action items</span></button>
            <button className="line" disabled={busy} onClick={copyTranscript}><span>Copy transcript</span></button>
            <button className="line" disabled={busy} onClick={() => { setMessage(""); setView("move"); }}><span>Move to folder</span><span className="muted">{folderName(row.folder_id) ?? "›"}</span></button>
            <button className="line" disabled={busy} onClick={exportTranscript}><span>Export transcript</span><span className="muted">Text file</span></button>
            <button className="line" disabled={busy || !row.storage_path} onClick={exportAudio}><span>Export audio</span><span className="muted">{row.storage_path ? "Original file" : "No longer kept"}</span></button>
            <button className="line danger" disabled={busy} onClick={remove}><span>{trash ? "Move to Trash" : "Delete"}</span></button>
          </div>
        ) : !folders ? (
          <div className="banner">Folders are not switched on yet. Run the newest supabase/setup.sql in Supabase once, then reopen the app.</div>
        ) : (
          <>
            <div className="group" data-testid="folder-choices">
              {folderList.map((f) => (
                <button className="line" key={f.id} disabled={busy} onClick={() => move(f.id)}>
                  <span>{f.name}</span><span className="muted">{row.folder_id === f.id ? "Here now" : ""}</span>
                </button>
              ))}
              {row.folder_id && <button className="line" disabled={busy} onClick={() => move(null)}><span>Remove from folder</span></button>}
              {folderList.length === 0 && <div className="line"><span className="muted">No folders yet. Make the first one below.</span></div>}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); void createAndMove(); }}>
              <input className="input" placeholder="New folder name" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New folder name" />
              <button className="btn" disabled={busy || !newName.trim()}>Create</button>
            </form>
          </>
        )}
        <button className="btn secondary" onClick={view === "move" && !pending ? () => { setView("menu"); setMessage(""); } : onClose}>{view === "move" && !pending ? "Back" : "Close"}</button>
      </div>
    </div>
  );
}
