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

/** Navigate to a demo page and wait for initial load. Relative: Playwright
 *  resolves it against the configured baseURL, so the target stays in one place. */
export async function loadDemoPage(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
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

/**
 * Slow the page's CPU down by `rate`x through CDP, so a machine that
 * transcodes faster than real time can be pushed below it on purpose.
 * The WASM decode is CPU-bound; WebCodecs encoding, being hardware
 * accelerated, is largely unaffected — which is exactly the shape of the
 * hardware issue #126 was reported on.
 *
 * Chromium only (CDP). Returns a restore function; call it in a finally
 * block, since the throttle outlives the test otherwise on a reused context.
 */
export async function throttleCpu(page: Page, rate: number): Promise<() => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
  return async () => {
    try {
      await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await session.detach();
    } catch {
      // Page or context already gone — nothing left to restore.
    }
  };
}

/** One reading of the compute-aware overlay on demo/shaka.html (same ids on dash.html). */
export interface ComputeOverlaySample {
  /** Per-segment speedX, as published on the perf bus. */
  speedX: number | null;
  /** Decider's smoothed speedX over its rolling window. */
  avgSpeedX: number | null;
  /** Cap index in the ladder, or null while the cap has never been applied. */
  capIndex: number | null;
  /** `init` | `hold` | `lower` | `raise`, or null before the first observation. */
  reason: string | null;
  /** Height the page announces for the active variant, in pixels. */
  announcedHeight: number | null;
  /** Raw overlay text, used to deduplicate consecutive samples. */
  raw: string;
}

/**
 * Read the four overlay spans in one evaluate, so a sample can't straddle
 * an update and mix two segments' values.
 */
export async function readComputeOverlay(page: Page): Promise<ComputeOverlaySample> {
  const raw = await page.evaluate(() => {
    const text = (id: string) => document.getElementById(id)?.textContent ?? '';
    return {
      quality: text('cmp-quality'),
      speed: text('cmp-speed'),
      cap: text('cmp-cap'),
      reason: text('cmp-reason'),
    };
  });

  const num = (s: string, re: RegExp): number | null => {
    const m = re.exec(s);
    return m ? Number(m[1]) : null;
  };

  return {
    speedX: num(raw.speed, /speedX:\s*([\d.]+)/),
    avgSpeedX: num(raw.speed, /avg\s*([\d.]+)/),
    capIndex: num(raw.cap, /cap:\s*idx\s*(\d+)/),
    reason: /reason:\s*(\w+)/.exec(raw.reason)?.[1] ?? null,
    announcedHeight: num(raw.quality, /quality:\s*(\d+)p/),
    raw: `${raw.quality} | ${raw.speed} | ${raw.cap} | ${raw.reason}`,
  };
}

/** Shaka ladder + ABR restrictions actually configured on the player. */
export interface ShakaAbrState {
  /** Tallest variant the manifest offers, in pixels. */
  topHeight: number | null;
  /**
   * Shortest variant the manifest offers, in pixels. The compute-aware decider
   * only ever subtracts from the ladder, so a player already on this rung has
   * nothing left to give up — telling that apart from a cap that failed to act
   * needs the floor, not just the top.
   */
  bottomHeight: number | null;
  /** Height of the variant Shaka is currently playing. */
  activeHeight: number | null;
  /** `abr.restrictions.maxHeight`, or null while unrestricted (Infinity). */
  maxHeight: number | null;
  /** `abr.restrictions.maxBandwidth`, or null while unrestricted. */
  maxBandwidth: number | null;
}

// demo/shaka.html declares `let player` at the top level of a classic script:
// a global lexical binding, reachable by name but absent from `window`. A
// serialized Playwright callback cannot close over it, so this is evaluated
// as source instead.
const SHAKA_ABR_STATE_EXPR = `(() => {
  if (typeof player === 'undefined' || !player) return null;
  var tracks = player.getVariantTracks ? player.getVariantTracks() : [];
  var heights = tracks.map(function (t) { return t.height; })
                      .filter(function (h) { return typeof h === 'number'; });
  var active = tracks.filter(function (t) { return t.active; })[0] || null;
  var cfg = player.getConfiguration ? player.getConfiguration() : null;
  var r = cfg && cfg.abr ? cfg.abr.restrictions : null;
  return {
    topHeight: heights.length ? Math.max.apply(null, heights) : null,
    bottomHeight: heights.length ? Math.min.apply(null, heights) : null,
    activeHeight: active && active.height != null ? active.height : null,
    maxHeight: r && Number.isFinite(r.maxHeight) ? r.maxHeight : null,
    maxBandwidth: r && Number.isFinite(r.maxBandwidth) ? r.maxBandwidth : null,
  };
})()`;

export async function readShakaAbrState(page: Page): Promise<ShakaAbrState | null> {
  return page.evaluate<ShakaAbrState | null>(SHAKA_ABR_STATE_EXPR);
}

/** Playback position and end state, for checking that playback keeps advancing. */
export interface PlaybackState {
  currentTime: number;
  /** NaN before metadata is known. */
  duration: number;
  ended: boolean;
  paused: boolean;
}

export async function getPlaybackState(page: Page): Promise<PlaybackState> {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#player');
    return {
      currentTime: v?.currentTime ?? 0,
      duration: v?.duration ?? NaN,
      ended: v?.ended ?? false,
      paused: v?.paused ?? true,
    };
  });
}

// Both helpers below reach the demo's `let player` by name, for the reason
// given above SHAKA_ABR_STATE_EXPR.

/** Read one dotted path out of `player.getConfiguration()`. */
export async function readShakaConfigValue<T>(page: Page, path: string): Promise<T | null> {
  return page.evaluate<T | null>(`(() => {
    if (typeof player === 'undefined' || !player || !player.getConfiguration) return null;
    var node = player.getConfiguration();
    var parts = ${JSON.stringify(path)}.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (node == null) return null;
      node = node[parts[i]];
    }
    return node === undefined ? null : node;
  })()`);
}

/**
 * Apply a configuration patch to the demo's player, the way an application
 * would. Serialised into the expression, so it must be plain JSON data.
 */
export async function configureShaka(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(`(() => {
    if (typeof player === 'undefined' || !player || !player.configure) {
      throw new Error('no shaka player on the page to configure');
    }
    player.configure(${JSON.stringify(patch)});
  })()`);
}
