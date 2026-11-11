import { requireOwner } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/db";
import { appUrl, missingEnv } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/** Called on every app open: confirms the owner, tells the scheduler where the app lives, reports server health. */
export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const db = adminDb();
  const set = await db.rpc("set_app_url", { p_url: appUrl(req) });
  const state = await db.rpc("scheduler_state");
  return Response.json({
    ok: true,
    userId: owner.userId,
    missing: missingEnv(),
    databaseReady: !set.error && !state.error,
    databaseError: set.error?.message ?? state.error?.message ?? null,
    scheduler: state.data ?? null,
  });
}
