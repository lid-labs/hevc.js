import { test, expect } from '@playwright/test';
import {
  collectConsoleErrors,
  loadDemoPage,
  loadPreset,
  assertStatus,
  enableForceTranscode,
} from './helpers';

test.describe('hls.js Player', () => {
  test('page loads without fatal errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loadDemoPage(page, 'hls.html');

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
    { label: 'ABR 480p/720p/1080p + audio (30s)', name: 'ABR' },
    { label: '720p (10s)', name: '720p' },
    { label: '1080p (5s)', name: '1080p' },
    { label: '4K (5s)', name: '4K' },
  ]) {
    test(`${preset.name} — forced WASM transcode pipeline`, async ({ page }) => {
      // 4K transcode on a CI runner can take a while.
      test.setTimeout(90_000);

      await loadDemoPage(page, 'hls.html');
      await enableForceTranscode(page);
      await loadPreset(page, preset.label);

      const outcome = await page.waitForFunction(
        () => {
          const v = document.querySelector<HTMLVideoElement>('#player');
          const log = document.querySelector<HTMLTextAreaElement>('#log');
          const logText = log?.value ?? '';
          const playing = v && v.currentTime > 0.5 && !v.paused;
          const fatal =
            logText.includes('(fatal)') ||
            logText.includes('HEVC transcoding is not available');
          if (playing) return 'playing';
          if (fatal) return 'errored';
          return false;
        },
        { timeout: 60_000 }
      );
      expect(await outcome.jsonValue()).toBe('playing');
    });
  }

  // A muxed audio+video HEVC rendition (single audiovideo SourceBuffer,
  // codecs="...,mp4a...") plays both tracks: the HEVC video is transcoded and
  // the AAC audio is passed through, re-muxed into one A/V segment.
  test('muxed A/V rendition plays with both video and audio', async ({ page }) => {
    test.setTimeout(60_000);

    await loadDemoPage(page, 'hls.html');
    await enableForceTranscode(page);
    await loadPreset(page, 'Muxed A/V (6s)');

    // Video plays...
    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#player');
        return !!v && v.currentTime > 1 && v.videoWidth > 0 && !v.error;
      },
      { timeout: 45_000 },
    );

    // ...and the muxed audio track actually decodes (pass-through worked).
    const audioBytes = await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('#player');
      return (v as unknown as { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount ?? 0;
    });
    expect(audioBytes, 'muxed audio must decode').toBeGreaterThan(0);
  });

  // Regression: out-of-buffer seek. hls.js >=1.6.6 repositions without
  // abort() or a timestampOffset write, relying on the segment tfdt alone.
  // The transcoder must rebase mp4box's cumulative clock onto that tfdt or
  // transcoded video lands in the wrong buffered range (audio, passed
  // through untouched, lands right — video/audio then never overlap).
  test('ABR — out-of-buffer seek lands at the target position', async ({ page }) => {
    test.setTimeout(90_000);

    await loadDemoPage(page, 'hls.html');
    await enableForceTranscode(page);
    await loadPreset(page, 'ABR 480p/720p/1080p + audio (30s)');

    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#player');
        return v && v.currentTime > 1 && !v.paused;
      },
      { timeout: 60_000 }
    );

    // Jump well past anything buffered (30s stream, ~6s buffered by now)
    await page.evaluate(() => {
      document.querySelector<HTMLVideoElement>('#player')!.currentTime = 19.5;
    });

    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#player')!;
        if (v.currentTime <= 20 || v.error) return false;
        // The buffered range containing the playhead must cover the seek
        // target — transcoded video actually landed where the tfdt says.
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= 19.5 && v.buffered.end(i) > 20) return true;
        }
        return false;
      },
      { timeout: 30_000 }
    );
  });
});
