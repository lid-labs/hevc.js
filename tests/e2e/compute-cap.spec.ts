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
  getPlaybackState,
  type ComputeOverlaySample,
  type ShakaAbrState,
} from './helpers';

// A single-quality preset gives the cap nothing to act on — the ladder has
// to have rungs below the top one.
const ABR_PRESET = 'ABR 480p/720p/1080p + audio (30s)';

const DEFAULT_THROTTLE_RATE = 6;

/**
 * CPU throttle rate for the throttled case. 6x pushes this repo's reference Mac
 * from ~1.9x down to ~0.4x on 1080p, below the 0.55x of the reported hardware.
 * Override to re-measure elsewhere:
 * E2E_CPU_THROTTLE=10 npx playwright test -g "drops the cap".
 *
 * A bad override is rejected rather than coerced: `Number('')` is 0 and
 * `Number('x')` is NaN, and either would reach CDP as a rate and fail there
 * with nothing pointing back at the variable.
 */
function throttleRate(): number {
  const raw = process.env.E2E_CPU_THROTTLE;
  if (raw == null || raw.trim() === '') return DEFAULT_THROTTLE_RATE;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate < 1) {
    throw new Error(`E2E_CPU_THROTTLE must be a number >= 1, got ${JSON.stringify(raw)}`);
  }
  return rate;
}

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

/** What a sample displays, for deduplicating consecutive reads. */
function sampleKey(s: Sample): string {
  return `${s.raw}|${JSON.stringify(s.abr)}`;
}

/**
 * Poll until `done` accepts a sample, or the budget runs out. Samples are
 * deduplicated on what they display, so the series holds one entry per
 * visible change rather than one per poll. Two consecutive segments that
 * read identically collapse into one entry — fine for a reading of how the
 * cap moved, which is what this measures.
 *
 * `seedKey` carries the last state of a preceding call, so a series built
 * from two calls does not repeat a row across the seam.
 */
async function sampleUntil(
  page: Page,
  done: (s: Sample, all: Sample[]) => boolean,
  budgetMs: number,
  seedKey = '',
): Promise<Sample[]> {
  const samples: Sample[] = [];
  const deadline = Date.now() + budgetMs;
  let lastKey = seedKey;

  while (Date.now() < deadline) {
    const sample = await readSample(page);
    const key = sampleKey(sample);
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

  // The rate stays out of the title: a title that changes with the environment
  // is one that -g patterns and reports cannot rely on. It is logged instead.
  test('drops the cap when a CPU throttle pushes transcode below real time', async ({
    page,
    browserName,
  }) => {
    // Throttling is CDP-only, and the throttled run needs a wide budget:
    // every decode on the page is slowed by the same factor.
    test.skip(browserName !== 'chromium', 'CPU throttling needs CDP (Chromium only)');
    test.setTimeout(300_000);

    const rate = throttleRate();

    // `Emulation.setCPUThrottlingRate` throttles the page's renderer, not its
    // dedicated workers: with the demo's default off-main-thread transcode,
    // speedX stays put however hard the page is throttled (measured: 6x leaves
    // it at 1.4-4.0x). `?workerUrl=off` puts decode and encode on the throttled
    // thread instead. The perf bus publishes the same SegmentPerfStat either
    // way, so the decider sees exactly what it would see on slow hardware.
    await loadDemoPage(page, 'shaka.html?workerUrl=off');
    await assertStatus(page, /Ready/);
    await enableForceTranscode(page);

    const restoreCpu = await throttleCpu(page, rate);
    try {
      await loadPreset(page, ABR_PRESET);

      // First half: read until the cap moves down, or until the budget ends —
      // the skip below needs to report what was actually seen either way.
      const untilLower = await sampleUntil(page, (s) => s.reason === 'lower', 180_000);
      // Second half: one step down may not be enough at 0.37x. Keep reading a
      // while longer so the series shows where the cap settled, which is the
      // other half of what #126 asks ("fast enough, and far enough").
      const lastOfFirstHalf = untilLower[untilLower.length - 1];
      const afterLower = untilLower.some((s) => s.reason === 'lower')
        ? await sampleUntil(page, () => false, 30_000, sampleKey(lastOfFirstHalf!))
        : [];
      const samples = untilLower.concat(afterLower);
      const top = ladderTop(samples);
      const last = samples[samples.length - 1];

      const series = formatSeries(samples);
      const report = `throttle=${rate}x · ladder top ${top ?? '?'}p\n${series}`;
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
        `a ${rate}x throttle did not push this machine below real time ` +
          `(no avg speedX < 1.0), so there is nothing for the cap to react to. ` +
          `Re-run with a higher E2E_CPU_THROTTLE.\n${series}`,
      );

      // The decider only ever subtracts, starting from the variant the player
      // is on, so a player already at the bottom rung has nothing to give up
      // and correctly reports `hold`. Measured on a GitHub runner, where
      // network ABR had settled on 480p: ten observations under 1.0x with
      // `cap: none`, and the cap moved only once Shaka climbed back to 720p.
      // Requiring a `lower` regardless would fail that run for behaving right.
      const aboveFloor = (s: Sample) =>
        s.abr?.activeHeight != null &&
        s.abr.bottomHeight != null &&
        s.abr.activeHeight > s.abr.bottomHeight;
      const hadRoomToLower = slow.some(aboveFloor);

      expect(last?.abr, 'shaka player state unreadable').toBeTruthy();

      if (!hadRoomToLower) {
        // Nothing the cap could have done. Say so rather than assert on it.
        console.log(
          '[#126] every slow observation had the player at the bottom rung — ' +
            'no lower variant to cap to, so no cap drop is expected here',
        );
      } else {
        // Transcode fell below real time with a rung to spare: the cap must
        // have come down.
        expect(
          samples.some((s) => s.reason === 'lower'),
          `avg speedX dropped below 1.0 above the bottom rung but the cap never lowered:\n${series}`,
        ).toBe(true);

        expect(
          last!.abr!.maxHeight,
          `cap lowered but abr.restrictions.maxHeight is still unset:\n${series}`,
        ).not.toBeNull();
        expect(top, 'ladder height never became readable').not.toBeNull();
        expect(
          last!.abr!.maxHeight!,
          `cap lowered but maxHeight ${last!.abr!.maxHeight} does not restrict the ${top}p ladder`,
        ).toBeLessThan(top!);
      }

      // Where the cap leaves playback is the other half of the issue's
      // question, and it has two honest outcomes.
      // Measure recovery from the first cap drop when there was one, and from
      // the first slow observation otherwise.
      const firstLower = samples.findIndex((s) => s.reason === 'lower');
      const firstSlow = samples.findIndex((s) => s.avgSpeedX != null && s.avgSpeedX < 1.0);
      const cleared = samples
        .slice(firstLower >= 0 ? firstLower : firstSlow)
        .some((s) => s.avgSpeedX != null && s.avgSpeedX >= 1.0);

      const before = await getPlaybackState(page);
      await page.waitForTimeout(5_000);
      const after = await getPlaybackState(page);
      const nearEnd =
        after.ended || (after.duration > 0 && after.duration - after.currentTime < 1);
      console.log(
        `[#126] after the cap: transcode ${cleared ? 'cleared' : 'stayed under'} real time · ` +
          `${before.currentTime.toFixed(2)}s -> ${after.currentTime.toFixed(2)}s` +
          `${nearEnd ? ' (clip ended)' : ''}`,
      );

      if (cleared) {
        // The cap did its job, so playback must keep moving. Any forward
        // progress counts: the page decodes slowly by design here, so a
        // wall-clock ratio would measure the throttle, not the cap.
        if (!nearEnd) {
          expect(
            after.currentTime,
            `transcode cleared real time under the cap but playback stalled at ` +
              `${before.currentTime.toFixed(2)}s:\n${series}`,
          ).toBeGreaterThan(before.currentTime);
        }
      } else if (hadRoomToLower) {
        // Transcode never cleared real time, even under the cap. Stalling is
        // then the throughput problem (#232), not a cap that failed — the
        // issue's own "too slow or not low enough" row. What the cap still
        // owes in that case is to have gone all the way down: anything above
        // the bottom rung is headroom it declined to take.
        expect(
          last!.capIndex,
          `transcode stayed under real time but the cap stopped at ` +
            `idx ${last!.capIndex} instead of the bottom of the ladder:\n${series}`,
        ).toBe(0);
      }
    } finally {
      await restoreCpu();
    }
  });
});
