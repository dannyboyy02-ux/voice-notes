import { describe, expect, it } from "vitest";
import { bearerToken, tickSecret } from "./request-shape";

const req = (headers: Record<string, string>) => new Request("https://app.test/api/x", { method: "POST", headers });
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl";
const SECRET = "0f".repeat(32); // 64 hex characters, as supabase/setup.sql makes it

describe("bearerToken", () => {
  it("passes a token shaped like a Supabase access token", () => {
    expect(bearerToken(req({ authorization: `Bearer ${JWT}` }))).toBe(JWT);
    expect(bearerToken(req({ authorization: `bearer ${JWT}` }))).toBe(JWT);
  });
  it("refuses anything else before Supabase is asked", () => {
    for (const value of ["", "Bearer", "Bearer ", "Bearer garbage", "Bearer a.b", `Basic ${JWT}`, `Bearer ${JWT} extra`, `Bearer ${JWT}.x`, `Bearer ${"a".repeat(5000)}.${"b".repeat(5000)}.c`]) {
      expect(bearerToken(req({ authorization: value }))).toBeNull();
    }
    expect(bearerToken(req({}))).toBeNull();
  });
});

describe("tickSecret", () => {
  it("passes the scheduler's secret as the setup script makes it", () => {
    expect(tickSecret(req({ "x-tick-secret": SECRET }))).toBe(SECRET);
  });
  it("refuses a missing or malformed secret before the database is asked", () => {
    expect(tickSecret(req({}))).toBeNull();
    for (const value of ["", "x", "not-hex-".repeat(8), "0f".repeat(10), "0f".repeat(70)]) expect(tickSecret(req({ "x-tick-secret": value }))).toBeNull();
  });
});
