import { after } from "next/server";
import { z } from "zod";
import { MAX_MERGE, mergeItems, planMerge, readPieces, type MergePlan, type MergeSource } from "@/lib/merge";
import { requireOwner } from "@/lib/server/auth";
import { adminDb } from "@/lib/server/db";
import { runUntilIdle } from "@/lib/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  ids: z.array(z.string().uuid()).min(2).max(MAX_MERGE),
  order: z.array(z.string().uuid()).max(MAX_MERGE).optional(),
  speakers: z.record(z.string().max(80), z.string().max(8)).optional(),
  commit: z.boolean().optional(),
});

type Row = {
  id: string; user_id: string; title: string | null; started_at: string; time_zone: string; duration_ms: number | null;
  status: string; is_test: boolean; deleted_at: string | null; folder_id: string | null; merged_from: unknown;
};
type ItemRow = Record<string, unknown> & {
  id: string; recording_id: string; type: "todo" | "reminder"; text: string; at_ms: number | null; state: "suggested" | "active" | "done" | "dismissed";
};

/** The preview, without the full transcript: what the owner checks before merging. */
function preview(plan: MergePlan) {
  return {
    order: plan.order, segments: plan.segments, pieces: plan.pieces, warnings: plan.warnings,
    duration_ms: plan.duration_ms, speakers: plan.speakers, lines: plan.lines.length,
  };
}

/**
 * Merging conversations. Without `commit` it returns the plan for the preview. With `commit` it builds the
 * merged conversation from the same plan, worked out again here from the database (never taken from the
 * phone): a new conversation with the joined transcript and copies of the items, which Claude then reads
 * for one title and summary. The originals go to Trash, from where they can still be restored for 30 days.
 */
export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { ids, order, speakers, commit } = parsed.data;
  const db = adminDb();

  // Merging needs the columns added by the current supabase/setup.sql.
  const probe = await db.from("recordings").select("merged_from, merged_into, deleted_at").limit(1);
  const probeLines = await db.from("utterances").select("segment").limit(1);
  const ready = !probe.error && !probeLines.error;
  const cols = `id, user_id, title, started_at, time_zone, duration_ms, status, is_test, deleted_at, folder_id${ready ? ", merged_from" : ""}`;

  const { data: recs, error } = await db.from("recordings").select(cols).in("id", ids).eq("user_id", owner.userId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const rows = (recs ?? []) as unknown as Row[];
  if (rows.length !== new Set(ids).size) return Response.json({ error: "not_found" }, { status: 404 });
  const notReady = rows.filter((r) => r.status !== "ready" || r.is_test || r.deleted_at);
  if (notReady.length) return Response.json({ error: "not_ready", ids: notReady.map((r) => r.id) }, { status: 409 });

  const { data: lines, error: e2 } = await db.from("utterances")
    .select(`recording_id, speaker, start_ms, end_ms, text${ready ? ", segment" : ""}`).in("recording_id", ids).eq("user_id", owner.userId).order("idx");
  if (e2) return Response.json({ error: e2.message }, { status: 500 });
  const said = (lines ?? []) as unknown as { recording_id: string; speaker: string; start_ms: number; end_ms: number; text: string; segment?: number }[];

  const sources: MergeSource[] = rows.map((r) => {
    const own = said.filter((l) => l.recording_id === r.id);
    const pieces = readPieces(r.merged_from);
    return {
      id: r.id, title: r.title, started_at: r.started_at, duration_ms: r.duration_ms,
      lines: own.map(({ speaker, start_ms, end_ms, text }) => ({ speaker, start_ms, end_ms, text })),
      pieces, lineSegments: pieces ? own.map((l) => l.segment ?? 0) : null,
    };
  });

  let plan: MergePlan;
  try {
    plan = planMerge(sources, { order, speakers });
  } catch (e) {
    return Response.json({ error: "cannot_merge", message: (e as Error).message }, { status: 400 });
  }
  if (!commit) return Response.json({ ...preview(plan), databaseReady: ready });
  if (!ready) return Response.json({ error: "database_update_needed" }, { status: 409 });

  const first = rows.find((r) => r.id === plan.order[0])!;
  const id = crypto.randomUUID();
  const created = await db.from("recordings").insert({
    id, user_id: owner.userId, started_at: first.started_at,
    time_zone: first.time_zone, duration_ms: plan.duration_ms, status: "transcribed", speakers: plan.speakers,
    folder_id: first.folder_id, merged_from: plan.pieces, part: 1,
  });
  if (created.error) return Response.json({ error: created.error.message }, { status: 500 });

  // From here, any failure removes the half-built conversation (its lines and items go with it) and leaves the originals untouched.
  const undo = async (message: string) => {
    await db.from("recordings").delete().eq("id", id);
    return Response.json({ error: message }, { status: 500 });
  };
  const utterances = plan.lines.map((l, idx) => ({
    recording_id: id, user_id: owner.userId, idx, speaker: l.speaker, start_ms: Math.round(l.start_ms), end_ms: Math.round(l.end_ms), text: l.text, segment: l.segment,
  }));
  for (let i = 0; i < utterances.length; i += 500) {
    const { error: e } = await db.from("utterances").insert(utterances.slice(i, i + 500));
    if (e) return undo(e.message);
  }

  const { data: items, error: e3 } = await db.from("items").select("*").in("recording_id", ids).eq("user_id", owner.userId);
  if (e3) return undo(e3.message);
  const copies = mergeItems((items ?? []) as ItemRow[], plan).map((item) => {
    const copy = { ...item, recording_id: id };
    for (const k of ["id", "created_at", "fts"]) delete (copy as Record<string, unknown>)[k];
    return copy;
  });
  if (copies.length) {
    const { error: e } = await db.from("items").insert(copies);
    if (e) return undo(e.message);
  }

  // Only now do the originals move to Trash. Their items stay with them, hidden while they are there.
  const now = new Date().toISOString();
  const trashed = await db.from("recordings").update({ deleted_at: now, merged_into: id }).in("id", ids).eq("user_id", owner.userId);
  if (trashed.error) return undo(trashed.error.message);

  // Claude reads the joined transcript straight away for one title and summary, as after an upload.
  after(() => runUntilIdle(owner.userId).then(() => undefined));
  return Response.json({ id, ...preview(plan) });
}
