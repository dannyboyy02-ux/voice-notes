"use client";
export type Theme = "dark" | "light" | "auto";
const KEY = "voice-notes-theme";

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "auto" ? t : "dark";
  } catch {
    return "dark";
  }
}

/** Dark is the default, so it is stored as "no attribute". */
export function applyTheme(theme: Theme): void {
  if (theme === "dark") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* the look still applies for this visit */ }
}
