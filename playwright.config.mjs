import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: '.codex-tmp/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node scripts/ui-test-server.mjs',
    url: 'http://127.0.0.1:4178/tests/fixtures/editor-harness.html',
    reuseExistingServer: true,
    timeout: 15_000
  }
});
