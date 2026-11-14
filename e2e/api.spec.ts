import { expect, test } from "@playwright/test";

// Requests made straight to the server, as anyone on the internet could make them. No browser page is used.
const SELFTEST_SECRET = "e2e-selftest-secret-0123456789abcdef"; // set for the test server in playwright.config.ts

test.describe("self-test secret", () => {
  test("is refused in the web address, with a hint", async ({ request }) => {
    const res = await request.get(`/api/selftest?key=${SELFTEST_SECRET}&action=start`);
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", hint: "send the secret in the x-selftest-secret header; it is no longer read from the address" });
  });

  test("is accepted in the header", async ({ request }) => {
    // The test server has no Supabase or API keys, so an accepted request stops at the environment check.
    const res = await request.get("/api/selftest", { headers: { "x-selftest-secret": SELFTEST_SECRET } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, blocked: "environment variables are missing in Vercel" });
  });

  test("is refused when wrong or missing", async ({ request }) => {
    expect((await request.get("/api/selftest", { headers: { "x-selftest-secret": "wrong" } })).status()).toBe(403);
    const none = await request.get("/api/selftest");
    expect(none.status()).toBe(403);
    expect(await none.json()).toEqual({ error: "forbidden" });
  });
});
