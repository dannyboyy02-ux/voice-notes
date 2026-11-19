import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "./fake-db.testutil";
import { buildUserMessage } from "./extract";

let db: FakeDb;
vi.mock("./db", () => ({ adminDb: () => db.client, AUDIO_BUCKET: "audio" }));
vi.mock("./stt", () => ({ submitTranscript: vi.fn(), getTranscript: vi.fn(), deleteTranscript: vi.fn() }));
const runExtraction = vi.fn();
vi.mock("./extract", async (orig) => ({ ...(await orig<typeof import("./extract")>()), runExtraction: (...a: unknown[]) => runExtraction(...a) }));
vi.mock("./push", () => ({ sendPush: vi.fn(async () => ({ sent: 0, subscriptions: 0, errors: [] })) }));
const { runTick } = await import("./tick");

const OWNER = "11111111-1111-4111-8111-111111111111";
const pieces = [
  { recording_id: "a", title: "Dock schedule", started_at: "2026-11-18T14:00:00.000Z", offset_ms: 0, from_ms: 0, to_ms: 20_000, seam: { kind: "first" } },
  { recording_id: "b", title: "After the break", started_at: "2026-11-18T14:32:00.000Z", offset_ms: 20_000, from_ms: 0, to_ms: 12_000, seam: { kind: "gap", gap_ms: 12 * 60_000 } },
];

beforeEach(() => {
  vi.stubEnv("OWNER_USER_ID", OWNER);
  runExtraction.mockReset().mockResolvedValue({
    result: { title: "Dock and fuel", summary: "Two parts of one meeting.", confidence: "high", items: [] },
    modelUsed: "claude-haiku-5-5", inputTokens: 10, outputTokens: 5,
  });
});

describe("extraction of a merged conversation", () => {
  it("shows Claude where each recording begins, with when it began", async () => {
    const merged = {
      id: "m", user_id: OWNER, status: "extracting", attempts: 1, started_at: "2026-11-18T14:00:00.000Z", time_zone: "America/New_York",
      duration_ms: 32_000, storage_path: null, aai_transcript_id: null, speakers: 2, model_override: null, is_test: false, title: null, deleted_at: null, merged_from: pieces,
    };
    let claimed = false;
    db = fakeDb({
      recordings: [{ ...merged }],
      utterances: [
        { recording_id: "m", idx: 0, speaker: "A", start_ms: 0, text: "Morning, the dock schedule first.", segment: 0 },
        { recording_id: "m", idx: 1, speaker: "B", start_ms: 6000, text: "Sam starts on the sixteenth.", segment: 0 },
        { recording_id: "m", idx: 2, speaker: "A", start_ms: 20_000, text: "Back from the break: fuel.", segment: 1 },
      ],
      items: [], settings: [], llm_runs: [],
    }, { claim_recording: () => (claimed ? [] : ((claimed = true), [{ ...merged }])) });
    await runTick(5000);
    expect(runExtraction).toHaveBeenCalledTimes(1);
    const input = runExtraction.mock.calls[0][0] as Parameters<typeof buildUserMessage>[0];
    const message = buildUserMessage(input);
    expect(message).toContain("--- Recording 1 of 2: Dock schedule · began Wednesday, 18 November 2026, 09:00");
    expect(message).toContain("--- Recording 2 of 2: After the break · began Wednesday, 18 November 2026, 09:32");
    expect(message).toContain("12 min after recording 1 ended ---\n[00:20 | at_ms=20000] Speaker A: Back from the break: fuel.");
    expect(db.tables.recordings[0]).toMatchObject({ title: "Dock and fuel", status: "ready" });
  });

  it("leaves an ordinary recording's transcript without dividers", () => {
    const message = buildUserMessage({ lines: [{ speaker: "A", start_ms: 0, text: "Hello." }], startedAt: "2026-11-18T14:00:00Z", timeZone: "UTC" });
    expect(message).not.toContain("---");
  });
});
