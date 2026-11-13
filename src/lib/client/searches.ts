"use client";
/** Recent searches are kept on this phone only (browser storage), newest first. */

const KEY = "voice-notes-searches";
const LIMIT = 8;

/** Puts a search at the front of the list. One that differs only by capitals or spacing is not listed twice. */
export function withSearch(list: string[], query: string): string[] {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return list;
  return [q, ...list.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, LIMIT);
}

export function loadSearches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function keepSearch(query: string): string[] {
  const list = withSearch(loadSearches(), query);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked: the search just is not kept */ }
  return list;
}

export function clearSearches(): string[] {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return [];
}
