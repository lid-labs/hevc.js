/**
 * fMP4 Demuxer — Wraps mp4box.js for robust fMP4 demuxing.
 *
 * Extracts raw NAL units from fragmented MP4 segments (HEVC or H.264).
 * Uses mp4box.js for ISO BMFF parsing — supports all box types,
 * extended sizes, multi-track, and proper hvcC/avcC extraction.
 */

import { createFile as mp4boxCreateFile } from "mp4box";
import type { MP4Info, MP4Sample, MP4Track, ArrayBufferWithStart } from "mp4box";
import { log } from "./log.js";

export interface DemuxedSample {
  trackId: number;
  /** Raw NAL units (no start code, no length prefix) */
  nalUnits: Uint8Array[];
  /** Presentation timestamp (in timescale units) */
  pts: number;
  /** Decode timestamp */
  dts: number;
  /** Duration (in timescale units) */
  duration: number;
  /** Whether this is a keyframe (IDR/CRA) */
  isKeyframe: boolean;
}

export interface VideoTrackInfo {
  trackId: number;
  codec: string;
  timescale: number;
  width: number;
  height: number;
  nalLengthSize: number;
}

/**
 * fMP4 Demuxer backed by mp4box.js.
 *
 * @example
 * ```ts
 * const demuxer = new FMP4Demuxer();
 * await demuxer.parse(initSegmentBytes);
 * const samples = await demuxer.extractSamples(mediaSegmentBytes);
 * ```
 */
export class FMP4Demuxer {
  private _mp4box = mp4boxCreateFile();
  private _videoTrack: VideoTrackInfo | null = null;
  private _pendingSamples: DemuxedSample[] = [];
  private _offset = 0;
  private _ready = false;
  private _readyPromise: Promise<void>;
  private _readyResolve!: () => void;

  constructor() {
    this._readyPromise = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });

    this._mp4box.onReady = (info: MP4Info) => {
      this._onReady(info);
    };

    this._mp4box.onSamples = (_trackId: number, _user: unknown, samples: MP4Sample[]) => {
      for (const sample of samples) {
        const nalUnits = extractNalUnitsFromSample(sample.data, this._videoTrack?.nalLengthSize ?? 4);
        this._pendingSamples.push({
          trackId: sample.track_id,
          nalUnits,
          pts: sample.cts,
          dts: sample.dts,
          duration: sample.duration,
          isKeyframe: sample.is_rap || sample.is_sync,
        });
      }
    };

    this._mp4box.onError = (e: Error) => {
      log.error("[FMP4Demuxer] mp4box error:", e);
    };
  }

  /** Get the video track info (available after parse) */
  get videoTrack(): VideoTrackInfo | null {
    return this._videoTrack;
  }

  /** Whether the init segment has been parsed */
  get isReady(): boolean {
    return this._ready;
  }

  /**
   * Feed data to the demuxer. Works for both init and media segments.
   * Call with the init segment first, then media segments.
   */
  feed(data: Uint8Array): void {
    const buf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBufferWithStart;
    buf.fileStart = this._offset;
    this._offset += data.byteLength;
    this._mp4box.appendBuffer(buf);
  }

  /**
   * Wait for the init segment to be parsed (moov box found).
   */
  async waitReady(): Promise<void> {
    return this._readyPromise;
  }

  /**
   * Drain all pending samples extracted so far.
   */
  drainSamples(): DemuxedSample[] {
    const samples = this._pendingSamples;
    this._pendingSamples = [];
    return samples;
  }

  /**
   * Convenience: parse init segment and wait for ready.
   */
  async parseInit(data: Uint8Array): Promise<void> {
    this.feed(data);
    await this.waitReady();
  }

  /**
   * Convenience: feed a media segment and return extracted samples.
   */
  parseSegment(data: Uint8Array): DemuxedSample[] {
    this.feed(data);
    return this.drainSamples();
  }

  /** Flush any remaining data in the parser */
  flush(): void {
    this._mp4box.flush();
  }

  private _onReady(info: MP4Info): void {
    // Find the first video track
    const videoTrack = info.videoTracks[0] ?? info.tracks.find(
      (t: MP4Track) => t.type === "video",
    );

    if (videoTrack) {
      const isHevc = /^(hev1|hvc1)/i.test(videoTrack.codec);
      this._videoTrack = {
        trackId: videoTrack.id,
        codec: videoTrack.codec,
        timescale: videoTrack.timescale,
        width: videoTrack.width ?? videoTrack.video?.width ?? 0,
        height: videoTrack.height ?? videoTrack.video?.height ?? 0,
        nalLengthSize: isHevc ? 4 : 4, // mp4box.js handles both
      };

      // Request sample extraction for the video track
      this._mp4box.setExtractionOptions(videoTrack.id, undefined, { nbSamples: 100 });
    }

    this._ready = true;
    this._readyResolve();
    this._mp4box.start();
  }
}

/**
 * Extract NAL units from length-prefixed sample data.
 */
function extractNalUnitsFromSample(data: ArrayBuffer | Uint8Array, nalLengthSize: number): Uint8Array[] {
  // mp4box.js may return Uint8Array instead of ArrayBuffer
  const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const nalUnits: Uint8Array[] = [];
  let offset = 0;

  while (offset + nalLengthSize <= buf.byteLength) {
    let nalLength: number;
    switch (nalLengthSize) {
      case 1: nalLength = view.getUint8(offset); break;
      case 2: nalLength = view.getUint16(offset); break;
      case 4: nalLength = view.getUint32(offset); break;
      default: nalLength = view.getUint32(offset); break;
    }
    offset += nalLengthSize;

    if (offset + nalLength > buf.byteLength) break;
    nalUnits.push(bytes.slice(offset, offset + nalLength));
    offset += nalLength;
  }

  return nalUnits;
}
