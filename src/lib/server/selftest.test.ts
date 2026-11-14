import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "./fake-db.testutil";

let db: FakeDb;
vi.mock("./db", () => ({ adminDb: () => db.client, AUDIO_BUCKET: "audio" }));
vi.mock("./stt", () => ({ deleteTranscript: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./tick", () => ({ runUntilIdle: vi.fn() }));
vi.mock("./zeus", () => ({ buildContext: vi.fn(), streamAnswer: vi.fn() }));

const { removeTestData } = await import("./selftest");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("self-test clean-up", () => {
  it("removes only the owner's test rows and files inside the owner's folder", async () => {
    db = fakeDb({
      recordings: [
        { id: "mine", user_id: OWNER, is_test: true, storage_path: `${OWNER}/selftest-1.mp3` },
        { id: "mine-elsewhere", user_id: OWNER, is_test: true, storage_path: `${OTHER}/theirs.mp3` },
        { id: "mine-real", user_id: OWNER, is_test: false, storage_path: `${OWNER}/real.m4a` },
        { id: "theirs", user_id: OTHER, is_test: true, storage_path: `${OTHER}/selftest-2.mp3` },
      ],
      items: [
        { id: "i1", user_id: OWNER, is_test: true },
        { id: "i2", user_id: OTHER, is_test: true },
        { id: "i3", user_id: OWNER, is_test: false },
      ],
    });
    const left = await removeTestData(OWNER);
    expect(db.removed).toEqual([`${OWNER}/selftest-1.mp3`]);
    expect(db.tables.recordings.map((r) => r.id)).toEqual(["mine-real", "theirs"]);
    expect(db.tables.items.map((r) => r.id)).toEqual(["i2", "i3"]);
    expect(left).toEqual({ test_recordings_left: 0, test_items_left: 0, test_audio_files_left: 0 });
  });
});
