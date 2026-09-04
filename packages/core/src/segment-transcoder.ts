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
import type { MuxerAudioConfig } from "./fmp4-muxer.js";
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
  // Audio pass-through (muxed A/V segments): captured from the init segment.
  private _audioConfig: MuxerAudioConfig | null = null;

  /** Whether the source carries a muxed audio track we pass through. */
  get hasMuxedAudio(): boolean {
    return this._audioConfig !== null;
  }

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

    // Muxed A/V: capture the audio track for pass-through re-muxing. Keyed on
    // the audio track's presence, not on ASC extraction, so it stays in sync
    // with the intercept's mime-based muxed decision (which already committed
    // to an audiovideo SourceBuffer). A missing ASC is surfaced loudly rather
    // than silently degrading to a video-only segment in an A/V buffer.
    const audio = this._demuxer.audioTrack;
    if (audio) {
      if (audio.asc.byteLength === 0) {
        log.warn(
          "Muxed audio track has no AudioSpecificConfig — the audio track may fail to decode. " +
          "The video is still transcoded.",
        );
      }
      this._audioConfig = {
        timescale: audio.timescale,
        channelCount: audio.channelCount,
        sampleRate: audio.sampleRate,
        sampleSize: audio.sampleSize,
        asc: audio.asc,
      };
    } else {
      this._audioConfig = null;
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
    const segmentBaseTime = rebaseSamplesToTfdt(samples, extractTfdt(data));

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

    // 3-5. Decode and encode sample by sample, draining after every feed.
    // The WASM DPB only reclaims a picture once the caller has bumped it out,
    // so feeding a whole segment before draining retains one picture per
    // frame — ~24 MB each at 4K, which overruns the 2 GB WASM ceiling on a 2s
    // segment. drain() copies planes into the JS heap, so the frames stay
    // valid across later feeds and encoding them right away lets the GC
    // reclaim them too.
    const chunks: EncodedChunk[] = [];
    let frameCount = 0;
    let frameW = 0;
    let frameH = 0;
    let decodeMs = 0;
    let encodeMs = 0;

    const encodeDrained = (frames: HEVCFrame[]) => {
      if (frames.length === 0) return;
      if (frameCount === 0) {
        // Encoder setup on the first frames of the segment (recreated on a
        // resolution change for ABR).
        frameW = frames[0]!.width;
        frameH = frames[0]!.height;
        this._prepareEncoder(frameW, frameH);
        this._encoder!.onChunk = (chunk) => chunks.push(chunk);
      }
      for (const frame of frames) {
        // Use PTS-sorted timestamps: frames come out in display order, so
        // the i-th frame of the segment carries the i-th smallest PTS.
        const i = frameCount++;
        const timestampUs = i < sortedPts.length
          ? Math.round((sortedPts[i]! / this._timescale) * 1_000_000)
          : Math.round((segmentBaseTime / this._timescale) * 1_000_000) + Math.round((i / this._fps) * 1_000_000);
        this._encoder!.encode(frame, timestampUs, i === 0);
      }
    };

    for (const sample of samples) {
      const tFeed0 = performance.now();
      this._decoder.feed(toAnnexB(sample.nalUnits));
      const frames = this._decoder.drain();
      const tDrainEnd = performance.now();
      decodeMs += tDrainEnd - tFeed0;
      encodeDrained(frames);
      encodeMs += performance.now() - tDrainEnd;
    }

    // Segment boundary: empty the reorder buffer. drain() leaves pictures the
    // bumping conditions have not released yet; carried over, they would be
    // emitted while transcoding the next segment and take its timestamps.
    // Muxing is per segment, so each one must carry its own frames.
    const tSegFlush = performance.now();
    const tail = this._decoder.flush();
    decodeMs += performance.now() - tSegFlush;
    const tTailEncode = performance.now();
    encodeDrained(tail);
    encodeMs += performance.now() - tTailEncode;

    if (frameCount === 0) {
      this.lastPerfStats = null;
      return null;
    }

    // Everything from here — encoder flush, init segment, muxing — is charged
    // to encodeMs, so demuxMs+decodeMs+encodeMs still covers the whole call.
    const tTail0 = performance.now();
    await this._encoder!.flush();
    if (chunks.length === 0) return null;

    // 6. Generate H.264 init segment on first successful encode. When the
    // source is muxed A/V, emit a two-track init (H.264 video + AAC audio)
    // so a single audiovideo SourceBuffer plays both.
    if (!this._initResult) {
      const avcC = this._encoder!.codecDescription;
      if (!avcC) throw new Error("No avcC description from encoder");

      const videoInit = {
        width: this._width,
        height: this._height,
        timescale: this._timescale,
        avcC,
      };
      const initSegment = this._audioConfig
        ? this._muxer.generateInitAV(videoInit, this._audioConfig)
        : this._muxer.generateInit(videoInit);
      // Only AAC pass-through is supported, so the audio codec is mp4a.40.2.
      const codec = this._audioConfig
        ? `${this._encoder!.codec},mp4a.40.2`
        : this._encoder!.codec;

      this._initResult = { initSegment, codec };
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
    let mediaSegment: Uint8Array;
    const audioSamples = this._audioConfig ? this._demuxer.drainAudioSamples() : [];
    if (this._audioConfig && audioSamples.length > 0) {
      // Muxed A/V: re-mux the transcoded video with the pass-through audio.
      // Audio keeps its own timeline (its own timescale + tfdt).
      mediaSegment = this._muxer.muxSegmentAV(
        muxerSamples,
        muxBaseTime,
        audioSamples.map((a) => ({ data: a.data, duration: a.duration })),
        audioSamples[0]!.dts,
      );
    } else {
      // Video-only, or a muxed segment that happened to carry no audio
      // samples — emit a single video traf (valid in an audiovideo buffer).
      mediaSegment = this._muxer.muxSegment(muxerSamples, muxBaseTime);
    }

    const demuxMs = tDemuxEnd - tDemux0;
    encodeMs += performance.now() - tTail0;
    // Intrinsic segment duration in media time — sum of sample durations
    // (robust to VFR and to truncated last segments, unlike `n * fps`).
    const segDurTicks = samples.reduce((sum, s) => sum + s.duration, 0);
    const segDurMs = (segDurTicks / this._timescale) * 1000;
    // Keep the flush() clock (_baseDecodeTime) on the segment timeline so a
    // trailing flush muxes after the last segment, not at a stale position.
    this._baseDecodeTime = segmentBaseTime + segDurTicks;
    this.lastPerfStats = {
      demuxMs,
      decodeMs,
      encodeMs,
      frames: frameCount,
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
        frames: frameCount,
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

    const segmentBaseTime = rebaseSamplesToTfdt(samples, extractTfdt(data));

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

    // Encode and ship one BATCH_SIZE batch as soon as it is full.
    let initEmitted = false;
    const emitBatch = async (batch: HEVCFrame[], batchStart: number) => {
      const batchChunks: EncodedChunk[] = [];
      this._encoder!.onChunk = (chunk) => batchChunks.push(chunk);

      for (let i = 0; i < batch.length; i++) {
        const idx = batchStart + i;
        const timestampUs = idx < sortedPts.length
          ? Math.round((sortedPts[idx]! / this._timescale) * 1_000_000)
          : Math.round((segmentBaseTime / this._timescale) * 1_000_000) + Math.round((idx / this._fps) * 1_000_000);
        this._encoder!.encode(batch[i]!, timestampUs, idx === 0);
      }

      await this._encoder!.flush();
      if (batchChunks.length === 0) return;

      if (!this._initResult) {
        const avcC = this._encoder!.codecDescription;
        if (!avcC) throw new Error("No avcC description from encoder");
        this._initResult = {
          initSegment: this._muxer.generateInit({
            width: this._width, height: this._height,
            timescale: this._timescale, avcC,
          }),
          codec: this._encoder!.codec,
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
    };

    // Decode and encode in lockstep. Draining after every feed keeps the WASM
    // DPB at its §A.4.1 bound instead of one picture per frame — the whole
    // point of this path for 4K, where a deferred drain costs ~24 MB a frame
    // and overruns the 2 GB WASM ceiling. Shipping each full batch keeps the
    // JS heap bounded too, since drain() copies planes out of the WASM heap.
    let decodeMs = 0;
    let encodeMs = 0;
    let frameW = 0;
    let frameH = 0;
    let frameCount = 0;
    let encodedCount = 0;
    let pending: HEVCFrame[] = [];

    const ingest = async (frames: HEVCFrame[]) => {
      if (frames.length === 0) return;
      if (frameCount === 0) {
        frameW = frames[0]!.width;
        frameH = frames[0]!.height;
        this._prepareEncoder(frameW, frameH);
      }
      frameCount += frames.length;
      pending.push(...frames);
      while (pending.length >= BATCH_SIZE) {
        await emitBatch(pending.splice(0, BATCH_SIZE), encodedCount);
        encodedCount += BATCH_SIZE;
      }
    };

    for (const sample of samples) {
      const tFeed0 = performance.now();
      this._decoder.feed(toAnnexB(sample.nalUnits));
      const frames = this._decoder.drain();
      const tDrainEnd = performance.now();
      decodeMs += tDrainEnd - tFeed0;
      await ingest(frames);
      encodeMs += performance.now() - tDrainEnd;
    }

    // Segment boundary: empty the reorder buffer, so pictures drain() has not
    // released yet do not spill into the next segment and take its timestamps.
    const tSegFlush = performance.now();
    const tail = this._decoder.flush();
    decodeMs += performance.now() - tSegFlush;

    const tTail0 = performance.now();
    await ingest(tail);
    if (frameCount === 0) return;

    // Trailing partial batch
    if (pending.length > 0) {
      await emitBatch(pending, encodedCount);
      pending = [];
    }
    encodeMs += performance.now() - tTail0;

    // Publish one perf event per segment (not per batch) so compute-aware
    // ABR sees the same shape from streaming and non-streaming paths.
    const demuxMs = tDemuxEnd - tDemux0;
    const segDurTicks = samples.reduce((sum, s) => sum + s.duration, 0);
    const segDurMs = (segDurTicks / this._timescale) * 1000;
    // Keep the flush() clock (_baseDecodeTime) on the segment timeline so a
    // trailing flush muxes after the last segment, not at a stale position.
    this._baseDecodeTime = segmentBaseTime + segDurTicks;
    this.lastPerfStats = {
      demuxMs,
      decodeMs,
      encodeMs,
      frames: frameCount,
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
        frames: frameCount,
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

  /** Create the H.264 encoder, or recreate it when the resolution changed (ABR). */
  private _prepareEncoder(width: number, height: number): void {
    if (this._encoder && (width !== this._width || height !== this._height)) {
      log.info(`Resolution changed ${this._width}x${this._height} → ${width}x${height}, recreating encoder`);
      this._encoder.close();
      this._encoder = null;
      this._initResult = null; // force new H.264 init segment
    }
    if (!this._encoder) {
      this._encoder = new H264Encoder({
        width,
        height,
        fps: this._fps,
        bitrate: this._config.bitrate,
      });
      this._width = width;
      this._height = height;
    }
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

/** Join raw NAL units into an Annex B buffer, prefixing each with a start code. */
function toAnnexB(nalUnits: Uint8Array[]): Uint8Array {
  const totalSize = nalUnits.reduce((sum, n) => sum + 4 + n.length, 0);
  const buf = new Uint8Array(totalSize);
  let offset = 0;
  for (const nal of nalUnits) {
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 0;
    buf[offset++] = 1;
    buf.set(nal, offset);
    offset += nal.length;
  }
  return buf;
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
 * Rebase demuxed samples onto the segment's tfdt (baseMediaDecodeTime).
 *
 * mp4box.js keeps a cumulative internal timeline: after an out-of-buffer
 * seek (no abort, no re-init — hls.js >=1.6.6 relies purely on the
 * segment's own timestamps to position it), parsed samples continue the
 * pre-seek clock while the tfdt carries the true media position. Shifting
 * every pts/dts by (samples[0].dts - tfdt) makes the transcoded output
 * land where the source segment says. Continuous playback is untouched:
 * the drift is 0 and relative durations are preserved either way.
 *
 * Invariant: `samples` must all belong to the segment the tfdt was read
 * from (mp4box holds samples back only on truncated mdat, which the MSE
 * append path never produces — players append whole segments).
 *
 * @param samples mutated in place (pts/dts shifted by the drift)
 * @returns the base decode time to use for the segment. Exported for tests.
 */
export function rebaseSamplesToTfdt(
  samples: { pts: number; dts: number }[],
  tfdt: number | null,
): number {
  if (samples.length === 0) return tfdt ?? 0;
  if (tfdt === null) return samples[0]!.dts;
  const drift = samples[0]!.dts - tfdt;
  if (drift !== 0) {
    for (const s of samples) {
      s.dts -= drift;
      s.pts -= drift;
    }
  }
  return tfdt;
}

/**
 * Extract baseMediaDecodeTime by structurally walking moof → traf → tfdt.
 *
 * Strict on purpose — a wrong tfdt now shifts every sample of the segment
 * (see rebaseSamplesToTfdt), so any ambiguity disables the rebase instead
 * of corrupting it. Returns null when:
 *  - the moof holds more than one traf (muxed A/V segment: the first tfdt
 *    could be the audio track's, in a different timescale);
 *  - the tfdt box is truncated or has an unknown version;
 *  - the 64-bit value exceeds Number.MAX_SAFE_INTEGER.
 * Only box headers are inspected — mdat payloads are never scanned, so a
 * stray 'tfdt' byte pattern inside media data can't produce a false hit.
 * Exported for tests.
 */
export function extractTfdt(data: Uint8Array): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = data.byteLength;

  // Iterate boxes at one nesting level, calling visit(type, start, end)
  // where start is the payload offset (after the 8-byte header).
  const eachBox = (
    from: number,
    to: number,
    visit: (type: number, start: number, end: number) => void,
  ): void => {
    let i = from;
    while (i + 8 <= to) {
      const size = view.getUint32(i);
      if (size < 8 || i + size > to) return; // malformed/truncated — stop
      visit(view.getUint32(i + 4), i + 8, i + size);
      i += size;
    }
  };

  let tfdt: number | null = null;
  let trafCount = 0;

  eachBox(0, len, (type, start, end) => {
    if (type !== 0x6d6f6f66) return; // 'moof'
    eachBox(start, end, (childType, childStart, childEnd) => {
      if (childType !== 0x74726166) return; // 'traf'
      trafCount++;
      eachBox(childStart, childEnd, (boxType, boxStart, boxEnd) => {
        if (boxType !== 0x74666474) return; // 'tfdt'
        const version = data[boxStart];
        if (version === 1 && boxStart + 12 <= boxEnd) {
          const hi = view.getUint32(boxStart + 4);
          const lo = view.getUint32(boxStart + 8);
          const value = hi * 0x100000000 + lo;
          tfdt = Number.isSafeInteger(value) ? value : null;
        } else if (version === 0 && boxStart + 8 <= boxEnd) {
          tfdt = view.getUint32(boxStart + 4);
        }
        // unknown version or truncated box → leave tfdt as-is (null)
      });
    });
  });

  return trafCount === 1 ? tfdt : null;
}
