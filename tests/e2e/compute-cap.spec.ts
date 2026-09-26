/**
 * Compute-aware cap, end to end on the Shaka path (issue #126).
 *
 * #126 asks whether the cap drops fast enough, and far enough, when the
 * device transcodes below real time — the case the micro-stalls were
 * reported on (Windows/Edge, NVENC, speedX ~0.55). The adapter unit tests
 * already prove the decider narrows `abr.restrictions` when fed a slow
 * speedX; what they cannot show is the real loop: real Shaka ABR, real
 * WASM decode, real encoder, real MSE buffer.
 *
 * The missing ingredient is slow hardware, which CDP supplies:
 * `Emulation.setCPUThrottlingRate` slows the WASM decode (CPU-bound) while
 * leaving hardware-accelerated WebCodecs encoding largely alone — the same
 * imbalance as the reported hardware. The throttled test refuses to assert
 * anything it did not measure: if the machine stays above real time even
 * throttled, it skips and says so rather than passing vacuously.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  collectConsoleErrors,
  loadDemoPage,
  loadPreset,
  assertStatus,
  enableForceTranscode,
  throttleCpu,
  readComputeOverlay,
  readShakaAbrState,
  getCurrentTime,
  type ComputeOverlaySample,
  type ShakaAbrState,
} from './helpers';

// A single-quality preset gives the cap nothing to act on — the ladder has
// to have rungs below the top one.
const ABR_PRESET = 'ABR 480p/720p/1080p + audio (30s)';

// 6x pushes this repo's reference Mac from ~1.7x down to ~0.37x on 1080p,
// below the 0.55x of the reported hardware. Override to re-measure elsewhere:
// E2E_CPU_THROTTLE=10 npx playwright test -g "drops the cap".
const THROTTLE_RATE = Number(process.env.E2E_CPU_THROTTLE ?? 6);

/**
 * One reading of the overlay plus the restrictions actually on the player.
 * The two come from separate evaluates, so a sample taken mid-update can pair
 * an overlay line with the state from just after it. That costs an extra row in
 * the series at worst — the assertions below read whether a cap drop happened
 * and where it ended up, neither of which a one-poll skew changes.
 */
interface Sample extends ComputeOverlaySample {
  abr: ShakaAbrState | null;
}

async function readSample(page: Page): Promise<Sample> {
  const overlay = await readComputeOverlay(page);
  return { ...overlay, abr: await readShakaAbrState(page) };
}

/**
 * Poll until `done` accepts a sample, or the budget runs out. Samples are
 * deduplicated on what they display, so the series holds one entry per
 * visible change rather than one per poll. Two consecutive segments that
 * read identically collapse into one entry — fine for a reading of how the
 * cap moved, which is what this measures.
 */
async function sampleUntil(
  page: Page,
  done: (s: Sample, all: Sample[]) => boolean,
  budgetMs: number,
): Promise<Sample[]> {
  const samples: Sample[] = [];
  const deadline = Date.now() + budgetMs;
  let lastKey = '';

  while (Date.now() < deadline) {
    const sample = await readSample(page);
    const key = `${sample.raw}|${JSON.stringify(sample.abr)}`;
    if (key !== lastKey) {
      lastKey = key;
      samples.push(sample);
      if (done(sample, samples)) break;
    }
    await page.waitForTimeout(150);
  }
  return samples;
}

/**
 * Tallest variant the manifest offered, taken as the widest ladder seen
 * across the run: `player.getVariantTracks()` hides variants the cap has
 * restricted, so reading it after a cap drop understates the ladder.
 */
function ladderTop(samples: Sample[]): number | null {
  const heights = samples
    .map((s) => s.abr?.topHeight)
    .filter((h): h is number => typeof h === 'number');
  return heights.length ? Math.max(...heights) : null;
}

function formatSeries(samples: Sample[]): string {
  const rows = samples.map((s, i) =>
    [
      String(i).padStart(3),
      (s.speedX?.toFixed(2) ?? '—').padStart(6),
      (s.avgSpeedX?.toFixed(2) ?? '—').padStart(6),
      (s.capIndex == null ? 'none' : `idx ${s.capIndex}`).padStart(7),
      (s.reason ?? '—').padEnd(6),
      (s.abr?.maxHeight == null ? 'none' : `${s.abr.maxHeight}p`).padStart(8),
      (s.announcedHeight == null ? '—' : `${s.announcedHeight}p`).padStart(9),
      s.abr?.activeHeight == null ? '—' : `${s.abr.activeHeight}p`,
    ].join('  '),
  );
  return [
    '  #  speedX     avg      cap  reason  maxHeight  announced  active',
    ...rows,
  ].join('\n');
}

test.describe('Compute-aware cap — Shaka path', () => {
  test('publishes per-segment observations on the ABR ladder', async ({ page }) => {
    test.setTimeout(120_000);

    const errors = collectConsoleErrors(page);
    await loadDemoPage(page, 'shaka.html');
    await assertStatus(page, /Ready/);
    await enableForceTranscode(page);
    await loadPreset(page, ABR_PRESET);

    // Two distinct observations: enough to show the loop is live and the
    // decider is being fed, without assuming any particular speed.
    const samples = await sampleUntil(
      page,
      (s, all) => all.filter((x) => x.reason != null).length >= 2 && s.reason != null,
      60_000,
    );
    const observed = samples.filter((s) => s.reason != null);

    const series = formatSeries(samples);
    await test.info().attach('overlay-series.txt', { body: series, contentType: 'text/plain' });
    // The unthrottled series is the baseline half of the #126 reading: it says
    // how far above real time this machine runs, which is what decides whether
    // the throttled test below can measure anything at all.
    console.log(`[#126] unthrottled\n${series}`);

    expect(
      observed.length,
      `no compute-aware observation reached the overlay:\n${series}`,
    ).toBeGreaterThanOrEqual(2);

    for (const s of observed) {
      expect(['init', 'hold', 'lower', 'raise']).toContain(s.reason);
      expect(s.speedX, `speedX missing in: ${s.raw}`).not.toBeNull();
      expect(s.speedX!).toBeGreaterThan(0);
    }

    // The cap only ever restricts the ladder — it must never exceed it.
    const top = ladderTop(samples);
    const last = samples[samples.length - 1]!;
    if (last.abr?.maxHeight != null && top != null) {
      expect(last.abr.maxHeight).toBeLessThanOrEqual(top);
    }

    expect(errors.filter((e) => e.includes('applyCap failed'))).toEqual([]);
  });

  test(`drops the cap when a ${THROTTLE_RATE}x CPU throttle pushes transcode below real time`, async ({
    page,
    browserName,
  }) => {
    // Throttling is CDP-only, and the throttled run needs a wide budget:
    // every decode on the page is slowed by the same factor.
    test.skip(browserName !== 'chromium', 'CPU throttling needs CDP (Chromium only)');
    test.setTimeout(300_000);

    // `Emulation.setCPUThrottlingRate` throttles the page's renderer, not its
    // dedicated workers: with the demo's default off-main-thread transcode,
    // speedX stays put however hard the page is throttled (measured: 6x leaves
    // it at 1.4-4.0x). `?workerUrl=off` puts decode and encode on the throttled
    // thread instead. The perf bus publishes the same SegmentPerfStat either
    // way, so the decider sees exactly what it would see on slow hardware.
    await loadDemoPage(page, 'shaka.html?workerUrl=off');
    await assertStatus(page, /Ready/);
    await enableForceTranscode(page);

    const restoreCpu = await throttleCpu(page, THROTTLE_RATE);
    try {
      await loadPreset(page, ABR_PRESET);

      // First half: read until the cap moves down, or until the budget ends —
      // the skip below needs to report what was actually seen either way.
      const untilLower = await sampleUntil(page, (s) => s.reason === 'lower', 180_000);
      // Second half: one step down may not be enough at 0.37x. Keep reading a
      // while longer so the series shows where the cap settled, which is the
      // other half of what #126 asks ("fast enough, and far enough").
      const afterLower = untilLower.some((s) => s.reason === 'lower')
        ? await sampleUntil(page, () => false, 30_000)
        : [];
      const samples = untilLower.concat(afterLower);
      const top = ladderTop(samples);
      const last = samples[samples.length - 1];

      const series = formatSeries(samples);
      const report = `throttle=${THROTTLE_RATE}x · ladder top ${top ?? '?'}p\n${series}`;
      await test.info().attach('throttled-overlay-series.txt', {
        body: report,
        contentType: 'text/plain',
      });
      // Printed as well as attached: this series is the measurement #126 asks
      // for, and it has to be readable straight from a CI log.
      console.log(`[#126] ${report}`);

      const slow = samples.filter((s) => s.avgSpeedX != null && s.avgSpeedX < 1.0);
      test.skip(
        slow.length === 0,
        `a ${THROTTLE_RATE}x throttle did not push this machine below real time ` +
          `(no avg speedX < 1.0), so there is nothing for the cap to react to. ` +
          `Re-run with a higher E2E_CPU_THROTTLE.\n${series}`,
      );

      // Transcode fell below real time, so the cap must have come down.
      expect(
        samples.some((s) => s.reason === 'lower'),
        `avg speedX dropped below 1.0 but the cap never lowered:\n${series}`,
      ).toBe(true);

      expect(last?.abr, 'shaka player state unreadable').toBeTruthy();
      expect(
        last!.abr!.maxHeight,
        `cap lowered but abr.restrictions.maxHeight is still unset:\n${series}`,
      ).not.toBeNull();
      expect(top, 'ladder height never became readable').not.toBeNull();
      expect(
        last!.abr!.maxHeight!,
        `cap lowered but maxHeight ${last!.abr!.maxHeight} does not restrict the ${top}p ladder`,
      ).toBeLessThan(top!);

      // A cap that fires but leaves playback frozen has not helped. Any
      // forward progress counts: the throttled page decodes slowly by design,
      // so a wall-clock ratio would measure the throttle, not the cap.
      const before = await getCurrentTime(page);
      await page.waitForTimeout(5_000);
      const after = await getCurrentTime(page);
      expect(after, `playback stalled at ${before.toFixed(2)}s after the cap dropped`).toBeGreaterThan(
        before,
      );
    } finally {
      await restoreCpu();
    }
  });
});
