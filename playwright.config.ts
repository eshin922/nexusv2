import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: ".artifacts/validation/playwright-output",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: ".artifacts/validation/playwright-report", open: "never" }],
  ],
  globalSetup: "./tests/harness/global-setup.ts",
  globalTeardown: "./tests/harness/global-teardown.ts",
  use: {
    baseURL: process.env.NEXUS_VALIDATION_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run validation:app",
    url: process.env.NEXUS_VALIDATION_BASE_URL ?? "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "lifecycle-serial",
      testMatch: /slice-12\/.*\.spec\.ts/,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "read-only",
      testMatch: /smoke\/.*\.spec\.ts/,
      fullyParallel: true,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "costing-serial",
      testMatch: /costing\/.*\.spec\.ts/,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
