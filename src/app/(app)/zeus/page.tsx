"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import SwipeToDelete from "@/components/SwipeToDelete";
import { chatTitle, loadChats, removeChat, saveChat, type SavedChat, type Turn } from "@/lib/client/chats";
import { accessToken } from "@/lib/client/supabase";
import { ago } from "@/lib/format";
import { ASSISTANT_NAME } from "@/lib/models";

const STARTERS_ALL = ["What decisions and actions are outstanding?", "What should I prioritize this week?", "What reminders are coming up?"];
const STARTERS_ONE = ["Summarize the key decisions", "Who agreed to do what?", "What was left unresolved?"];

function Chat() {
  const { db, refreshOverdue } = useApp();
  const noteParam = useSearchParams().get("note");
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [noteId, setNoteId] = useState<string | null>(noteParam);
  const [noteTitle, setNoteTitle] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<SavedChat[] | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!noteId) return;
    let live = true;
    (async () => {
      const { data } = await db.from("recordings").select("title").eq("id", noteId).maybeSingle();
      if (live) setNoteTitle(data?.title ?? "this recording");
    })();
    return () => { live = false; };
  }, [db, noteId]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const asked: Turn[] = [...turns, { role: "user", content: text }];
    setTurns([...asked, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    let answer = "";
    const show = (content: string) => { answer = content; setTurns([...asked, { role: "assistant", content }]); };
    try {
      const res = await fetch("/api/zeus", {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ recordingId: noteId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, messages: asked }),
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        show(`(${ASSISTANT_NAME} could not answer: ${err.error ?? res.status}.)`);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let got = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += decoder.decode(value, { stream: true });
          show(got);
        }
        if (!got.trim()) show(`(${ASSISTANT_NAME} returned an empty answer. Try again.)`);
      }
    } catch {
      show(`(${ASSISTANT_NAME} could not be reached. Check your connection and try again.)`);
    }
    // Zeus may have changed to-dos, so the overdue count is checked again.
    refreshOverdue();
    saveChat({
      id: chatId, title: chatTitle(asked[0].content), noteId, noteTitle,
      turns: [...asked, { role: "assistant", content: answer }], updatedAt: new Date().toISOString(),
    });
    setBusy(false);
  };

  const newChat = () => { setChatId(crypto.randomUUID()); setTurns([]); setNoteId(noteParam); setHistory(null); };
  const open = (c: SavedChat) => { setChatId(c.id); setTurns(c.turns); setNoteId(c.noteId); setNoteTitle(c.noteTitle); setHistory(null); };

  if (history) {
    return (
      <>
        <div className="spread">
          <h1>Chat history</h1>
          <button className="btn small secondary" onClick={() => setHistory(null)}>Back</button>
        </div>
        {history.length === 0 ? (
          <p className="muted">No saved chats yet.</p>
        ) : (
          <section className="card">
            <div className="small muted">Kept on this phone only. Swipe left to delete.</div>
            {history.map((c) => (
              <SwipeToDelete key={c.id} label={c.title} onDelete={() => setHistory(removeChat(c.id))}>
                <button className="item list-link" style={{ width: "100%", background: "none", border: 0, textAlign: "left", cursor: "pointer" }} onClick={() => open(c)} data-testid="saved-chat">
                  <div>
                    <div>{c.title}</div>
                    <div className="small muted">{ago(c.updatedAt)}{c.noteTitle ? ` · ${c.noteTitle}` : ""}</div>
                  </div>
                </button>
              </SwipeToDelete>
            ))}
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <div className="spread">
        <h1>{turns.length ? ASSISTANT_NAME : `Ask ${ASSISTANT_NAME}`}</h1>
        <div className="row">
          <button className="btn small secondary" onClick={() => setHistory(loadChats())} disabled={busy}>History</button>
          {turns.length > 0 && <button className="btn small secondary" onClick={newChat} disabled={busy}>New chat</button>}
        </div>
      </div>
      <p className="small muted" data-testid="zeus-scope">
        {noteId ? (
          <>Asking about <b>{noteTitle ?? "…"}</b>, with its full transcript. <Link href="/zeus" onClick={() => { setNoteId(null); setTurns([]); setChatId(crypto.randomUUID()); }}>Ask across all recordings</Link></>
        ) : (
          <>Asking across your recordings: summaries, items and the transcript lines that match your question. For a deep look at one conversation, open it in Notes and tap “Ask {ASSISTANT_NAME}”.</>
        )}
      </p>

      {turns.length === 0 && (
        <section className="card">
          <div className="label">How can I help?</div>
          {(noteId ? STARTERS_ONE : STARTERS_ALL).map((s) => (
            <button key={s} className="btn secondary" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => ask(s)}>{s}</button>
          ))}
          <div className="small muted">You can also ask {ASSISTANT_NAME} to add, change, complete or remove to-dos and reminders.</div>
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
        <input className="input" placeholder={`Ask ${ASSISTANT_NAME} anything…`} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Ask ${ASSISTANT_NAME}`} />
        <button className="btn" disabled={busy || !draft.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
      <p className="small muted">{ASSISTANT_NAME} runs on Claude Sonnet 5.5. It reads your recordings and can change your to-dos and reminders when you ask; each change is shown with a ✓. It cannot change recordings. Chats are saved on this phone only.</p>
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
