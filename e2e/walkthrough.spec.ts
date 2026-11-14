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
  const base = { user_id: USER_ID, time_zone: "America/New_York", part: 1, attempts: 0, failed_step: null, last_error: null, is_test: false, deleted_at: null, folder_id: null, audio_deleted_at: null, bytes: 4_800_000, mime_type: "audio/mp4" };
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
  return { recordings, items, utterances, folders: [] as Row[], settings: { model_mode: "auto", apple_reminders: true } as Row, searches: [] as Row[], oldSearch: false, offline: false, dropped: {} as Record<string, number>, zeusAsked: [] as Row[], actions: [] as Row[] };
}

async function mockBackend(page: Page) {
  const db = seed();
  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
    route.fulfill({ status, headers: { ...CORS, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  await page.route("**/api/config", (r) => json(r, { supabaseUrl: SUPABASE, supabaseAnonKey: "anon-key", vapidPublicKey: null, missing: [] }));
  await page.route("**/api/sync", (r) => json(r, { ok: true, userId: USER_ID, missing: [], databaseReady: true }));
  await page.route("**/api/kick", (r) => json(r, { accepted: true }, 202));
  await page.route("**/api/recordings/*/action", (r) => {
    db.actions.push({ id: new URL(r.request().url()).pathname.split("/")[3], ...(r.request().postDataJSON() as Row) });
    return json(r, { ok: true });
  });
  await page.route("**/api/zeus", (r) => { db.zeusAsked.push(r.request().postDataJSON() as Row); return r.fulfill({ status: 200, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Two things are outstanding.\n\n1. Email Sam the property survey.\n2. Call the county about the permit, due tomorrow morning.\n\n✓ Added reminder: Call Sam (Fri 13 Nov, 3:00 PM)\n" }); });

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const q = url.searchParams;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const eq = (k: string) => (q.get(k)?.startsWith("eq.") ? q.get(k)!.slice(3) : null);
    const inList = (k: string) => (q.get(k)?.startsWith("in.(") ? q.get(k)!.slice(4, -1).split(",").map((v) => v.replace(/"/g, "")) : null);
    const send = (rows: Row[]) => json(route, wantsObject ? (rows[0] ?? null) : rows, 200, { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
    // A dropped connection, as when a phone has just woken: database requests fail without an answer.
    if (db.offline && url.pathname.startsWith("/rest/v1/")) { db.dropped[url.pathname] = (db.dropped[url.pathname] ?? 0) + 1; return route.abort("connectionfailed"); }

    if (url.pathname === "/auth/v1/token") {
      const now = Math.floor(Date.now() / 1000);
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "daniel@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return json(route, { access_token: `${b64({ alg: "HS256" })}.${b64({ sub: USER_ID, exp: now + 3600 })}.sig`, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r", user });
    }
    if (url.pathname.startsWith("/storage/v1/object/sign/")) return json(route, { signedURL: "/object/sign/audio/x?token=t" });
    if (url.pathname === "/rest/v1/rpc/server_status") return json(route, { scheduler_last_run_at: hours(-0.01), last_tick_at: null, connected: true });
    if (url.pathname === "/rest/v1/rpc/search_notes") {
      const asked = req.postDataJSON() as Row;
      db.searches.push(asked);
      // A database set up before folder search existed has no function that takes a folder.
      if (db.oldSearch && "folder" in asked) return json(route, { code: "PGRST202", message: "Could not find the function public.search_notes(folder, q) in the schema cache" }, 404);
      return json(route, [
        { recording_id: REC.dock, title: "Call with Sam about the dock", started_at: hours(-50), kind: "transcript", at_ms: 412000, snippet: "I'll send you the [[survey]] tonight.", rank: 0.5 },
        { recording_id: REC.dock, title: "Call with Sam about the dock", started_at: hours(-50), kind: "todo", at_ms: 412000, snippet: "Email Sam the property [[survey]]", rank: 0.4 },
      ]);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(route, {});

    if (url.pathname === "/rest/v1/recordings") {
      if (req.method() === "PATCH") {
        // As in supabase/setup.sql, the phone may change only these two columns of a recording.
        const bad = Object.keys(req.postDataJSON() as Row).filter((c) => !["folder_id", "deleted_at"].includes(c));
        if (bad.length) return json(route, { code: "42501", message: `permission denied for table recordings (${bad.join(", ")})` }, 403);
        const ids = inList("id") ?? [eq("id")];
        db.recordings = db.recordings.map((r) => (ids.includes(r.id as string) ? { ...r, ...(req.postDataJSON() as Row) } : r));
        return json(route, []);
      }
      if (req.method() === "DELETE") { db.recordings = db.recordings.filter((r) => r.id !== eq("id")); return json(route, []); }
      let rows = db.recordings.slice().sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
      if (eq("id")) rows = rows.filter((r) => r.id === eq("id"));
      if (eq("folder_id")) rows = rows.filter((r) => r.folder_id === eq("folder_id"));
      if (q.get("deleted_at") === "is.null") rows = rows.filter((r) => !r.deleted_at);
      if (q.get("deleted_at") === "not.is.null") rows = rows.filter((r) => r.deleted_at);
      return send(rows);
    }
    if (url.pathname === "/rest/v1/folders") {
      if (req.method() === "POST") {
        const made = { id: `cccccccc-0000-4000-8000-00000000000${db.folders.length + 1}`, created_at: new Date().toISOString(), ...(req.postDataJSON() as Row) };
        db.folders.push(made);
        return json(route, wantsObject ? made : [made], 201);
      }
      if (req.method() === "PATCH") { db.folders = db.folders.map((f) => (f.id === eq("id") ? { ...f, ...(req.postDataJSON() as Row) } : f)); return json(route, []); }
      if (req.method() === "DELETE") {
        db.folders = db.folders.filter((f) => f.id !== eq("id"));
        db.recordings = db.recordings.map((r) => (r.folder_id === eq("id") ? { ...r, folder_id: null } : r));
        return json(route, []);
      }
      return send(db.folders.filter((f) => !eq("id") || f.id === eq("id")).sort((a, b) => String(a.name).localeCompare(String(b.name))));
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
  // Lets the walk read back what "Copy transcript" put on the clipboard.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

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
  // Before recording, the screen is the clock and the latest conversations: no how-to line and no import button.
  await expect(page.getByText(/Tap the blue microphone/)).toHaveCount(0);
  await expect(page.getByTestId("import-button")).toHaveCount(0);
  await shot(page, "02-record");

  // Home, on its Conversations header: the list and search
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("link", { name: "Conversations" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("note")).toHaveCount(4);
  await expect(page.getByTestId("note").nth(2)).toContainText("2027 Budget Review");
  await expect(page.getByTestId("note").nth(2)).toContainText("· 1 h");
  await expect(page.getByTestId("note").nth(2)).not.toContainText("0 m");
  await expect(page.getByTestId("note").first()).toContainText("Untitled recording");
  // The list carries no how-to line above it.
  await expect(page.getByText(/Swipe left to delete/)).toHaveCount(0);
  await shot(page, "03-notes");
  // Search lives behind the magnifying glass at the top right, beside the plus that imports audio.
  await expect(page.getByTestId("search")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import audio" })).toBeVisible();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("search")).toBeFocused();
  await page.getByTestId("search").fill("survey");
  await expect(page.getByTestId("hit")).toHaveCount(2);
  await expect(page.locator("mark").first()).toHaveText("survey");
  // Results read like the rest of the app: a short day and plain words, not a raw date or an internal label.
  await expect(page.getByTestId("hit").nth(1)).toContainText("To-do at 06:52");
  await expect(page.getByTestId("hit").first()).not.toContainText("/2026");
  await shot(page, "04-search");

  // A search hit opens the recording at that moment, on its Transcript tab
  await page.getByTestId("hit").first().click();
  await expect(page.getByTestId("note-title")).toHaveText("Call with Sam about the dock");
  await expect(page.getByTestId("tab-transcript")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Speaker B")).toBeVisible();
  await shot(page, "05a-note-transcript");

  // Summary tab: the summary, its to-dos and reminders, the audio and what the reading cost
  await page.getByTestId("tab-summary").click();
  await expect(page.getByTestId("note-summary")).toContainText("Sam can repair the dock the week of the 16th.");
  await expect(page.getByTestId("transcript")).toHaveCount(0);
  await expect(page.getByText("Email Sam the property survey")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play audio" })).toBeVisible();
  // No model, token or cost line under the summary, and no back button at the top.
  await expect(page.getByText(/Read by|tokens in/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  // Read by the best model already, so there is nothing to redo.
  await expect(page.getByTestId("redo")).toHaveCount(0);
  await shot(page, "05-note");

  // Read by the cheaper model: Redo is offered, and asks for the best model to read it again
  const dockRow = db.recordings.find((r) => r.id === REC.dock)!;
  dockRow.model_used = "claude-haiku-5-5";
  await page.reload();
  await page.getByTestId("tab-summary").click();
  await expect(page.getByTestId("redo")).toHaveText("Redo");
  await page.getByTestId("redo").click();
  await expect(page.getByText("Redoing with the best model.")).toBeVisible();
  expect(db.actions.at(-1)).toEqual({ id: REC.dock, action: "redo" });
  dockRow.model_used = "claude-opus-5-5";

  // Zeus tab: shown as the lightning bolt, named Zeus. A chat about this conversation alone, with the question bar at the foot.
  await expect(page.getByTestId("tab-zeus")).toHaveText("");
  await expect(page.getByTestId("tab-zeus").locator("svg")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Zeus" })).toBeVisible();
  // It pulses while another tab is open, and holds still once it is the open tab.
  const boltAnimation = () => page.getByTestId("tab-zeus").locator("svg").evaluate((el) => getComputedStyle(el).animationName);
  expect(await boltAnimation()).toBe("bolt-pulse");
  await page.getByTestId("tab-zeus").click();
  expect(await boltAnimation()).toBe("none");
  await expect(page.getByTestId("zeus-scope")).toHaveCount(0);
  const noteBar = (await page.getByTestId("chat-bar").boundingBox())!;
  const noteMic = (await page.getByTestId("record-button").boundingBox())!;
  expect(noteBar.y + noteBar.height).toBeLessThanOrEqual(noteMic.y);
  expect(noteMic.y - (noteBar.y + noteBar.height)).toBeLessThan(24);
  await page.getByRole("button", { name: "Who agreed to do what?" }).click();
  await expect(page.getByTestId("turn-assistant")).toContainText("Two things are outstanding.");
  expect(db.zeusAsked.at(-1)).toMatchObject({ recordingId: REC.dock });
  await shot(page, "05b-note-zeus");
  // Leaving the tab and coming back picks the chat up where it was.
  await page.getByTestId("tab-summary").click();
  await expect(page.getByTestId("zeus-chat")).toHaveCount(0);
  await page.getByTestId("tab-zeus").click();
  await expect(page.getByTestId("turn-user")).toHaveText(/Who agreed to do what\?/);
  await expect(page.getByTestId("turn-assistant")).toHaveCount(1);

  // Three dots: the same choices as press-and-hold, on the conversation's own screen
  await page.getByRole("button", { name: "Conversation options" }).click();
  await expect(page.getByTestId("peek")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Move to folder/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Move to Trash/ })).toBeVisible();
  await shot(page, "05c-note-menu");
  await page.getByRole("button", { name: "Copy transcript" }).click();
  await expect(page.getByTestId("sheet-message")).toContainText("Transcript copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("[06:52] Speaker A: I'll send you the survey tonight.");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("sheet")).toHaveCount(0);

  // The way out is the tab bar
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("link", { name: "Conversations" })).toHaveAttribute("aria-current", "page");

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

  // The earlier search was kept, and is offered again the next time search is opened
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByTestId("recent-search")).toHaveText(["survey"]);
  await shot(page, "04b-recent-searches");
  await page.getByTestId("recent-search").click();
  await expect(page.getByTestId("hit")).toHaveCount(2);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("search-screen")).toHaveCount(0);
  await expect(page.getByTestId("note")).toHaveCount(4);

  // To-dos: every section, with where each item came from. Search and import stay at the top right here too.
  await page.getByRole("link", { name: "Action Items" }).click();
  await expect(page.getByRole("link", { name: "Action Items" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import audio" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Zeus", exact: true })).toBeVisible();
  // An empty chat fits the screen exactly, notices included: nothing to scroll, the question bar at the foot.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBe(0);
  await shot(page, "08-zeus-start");
  await page.getByRole("button", { name: "What decisions and actions are outstanding?" }).click();
  await expect(page.getByTestId("turn-assistant")).toContainText("✓ Added reminder: Call Sam");
  await shot(page, "09-zeus-answer");

  // Settings, in both looks
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("account-email")).toHaveText("daniel@example.com");
  await expect(page.getByTestId("usage")).toContainText("4 recordings");
  await expect(page.getByTestId("heartbeat")).toHaveText("1 min ago");
  // The explanations live on the About page now, not on Settings itself.
  await expect(page.getByText(/An estimate from this app|Auto uses Claude Haiku|Audio is sent to AssemblyAI|Account id/)).toHaveCount(0);
  await shot(page, "10-settings");
  await page.getByTestId("theme").getByRole("button", { name: "Light" }).click();
  await shot(page, "11-settings-light");
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("link", { name: "Action Items" }).click();
  await expect(page.getByRole("link", { name: "Action Items" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Overdue")).toBeVisible();
  await shot(page, "12-todos-light");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByTestId("theme").getByRole("button", { name: "Dark" }).click();

  // Trash
  await page.getByTestId("trash-link").click();
  await expect(page.getByText("Trash is empty.")).toBeVisible();
  await shot(page, "13-trash");
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByTestId("account-email")).toBeVisible();

  // Phone check sits outside the tab bar, so it must offer its own way back
  await page.getByRole("link", { name: "Phone check" }).click();
  await expect(page.getByRole("heading", { name: "Phone check" })).toBeVisible();
  await shot(page, "14-phone-check");
  await page.getByTestId("back").click();
  await expect(page.getByTestId("account-email")).toBeVisible();

  // How it works: everything explained in one place, opened like Phone check
  await page.getByRole("link", { name: "How it works" }).click();
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveClass(/on/);
  await expect(page.getByTestId("about-ai")).toContainText("Auto uses Claude Haiku 5.5");
  await expect(page.getByTestId("about-cost")).toContainText("not your AssemblyAI or Claude bill");
  await expect(page.getByTestId("about-privacy")).toContainText("Audio is sent to AssemblyAI");
  await expect(page.getByTestId("about-zeus")).toContainText("Claude Sonnet 5.5");
  await expect(page.getByTestId("about-recording")).toContainText("Leaving the app open in the background");
  await expect(page.getByTestId("about-conversations")).toContainText("Swipe a conversation left to delete it");
  await expect(page.getByTestId("account-id")).toHaveText(USER_ID);
  await page.getByRole("button", { name: "Copy account id" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(USER_ID);
  await shot(page, "14b-about");
  await page.getByTestId("back").click();
  await expect(page.getByTestId("account-email")).toBeVisible();

  // Same for the notification-keys page
  await page.goto("/keys");
  await page.getByTestId("back").click();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

  // Press and hold a conversation: Share, Move to folder, Export
  await page.getByRole("link", { name: "Home" }).click();
  const dock = page.getByTestId("note").filter({ hasText: "Call with Sam about the dock" });
  await dock.scrollIntoViewIfNeeded();
  const box = (await dock.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 20);
  await page.mouse.down();
  await expect(page.getByTestId("sheet")).toBeVisible();
  await page.mouse.up();
  // Letting go after a hold must not open the conversation.
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByTestId("sheet")).toContainText("Call with Sam about the dock");
  // The card at the top says what the conversation is before anything is done with it.
  await expect(page.getByTestId("peek")).toContainText("18 min · 2 speakers");
  await expect(page.getByTestId("peek")).toContainText("Sam can repair the dock the week of the 16th.");
  await shot(page, "15-hold-menu");

  // Export the transcript as a text file
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export transcript/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Call with Sam about the dock.txt");
  const text = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
  // It was ticked off earlier in this walk, and the export says so.
  expect(text).toContain("[x] Email Sam the property survey");
  expect(text).toMatch(/\[ \] Call the county about the permit \(\w{3}, \w{3} \d/);
  expect(text).toContain("[06:52] Speaker A: I'll send you the survey tonight.");
  await expect(page.getByTestId("sheet-message")).toContainText("Saved Call with Sam about the dock.txt");

  // Share: this test browser has no share sheet, so the summary is copied and the app says so
  await page.getByRole("button", { name: /^Share/ }).click();
  await expect(page.getByTestId("sheet-message")).toContainText(/copied|would not allow copying/);

  // Move to a new folder
  await page.getByRole("button", { name: /Move to folder/ }).click();
  await expect(page.getByTestId("folder-choices")).toContainText("No folders yet");
  await page.getByLabel("New folder name").fill("Dock project");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByTestId("sheet")).toHaveCount(0);
  await expect(dock.getByTestId("row-folder")).toHaveText("Dock project");
  expect(db.recordings.find((r) => r.id === REC.dock)?.folder_id).toBe(db.folders[0].id);

  // A right-click (or the phone's own long-press event) opens the same menu; move a second one into the existing folder
  await page.getByTestId("note").filter({ hasText: "2027 Budget Review" }).click({ button: "right" });
  await page.getByRole("button", { name: /Move to folder/ }).click();
  await page.getByTestId("folder-choices").getByRole("button", { name: "Dock project" }).click();
  await expect(page.getByTestId("row-folder")).toHaveCount(2);

  // Folders tab: the folder, its count, its conversations; rename; remove one; delete the folder
  await page.getByRole("link", { name: "Folders" }).click();
  await expect(page.getByTestId("folder")).toContainText("Dock project");
  await expect(page.getByTestId("folder")).toContainText("2 conversations");
  await shot(page, "16-folders");
  await page.getByTestId("folder").click();
  await expect(page.getByTestId("folder-name")).toHaveText("Dock project");
  await expect(page.getByTestId("note")).toHaveCount(2);
  // Inside a folder the rows do not repeat the folder's name.
  await expect(page.getByTestId("row-folder")).toHaveCount(0);
  await shot(page, "17-folder");
  await page.getByTestId("note").filter({ hasText: "Call with Sam about the dock" }).click();
  await expect(page.getByTestId("note-title")).toHaveText("Call with Sam about the dock");
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  await page.getByRole("link", { name: "Folders" }).click();
  await page.getByTestId("folder").filter({ hasText: "Dock project" }).click();
  await expect(page.getByTestId("folder-name")).toHaveText("Dock project");
  // Top right of a folder: search, import, and three dots holding Add conversations, Rename folder and Delete folder
  await expect(page.getByRole("button", { name: "Search this folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import audio" })).toBeVisible();
  await page.getByRole("button", { name: "Folder options" }).click();
  await expect(page.getByTestId("folder-menu")).toContainText("2 conversations");
  await expect(page.getByRole("button", { name: "Add conversations" })).toBeVisible();
  await shot(page, "17b-folder-menu");
  await page.getByRole("button", { name: "Rename folder" }).click();
  await expect(page.getByTestId("folder-menu")).toHaveCount(0);
  await page.getByLabel("Folder name").fill("Dock repair");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("folder-name")).toHaveText("Dock repair");
  await page.getByTestId("note").filter({ hasText: "2027 Budget Review" }).click({ button: "right" });
  await page.getByRole("button", { name: /Move to folder/ }).click();
  await page.getByRole("button", { name: "Remove from folder" }).click();
  await expect(page.getByTestId("note")).toHaveCount(1);

  // Add conversations: everything not already here is offered; a picked one joins the folder
  await page.getByRole("button", { name: "Folder options" }).click();
  await page.getByRole("button", { name: "Add conversations" }).click();
  await expect(page.getByTestId("add-choices").locator("label")).toHaveCount(3);
  await expect(page.getByTestId("add-choices")).not.toContainText("Call with Sam about the dock");
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await page.getByTestId("add-choices").getByText("2027 Budget Review").click();
  await shot(page, "17c-add-conversations");
  await page.getByRole("button", { name: "Add 1" }).click();
  await expect(page.getByTestId("add-sheet")).toHaveCount(0);
  await expect(page.getByTestId("note")).toHaveCount(2);
  expect(db.recordings.find((r) => r.id === REC.budget)?.folder_id).toBe(db.folders[0].id);

  // Search inside a folder asks the database for this folder only
  await page.getByRole("button", { name: "Search this folder" }).click();
  await expect(page.getByTestId("search")).toHaveAttribute("placeholder", "Search in Dock repair");
  await page.getByTestId("search").fill("survey");
  await expect(page.getByTestId("hit")).toHaveCount(2);
  expect(db.searches.at(-1)).toEqual({ q: "survey", folder: db.folders[0].id });
  // On a database from before folder search, it searches everything and keeps this folder's matches
  db.oldSearch = true;
  await page.getByTestId("search").fill("survey tonight");
  await expect.poll(() => db.searches.at(-1)).toEqual({ q: "survey tonight" });
  expect(db.searches.at(-2)).toEqual({ q: "survey tonight", folder: db.folders[0].id });
  await expect(page.getByTestId("hit")).toHaveCount(2);
  await expect(page.getByTestId("search-partial")).toHaveCount(0);
  db.oldSearch = false;
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("search-screen")).toHaveCount(0);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Folder options" }).click();
  await page.getByRole("button", { name: "Delete folder" }).click();
  await expect(page.getByRole("heading", { name: "Folders" })).toBeVisible();
  await expect(page.getByTestId("folder")).toHaveCount(0);
  // Deleting a folder keeps its conversations.
  expect(db.recordings).toHaveLength(4);
  expect(db.recordings.every((r) => r.folder_id === null)).toBe(true);

  // Folders tab: no how-to text and no name box until the plus at the top right is tapped
  await expect(page.getByText(/To file a conversation/)).toHaveCount(0);
  await expect(page.getByLabel("New folder name")).toHaveCount(0);
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(page.getByLabel("New folder name")).toBeFocused();
  await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("New folder name")).toHaveCount(0);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("New folder name").fill("Taxes");
  await shot(page, "18-new-folder");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("New folder name")).toHaveCount(0);
  await expect(page.getByTestId("folder")).toHaveText(/Taxes\s*0 conversations/);

  expect(errors, `browser errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the notices at the top never flash on or off by mistake", async ({ page }) => {
  const db = await mockBackend(page);
  // A phone with notifications working: permission given, keys set up on the server, a subscription that takes a moment to look up.
  await page.route("**/api/config", (r) => r.fulfill({ json: { supabaseUrl: SUPABASE, supabaseAnonKey: "anon-key", vapidPublicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U", missing: [] } }));
  await page.addInitScript(() => {
    const sub = { endpoint: "https://push.example.test/abc", toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }) };
    const reg = { pushManager: { getSubscription: () => new Promise((done) => setTimeout(() => done(sub), 500)), subscribe: async () => sub } };
    // The test browser always refuses notifications, so the permission is stood in for as well.
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => reg, ready: Promise.resolve(reg), addEventListener() {}, removeEventListener() {} } });
    // Write down every time a notice comes or goes, however briefly.
    const log: string[] = [];
    const here: Record<string, boolean> = {};
    (window as unknown as { notices: string[] }).notices = log;
    new MutationObserver(() => {
      for (const id of ["push-banner", "overdue-banner"]) {
        const now = Boolean(document.querySelector(`[data-testid="${id}"]`));
        if (now !== Boolean(here[id])) { here[id] = now; log.push(`${id} ${now ? "shown" : "hidden"}`); }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const notices = () => page.evaluate(() => (window as unknown as { notices: string[] }).notices);

  await page.goto("/notes");
  await page.getByLabel("Email").fill("daniel@example.com");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("note")).toHaveCount(4);
  await expect(page.getByTestId("overdue-banner")).toBeVisible();
  // Long enough for the notifications check (half a second here) to have finished.
  await page.waitForTimeout(1200);
  // Opening the app: notifications are on, so their notice must never have appeared, not even for a moment.
  expect(await notices()).toEqual(["overdue-banner shown"]);

  // The phone wakes with no connection yet. Nothing is known to have changed, so nothing on screen may change.
  db.offline = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // The notifications save fails at once. The reminders look-up is tried four times in all before it gives up.
  await expect.poll(() => db.dropped["/rest/v1/push_subscriptions"] ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => db.dropped["/rest/v1/items"] ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(500);
  expect(await notices()).toEqual(["overdue-banner shown"]);
  await expect(page.getByTestId("overdue-banner")).toContainText("1 overdue reminder");

  // Back online, the next look confirms the same state, still without a flicker.
  db.offline = false;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(1200);
  expect(await notices()).toEqual(["overdue-banner shown"]);
});
