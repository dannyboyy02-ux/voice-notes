"use client";
import { getConfig, getSupabase } from "./supabase";

export type PushState = "on" | "off" | "denied" | "unsupported" | "needs-install" | "not-configured";

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
 */
export async function checkPush(): Promise<PushState> {
  const reg = await registerServiceWorker();
  if (!reg || !("PushManager" in window) || !("Notification" in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    return ios && !standalone ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const cfg = await getConfig();
  if (!cfg.vapidPublicKey) return "not-configured";
  try {
    const ready = await navigator.serviceWorker.ready;
    let sub = await ready.pushManager.getSubscription();
    sub ??= await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.vapidPublicKey) });
    const json = sub.toJSON();
    const db = await getSupabase();
    const { error } = await db.from("push_subscriptions").upsert(
      { endpoint: sub.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, user_agent: navigator.userAgent.slice(0, 200) },
      { onConflict: "endpoint" },
    );
    return error ? "off" : "on";
  } catch {
    return "off";
  }
}

/** Must be called from a tap: iOS only shows the permission prompt in response to one. */
export async function enablePush(): Promise<PushState> {
  if (!("Notification" in window)) return checkPush();
  await Notification.requestPermission();
  return checkPush();
}
