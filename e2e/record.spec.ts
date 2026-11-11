import { expect, test, type Page, type Route } from "@playwright/test";

const SUPABASE = "https://mock-project.supabase.test";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "*",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "Location, Upload-Offset, Upload-Length, Tus-Resumable, Content-Range",
};

type Mock = { uploadedBytes: number; uploadLength: number; pieces: number; objectName: string; rows: Record<string, unknown>[]; uploadAuth: string };

/** Stands in for Supabase (login, resumable storage, database) and this app's own sync route. */
async function mockBackend(page: Page): Promise<Mock> {
  const mock: Mock = { uploadedBytes: 0, uploadLength: 0, pieces: 0, objectName: "", rows: [], uploadAuth: "" };
  const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
    route.fulfill({ status, headers: { ...CORS, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  await page.route("**/api/config", (route) =>
    json(route, { supabaseUrl: SUPABASE, supabaseAnonKey: "anon-key", vapidPublicKey: null, missing: [] }));
  await page.route("**/api/sync", (route) => json(route, { ok: true, userId: USER_ID, missing: [], databaseReady: true }));

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });

    if (url.pathname === "/auth/v1/token") {
      const now = Math.floor(Date.now() / 1000);
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, role: "authenticated", exp: now + 3600 })}.sig`;
      const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "me@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      return json(route, { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "refresh", user });
    }

    if (url.pathname.startsWith("/storage/v1/upload/resumable")) {
      const tus = { ...CORS, "tus-resumable": "1.0.0" };
      const size = req.postDataBuffer()?.length ?? 0;
      if (req.method() === "POST") {
        mock.uploadAuth = req.headers()["authorization"] ?? "";
        mock.uploadLength = Number(req.headers()["upload-length"]);
        const meta = Object.fromEntries((req.headers()["upload-metadata"] ?? "").split(",").map((kv) => {
          const [k, v] = kv.trim().split(" ");
          return [k, Buffer.from(v ?? "", "base64").toString()];
        }));
        mock.objectName = `${meta.bucketName}/${meta.objectName}`;
        mock.uploadedBytes = size;
        if (size) mock.pieces++;
        return route.fulfill({ status: 201, headers: { ...tus, location: `${SUPABASE}/storage/v1/upload/resumable/upload-1`, "upload-offset": String(mock.uploadedBytes) } });
      }
      if (req.method() === "PATCH") {
        mock.uploadedBytes += size;
        mock.pieces++;
        return route.fulfill({ status: 204, headers: { ...tus, "upload-offset": String(mock.uploadedBytes) } });
      }
      return route.fulfill({ status: 200, headers: { ...tus, "upload-offset": String(mock.uploadedBytes), "upload-length": String(mock.uploadLength) } });
    }

    if (url.pathname === "/rest/v1/recordings") {
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        for (const row of Array.isArray(body) ? body : [body]) {
          if (!mock.rows.some((r) => r.id === row.id)) mock.rows.push({ title: null, ...row });
        }
        return json(route, [], 201);
      }
      const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      const id = url.searchParams.get("id")?.replace("eq.", "");
      const rows = id ? mock.rows.filter((r) => r.id === id) : mock.rows;
      return json(route, wantsObject ? (rows[0] ?? null) : rows, 200, { "content-range": `0-${rows.length}/${rows.length}` });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(route, {});
    if (url.pathname.startsWith("/rest/v1/")) return json(route, [], 200, { "content-range": "*/0" });
    return json(route, {});
  });
  return mock;
}

test("records with a fake microphone and reaches uploaded", async ({ page }) => {
  const mock = await mockBackend(page);
  await page.goto("/");

  // Login is email and password typed in the app.
  await page.getByLabel("Email").fill("me@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();

  const button = page.getByTestId("record-button");
  await expect(button).toHaveAttribute("aria-label", "Start recording");
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Stop recording");

  // Chunks are written to on-phone storage while recording, before anything is uploaded.
  await expect(page.getByTestId("rec-stats")).toContainText("left in this file", { timeout: 15_000 });
  const whileRecording = await page.evaluate(
    () => new Promise<{ chunks: number; state: string }>((resolve, reject) => {
      const open = indexedDB.open("voice-notes");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(["sessions", "chunks"]);
        const sessions = tx.objectStore("sessions").getAll();
        const chunks = tx.objectStore("chunks").count();
        tx.oncomplete = () => resolve({ chunks: chunks.result, state: sessions.result[0]?.state });
      };
    }),
  );
  expect(whileRecording.state).toBe("recording");
  expect(whileRecording.chunks).toBeGreaterThanOrEqual(1);
  expect(mock.uploadedBytes).toBe(0);

  await button.click();

  // The recording appears with the server status "uploaded".
  await expect(page.getByTestId("upload-status").first()).toHaveText("Uploaded, waiting", { timeout: 20_000 });
  expect(mock.rows).toHaveLength(1);
  const row = mock.rows[0] as { id: string; status: string; bytes: number; storage_path: string; time_zone: string; user_id: string; mime_type: string };
  expect(row.status).toBe("uploaded");
  expect(row.user_id).toBe(USER_ID);
  expect(row.time_zone).toBeTruthy();

  // The audio went straight to storage as a resumable upload, whole, under the owner's folder.
  expect(mock.uploadLength).toBeGreaterThan(1000);
  expect(mock.uploadedBytes).toBe(mock.uploadLength);
  expect(row.bytes).toBe(mock.uploadLength);
  expect(mock.objectName).toBe(`audio/${row.storage_path}`);
  expect(row.storage_path.startsWith(`${USER_ID}/${row.id}.`)).toBe(true);
  expect(mock.uploadAuth).toMatch(/^Bearer /);

  // Only after the server confirmed the row is the audio removed from the phone.
  await expect(page.getByTestId("local-session")).toHaveCount(0);
  const left = await page.evaluate(
    () => new Promise<number>((resolve) => {
      const open = indexedDB.open("voice-notes");
      open.onsuccess = () => {
        const count = open.result.transaction("chunks").objectStore("chunks").count();
        count.onsuccess = () => resolve(count.result);
      };
    }),
  );
  expect(left).toBe(0);
});

test("keeps the audio on the phone when the upload fails, and recovers on reopen", async ({ page }) => {
  const mock = await mockBackend(page);
  // Storage is down for now.
  await page.route(`${SUPABASE}/storage/v1/upload/resumable**`, (route) =>
    route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 400, headers: CORS, body: "bad request" }));
  await page.goto("/");
  await page.getByLabel("Email").fill("me@example.com");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  const button = page.getByTestId("record-button");
  await button.click();
  await expect(page.getByTestId("rec-stats")).toContainText("left in this file", { timeout: 15_000 });
  await button.click();

  await expect(page.getByTestId("local-session")).toContainText("Upload did not finish", { timeout: 20_000 });
  expect(mock.rows).toHaveLength(0);

  // Storage comes back. Reopening the app sends what was saved on the phone.
  await page.unroute(`${SUPABASE}/storage/v1/upload/resumable**`);
  await page.reload();
  await expect(page.getByTestId("upload-status").first()).toHaveText("Uploaded, waiting", { timeout: 20_000 });
  expect(mock.rows).toHaveLength(1);
  expect(mock.uploadedBytes).toBe(mock.uploadLength);
  await expect(page.getByTestId("local-session")).toHaveCount(0);
});

test("recovers a recording after the app is closed mid-recording", async ({ page }) => {
  const mock = await mockBackend(page);
  await page.goto("/");
  await page.getByLabel("Email").fill("me@example.com");
  await page.getByLabel("Password").fill("pw");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("record-button").click();
  await expect(page.getByTestId("rec-stats")).toContainText("left in this file", { timeout: 15_000 });

  // The app dies without Stop being tapped.
  await page.reload();
  await expect(page.getByTestId("recover")).toContainText("Unfinished recording found");
  expect(mock.rows).toHaveLength(0);
  await page.getByRole("button", { name: "Recover and upload" }).click();

  await expect(page.getByTestId("upload-status").first()).toHaveText("Uploaded, waiting", { timeout: 20_000 });
  expect(mock.rows).toHaveLength(1);
  expect(mock.uploadedBytes).toBeGreaterThan(100);
  expect(mock.uploadedBytes).toBe(mock.uploadLength);
});

test("phone check reports formats and builds the Shortcuts link", async ({ page }) => {
  await page.goto("/phone-check");
  await expect(page.getByTestId("env")).toContainText("Will record as");
  await expect(page.getByTestId("shortcut-link")).toHaveAttribute("href", /^shortcuts:\/\/run-shortcut\?name=Add%20From%20Voice%20Notes&input=text&text=/);
});
