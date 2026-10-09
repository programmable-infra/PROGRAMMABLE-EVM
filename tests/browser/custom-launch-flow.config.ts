import { defineConfig } from "@playwright/test";

// Run the focused Custom Launch check without changing the global wallet suite.
export default defineConfig({
  testDir: ".",
  testMatch: "custom-launch-flow.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
});
