import { test, expect, type Page } from '@playwright/test';
import { loadDemoPage, loadPreset, waitForPlaying } from './helpers';

/**
 * The quality readouts must name the rendition that is actually on screen.
 *
 * Issue #258: on the ABR preset, dash.js and hls.js announced 1080p about two
 * seconds in while the picture stayed at 848x480 for the whole stream. The
 * announcement was right — the player had switched — but the transcoder kept
 * encoding through the 480p-configured encoder, so the screen never followed.
 * Shaka was spared because it starts at the top variant and never switches.
 *
 * So the invariant under test is convergence: whatever the player announces,
 * the decoded resolution must catch up with it. A lag while the buffered
 * lower rendition drains is expected and allowed for; never catching up is
 * the bug.
 */

const PRESET_ABR = 'ABR 480p/720p/1080p + audio (30s)';
const PRESET_1080P = '1080p (5s)';

interface DemoPage {
  file: string;
  /** Overlay id prefix — `cmp` on the dash.js/Shaka pages, `perf` on hls.js. */
  prefix: 'cmp' | 'perf';
  /** Height the page announces, read from its own readout. */
  announcedHeight: (page: Page) => Promise<number | null>;
}

/** `quality: 1080p · 3989 kbps` — the variant the player selected. */
async function announcedVariantHeight(page: Page): Promise<number | null> {
  const text = (await page.locator('#cmp-quality').textContent()) ?? '';
  const m = /quality:\s*(\d+)p/.exec(text);
  return m ? Number(m[1]) : null;
}

/** `source: 1920x1080` — the resolution of the segment being transcoded. */
async function announcedSourceHeight(page: Page): Promise<number | null> {
  const text = (await page.locator('#perf-quality').textContent()) ?? '';
  const m = /source:\s*\d+x(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

const PAGES: DemoPage[] = [
  { file: 'dash.html', prefix: 'cmp', announcedHeight: announcedVariantHeight },
  { file: 'hls.html', prefix: 'perf', announcedHeight: announcedSourceHeight },
  { file: 'shaka.html', prefix: 'cmp', announcedHeight: announcedVariantHeight },
];

/** Resolution the video element decodes, as [width, height]. */
async function decodedSize(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#player')!;
    return [v.videoWidth, v.videoHeight] as [number, number];
  });
}

/**
 * Wait for the page to announce a higher rendition than `from`.
 *
 * Deliberately not an assertion: the up-switch is the player's call, and a
 * machine that transcodes below real time caps the ladder on purpose, so
 * there is nothing to fail on. It only decides whether the convergence check
 * that follows actually exercises an ABR switch — which is where #258 lived.
 */
async function waitForUpswitch(page: Page, announced: DemoPage['announcedHeight'], from: number) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await announced(page) ?? 0) > from) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

for (const { file, prefix, announcedHeight } of PAGES) {
  for (const preset of [PRESET_ABR, PRESET_1080P]) {
    test(`${file} — announced quality matches the screen (${preset})`, async ({ page }) => {
      await loadDemoPage(page, file);
      await loadPreset(page, preset);

      const outcome = await waitForPlaying(page);
      // Native HEVC playback never reaches the transcoder, and a browser
      // without an H.264 encoder never starts: neither has a readout to check.
      test.skip(outcome !== 'playing', `playback outcome was "${outcome}"`);

      // The "on screen" readout is the video element's own dimensions.
      const onScreen = page.locator(`#${prefix}-onscreen`);
      await expect
        .poll(async () => onScreen.textContent(), { timeout: 20_000 })
        .toMatch(/on screen: \d+x\d+/);
      const [width, height] = await decodedSize(page);
      expect(await onScreen.textContent()).toBe(`on screen: ${width}x${height}`);

      // On the ABR preset, give the player time to climb the ladder: a
      // convergence check made before the switch would pass on the very bug
      // it is meant to catch (480p announced, 480p on screen).
      let switched = false;
      if (preset === PRESET_ABR) {
        switched = await waitForUpswitch(page, announcedHeight, (await announcedHeight(page)) ?? height);
        if (!switched) {
          console.log(`[${file}] no up-switch within 20s — convergence checked at the start variant`);
        }
      }

      // Convergence: the decoded height catches up with the announced one.
      // Before the fix this never happened on dash.html/hls.html — the
      // announcement moved to 1080p and the screen stayed at 480 to the end.
      await expect
        .poll(
          async () => {
            const announced = await announcedHeight(page);
            const [, decoded] = await decodedSize(page);
            return announced === null ? 'no readout yet' : `${announced}/${decoded}`;
          },
          {
            timeout: 25_000,
            message: `${file} never decoded the rendition it announced` +
              (switched ? ' after the ABR up-switch' : ''),
          },
        )
        .toMatch(/^(\d+)\/\1$/);
    });
  }
}
