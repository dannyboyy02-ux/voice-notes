"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppShell";
import { dateLabel } from "@/components/ConversationMenu";
import { api } from "@/lib/client/supabase";
import { duration } from "@/lib/format";
import { MAX_MERGE, type AudioPiece, type PlanSegment } from "@/lib/merge";

type Candidate = { id: string; title: string | null; started_at: string; duration_ms: number | null };
type Preview = {
  order: string[]; segments: PlanSegment[]; pieces: AudioPiece[]; warnings: string[];
  duration_ms: number; speakers: number; lines: number; databaseReady: boolean;
};

const nameOf = (r: { title: string | null }) => r.title ?? "Untitled recording";
const length = (ms: number | null) => (ms ? duration(ms / 1000) : "");

function seamLine(s: PlanSegment): string {
  if (s.seam.kind === "first") return "First";
  if (s.seam.kind === "gap") {
    if (s.seam.gap_ms === null) return "Placed after the one above";
    const min = Math.round(s.seam.gap_ms / 60000);
    return min < 1 ? "Begins straight after the one above" : `Begins ${duration(s.seam.gap_ms / 1000)} after the one above ended`;
  }
  if (s.seam.contained) return "Everything in it is already in the one above";
  const lines = s.seam.dropped;
  return `Overlaps the one above${s.seam.by === "clock" ? " by a moment" : ""}: ${lines} line${lines === 1 ? "" : "s"} heard in both ${lines === 1 ? "is" : "are"} kept once`;
}

/**
 * Merging conversations: pick the ones to put together, then check the preview (order, where each joins
 * the one before it, who is who) before merging. The server works the plan out again when merging.
 */
function Merge() {
  const { db, trash } = useApp();
  const router = useRouter();
  const base = useSearchParams().get("with");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<string[]>(base ? [base] : []);
  const [order, setOrder] = useState<string[] | undefined>(undefined);
  const [speakers, setSpeakers] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Preview | null>(null);
  const [step, setStep] = useState<"pick" | "preview">("pick");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      let q = db.from("recordings").select("id, title, started_at, duration_ms").eq("is_test", false).eq("status", "ready");
      if (trash) q = q.is("deleted_at", null);
      const { data } = await q.order("started_at", { ascending: false }).limit(200);
      if (live) setCandidates((data as Candidate[]) ?? []);
    })();
    return () => { live = false; };
  }, [db, trash]);

  const load = useCallback(async (next: { order?: string[]; speakers: Record<string, string> }) => {
    setBusy(true);
    setProblem("");
    const res = await api<Preview & { error?: string; message?: string }>("/api/recordings/merge", { ids: picked, order: next.order, speakers: next.speakers });
    setBusy(false);
    if (res.status !== 200) {
      setProblem(res.data.message ?? (res.data.error === "not_ready" ? "One of these is still being processed or is in Trash." : `Could not preview the merge (${res.data.error ?? res.status}).`));
      return;
    }
    setPlan(res.data);
    setOrder(res.data.order);
    setStep("preview");
  }, [picked]);

  if (!candidates) return <p className="muted">Loading…</p>;
  const baseRow = candidates.find((c) => c.id === base);
  const anchor = Date.parse(baseRow?.started_at ?? candidates[0]?.started_at ?? "1970-01-01T00:00:00Z");
  // The likeliest partners first: the conversations recorded closest in time.
  const others = candidates.filter((c) => c.id !== base).sort((a, b) => Math.abs(Date.parse(a.started_at) - anchor) - Math.abs(Date.parse(b.started_at) - anchor));
  const full = picked.length >= MAX_MERGE;

  if (step === "pick") {
    return (
      <>
        <div className="spread"><h1>Merge</h1><button className="btn small secondary" onClick={() => router.back()}>Cancel</button></div>
        {baseRow && (
          <section className="card">
            <div className="label">Starting with</div>
            <div><b>{nameOf(baseRow)}</b></div>
            <div className="small muted">{dateLabel(baseRow.started_at)}{baseRow.duration_ms ? ` · ${length(baseRow.duration_ms)}` : ""}</div>
          </section>
        )}
        <section className="card">
          <div className="label">Merge with</div>
          {others.length === 0 && <p className="muted">There are no other finished conversations to merge with.</p>}
          {others.map((c) => {
            const on = picked.includes(c.id);
            return (
              <label className="item" key={c.id} data-testid="merge-candidate">
                <input type="checkbox" checked={on} disabled={!on && full} onChange={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))} aria-label={`Merge ${nameOf(c)}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{nameOf(c)}</div>
                  <div className="small muted">{dateLabel(c.started_at)}{c.duration_ms ? ` · ${length(c.duration_ms)}` : ""}</div>
                </div>
              </label>
            );
          })}
        </section>
        {problem && <div className="banner rec">{problem}</div>}
        <button className="btn" disabled={picked.length < 2 || busy} onClick={() => { setOrder(undefined); setSpeakers({}); void load({ speakers: {} }); }} data-testid="merge-preview">
          {busy ? "Working it out…" : picked.length < 2 ? "Pick at least one more" : `Preview merging ${picked.length}`}
        </button>
      </>
    );
  }

  const segs = plan!.segments;
  const move = (i: number, by: -1 | 1) => {
    const next = [...(order ?? plan!.order)];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    void load({ order: next, speakers });
  };
  const match = (segId: string, label: string, as: string) => {
    const next = { ...speakers };
    if (as) next[`${segId}:${label}`] = as;
    else delete next[`${segId}:${label}`];
    setSpeakers(next);
    void load({ order, speakers: next });
  };
  const commit = async () => {
    setBusy(true);
    setProblem("");
    const res = await api<{ id?: string; error?: string; message?: string }>("/api/recordings/merge", { ids: picked, order, speakers, commit: true });
    setBusy(false);
    if (res.status === 200 && res.data.id) return router.push(`/notes/${res.data.id}`);
    setProblem(res.data.error === "database_update_needed"
      ? "The database needs its update before conversations can be merged."
      : res.data.message ?? `Could not merge (${res.data.error ?? res.status}). Nothing was changed.`);
  };

  return (
    <>
      <div className="spread"><h1>Merge {segs.length}</h1><button className="btn small secondary" onClick={() => setStep("pick")}>Back</button></div>
      <p className="small muted" data-testid="merge-summary">
        One conversation of {duration(plan!.duration_ms / 1000)} and {plan!.lines} lines, with {plan!.speakers} speaker{plan!.speakers === 1 ? "" : "s"}. Claude then writes one title and summary. The originals go to Trash, where they can be restored for 30 days.
      </p>
      {plan!.warnings.map((w) => <div className="banner" key={w} data-testid="merge-warning">{w}</div>)}

      {segs.map((s, i) => {
        // Earlier speakers this recording's speakers can be matched to.
        const earlier = [...new Set(segs.slice(0, i).flatMap((x) => x.speakers.map((p) => p.as)))];
        return (
          <section className="card" key={s.id} data-testid="merge-segment">
            <div className="spread">
              <div style={{ minWidth: 0 }}>
                <div><b>{i + 1}. {nameOf(s)}</b></div>
                <div className="small muted">{dateLabel(s.started_at)}{s.duration_ms ? ` · ${length(s.duration_ms)}` : ""}</div>
              </div>
              <span className="row">
                <button className="btn small secondary" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${nameOf(s)} up`}>↑</button>
                <button className="btn small secondary" disabled={busy || i === segs.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${nameOf(s)} down`}>↓</button>
              </span>
            </div>
            {i > 0 && <div className={`small ${s.seam.kind === "overlap" ? "" : "muted"}`} data-testid="merge-seam">{seamLine(s)}</div>}
            {i > 0 && s.speakers.length > 0 && (
              <>
                <div className="label">Who is who</div>
                {s.speakers.map((p) => {
                  const chosen = speakers[`${s.id}:${p.label}`] ?? "";
                  return (
                    <div key={p.label} data-testid="merge-speaker">
                      <div className="spread">
                        <span>Speaker {p.label} here</span>
                        <select className="select" value={chosen} disabled={busy} onChange={(e) => match(s.id, p.label, e.target.value)} aria-label={`Speaker ${p.label} in ${nameOf(s)}`}>
                          <option value="">{chosen ? "Someone new" : `Someone new (${p.as})`}</option>
                          {earlier.map((a) => <option key={a} value={a}>Same as Speaker {a}</option>)}
                        </select>
                      </div>
                      {p.samples.map((t, k) => <div className="small muted" key={k}>“{t}”</div>)}
                    </div>
                  );
                })}
              </>
            )}
            {i === 0 && s.speakers.length > 0 && (
              <div className="small muted">Speakers {s.speakers.map((p) => p.as).join(", ")}: {s.speakers.map((p) => `“${p.samples[0] ?? ""}”`).slice(0, 2).join(" ")}</div>
            )}
          </section>
        );
      })}

      {!plan!.databaseReady && <div className="banner rec" data-testid="merge-db">The database needs its update before conversations can be merged. The preview above is still accurate.</div>}
      {problem && <div className="banner rec">{problem}</div>}
      <button className="btn" disabled={busy || !plan!.databaseReady} onClick={commit} data-testid="merge-commit">{busy ? "Merging…" : `Merge ${segs.length} conversations`}</button>
    </>
  );
}

export default function MergePage() {
  return <Suspense fallback={<p className="muted">Loading…</p>}><Merge /></Suspense>;
}
