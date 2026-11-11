"use client";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Deletes a recording for good: its audio file, then its row. Its transcript and items go with the row. */
export async function deleteRecording(db: SupabaseClient, rec: { id: string; storage_path: string | null }): Promise<string | null> {
  if (rec.storage_path) await db.storage.from("audio").remove([rec.storage_path]);
  const { error } = await db.from("recordings").delete().eq("id", rec.id);
  return error ? error.message : null;
}
