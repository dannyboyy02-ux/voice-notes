"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "./AppShell";
import Bolt from "./Bolt";
import SwipeToDelete from "./SwipeToDelete";
import { chatTitle, loadChats, removeChat, saveChat, type SavedChat, type Turn } from "@/lib/client/chats";
import { accessToken } from "@/lib/client/supabase";
import { ago } from "@/lib/format";
import { ASSISTANT_NAME } from "@/lib/models";

const STARTERS_ALL = ["What decisions and actions are outstanding?", "What should I prioritize this week?", "What reminders are coming up?"];
const STARTERS_ONE = ["Summarize the key decisions", "Who agreed to do what?", "What was left unresolved?"];
// One sample question sits in the question box as the hint for what to type.
const GUIDE_ALL = STARTERS_ALL[1];
const GUIDE_ONE = STARTERS_ONE[1];

/**
 * The chat with Zeus. On its own screen it has the bolt, History and New chat along the top. Embedded in a
 * conversation's Zeus tab it is always about that conversation, drops that top row, and picks up the last
 * chat held about it on this phone.
 */
export default function ZeusChat({ initialNoteId, title = null, embedded = false }: { initialNoteId: string | null; title?: string | null; embedded?: boolean }) {
  const { db, refreshOverdue } = useApp();
  const noteParam = initialNoteId;
  // Inside a conversation, carry on from the last chat about it rather than starting blank each visit.
  const [resumed] = useState<SavedChat | undefined>(() => (embedded && initialNoteId ? loadChats().find((c) => c.noteId === initialNoteId) : undefined));
  const [chatId, setChatId] = useState(() => resumed?.id ?? crypto.randomUUID());
  const [noteId, setNoteId] = useState<string | null>(noteParam);
  const [noteTitle, setNoteTitle] = useState<string | null>(title);
  const [turns, setTurns] = useState<Turn[]>(() => resumed?.turns ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<SavedChat[] | null>(null);

  useEffect(() => {
    if (!noteId || title) return;
    let live = true;
    (async () => {
      const { data } = await db.from("recordings").select("title").eq("id", noteId).maybeSingle();
      if (live) setNoteTitle(data?.title ?? "this recording");
    })();
    return () => { live = false; };
  }, [db, noteId, title]);

  // Keeps the newest words in view, just above the question bar at the foot of the screen.
  useEffect(() => { if (turns.length) window.scrollTo(0, document.documentElement.scrollHeight); }, [turns]);

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
    // The chat fills the screen: the bolt at the top, the question bar resting just above the tab bar.
    <div className="chat" data-testid="zeus-chat">
      {embedded ? (
        turns.length > 0 && <div style={{ textAlign: "right" }}><button className="btn small secondary" onClick={newChat} disabled={busy}>New chat</button></div>
      ) : (
        <div className="spread">
          <h1 className="zeus-mark" aria-label={ASSISTANT_NAME}><Bolt size={34} /></h1>
          <div className="row">
            <button className="btn small secondary" onClick={() => setHistory(loadChats())} disabled={busy}>History</button>
            {turns.length > 0 && <button className="btn small secondary" onClick={newChat} disabled={busy}>New chat</button>}
          </div>
        </div>
      )}
      {/* Shown only when the chat is about one recording, so it is clear which one and how to widen it. */}
      {noteId && !embedded && (
        <p className="small muted" data-testid="zeus-scope">
          Asking about <b>{noteTitle ?? "…"}</b>, with its full transcript. <Link href="/zeus" onClick={() => { setNoteId(null); setTurns([]); setChatId(crypto.randomUUID()); }}>Ask across all recordings</Link>
        </p>
      )}

      {turns.length === 0 && (
        <section className="card">
          <div className="label">How can I help?</div>
          {(noteId ? STARTERS_ONE : STARTERS_ALL).map((s) => (
            <button key={s} className="btn secondary" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => ask(s)}>{s}</button>
          ))}
        </section>
      )}

      {turns.map((t, i) => (
        <div key={i} className="card" style={t.role === "user" ? { background: "var(--accent-soft)", marginLeft: 32 } : { marginRight: 16 }} data-testid={`turn-${t.role}`}>
          <div className="label">{t.role === "user" ? "You" : ASSISTANT_NAME}</div>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t.content || (busy && i === turns.length - 1 ? "Thinking…" : "")}</div>
        </div>
      ))}

      <form className="row chat-bar" onSubmit={(e) => { e.preventDefault(); void ask(draft); }} data-testid="chat-bar">
        <input className="input" placeholder={noteId ? GUIDE_ONE : GUIDE_ALL} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Ask ${ASSISTANT_NAME}`} />
        <button className="btn" disabled={busy || !draft.trim()}>{busy ? "…" : "Ask"}</button>
      </form>
    </div>
  );
}
