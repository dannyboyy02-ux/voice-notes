import { describe, expect, it } from "vitest";
import { applyClaim, claimTarget, LOCK_MS, MAX_ATTEMPTS, onStepFailure, onStepSuccess, redoPatch, retryPatch, type Claimable, type Status } from "./steps";

const NOW = new Date("2026-11-11T12:00:00Z");
const past = new Date(NOW.getTime() - 1000).toISOString();
const future = new Date(NOW.getTime() + 60_000).toISOString();
const rec = (status: Status, attempts = 0, locked_until: string | null = null, aai_transcript_id: string | null = null): Claimable => ({ status, attempts, locked_until, aai_transcript_id });

describe("claiming a step", () => {
  it("moves uploaded to transcribing and transcribed to extracting", () => {
    expect(claimTarget(rec("uploaded"), NOW)).toBe("transcribing");
    expect(claimTarget(rec("transcribed"), NOW)).toBe("extracting");
  });
  it("counts the attempt and locks the row for longer than a function can run", () => {
    const claimed = applyClaim(rec("uploaded"), NOW)!;
    expect(claimed).toMatchObject({ status: "transcribing", attempts: 1 });
    expect(new Date(claimed.locked_until!).getTime() - NOW.getTime()).toBe(LOCK_MS);
    expect(LOCK_MS).toBeGreaterThan(300_000);
  });
  it("gives a second worker nothing while the first holds the lock", () => {
    const claimed = applyClaim(rec("transcribed"), NOW)!;
    expect(claimTarget(claimed, NOW)).toBeNull();
    expect(applyClaim(claimed, NOW)).toBeNull();
  });
  it("lets a crashed step be claimed again once its lock expires", () => {
    expect(claimTarget(rec("extracting", 1, past), NOW)).toBe("extracting");
    expect(claimTarget(rec("transcribing", 1, past), NOW)).toBe("transcribing");
    expect(claimTarget(rec("extracting", 1, future), NOW)).toBeNull();
  });
  it("does not resubmit a transcription that is waiting on the speech service", () => {
    expect(claimTarget(rec("transcribing", 1, past, "job_123"), NOW)).toBeNull();
  });
  it("never claims finished or failed recordings", () => {
    expect(claimTarget(rec("ready"), NOW)).toBeNull();
    expect(claimTarget(rec("failed", 3), NOW)).toBeNull();
  });
  it("stops claiming after three attempts", () => {
    expect(claimTarget(rec("uploaded", MAX_ATTEMPTS), NOW)).toBeNull();
    expect(claimTarget(rec("extracting", MAX_ATTEMPTS, past), NOW)).toBeNull();
  });
});

describe("finishing a step", () => {
  it("moves on with a clean retry count", () => {
    expect(onStepSuccess("transcribing")).toEqual({ status: "transcribed", attempts: 0, locked_until: null, last_error: null });
    expect(onStepSuccess("extracting")).toMatchObject({ status: "ready", attempts: 0 });
  });
  it("goes back to the step's start on the first and second failure", () => {
    expect(onStepFailure("transcribing", 1, "boom")).toMatchObject({ status: "uploaded", failed_step: null, last_error: "boom" });
    expect(onStepFailure("extracting", 2, "boom")).toMatchObject({ status: "transcribed", failed_step: null });
  });
  it("fails on the third failure and remembers which step", () => {
    expect(onStepFailure("extracting", 3, "boom")).toMatchObject({ status: "failed", failed_step: "extracting" });
    expect(onStepFailure("transcribing", 3, "boom")).toMatchObject({ status: "failed", failed_step: "transcribing" });
  });
  it("walks a recording that keeps failing through exactly three attempts", () => {
    let r: Claimable = rec("transcribed");
    const seen: string[] = [];
    for (let tick = 0; tick < 10; tick++) {
      const claimed = applyClaim(r, NOW);
      if (!claimed) break;
      const after = onStepFailure(claimed.status, claimed.attempts, "Claude was unreachable");
      seen.push(`${claimed.attempts}:${after.status}`);
      r = { ...claimed, ...after };
    }
    expect(seen).toEqual(["1:transcribed", "2:transcribed", "3:failed"]);
    expect(claimTarget(r, NOW)).toBeNull();
  });
  it("walks the happy path uploaded > transcribing > transcribed > extracting > ready", () => {
    let r: Claimable = rec("uploaded");
    const path: Status[] = [r.status];
    for (let i = 0; i < 2; i++) {
      const claimed = applyClaim(r, NOW)!;
      path.push(claimed.status);
      r = { ...claimed, ...onStepSuccess(claimed.status) };
      path.push(r.status);
    }
    expect(path).toEqual(["uploaded", "transcribing", "transcribed", "extracting", "ready"]);
  });
  it("trims long error text", () => {
    expect(onStepFailure("extracting", 1, "x".repeat(2000)).last_error).toHaveLength(500);
  });
});

describe("Retry and Redo", () => {
  it("Retry restarts the failed step with a fresh count", () => {
    expect(retryPatch("transcribing", false)).toMatchObject({ status: "uploaded", attempts: 0, failed_step: null });
    expect(retryPatch("extracting", true)).toMatchObject({ status: "transcribed", attempts: 0 });
  });
  it("Retry without a recorded step picks by whether a transcript exists", () => {
    expect(retryPatch(null, true).status).toBe("transcribed");
    expect(retryPatch(null, false).status).toBe("uploaded");
  });
  it("Redo reruns extraction on the best model", () => {
    expect(redoPatch()).toMatchObject({ status: "transcribed", attempts: 0, model_override: "best" });
    expect(claimTarget({ ...rec("ready"), ...redoPatch() }, NOW)).toBe("extracting");
  });
});
