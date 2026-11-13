"use client";
import { getConfig, getSupabase } from "./supabase";

/** "checking" is the state before the first look has finished: nothing is known yet, so nothing is claimed. */
export type PushState = "checking" | "on" | "off" | "denied" | "unsupported" | "needs-install" | "not-configured";

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

/**
 * Run on every open. iOS can drop a web app's push subscription without telling it,
 * so the subscription is looked up again each time and saved again if it changed.
 * Returns null when it could not tell this time (no connection, say, just after the phone wakes):
 * the caller then keeps what it already knew, so a dropped connection is never reported as "off".
 */
export async function checkPush(): Promise<PushState | null> {
  const reg = await registerServiceWorker();
  if (!reg || !("PushManager" in window) || !("Notification" in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    return ios && !standalone ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const cfg = await getConfig().catch(() => null);
  if (!cfg) return null;
  if (!cfg.vapidPublicKey) return "not-configured";
  let sub: PushSubscription;
  try {
    const ready = await navigator.serviceWorker.ready;
    sub = (await ready.pushManager.getSubscription())
      ?? (await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.vapidPublicKey) }));
  } catch {
    // The phone holds no subscription and could not make one, so nothing would arrive.
    return "off";
  }
  try {
    const json = sub.toJSON();
    const db = await getSupabase();
    const { error, status } = await db.from("push_subscriptions").upsert(
      { endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, user_agent: navigator.userAgent.slice(0, 200) },
      { onConflict: "endpoint" },
    );
    if (!error) return "on";
    // Status 0 means the request never got an answer. The phone is subscribed; whether the server has it is unknown.
    // Any other status is the server refusing the save, so reminders really would not arrive.
    return status === 0 ? null : "off";
  } catch {
    return null;
  }
}

/** Must be called from a tap: iOS only shows the permission prompt in response to one. */
export async function enablePush(): Promise<PushState | null> {
  if (!("Notification" in window)) return checkPush();
  await Notification.requestPermission();
  return checkPush();
}
