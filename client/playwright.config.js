import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the production build with the API mocked in each test,
// so they need no databases and run the same locally and in CI.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    // A placeholder project, so the admin page loads. Tests seed the session themselves
    // and nothing is ever sent to this address.
    env: { VITE_SUPABASE_URL: 'https://e2e.supabase.co', VITE_SUPABASE_ANON_KEY: 'e2e-anon-key' },
  },
});
