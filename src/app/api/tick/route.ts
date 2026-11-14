import { after } from "next/server";
import { adminDb } from "@/lib/server/db";
import { missingEnv } from "@/lib/server/env";
import { tickSecret } from "@/lib/server/request-shape";
import { runTick } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by the database scheduler. Answers at once and does the work after the response. */
export async function POST(req: Request) {
  // A request without a secret shaped like the scheduler's is refused before the database is asked, and
  // before anything is said about how the server is set up.
  const secret = tickSecret(req);
  if (!secret) return Response.json({ error: "forbidden" }, { status: 403 });
  const missing = missingEnv();
  if (missing.length) return Response.json({ error: "server_not_configured", missing }, { status: 503 });
  const { data: ok, error } = await adminDb().rpc("verify_tick_secret", { p_secret: secret });
  if (error) return Response.json({ error: "database_not_set_up" }, { status: 503 });
  if (ok !== true) return Response.json({ error: "forbidden" }, { status: 403 });

  after(async () => {
    const noted = await adminDb().rpc("note_tick", { p_source: "scheduler" });
    if (noted.error) console.warn("note_tick failed:", noted.error.message);
    const report = await runTick();
    console.log("tick", JSON.stringify(report));
  });
  return Response.json({ accepted: true }, { status: 202 });
}
