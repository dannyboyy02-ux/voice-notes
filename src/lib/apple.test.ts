import { describe, expect, it } from "vitest";
import { APPLE_MAX_ITEMS, appleRemindersLink } from "./apple";

function parse(link: string) {
  const [base, query] = link.split("?");
  const params = new URLSearchParams(query);
  return { base, params, items: JSON.parse(params.get("text")!) };
}

describe("appleRemindersLink", () => {
  it("opens the named Shortcut with text input", () => {
    const { base, params } = parse(appleRemindersLink([{ title: "Call the county" }]));
    expect(base).toBe("shortcuts://run-shortcut");
    expect(params.get("name")).toBe("Add From Voice Notes");
    expect(params.get("input")).toBe("text");
  });
  it("carries the items as JSON text", () => {
    const items = [
      { title: "Call the county about the permit", due: "2026-11-12T09:00", notes: "remind me Thursday morning" },
      { title: "Email Sam the property survey" },
    ];
    expect(parse(appleRemindersLink(items)).items).toEqual(items);
  });
  it("percent-encodes everything, so quotes, ampersands and emoji survive", () => {
    const title = `Buy "milk" & eggs? #2 + café 🥛 = done`;
    const link = appleRemindersLink([{ title }]);
    expect(link).not.toMatch(/[ "&#+]"?milk/);
    expect(link.split("?")[1].split("&")).toHaveLength(3);
    expect(parse(link).items[0].title).toBe(title);
  });
  it("leaves out empty fields", () => {
    expect(parse(appleRemindersLink([{ title: "x", due: undefined, notes: "" }])).items).toEqual([{ title: "x" }]);
  });
  it("caps a batch at ten items to keep the link short", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ title: `Item ${i}` }));
    const { items } = parse(appleRemindersLink(many));
    expect(items).toHaveLength(APPLE_MAX_ITEMS);
    expect(items[9].title).toBe("Item 9");
  });
});
