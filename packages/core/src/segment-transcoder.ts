/**
 * SegmentTranscoder — Transcodes HEVC fMP4 segments to H.264 fMP4 segments.
 *
 * Used by the dash.js plugin to transparently convert HEVC segments
 * before they reach MSE SourceBuffer.
 *
 * Pipeline:
 *   HEVC init segment (moov) → extract hvcC, init decoder/encoder
 *   HEVC media segment (moof+mdat) → demux → decode → encode → mux → H.264 fMP4
 */

import { HEVCDecoder } from "./decoder.js";
import { FMP4Demuxer } from "./fmp4-demuxer.js";
import { log } from "./log.js";
import { H264Encoder } from "./h264-encoder.js";
import type { EncodedChunk } from "./h264-encoder.js";
import { FMP4Muxer } from "./fmp4-muxer.js";
import { publishSegmentStat } from "./perf-bus.js";
import type { HEVCFrame } from "./types.js";
import type { DecoderOptions } from "./types.js";

export interface SegmentTranscoderConfig {
  wasmUrl?: string;
  /** URL to the .wasm binary, forwarded to Emscripten's locateFile.
   *  Required when assets are loaded from a different origin than the page. */
  wasmBinaryUrl?: string;
  fps?: number;
  bitrate?: number;
}

export interface TranscodedInit {
  /** H.264 fMP4 init segment (ftyp + moov with avcC) */
  initSegment: Uint8Array;
  /** H.264 codec string for addSourceBuffer() */
  codec: string;
}

export class SegmentTranscoder {
  private _config: SegmentTranscoderConfig;
  private _decoder: HEVCDecoder | null = null;
  private _demuxer: FMP4Demuxer | null = null;
  private _encoder: H264Encoder | null = null;
  private _muxer = new FMP4Muxer();
  private _initialized = false;
  private _initResult: TranscodedInit | null = null;
  private _timescale = 90000;
  private _baseDecodeTime = 0;
  private _fps: number;
  private _fpsAutoDetected = false;
  private _width = 0;
  private _height = 0;
  private _paramSetsFed = false;
  private _paramSetsBuffer: Uint8Array | null = null;

  constructor(config: SegmentTranscoderConfig = {}) {
    this._config = config;
    this._fps = config.fps ?? 25;
  }

  /** Whether the transcoder is ready to process segments */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /** The H.264 init segment result (available after processInitSegment) */
  get initResult(): TranscodedInit | null {
    return this._initResult;
  }

  /** Initialize the WASM decoder */
  async init(): Promise<void> {
    const decoderOpts: DecoderOptions = {};
    if (this._config.wasmUrl) decoderOpts.wasmUrl = this._config.wasmUrl;
    if (this._config.wasmBinaryUrl) decoderOpts.wasmBinaryUrl = this._config.wasmBinaryUrl;
    this._decoder = await HEVCDecoder.create(decoderOpts);
    this._initialized = true;
  }

  /**
   * Process an HEVC init segment (ftyp + moov) — parses track metadata and
   * extracts VPS/SPS/PPS for the WASM decoder. The H.264 init segment is
   * generated lazily on the first media segment, because the H.264 avcC
   * descriptor only exists after the first encoded frame.
   *
   * If you need the H.264 init segment up-front (e.g. when feeding Shaka's
   * `Transmuxer.transmux()` which expects a result for the init segment
   * before any media is delivered), use `prepareInit()` instead.
   */
  async processInitSegment(data: Uint8Array): Promise<void> {
    this._demuxer = new FMP4Demuxer();
    await this._demuxer.parseInit(data);

    const track = this._demuxer.videoTrack;
    if (track) {
      this._timescale = track.timescale;
      this._width = track.width;
      this._height = track.height;
    }

    // Extract VPS/SPS/PPS from hvcC in the init segment
    // These must be fed to the WASM decoder before any media NALs
    const paramSets = extractParameterSetsFromInit(data);
    if (paramSets.length > 0) {
      const psSize = paramSets.reduce((s, n) => s + 4 + n.byteLength, 0);
      this._paramSetsBuffer = new Uint8Array(psSize);
      let off = 0;
      for (const ps of paramSets) {
        this._paramSetsBuffer[off++] = 0;
        this._paramSetsBuffer[off++] = 0;
        this._paramSetsBuffer[off++] = 0;
        this._paramSetsBuffer[off++] = 1;
        this._paramSetsBuffer.set(ps, off);
        off += ps.byteLength;
      }
    }
  }

  /**
   * Process an HEVC init segment AND immediately produce a matching H.264
   * fMP4 init segment by encoding a single black warmup frame to obtain a
   * valid avcC descriptor. Useful for callers that must hand an init
   * segment back to the player before any media segment has been seen
   * (e.g. Shaka's `Transmuxer.transmux()`).
   *
   * After this call, `initResult` is populated and `processMediaSegment()`
   * will skip the lazy init-generation path on its first call.
   */
  async prepareInit(data: Uint8Array): Promise<TranscodedInit> {
    // Reset live state so a re-call (e.g. Shaka ABR adaptation reaching us
    // with a new HEVC init segment) starts clean. Without this, the encoder
    // configured for the previous resolution keeps running while `_width` is
    // overwritten by the new init — `processMediaSegment`'s dim-change check
    // then sees `frameW === _width` and never recreates the encoder, so new
    // frames are encoded at the previous dims and MSE renders garbage.
    if (this._encoder) {
      this._encoder.close();
      this._encoder = null;
    }
    this._paramSetsFed = false;
    this._initResult = null;

    await this.processInitSegment(data);
    if (this._width === 0 || this._height === 0) {
      throw new Error("prepareInit: missing dimensions in HEVC init segment");
    }

    // Use a *throwaway* encoder for the warmup so that the real encoder
    // (created lazily by processMediaSegment) starts in a clean state and
    // its first emitted chunk corresponds to the first real frame. Sharing
    // the same encoder would leak the warmup frame into the timeline and
    // shift the buffered range by ~1 frame duration.
    const warmup = new H264Encoder({
      width: this._width,
      height: this._height,
      fps: this._fps,
      bitrate: this._config.bitrate,
    });

    const cw = this._width >> 1;
    const ch = this._height >> 1;
    const blackFrame: HEVCFrame = {
      y: new Uint16Array(this._width * this._height),
      cb: new Uint16Array(cw * ch).fill(128),
      cr: new Uint16Array(cw * ch).fill(128),
      width: this._width,
      height: this._height,
      chromaWidth: cw,
      chromaHeight: ch,
      bitDepth: 8,
      poc: 0,
    };

    warmup.onChunk = () => { /* warmup discard */ };
    warmup.encode(blackFrame, 0, true);
    await warmup.flush();

    const avcC = warmup.codecDescription;
    const codec = warmup.codec;
    warmup.close();

    if (!avcC) {
      throw new Error("prepareInit: encoder produced no avcC after warmup");
    }

    const initSegment = this._muxer.generateInit({
      width: this._width,
      height: this._height,
      timescale: this._timescale,
      avcC,
    });

    this._initResult = { initSegment, codec };
    return this._initResult;
  }

  /**
   * Transcode an HEVC media segment to H.264.
   * Returns the H.264 fMP4 segment (moof + mdat).
   * On the first call, also generates the H.264 init segment if `prepareInit`
   * was not called beforehand.
   */
  /**
   * Perf stats from the last successful media segment.
   * - `*Ms` fields are wall-clock; `segDurMs` is the segment's intrinsic
   *   media-time duration. `speedX = segDurMs / (demuxMs+decodeMs+encodeMs)`
   *   is what the compute-aware ABR decider reacts to.
   */
  lastPerfStats: {
    demuxMs: number;
    decodeMs: number;
    encodeMs: number;
    frames: number;
    segDurMs: number;
    width: number;
    height: number;
  } | null = null;

  async processMediaSegment(data: Uint8Array): Promise<Uint8Array | null> {
    if (!this._decoder || !this._demuxer) {
      throw new Error("Transcoder not initialized. Call init() and processInitSegment() first.");
    }

    // 1. Demux → samples with NAL units
    const tDemux0 = performance.now();
    const samples = this._demuxer.parseSegment(data);
    if (samples.length === 0) return null;
    const tDemuxEnd = performance.now();

    // Extract absolute base decode time from tfdt box (mp4box.js DTS breaks after seek)
    const segmentBaseTime = extractTfdt(data) ?? samples[0]!.dts;

    // Auto-detect fps from first sample duration (DASH/HLS are CFR, so representative)
    if (!this._fpsAutoDetected && !this._config.fps && samples[0]!.duration > 0) {
      this._fps = this._timescale / samples[0]!.duration;
      this._fpsAutoDetected = true;
      log.debug(`Auto-detected fps: ${this._fps.toFixed(2)} (timescale=${this._timescale}, sample_duration=${samples[0]!.duration})`);
    }

    // Sort sample PTS (composition times) for display-order timestamp assignment.
    // drain() returns frames in display order (POC), but samples are in decode order.
    // Using DTS-based offsets would assign wrong timestamps when B-frames are present.
    const sortedPts = samples.map(s => s.pts).sort((a, b) => a - b);

    // 2. Feed VPS/SPS/PPS on first segment (from hvcC in init segment)
    if (!this._paramSetsFed && this._paramSetsBuffer) {
      this._decoder.feed(this._paramSetsBuffer);
      this._paramSetsFed = true;
    }

    // 3. Feed NAL units to WASM decoder (Annex B format)
    for (const sample of samples) {
      const totalSize = sample.nalUnits.reduce((sum, n) => sum + 4 + n.length, 0);
      const nalBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const nal of sample.nalUnits) {
        nalBuffer[offset++] = 0;
        nalBuffer[offset++] = 0;
        nalBuffer[offset++] = 0;
        nalBuffer[offset++] = 1;
        nalBuffer.set(nal, offset);
        offset += nal.length;
      }
      this._decoder.feed(nalBuffer);
    }

    // 4. Drain decoded YUV frames (display order)
    const frames = this._decoder.drain();
    const tDecodeEnd = performance.now();
    if (frames.length === 0) {
      this.lastPerfStats = null;
      return null;
    }

    // 5. Encode to H.264 (recreate encoder on resolution change for ABR)
    const frameW = frames[0]!.width;
    const frameH = frames[0]!.height;
    if (this._encoder && (frameW !== this._width || frameH !== this._height)) {
      log.info(`Resolution changed ${this._width}x${this._height} → ${frameW}x${frameH}, recreating encoder`);
      this._encoder.close();
      this._encoder = null;
      this._initResult = null; // force new H.264 init segment
    }
    if (!this._encoder) {
      this._encoder = new H264Encoder({
        width: frameW,
        height: frameH,
        fps: this._fps,
        bitrate: this._config.bitrate,
      });
      this._width = frameW;
      this._height = frameH;
    }

    const chunks: EncodedChunk[] = [];
    this._encoder.onChunk = (chunk) => chunks.push(chunk);

    for (let i = 0; i < frames.length; i++) {
      // Use PTS-sorted timestamps: frames are in display order from drain(),
      // so frame[i] corresponds to the i-th smallest PTS value.
      const timestampUs = i < sortedPts.length
        ? Math.round((sortedPts[i]! / this._timescale) * 1_000_000)
        : Math.round((segmentBaseTime / this._timescale) * 1_000_000) + Math.round((i / this._fps) * 1_000_000);
      this._encoder.encode(frames[i]!, timestampUs, i === 0);
    }

    await this._encoder.flush();
    if (chunks.length === 0) return null;

    // 6. Generate H.264 init segment on first successful encode
    if (!this._initResult) {
      const avcC = this._encoder.codecDescription;
      if (!avcC) throw new Error("No avcC description from encoder");

      const initSegment = this._muxer.generateInit({
        width: this._width,
        height: this._height,
        timescale: this._timescale,
        avcC,
      });

      this._initResult = {
        initSegment,
        codec: this._encoder.codec,
      };
    }

    // 7. Mux H.264 chunks into fMP4 media segment
    // Use sorted PTS durations for display-order frames.
    const sortedDurations: number[] = [];
    for (let i = 0; i < sortedPts.length - 1; i++) {
      sortedDurations.push(sortedPts[i + 1]! - sortedPts[i]!);
    }
    if (sortedPts.length > 0) {
      sortedDurations.push(samples[0]!.duration); // last frame uses nominal duration
    }

    const muxerSamples = chunks.map((c, i) => ({
      data: c.data,
      duration: i < sortedDurations.length
        ? sortedDurations[i]!
        : Math.round(c.duration * this._timescale / 1_000_000),
      isKeyframe: c.isKeyframe,
      compositionTimeOffset: 0,
    }));

    // Use the smallest PTS as the base decode time for the muxed segment
    const muxBaseTime = sortedPts.length > 0 ? sortedPts[0]! : segmentBaseTime;
    const mediaSegment = this._muxer.muxSegment(muxerSamples, muxBaseTime);

    const tEncodeEnd = performance.now();
    const demuxMs = tDemuxEnd - tDemux0;
    const decodeMs = tDecodeEnd - tDemuxEnd;
    const encodeMs = tEncodeEnd - tDecodeEnd;
    // Intrinsic segment duration in media time — sum of sample durations
    // (robust to VFR and to truncated last segments, unlike `n * fps`).
    const segDurTicks = samples.reduce((sum, s) => sum + s.duration, 0);
    const segDurMs = (segDurTicks / this._timescale) * 1000;
    this.lastPerfStats = {
      demuxMs,
      decodeMs,
      encodeMs,
      frames: frames.length,
      segDurMs,
      width: frameW,
      height: frameH,
    };

    const totalMs = demuxMs + decodeMs + encodeMs;
    // Skip publication when totalMs is degenerate. A zero-time segment
    // produces an Infinity speedX that would pile up `consecutiveHigh`
    // and spuriously raise the cap on the consumer side.
    if (totalMs > 0) {
      publishSegmentStat({
        totalMs,
        segDurMs,
        speedX: segDurMs / totalMs,
        frames: frames.length,
        width: frameW,
        height: frameH,
      });
    }

    return mediaSegment;
  }

  /**
   * Streaming variant — identical encode pipeline as processMediaSegment,
   * then splits output chunks into batches for incremental MSE append.
   */
  async processMediaSegmentStreaming(
    data: Uint8Array,
    onChunk: (h264: Uint8Array, init: TranscodedInit | null) => Promise<void> | void,
  ): Promise<void> {
    if (!this._decoder || !this._demuxer) {
      throw new Error("Transcoder not initialized. Call init() and processInitSegment() first.");
    }

    const BATCH_SIZE = 30;

    const tDemux0 = performance.now();
    const samples = this._demuxer.parseSegment(data);
    if (samples.length === 0) return;
    const tDemuxEnd = performance.now();

    const segmentBaseTime = extractTfdt(data) ?? samples[0]!.dts;

    if (!this._fpsAutoDetected && !this._config.fps && samples[0]!.duration > 0) {
      this._fps = this._timescale / samples[0]!.duration;
      this._fpsAutoDetected = true;
    }

    // Sort PTS for display-order timestamp assignment (same fix as sequential path)
    const sortedPts = samples.map(s => s.pts).sort((a, b) => a - b);

    if (!this._paramSetsFed && this._paramSetsBuffer) {
      this._decoder.feed(this._paramSetsBuffer);
      this._paramSetsFed = true;
    }

    for (const sample of samples) {
      const totalSize = sample.nalUnits.reduce((sum, n) => sum + 4 + n.length, 0);
      const nalBuffer = new Uint8Array(totalSize);
      let offset = 0;
      for (const nal of sample.nalUnits) {
        nalBuffer[offset++] = 0; nalBuffer[offset++] = 0;
        nalBuffer[offset++] = 0; nalBuffer[offset++] = 1;
        nalBuffer.set(nal, offset);
        offset += nal.length;
      }
      this._decoder.feed(nalBuffer);
    }

    // Drain frames in display order
    const frames = this._decoder.drain();
    const tDecodeEnd = performance.now();
    if (frames.length === 0) return;

    const frameW = frames[0]!.width;
    const frameH = frames[0]!.height;
    if (this._encoder && (frameW !== this._width || frameH !== this._height)) {
      this._encoder.close();
      this._encoder = null;
      this._initResult = null;
    }
    if (!this._encoder) {
      this._encoder = new H264Encoder({
        width: frameW, height: frameH,
        fps: this._fps, bitrate: this._config.bitrate,
      });
      this._width = frameW;
      this._height = frameH;
    }

    // Encode in batches, using PTS-sorted timestamps
    let initEmitted = false;
    const tEncode0 = performance.now();

    for (let batchStart = 0; batchStart < frames.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, frames.length);
      const batchChunks: EncodedChunk[] = [];
      this._encoder.onChunk = (chunk) => batchChunks.push(chunk);

      for (let i = batchStart; i < batchEnd; i++) {
        const timestampUs = i < sortedPts.length
          ? Math.round((sortedPts[i]! / this._timescale) * 1_000_000)
          : Math.round((segmentBaseTime / this._timescale) * 1_000_000) + Math.round((i / this._fps) * 1_000_000);
        this._encoder.encode(frames[i]!, timestampUs, i === 0);
      }

      await this._encoder.flush();
      if (batchChunks.length === 0) continue;

      if (!this._initResult) {
        const avcC = this._encoder.codecDescription;
        if (!avcC) throw new Error("No avcC description from encoder");
        this._initResult = {
          initSegment: this._muxer.generateInit({
            width: this._width, height: this._height,
            timescale: this._timescale, avcC,
          }),
          codec: this._encoder.codec,
        };
      }

      // Use PTS-sorted base time for each batch
      const batchBaseTime = batchStart < sortedPts.length
        ? sortedPts[batchStart]!
        : segmentBaseTime;

      const muxerSamples = batchChunks.map((c, i) => {
        const ptsIdx = batchStart + i;
        const duration = (ptsIdx < sortedPts.length - 1)
          ? sortedPts[ptsIdx + 1]! - sortedPts[ptsIdx]!
          : samples[0]!.duration;
        return {
          data: c.data,
          duration,
          isKeyframe: c.isKeyframe,
          compositionTimeOffset: 0,
        };
      });

      const mediaSegment = this._muxer.muxSegment(muxerSamples, batchBaseTime);
      await onChunk(mediaSegment, !initEmitted ? this._initResult : null);
      initEmitted = true;
    }

    // Publish one perf event per segment (not per batch) so compute-aware
    // ABR sees the same shape from streaming and non-streaming paths.
    const tEncodeEnd = performance.now();
    const demuxMs = tDemuxEnd - tDemux0;
    const decodeMs = tDecodeEnd - tDemuxEnd;
    const encodeMs = tEncodeEnd - tEncode0;
    const segDurTicks = samples.reduce((sum, s) => sum + s.duration, 0);
    const segDurMs = (segDurTicks / this._timescale) * 1000;
    this.lastPerfStats = {
      demuxMs,
      decodeMs,
      encodeMs,
      frames: frames.length,
      segDurMs,
      width: frameW,
      height: frameH,
    };
    const totalMs = demuxMs + decodeMs + encodeMs;
    if (totalMs > 0) {
      publishSegmentStat({
        totalMs,
        segDurMs,
        speedX: segDurMs / totalMs,
        frames: frames.length,
        width: frameW,
        height: frameH,
      });
    }
  }

  /**
   * Flush remaining frames from the decoder.
   * Returns the final H.264 media segment, or null if no frames remain.
   */
  async flush(): Promise<Uint8Array | null> {
    if (!this._decoder) return null;

    const remaining = this._decoder.flush();
    if (remaining.length === 0) return null;

    return this._encodeFrames(remaining);
  }

  /** Release all resources */
  destroy(): void {
    this._encoder?.close();
    this._decoder?.destroy();
    this._decoder = null;
    this._encoder = null;
    this._demuxer = null;
    this._initResult = null;
  }

  private async _encodeFrames(frames: HEVCFrame[]): Promise<Uint8Array | null> {
    if (!this._encoder || frames.length === 0) return null;

    const chunks: EncodedChunk[] = [];
    this._encoder.onChunk = (chunk) => chunks.push(chunk);

    for (let i = 0; i < frames.length; i++) {
      const timestampUs = Math.round((this._baseDecodeTime / this._timescale) * 1_000_000)
        + Math.round((i / this._fps) * 1_000_000);
      this._encoder.encode(frames[i]!, timestampUs, i === 0);
    }

    await this._encoder.flush();
    if (chunks.length === 0) return null;

    const muxerSamples = chunks.map((c) => ({
      data: c.data,
      duration: Math.round(c.duration * this._timescale / 1_000_000),
      isKeyframe: c.isKeyframe,
      compositionTimeOffset: 0,
    }));

    const segment = this._muxer.muxSegment(muxerSamples, this._baseDecodeTime);
    this._baseDecodeTime += muxerSamples.reduce((sum, s) => sum + s.duration, 0);
    return segment;
  }
}

/**
 * Extract VPS/SPS/PPS NAL units from hvcC box in an fMP4 init segment.
 * Scans for the 'hvcC' fourcc and parses the HEVC decoder configuration record.
 */
function extractParameterSetsFromInit(data: Uint8Array): Uint8Array[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sets: Uint8Array[] = [];

  // Scan for 'hvcC' (0x68766343)
  for (let i = 0; i < data.byteLength - 4; i++) {
    if (view.getUint32(i) !== 0x68766343) continue;

    // hvcC payload starts after the fourcc (box header is 4 bytes before)
    const payload = i + 4;
    if (payload + 23 > data.byteLength) break;

    // Byte 22 of hvcC payload = numOfArrays
    const numArrays = data[payload + 22]!;
    let off = payload + 23;

    for (let a = 0; a < numArrays && off + 3 <= data.byteLength; a++) {
      off++; // array_completeness(1) + NAL_unit_type(5) packed in 1 byte
      const numNalus = view.getUint16(off);
      off += 2;
      for (let n = 0; n < numNalus && off + 2 <= data.byteLength; n++) {
        const naluLen = view.getUint16(off);
        off += 2;
        if (off + naluLen <= data.byteLength) {
          sets.push(data.slice(off, off + naluLen));
        }
        off += naluLen;
      }
    }
    break;
  }

  return sets;
}

/**
 * Extract baseMediaDecodeTime from the tfdt box in an fMP4 media segment.
 * Parses: moof → traf → tfdt → baseMediaDecodeTime.
 * Returns the absolute decode time in timescale units, or null if not found.
 */
function extractTfdt(data: Uint8Array): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = data.byteLength;

  // Scan for 'tfdt' box type (0x74666474)
  for (let i = 0; i + 8 <= len; i++) {
    if (view.getUint32(i + 4) !== 0x74666474) continue;
    // Found tfdt — it's a FullBox: version(1) + flags(3) + payload
    const version = data[i + 8];
    if (version === 1 && i + 20 <= len) {
      // 64-bit baseMediaDecodeTime
      const hi = view.getUint32(i + 12);
      const lo = view.getUint32(i + 16);
      return hi * 0x100000000 + lo;
    }
    if (i + 16 <= len) {
      // 32-bit baseMediaDecodeTime
      return view.getUint32(i + 12);
    }
  }
  return null;
}
