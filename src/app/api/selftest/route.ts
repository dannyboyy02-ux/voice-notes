import { timingSafeEqual } from "node:crypto";
import { selftest } from "@/lib/server/selftest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function allowed(req: Request): boolean {
  const expected = process.env.SELFTEST_SECRET?.trim();
  if (!expected) return false;
  const given = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-selftest-secret") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Protected end-to-end check. ?action=start begins a run; calling again reports progress, then the final result. */
export async function GET(req: Request) {
  if (!allowed(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const report = await selftest(req, new URL(req.url).searchParams.get("action"));
    return new Response(JSON.stringify(report, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, done: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
