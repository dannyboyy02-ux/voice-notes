import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * A walk through every screen with realistic data: several recordings in different states,
 * a transcript with two speakers, and to-dos in every section. It checks the things a person
 * would look for on each screen, and saves screenshots when SHOT is set.
 */
const SUPABASE = "https://mock-project.supabase.test";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "Content-Range" };
const hours = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();

type Row = Record<string, unknown>;
const REC = { budget: "aaaaaaaa-0000-4000-8000-000000000001", dock: "aaaaaaaa-0000-4000-8000-000000000002", failed: "aaaaaaaa-0000-4000-8000-000000000003", busy: "aaaaaaaa-0000-4000-8000-000000000004" };

function seed() {
  const base = { user_id: USER_ID, time_zone: "America/New_York", part: 1, attempts: 0, failed_step: null, last_error: null, is_test: false, deleted_at: null, audio_deleted_at: null, bytes: 4_800_000, mime_type: "audio/mp4" };
  const recordings: Row[] = [
    { ...base, id: REC.budget, status: "ready", title: "2027 Budget Review: Equipment and Fuel", summary: "The team refined budget and revenue projections for storage trailers, yard moves and fuel across sites, and agreed to recheck the fuel assumptions before Friday.", started_at: hours(-26), duration_ms: 3_600_000, storage_path: `${USER_ID}/${REC.budget}.m4a`, speakers: 3, model_used: "claude-opus-5-5", input_tokens: 21400, output_tokens: 5800, llm_cost_usd: 0.2016, stt_cost_usd: 0.23, ready_at: hours(-25) },
    { ...base, id: REC.dock, status: "ready", title: "Call with Sam about the dock", summary: "Sam can repair the dock the week of the 16th. You owe him the survey first.", started_at: hours(-50), duration_ms: 1_080_000, storage_path: `${USER_ID}/${REC.dock}.m4a`, speakers: 2, model_used: "claude-opus-5-5", input_tokens: 6100, output_tokens: 1500, llm_cost_usd: 0.0544, stt_cost_usd: 0.069, ready_at: hours(-49) },
    { ...base, id: REC.failed, status: "failed", failed_step: "transcribing", attempts: 3, last_error: "The speech service reported an error.", title: null, summary: null, started_at: hours(-3), duration_ms: 42_000, storage_path: `${USER_ID}/${REC.failed}.m4a`, speakers: null, model_used: null, llm_cost_usd: null, stt_cost_usd: null, ready_at: null },
    { ...base, id: REC.busy, status: "transcribing", attempts: 1, title: null, summary: null, started_at: hours(-0.05), duration_ms: 95_000, storage_path: `${USER_ID}/${REC.busy}.m4a`, speakers: null, model_used: null, llm_cost_usd: null, stt_cost_usd: null, ready_at: null },
  ];
  const item = (id: number, o: Row): Row => ({ id: `bbbbbbbb-0000-4000-8000-00000000000${id}`, user_id: USER_ID, recording_id: REC.dock, type: "todo", due_at: null, due_local: null, said: null, quote: null, at_ms: null, state: "active", needs_review: false, notified_at: null, apple_sent_at: null, is_test: false, created_at: hours(-49), ...o });
  const items: Row[] = [
    item(1, { type: "reminder", text: "Renew boat registration", due_at: hours(-30), recording_id: null, created_at: hours(-80) }),
    item(2, { text: "Email Sam the property survey", quote: "I'll send you the survey tonight", at_ms: 412000 }),
    item(3, { type: "reminder", text: "Call the county about the permit", due_at: hours(20), said: "Thursday morning", at_ms: 655000 }),
    item(4, { type: "reminder", text: "Check in with Sam on timing", said: "sometime next week", state: "suggested", needs_review: true }),
    item(5, { text: "Investigate whether the Corona invoices posted to account 60650 were assigned to the correct account and confirm the appropriate classification", recording_id: REC.budget, created_at: hours(-25) }),
    item(6, { text: "Order filter for the furnace", state: "done", recording_id: null, created_at: hours(-90) }),
  ];
  const utterances: Row[] = [
    { recording_id: REC.dock, idx: 0, speaker: "A", start_ms: 412000, end_ms: 416000, text: "I'll send you the survey tonight." },
    { recording_id: REC.dock, idx: 1, speaker: "B", start_ms: 417000, end_ms: 421000, text: "Great. Then I can start the 16th." },
    { recording_id: REC.dock, idx: 2, speaker: "A", start_ms: 655000, end_ms: 661000, text: "Remind me Thursday morning to call the county about the permit." },
  ];
  return { recordings, items, utterances, settings: { model_mode: "auto", apple_reminders: true } as Row };
}

async function mockBackend(page: Page) {
  const db = seed();
  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
    route.fulfill({ status, headers: { ...CORS, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  await page.route("**/api/config", (r) => json(r, { supabaseUrl: SUPABASE, supabaseAnonKey: "anon-key", vapidPublicKey: null, missing: [] }));
  await page.route("**/api/sync", (r) => json(r, { ok: true, userId: USER_ID, missing: [], databaseReady: true }));
  await page.route("**/api/kick", (r) => json(r, { accepted: true }, 202));
  await page.route("**/api/recordings/*/action", (r) => json(r, { ok: true }));
  await page.route("**/api/zeus", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Two things are outstanding.\n\n1. Email Sam the property survey.\n2. Call the county about the permit, due tomorrow morning.\n\n✓ Added reminder: Call Sam (Fri 13 Nov, 3:00 PM)\n" }));

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const q = url.searchParams;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const eq = (k: string) => (q.get(k)?.startsWith("eq.") ? q.get(k)!.slice(3) : null);
    const inList = (k: string) => (q.get(k)?.startsWith("in.(") ? q.get(k)!.slice(4, -1).split(",").map((v) => v.replace(/"/g, "")) : null);
    const send = (rows: Row[]) => json(route, wantsObject ? (rows[0] ?? null) : rows, 200, { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });

    if (url.pathname === "/auth/v1/token") {
      const now = Math.floor(Date.now() / 1000);
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "daniel@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return json(route, { access_token: `${b64({ alg: "HS256" })}.${b64({ sub: USER_ID, exp: now + 3600 })}.sig`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r", user });
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/")) return json(route, { signedURL: "/object/sign/audio/x?token=t" });
    if (url.pathname === "/rest/v1/rpc/server_status") return json(route, { scheduler_last_run_at: hours(-0.01), last_tick_at: null, connected: true });
    if (url.pathname === "/rest/v1/rpc/search_notes") {
      return json(route, [
        { recording_id: REC.dock, title: "Call with Sam about the dock", started_at: hours(-50), kind: "transcript", at_ms: 412000, snippet: "I'll send you the [[survey]] tonight.", rank: 0.5 },
        { recording_id: REC.dock, title: "Call with Sam about the dock", started_at: hours(-50), kind: "todo", at_ms: 412000, snippet: "Email Sam the property [[survey]]", rank: 0.4 },
      ]);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(route, {});

    if (url.pathname === "/rest/v1/recordings") {
      if (req.method() === "PATCH") { db.recordings = db.recordings.map((r) => (r.id === eq("id") ? { ...r, ...(req.postDataJSON() as Row) } : r)); return json(route, []); }
      if (req.method() === "DELETE") { db.recordings = db.recordings.filter((r) => r.id !== eq("id")); return json(route, []); }
      let rows = db.recordings.slice().sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
      if (eq("id")) rows = rows.filter((r) => r.id === eq("id"));
      if (q.get("deleted_at") === "is.null") rows = rows.filter((r) => !r.deleted_at);
      if (q.get("deleted_at") === "not.is.null") rows = rows.filter((r) => r.deleted_at);
      return send(rows);
    }
    if (url.pathname === "/rest/v1/items") {
      if (req.method() === "POST") { db.items.unshift({ id: `bbbbbbbb-0000-4000-8000-9${String(db.items.length).padStart(11, "0")}`, recording_id: null, due_at: null, said: null, quote: null, at_ms: null, needs_review: false, notified_at: null, apple_sent_at: null, created_at: new Date().toISOString(), ...(req.postDataJSON() as Row) }); return json(route, [], 201); }
      if (req.method() === "PATCH") {
        const ids = inList("id") ?? [eq("id")];
        db.items = db.items.map((i) => (ids.includes(i.id as string) ? { ...i, ...(req.postDataJSON() as Row) } : i));
        return json(route, []);
      }
      let rows = db.items.slice();
      if (eq("recording_id")) rows = rows.filter((i) => i.recording_id === eq("recording_id"));
      if (inList("state")) rows = rows.filter((i) => inList("state")!.includes(i.state as string));
      if (q.get("state") === "neq.dismissed") rows = rows.filter((i) => i.state !== "dismissed");
      if (eq("type")) rows = rows.filter((i) => i.type === eq("type"));
      if (eq("state")) rows = rows.filter((i) => i.state === eq("state"));
      if (q.get("due_at")?.startsWith("lt.")) rows = rows.filter((i) => i.due_at && String(i.due_at) < q.get("due_at")!.slice(3));
      if ((q.get("select") ?? "").includes("recording:recordings")) {
        rows = rows.map((i) => {
          const r = db.recordings.find((x) => x.id === i.recording_id);
          return { ...i, recording: r ? { title: r.title, started_at: r.started_at, deleted_at: r.deleted_at } : null };
        });
      }
      return send(rows);
    }
    if (url.pathname === "/rest/v1/utterances") return send(db.utterances.filter((u) => u.recording_id === eq("recording_id")));
    if (url.pathname === "/rest/v1/settings") {
      if (req.method() === "POST") { db.settings = { ...db.settings, ...(req.postDataJSON() as Row) }; return json(route, [], 201); }
      return send([db.settings]);
    }
    if (url.pathname.startsWith("/rest/v1/")) return json(route, [], 200, { "content-range": "*/0" });
    return json(route, {});
  });
  return db;
}

const shot = async (page: Page, name: string) => {
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/walk-${name}.png`, fullPage: true });
};

test("walk through every screen with realistic data", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
  const db = await mockBackend(page);

  // Sign in
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  await shot(page, "01-login");
  await page.getByLabel("Email").fill("daniel@example.com");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Record screen: overdue banner, recordings in every state
  await expect(page.getByTestId("overdue-banner")).toContainText("1 overdue reminder");
  await expect(page.getByTestId("recent")).toHaveCount(4);
  await expect(page.getByTestId("recent").first()).toContainText("Transcribing");
  await expect(page.getByTestId("recent").nth(1)).toContainText("Failed");
  await shot(page, "02-record");

  // Notes list and search
  await page.getByRole("link", { name: "Notes" }).click();
  await expect(page.getByTestId("note")).toHaveCount(4);
  await expect(page.getByTestId("note").nth(2)).toContainText("2027 Budget Review");
  await expect(page.getByTestId("note").nth(2)).toContainText("· 1 h");
  await expect(page.getByTestId("note").nth(2)).not.toContainText("0 m");
  await expect(page.getByTestId("note").first()).toContainText("Untitled recording");
  await shot(page, "03-notes");
  await page.getByTestId("search").fill("survey");
  await expect(page.getByTestId("hit")).toHaveCount(2);
  await expect(page.locator("mark").first()).toHaveText("survey");
  // Results read like the rest of the app: a short day and plain words, not a raw date or an internal label.
  await expect(page.getByTestId("hit").nth(1)).toContainText("To-do at 06:52");
  await expect(page.getByTestId("hit").first()).not.toContainText("/2026");
  await shot(page, "04-search");

  // A search hit opens the recording at that moment
  await page.getByTestId("hit").first().click();
  await expect(page.getByTestId("note-title")).toHaveText("Call with Sam about the dock");
  await expect(page.getByText("Speaker B")).toBeVisible();
  await expect(page.getByTestId("cost")).toContainText("claude-opus-5-5");
  await shot(page, "05-note");

  // A moment that falls inside a line, not on its start, still lands on that line
  await page.goto(`/notes/${REC.dock}?t=414500`);
  await expect(page.locator("#u-412000")).toHaveCSS("border-radius", "8px");
  // The notifications notice can be put away
  if (await page.getByTestId("push-banner").count()) {
    await page.getByRole("button", { name: "Hide this notice" }).click();
    await expect(page.getByTestId("push-banner")).toHaveCount(0);
  }

  // A failed recording offers Retry
  await page.goto(`/notes/${REC.failed}`);
  await expect(page.getByTestId("note-status")).toContainText("Failed");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await shot(page, "06-note-failed");

  // To-dos: every section, with where each item came from
  await page.getByRole("link", { name: "To-dos" }).click();
  await expect(page.getByText("Overdue")).toBeVisible();
  await expect(page.getByText("Needs a look")).toBeVisible();
  await expect(page.getByTestId("item-source").first()).toContainText("•");
  await expect(page.getByTestId("apple-send")).toContainText("Send 4 to Apple Reminders");
  await shot(page, "07-todos");
  // Completing an item moves it to Done
  await page.getByLabel("Done: Email Sam the property survey").check();
  await expect.poll(() => db.items.find((i) => i.text === "Email Sam the property survey")?.state).toBe("done");
  // Keeping a suggested item makes it active
  await page.getByRole("button", { name: "Keep" }).click();
  await expect.poll(() => db.items.find((i) => i.text === "Check in with Sam on timing")?.state).toBe("active");
  // Adding one by hand
  await page.getByPlaceholder("Add a to-do").fill("Buy furnace filters");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Buy furnace filters")).toBeVisible();

  // Zeus
  await page.getByRole("link", { name: "Zeus" }).click();
  await shot(page, "08-zeus-start");
  await page.getByRole("button", { name: "What decisions and actions are outstanding?" }).click();
  await expect(page.getByTestId("turn-assistant")).toContainText("✓ Added reminder: Call Sam");
  await shot(page, "09-zeus-answer");

  // Settings, in both looks
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("account-email")).toHaveText("daniel@example.com");
  await expect(page.getByTestId("usage")).toContainText("4 recordings");
  await expect(page.getByTestId("heartbeat")).toHaveText("1 min ago");
  await shot(page, "10-settings");
  await page.getByTestId("theme").getByRole("button", { name: "Light" }).click();
  await shot(page, "11-settings-light");
  await page.getByRole("link", { name: "To-dos" }).click();
  await expect(page.getByText("Overdue")).toBeVisible();
  await shot(page, "12-todos-light");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByTestId("theme").getByRole("button", { name: "Dark" }).click();

  // Trash
  await page.getByTestId("trash-link").click();
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await shot(page, "13-trash");

  expect(errors, `browser errors: ${errors.join(" | ")}`).toEqual([]);
});
