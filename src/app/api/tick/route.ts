import { after } from "next/server";
import { adminDb } from "@/lib/server/db";
import { missingEnv } from "@/lib/server/env";
import { runTick } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by the database scheduler. Answers at once and does the work after the response. */
export async function POST(req: Request) {
  const missing = missingEnv();
  if (missing.length) return Response.json({ error: "server_not_configured", missing }, { status: 503 });
  const secret = req.headers.get("x-tick-secret") ?? "";
  const { data: ok, error } = await adminDb().rpc("verify_tick_secret", { p_secret: secret });
  if (error) return Response.json({ error: "database_not_set_up" }, { status: 503 });
  if (!secret || ok !== true) return Response.json({ error: "forbidden" }, { status: 403 });

  after(async () => {
    const noted = await adminDb().rpc("note_tick", { p_source: "scheduler" });
    if (noted.error) console.warn("note_tick failed:", noted.error.message);
    const report = await runTick();
    console.log("tick", JSON.stringify(report));
  });
  return Response.json({ accepted: true }, { status: 202 });
}
