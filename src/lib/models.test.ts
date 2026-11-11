import { describe, expect, it } from "vitest";
import { BEST_MODEL, CHEAP_MODEL, llmCostUsd, pickModel, shouldEscalate, sttCostUsd } from "./models";

describe("pickModel", () => {
  it("Auto: one speaker and 10 minutes or less uses Haiku", () => {
    expect(pickModel({ minutes: 3, speakers: 1 }, "auto")).toBe("claude-haiku-5-5");
    expect(pickModel({ minutes: 10, speakers: 1 }, "auto")).toBe("claude-haiku-5-5");
    expect(pickModel({ minutes: 0.2, speakers: 0 }, "auto")).toBe("claude-haiku-5-5");
  });
  it("Auto: anything else uses Opus", () => {
    expect(pickModel({ minutes: 10.1, speakers: 1 }, "auto")).toBe("claude-opus-5-5");
    expect(pickModel({ minutes: 2, speakers: 2 }, "auto")).toBe("claude-opus-5-5");
    expect(pickModel({ minutes: 55, speakers: 4 }, "auto")).toBe("claude-opus-5-5");
  });
  it("Best and Cheapest ignore the recording", () => {
    expect(pickModel({ minutes: 1, speakers: 1 }, "best")).toBe(BEST_MODEL);
    expect(pickModel({ minutes: 90, speakers: 5 }, "cheapest")).toBe(CHEAP_MODEL);
  });
});

describe("shouldEscalate", () => {
  it("reruns on Opus when the cheap pass reports low confidence in Auto", () => {
    expect(shouldEscalate(CHEAP_MODEL, "auto", { confidence: "low" })).toBe(true);
  });
  it("does not rerun when confident, already on Opus, or the owner chose Cheapest", () => {
    expect(shouldEscalate(CHEAP_MODEL, "auto", { confidence: "high" })).toBe(false);
    expect(shouldEscalate(BEST_MODEL, "auto", { confidence: "low" })).toBe(false);
    expect(shouldEscalate(CHEAP_MODEL, "cheapest", { confidence: "low" })).toBe(false);
  });
});

describe("cost", () => {
  it("prices Opus at $4 in and $20 out per million tokens", () => {
    expect(llmCostUsd(BEST_MODEL, 20_000, 6_000)).toBeCloseTo(0.2, 6);
  });
  it("prices Haiku at $0.10 and $0.50, with the higher rate past 100K input tokens", () => {
    expect(llmCostUsd(CHEAP_MODEL, 20_000, 6_000)).toBeCloseTo(0.005, 6);
    expect(llmCostUsd(CHEAP_MODEL, 200_000, 1_000)).toBeCloseTo(0.1025, 6);
  });
  it("estimates speech to text at $0.23 an hour", () => {
    expect(sttCostUsd(3_600_000)).toBeCloseTo(0.23, 6);
  });
});
