"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { accessToken } from "@/lib/client/supabase";
import { ASSISTANT_NAME } from "@/lib/models";

type Turn = { role: "user" | "assistant"; content: string };

const STARTERS_ALL = ["What do I still owe people?", "What did I record this week?", "What reminders are coming up?"];
const STARTERS_ONE = ["Summarize the key decisions", "Who agreed to do what?", "What was left unresolved?"];

function Chat() {
  const { db } = useApp();
  const noteId = useSearchParams().get("note");
  const [title, setTitle] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!noteId) return;
    let live = true;
    (async () => {
      const { data } = await db.from("recordings").select("title").eq("id", noteId).maybeSingle();
      if (live) setTitle(data?.title ?? "this recording");
    })();
    return () => { live = false; };
  }, [db, noteId]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history: Turn[] = [...turns, { role: "user", content: text }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    const show = (content: string) => setTurns([...history, { role: "assistant", content }]);
    try {
      const res = await fetch("/api/zeus", {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ recordingId: noteId, messages: history }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        show(`(${ASSISTANT_NAME} could not answer: ${err.error ?? res.status}.)`);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let answer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          answer += decoder.decode(value, { stream: true });
          show(answer);
        }
        if (!answer.trim()) show(`(${ASSISTANT_NAME} returned an empty answer. Try again.)`);
      }
    } catch {
      show(`(${ASSISTANT_NAME} could not be reached. Check your connection and try again.)`);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="spread">
        <h1>{ASSISTANT_NAME}</h1>
        {turns.length > 0 && <button className="btn small secondary" onClick={() => setTurns([])} disabled={busy}>New chat</button>}
      </div>
      <p className="small muted" data-testid="zeus-scope">
        {noteId ? (
          <>Asking about <b>{title ?? "…"}</b>, with its full transcript. <Link href="/zeus">Ask across all recordings</Link></>
        ) : (
          <>Asking across your recordings: summaries, items and the transcript lines that match your question. For a deep look at one conversation, open it in Notes and tap “Ask {ASSISTANT_NAME}”.</>
        )}
      </p>

      {turns.length === 0 && (
        <section className="card">
          <div className="label">Try</div>
          {(noteId ? STARTERS_ONE : STARTERS_ALL).map((s) => (
            <button key={s} className="btn secondary" style={{ justifyContent: "flex-start" }} onClick={() => ask(s)}>{s}</button>
          ))}
        </section>
      )}

      {turns.map((t, i) => (
        <div key={i} className="card" style={t.role === "user" ? { background: "var(--accent-soft)", marginLeft: 32 } : { marginRight: 16 }} data-testid={`turn-${t.role}`}>
          <div className="label">{t.role === "user" ? "You" : ASSISTANT_NAME}</div>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t.content || (busy && i === turns.length - 1 ? "Thinking…" : "")}</div>
        </div>
      ))}
      <div ref={end} />

      <form className="row" onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
        <input className="input" placeholder={`Ask ${ASSISTANT_NAME}`} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Ask ${ASSISTANT_NAME}`} />
        <button className="btn" disabled={busy || !draft.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
      <p className="small muted">{ASSISTANT_NAME} runs on Claude Sonnet 5.5. It can read your recordings and answer; it cannot change anything. Chats are not saved.</p>
    </>
  );
}

export default function ZeusPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Chat />
    </Suspense>
  );
}
