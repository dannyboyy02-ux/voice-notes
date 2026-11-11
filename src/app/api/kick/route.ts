import { after } from "next/server";
import { requireOwner } from "@/lib/server/auth";
import { missingEnv } from "@/lib/server/env";
import { runUntilIdle } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called by the phone right after an upload is confirmed, so processing starts at once
 * instead of at the scheduler's next minute. It runs the same worker passes the scheduler runs,
 * a few seconds apart, until nothing of the owner's is in flight. Every step is still claimed
 * atomically in the database, so this and the scheduler can overlap safely; the scheduler
 * remains the safety net for retries and for anything this misses.
 */
export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const missing = missingEnv();
  if (missing.length) return Response.json({ error: "server_not_configured", missing }, { status: 503 });

  after(() => runUntilIdle(owner.userId).then(() => undefined));
  return Response.json({ accepted: true }, { status: 202 });
}
