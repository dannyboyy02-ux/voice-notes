"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import ConversationList from "@/components/ConversationList";
import HomeHeader from "@/components/HomeHeader";
import { useRecorder } from "@/components/RecorderProvider";
import type { Recording } from "@/lib/types";

export default function NotesPage() {
  const { db, trash } = useApp();
  const { changed } = useRecorder();
  const [recordings, setRecordings] = useState<Recording[] | null>(null);

  const load = useCallback(async () => {
    let q = db.from("recordings").select("*").eq("is_test", false);
    if (trash) q = q.is("deleted_at", null);
    const { data } = await q.order("started_at", { ascending: false }).limit(100);
    setRecordings((data as Recording[]) ?? []);
  }, [db, trash]);
  // Reloads on open and whenever an upload (a recording or an import) finishes.
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load, changed]);

  // While something is still being transcribed, keep its status fresh.
  const busy = recordings?.some((r) => r.status !== "ready" && r.status !== "failed") ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  return (
    <>
      <HomeHeader />
      {!recordings ? (
        <p className="muted">Loading…</p>
      ) : recordings.length === 0 ? (
        <p className="muted">No recordings yet.</p>
      ) : (
        <section className="card">
          <div className="small muted">Swipe left to delete · press and hold for share, folders and export</div>
          <ConversationList rows={recordings} testid="note" onChanged={load} />
        </section>
      )}
    </>
  );
}
