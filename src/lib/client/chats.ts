"use client";
/** Zeus chats are kept on this phone only (browser storage), newest first. */
export type Turn = { role: "user" | "assistant"; content: string };
export type SavedChat = { id: string; title: string; noteId: string | null; noteTitle: string | null; turns: Turn[]; updatedAt: string };

const KEY = "voice-notes-zeus-chats";
const LIMIT = 30;

export function loadChats(): SavedChat[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedChat[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveChat(chat: SavedChat): SavedChat[] {
  const list = [chat, ...loadChats().filter((c) => c.id !== chat.id)].slice(0, LIMIT);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked: the chat just is not kept */ }
  return list;
}

export function removeChat(id: string): SavedChat[] {
  const list = loadChats().filter((c) => c.id !== id);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

export function chatTitle(firstQuestion: string): string {
  const t = firstQuestion.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}
