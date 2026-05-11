import { test, expect } from '@playwright/test';
import {
  collectConsoleErrors,
  loadDemoPage,
  loadPreset,
  assertStatus,
  enableForceTranscode,
} from './helpers';

test.describe('Shaka Player', () => {
  test('page loads without fatal errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loadDemoPage(page, 'shaka.html');

    await assertStatus(page, /Ready/);
    const fatalErrors = errors.filter(
      (e) =>
        !e.includes('VideoEncoder') &&
        !e.includes('NotSupportedError') &&
        !e.includes('404') &&
        !e.includes('Failed to load resource')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  for (const preset of [
    { label: '720p (10s)', name: '720p' },
    { label: '1080p (5s)', name: '1080p' },
    { label: '4K (5s)', name: '4K' },
  ]) {
    test(`${preset.name} — forced WASM transcode pipeline`, async ({ page }) => {
      // 4K transcode on a CI runner can take a while.
      test.setTimeout(60_000);

      const errors = collectConsoleErrors(page);
      await loadDemoPage(page, 'shaka.html');
      await enableForceTranscode(page);
      await loadPreset(page, preset.label);

      // Wait for: video plays, or known unrecoverable error.
      // Shaka emits "Possible encoding problem" via console.error for minor
      // buffered-range discrepancies — that's a warning, not a fatal stop.
      const outcome = await page.waitForFunction(
        () => {
          const v = document.querySelector<HTMLVideoElement>('#player');
          const log = document.querySelector<HTMLTextAreaElement>('#log');
          const logText = log?.value ?? '';
          const playing = v && v.currentTime > 0.5 && !v.paused;
          const fatal =
            logText.includes('Shaka Error') ||
            logText.includes('Load error') ||
            logText.includes('HEVC transcoding is not available');
          if (playing) return 'playing';
          if (fatal) return 'errored';
          return false;
        },
        { timeout: 45_000 }
      );
      const result = await outcome.jsonValue();
      expect(result, `outcome=${result}`).toBe('playing');

      const fatalConsoleErrors = errors.filter(
        (e) =>
          // Shaka warning, not a real failure (see helper).
          !e.includes('Possible encoding problem') &&
          // 404s on optional probes / asset slots — irrelevant to us.
          !e.includes('404') &&
          !e.includes('Failed to load resource') &&
          !e.includes('NotSupportedError') &&
          !e.includes('VideoEncoder')
      );
      expect(fatalConsoleErrors).toEqual([]);
    });
  }
});
