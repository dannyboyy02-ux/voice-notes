"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import ImportButton from "./ImportButton";
import SearchScreen from "./SearchScreen";

const icon = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

/**
 * The top of Home: a title, a magnifying glass that opens search, a plus that imports an audio file,
 * and the two headers to choose between.
 */
export default function HomeHeader() {
  const pathname = usePathname();
  const onActions = pathname.startsWith("/todos");
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  return (
    <>
      <div className="spread">
        <h1>Home</h1>
        <div className="row">
          <button className="icon-btn" onClick={() => setSearching(true)} aria-label="Search" data-testid="search-button">
            <svg {...icon}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.8-3.8" /></svg>
          </button>
          <ImportButton className="icon-btn" place={onActions ? "under Conversations" : "below"} onMessage={(text, ok) => setNotice({ text, ok })}>
            <svg {...icon}><path d="M12 5v14M5 12h14" /></svg>
          </ImportButton>
        </div>
      </div>
      <nav className="headers" aria-label="Home sections">
        <Link href="/notes" className={onActions ? "" : "on"} aria-current={onActions ? undefined : "page"}>Conversations</Link>
        <Link href="/todos" className={onActions ? "on" : ""} aria-current={onActions ? "page" : undefined}>Action Items</Link>
      </nav>
      {notice && <div className={`banner ${notice.ok ? "ok" : "rec"}`} data-testid="import-message">{notice.text}</div>}
      {searching && <SearchScreen onClose={() => setSearching(false)} />}
    </>
  );
}
