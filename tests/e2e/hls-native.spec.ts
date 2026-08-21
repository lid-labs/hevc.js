// Native-playback coverage for the hls.js demo.
//
// Every other HLS test calls enableForceTranscode(), which routes segments
// through our transcoder — and the transcoder reads HEVC parameter sets in-band,
// so it plays streams a native decoder cannot start. That blind spot let
// hls_abr ship with `hvc1` init segments whose hvcC held no VPS/SPS/PPS:
// transcoding worked, native playback failed on Safari and on Chrome.
//
// These tests take the path a user with hardware HEVC actually takes: no forced
// transcoding, the browser decoding the stream itself.
//
// Requires a browser with native HEVC — run with --project=local-chrome
// (bundled Chromium has none, and the tests skip themselves there).

import { test, expect } from '@playwright/test';
import {
  collectConsoleErrors,
  loadDemoPage,
  loadPreset,
  waitForPlaying,
  getBufferedRanges,
} from './helpers';

/** Whether this browser can decode HEVC through MSE, which is what hls.js uses. */
async function hasNativeHevc(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const MS = (globalThis as Record<string, unknown>).MediaSource as typeof MediaSource | undefined;
    if (!MS) return false;
    return MS.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.90"');
  });
}

test.describe('hls.js — native HEVC playback (no forced transcoding)', () => {
  for (const preset of [
    { label: 'ABR 480p/720p/1080p + audio (30s)', name: 'ABR' },
    { label: '720p (10s)', name: '720p' },
    { label: '1080p (5s)', name: '1080p' },
  ]) {
    test(`${preset.name} — plays natively`, async ({ page }) => {
      test.setTimeout(60_000);

      const errors = collectConsoleErrors(page);
      await loadDemoPage(page, 'hls.html');

      if (!(await hasNativeHevc(page))) {
        test.skip(true, 'Browser cannot decode HEVC natively');
        return;
      }

      await loadPreset(page, preset.label);
      const result = await waitForPlaying(page);
      expect(result, `${preset.name} did not reach playback`).not.toBe('no_encoder');

      // The defect this suite exists for surfaces as a failed SourceBuffer
      // append, so assert on it by name rather than only on "is it playing".
      const appendErrors = errors.filter(
        (e) => e.includes('bufferAppendError') || e.includes('bufferAppendingError'),
      );
      expect(appendErrors, `${preset.name}: SourceBuffer append failed`).toEqual([]);

      // Playback must actually progress, not just start.
      const ranges = await getBufferedRanges(page);
      const buffered = ranges.reduce((total, [start, end]) => total + (end - start), 0);
      expect(buffered, `${preset.name}: nothing buffered`).toBeGreaterThan(1);
    });
  }
});
