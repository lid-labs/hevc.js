import { test, expect } from '@playwright/test';
import {
  collectConsoleErrors,
  loadDemoPage,
  loadPreset,
  assertNoWasmCrash,
  assertStatus,
  getLog,
  enableForceTranscode,
  hasAudioSourceBuffer,
} from './helpers';

test.describe('DASH Player', () => {
  test('page loads without fatal errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loadDemoPage(page, 'dash.html');

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
    test(`${preset.name} — transcode pipeline`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await loadDemoPage(page, 'dash.html');
      await loadPreset(page, preset.label);

      // Wait for: video plays, native HEVC detected, or known error
      const outcome = await page.waitForFunction(
        () => {
          const v = document.querySelector<HTMLVideoElement>('#player');
          const log = document.querySelector<HTMLTextAreaElement>('#log');
          const logText = log?.value ?? '';
          const playing = v && v.currentTime > 0.5 && !v.paused;
          const native = logText.includes('Native HEVC support detected');
          const noEncoder = (
            logText.includes('Encoder creation error') ||
            logText.includes('H.264 encoding not supported') ||
            logText.includes('bufferAppendError') ||
            logText.includes('AdaptationSet has been removed')
          );
          if (playing && native) return 'native';
          if (playing) return 'playing';
          if (noEncoder) return 'no_encoder';
          return false;
        },
        { timeout: 45_000 }
      );

      const result = await outcome.jsonValue();
      const log = await getLog(page);

      if (result === 'playing') {
        expect(log).toContain('Worker transcoder ready');
        const t0 = await page.evaluate(() =>
          document.querySelector<HTMLVideoElement>('#player')!.currentTime
        );
        await page.waitForTimeout(3000);
        const t1 = await page.evaluate(() =>
          document.querySelector<HTMLVideoElement>('#player')!.currentTime
        );
        expect(t1).toBeGreaterThan(t0 + 0.5);
        await assertStatus(page, /Playing/);
      }
      if (result === 'native') {
        // Native HEVC — verify playback works without transcoding
        expect(log).not.toContain('Worker transcoder ready');
        const t0 = await page.evaluate(() =>
          document.querySelector<HTMLVideoElement>('#player')!.currentTime
        );
        await page.waitForTimeout(2000);
        const t1 = await page.evaluate(() =>
          document.querySelector<HTMLVideoElement>('#player')!.currentTime
        );
        expect(t1).toBeGreaterThan(t0 + 0.5);
      }
      // result === 'no_encoder' is acceptable (browser lacks H.264 VideoEncoder)

      assertNoWasmCrash(errors);
    });
  }
});

test.describe('DASH Player — forceTranscode', () => {
  for (const preset of [
    { label: 'ABR 480p/720p/1080p + audio (30s)', name: 'ABR' },
    { label: '720p (10s)', name: '720p' },
  ]) {
    test(`${preset.name} — forced WASM transcode pipeline`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await loadDemoPage(page, 'dash.html');
      await enableForceTranscode(page);
      await loadPreset(page, preset.label);

      const outcome = await page.waitForFunction(
        () => {
          const v = document.querySelector<HTMLVideoElement>('#player');
          const log = document.querySelector<HTMLTextAreaElement>('#log');
          const playing = v && v.currentTime > 0.5 && !v.paused;
          const noEncoder = log && (
            log.value.includes('Encoder creation error') ||
            log.value.includes('H.264 encoding not supported') ||
            log.value.includes('not available')
          );
          if (playing) return 'playing';
          if (noEncoder) return 'no_encoder';
          return false;
        },
        { timeout: 45_000 }
      );

      const result = await outcome.jsonValue();
      const log = await getLog(page);

      if (result === 'playing') {
        // forceTranscode: WASM pipeline must be active even on native-HEVC browsers
        expect(log).toContain('installing WASM transcoder');
        expect(log).toContain('Worker transcoder ready');

        const t0 = await page.evaluate(() =>
          document.querySelector<HTMLVideoElement>('#player')!.currentTime
        );
        await page.waitForTimeout(3000);
        const t1 = await page.evaluate(() =>
          document.querySelector<HTMLVideoElement>('#player')!.currentTime
        );
        expect(t1).toBeGreaterThan(t0 + 0.5);

        // ABR preset has audio — verify it's not lost during transcoding
        if (preset.name === 'ABR') {
          const hasAudio = await hasAudioSourceBuffer(page);
          expect(hasAudio, 'Audio should be present in ABR forceTranscode').toBe(true);
        }
      }

      assertNoWasmCrash(errors);
    });
  }
});

test.describe('DASH Player — cross-origin asset loading', () => {
  // Page is served from http://localhost:8090, worker + wasm are pulled from
  // http://127.0.0.1:8090 — same machine, different origin. Exercises the
  // auto-fetch + blob URL fallback in TranscodeWorkerClient and the
  // wasmBinaryUrl plumbing through to Emscripten's locateFile.
  test.skip(
    process.env.LOCAL_DEMO !== '1',
    'cross-origin test relies on the LOCAL_DEMO Python server bound to 0.0.0.0',
  );

  test('worker + wasm loaded from a different origin', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const crossOriginBase = 'http://127.0.0.1:8090';
    const params = new URLSearchParams({
      workerUrl: `${crossOriginBase}/transcode-worker.js`,
      wasmUrl: `${crossOriginBase}/hevc-decode.js`,
      wasmBinaryUrl: `${crossOriginBase}/hevc-decode.wasm`,
    });
    await page.goto(`http://localhost:8090/dash.html?${params}`, { waitUntil: 'networkidle' });
    await enableForceTranscode(page);
    await loadPreset(page, '720p (10s)');

    await page.waitForFunction(
      () => {
        const v = document.querySelector<HTMLVideoElement>('#player');
        return !!(v && v.currentTime > 0.5 && !v.paused);
      },
      { timeout: 45_000 },
    );

    const log = await getLog(page);
    expect(log).toContain('installing WASM transcoder');
    expect(log).toContain('Worker transcoder ready');

    const t0 = await page.evaluate(() => document.querySelector<HTMLVideoElement>('#player')!.currentTime);
    await page.waitForTimeout(2000);
    const t1 = await page.evaluate(() => document.querySelector<HTMLVideoElement>('#player')!.currentTime);
    expect(t1).toBeGreaterThan(t0 + 0.5);

    assertNoWasmCrash(errors);
  });
});
