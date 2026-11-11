"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type PublicConfig = { supabaseUrl: string | null; supabaseAnonKey: string | null; vapidPublicKey: string | null; missing: string[] };

let configPromise: Promise<PublicConfig> | null = null;
export function getConfig(): Promise<PublicConfig> {
  configPromise ??= fetch("/api/config", { cache: "no-store" }).then((r) => r.json() as Promise<PublicConfig>);
  configPromise.catch(() => (configPromise = null));
  return configPromise;
}

let client: SupabaseClient | null = null;
/** The browser client. It holds only the publishable key; row-level security limits it to the signed-in owner's rows. */
export async function getSupabase(): Promise<SupabaseClient> {
  if (client) return client;
  const cfg = await getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("The app is not connected to Supabase yet.");
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "voice-notes-auth" },
  });
  return client;
}

export async function accessToken(): Promise<string> {
  const { data } = await (await getSupabase()).auth.getSession();
  if (!data.session) throw new Error("Not signed in");
  return data.session.access_token;
}

/** Calls one of this app's own server routes as the signed-in owner. */
export async function api<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
}
