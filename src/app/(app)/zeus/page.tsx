"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import ZeusChat from "@/components/ZeusChat";

/** The Zeus screen. With ?note=<id> it is about that one conversation; otherwise about all of them. */
function FromAddress() {
  const note = useSearchParams().get("note");
  return <ZeusChat key={note ?? "all"} initialNoteId={note} />;
}

export default function ZeusPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <FromAddress />
    </Suspense>
  );
}
