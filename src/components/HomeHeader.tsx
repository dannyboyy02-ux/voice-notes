"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The top of Home: a title, an optional action on the right, and the two headers to choose between. */
export default function HomeHeader({ action }: { action?: React.ReactNode }) {
  const pathname = usePathname();
  const onActions = pathname.startsWith("/todos");
  return (
    <>
      <div className="spread">
        <h1>Home</h1>
        {action}
      </div>
      <nav className="headers" aria-label="Home sections">
        <Link href="/notes" className={onActions ? "" : "on"} aria-current={onActions ? undefined : "page"}>Conversations</Link>
        <Link href="/todos" className={onActions ? "on" : ""} aria-current={onActions ? "page" : undefined}>Action Items</Link>
      </nav>
    </>
  );
}
