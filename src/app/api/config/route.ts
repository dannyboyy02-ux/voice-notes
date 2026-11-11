import { missingEnv } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/** Public settings the phone needs to reach Supabase. The anon key is safe to publish: row-level security does the guarding. */
export function GET() {
  return Response.json(
    {
      supabaseUrl: process.env.SUPABASE_URL?.trim() ?? null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() ?? null,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? null,
      missing: missingEnv(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
