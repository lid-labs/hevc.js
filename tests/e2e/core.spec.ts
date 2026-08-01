import { test, expect } from '@playwright/test';
import { collectConsoleErrors, loadDemoPage, assertStatus } from './helpers';

// Guards the raw-decode demo page (index.html): its worker.js is a build
// artifact (build:demo), not a tracked file — a missing copy step ships a
// page whose decode pipeline is dead (worker 404) while other pages work.
test.describe('Core decoder demo', () => {
  test('page loads and the decode worker initializes', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loadDemoPage(page, 'index.html');

    // "Ready" is only set after worker.js loads and the WASM module inits
    await assertStatus(page, /Ready/);
    expect(errors).toEqual([]);
  });

  test('sample clip decodes end-to-end', async ({ page }) => {
    await loadDemoPage(page, 'index.html');
    await assertStatus(page, /Ready/);

    await page.locator('#use-sample').click();
    await assertStatus(page, /Decoded \d+ frames/, 60_000);
  });
});
