import { redoPatch, retryPatch } from "@/lib/pipeline/steps";
import { requireOwner } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Retry a failed recording, or redo the summary and items with the best model. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const db = adminDb();
  const { data: rec } = await db.from("recordings").select("id, status, failed_step").eq("id", id).eq("user_id", owner.userId).maybeSingle();
  if (!rec) return Response.json({ error: "not_found" }, { status: 404 });

  if (action === "retry") {
    if (rec.status !== "failed") return Response.json({ error: "not_failed" }, { status: 409 });
    const { count } = await db.from("utterances").select("id", { count: "exact", head: true }).eq("recording_id", id);
    const { error } = await db.from("recordings").update(retryPatch(rec.failed_step, (count ?? 0) > 0)).eq("id", id).eq("status", "failed");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  if (action === "redo") {
    if (rec.status !== "ready" && rec.status !== "failed") return Response.json({ error: "still_processing" }, { status: 409 });
    const { error } = await db.from("recordings").update(redoPatch()).eq("id", id).in("status", ["ready", "failed"]);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "unknown_action" }, { status: 400 });
}
