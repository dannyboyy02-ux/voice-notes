"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppShell";

/**
 * How the app works, opened from Settings. Holds the explanations that used to sit on the screens
 * themselves, so the screens stay clean and the detail is still there when it is wanted.
 */
export default function AboutPage() {
  const { userId } = useApp();
  const [copied, setCopied] = useState(false);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Copying was refused; the id is shown in full and can be selected by hand.
    }
  };

  return (
    <>
      <div className="spread">
        <h1>About</h1>
        <Link className="btn small secondary" href="/settings" data-testid="back">Back</Link>
      </div>

      <section className="card about" data-testid="about-recording">
        <h2>Recording</h2>
        <ul>
          <li>Tap the blue microphone to start recording, from any screen. Tap it again to pause; tap the red square to finish.</li>
          <li>Audio is saved on this phone every few seconds, so nothing is lost if the app closes. It uploads when you stop.</li>
          <li>Keep the screen open while recording. Locking the phone or switching apps stops the recording.</li>
          <li>A recording stopped within 2 seconds is treated as a stray tap and is not kept.</li>
          <li>After the app has been fully closed, iPhone asks for the microphone again. Leaving the app open in the background avoids the question.</li>
        </ul>
      </section>

      <section className="card about" data-testid="about-conversations">
        <h2>Conversations and folders</h2>
        <ul>
          <li>Swipe a conversation left to delete it. Press and hold it for Share, Copy transcript, Move to folder, Export and Delete.</li>
          <li>Deleted conversations wait in Trash, in Settings, for 30 days before they are erased.</li>
          <li>To bring in an audio file made elsewhere, tap the cloud at the top of Home or of a folder.</li>
          <li>A conversation sits in one folder at a time. File it with Move to folder, or from inside a folder with the three dots and Add conversations.</li>
        </ul>
      </section>

      <section className="card about" data-testid="about-items">
        <h2>Action Items</h2>
        <ul>
          <li>A to-do or reminder you tick moves to <b>Done today</b> and stays there until midnight. Untick it to open it again.</li>
          <li>After that it is kept, not deleted: <b>Show earlier</b> at the foot of Action Items lists everything completed before today. Items from a recording also stay, ticked, inside that conversation and in search, and Zeus can still see them.</li>
        </ul>
      </section>

      <section className="card about" data-testid="about-zeus">
        <h2>Zeus</h2>
        <ul>
          <li>From the Zeus tab, Zeus reads your 40 most recent conversations (their summaries, to-dos and reminders) plus the transcript lines that match your question.</li>
          <li>Inside a conversation, under the lightning bolt, Zeus reads that conversation&apos;s whole transcript.</li>
          <li>Zeus can add, change, complete or remove to-dos and reminders when you ask. Each change is shown with a ✓. Before an item is removed or marked done, Zeus shows it with a button, and nothing happens until you tap it. It cannot change recordings, transcripts or summaries.</li>
          <li>Someone else&apos;s words in a recording are never instructions to Zeus. A reminder taken from a recording arrives as &quot;Reminder from a recording&quot;, so you can tell it from one you added.</li>
          <li>Zeus runs on Claude Sonnet 5.5. Chats are saved on this phone only.</li>
        </ul>
      </section>

      <section className="card about" data-testid="about-ai">
        <h2>AI model setting</h2>
        <ul>
          <li><b>Auto</b> uses Claude Haiku 5.5 for one speaker and 10 minutes or less, and Claude Opus 5.5 for anything else. When Haiku says it is unsure, Opus reads it again.</li>
          <li><b>Best</b> always uses Opus 5.5. <b>Cheapest</b> always uses Haiku 5.5.</li>
          <li><b>Redo</b> appears under a summary that Haiku wrote. It has Opus read the transcript again and rewrite the title, summary, to-dos and reminders. Items you have ticked, changed or dismissed are kept.</li>
        </ul>
      </section>

      <section className="card about" data-testid="about-cost">
        <h2>This month</h2>
        <ul>
          <li>The time and cost in Settings are an estimate from this app&apos;s own log, at list prices. They are not your AssemblyAI or Claude bill, and Zeus chats are not included.</li>
        </ul>
      </section>

      <section className="card about" data-testid="about-privacy">
        <h2>Where your recordings go</h2>
        <ul>
          <li>Audio is sent to AssemblyAI to be transcribed. The transcript is sent to the Claude API to write the summary, to-dos and reminders.</li>
          <li>When you ask Zeus a question, the relevant transcripts, summaries and items are sent to the Claude API too.</li>
          <li>AssemblyAI&apos;s copy of the transcript is deleted as soon as the transcript is saved in this app, usually within a minute of it being ready.</li>
          <li>Audio is deleted from storage 30 days after processing. Transcripts and items stay in this app until you delete the conversation.</li>
          <li>Recording other people can require their consent where you are.</li>
        </ul>
      </section>

      <section className="card about" data-testid="about-account">
        <h2>Your account</h2>
        <p className="small">
          Your account id is your login&apos;s number inside the app&apos;s database. The server accepts only this account; it was saved as OWNER_USER_ID in Vercel when the app was set up. You would need it only if the server is ever set up again.
        </p>
        <div className="mono" data-testid="account-id">{userId}</div>
        <button className="btn small secondary" style={{ alignSelf: "flex-start" }} onClick={copyId}>{copied ? "Copied" : "Copy account id"}</button>
      </section>
    </>
  );
}
