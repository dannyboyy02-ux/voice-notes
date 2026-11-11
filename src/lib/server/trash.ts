import "server-only";
import { adminDb } from "./db";

let known = false;
/** True once the database has the Trash column (added by a newer supabase/setup.sql). */
export async function hasTrash(): Promise<boolean> {
  if (known) return true;
  const probe = await adminDb().from("recordings").select("deleted_at").limit(1);
  known = !probe.error;
  return known;
}
