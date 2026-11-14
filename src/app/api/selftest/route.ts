import { selftest } from "@/lib/server/selftest";
import { SELFTEST_HEADER, secretInAddress, selftestAllowed } from "@/lib/server/selftest-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Protected end-to-end check. ?action=start begins a run; calling again reports progress, then the final result. */
export async function GET(req: Request) {
  if (!selftestAllowed(req)) {
    const hint = secretInAddress(req) ? { hint: `send the secret in the ${SELFTEST_HEADER} header; it is no longer read from the address` } : {};
    return Response.json({ error: "forbidden", ...hint }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  try {
    const report = await selftest(req, new URL(req.url).searchParams.get("action"));
    return new Response(JSON.stringify(report, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, done: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
