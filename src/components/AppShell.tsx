"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { checkPush, enablePush, type PushState } from "@/lib/client/push";
import { api, getConfig, getSupabase } from "@/lib/client/supabase";

type App = { db: SupabaseClient; userId: string; push: PushState; setPush: (p: PushState) => void; refreshOverdue: () => void };
const Ctx = createContext<App | null>(null);
export function useApp(): App {
  const app = useContext(Ctx);
  if (!app) throw new Error("useApp outside AppShell");
  return app;
}

type Gate =
  | { kind: "loading" }
  | { kind: "setup"; missing: string[] }
  | { kind: "login" }
  | { kind: "not-owner"; userId: string; configured: boolean }
  | { kind: "ready"; userId: string; warning: string | null };

const TABS = [
  { href: "/", label: "Record" },
  { href: "/todos", label: "To-dos" },
  { href: "/notes", label: "Notes" },
  { href: "/settings", label: "Settings" },
];

function Login({ db, onDone }: { db: SupabaseClient; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="page">
      <h1>Voice Notes</h1>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
          setBusy(false);
          if (error) setError(error.message);
          else onDone();
        }}
      >
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input" type="email" autoComplete="username" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="banner rec">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="small muted">This app has one account. New sign-ups are switched off.</p>
    </main>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [db, setDb] = useState<SupabaseClient | null>(null);
  const [push, setPush] = useState<PushState>("off");
  const [overdue, setOverdue] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const cfg = await getConfig().catch(() => null);
      if (!live) return;
      if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
        return setGate({ kind: "setup", missing: cfg?.missing ?? ["SUPABASE_URL", "SUPABASE_ANON_KEY"] });
      }
      const client = await getSupabase();
      const { data } = await client.auth.getSession();
      if (!live) return;
      setDb(client);
      if (!data.session) return setGate({ kind: "login" });
      const sync = await api<{ userId?: string; yourUserId?: string; error?: string; missing?: string[]; databaseReady?: boolean; databaseError?: string }>("/api/sync").catch(() => null);
      if (!live) return;
      if (sync?.status === 401) {
        await client.auth.signOut();
        return setGate({ kind: "login" });
      }
      if (sync?.status === 403) {
        return setGate({ kind: "not-owner", userId: sync.data.yourUserId ?? data.session.user.id, configured: sync.data.error === "not_owner" });
      }
      const warning = !sync
        ? "Could not reach the server. Recording still works; uploads wait until you are back online."
        : sync.data.missing?.length
          ? `Setup is not finished. Missing in Vercel: ${sync.data.missing.join(", ")}`
          : sync.data.databaseReady === false
            ? `The database setup script has not been run yet (${sync.data.databaseError ?? "unknown error"}).`
            : null;
      setGate({ kind: "ready", userId: data.session.user.id, warning });
      setPush(await checkPush());
    })();
    return () => { live = false; };
  }, [attempt]);

  const userId = gate.kind === "ready" ? gate.userId : null;
  const refreshOverdue = useCallback(() => {
    if (!db || !userId) return;
    db.from("items").select("id", { count: "exact", head: true }).eq("type", "reminder").eq("state", "active")
      .eq("is_test", false).lt("due_at", new Date().toISOString())
      .then(({ count }) => setOverdue(count ?? 0));
  }, [db, userId]);

  // Overdue items are checked on every open and every time the app comes back to the front.
  useEffect(() => {
    refreshOverdue();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshOverdue();
        checkPush().then(setPush);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshOverdue, pathname]);

  if (gate.kind === "loading") return <main className="page"><p className="muted">Loading…</p></main>;
  if (gate.kind === "setup") {
    return (
      <main className="page">
        <h1>Voice Notes</h1>
        <div className="card">
          <h2>Setup is not finished</h2>
          <p className="small">These environment variables are missing in the Vercel project. Add them, then redeploy.</p>
          <pre className="log">{gate.missing.join("\n")}</pre>
        </div>
        <Link className="btn secondary" href="/phone-check">Phone check</Link>
      </main>
    );
  }
  if (gate.kind === "login" && db) return <Login db={db} onDone={() => setAttempt((n) => n + 1)} />;
  if (gate.kind === "not-owner" && db) {
    return (
      <main className="page">
        <h1>Voice Notes</h1>
        <div className="card">
          <h2>{gate.configured ? "This is not the owner's account" : "One more setup step"}</h2>
          <p className="small">
            {gate.configured
              ? "The server only accepts the account whose id is saved as OWNER_USER_ID in Vercel."
              : "Save this id as OWNER_USER_ID in the Vercel project's environment variables, then redeploy."}
          </p>
          <pre className="log" data-testid="user-id">{gate.userId}</pre>
          <button className="btn secondary" onClick={() => navigator.clipboard.writeText(gate.userId)}>Copy id</button>
          <button className="btn secondary" onClick={async () => { await db.auth.signOut(); setAttempt((n) => n + 1); }}>Sign out</button>
        </div>
      </main>
    );
  }
  if (gate.kind !== "ready" || !db) return <main className="page"><p className="muted">Loading…</p></main>;

  const pushMessage: Partial<Record<PushState, string>> = {
    off: "Notifications are off, so reminders will not alert you.",
    denied: "Notifications are blocked for this app. Allow them in iPhone Settings > Notifications > Voice Notes.",
    "needs-install": "Add this app to your Home Screen to get reminder notifications.",
    "not-configured": "Notifications are not set up on the server yet.",
  };

  return (
    <Ctx.Provider value={{ db, userId: gate.userId, push, setPush, refreshOverdue }}>
      <div className="page">
        {gate.warning && <div className="banner rec">{gate.warning}</div>}
        {overdue > 0 && pathname !== "/todos" && (
          <Link href="/todos" className="banner rec" style={{ textDecoration: "none" }} data-testid="overdue-banner">
            <span>{overdue} overdue reminder{overdue === 1 ? "" : "s"}</span><b>View</b>
          </Link>
        )}
        {pushMessage[push] && (
          <div className="banner" data-testid="push-banner">
            <span>{pushMessage[push]}</span>
            {push === "off" && <button className="btn small" onClick={async () => setPush(await enablePush())}>Turn on</button>}
          </div>
        )}
        {children}
      </div>
      <nav className="tabs">
        {TABS.map((t) => {
          const on = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return <Link key={t.href} href={t.href} className={on ? "on" : ""}>{t.label}</Link>;
        })}
      </nav>
    </Ctx.Provider>
  );
}
