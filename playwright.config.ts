import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    permissions: ["microphone"],
    viewport: { width: 390, height: 844 },
    launchOptions: {
      // A generated tone stands in for the microphone, and the permission prompt is accepted.
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/manifest.webmanifest`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Test-only values, added to the environment: a self-test secret for e2e/api.spec.ts to present, and the
    // mocked Supabase address, which the Content-Security-Policy (built from SUPABASE_URL) must allow.
    env: { SELFTEST_SECRET: "e2e-selftest-secret-0123456789abcdef", SUPABASE_URL: "https://mock-project.supabase.test" },
  },
});
