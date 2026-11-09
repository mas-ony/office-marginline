import { defineConfig, devices } from '@playwright/test';

const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

// The same suite runs against the React app and the Vue app.
// E2E_BASE_URL / E2E_VUE_URL=http://<LAN address>:<port> run it in an insecure (plain HTTP)
// context, like a phone on the local network.
const react = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5177';
const vue = process.env.E2E_VUE_URL ?? 'http://127.0.0.1:5181';
const desktop = { viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: chrome } };
const phone = { ...devices['Pixel 7'], launchOptions: { executablePath: chrome } };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @marginline/web-react exec vite --port 5177 --strictPort',
      url: 'http://127.0.0.1:5177',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @marginline/web-vue exec vite --port 5181 --strictPort',
      url: 'http://127.0.0.1:5181',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: 'react-desktop', use: { ...desktop, baseURL: react }, testIgnore: /mobile\.spec/ },
    { name: 'react-mobile', use: { ...phone, baseURL: react }, testMatch: /mobile\.spec/ },
    { name: 'vue-desktop', use: { ...desktop, baseURL: vue }, testIgnore: /mobile\.spec/ },
    { name: 'vue-mobile', use: { ...phone, baseURL: vue }, testMatch: /mobile\.spec/ },
  ],
});
