import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "@/lib/server/fake-db.testutil";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const THEIRS = "aaaaaaaa-0000-4000-8000-000000000009";

let db: FakeDb;
const kicked = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => kicked(fn) }));
vi.mock("@/lib/server/db", () => ({ adminDb: () => db.client }));
vi.mock("@/lib/server/auth", () => ({ requireOwner: async () => ({ userId: OWNER }) }));
vi.mock("@/lib/server/tick", () => ({ runUntilIdle: vi.fn(async () => 0) }));
const { POST } = await import("./route");

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: OWNER, title: `Recording ${id.slice(-1)}`, started_at: "2026-11-18T14:00:00.000Z", time_zone: "America/New_York",
  duration_ms: 20_000, status: "ready", is_test: false, deleted_at: null, folder_id: "folder-1", merged_from: null, storage_path: `${OWNER}/${id}.m4a`, ...over,
});
const line = (recording_id: string, idx: number, speaker: string, text: string) =>
  ({ recording_id, user_id: OWNER, idx, speaker, start_ms: idx * 6000, end_ms: idx * 6000 + 5500, text, segment: 0 });
const item = (recording_id: string, text: string, state: string, at_ms: number | null) =>
  ({ id: crypto.randomUUID(), recording_id, user_id: OWNER, type: "todo", text, state, at_ms, due_at: null, notified_at: null, created_at: "2026-11-18T15:00:00Z", fts: "x" });

function seed() {
  db = fakeDb({
    recordings: [
      rec(A),
      rec(B, { started_at: "2026-11-18T14:12:20.000Z" }),
      rec(THEIRS, { user_id: OTHER }),
    ],
    utterances: [
      line(A, 0, "A", "Morning everyone, let's start with the dock schedule."),
      line(A, 1, "B", "Sam can start on the sixteenth if the survey arrives."),
      line(A, 2, "A", "Then I will email Sam the property survey tonight."),
      line(B, 0, "A", "Back from the break, the fuel numbers came in high."),
      line(B, 1, "B", "Order the pallet jacks today, the budget is approved."),
    ],
    items: [
      item(A, "Email Sam the property survey", "active", 12_000),
      item(B, "Email Sam the property survey", "done", 3_000),
      item(B, "Order the pallet jacks", "active", 6_000),
      item(B, "Skip the vendor call", "dismissed", null),
    ],
  });
}
const call = (body: unknown) => POST(new Request("http://x/api/recordings/merge", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => { seed(); kicked.mockReset(); });

describe("merge route: preview", () => {
  it("returns the plan and changes nothing", async () => {
    const res = await call({ ids: [B, A] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order).toEqual([A, B]);
    expect(body.segments[1].seam).toEqual({ kind: "gap", gap_ms: 12 * 60_000 });
    expect(body.lines).toBe(5);
    expect(body.databaseReady).toBe(true);
    expect(db.calls.filter((c) => !c.startsWith("select"))).toEqual([]);
    expect(db.tables.recordings).toHaveLength(3);
  });

  it("refuses another account's conversation, one still processing or in Trash, and a malformed request", async () => {
    expect((await call({ ids: [A, THEIRS] })).status).toBe(404);
    db.tables.recordings[1].status = "extracting";
    expect((await call({ ids: [A, B] })).status).toBe(409);
    db.tables.recordings[1].status = "ready";
    db.tables.recordings[1].deleted_at = "2026-11-18T16:00:00Z";
    expect((await call({ ids: [A, B] })).status).toBe(409);
    expect((await call({ ids: [A] })).status).toBe(400);
    expect((await call({ ids: [A, "not-a-uuid"] })).status).toBe(400);
  });
});

describe("merge route: commit", () => {
  it("builds the merged conversation, copies the items once each, and moves the originals to Trash", async () => {
    const res = await call({ ids: [A, B], speakers: { [`${B}:A`]: "A" }, commit: true });
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const merged = db.tables.recordings.find((r) => r.id === id)!;
    expect(merged).toMatchObject({ user_id: OWNER, status: "transcribed", folder_id: "folder-1", started_at: "2026-11-18T14:00:00.000Z", speakers: 3 });
    expect((merged.merged_from as { recording_id: string }[]).map((p) => p.recording_id)).toEqual([A, B]);

    const lines = db.tables.utterances.filter((u) => u.recording_id === id).sort((x, y) => Number(x.idx) - Number(y.idx));
    expect(lines.map((l) => l.text)).toEqual([
      "Morning everyone, let's start with the dock schedule.",
      "Sam can start on the sixteenth if the survey arrives.",
      "Then I will email Sam the property survey tonight.",
      "Back from the break, the fuel numbers came in high.",
      "Order the pallet jacks today, the budget is approved.",
    ]);
    expect(lines.map((l) => l.segment)).toEqual([0, 0, 0, 1, 1]);
    // The second recording's A was matched to the first's A; its B is someone new.
    expect(lines.map((l) => l.speaker)).toEqual(["A", "B", "A", "A", "C"]);
    // Its timeline continues after the first recording's 20 seconds.
    expect(lines[3].start_ms).toBe(20_000);

    const items = db.tables.items.filter((i) => i.recording_id === id);
    expect(items.map((i) => [i.text, i.state, i.at_ms]).sort()).toEqual([
      ["Email Sam the property survey", "done", 23_000],
      ["Order the pallet jacks", "active", 26_000],
      ["Skip the vendor call", "dismissed", null],
    ]);
    expect(items.every((i) => i.fts === undefined && i.user_id === OWNER)).toBe(true);

    for (const original of [A, B]) {
      expect(db.tables.recordings.find((r) => r.id === original)).toMatchObject({ merged_into: id });
      expect(db.tables.recordings.find((r) => r.id === original)!.deleted_at).toBeTruthy();
    }
    // The originals keep their own items and lines, so restoring one from Trash gives it back whole.
    expect(db.tables.items.filter((i) => i.recording_id === A)).toHaveLength(1);
    expect(db.tables.utterances.filter((u) => u.recording_id === B)).toHaveLength(2);
    expect(kicked).toHaveBeenCalledTimes(1);
  });

  it("leaves everything as it was when a step fails part-way", async () => {
    const real = db.client.from;
    db.client.from = ((table: string) => {
      const q = real(table);
      if (table !== "items") return q;
      const insert = q.insert;
      q.insert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        insert(rows);
        return { then: (resolve: (r: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { message: "items failed" } })) } as never;
      };
      return q;
    }) as typeof db.client.from;
    const res = await call({ ids: [A, B], commit: true });
    expect(res.status).toBe(500);
    expect(db.tables.recordings.map((r) => r.id).sort()).toEqual([A, B, THEIRS].sort());
    expect(db.tables.recordings.every((r) => !r.deleted_at && !r.merged_into)).toBe(true);
  });
});
