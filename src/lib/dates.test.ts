import { describe, expect, it } from "vitest";
import { recordingAnchor, resolveDue } from "./dates";

// Tuesday 10 November 2026, 14:05 in New York (UTC-5).
const STARTED = "2026-11-10T19:05:00.000Z";
const NY = "America/New_York";

describe("resolveDue", () => {
  it("resolves a local wall-clock time in the recorder's time zone", () => {
    expect(resolveDue("2026-11-12 09:00", NY, STARTED)).toEqual({ dueAt: "2026-11-12T14:00:00.000Z", needsReview: false });
  });
  it("gives the same words a different instant in a different time zone", () => {
    expect(resolveDue("2026-11-12 09:00", "America/Los_Angeles", STARTED).dueAt).toBe("2026-11-12T17:00:00.000Z");
    expect(resolveDue("2026-11-12 09:00", "Europe/London", STARTED).dueAt).toBe("2026-11-12T09:00:00.000Z");
  });
  it("uses the right offset on each side of a clock change", () => {
    // US clocks go forward on 14 March 2027: before it New York is UTC-5, after it UTC-4.
    expect(resolveDue("2027-03-13 09:00", NY, STARTED).dueAt).toBe("2027-03-13T14:00:00.000Z");
    expect(resolveDue("2027-03-15 09:00", NY, STARTED).dueAt).toBe("2027-03-15T13:00:00.000Z");
  });
  it("defaults a day with no time to 9:00 that morning", () => {
    expect(resolveDue("2026-11-13", NY, STARTED).dueAt).toBe("2026-11-13T14:00:00.000Z");
  });
  it("accepts a T between date and time", () => {
    expect(resolveDue("2026-11-12T17:30", NY, STARTED).dueAt).toBe("2026-11-12T22:30:00.000Z");
  });
  it("sends a missing date to Review with no alarm", () => {
    expect(resolveDue(null, NY, STARTED)).toMatchObject({ dueAt: null, needsReview: true });
    expect(resolveDue("", NY, STARTED)).toMatchObject({ dueAt: null, needsReview: true });
  });
  it("sends vague or malformed dates to Review with no alarm", () => {
    for (const text of ["sometime next week", "next Thursday", "2026-13-40 09:00", "2026-02-30", "11/12/2026 9am"]) {
      expect(resolveDue(text, NY, STARTED), text).toMatchObject({ dueAt: null, needsReview: true });
    }
  });
  it("sends a time that does not exist (clocks going forward) to Review", () => {
    expect(resolveDue("2027-03-14 02:30", NY, STARTED)).toMatchObject({ dueAt: null, needsReview: true });
  });
  it("sends a date before the recording to Review", () => {
    expect(resolveDue("2026-11-09 09:00", NY, STARTED)).toMatchObject({ dueAt: null, needsReview: true });
  });
  it("sends a date more than two years out to Review", () => {
    expect(resolveDue("2030-01-01 09:00", NY, STARTED)).toMatchObject({ dueAt: null, needsReview: true });
  });
  it("sends an unknown time zone to Review", () => {
    expect(resolveDue("2026-11-12 09:00", "Mars/Olympus", STARTED)).toMatchObject({ dueAt: null, needsReview: true });
  });
});

describe("recordingAnchor", () => {
  it("states the weekday, local time and zone Claude resolves dates against", () => {
    expect(recordingAnchor(STARTED, NY)).toBe("Tuesday, 10 November 2026, 14:05 (America/New_York, UTC-05:00)");
  });
});
