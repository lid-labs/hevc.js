import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { assertNoWasmCrash, assertStatus, collectConsoleErrors, loadDemoPage, loadPreset } from './helpers';

interface DemoResult {
  label: string;
  error?: string;
  native: boolean;
  decoder: string;
  frames: number;
  timestamps: number[];
  format: string;
  size: string;
  meanLuma: number;
}

async function decodePreset(page: Page, label: string, { fast = true } = {}): Promise<DemoResult> {
  // The page plays frames at their timestamps unless told to decode flat out
  await page.locator('#fast-decode').setChecked(fast);
  await loadPreset(page, label);
  // Set by the page once the last sample is drawn, or on error
  const handle = await page.waitForFunction(() => (window as any).demoResult, null, { timeout: 60_000 });
  return (await handle.jsonValue()) as DemoResult;
}

const PRESETS = [
  // Two packets share a timestamp at each 2s segment boundary of this DASH
  // rendition (ffprobe shows the same), so timestamps only never decrease.
  { label: 'BBB 720p (10s)', frames: 250, size: '1280x720', formats: ['I420'] },
  // I420P10 where VideoFrame accepts it (Chromium), scaled to 8 bits elsewhere (Firefox)
  { label: 'Main 10 QCIF (10 frames)', frames: 10, size: '176x144', formats: ['I420P10', 'I420'] },
];

test.describe('Mediabunny plugin', () => {
  for (const preset of PRESETS) {
    for (const force of [false, true]) {
      test(`${preset.label}${force ? ', forced' : ''} — every frame decoded, in display order`, async ({ page }) => {
        const errors = collectConsoleErrors(page);
        await loadDemoPage(page, force ? 'mediabunny.html?force=1' : 'mediabunny.html');
        await assertStatus(page, /Ready/);

        const result = await decodePreset(page, preset.label);
        expect(result.error).toBeUndefined();
        if (result.native && !force) {
          // WebCodecs keeps the profiles it decodes; what it then outputs is the
          // browser's doing, not the plugin's — the forced run covers the plugin.
          expect(result.decoder).toBe('WebCodecs (native)');
          return;
        }

        expect(result.decoder).toBe('hevc.js (WASM)');
        expect(result.frames).toBe(preset.frames);
        expect(result.size).toBe(preset.size);
        expect(preset.formats).toContain(result.format);
        for (let i = 1; i < result.timestamps.length; i++) {
          expect(result.timestamps[i]!).toBeGreaterThanOrEqual(result.timestamps[i - 1]!);
        }
        // A decoded picture, not a blank canvas
        expect(result.meanLuma).toBeGreaterThan(10);
        await assertStatus(page, new RegExp(`Done — ${preset.frames} frames`));
        assertNoWasmCrash(errors);
      });
    }
  }

  test('plays frames at their timestamps by default', async ({ page }) => {
    await loadDemoPage(page, 'mediabunny.html?force=1');
    await assertStatus(page, /Ready/);

    const start = Date.now();
    const result = await decodePreset(page, 'Main 10 QCIF (10 frames)', { fast: false });
    const wallMs = Date.now() - start;

    expect(result.error).toBeUndefined();
    expect(result.frames).toBe(10);
    // The last frame is due (last - first) timestamp after the first one; decoding flat out takes ~20 ms
    const spanMs = (result.timestamps[9]! - result.timestamps[0]!) * 1000;
    expect(spanMs).toBeGreaterThan(300);
    expect(wallMs).toBeGreaterThanOrEqual(spanMs);
  });
});
