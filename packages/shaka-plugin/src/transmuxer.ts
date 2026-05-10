/**
 * HEVC Transmuxer for Shaka Player.
 *
 * Implements the `shaka.extern.Transmuxer` interface so Shaka can ingest
 * HEVC/H.265 fMP4 segments on browsers that lack native HEVC support.
 *
 * Modeled after `lib/transmuxer/aac_transmuxer.js` in shaka-player.
 *
 * NOTE: this is a SKELETON. `transmux()` is a no-op placeholder; actual
 * HEVC -> H.264 conversion will plug into @hevcjs/core in a follow-up.
 */

// Loose typing while we don't pull `shaka.extern.*` into the build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaStream = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaSegmentReference = any;

export interface TransmuxOutput {
  data: Uint8Array;
  init: Uint8Array | null;
}

const HEVC_MIME_PATTERN = /^video\/mp4\s*;.*codecs="?(hev1|hvc1)/i;

export class HevcTransmuxer {
  private readonly originalMimeType_: string;

  constructor(mimeType: string) {
    this.originalMimeType_ = mimeType;
  }

  destroy(): void {
    // TODO: tear down any @hevcjs/core worker / decoder once wired in.
  }

  /**
   * Tell Shaka whether we can transmux a given HEVC mime type to something
   * MSE can play. We claim support whenever the input declares hev1/hvc1.
   * Browser native-HEVC detection is handled at registration time.
   */
  isSupported(mimeType: string, _contentType?: string): boolean {
    return HEVC_MIME_PATTERN.test(mimeType);
  }

  /**
   * Output mime type Shaka should advertise to MSE for transmuxed segments.
   * HEVC -> H.264 (avc1) since that's what @hevcjs/core's WebCodecs path
   * produces today.
   */
  convertCodecs(_contentType: string, mimeType: string): string {
    if (HEVC_MIME_PATTERN.test(mimeType)) {
      // TODO: derive an accurate avc1 profile/level from the input HEVC stream.
      return 'video/mp4; codecs="avc1.640028"';
    }
    return mimeType;
  }

  getOriginalMimeType(): string {
    return this.originalMimeType_;
  }

  /**
   * Convert one HEVC fMP4 segment into an MSE-ready H.264 fMP4 segment.
   * SKELETON: returns the input unchanged so the plugin can be wired into
   * Shaka end-to-end before the @hevcjs/core integration lands.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async transmux(
    data: BufferSource,
    _stream: ShakaStream,
    _reference: ShakaSegmentReference,
    _duration: number,
  ): Promise<TransmuxOutput> {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(
            data instanceof ArrayBuffer ? data : (data as ArrayBufferView).buffer,
          );

    // TODO: feed `bytes` into @hevcjs/core (SegmentTranscoder) and emit
    // an avc1 fMP4 segment + init segment on first call.
    return { data: bytes, init: null };
  }
}
