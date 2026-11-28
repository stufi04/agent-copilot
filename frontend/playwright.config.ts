import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: a real Chromium drives the production build of the editor.
// Runs on its own port so it never collides with a `make ui` dev server.
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // Point "Speak to agent" at a port nothing listens on, so a test can never place a
    // real call (with real API keys) through a voice backend that happens to be running.
    env: { VITE_BACKEND_URL: 'http://localhost:9' },
    timeout: 120_000,
  },
});
