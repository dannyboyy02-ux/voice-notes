import { describe, expect, it } from "vitest";
import { secretInAddress, selftestAllowed } from "./selftest-auth";

const SECRET = "a-long-random-self-test-secret-value";
const req = (query = "", headers: Record<string, string> = {}) => new Request(`https://app.test/api/selftest${query}`, { headers });

describe("self-test secret", () => {
  it("is accepted in the x-selftest-secret header", () => {
    expect(selftestAllowed(req("?action=start", { "x-selftest-secret": SECRET }), SECRET)).toBe(true);
  });
  it("is not accepted in the web address, even when correct", () => {
    expect(selftestAllowed(req(`?key=${SECRET}&action=start`), SECRET)).toBe(false);
    expect(secretInAddress(req(`?key=${SECRET}`))).toBe(true);
  });
  it("refuses a wrong, partial or missing secret", () => {
    expect(selftestAllowed(req("", { "x-selftest-secret": "wrong" }), SECRET)).toBe(false);
    expect(selftestAllowed(req("", { "x-selftest-secret": SECRET.slice(0, -1) }), SECRET)).toBe(false);
    expect(selftestAllowed(req(""), SECRET)).toBe(false);
  });
  it("is switched off when SELFTEST_SECRET is not set", () => {
    expect(selftestAllowed(req("", { "x-selftest-secret": "" }), undefined)).toBe(false);
    expect(selftestAllowed(req("", { "x-selftest-secret": "anything" }), "")).toBe(false);
  });
});
