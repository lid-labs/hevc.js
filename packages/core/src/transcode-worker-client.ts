/**
 * Main-thread client for the TranscodeWorker.
 *
 * Provides the same interface as SegmentTranscoder but delegates all
 * heavy work to a Web Worker via postMessage.
 */

import { log } from "./log.js";
import { publishSegmentStat } from "./perf-bus.js";
import type { SegmentTranscoderConfig, TranscodedInit } from "./segment-transcoder.js";

type PerfEnvelope = {
  demuxMs: number;
  decodeMs: number;
  encodeMs: number;
  frames: number;
  segDurMs: number;
  width: number;
  height: number;
};

export interface TranscodeWorkerClientConfig extends SegmentTranscoderConfig {
  /** URL to the worker script (transcode-worker.js). */
  workerUrl: string;
}

export class TranscodeWorkerClient {
  // Resolves once the worker exists. All postMessage paths await this first
  // so that cross-origin worker loading (fetch + blob URL) stays transparent
  // to the synchronous public constructor.
  private _workerReady: Promise<Worker>;
  private _ready = false;
  private _initParsed = false;
  private _initResult: TranscodedInit | null = null;
  private _segmentId = 0;
  private _pendingResolves = new Map<number, { resolve: (data: Uint8Array | null) => void; reject: (err: Error) => void }>();
  private _pendingPrepareInit = new Map<number, { resolve: (result: TranscodedInit) => void; reject: (err: Error) => void }>();
  private _readyPromise: Promise<void>;
  private _readyResolve!: () => void;
  private _initParsedPromise!: Promise<void>;
  private _initParsedResolve!: () => void;
  private _initParsedReject!: (err: Error) => void;
  // Mirror of SegmentTranscoder.lastPerfStats, refreshed on each
  // `transcoded` / `streamingDone` message. Surfaces perf to consumers
  // (compute-aware ABR) when transcoding runs off-thread.
  private _lastPerfStats: PerfEnvelope | null = null;

  constructor(config: TranscodeWorkerClientConfig) {
    this._readyPromise = new Promise<void>((resolve) => { this._readyResolve = resolve; });
    this._initParsedPromise = new Promise<void>((resolve, reject) => { this._initParsedResolve = resolve; this._initParsedReject = reject; });

    const { workerUrl: _, ...transcoderConfig } = config;
    this._workerReady = loadWorker(config.workerUrl).then((worker) => {
      worker.onmessage = (e: MessageEvent) => this._onMessage(e.data);
      worker.onerror = (e: ErrorEvent) => {
        log.error("Worker error:", e.message);
      };
      worker.postMessage({ type: "init", config: transcoderConfig });
      return worker;
    });
  }

  get isInitialized(): boolean { return this._ready; }
  get isInitParsed(): boolean { return this._initParsed; }
  get initResult(): TranscodedInit | null { return this._initResult; }
  get lastPerfStats(): PerfEnvelope | null { return this._lastPerfStats; }

  /** Wait for the WASM decoder to be ready inside the worker */
  async waitReady(): Promise<void> {
    // Surface worker creation failures (cross-origin fetch, blob URL, etc.)
    // before we sit waiting on _readyPromise that would never resolve.
    await this._workerReady;
    return this._readyPromise;
  }

  /** Send an init segment (ftyp + moov) to the worker for parsing */
  async processInitSegment(data: Uint8Array): Promise<void> {
    const worker = await this._workerReady;
    worker.postMessage(
      { type: "initSegment", data: data.buffer },
      [data.buffer],
    );
    return this._initParsedPromise;
  }

  /**
   * Process an HEVC init segment and return a matching H.264 fMP4 init
   * segment (warmup-encoder path inside the worker). Required by
   * transmuxer plugins that must hand an init segment back to the host
   * player before any media has been seen (Shaka 4.x's Transmuxer
   * contract).
   */
  async prepareInit(data: Uint8Array): Promise<TranscodedInit> {
    const worker = await this._workerReady;
    const id = this._segmentId++;
    return new Promise<TranscodedInit>((resolve, reject) => {
      this._pendingPrepareInit.set(id, { resolve, reject });
      worker.postMessage(
        { type: "prepareInit", data: data.buffer, id },
        [data.buffer],
      );
    });
  }

  /** Send a media segment to the worker for transcoding */
  async processMediaSegment(data: Uint8Array): Promise<Uint8Array | null> {
    const worker = await this._workerReady;
    const id = this._segmentId++;
    return new Promise<Uint8Array | null>((resolve, reject) => {
      this._pendingResolves.set(id, { resolve, reject });
      worker.postMessage(
        { type: "mediaSegment", data: data.buffer, id },
        [data.buffer],
      );
    });
  }

  /** Send a media segment for streaming transcoding — onChunk called for each partial result */
  async processMediaSegmentStreaming(
    data: Uint8Array,
    onChunk: (h264: Uint8Array, initSegment: Uint8Array | null, codec: string | null) => Promise<void> | void,
  ): Promise<void> {
    const worker = await this._workerReady;
    const id = this._segmentId++;
    return new Promise<void>((resolve, reject) => {
      // Queue to serialize async onChunk calls (MSE appends must be sequential)
      let chainPromise = Promise.resolve();

      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === "partialTranscoded") {
          const init = msg.initSegment ? new Uint8Array(msg.initSegment as ArrayBuffer) : null;
          if (init && !this._initResult) {
            this._initResult = {
              initSegment: init,
              codec: (msg.codec as string) || "avc1.640033",
            };
          }
          const h264 = new Uint8Array(msg.h264 as ArrayBuffer);
          // Chain async calls so MSE appends don't overlap
          chainPromise = chainPromise.then(() => onChunk(h264, init, msg.codec ?? null));
        } else if (msg.type === "streamingDone") {
          worker.removeEventListener("message", handler);
          const perf = msg.perf as PerfEnvelope | null;
          if (perf) {
            this._lastPerfStats = perf;
            const totalMs = perf.demuxMs + perf.decodeMs + perf.encodeMs;
            if (totalMs > 0) {
              publishSegmentStat({
                totalMs,
                segDurMs: perf.segDurMs,
                speedX: perf.segDurMs / totalMs,
                frames: perf.frames,
                width: perf.width,
                height: perf.height,
              });
            }
          }
          // Wait for all queued onChunk calls to finish before resolving
          chainPromise.then(() => resolve()).catch(reject);
        } else if (msg.type === "error") {
          worker.removeEventListener("message", handler);
          chainPromise.then(() => reject(new Error(msg.message as string))).catch(reject);
        }
      };
      worker.addEventListener("message", handler);
      worker.postMessage(
        { type: "mediaSegmentStreaming", data: data.buffer, id },
        [data.buffer],
      );
    });
  }

  /** Abort current transcoding, reset state for seek */
  abort(): void {
    // Reject all pending
    for (const [, { reject }] of this._pendingResolves) {
      reject(new Error("Aborted"));
    }
    this._pendingResolves.clear();
    for (const [, { reject }] of this._pendingPrepareInit) {
      reject(new Error("Aborted"));
    }
    this._pendingPrepareInit.clear();
    this._segmentId = 0;

    // Reset ready state — worker will destroy + re-create transcoder (async init)
    // waitReady() must block until the worker sends "aborted" (= re-init done)
    this._ready = false;
    this._readyPromise = new Promise<void>((resolve) => { this._readyResolve = resolve; });

    // Reset init state — next append will be a new init segment
    this._initParsed = false;
    this._initResult = null;
    this._initParsedPromise = new Promise<void>((resolve, reject) => {
      this._initParsedResolve = resolve;
      this._initParsedReject = reject;
    });

    this._workerReady.then((worker) => worker.postMessage({ type: "abort" }));
  }

  /** Destroy the worker */
  destroy(): void {
    this._pendingResolves.clear();
    this._pendingPrepareInit.clear();
    this._workerReady.then((worker) => {
      worker.postMessage({ type: "destroy" });
      worker.terminate();
    });
  }

  private _onMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "ready":
        this._ready = true;
        this._readyResolve();
        break;

      case "initParsed":
        this._initParsed = true;
        this._initParsedResolve();
        break;

      case "initPrepared": {
        const id = msg.id as number;
        const pending = this._pendingPrepareInit.get(id);
        if (!pending) break;
        this._pendingPrepareInit.delete(id);
        const result: TranscodedInit = {
          initSegment: new Uint8Array(msg.initSegment as ArrayBuffer),
          codec: msg.codec as string,
        };
        // Cache for the .initResult getter so downstream code that
        // queries it after the warmup path still gets a value.
        if (!this._initResult) this._initResult = result;
        pending.resolve(result);
        break;
      }

      case "transcoded": {
        const id = msg.id as number;
        const perf = msg.perf as PerfEnvelope | null;
        if (perf) {
          this._lastPerfStats = perf;
          const totalMs = perf.demuxMs + perf.decodeMs + perf.encodeMs;
          log.debug(`Segment #${id} transcoded in ${totalMs.toFixed(0)}ms (${perf.frames}f — demux:${perf.demuxMs.toFixed(0)}ms decode:${perf.decodeMs.toFixed(0)}ms encode:${perf.encodeMs.toFixed(0)}ms)`);
          if (totalMs > 0) {
            publishSegmentStat({
              totalMs,
              segDurMs: perf.segDurMs,
              speedX: perf.segDurMs / totalMs,
              frames: perf.frames,
              width: perf.width,
              height: perf.height,
            });
          }
        }
        const pending = this._pendingResolves.get(id);
        if (!pending) break;
        this._pendingResolves.delete(id);

        // Capture init result from first transcode
        if (msg.initSegment && !this._initResult) {
          this._initResult = {
            initSegment: new Uint8Array(msg.initSegment as ArrayBuffer),
            codec: (msg.codec as string) || "avc1.640033",
          };
        }

        const h264 = msg.h264 ? new Uint8Array(msg.h264 as ArrayBuffer) : null;
        pending.resolve(h264);
        break;
      }

      case "error": {
        const id = msg.id as number;
        const pending = this._pendingResolves.get(id);
        if (pending) {
          this._pendingResolves.delete(id);
          pending.reject(new Error(msg.message as string));
          break;
        }
        const prepareInitPending = this._pendingPrepareInit.get(id);
        if (prepareInitPending) {
          this._pendingPrepareInit.delete(id);
          prepareInitPending.reject(new Error(msg.message as string));
          break;
        }
        if (id === -1 && !this._initParsed) {
          // Error during processInitSegment in worker — reject the awaited promise
          // to unblock processNext (otherwise it awaits forever)
          this._initParsedReject(new Error(msg.message as string));
        } else {
          log.error(msg.message);
        }
        break;
      }

      case "aborted":
        // Worker re-created transcoder and finished init — unblock waitReady()
        this._ready = true;
        this._readyResolve();
        break;
    }
  }
}

// Classic Workers refuse cross-origin scripts even with CORS headers.
// When workerUrl is cross-origin we fetch its source and wrap it in a
// same-origin blob URL so `new Worker(...)` accepts it.
async function loadWorker(workerUrl: string): Promise<Worker> {
  const sameOrigin =
    typeof location === "undefined" ||
    new URL(workerUrl, location.href).origin === location.origin;
  if (sameOrigin) return new Worker(workerUrl);
  const code = await (await fetch(workerUrl)).text();
  const blobUrl = URL.createObjectURL(
    new Blob([code], { type: "application/javascript" }),
  );
  return new Worker(blobUrl);
}
