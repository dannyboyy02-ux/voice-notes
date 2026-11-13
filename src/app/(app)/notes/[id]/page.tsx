"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import ConversationMenu from "@/components/ConversationMenu";
import { BackIcon, MoreIcon } from "@/components/icons";
import ZeusChat from "@/components/ZeusChat";
import { api } from "@/lib/client/supabase";
import { duration, stamp, when } from "@/lib/format";
import { ASSISTANT_NAME } from "@/lib/models";
import { STATUS_LABEL } from "@/lib/pipeline/steps";
import { ITEM_COLUMNS, type Item, type Recording, type Utterance } from "@/lib/types";

type Tab = "summary" | "transcript" | "zeus";
const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "transcript", label: "Transcript" },
  { id: "zeus", label: ASSISTANT_NAME },
];

/**
 * One conversation. Along the top: back, and three dots for Share, Copy transcript, Move to folder,
 * Export and Delete. Beneath the title, three tabs: Summary (with its to-dos, reminders and the audio),
 * Transcript, and Zeus (a chat about this conversation alone).
 */
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
  // Arriving at a moment in the conversation (from a search hit, say) opens on the transcript.
  const [tab, setTab] = useState<Tab>(jumpTo ? "transcript" : "summary");
  const [menu, setMenu] = useState(false);
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
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [processing, load]);

  // The moment asked for may fall inside a line rather than exactly on its start, so use the last line that begins at or before it.
  const wanted = jumpTo === null ? null : Number(jumpTo);
  const nearest = wanted === null || !lines.length ? null : (lines.filter((l) => l.start_ms <= wanted).at(-1) ?? lines[0]).start_ms;

  // Tapping an item or a search hit lands on the moment it was said.
  useEffect(() => {
    if (jumped.current || !jumpTo || !lines.length || tab !== "transcript") return;
    jumped.current = true;
    document.getElementById(`u-${nearest}`)?.scrollIntoView({ block: "center" });
  }, [jumpTo, lines, nearest, tab]);

  // Back goes to wherever this was opened from; opened cold (from a notification, say) it goes to Home.
  const back = () => { if (window.history.length > 1) router.back(); else router.push("/notes"); };
  const backButton = <button className="icon-btn" onClick={back} aria-label="Back" data-testid="note-back"><BackIcon /></button>;

  if (rec === undefined) return <p className="muted">Loading…</p>;
  if (rec === null) return <><div className="spread">{backButton}</div><p className="muted">This recording was not found.</p></>;

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
  const waiting = processing ? "It appears here once the recording has been processed." : "There is none for this recording.";

  return (
    <>
      <div className="spread">
        {backButton}
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Conversation options" aria-haspopup="dialog" data-testid="note-options"><MoreIcon /></button>
      </div>
      <div className="small muted">
        {new Date(rec.started_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        {rec.duration_ms ? ` · ${duration(rec.duration_ms / 1000)}` : ""}{rec.part > 1 ? ` · part ${rec.part}` : ""}
      </div>
      <h1 data-testid="note-title">{rec.title ?? "Untitled recording"}</h1>
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

      <div className="headers" role="tablist" aria-label="Parts of this conversation">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>
        ))}
      </div>

      {tab === "summary" && (
        <>
          {rec.summary ? <p data-testid="note-summary">{rec.summary}</p> : <p className="muted">No summary yet. {waiting}</p>}

          {items.length > 0 && (
            <section className="card">
              {group("To-dos", items.filter((i) => i.type === "todo" && i.state !== "suggested"))}
              {group("Reminders", items.filter((i) => i.type === "reminder" && i.state !== "suggested"))}
              {group("Needs a look", items.filter((i) => i.state === "suggested"))}
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
          </section>
        </>
      )}

      {tab === "transcript" && (
        lines.length > 0 ? (
          <section className="card" data-testid="transcript">
            <div className="label">{speakerNames.length > 1 ? `${speakerNames.length} speakers` : "One speaker"}</div>
            {lines.map((l) => (
              <div key={l.idx} id={`u-${l.start_ms}`} style={nearest === l.start_ms ? { background: "var(--warn-soft)", borderRadius: 8, padding: 4 } : undefined}>
                <span className="spk">Speaker {l.speaker}</span> <span className="small muted">{stamp(l.start_ms)}</span>
                <div>{l.text}</div>
              </div>
            ))}
          </section>
        ) : (
          <p className="muted">No transcript yet. {waiting}</p>
        )
      )}

      {tab === "zeus" && (
        lines.length > 0
          ? <ZeusChat embedded initialNoteId={id} title={rec.title ?? "this recording"} />
          : <p className="muted">{ASSISTANT_NAME} can answer questions about this conversation once it has a transcript.</p>
      )}

      {menu && (
        <ConversationMenu
          row={rec}
          peek={false}
          onClose={() => setMenu(false)}
          onChanged={load}
          onDeleted={() => router.push("/notes")}
        />
      )}
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
