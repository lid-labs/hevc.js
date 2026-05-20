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

import {
  SegmentTranscoder,
  TranscodeWorkerClient,
  hevcMimeToH264Codec,
} from "@hevcjs/core";
import type { SegmentTranscoderConfig } from "@hevcjs/core";

/**
 * Config accepted by `HevcTransmuxer` (and forwarded by `registerHevcTransmuxer`).
 * When `workerUrl` is set, transcoding runs inside a Web Worker; otherwise
 * the HEVC decode + H.264 encode pipeline runs on the main thread.
 */
export interface HevcTransmuxerConfig extends SegmentTranscoderConfig {
  /** URL to the transcode worker script. When set, transcoding runs off main thread. */
  workerUrl?: string;
}

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
  private readonly transcoderConfig_: HevcTransmuxerConfig;
  private transcoder_: SegmentTranscoder | TranscodeWorkerClient | null = null;
  private initPromise_: Promise<void> | null = null;
  private pendingHevcInit_: Uint8Array | null = null;
  private h264InitEmitted_ = false;
  // Cache for the last HEVC init segment we processed and the H.264 init we
  // produced for it. Shaka can call transmux() with the same init bytes
  // multiple times during a session (variant probing, transmuxer re-checks);
  // we must not tear down the live encoder on those redundant calls or
  // playback stalls while the encoder rebuilds. A real representation change
  // arrives with different bytes and goes through the normal `prepareInit`
  // path.
  private lastHevcInitBytes_: Uint8Array | null = null;
  private cachedH264Init_: Uint8Array | null = null;

  constructor(mimeType: string, config: HevcTransmuxerConfig = {}) {
    this.originalMimeType_ = mimeType;
    this.transcoderConfig_ = config;
  }

  destroy(): void {
    this.transcoder_?.destroy();
    this.transcoder_ = null;
    this.initPromise_ = null;
    this.pendingHevcInit_ = null;
    this.h264InitEmitted_ = false;
    this.lastHevcInitBytes_ = null;
    this.cachedH264Init_ = null;
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
      const workerUrl = this.transcoderConfig_.workerUrl;
      if (workerUrl) {
        const worker = new TranscodeWorkerClient({
          ...this.transcoderConfig_,
          workerUrl,
        });
        this.transcoder_ = worker;
        this.initPromise_ = worker.waitReady();
        console.log(
          `[hevc.js/shaka] HEVC transcoding routed through Worker at ${workerUrl}`,
        );
      } else {
        const local = new SegmentTranscoder(this.transcoderConfig_);
        this.transcoder_ = local;
        this.initPromise_ = local.init();
        console.log(
          "[hevc.js/shaka] HEVC transcoding runs on main thread (no workerUrl provided)",
        );
      }
    }
    await this.initPromise_;

    if (isInit) {
      // Short-circuit when Shaka resends the exact same init bytes (variant
      // probe, transmuxer re-check). Going through prepareInit again would
      // close the live H.264 encoder and the next media segment would stall
      // while a new one warms up — the visible "stutter every segment"
      // symptom that motivated this cache. Real ABR switches arrive with
      // different bytes and fall through to the full prepareInit path.
      if (this.cachedH264Init_ && bytesEqual(bytes, this.lastHevcInitBytes_)) {
        const copy = new Uint8Array(this.cachedH264Init_.byteLength);
        copy.set(this.cachedH264Init_);
        return copy;
      }

      // Snapshot the input bytes *before* prepareInit. The worker variant
      // transfers `bytes.buffer` to the worker, which detaches it on the
      // main thread — so reading from `bytes` after the await would throw
      // "TypedArray.set on a detached ArrayBuffer".
      const initBytesSnapshot = new Uint8Array(bytes.byteLength);
      initBytesSnapshot.set(bytes);

      const result = await this.transcoder_!.prepareInit(bytes);
      this.h264InitEmitted_ = true;

      // Snapshot the output immediately. Then commit both snapshots to the
      // cache fields atomically.
      const h264InitCopy = new Uint8Array(result.initSegment.byteLength);
      h264InitCopy.set(result.initSegment);
      this.lastHevcInitBytes_ = initBytesSnapshot;
      this.cachedH264Init_ = h264InitCopy;

      // Defensive copy for the return value — never hand MSE a view into
      // our cache.
      const copy = new Uint8Array(h264InitCopy.byteLength);
      copy.set(h264InitCopy);
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

function bytesEqual(a: Uint8Array, b: Uint8Array | null): boolean {
  if (!b || a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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
