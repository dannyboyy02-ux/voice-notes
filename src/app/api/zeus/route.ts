import { requireOwner } from "@/lib/server/auth";
import { missingEnv } from "@/lib/server/env";
import { buildContext, streamAnswer, type ChatTurn } from "@/lib/server/zeus";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Chat with Zeus about one recording or across all of them. Zeus may also change the owner's to-dos. Owner only. */
export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const missing = missingEnv(["ANTHROPIC_API_KEY"]);
  if (missing.length) return Response.json({ error: "server_not_configured", missing }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { recordingId?: string | null; timeZone?: string; messages?: ChatTurn[] } | null;
  const turns = (body?.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  const last = turns[turns.length - 1];
  if (!last || last.role !== "user") return Response.json({ error: "no_question" }, { status: 400 });
  while (turns.length && turns[0].role !== "user") turns.shift();

  try {
    const recordingId = body?.recordingId ?? null;
    const timeZone = typeof body?.timeZone === "string" ? body.timeZone : "UTC";
    const context = await buildContext(owner.userId, recordingId, last.content, timeZone);
    return new Response(streamAnswer(context, turns, { userId: owner.userId, timeZone, recordingId, allowChanges: true }), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
