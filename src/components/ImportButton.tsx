"use client";

import { useRef, useState } from "react";
import { useRecorder } from "./RecorderProvider";

/**
 * Picks an audio file from the phone (Files, or an attachment saved from another app) and imports it.
 * The file is then uploaded, transcribed and summarised exactly like a recording made here.
 * Given children (an icon, say), the button shows those instead of its words. `place` says where the
 * imported recording will turn up, for the message shown afterwards.
 */
export default function ImportButton({ className = "btn small secondary", place = "below", onMessage, children }: { className?: string; place?: string; onMessage: (text: string, ok: boolean) => void; children?: React.ReactNode }) {
  const { importFile } = useRecorder();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className={className} disabled={busy} onClick={() => input.current?.click()} aria-label={children ? (busy ? "Importing audio" : "Import audio") : undefined} data-testid="import-button">
        {children ?? (busy ? "Importing…" : "Import audio")}
      </button>
      <input
        ref={input}
        type="file"
        // Listed by extension as well as by type: iPhone greys out some audio files when only "audio/*" is given.
        accept="audio/*,video/mp4,.m4a,.mp3,.wav,.aac,.ogg,.oga,.opus,.webm,.flac,.mp4"
        multiple
        hidden
        data-testid="import-input"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          const problems: string[] = [];
          for (const f of files) {
            const problem = await importFile(f);
            if (problem) problems.push(problem);
          }
          setBusy(false);
          const done = files.length - problems.length;
          if (problems.length) onMessage(problems.join(" "), false);
          else onMessage(`Importing ${done} file${done === 1 ? "" : "s"}. ${done === 1 ? "It appears" : "They appear"} ${place} once uploaded, then ${done === 1 ? "is" : "are"} transcribed like any recording.`, true);
        }}
      />
    </>
  );
}
