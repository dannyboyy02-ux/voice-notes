"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clock } from "@/lib/format";
import { useRecorder } from "./RecorderProvider";

const icon = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const TABS = [
  { href: "/notes", label: "Home", glyph: <svg {...icon}><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /></svg> },
  // Three stacked layers: the top one whole, the two beneath showing only where they peek out.
  { href: "/folders", label: "Folders", glyph: <svg {...icon} data-testid="folders-icon"><path d="M12 2l9.5 4-9.5 4-9.5-4z" /><path d="M5.8 10.6L2.5 12l9.5 4 9.5-4-3.3-1.4" /><path d="M5.8 16.6L2.5 18l9.5 4 9.5-4-3.3-1.4" /></svg> },
  null,
  { href: "/zeus", label: "Zeus", glyph: <svg {...icon}><path d="M13 3L6 13h5l-1 8 8-11h-5z" /></svg> },
  { href: "/settings", label: "Settings", glyph: <svg {...icon}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg> },
];

const Mic = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
  </svg>
);
/** A clock that keeps counting between recorder updates, and stands still while paused. */
export function useRecordedMs(): number {
  const { view, recording, paused } = useRecorder();
  const [now, setNow] = useState(0);
  const running = recording && !paused;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  if (!view || !recording) return 0;
  return view.activeMs + (running ? Math.max(0, now - view.at) : 0);
}

/**
 * The bottom bar. Idle: four tabs around a blue microphone, which starts a recording with one tap. Recording: the tabs give way to the timer,
 * the microphone (tap to pause, tap again to resume) and a stop button to its right. A ring pulses
 * around the microphone while it is live and stops when paused.
 */
export default function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { recording, paused, engaged, start, pause, resume, stop } = useRecorder();
  const recorded = useRecordedMs();

  if (recording) {
    return (
      <nav className="tabs recording" aria-label="Recording controls">
        <div className="rec-clock" data-testid="bar-timer">
          <span className="rec-dots" aria-hidden="true" />
          <span>{paused ? "Paused" : "Recording"} · {clock(recorded)}</span>
          <span className="rec-dots" aria-hidden="true" />
        </div>
        <div className="rec-controls">
          <span className="rec-spacer" />
          <button className={`rec-tab ${paused ? "is-paused" : "is-live"}`} onClick={paused ? resume : pause} aria-label={paused ? "Resume recording" : "Pause recording"} data-testid="record-button">
            <Mic />
          </button>
          <button className="stop-tab" onClick={() => { void stop(); if (pathname !== "/") router.push("/"); }} aria-label="Stop recording" data-testid="stop-button">
            <span />
          </button>
        </div>
      </nav>
    );
  }

  return (
    <nav className="tabs">
      {TABS.map((t) => {
        if (!t) {
          return (
            <button
              key="record"
              className="rec-tab"
              // One tap starts recording from any screen and brings up the Record screen. A stray tap is
              // harmless: a recording stopped within two seconds is not kept (see RecorderProvider).
              onClick={() => { void start(); if (pathname !== "/") router.push("/"); }}
              disabled={engaged}
              aria-label={engaged ? "Saving the last recording" : "Start recording"}
              data-testid="record-button"
            >
              <Mic />
            </button>
          );
        }
        // Home covers both of its headers: Conversations (/notes) and Action Items (/todos).
        const on = pathname.startsWith(t.href) || (t.href === "/settings" && pathname.startsWith("/trash")) || (t.href === "/notes" && pathname.startsWith("/todos"));
        return <Link key={t.href} href={t.href} className={on ? "on" : ""}>{t.glyph}<span>{t.label}</span></Link>;
      })}
    </nav>
  );
}
