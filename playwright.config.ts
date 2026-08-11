import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @collabdocs/web dev",
      url: "http://localhost:3000/api/health/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @collabdocs/realtime dev",
      url: "http://localhost:1234/health/ready",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
