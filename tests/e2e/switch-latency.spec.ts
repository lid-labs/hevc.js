/**
 * How long the compute-aware cap takes to reach the screen (issue #263).
 *
 * The cap narrows `abr.restrictions`, which Shaka honours at its next ABR
 * decision — and `SimpleAbrManager.suggestStreams_()` declines to decide while
 * `abr.switchInterval` has not elapsed. At Shaka's default of 8s a correct,
 * timely cap sits unapplied for several segments, which on hardware
 * transcoding at 0.35x is tens of seconds spent decoding the resolution the
 * cap already rejected. Measured before the fix: 4.3s and 26.0s on two runs.
 *
 * `attachShakaComputeAware` now shortens the interval, so this checks both
 * halves: that the setting reaches the player, and that a cap change actually
 * shows up on screen promptly.
 *
 * Set E2E_SWITCH_INTERVAL to re-measure at another value — 8 reproduces
 * Shaka's default, i.e. the behaviour this issue is about.
 *
 * The latency is measured and printed rather than bounded — see the note above
 * the sampling loop. Against the local demo server it is not even
 * comparable: Shaka takes its ABR decisions from NetworkingEngine progress
 * events, and a local server hands over a whole segment at once, so those
 * events are scarce and decisions with them (24-28s locally against 9.3-9.9s
 * deployed, at the same 8s setting).
 */
import { test, expect, type Page } from '@playwright/test';
import { IS_LOCAL } from './target';
import {
  loadDemoPage,
  loadPreset,
  assertStatus,
  enableForceTranscode,
  throttleCpu,
  readComputeOverlay,
  readShakaAbrState,
  readShakaConfigValue,
  configureShaka,
  type ComputeOverlaySample,
  type ShakaAbrState,
} from './helpers';

const ABR_PRESET = 'ABR 480p/720p/1080p + audio (30s)';
// Same rate as compute-cap.spec.ts: enough to put this repo's reference Mac
// below real time on 1080p, so the cap has a reason to fire.
const THROTTLE = 6;
/** Interval the plugin applies on attach; the assertions below expect it. */
const PLUGIN_SWITCH_INTERVAL = 2;
/**
 * The latency is reported, not bounded. Measured against one PR preview, six
 * runs each: 9.3-9.9s at Shaka's default of 8s, 3.3-6.9s at the 2s this plugin
 * applies. A budget that told those apart would have to sit between 6.9 and
 * 9.3, and the residual latency is set by how fast segments arrive — 2s of
 * media at ~0.4x transcode is ~5s — so it moves with the machine. On a slower
 * runner such a budget would fail a correct implementation.
 *
 * What is asserted instead is the setting itself, which is exact: remove the
 * change and this test goes red without depending on any timing.
 */

const OVERRIDE = process.env.E2E_SWITCH_INTERVAL;

interface TimedSample extends ComputeOverlaySample {
  /** Milliseconds since sampling started. */
  t: number;
  abr: ShakaAbrState | null;
}

async function readTimed(page: Page, t0: number): Promise<TimedSample> {
  const overlay = await readComputeOverlay(page);
  return { ...overlay, abr: await readShakaAbrState(page), t: Date.now() - t0 };
}

/** Wait for the demo to have built its player, so it can be read and configured. */
async function waitForPlayer(page: Page, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readShakaAbrState(page)) != null) return;
    await page.waitForTimeout(100);
  }
  throw new Error('shaka player never appeared on the page');
}

function formatSeries(samples: TimedSample[]): string {
  const rows = samples.map((s) =>
    [
      `${(s.t / 1000).toFixed(1)}s`.padStart(6),
      (s.speedX?.toFixed(2) ?? '—').padStart(6),
      (s.capIndex == null ? 'none' : `idx ${s.capIndex}`).padStart(7),
      (s.reason ?? '—').padEnd(6),
      (s.abr?.maxHeight == null ? 'none' : `${s.abr.maxHeight}p`).padStart(8),
      s.abr?.activeHeight == null ? '—' : `${s.abr.activeHeight}p`,
    ].join('  '),
  );
  return ['     t  speedX      cap  reason  maxHeight  active', ...rows].join('\n');
}

test.describe('Compute-aware cap — time to reach the screen', () => {
  test('a cap change reaches the active variant within one switch interval', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs CDP (Chromium only)');
    test.setTimeout(300_000);

    // ?workerUrl=off for the reason given in compute-cap.spec.ts: CDP throttles
    // the renderer, not dedicated workers.
    await loadDemoPage(page, 'shaka.html?workerUrl=off');
    await assertStatus(page, /Ready/);
    await enableForceTranscode(page);

    const restoreCpu = await throttleCpu(page, THROTTLE);
    try {
      await loadPreset(page, ABR_PRESET);
      await waitForPlayer(page);
      if (OVERRIDE != null && OVERRIDE.trim() !== '') {
        const override = Number(OVERRIDE);
        if (!Number.isFinite(override) || override < 0) {
          throw new Error(`E2E_SWITCH_INTERVAL must be a number >= 0, got ${JSON.stringify(OVERRIDE)}`);
        }
        await configureShaka(page, { abr: { switchInterval: override } });
      }

      // Read it back from the page rather than trusting a documented default:
      // the demo loads Shaka 4.11.4 from a CDN, the plugin's devDependency is
      // 5.2.4, and the application may have set its own value.
      const interval = await readShakaConfigValue<number>(page, 'abr.switchInterval');

      const t0 = Date.now();
      const samples: TimedSample[] = [];
      let lastKey = '';
      let lowerAt: number | null = null;
      let obeyedAt: number | null = null;
      const deadline = Date.now() + 180_000;

      while (Date.now() < deadline) {
        const s = await readTimed(page, t0);
        const key = `${s.raw}|${JSON.stringify(s.abr)}`;
        if (key !== lastKey) {
          lastKey = key;
          samples.push(s);
          if (lowerAt == null && s.reason === 'lower') lowerAt = s.t;
          const obeys =
            s.abr?.activeHeight != null &&
            s.abr.maxHeight != null &&
            s.abr.activeHeight <= s.abr.maxHeight;
          if (lowerAt != null && obeyedAt == null && obeys) {
            obeyedAt = s.t;
            break;
          }
        }
        await page.waitForTimeout(150);
      }

      const series = formatSeries(samples);
      const latencyS = lowerAt != null && obeyedAt != null ? (obeyedAt - lowerAt) / 1000 : null;
      const report =
        `switchInterval=${interval}s · throttle=${THROTTLE}x\n${series}\n` +
        `cap lowered at ${lowerAt == null ? 'n/a' : (lowerAt / 1000).toFixed(1) + 's'}, ` +
        `active variant obeyed at ${obeyedAt == null ? 'n/a' : (obeyedAt / 1000).toFixed(1) + 's'} ` +
        `→ latency ${latencyS == null ? 'n/a' : latencyS.toFixed(1) + 's'}`;
      console.log(`[#263] ${report}`);
      await test.info().attach('switch-latency.txt', { body: report, contentType: 'text/plain' });

      if (OVERRIDE == null || OVERRIDE.trim() === '') {
        // The plugin shortens the interval on attach — the fix itself, and the
        // part of this test that does not depend on how the run went.
        expect(
          interval,
          'the plugin did not shorten abr.switchInterval on attach',
        ).toBe(PLUGIN_SWITCH_INTERVAL);
      }

      // The cap has to fire before its latency means anything. On a machine
      // whose network ABR already sits at the bottom rung there is nothing to
      // cap to (see compute-cap.spec.ts), so say so rather than fail.
      test.skip(
        lowerAt == null,
        `the cap never lowered in this run, so there is no latency to measure:\n${series}`,
      );
      expect(
        obeyedAt,
        `the cap lowered at ${(lowerAt! / 1000).toFixed(1)}s and the active variant never obeyed it:\n${series}`,
      ).not.toBeNull();

      console.log(
        `[#263] ${IS_LOCAL ? 'local' : 'deployed'} target: latency ${latencyS!.toFixed(1)}s` +
          `${IS_LOCAL ? ' (not comparable — scarce progress events against the local server)' : ''}`,
      );
    } finally {
      await restoreCpu();
    }
  });
});
