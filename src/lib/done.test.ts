import { describe, expect, it } from "vitest";
import { byDoneAt, doneToday, startOfToday } from "./done";

// 14 Nov 2026, 9:30 in the morning, in whatever time zone the test runs in.
const now = new Date(2026, 10, 14, 9, 30);
const local = (h: number, m = 0, day = 14) => new Date(2026, 10, day, h, m).toISOString();

describe("Done today", () => {
  it("starts at midnight on the phone", () => {
    expect(startOfToday(now).getTime()).toBe(new Date(2026, 10, 14, 0, 0).getTime());
  });
  it("holds items completed since midnight", () => {
    expect(doneToday({ state: "done", done_at: local(0, 0) }, now)).toBe(true);
    expect(doneToday({ state: "done", done_at: local(9, 29) }, now)).toBe(true);
  });
  it("drops items completed before midnight", () => {
    expect(doneToday({ state: "done", done_at: local(23, 59, 13) }, now)).toBe(false);
    expect(doneToday({ state: "done", done_at: null }, now)).toBe(false);
  });
  it("never holds open, suggested or dismissed items", () => {
    for (const state of ["active", "suggested", "dismissed"]) expect(doneToday({ state, done_at: local(9) }, now)).toBe(false);
  });
  it("behaves as before on a database without completion times", () => {
    expect(doneToday({ state: "done" }, now)).toBe(true);
  });
  it("lists the most recently completed first, undated ones last in their order", () => {
    const list = [{ id: "a" }, { id: "b", done_at: local(8) }, { id: "c" }, { id: "d", done_at: local(9) }];
    expect(list.sort(byDoneAt).map((i) => i.id)).toEqual(["d", "b", "a", "c"]);
  });
});
