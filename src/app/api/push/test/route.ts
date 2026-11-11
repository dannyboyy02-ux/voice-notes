import { requireOwner } from "@/lib/server/auth";
import { sendPush } from "@/lib/server/push";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;
  try {
    const result = await sendPush(owner.userId, { title: "Voice Notes", body: "Notifications are working.", url: "/settings", tag: "test" });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
