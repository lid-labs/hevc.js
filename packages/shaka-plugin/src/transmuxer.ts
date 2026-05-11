/**
 * HEVC Transmuxer for Shaka Player.
 *
 * Implements the `shaka.extern.Transmuxer` interface so Shaka can ingest
 * HEVC/H.265 fMP4 segments on browsers that lack native HEVC support.
 * Uses `@hevcjs/core` SegmentTranscoder to decode HEVC and re-encode to
 * H.264 fMP4 that the browser's MSE can play.
 *
 * Modeled after `lib/transmuxer/aac_transmuxer.js` in shaka-player.
 */

import { SegmentTranscoder, hevcMimeToH264Codec } from "@hevcjs/core";
import type { SegmentTranscoderConfig } from "@hevcjs/core";

// Loose typing while we don't pull `shaka.extern.*` into the build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaStream = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaSegmentReference = any;

/**
 * Return type of `HevcTransmuxer.transmux`. Compatible with both Shaka 4.x
 * (which expects a raw `Uint8Array` and passes it straight to MSE) and 5+
 * (which checks `ArrayBuffer.isView` and falls back to `{data, init}`
 * when the value is a plain object). Returning a `Uint8Array` is the
 * common subset that works on every supported Shaka version.
 */
export type TransmuxOutput = Uint8Array;

const HEVC_MIME_PATTERN = /^video\/mp4\s*;.*codecs="?(hev1|hvc1)/i;

/**
 * 8-byte ISO BMFF `free` box (size + type, no payload). Spec-compliant
 * padding that any MP4 parser ignores. Used as a stand-in when we need
 * to return *something* to Shaka but have nothing real to emit yet —
 * `appendBuffer(emptyUint8Array)` throws "Overload resolution failed"
 * on Chrome, so we can't return zero-length buffers.
 */
const FREE_BOX_8B = new Uint8Array([
  0, 0, 0, 8,           // size = 8
  0x66, 0x72, 0x65, 0x65, // 'free'
]);

/**
 * Sniff whether a buffer starts with an ISO BMFF init segment.
 * Init segments begin with the `ftyp` box; media segments begin with
 * `moof` (or `styp` followed by `moof`).
 *
 * Box header layout: 4 bytes big-endian size, 4 bytes ASCII type.
 */
export function isInitSegment(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const boxType = String.fromCharCode(
    bytes[4]!,
    bytes[5]!,
    bytes[6]!,
    bytes[7]!,
  );
  return boxType === "ftyp";
}

export class HevcTransmuxer {
  private readonly originalMimeType_: string;
  private readonly transcoderConfig_: SegmentTranscoderConfig;
  private transcoder_: SegmentTranscoder | null = null;
  private initPromise_: Promise<void> | null = null;
  private pendingHevcInit_: Uint8Array | null = null;
  private h264InitEmitted_ = false;

  constructor(mimeType: string, config: SegmentTranscoderConfig = {}) {
    this.originalMimeType_ = mimeType;
    this.transcoderConfig_ = config;
  }

  destroy(): void {
    this.transcoder_?.destroy();
    this.transcoder_ = null;
    this.initPromise_ = null;
    this.pendingHevcInit_ = null;
    this.h264InitEmitted_ = false;
  }

  isSupported(mimeType: string, _contentType?: string): boolean {
    return HEVC_MIME_PATTERN.test(mimeType);
  }

  /**
   * Output mime advertised to Shaka before any frame has been encoded.
   * Best-effort mapping based on the HEVC level declared in the input
   * (see `@hevcjs/core/codec-mapping`). The actual encoded stream may
   * use a slightly different profile/level if `H264Encoder` decides
   * differently from the encoded resolution.
   */
  convertCodecs(_contentType: string, mimeType: string): string {
    if (!HEVC_MIME_PATTERN.test(mimeType)) return mimeType;
    return `video/mp4; codecs="${hevcMimeToH264Codec(mimeType)}"`;
  }

  getOriginalMimeType(): string {
    return this.originalMimeType_;
  }

  /**
   * Convert one HEVC fMP4 segment into an MSE-ready H.264 fMP4 segment.
   *
   * Shaka calls this once per segment with `reference === null` for the
   * init segment and a non-null `reference` for media segments.
   *
   *  - Init segment: warm up the H.264 encoder eagerly (encodes a single
   *    black frame to obtain a valid avcC) and return a complete H.264
   *    init segment that MSE can immediately ingest.
   *  - Media segment: decode HEVC, re-encode to H.264, mux fMP4, return.
   *
   * Returns a raw `Uint8Array` rather than `{data, init}` so the same
   * code path works on Shaka 4.x (which expects a `Uint8Array` directly)
   * and on Shaka 5+ (which accepts either via an `ArrayBuffer.isView`
   * check). Init/media segmentation is implicit in the call sequence.
   */
  async transmux(
    data: BufferSource,
    _stream: ShakaStream,
    reference: ShakaSegmentReference,
    _duration: number,
    _contentType: string,
  ): Promise<TransmuxOutput> {
    const bytes = toUint8(data);
    const isInit = reference == null || isInitSegment(bytes);

    if (!this.transcoder_) {
      this.transcoder_ = new SegmentTranscoder(this.transcoderConfig_);
      this.initPromise_ = this.transcoder_.init();
    }
    await this.initPromise_;

    if (isInit) {
      const result = await this.transcoder_!.prepareInit(bytes);
      this.h264InitEmitted_ = true;
      // Defensive copy: avoids any risk of the underlying ArrayBuffer being
      // detached or mutated between this return and the eventual MSE append.
      const copy = new Uint8Array(result.initSegment.byteLength);
      copy.set(result.initSegment);
      return copy;
    }

    const h264Media = await this.transcoder_!.processMediaSegment(bytes);
    if (!h264Media) {
      // No frames produced (e.g. drop frames in adaptive switching). Emit
      // a spec-valid `free` box of 8 bytes — empty buffers crash Chrome's
      // appendBuffer with "Overload resolution failed".
      return FREE_BOX_8B;
    }
    return h264Media;
  }
}

function toUint8(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(
    (data as ArrayBufferView).buffer,
    (data as ArrayBufferView).byteOffset,
    (data as ArrayBufferView).byteLength,
  );
}
