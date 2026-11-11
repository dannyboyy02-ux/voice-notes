import type { Status, WorkStep } from "./pipeline/steps";
import type { ModelMode } from "./models";

export type Recording = {
  id: string; started_at: string; time_zone: string; duration_ms: number | null; storage_path: string | null;
  bytes: number | null; part: number; status: Status; failed_step: WorkStep | null; attempts: number; last_error: string | null;
  speakers: number | null; model_used: string | null; input_tokens: number | null; output_tokens: number | null;
  llm_cost_usd: number | null; stt_cost_usd: number | null; title: string | null; summary: string | null;
  ready_at: string | null; audio_deleted_at: string | null; created_at: string;
};
export type Utterance = { idx: number; speaker: string; start_ms: number; end_ms: number; text: string };
export type Item = {
  id: string; recording_id: string | null; type: "todo" | "reminder"; text: string; due_at: string | null;
  due_local: string | null; said: string | null; quote: string | null; at_ms: number | null;
  state: "suggested" | "active" | "done" | "dismissed"; needs_review: boolean; notified_at: string | null;
  apple_sent_at: string | null; created_at: string;
  /** The recording the item came from, when it has one. */
  recording?: { title: string | null; started_at: string; deleted_at?: string | null } | null;
};
export type Settings = { model_mode: ModelMode; apple_reminders: boolean };
export const ITEM_COLUMNS = "id, recording_id, type, text, due_at, due_local, said, quote, at_ms, state, needs_review, notified_at, apple_sent_at, created_at";
