import { describe, expect, it } from "vitest";
import { findOverlap, gapText, mergeItems, planMerge, readPieces, seamText, type MergeLine, type MergeSource } from "./merge";

/** A meeting as a list of sentences, each said by someone, about 6 seconds apiece from `at`. */
const MEETING = [
  ["A", "Morning everyone, let's start with the dock schedule for next week."],
  ["B", "Sam says the repair crew can start on the sixteenth if the survey arrives first."],
  ["A", "Then I will email Sam the property survey tonight so nothing holds them up."],
  ["C", "The county still has not signed off on the permit for the east ramp."],
  ["A", "Remind me Thursday morning to call the county about that permit."],
  ["B", "Fuel costs came in about eight percent over budget for October."],
  ["C", "Mostly the yard moves at the north site, they doubled after the storm."],
  ["A", "Let's recheck the fuel assumptions before Friday and bring numbers to the review."],
  ["B", "I can pull the invoices for account sixty six fifty and check the coding."],
  ["C", "The trailer lease renewal is due at the end of the month as well."],
  ["A", "Put the lease on next week's agenda and ask legal for the redline."],
  ["B", "Training for the new loaders starts Monday at seven in the warehouse."],
  ["C", "We need two more pallet jacks before then or the second shift waits."],
  ["A", "Order the pallet jacks today, the budget line is already approved."],
  ["B", "Last thing, the safety audit moved to the twenty third."],
  ["A", "Good, that gives us time to finish the signage, thanks everyone."],
] as const;

function say(sentences: readonly (readonly [string, string])[], from = 0, step = 6000): MergeLine[] {
  return sentences.map(([speaker, text], i) => ({ speaker, text, start_ms: from + i * step, end_ms: from + i * step + step - 500 }));
}
/** A second transcriber hears the same words a little differently: a word changed here and there, labels of its own. */
function heardDifferently(lines: MergeLine[], relabel: Record<string, string>): MergeLine[] {
  return lines.map((l, i) => ({
    ...l,
    speaker: relabel[l.speaker] ?? l.speaker,
    text: i % 3 === 0 ? l.text.replace(/\bthe\b/, "a") : l.text.replace(/,/g, ""),
  }));
}
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const src = (id: string, started_at: string, lines: MergeLine[], extra: Partial<MergeSource> = {}): MergeSource => ({
  id, title: `Recording ${id}`, started_at, duration_ms: lines.length ? lines.at(-1)!.end_ms + 500 : 0, lines, ...extra,
});
/** The merged transcript as plain sentences, to check each is there once and in order. */
const texts = (lines: MergeLine[]) => lines.map((l) => l.text);
const isSorted = (lines: MergeLine[]) => lines.every((l, i) => i === 0 || lines[i - 1].start_ms <= l.start_ms);

describe("findOverlap", () => {
  it("finds the shift between two transcripts of the same stretch, even worded a little differently", () => {
    const a = say(MEETING);
    const b = heardDifferently(say(MEETING.slice(5), 0), { A: "B", B: "A" }); // started 30 s into the meeting
    const found = findOverlap(a, b)!;
    expect(found).not.toBeNull();
    expect(Math.abs(found.shift_ms - 30_000)).toBeLessThan(1500);
  });

  it("does not take a stock phrase said in two separate meetings for an overlap", () => {
    const a = say([["A", "Budget review today."], ["A", "Good, that gives us time to finish the signage, thanks everyone."]]);
    const b = say([["A", "Hiring update."], ["A", "Good, that gives us time to finish the signage, thanks everyone."]]);
    expect(findOverlap(a, b)).toBeNull();
  });

  it("finds nothing in transcripts that share no words", () => {
    expect(findOverlap(say(MEETING.slice(0, 5)), say(MEETING.slice(8)))).toBeNull();
  });
});

describe("planMerge: back-to-back recordings", () => {
  const first = src("one", "2026-11-18T14:00:00Z", say(MEETING.slice(0, 8)));
  // After a 12-minute break, a second recording of the rest of the meeting.
  const second = src("two", at("2026-11-18T14:00:00Z", first.duration_ms! + 12 * 60_000), say(MEETING.slice(8)));

  it("places the second after the first, with the break noted and no line lost or repeated", () => {
    const plan = planMerge([second, first]);
    expect(plan.order).toEqual(["one", "two"]);
    expect(texts(plan.lines)).toEqual(MEETING.map(([, t]) => t));
    expect(isSorted(plan.lines)).toBe(true);
    expect(plan.segments[1].seam).toEqual({ kind: "gap", gap_ms: 12 * 60_000 });
    // Its timeline continues where the first ended; the break is not dead air in the merged timeline.
    expect(plan.segments[1].offset_ms).toBe(first.duration_ms);
    expect(plan.duration_ms).toBe(first.duration_ms! + second.duration_ms!);
    expect(plan.warnings).toEqual([]);
  });

  it("keeps the second recording's speakers apart unless they are matched", () => {
    const plan = planMerge([first, second]);
    // In the second recording the speech service called them A, B, C again: they become D, E, F.
    expect(plan.segments[1].speakers.map((s) => [s.label, s.as])).toEqual([["B", "D"], ["C", "E"], ["A", "F"]]);
    expect(plan.speakers).toBe(6);
    expect(plan.segments[1].speakers[0].samples[0]).toContain("invoices");
  });

  it("uses the owner's speaker matches", () => {
    const plan = planMerge([first, second], { speakers: { "two:A": "A", "two:B": "B", "two:C": "C" } });
    expect(plan.speakers).toBe(3);
    expect(plan.lines.filter((l) => l.text.startsWith("Order the pallet jacks"))[0].speaker).toBe("A");
  });

  it("refuses to match two speakers of one recording to the same person, or to a speaker who does not exist", () => {
    const plan = planMerge([first, second], { speakers: { "two:A": "A", "two:B": "A", "two:C": "Z" } });
    const as = Object.fromEntries(plan.segments[1].speakers.map((s) => [s.label, s.as]));
    expect(as.B).not.toBe(as.A);
    expect(as.C).not.toBe("Z");
  });

  it("follows the owner's order when given", () => {
    const plan = planMerge([first, second], { order: ["two", "one"] });
    expect(plan.order).toEqual(["two", "one"]);
    expect(plan.lines[0].text).toBe(MEETING[8][1]);
  });
});

describe("planMerge: the seam between part 1 and part 2 of one long recording", () => {
  it("joins by the clock when the two parts overlap by a moment, keeping each line once", () => {
    // Part 2 began 1.5 s before part 1 stopped, so its first line repeats part 1's last few words.
    const all = say(MEETING);
    const p1 = src("p1", "2026-11-18T09:00:00Z", all.slice(0, 9));
    const shift = p1.duration_ms! - 1500;
    const tail = [{ speaker: "A", text: "the coding.", start_ms: 0, end_ms: 1200 }];
    const rest = all.slice(9).map((l) => ({ ...l, start_ms: l.start_ms - shift, end_ms: l.end_ms - shift }));
    const p2 = src("p2", at("2026-11-18T09:00:00Z", shift), [...tail, ...rest]);
    const plan = planMerge([p1, p2]);
    expect(plan.segments[1].seam).toMatchObject({ kind: "overlap", by: "clock", dropped: 1, contained: false });
    expect(texts(plan.lines)).toEqual(MEETING.map(([, t]) => t));
    // Merged times match the meeting's own times.
    expect(plan.lines.at(-1)!.start_ms).toBe(all.at(-1)!.start_ms);
  });
});

describe("planMerge: the same meeting recorded twice", () => {
  // One recording (an export from another app) covers the start to two thirds; the phone covers from a third to the end.
  const full = say(MEETING);
  const otter = src("otter", "2026-11-18T16:10:00Z" /* the export time, not the meeting time */, full.slice(0, 11));
  const phoneLines = heardDifferently(full.slice(5).map((l) => ({ ...l, start_ms: l.start_ms - 30_000, end_ms: l.end_ms - 30_000 })), { A: "B", B: "C", C: "A" });
  const phone = src("phone", "2026-11-18T15:00:30Z", phoneLines);

  it("puts them in the right order from the words, though the dates say otherwise", () => {
    const plan = planMerge([phone, otter]);
    expect(plan.order).toEqual(["otter", "phone"]);
  });

  it("keeps the overlapping stretch once and loses nothing from either end", () => {
    const plan = planMerge([phone, otter]);
    const seam = plan.segments[1].seam;
    expect(seam).toMatchObject({ kind: "overlap", by: "words", contained: false });
    expect(plan.lines).toHaveLength(MEETING.length);
    // Every sentence of the meeting is there once, in order: the first recording's wording up to the cut, the phone's after.
    plan.lines.forEach((l, i) => expect(l.text.replace(/,/g, "").replace(/\ba\b/, "the")).toBe(MEETING[i][1].replace(/,/g, "")));
    expect(isSorted(plan.lines)).toBe(true);
    // Merged time is the meeting's time, so "jump to the moment" lands right on both sides of the cut.
    expect(Math.abs(plan.lines.at(-1)!.start_ms - full.at(-1)!.start_ms)).toBeLessThan(1500);
    // The first recording stops where the phone's part begins.
    expect(plan.segments[0].to_ms).toBeLessThanOrEqual(plan.segments[1].offset_ms + plan.segments[1].from_ms);
  });

  it("lets the owner say the phone's speaker B is the first recording's A", () => {
    const plan = planMerge([phone, otter], { speakers: { "phone:B": "A", "phone:C": "B", "phone:A": "C" } });
    expect(plan.speakers).toBe(3);
    const lastLine = plan.lines.at(-1)!;
    expect(lastLine.speaker).toBe("A");
  });

  it("says when one recording is entirely inside the other", () => {
    const inner = src("inner", "2026-11-18T15:00:40Z", heardDifferently(full.slice(3, 7).map((l) => ({ ...l, start_ms: l.start_ms - 18_000, end_ms: l.end_ms - 18_000 })), {}));
    const plan = planMerge([src("whole", "2026-11-18T15:00:00Z", full), inner]);
    expect(plan.segments[1].seam).toMatchObject({ kind: "overlap", contained: true });
    expect(plan.lines).toHaveLength(MEETING.length);
    expect(plan.warnings[0]).toContain("already in the one before it");
  });
});

describe("planMerge: clocks that disagree with the words", () => {
  it("places a recording after the previous one, with a warning, when the clocks overlap a lot but no words are shared", () => {
    const a = src("a", "2026-11-18T10:00:00Z", say(MEETING.slice(0, 8)));
    const b = src("b", "2026-11-18T10:00:20Z", say(MEETING.slice(8)));
    const plan = planMerge([a, b]);
    expect(plan.segments[1].seam.kind).toBe("gap");
    expect(plan.warnings[0]).toContain("no words are shared");
    expect(texts(plan.lines)).toEqual(MEETING.map(([, t]) => t));
  });
});

describe("planMerge: limits", () => {
  const one = src("x", "2026-11-18T10:00:00Z", say(MEETING.slice(0, 2)));
  it("needs two to ten different conversations and a matching order", () => {
    expect(() => planMerge([one])).toThrow("at least two");
    expect(() => planMerge([one, one])).toThrow("twice");
    expect(() => planMerge(Array.from({ length: 11 }, (_, i) => ({ ...one, id: `r${i}` })))).toThrow("At most 10");
    expect(() => planMerge([one, { ...one, id: "y" }], { order: ["x", "z"] })).toThrow("order");
  });
  it("copes with a recording that has no speech", () => {
    const plan = planMerge([one, src("silent", "2026-11-18T11:00:00Z", [])]);
    expect(plan.lines).toHaveLength(2);
    expect(plan.pieces).toHaveLength(2);
  });
});

describe("planMerge: merging a conversation that is already a merge", () => {
  it("keeps the earlier merge's audio pieces and dividers, and adds the new recording's", () => {
    const ab = planMerge([src("a", "2026-11-18T10:00:00Z", say(MEETING.slice(0, 4))), src("b", "2026-11-18T10:30:00Z", say(MEETING.slice(4, 8)))]);
    const merged: MergeSource = {
      id: "ab", title: "Morning meeting", started_at: "2026-11-18T10:00:00Z", duration_ms: ab.duration_ms,
      lines: ab.lines.map(({ speaker, start_ms, end_ms, text }) => ({ speaker, start_ms, end_ms, text })),
      pieces: ab.pieces, lineSegments: ab.lines.map((l) => l.segment),
    };
    const plan = planMerge([merged, src("c", "2026-11-18T11:00:00Z", say(MEETING.slice(8)))]);
    expect(plan.pieces.map((p) => p.recording_id)).toEqual(["a", "b", "c"]);
    expect(texts(plan.lines)).toEqual(MEETING.map(([, t]) => t));
    expect([...new Set(plan.lines.map((l) => l.segment))]).toEqual([0, 1, 2]);
    expect(plan.pieces[1].seam.kind).toBe("gap");
  });
});

describe("mergeItems", () => {
  const a = src("a", "2026-11-18T10:00:00Z", say(MEETING.slice(0, 8)));
  const b = src("b", "2026-11-18T11:00:00Z", say(MEETING.slice(8)));
  const plan = planMerge([a, b]);
  const item = (id: string, recording_id: string, text: string, state: "active" | "done" | "suggested" | "dismissed", at_ms: number | null = 1000) =>
    ({ id, recording_id, type: "todo" as const, text, at_ms, state });

  it("moves each item to the merged timeline", () => {
    const out = mergeItems([item("1", "b", "Order pallet jacks", "active", 5000), item("2", "a", "Email Sam the survey", "active", null)], plan);
    expect(out.find((i) => i.id === "1")!.at_ms).toBe(a.duration_ms! + 5000);
    expect(out.find((i) => i.id === "2")!.at_ms).toBeNull();
  });

  it("keeps a task picked up in both recordings once, preferring the copy that was done", () => {
    const out = mergeItems([
      item("1", "a", "Email Sam the property survey", "active"),
      item("2", "b", "Email Sam the property survey.", "done"),
      item("3", "b", "Order two pallet jacks", "suggested"),
    ], plan);
    expect(out.map((i) => i.id).sort()).toEqual(["2", "3"]);
  });

  it("ignores items of recordings that are not in the merge", () => {
    expect(mergeItems([item("1", "elsewhere", "Anything", "active")], plan)).toEqual([]);
  });
});

describe("seamText and readPieces", () => {
  const a = src("a", "2026-11-18T10:00:00Z", say(MEETING.slice(0, 8)));
  const b = src("b", at("2026-11-18T10:00:00Z", a.duration_ms! + 12 * 60_000), say(MEETING.slice(8)));
  const plan = planMerge([a, b]);
  const when = (iso: string) => iso.slice(11, 16);
  it("describes where each recording begins", () => {
    expect(seamText(plan.pieces, 0, when)).toBe("Recording 1 of 2: Recording a · began 10:00");
    expect(seamText(plan.pieces, 1, when)).toBe("Recording 2 of 2: Recording b · began 10:12 · 12 min after recording 1 ended");
  });
  it("says long gaps in hours and days", () => {
    expect(gapText(12)).toBe("12 min");
    expect(gapText(1422)).toBe("23 h 42 m");
    expect(gapText(120)).toBe("2 h");
    expect(gapText(4 * 1440 + 30)).toBe("4 days");
  });
  it("reads saved pieces back and refuses anything malformed", () => {
    expect(readPieces(JSON.parse(JSON.stringify(plan.pieces)))).toHaveLength(2);
    expect(readPieces(null)).toBeNull();
    expect(readPieces([{ recording_id: 1 }])).toBeNull();
  });
});
