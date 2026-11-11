import "server-only";
import * as webpush from "web-push";
import { adminDb } from "./db";
import { appUrl, need } from "./env";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };
export type PushResult = { subscriptions: number; sent: number; removed: number; errors: string[] };

/** Sends to every saved subscription of the owner. Dead subscriptions are removed. */
export async function sendPush(userId: string, payload: PushPayload): Promise<PushResult> {
  const db = adminDb();
  const { data: subs, error } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const out: PushResult = { subscriptions: subs?.length ?? 0, sent: 0, removed: 0, errors: [] };
  if (!subs?.length) return out;
  webpush.setVapidDetails(appUrl(), need("VAPID_PUBLIC_KEY"), need("VAPID_PRIVATE_KEY"));
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600, urgency: "high" },
      );
      out.sent++;
      await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").delete().eq("id", s.id);
        out.removed++;
      } else out.errors.push(`push ${status ?? ""} ${(err as Error).message}`.trim().slice(0, 200));
    }
  }
  return out;
}
