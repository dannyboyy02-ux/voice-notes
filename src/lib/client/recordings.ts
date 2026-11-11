"use client";
import type { SupabaseClient } from "@supabase/supabase-js";

type Rec = { id: string; storage_path: string | null };

/**
 * Deleting a recording. With Trash available it is only marked deleted and can be restored for 30 days;
 * on a database without the Trash column it is erased at once.
 */
export async function deleteRecording(db: SupabaseClient, rec: Rec, trash: boolean): Promise<string | null> {
  if (trash) {
    const { error } = await db.from("recordings").update({ deleted_at: new Date().toISOString() }).eq("id", rec.id);
    return error ? error.message : null;
  }
  return eraseRecording(db, rec);
}

export async function restoreRecording(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("recordings").update({ deleted_at: null }).eq("id", id);
  return error ? error.message : null;
}

/** Erases a recording for good: its audio file, then its row. Its transcript and items go with the row. */
export async function eraseRecording(db: SupabaseClient, rec: Rec): Promise<string | null> {
  if (rec.storage_path) await db.storage.from("audio").remove([rec.storage_path]);
  const { error } = await db.from("recordings").delete().eq("id", rec.id);
  return error ? error.message : null;
}
