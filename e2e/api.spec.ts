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

test.describe("security headers", () => {
  for (const path of ["/", "/zeus", "/api/config", "/sw.js"]) {
    test(`are sent with ${path}`, async ({ request }) => {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      // Only this site and the Supabase project the app is built for may be contacted.
      expect(h["content-security-policy"]).toContain("connect-src 'self' https://mock-project.supabase.test;");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    });
  }

  test("the service worker keeps its own headers too", async ({ request }) => {
    const h = (await request.get("/sw.js")).headers();
    expect(h["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    expect(h["service-worker-allowed"]).toBe("/");
  });

  test("a page placed inside another site's frame is refused by the browser", async ({ page }) => {
    // A stand-in for another site: an http origin the test serves itself, framing the app.
    await page.route("http://other-site.test/", (r) => r.fulfill({ contentType: "text/html", body: '<iframe id="f" src="http://localhost:3100/"></iframe>' }));
    await page.goto("http://other-site.test/");
    // Chromium refuses quietly: the frame shows its own error page, and none of the app loads in it.
    await expect.poll(() => page.frames()[1]?.url(), { timeout: 10_000 }).toBe("chrome-error://chromewebdata/");
    expect(await page.frames()[1].evaluate(() => document.querySelector("[data-testid]") === null)).toBe(true);
  });
});

test.describe("requests without a well-formed credential are refused first", () => {
  test("the scheduler's endpoint refuses a missing or malformed secret without saying how the server is set up", async ({ request }) => {
    for (const headers of [{}, { "x-tick-secret": "guess" }, { "x-tick-secret": "z".repeat(64) }] as Record<string, string>[]) {
      const res = await request.post("/api/tick", { headers });
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
  });

  test("a secret shaped like the scheduler's goes on to the next check", async ({ request }) => {
    // The test server has no database settings, so the next check is where it stops.
    const res = await request.post("/api/tick", { headers: { "x-tick-secret": "0f".repeat(32) } });
    expect(res.status()).toBe(503);
  });

  for (const path of ["/api/zeus", "/api/kick", "/api/sync", "/api/push/test", "/api/recordings/aaaaaaaa-0000-4000-8000-000000000001/action"]) {
    test(`${path} refuses a missing or malformed sign-in before asking Supabase`, async ({ request }) => {
      for (const headers of [{}, { authorization: "Bearer garbage" }, { authorization: "Bearer a.b" }] as Record<string, string>[]) {
        const res = await request.post(path, { headers, data: {} });
        expect(res.status()).toBe(401);
        expect(await res.json()).toEqual({ error: "not_signed_in" });
      }
    });
  }
});
