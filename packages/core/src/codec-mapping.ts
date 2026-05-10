/**
 * HEVC ↔ H.264 codec string mapping.
 *
 * Used by MSE intercept and Shaka transmuxer to advertise an H.264 codec
 * string before any frame has been encoded, so MediaSource can validate the
 * SourceBuffer up-front. The choice is best-effort and based purely on the
 * HEVC level declared in the input mime — H264Encoder picks its own codec
 * string from the actual frame resolution at encode time and the two are not
 * guaranteed to match (an HEVC stream may declare a level higher than its
 * resolution requires). The mapping is conservative: it advertises the
 * smallest H.264 profile/level that can hold any resolution allowed by the
 * declared HEVC level.
 */

/**
 * Pick an H.264 codec string from an HEVC mime/codec string.
 *
 * The HEVC codec format is `hev1.<ps>.<compat>.<tier><level*30>.<constraints>`
 * (e.g. `hev1.1.6.L93.B0` → Main tier, level 93/30 = 3.1 → ≤720p).
 *
 * Mapping rules:
 *   ≤ Level 3.1 (≤720p)        → avc1.640028 (High@4.0)
 *   Level 4.0 / 4.1 / 4.2      → avc1.64002a (High@4.2)
 *   ≥ Level 5.0 (4K and above) → avc1.640033 (High@5.1)
 *
 * Falls back to High@5.1 if the level cannot be parsed — conservative
 * choice that any browser supporting H.264 should accept.
 */
export function hevcMimeToH264Codec(mime: string): string {
  if (typeof mime !== "string") return "avc1.640033";

  // Match the tier+level field at a dot boundary: `.L<n>` or `.H<n>`
  // where n = level * 30. The leading `.` avoids matching unrelated `L`/`H`
  // characters elsewhere in the mime (e.g. a hypothetical `; profiles=H123`).
  const match = mime.match(/\.[LH](\d+)/);
  if (!match) return "avc1.640033";

  const level = parseInt(match[1], 10);
  if (level >= 150) return "avc1.640033";
  if (level >= 120) return "avc1.64002a";
  return "avc1.640028";
}
