import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: the web app in a real browser, against the real API on a
 * throwaway database schema, with Google sign-in and Gmail replaced
 * (backend/src/e2e/server.ts).
 *
 * Run from the repository root with `npm run test:e2e`, which creates the
 * schema, starts both servers through the webServer entries below, and drops
 * the schema afterwards.
 */

export const API_URL = 'http://127.0.0.1:3100'
const WEB_PORT = 5174

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  // One journey, one database, one browser at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx src/e2e/server.ts',
      cwd: '../backend',
      url: `${API_URL}/api/health`,
      env: { NODE_ENV: 'test', E2E: '1', PORT: '3100' },
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      // Another port than the development server, so a running `npm run dev`
      // does not answer in its place.
      command: `npx vite --port ${String(WEB_PORT)} --strictPort`,
      cwd: '../frontend',
      url: `http://localhost:${String(WEB_PORT)}`,
      env: { VITE_BACKEND_URL: API_URL },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
})
