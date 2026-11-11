"use client";

import { useState } from "react";

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Makes a VAPID key pair in this browser. Nothing is sent anywhere. */
async function makeVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64url(raw), privateKey: jwk.d as string };
}

function Field({ name, value }: { name: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card">
      <div className="spread">
        <b className="mono">{name}</b>
        <button
          className="btn small"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy value"}
        </button>
      </div>
      <div className="mono" data-testid={name}>{value}</div>
    </div>
  );
}

export default function Keys() {
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  return (
    <main className="page">
      <h1>Notification keys</h1>
      <p className="muted">
        Notifications need a key pair that belongs to this app. This page makes one inside your browser. It is not sent to any server and not shown to Claude. Copy each value into the Vercel project&apos;s environment variables under the name shown.
      </p>
      <button className="btn" onClick={async () => setKeys(await makeVapidKeys())}>
        {keys ? "Make a different pair" : "Make my keys"}
      </button>
      {keys && (
        <>
          <Field name="VAPID_PUBLIC_KEY" value={keys.publicKey} />
          <Field name="VAPID_PRIVATE_KEY" value={keys.privateKey} />
          <p className="small muted">Add both, from the same pair. If you reload this page the pair is gone, which is fine once both are saved in Vercel.</p>
        </>
      )}
    </main>
  );
}
