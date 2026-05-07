/**
 * MSE Intercept — Patches MediaSource to transparently transcode HEVC → H.264.
 *
 * Creates a proxy SourceBuffer that:
 * 1. Reports updating=true while transcoding is in progress (blocks dash.js)
 * 2. Fires proper updatestart/update/updateend events after transcoding
 * 3. Passes audio and other non-HEVC tracks through untouched
 */

import { log, setLogLevel } from "./log.js";
import type { LogLevel } from "./log.js";
import { SegmentTranscoder } from "./segment-transcoder.js";
import type { SegmentTranscoderConfig } from "./segment-transcoder.js";
import { TranscodeWorkerClient } from "./transcode-worker-client.js";

const HEVC_DETECT_RE = /hev1|hvc1/i;                // Detect HEVC in a string
const HEVC_CODEC_RE = /hev1[^"']*|hvc1[^"']*/gi;   // Match full HEVC codec string (hev1.2.4.L123.B0)
const H264_CODEC = "avc1.640033";                    // High Profile Level 5.1 — supports up to 4K

export interface MSEInterceptConfig extends SegmentTranscoderConfig {
  /** URL to the transcode worker script. When provided, transcoding runs off main thread. */
  workerUrl?: string;
  /** Called when video transcoding starts — use to pause player buffering. */
  onTranscodeStart?: () => void;
  /** Called when video transcoding ends — use to resume player buffering. */
  onTranscodeEnd?: () => void;
  /** Log verbosity: 'debug' | 'info' | 'warn' (default) | 'error' | 'silent'. */
  logLevel?: LogLevel;
}

interface InterceptState {
  active: boolean;
  originalAddSourceBuffer: typeof MediaSource.prototype.addSourceBuffer;
  originalIsTypeSupported: typeof MediaSource.isTypeSupported;
  originalDecodingInfo: ((config: MediaDecodingConfiguration) => Promise<MediaCapabilitiesDecodingInfo>) | null;
  config: MSEInterceptConfig;
}

let interceptState: InterceptState | null = null;

/**
 * Install the MSE intercept. Call before dash.js initializes.
 */
export function installMSEIntercept(config: MSEInterceptConfig = {}): void {
  if (config.logLevel) setLogLevel(config.logLevel);

  if (interceptState?.active) {
    // Already installed — update config (allows late-binding of callbacks)
    Object.assign(interceptState.config, config);
    return;
  }

  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  const originalIsTypeSupported = MediaSource.isTypeSupported;
  let originalDecodingInfo: InterceptState["originalDecodingInfo"] = null;

  interceptState = {
    active: true,
    originalAddSourceBuffer,
    originalIsTypeSupported,
    originalDecodingInfo: null,
    config,
  };

  // Patch isTypeSupported
  MediaSource.isTypeSupported = function (mimeType: string): boolean {
    if (HEVC_DETECT_RE.test(mimeType)) {
      const h264Mime = mimeType.replace(HEVC_CODEC_RE, H264_CODEC);
      const result = originalIsTypeSupported.call(MediaSource, h264Mime);
      log.debug(`isTypeSupported("${mimeType}") → "${h264Mime}" → ${result}`);
      return result;
    }
    return originalIsTypeSupported.call(MediaSource, mimeType);
  };

  // Patch navigator.mediaCapabilities.decodingInfo
  if (typeof navigator !== "undefined" && navigator.mediaCapabilities) {
    originalDecodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
    interceptState.originalDecodingInfo = originalDecodingInfo;
    navigator.mediaCapabilities.decodingInfo = async function (cfg: MediaDecodingConfiguration) {
      if (cfg.video?.contentType && HEVC_DETECT_RE.test(cfg.video.contentType)) {
        const h264Type = cfg.video.contentType.replace(HEVC_CODEC_RE, H264_CODEC);
        const h264Config = { ...cfg, video: { ...cfg.video, contentType: h264Type } };
        return originalDecodingInfo!(h264Config);
      }
      return originalDecodingInfo!(cfg);
    };
  }

  // Patch addSourceBuffer — return a proxy that handles transcoding
  MediaSource.prototype.addSourceBuffer = function (mimeType: string): SourceBuffer {
    if (!HEVC_DETECT_RE.test(mimeType)) {
      return originalAddSourceBuffer.call(this, mimeType);
    }

    log.info(`addSourceBuffer("${mimeType}") → creating H.264 proxy`);
    const h264Mime = `video/mp4; codecs="${H264_CODEC}"`;
    const realSB = originalAddSourceBuffer.call(this, h264Mime);

    return createTranscodingProxy(realSB, interceptState!.config);
  };
}

/**
 * Remove the MSE intercept and restore original methods.
 */
export function uninstallMSEIntercept(): void {
  if (!interceptState?.active) return;

  MediaSource.prototype.addSourceBuffer = interceptState.originalAddSourceBuffer;
  MediaSource.isTypeSupported = interceptState.originalIsTypeSupported;
  if (interceptState.originalDecodingInfo && navigator.mediaCapabilities) {
    navigator.mediaCapabilities.decodingInfo = interceptState.originalDecodingInfo;
  }

  interceptState.active = false;
  interceptState = null;
}

/**
 * Create a proxy SourceBuffer that transcodes HEVC→H.264.
 *
 * Key behavior:
 * - appendBuffer() queues data and sets _updating=true immediately
 * - Fires updatestart → (transcode) → update → updateend like a real SB
 * - dash.js sees updating=true and waits, preventing segment flooding
 * - The real SourceBuffer receives H.264 data after transcoding
 */
function createTranscodingProxy(
  realSB: SourceBuffer,
  config: MSEInterceptConfig,
): SourceBuffer {
  // Use Worker when workerUrl is provided, otherwise fall back to main thread
  const useWorker = !!config.workerUrl;
  let workerClient: TranscodeWorkerClient | null = null;
  let transcoder: SegmentTranscoder | null = null;

  let initParsed = false;
  let initAppended = false;
  let lastInitSegment: Uint8Array | null = null; // tracks current H.264 init to detect changes
  let fakeUpdating = false;
  const queue: Uint8Array[] = [];
  let processing = false;
  let abortGeneration = 0; // incremented on abort — lets processNext detect stale runs
  let cachedInitData: Uint8Array | null = null; // cached for re-send after no-abort seek

  // Pipeline overlap: max segments queued before backpressure blocks dash.js.
  // At 2, dash.js can prefetch the next segment while we transcode the current one.
  // Beyond 2, we block to avoid unbounded memory growth (especially 4K).
  const MAX_QUEUE_BEFORE_BACKPRESSURE = 2;

  if (useWorker) {
    workerClient = new TranscodeWorkerClient({
      workerUrl: config.workerUrl!,
      wasmUrl: config.wasmUrl,
      wasmBinaryUrl: config.wasmBinaryUrl,
      fps: config.fps,
      bitrate: config.bitrate,
    });
    workerClient.waitReady().then(() => {
      log.info("Worker transcoder ready");
    }).catch((err) => {
      log.error("Worker init failed:", (err as Error)?.message ?? err);
    });
  } else {
    transcoder = new SegmentTranscoder(config);
    transcoder.init().catch((err) => {
      log.error("Main-thread transcoder init failed:",
        (err as Error)?.message ?? err, (err as Error)?.stack);
    });
  }

  // Event listeners: intercept to control event dispatch timing
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  function dispatchOnSB(type: string): void {
    // Fire to listeners registered via our intercepted addEventListener
    const set = listeners.get(type);
    if (set) {
      const evt = new Event(type);
      for (const fn of set) {
        if (typeof fn === "function") fn.call(realSB, evt);
        else fn.handleEvent(evt);
      }
    }
    // Also fire on* property handler if set
    const onProp = (realSB as any)[`__hevc_on${type}`];
    if (typeof onProp === "function") onProp.call(realSB, new Event(type));
  }

  // Save original methods before monkey-patching
  const realAppend = realSB.appendBuffer.bind(realSB);
  const realAbort = realSB.abort.bind(realSB);
  const realAddEventListener = realSB.addEventListener.bind(realSB);
  const realRemoveEventListener = realSB.removeEventListener.bind(realSB);

  // Internal wait using the real (unpatched) addEventListener
  const updatingGetter = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, "updating")!.get!;
  function waitForRealUpdateEnd(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!updatingGetter.call(realSB)) { resolve(); return; }
      realAddEventListener("updateend", () => resolve(), { once: true });
    });
  }

  // Monkey-patch the real SourceBuffer instance — same object in mediaSource.sourceBuffers
  Object.defineProperty(realSB, "appendBuffer", {
    value: function (data: BufferSource): void {
      const bytes = toUint8Array(data);
      queue.push(bytes);

      fakeUpdating = true;
      dispatchOnSB("updatestart");

      // Release backpressure immediately if queue is shallow enough
      if (queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE) {
        fakeUpdating = false;
        dispatchOnSB("update");
        dispatchOnSB("updateend");
      }

      processNext(realSB);
    },
    writable: true, configurable: true,
  });

  Object.defineProperty(realSB, "abort", {
    value: function (): void {
      abortGeneration++;
      queue.length = 0;
      processing = false;
      fakeUpdating = false;
      initParsed = false;
      initAppended = false;
      if (workerClient) workerClient.abort();
      log.debug("abort() — queue + transcoder reset (gen=" + abortGeneration + ")");
      realAbort();
    },
    writable: true, configurable: true,
  });

  Object.defineProperty(realSB, "addEventListener", {
    value: function (type: string, fn: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    writable: true, configurable: true,
  });

  Object.defineProperty(realSB, "removeEventListener", {
    value: function (type: string, fn: EventListenerOrEventListenerObject): void {
      listeners.get(type)?.delete(fn);
    },
    writable: true, configurable: true,
  });

  // Patch remove() — relay events through our listener map
  const realRemove = realSB.remove.bind(realSB);
  Object.defineProperty(realSB, "remove", {
    value: function (start: number, end: number): void {
      dispatchOnSB("updatestart");
      realRemove(start, end);
      realAddEventListener("updateend", () => {
        dispatchOnSB("update");
        dispatchOnSB("updateend");
      }, { once: true });
    },
    writable: true, configurable: true,
  });

  // Intercept 'updating' getter — include our fake state
  Object.defineProperty(realSB, "updating", {
    get() { return fakeUpdating || updatingGetter.call(realSB); },
    configurable: true,
  });

  // Intercept timestampOffset setter — detect seek (hls.js doesn't call abort)
  const tsOffsetDesc = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, "timestampOffset");
  Object.defineProperty(realSB, "timestampOffset", {
    get() { return tsOffsetDesc!.get!.call(realSB); },
    set(value: number) {
      const old = tsOffsetDesc!.get!.call(realSB);
      if (value !== old && (queue.length > 0 || processing)) {
        log.debug(`timestampOffset changed (${old} → ${value}) — flushing queue`);
        abortGeneration++;
        queue.length = 0;
        processing = false;
        initParsed = false;
        initAppended = false;
        if (workerClient) workerClient.abort();
        if (fakeUpdating) {
          fakeUpdating = false;
          dispatchOnSB("update");
          dispatchOnSB("updateend");
        }
      }
      tsOffsetDesc!.set!.call(realSB, value);
    },
    configurable: true,
  });

  // Unified transcode interface — works with both Worker and main-thread
  async function transcodeInit(segment: Uint8Array): Promise<void> {
    if (workerClient) {
      await workerClient.waitReady();
      await workerClient.processInitSegment(segment);
    } else {
      while (!transcoder!.isInitialized) await new Promise(r => setTimeout(r, 10));
      await transcoder!.processInitSegment(segment);
    }
  }

  async function transcodeMedia(segment: Uint8Array): Promise<Uint8Array | null> {
    if (workerClient) {
      return workerClient.processMediaSegment(segment);
    }
    return transcoder!.processMediaSegment(segment);
  }

  async function transcodeMediaStreaming(
    segment: Uint8Array,
    onPartial: (h264: Uint8Array, initSegment: Uint8Array | null, codec: string | null) => Promise<void> | void,
  ): Promise<void> {
    if (workerClient) {
      return workerClient.processMediaSegmentStreaming(segment, onPartial);
    }
    return transcoder!.processMediaSegmentStreaming(segment, (h264, init) => {
      return onPartial(h264, init?.initSegment ?? null, init?.codec ?? null);
    });
  }

  function getInitResult(): { initSegment: Uint8Array; codec: string } | null {
    if (workerClient) return workerClient.initResult;
    return transcoder!.initResult;
  }

  async function processNext(target: SourceBuffer): Promise<void> {
    if (processing) return;
    processing = true;
    const myGeneration = abortGeneration;

    try {
      while (queue.length > 0) {
        if (abortGeneration !== myGeneration) return; // aborted — exit silently

        const segment = queue.shift()!;

        // Wait for real SB to be ready
        if (updatingGetter.call(realSB)) {
          await waitForRealUpdateEnd();
          if (abortGeneration !== myGeneration) return;
        }

        // Detect init segment by ftyp/moov box signature.
        // Handles both first-time init AND re-sent init after seek (no-abort case).
        const isInit = isInitSegment(segment);

        if (isInit || !initParsed) {
          const initData = isInit ? segment : cachedInitData;
          if (!initData) {
            log.error("No init segment available — cannot process media");
            continue;
          }

          // Cache init data before transcodeInit (which transfers/detaches the buffer)
          cachedInitData = new Uint8Array(initData);

          // (Re-)parse init segment in worker/transcoder
          await transcodeInit(initData);
          if (abortGeneration !== myGeneration) return;
          initParsed = true;
          // Reset initAppended — after a new init, we need a fresh H.264 init
          initAppended = false;
          log.debug("Init segment parsed");

          if (isInit) {
            // Release backpressure — init-only append, no media to transcode
            if (fakeUpdating) {
              fakeUpdating = false;
              dispatchOnSB("update");
              dispatchOnSB("updateend");
            }
            continue;
          }
          // Fall through: initParsed is now true, process this segment as media below
        }

        // Media segment: streaming transcode (partial chunks emitted incrementally)
        log.debug(`Transcoding segment (${segment.byteLength}B) [streaming]...`);
        config.onTranscodeStart?.();
        let chunkCount = 0;
        let firstChunkEmitted = false;

        await transcodeMediaStreaming(segment, async (h264, initSeg, _codec) => {
          if (abortGeneration !== myGeneration) return;

          // Append init segment on first chunk that carries it
          if (initSeg && !initAppended) {
            initAppended = true;
            lastInitSegment = initSeg;
            if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
            if (abortGeneration !== myGeneration) return;
            realAppend(initSeg.buffer as ArrayBuffer);
            await waitForRealUpdateEnd();
            if (abortGeneration !== myGeneration) return;
            log.debug("H.264 init segment appended [streaming]");
          }

          // Append partial H.264 segment
          if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
          if (abortGeneration !== myGeneration) return;
          realAppend(h264.buffer as ArrayBuffer);
          await waitForRealUpdateEnd();
          chunkCount++;

          // Release backpressure after first chunk (player sees content faster)
          if (!firstChunkEmitted) {
            firstChunkEmitted = true;
            if (fakeUpdating && queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE) {
              fakeUpdating = false;
              dispatchOnSB("update");
              dispatchOnSB("updateend");
            }
          }
        });

        config.onTranscodeEnd?.();
        if (abortGeneration !== myGeneration) return;

        const buffered = target.buffered;
        const end = buffered.length ? buffered.end(buffered.length - 1).toFixed(2) : "0";
        log.debug(`Streaming done (${chunkCount} chunks), buffered: ${end}s`);

        // Release backpressure if queue dropped below threshold.
        // Guard: fakeUpdating may already be false (released in appendBuffer).
        if (fakeUpdating && queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE) {
          fakeUpdating = false;
          dispatchOnSB("update");
          dispatchOnSB("updateend");
        }
      }
    } catch (err) {
      if (abortGeneration !== myGeneration) return; // aborted — swallow error
      log.error("Transcoding error:",
        (err as Error)?.message ?? err, (err as Error)?.stack);
      fakeUpdating = false;
      dispatchOnSB("error");
    } finally {
      if (abortGeneration === myGeneration) {
        processing = false;
        // Ensure player is unblocked when queue drains
        if (fakeUpdating) {
          fakeUpdating = false;
          dispatchOnSB("update");
          dispatchOnSB("updateend");
        }
      }
    }
  }

  return realSB;
}

/**
 * Detect fMP4 init segment by scanning for 'ftyp' or 'moov' box type
 * in the first 8 bytes (box header: 4-byte size + 4-byte type).
 */
function isInitSegment(data: Uint8Array): boolean {
  if (data.byteLength < 8) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const boxType = view.getUint32(4);
  // 'ftyp' = 0x66747970, 'moov' = 0x6D6F6F76
  return boxType === 0x66747970 || boxType === 0x6D6F6F76;
}

function toUint8Array(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data as ArrayBuffer);
}
