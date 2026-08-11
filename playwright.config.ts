import { defineConfig } from '@playwright/test';

// LOCAL_DEMO=1 → serve demo/ locally (for both local-chromium and BrowserStack Local)
const LOCAL_DEMO = process.env.LOCAL_DEMO === '1';
const LOCAL_PORT = 8090;
const BASE_URL = LOCAL_DEMO
  ? `http://localhost:${LOCAL_PORT}`
  : 'https://hevcjs.dev/demo';

const BS_USER = process.env.BROWSERSTACK_USERNAME || '';
const BS_KEY = process.env.BROWSERSTACK_ACCESS_KEY || '';
const PW_VERSION = '1.57.0';

// BrowserStack browser matrix
const bsBrowsers = [
  { name: 'Chrome Windows', browser: 'chrome', os: 'Windows', os_version: '11' },
  { name: 'Edge Windows', browser: 'edge', os: 'Windows', os_version: '11' },
  { name: 'Firefox Windows', browser: 'playwright-firefox', os: 'Windows', os_version: '11' },
  { name: 'Chrome macOS', browser: 'chrome', os: 'osx', os_version: 'Sonoma' },
  { name: 'Safari macOS', browser: 'playwright-webkit', os: 'osx', os_version: 'Sonoma' },
];

function bsEndpoint(b: typeof bsBrowsers[0]) {
  const caps = {
    'browserstack.username': BS_USER,
    'browserstack.accessKey': BS_KEY,
    browser: b.browser,
    browser_version: 'latest',
    os: b.os,
    os_version: b.os_version,
    'client.playwrightVersion': PW_VERSION,
    name: `hevc.js — ${b.name}`,
    project: 'hevc.js',
    build: 'E2E Cross-Browser — Bug Fixes',
    // BrowserStack Local tunnel — access localhost from remote browsers
    ...(LOCAL_DEMO && { 'browserstack.local': 'true' }),
  };
  return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  // Local demo server (only when LOCAL_DEMO=1)
  ...(LOCAL_DEMO && {
    webServer: {
      // CORS handler — needed by the cross-origin asset loading test
      // (page on localhost, worker/wasm fetched from 127.0.0.1).
      command: `python3 ../tests/cors-server.py ${LOCAL_PORT}`,
      cwd: './demo',
      port: LOCAL_PORT,
      reuseExistingServer: true,
    },
  }),
  projects: [
    {
      name: 'local-chromium',
      use: { browserName: 'chromium' },
    },
    ...bsBrowsers.map((b) => ({
      name: `bs-${b.name.toLowerCase().replace(/\s+/g, '-')}`,
      use: {
        connectOptions: {
          wsEndpoint: bsEndpoint(b),
          timeout: 60_000,
        },
      },
    })),
  ],
});
