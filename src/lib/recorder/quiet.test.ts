import { describe, expect, it } from "vitest";
import { QuietDetector, levelDb, warnWindowMs } from "./quiet";

const tone = (amplitude: number, n = 1024) => Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin(i / 3));
const STEP = 500;

/** Feeds a list of levels, one every half second, and returns the detector and the final time. */
function run(levels: (number | null)[], d = new QuietDetector(0), start = 0) {
  let t = start;
  for (const db of levels) {
    t += STEP;
    d.hear(db, t, STEP);
  }
  return { d, t };
}

describe("levelDb", () => {
  it("measures loudness below full scale", () => {
    expect(levelDb(tone(1))!).toBeCloseTo(-3, 0);
    expect(levelDb(tone(0.01))!).toBeCloseTo(-43, 0);
  });
  it("treats pure zeros as no measurement, not as silence", () => {
    expect(levelDb(new Float32Array(512))).toBeNull();
    expect(levelDb([])).toBeNull();
  });
});

describe("QuietDetector", () => {
  it("counts a quiet room as quiet", () => {
    const { d, t } = run(Array(1200).fill(-68)); // ten minutes
    expect(d.quietMs(t)).toBe(600_000);
  });

  it("hears speech above the room", () => {
    const quiet = Array(240).fill(-68);
    const { d, t } = run([...quiet, -30, ...Array(20).fill(-68)]);
    expect(d.quietMs(t)).toBe(20 * STEP);
  });

  it("learns a steady hum as the new quiet, then still hears speech over it", () => {
    // Two minutes of a loud fan after a quiet start: at first it sounds like talking, then it becomes the background.
    const { d, t } = run([...Array(20).fill(-70), ...Array(1200).fill(-45)]);
    expect(d.background!).toBeCloseTo(-45, 0);
    expect(d.quietMs(t)).toBeGreaterThan(300_000);
    const after = run([-28], d, t);
    expect(after.d.quietMs(after.t)).toBe(0);
  });

  it("never counts a missing measurement towards a stop", () => {
    const { d, t } = run(Array(1200).fill(null));
    expect(d.quietMs(t)).toBe(0);
  });

  it("starts the count again on reset", () => {
    const { d, t } = run(Array(100).fill(-68));
    expect(d.quietMs(t)).toBe(50_000);
    d.reset(t);
    expect(d.quietMs(t + 1000)).toBe(1000);
  });

  it("does not take faint noise for speech in a near-silent room", () => {
    // Below -50 dB is never speech, however quiet the background.
    const { d, t } = run([...Array(20).fill(-90), ...Array(20).fill(-60)]);
    expect(d.quietMs(t)).toBe(40 * STEP);
  });
});

describe("warnWindowMs", () => {
  it("warns a minute ahead, or sooner for short limits", () => {
    expect(warnWindowMs(600_000)).toBe(60_000);
    expect(warnWindowMs(3_000)).toBe(1_000);
  });
});
