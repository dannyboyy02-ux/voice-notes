import { describe, expect, it } from "vitest";
import { IMPORT_MAX_BYTES, audioKind, importProblem, importStartedAt } from "./import";
import { extensionFor } from "./recorder/mime";

describe("audioKind", () => {
  it("goes by the file name when the browser gives no type", () => {
    expect(audioKind("Weekly sync.mp3", "")).toBe("audio/mpeg");
    expect(audioKind("Voice Memo.M4A", "")).toBe("audio/mp4");
  });
  it("falls back to the browser's type", () => {
    expect(audioKind("recording", "audio/x-m4a")).toBe("audio/mp4");
    expect(audioKind("clip", "audio/wav; codecs=1")).toBe("audio/wav");
  });
  it("refuses things that are not audio", () => {
    expect(audioKind("notes.pdf", "application/pdf")).toBeNull();
    expect(audioKind("transcript.txt", "text/plain")).toBeNull();
  });
  it("every accepted format gets a real file extension", () => {
    for (const name of ["a.m4a", "a.mp4", "a.mp3", "a.wav", "a.aac", "a.ogg", "a.webm", "a.flac"]) {
      expect(extensionFor(audioKind(name, "")!)).not.toBe("bin");
    }
  });
});

describe("importProblem", () => {
  it("accepts an ordinary export", () => {
    expect(importProblem({ name: "Otter export.mp3", type: "audio/mpeg", size: 12_000_000 })).toBeNull();
  });
  it("explains each refusal", () => {
    expect(importProblem({ name: "a.pdf", type: "application/pdf", size: 10 })).toContain("not an audio file");
    expect(importProblem({ name: "a.mp3", type: "audio/mpeg", size: 0 })).toContain("empty");
    expect(importProblem({ name: "a.mp3", type: "audio/mpeg", size: IMPORT_MAX_BYTES + 1 })).toContain("50 MB");
  });
});

describe("importStartedAt", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  it("uses the file's own time when believable", () => {
    expect(importStartedAt(Date.parse("2026-11-01T09:00:00Z"), now)).toBe("2026-11-01T09:00:00.000Z");
  });
  it("uses now for a missing, future or ancient time", () => {
    expect(importStartedAt(0, now)).toBe("2026-11-13T12:00:00.000Z");
    expect(importStartedAt(now + 86_400_000, now)).toBe("2026-11-13T12:00:00.000Z");
  });
});
