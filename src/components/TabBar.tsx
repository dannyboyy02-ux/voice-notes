"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clock } from "@/lib/format";
import { useRecorder } from "./RecorderProvider";

const icon = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const TABS = [
  { href: "/notes", label: "Notes", glyph: <svg {...icon}><path d="M6 3h9l4 4v14H6z" /><path d="M9 11h7M9 15h7" /></svg> },
  { href: "/todos", label: "To-dos", glyph: <svg {...icon}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12l3 3 5-6" /></svg> },
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
const Pause = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>
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
 * The bottom bar. Idle: four tabs around a blue microphone. Recording: the microphone becomes
 * pause (and, once paused, a microphone again to resume), with a stop button to its right.
 */
export default function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { recording, paused, start, pause, resume, stop } = useRecorder();
  const recorded = useRecordedMs();

  if (recording) {
    return (
      <nav className="tabs recording" aria-label="Recording controls">
        <div className="rec-clock" data-testid="bar-timer">
          <span className={`rec-dot ${paused ? "paused" : ""}`} />
          {paused ? "Paused" : "Recording"} · {clock(recorded)}
        </div>
        <div className="rec-controls">
          <span className="rec-spacer" />
          <button className="rec-tab" onClick={paused ? resume : pause} aria-label={paused ? "Resume recording" : "Pause recording"} data-testid="record-button">
            {paused ? <Mic /> : <Pause />}
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
              // From another screen the first tap only brings up the Record screen, so a stray tap cannot start a recording.
              onClick={() => { if (pathname === "/") void start(); else router.push("/"); }}
              aria-label={pathname === "/" ? "Start recording" : "Open the Record screen"}
              data-testid="record-button"
            >
              <Mic />
            </button>
          );
        }
        const on = pathname.startsWith(t.href) || (t.href === "/settings" && pathname.startsWith("/trash"));
        return <Link key={t.href} href={t.href} className={on ? "on" : ""}>{t.glyph}<span>{t.label}</span></Link>;
      })}
    </nav>
  );
}
