import "server-only";
import { AssemblyAI } from "assemblyai";
import { need } from "./env";

export type SttUtterance = { speaker: string; start: number; end: number; text: string };
export type SttState =
  | { status: "waiting" }
  | { status: "error"; error: string }
  | { status: "done"; utterances: SttUtterance[]; durationMs: number | null; speakers: number };

let client: AssemblyAI | null = null;
const aai = () => (client ??= new AssemblyAI({ apiKey: need("ASSEMBLYAI_API_KEY") }));

/** Starts a pre-recorded transcription with speaker labels. Returns the job id straight away. */
export async function submitTranscript(audioUrl: string): Promise<string> {
  const t = await aai().transcripts.submit({ audio_url: audioUrl, speaker_labels: true });
  return t.id;
}

export async function getTranscript(id: string): Promise<SttState> {
  const t = await aai().transcripts.get(id);
  if (t.status === "error") return { status: "error", error: t.error ?? "The speech service reported an error." };
  if (t.status !== "completed") return { status: "waiting" };
  let utterances: SttUtterance[] = (t.utterances ?? []).map((u) => ({ speaker: u.speaker, start: u.start, end: u.end, text: u.text }));
  if (!utterances.length && t.text?.trim()) {
    utterances = [{ speaker: "A", start: 0, end: Math.round((t.audio_duration ?? 0) * 1000), text: t.text }];
  }
  return {
    status: "done",
    utterances,
    durationMs: t.audio_duration != null ? Math.round(t.audio_duration * 1000) : null,
    speakers: new Set(utterances.map((u) => u.speaker)).size,
  };
}

export async function deleteTranscript(id: string): Promise<void> {
  await aai().transcripts.delete(id);
}
