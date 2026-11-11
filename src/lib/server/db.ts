import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { need } from "./env";

let admin: SupabaseClient | null = null;
/** Service-role client. Bypasses row-level security, so it is used only in server routes. */
export function adminDb(): SupabaseClient {
  admin ??= createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export const AUDIO_BUCKET = "audio";
