import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "./fake-db.testutil";

// The worker runs as written against an in-memory database; the speech service, Claude and push are stubs.
let db: FakeDb;
vi.mock("./db", () => ({ adminDb: () => db.client, AUDIO_BUCKET: "audio" }));
const stt = vi.hoisted(() => ({ getTranscript: vi.fn(), submitTranscript: vi.fn(), deleteTranscript: vi.fn() }));
vi.mock("./stt", () => stt);
vi.mock("./extract", () => ({ runExtraction: vi.fn() }));
const push = vi.hoisted(() => ({ sendPush: vi.fn() }));
vi.mock("./push", () => push);

const { runTick, inOwnFolder } = await import("./tick");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OLD = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();

const rec = (over: Record<string, unknown>) => ({
  id: "r", user_id: OWNER, status: "ready", attempts: 0, started_at: OLD, time_zone: "UTC", duration_ms: 1000,
  storage_path: null, aai_transcript_id: null, speakers: 1, model_override: null, is_test: false, title: "t",
  deleted_at: null, audio_deleted_at: null, ready_at: OLD, ...over,
});

beforeEach(() => {
  vi.stubEnv("OWNER_USER_ID", OWNER);
  stt.deleteTranscript.mockReset().mockResolvedValue(undefined);
  stt.getTranscript.mockReset().mockResolvedValue({
    status: "done", durationMs: 1000, speakers: 1, utterances: [{ speaker: "A", start: 0, end: 900, text: "hello" }],
  });
});

describe("worker: transcripts are saved only for the owner", () => {
  it("does not fetch or save another account's transcript, and stops that recording as failed", async () => {
    const theirs = rec({ id: "theirs", user_id: OTHER, status: "transcribing", aai_transcript_id: "job-1", storage_path: `${OTHER}/a.m4a` });
    db = fakeDb({ recordings: [theirs], utterances: [] }, { claim_poll: () => [{ ...theirs }] });
    const report = await runTick(5_000);
    expect(stt.getTranscript).not.toHaveBeenCalled();
    expect(db.tables.utterances).toHaveLength(0);
    expect(db.tables.recordings[0]).toMatchObject({ status: "failed", last_error: "Not the owner's recording.", aai_transcript_id: null });
    expect(report.polled).toEqual([{ id: "theirs", result: "skipped: not the owner's" }]);
  });

  it("still saves the owner's transcript", async () => {
    const mine = rec({ id: "mine", status: "transcribing", aai_transcript_id: "job-2", storage_path: `${OWNER}/a.m4a` });
    db = fakeDb({ recordings: [mine], utterances: [] }, { claim_poll: () => [{ ...mine }] });
    const report = await runTick(5_000);
    expect(stt.getTranscript).toHaveBeenCalledWith("job-2");
    expect(db.tables.utterances).toMatchObject([{ recording_id: "mine", user_id: OWNER, text: "hello" }]);
    expect(report.polled).toEqual([{ id: "mine", result: "transcribed" }]);
  });
});

describe("worker: 30-day audio clean-up deletes only files in the recording's own folder", () => {
  it("deletes the owner's old audio and nothing else", async () => {
    db = fakeDb({
      recordings: [
        rec({ id: "mine", storage_path: `${OWNER}/mine.m4a` }),
        rec({ id: "points-elsewhere", storage_path: `${OTHER}/theirs.m4a` }),
        rec({ id: "climbs-out", storage_path: `${OWNER}/../${OTHER}/theirs.m4a` }),
        rec({ id: "theirs", user_id: OTHER, storage_path: `${OTHER}/theirs.m4a` }),
      ],
    });
    const report = await runTick(5_000);
    expect(db.removed).toEqual([`${OWNER}/mine.m4a`]);
    expect(report.audio_deleted).toBe(1);
    const byId = Object.fromEntries(db.tables.recordings.map((r) => [r.id, r]));
    expect(byId["mine"]).toMatchObject({ storage_path: null });
    expect(byId["mine"].audio_deleted_at).toBeTruthy();
    // A link outside the folder is dropped (so it is not tried again) without deleting the file it named.
    expect(byId["points-elsewhere"]).toMatchObject({ storage_path: null, audio_deleted_at: null });
    expect(byId["climbs-out"]).toMatchObject({ storage_path: null, audio_deleted_at: null });
    // Another account's rows are not even looked at.
    expect(byId["theirs"]).toMatchObject({ storage_path: `${OTHER}/theirs.m4a`, audio_deleted_at: null });
    expect(report.errors.filter((e) => e.startsWith("audio delete"))).toHaveLength(2);
  });
});

describe("worker: emptying Trash deletes only files in the recording's own folder", () => {
  it("erases the owner's old Trash, leaves files outside its folder, and ignores other accounts", async () => {
    db = fakeDb({
      recordings: [
        rec({ id: "mine", deleted_at: OLD, storage_path: `${OWNER}/mine.m4a` }),
        rec({ id: "points-elsewhere", deleted_at: OLD, storage_path: `${OTHER}/theirs.m4a`, audio_deleted_at: OLD }),
        rec({ id: "theirs", user_id: OTHER, deleted_at: OLD, storage_path: `${OTHER}/theirs.m4a`, audio_deleted_at: OLD }),
      ],
    });
    const report = await runTick(5_000);
    expect(db.removed).toEqual([`${OWNER}/mine.m4a`]);
    expect(db.tables.recordings.map((r) => r.id)).toEqual(["theirs"]);
    expect(report.trash_emptied).toBe(2);
    expect(report.errors).toContain("trash audio: recording points-elsewhere pointed outside its own folder; no file was deleted");
  });
});

describe("inOwnFolder", () => {
  it("accepts only a path inside the recording's own folder", () => {
    expect(inOwnFolder({ user_id: OWNER, storage_path: `${OWNER}/a.m4a` })).toBe(true);
    expect(inOwnFolder({ user_id: OWNER, storage_path: `${OTHER}/a.m4a` })).toBe(false);
    expect(inOwnFolder({ user_id: OWNER, storage_path: `${OWNER}/../${OTHER}/a.m4a` })).toBe(false);
    expect(inOwnFolder({ user_id: OWNER, storage_path: `${OWNER}a.m4a` })).toBe(false);
    expect(inOwnFolder({ user_id: "", storage_path: "/a.m4a" })).toBe(false);
    expect(inOwnFolder({ user_id: OWNER, storage_path: null })).toBe(false);
  });
});

describe("worker: reminder notifications", () => {
  it("says when a reminder came from a recording, so one planted by someone else's words stands out", async () => {
    push.sendPush.mockReset().mockResolvedValue({ subscriptions: 1, sent: 1, errors: [] });
    const due = [
      { id: "from-rec", user_id: OWNER, text: "Call the bank on 555-0100", recording_id: "r" },
      { id: "by-hand", user_id: OWNER, text: "Renew registration", recording_id: null },
    ];
    db = fakeDb({ recordings: [], items: due.map((d) => ({ ...d })) }, { claim_due_reminders: () => due });
    await runTick(5_000);
    expect(push.sendPush.mock.calls.map((c) => [c[1].title, c[1].body])).toEqual([
      ["Reminder from a recording", "Call the bank on 555-0100"],
      ["Reminder", "Renew registration"],
    ]);
  });
});

describe("worker: the speech service's copy of a transcript is deleted once it is saved here", () => {
  it("deletes it right after the transcript lines are saved, and forgets the id", async () => {
    const mine = rec({ id: "mine", status: "transcribing", aai_transcript_id: "job-2", storage_path: `${OWNER}/a.m4a` });
    db = fakeDb({ recordings: [mine], utterances: [] }, { claim_poll: () => [{ ...mine }] });
    let savedFirst = false;
    stt.deleteTranscript.mockImplementation(async () => { savedFirst = db.tables.utterances.length === 1 && db.tables.recordings[0].status === "transcribed"; });
    const report = await runTick(5_000);
    expect(stt.deleteTranscript).toHaveBeenCalledWith("job-2");
    expect(savedFirst).toBe(true);
    expect(db.tables.recordings[0]).toMatchObject({ status: "transcribed", aai_transcript_id: null });
    expect(report.polled).toEqual([{ id: "mine", result: "transcribed" }]);
  });

  it("keeps the id for a later try when the delete fails, without failing the recording", async () => {
    const mine = rec({ id: "mine", status: "transcribing", aai_transcript_id: "job-3", storage_path: `${OWNER}/a.m4a` });
    db = fakeDb({ recordings: [mine], utterances: [] }, { claim_poll: () => [{ ...mine }] });
    stt.deleteTranscript.mockRejectedValue(new Error("HTTP Error: 503 Service Unavailable"));
    const report = await runTick(5_000);
    // The same pass's sweep (step 7) tries once more and reports the failure.
    expect(stt.deleteTranscript).toHaveBeenCalledTimes(2);
    expect(db.tables.recordings[0]).toMatchObject({ status: "transcribed", aai_transcript_id: "job-3" });
    expect(report.polled[0].result).toMatch(/^transcribed \(the speech service's copy is deleted later/);
    expect(report.errors).toContain("transcript delete: HTTP Error: 503 Service Unavailable");
  });

  it("sweeps leftover copies only where the text is saved here, and only the owner's", async () => {
    const recent = new Date().toISOString();
    db = fakeDb({
      recordings: [
        rec({ id: "ready", status: "ready", aai_transcript_id: "job-ready", created_at: recent }),
        rec({ id: "extracting", status: "extracting", aai_transcript_id: "job-extracting", created_at: recent }),
        rec({ id: "still-transcribing", status: "transcribing", aai_transcript_id: "job-busy", created_at: recent }),
        rec({ id: "failed-transcribing", status: "failed", aai_transcript_id: "job-failed", created_at: recent }),
        rec({ id: "theirs", user_id: OTHER, status: "ready", aai_transcript_id: "job-theirs", created_at: recent }),
      ],
    });
    const report = await runTick(5_000);
    expect(stt.deleteTranscript.mock.calls.map((c) => c[0]).sort()).toEqual(["job-extracting", "job-ready"]);
    expect(report.transcripts_deleted).toBe(2);
    const ids = Object.fromEntries(db.tables.recordings.map((r) => [r.id, r.aai_transcript_id]));
    expect(ids).toEqual({ ready: null, extracting: null, "still-transcribing": "job-busy", "failed-transcribing": "job-failed", theirs: "job-theirs" });
  });

  it("stops retrying a failing delete once the service's own 30-day retention has passed", async () => {
    stt.deleteTranscript.mockRejectedValue(new Error("HTTP Error: 400 Bad Request"));
    db = fakeDb({
      recordings: [
        rec({ id: "recent", aai_transcript_id: "job-recent", created_at: new Date().toISOString() }),
        rec({ id: "old", aai_transcript_id: "job-old", created_at: OLD }),
      ],
    });
    const report = await runTick(5_000);
    const ids = Object.fromEntries(db.tables.recordings.map((r) => [r.id, r.aai_transcript_id]));
    expect(ids).toEqual({ recent: "job-recent", old: null });
    expect(report.transcripts_deleted).toBe(0);
    expect(report.errors).toEqual(["transcript delete: HTTP Error: 400 Bad Request"]);
  });

  it("deletes any copy left behind when Trash is emptied", async () => {
    db = fakeDb({ recordings: [rec({ id: "binned", status: "failed", deleted_at: OLD, aai_transcript_id: "job-binned" })] });
    await runTick(5_000);
    expect(stt.deleteTranscript).toHaveBeenCalledWith("job-binned");
    expect(db.tables.recordings).toEqual([]);
  });
});
