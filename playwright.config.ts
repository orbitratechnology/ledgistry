import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD for the seeded test operator (never committed).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
// A second local server with invalid Airwallex credentials and AI switched off, for the failure paths.
const failurePort = Number(process.env.E2E_FAILURE_PORT ?? 3101);
const failureURL = `http://localhost:${failurePort}`;
const runFailurePaths = !process.env.E2E_BASE_URL;
const FAILURE_SPEC = /failure-paths\.spec\.ts/;

// Use a preinstalled Chromium when the pinned Playwright build isn't downloaded (e.g. cloud sessions).
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

/**
 * End-to-end checks against a production build (`bun run build` first).
 * Never points at production money-moving endpoints: the app is sandbox-only.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", testIgnore: FAILURE_SPEC, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-wide", testIgnore: FAILURE_SPEC, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "tablet",
      testIgnore: FAILURE_SPEC,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    { name: "mobile", testIgnore: FAILURE_SPEC, use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-small", testIgnore: FAILURE_SPEC, use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } } },
    ...(runFailurePaths
      ? [
          {
            name: "failure-paths",
            testMatch: FAILURE_SPEC,
            use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, baseURL: failureURL },
          },
        ]
      : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `bun run start --port ${port}`,
          url: `${baseURL}/login`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          // Same build, but Airwallex rejects the credentials and AI is off.
          command: `bun run start --port ${failurePort}`,
          url: `${failureURL}/login`,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            ...(process.env as Record<string, string>),
            AIRWALLEX_API_KEY: "invalid-e2e-key",
            AIRWALLEX_SECRET: "invalid-e2e-key",
            LEDGISTRY_AI: "off",
          },
        },
      ],
});
