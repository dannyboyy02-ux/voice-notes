import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "./extract-schema";
import { buildItemRows } from "./items";

const rec = { id: "rec-1", user_id: "user-1", started_at: "2026-11-10T19:05:00.000Z", time_zone: "America/New_York" };
const base = { said: null, quote: null, at_ms: null, needs_review: false };
const extraction = (items: ExtractionResult["items"]): ExtractionResult => ({ title: "t", summary: "s", confidence: "high", items });

describe("buildItemRows", () => {
  it("makes a clear to-do active with no date", () => {
    const [row] = buildItemRows(extraction([{ ...base, type: "todo", text: "Email Sam the survey", due_local: null }]), rec);
    expect(row).toMatchObject({ type: "todo", state: "active", due_at: null, needs_review: false, recording_id: "rec-1", user_id: "user-1" });
  });
  it("gives a dated reminder an alarm at the resolved instant", () => {
    const [row] = buildItemRows(extraction([{ ...base, type: "reminder", text: "Call the county", due_local: "2026-11-12 09:00", said: "Thursday morning" }]), rec);
    expect(row).toMatchObject({ state: "active", due_at: "2026-11-12T14:00:00.000Z", said: "Thursday morning" });
  });
  it("puts an unclear date in Review with no alarm", () => {
    const [row] = buildItemRows(extraction([{ ...base, type: "reminder", text: "Check in with Sam", due_local: null, said: "sometime next week", needs_review: true }]), rec);
    expect(row).toMatchObject({ state: "suggested", due_at: null, needs_review: true });
  });
  it("puts a reminder in Review when the model gave a date it could not have meant", () => {
    const [row] = buildItemRows(extraction([{ ...base, type: "reminder", text: "Old thing", due_local: "2026-11-01 09:00" }]), rec);
    expect(row).toMatchObject({ state: "suggested", due_at: null, needs_review: true });
  });
  it("never keeps an alarm on an item the model flagged for review", () => {
    const [row] = buildItemRows(extraction([{ ...base, type: "reminder", text: "Maybe call", due_local: "2026-11-12 09:00", needs_review: true }]), rec);
    expect(row).toMatchObject({ state: "suggested", due_at: null });
  });
  it("drops blank items and tidies positions", () => {
    const rows = buildItemRows(extraction([{ ...base, type: "todo", text: "  ", due_local: null }, { ...base, type: "todo", text: " Buy milk ", due_local: null, at_ms: 1234.6 }]), rec);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "Buy milk", at_ms: 1235 });
  });
});
