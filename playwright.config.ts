import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// E2E_OPERATOR_EMAIL / E2E_OPERATOR_PASSWORD for the seeded test operator (never committed).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

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
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-wide", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "mobile-small", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `bun run start --port ${port}`,
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
