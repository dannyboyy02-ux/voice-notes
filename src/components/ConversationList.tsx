"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteRecording } from "@/lib/client/recordings";
import { duration } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/pipeline/steps";
import type { Folder } from "@/lib/types";
import { useApp } from "./AppShell";
import ConversationMenu, { dateLabel, type ConversationRow } from "./ConversationMenu";
import SwipeToDelete from "./SwipeToDelete";

export type { ConversationRow } from "./ConversationMenu";
export const CONVERSATION_COLUMNS = "id, title, summary, started_at, duration_ms, status, part, storage_path, speakers";

/**
 * A list of conversations. Swipe a row left to delete it; press and hold it for a closer look at it
 * (when, how long, how many speakers, its summary) with Share, Copy, Move to folder, Export and Delete beneath.
 */
export default function ConversationList({ rows, testid, showStatus = false, showFolder = true, onChanged }: { rows: ConversationRow[]; testid: string; showStatus?: boolean; /** False inside a folder, where naming the folder on every row says nothing. */ showFolder?: boolean; onChanged: () => void | Promise<void> }) {
  const { db, trash, folders, email } = useApp();
  const [folderList, setFolderList] = useState<Folder[]>([]);
  // Goes up when the menu may have made or renamed a folder, so the names shown on rows are read again.
  const [folderTick, setFolderTick] = useState(0);
  const [open, setOpen] = useState<ConversationRow | null>(null);

  useEffect(() => {
    if (!folders) return;
    let live = true;
    db.from("folders").select("id, name, created_at").order("name").then(({ data }) => { if (live) setFolderList((data as Folder[]) ?? []); });
    return () => { live = false; };
  }, [db, folders, folderTick]);

  const remove = async (r: ConversationRow) => {
    await deleteRecording(db, r, trash);
    await onChanged();
  };

  const folderLabel = (id: string | null | undefined) => (showFolder && id ? folderList.find((f) => f.id === id)?.name : undefined);

  return (
    <>
      {rows.map((r) => {
        const title = r.title ?? "Untitled recording";
        const inFolder = folderLabel(r.folder_id);
        return (
          <SwipeToDelete key={r.id} label={r.title ?? "recording"} onLongPress={() => setOpen(r)} onDelete={() => remove(r)}>
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
        <ConversationMenu
          row={open}
          showFolder={showFolder}
          onClose={() => setOpen(null)}
          onChanged={async () => { setFolderTick((n) => n + 1); await onChanged(); }}
        />
      )}
    </>
  );
}
