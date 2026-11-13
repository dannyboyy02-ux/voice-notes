import { describe, expect, it } from "vitest";
import { exportFileName, shareText, transcriptText } from "./export";

const head = {
  title: "Dock schedule", dateLabel: "Thu, Nov 12, 9:00 AM", summary: "Agreed the new dock times.",
  items: [{ text: "Email Sam", done: false, due: "Fri 9:00 AM" }, { text: "Book the room", done: true }],
};

describe("shareText", () => {
  it("lists the summary and action items", () => {
    expect(shareText(head)).toBe(
      "Dock schedule\nThu, Nov 12, 9:00 AM\n\nAgreed the new dock times.\n\nAction items\n[ ] Email Sam (Fri 9:00 AM)\n[x] Book the room",
    );
  });
  it("copes with a recording that has nothing yet", () => {
    expect(shareText({ title: null, dateLabel: "Today", summary: null, items: [] })).toBe("Untitled recording\nToday");
  });
});

describe("transcriptText", () => {
  it("adds every line with its time and speaker", () => {
    const text = transcriptText(head, [
      { speaker: "A", start_ms: 5_000, text: "Morning." },
      { speaker: "B", start_ms: 3_725_000, text: "Late start." },
    ]);
    expect(text).toContain("Transcript\n[00:05] Speaker A: Morning.\n[1:02:05] Speaker B: Late start.\n");
  });
  it("says so when there is no transcript", () => {
    expect(transcriptText(head, [])).toContain("(no transcript yet)");
  });
});

describe("exportFileName", () => {
  it("strips characters a file name cannot hold", () => {
    expect(exportFileName('Q3: plan / "final"?', "txt")).toBe("Q3 plan final.txt");
  });
  it("falls back when there is no usable title", () => {
    expect(exportFileName(null, "txt")).toBe("Recording.txt");
    expect(exportFileName("///", "m4a")).toBe("Recording.m4a");
  });
});
