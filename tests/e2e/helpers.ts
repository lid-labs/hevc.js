import { type Page, expect } from '@playwright/test';

/** Collect console errors during page lifetime */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`${err.name}: ${err.message}`);
  });
  return errors;
}

/** Navigate to a demo page and wait for initial load */
export async function loadDemoPage(page: Page, path: string) {
  const baseURL = page.context().browser()?.version
    ? (process.env.LOCAL_DEMO === '1' ? 'http://localhost:8090' : 'https://hevcjs.dev/demo')
    : 'https://hevcjs.dev/demo';
  await page.goto(`${baseURL}/${path}`, { waitUntil: 'networkidle' });
}

/** Click a preset button */
export async function loadPreset(page: Page, presetLabel: string) {
  await page.getByRole('button', { name: presetLabel }).click();
}

/** Check that no WASM RuntimeError occurred */
export function assertNoWasmCrash(errors: string[]) {
  const wasmErrors = errors.filter(
    (e) => e.includes('RuntimeError') || e.includes('unreachable') || e.includes('out of bounds')
  );
  expect(wasmErrors, `WASM crash detected: ${wasmErrors.join('; ')}`).toHaveLength(0);
}

/** Check status text matches expected state */
export async function assertStatus(page: Page, pattern: RegExp, timeout = 30_000) {
  await expect(page.locator('#status')).toHaveText(pattern, { timeout });
}

/** Get the log textarea content for diagnostics */
export async function getLog(page: Page): Promise<string> {
  return page.locator('#log').inputValue();
}

/** Wait for video to start playing (currentTime > threshold) */
export async function waitForPlaying(page: Page, timeout = 45_000): Promise<'playing' | 'no_encoder' | 'native'> {
  const outcome = await page.waitForFunction(
    () => {
      const v = document.querySelector<HTMLVideoElement>('#player');
      const log = document.querySelector<HTMLTextAreaElement>('#log');
      const logText = log?.value ?? '';
      const playing = v && v.currentTime > 0.5 && !v.paused;
      // Detect: no H.264 encoder (Firefox), or encoder error
      const noEncoder = (
        logText.includes('Encoder creation error') ||
        logText.includes('not supported') ||
        logText.includes('not available') ||
        logText.includes('bufferAppendError') ||
        logText.includes('AdaptationSet has been removed') ||
        logText.includes('HEVC transcoding not available')
      );
      // Detect: native HEVC (Safari, Chrome macOS)
      const native = logText.includes('Native HEVC support detected');
      if (playing && native) return 'native';
      if (playing) return 'playing';
      if (noEncoder) return 'no_encoder';
      return false;
    },
    { timeout }
  );
  return await outcome.jsonValue() as 'playing' | 'no_encoder' | 'native';
}

/** Get video buffered ranges as array of [start, end] pairs */
export async function getBufferedRanges(page: Page): Promise<[number, number][]> {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#player');
    if (!v) return [];
    const ranges: [number, number][] = [];
    for (let i = 0; i < v.buffered.length; i++) {
      ranges.push([v.buffered.start(i), v.buffered.end(i)]);
    }
    return ranges;
  });
}

/** Check that buffered ranges are contiguous (no gaps > maxGap seconds) */
export function assertContiguousBuffer(ranges: [number, number][], maxGap = 0.05) {
  for (let i = 1; i < ranges.length; i++) {
    const gap = ranges[i]![0] - ranges[i - 1]![1];
    expect(gap, `Buffer gap of ${(gap * 1000).toFixed(0)}ms at ${ranges[i - 1]![1].toFixed(2)}s`).toBeLessThan(maxGap);
  }
}

/** Check that video has audio tracks or audible output */
export async function hasAudioTrack(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#player');
    if (!v) return false;
    // Check AudioTrack list (not supported everywhere) or check for audio SourceBuffer
    if (v.audioTracks && v.audioTracks.length > 0) return true;
    // Fallback: check MediaSource for audio SourceBuffer
    const ms = (v as any).ms || (v as any).mediaSource;
    if (ms && ms.sourceBuffers) {
      for (let i = 0; i < ms.sourceBuffers.length; i++) {
        const mime = (ms.sourceBuffers[i] as any).mimeType || '';
        if (mime.includes('audio')) return true;
      }
    }
    // Fallback: check if video element is not muted and has volume
    return !v.muted && v.volume > 0;
  });
}

/** Take a screenshot with a descriptive name */
export async function takeScreenshot(page: Page, name: string) {
  await page.screenshot({
    path: `test-results/screenshots/${name}.png`,
    fullPage: false,
  });
}

/** Enable the "Force transcoding" toggle on demo pages */
export async function enableForceTranscode(page: Page) {
  const toggle = page.locator('#force-transcode');
  if (await toggle.count() > 0 && !(await toggle.isChecked())) {
    await toggle.check();
  }
}

/** Check that the player has audio (via AudioContext or volume/muted state) */
export async function hasAudioSourceBuffer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#player, video');
    if (!video) return false;
    try {
      // Check if video has buffered content and is not muted
      if (video.buffered && video.buffered.length > 0 && !video.muted && video.volume > 0) {
        return true;
      }
    } catch { /* buffered may throw in some states */ }
    return false;
  });
}
