"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { api } from "@/lib/client/supabase";
import { duration, stamp, when } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/pipeline/steps";
import { ITEM_COLUMNS, type Item, type Recording, type Utterance } from "@/lib/types";

function Note() {
  const { db } = useApp();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const jumpTo = useSearchParams().get("t");
  const [rec, setRec] = useState<Recording | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<Utterance[]>([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [message, setMessage] = useState("");
  const jumped = useRef(false);

  const load = useCallback(async () => {
    const [r, i, u] = await Promise.all([
      db.from("recordings").select("*").eq("id", id).maybeSingle(),
      db.from("items").select(ITEM_COLUMNS).eq("recording_id", id).neq("state", "dismissed").order("created_at"),
      db.from("utterances").select("idx, speaker, start_ms, end_ms, text").eq("recording_id", id).order("idx"),
    ]);
    setRec((r.data as Recording) ?? null);
    setItems((i.data as Item[]) ?? []);
    setLines((u.data as Utterance[]) ?? []);
  }, [db, id]);
  useEffect(() => {
    let live = true;
    (async () => { if (live) await load(); })();
    return () => { live = false; };
  }, [load]);

  const processing = !!rec && rec.status !== "ready" && rec.status !== "failed";
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [processing, load]);

  // Tapping an item or a search hit lands on the moment it was said.
  useEffect(() => {
    if (jumped.current || !jumpTo || !lines.length) return;
    jumped.current = true;
    document.getElementById(`u-${jumpTo}`)?.scrollIntoView({ block: "center" });
  }, [jumpTo, lines]);

  if (rec === undefined) return <p className="muted">Loading…</p>;
  if (rec === null) return <p className="muted">This recording was not found.</p>;

  const act = async (action: "retry" | "redo") => {
    setMessage("");
    const res = await api<{ error?: string }>(`/api/recordings/${id}/action`, { action });
    if (res.status !== 200) setMessage(`Could not do that: ${res.data.error ?? res.status}`);
    else setMessage(action === "redo" ? "Redoing with the best model. This takes about a minute." : "Trying again.");
    await load();
  };
  const play = async () => {
    if (!rec.storage_path) return;
    const { data, error } = await db.storage.from("audio").createSignedUrl(rec.storage_path, 3600);
    if (error || !data) setMessage("Could not load the audio.");
    else setAudioUrl(data.signedUrl);
  };
  const remove = async () => {
    if (!confirm("Delete this recording, its transcript and its items?")) return;
    if (rec.storage_path) await db.storage.from("audio").remove([rec.storage_path]);
    await db.from("recordings").delete().eq("id", id);
    router.push("/notes");
  };
  const toggle = async (i: Item) => {
    const state = i.state === "done" ? "active" : "done";
    setItems((list) => list.map((x) => (x.id === i.id ? { ...x, state } : x)));
    await db.from("items").update({ state }).eq("id", i.id);
  };

  const group = (title: string, list: Item[]) =>
    list.length > 0 && (
      <>
        <div className="label">{title}</div>
        {list.map((i) => (
          <div className="item" key={i.id}>
            <input type="checkbox" checked={i.state === "done"} onChange={() => toggle(i)} aria-label={`Done: ${i.text}`} />
            <div>
              {i.text}{" "}
              {i.due_at && <span className="pill">{when(i.due_at)}</span>}
              {!i.due_at && i.said && <span className="pill warn">“{i.said}”</span>}
            </div>
          </div>
        ))}
      </>
    );
  const cost = Number(rec.llm_cost_usd ?? 0) + Number(rec.stt_cost_usd ?? 0);
  const speakerNames = [...new Set(lines.map((l) => l.speaker))];

  return (
    <>
      <div className="small muted">
        {new Date(rec.started_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        {rec.duration_ms ? ` · ${duration(rec.duration_ms / 1000)}` : ""}{rec.part > 1 ? ` · part ${rec.part}` : ""}
      </div>
      <h1 data-testid="note-title">{rec.title ?? "Recording"}</h1>
      {rec.status !== "ready" && (
        <div className={`banner ${rec.status === "failed" ? "rec" : ""}`} data-testid="note-status">
          <span>
            {STATUS_LABEL[rec.status]}{processing ? "…" : ""}
            {rec.status === "failed" && rec.last_error ? `: ${rec.last_error}` : ""}
            {processing && rec.attempts > 1 ? ` (attempt ${rec.attempts} of 3)` : ""}
          </span>
          {rec.status === "failed" && <button className="btn small" onClick={() => act("retry")}>Retry</button>}
        </div>
      )}
      {message && <div className="banner">{message}</div>}
      {rec.summary && <p>{rec.summary}</p>}

      {items.length > 0 && (
        <section className="card">
          {group("To-dos", items.filter((i) => i.type === "todo" && i.state !== "suggested"))}
          {group("Reminders", items.filter((i) => i.type === "reminder" && i.state !== "suggested"))}
          {group("Needs a look", items.filter((i) => i.state === "suggested"))}
        </section>
      )}

      {lines.length > 0 && (
        <section className="card">
          <div className="label">Transcript{speakerNames.length > 1 ? ` · ${speakerNames.length} speakers` : ""}</div>
          {lines.map((l) => (
            <div key={l.idx} id={`u-${l.start_ms}`} style={jumpTo === String(l.start_ms) ? { background: "var(--warn-soft)", borderRadius: 8, padding: 4 } : undefined}>
              <span className="spk">Speaker {l.speaker}</span> <span className="small muted">{stamp(l.start_ms)}</span>
              <div>{l.text}</div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        {rec.storage_path && !audioUrl && <button className="btn secondary" onClick={play}>Play audio</button>}
        {audioUrl && <audio controls src={audioUrl} style={{ width: "100%" }} />}
        {rec.audio_deleted_at && <p className="small muted">The audio was deleted 30 days after processing. The transcript stays.</p>}
        {(rec.status === "ready" || rec.status === "failed") && lines.length > 0 && (
          <button className="btn secondary" onClick={() => act("redo")} data-testid="redo">Redo with best model</button>
        )}
        {rec.model_used && (
          <p className="small muted" data-testid="cost">
            Read by {rec.model_used} · {rec.input_tokens ?? 0} tokens in, {rec.output_tokens ?? 0} out · about ${cost.toFixed(3)} for this recording
          </p>
        )}
        <button className="btn secondary" onClick={remove}>Delete recording</button>
      </section>
    </>
  );
}

export default function NotePage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Note />
    </Suspense>
  );
}
