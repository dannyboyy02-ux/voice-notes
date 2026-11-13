import { describe, expect, it } from "vitest";
import { withSearch } from "./searches";

describe("recent searches", () => {
  it("puts the newest search first", () => {
    expect(withSearch(["dock"], "survey")).toEqual(["survey", "dock"]);
  });

  it("moves a repeated search to the front instead of listing it twice", () => {
    expect(withSearch(["dock", "survey", "permit"], "survey")).toEqual(["survey", "dock", "permit"]);
  });

  it("treats capitals and extra spaces as the same search, keeping the newest spelling", () => {
    expect(withSearch(["Dock Permit", "survey"], "  dock   permit ")).toEqual(["dock permit", "survey"]);
  });

  it("ignores a search too short to run", () => {
    expect(withSearch(["dock"], " a ")).toEqual(["dock"]);
    expect(withSearch(["dock"], "")).toEqual(["dock"]);
  });

  it("keeps only the eight most recent", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `search ${i}`).reduce<string[]>((list, q) => withSearch(list, q), []);
    expect(nine).toHaveLength(8);
    expect(nine[0]).toBe("search 8");
    expect(nine).not.toContain("search 0");
  });
});
