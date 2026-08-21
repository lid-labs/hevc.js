// Validates the fMP4 init segments shipped with the demos and the site samples.
//
// Why this exists: hls_abr shipped with `hvc1` sample entries whose hvcC held no
// parameter sets, so no native decoder could initialise — playback failed on
// Safari and on Chrome whenever the transcoding path was not forced. The e2e
// suite missed it because every HLS test forces transcoding, and our transcoder
// reads parameter sets in-band, which hides the defect.
//
// The rule (ISO/IEC 14496-15): `hvc1` requires the parameter sets out-of-band,
// in the hvcC box. `hev1` allows them in-band, so an empty hvcC is legal there.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const ASSET_DIRS = ["demo/streams", "site/samples"];

const NAL_VPS = 32;
const NAL_SPS = 33;
const NAL_PPS = 34;

/** Every file under `dir` whose name looks like an fMP4 init segment. */
function findInitSegments(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // directory absent in this checkout
  }
  const found: string[] = [];
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...findInitSegments(full));
    } else if (/init.*\.mp4$/i.test(name)) {
      found.push(full);
    }
  }
  return found;
}

/** The four-character sample entry of the first video track, or null if none. */
function videoSampleEntry(buf: Buffer): "hvc1" | "hev1" | null {
  for (const kind of ["hvc1", "hev1"] as const) {
    const at = buf.indexOf(kind, 0, "latin1");
    // A sample entry is preceded by its own 4-byte size field, so a match at
    // offset < 4 cannot be one (and guards the slice below).
    if (at >= 4) return kind;
  }
  return null;
}

/** NAL unit types carried by the hvcC box, in order. Null when there is no hvcC. */
function hvcCNalTypes(buf: Buffer): number[] | null {
  const at = buf.indexOf("hvcC", 0, "latin1");
  if (at < 0) return null;

  // hvcC payload: 22 fixed bytes, then numOfArrays.
  let p = at + 4 + 22;
  if (p >= buf.length) return null;
  const numArrays = buf[p];
  p += 1;

  const types: number[] = [];
  for (let i = 0; i < numArrays; i++) {
    if (p + 3 > buf.length) return types;
    types.push(buf[p] & 0x3f);
    p += 1;
    const count = buf.readUInt16BE(p);
    p += 2;
    for (let n = 0; n < count; n++) {
      if (p + 2 > buf.length) return types;
      p += 2 + buf.readUInt16BE(p);
    }
  }
  return types;
}

const initSegments = ASSET_DIRS.flatMap((d) => findInitSegments(join(REPO_ROOT, d)));

describe("demo stream init segments", () => {
  it("finds the init segments to check", () => {
    // Guards against the globbing silently matching nothing and the suite
    // reporting success while checking zero files.
    expect(initSegments.length).toBeGreaterThan(0);
  });

  for (const path of initSegments) {
    const label = relative(REPO_ROOT, path);
    const buf = readFileSync(path);
    const entry = videoSampleEntry(buf);
    if (entry === null) continue; // audio-only init

    it(`${label} (${entry}) carries the parameter sets its sample entry requires`, () => {
      const nalTypes = hvcCNalTypes(buf);
      expect(nalTypes, `${label}: hvc1/hev1 sample entry without an hvcC box`).not.toBeNull();

      if (entry === "hvc1") {
        // hvc1 means "parameter sets are out-of-band". A decoder will not look
        // for them in the segments, so they must be here or it cannot start.
        expect(nalTypes, `${label}: hvc1 requires VPS in hvcC`).toContain(NAL_VPS);
        expect(nalTypes, `${label}: hvc1 requires SPS in hvcC`).toContain(NAL_SPS);
        expect(nalTypes, `${label}: hvc1 requires PPS in hvcC`).toContain(NAL_PPS);
      }
      // hev1 allows in-band parameter sets, so an empty hvcC is valid.
    });
  }
});
