import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["line"]] : "line",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "touch-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 820, height: 900 },
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVERS
    ? undefined
    : [
        {
          command: "node node_modules/next/dist/bin/next dev -p 3000",
          cwd: "apps/pos-web",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: "node node_modules/next/dist/bin/next dev -p 3001",
          cwd: "apps/admin-web",
          url: "http://localhost:3001/?demo=1",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: "node node_modules/next/dist/bin/next dev -p 3002",
          cwd: "apps/kds-web",
          url: "http://localhost:3002/?demo=1",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
