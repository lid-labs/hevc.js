/**
 * MSE Intercept — Patches MediaSource to transparently transcode HEVC → H.264.
 *
 * Creates a proxy SourceBuffer that:
 * 1. Reports updating=true while transcoding is in progress (blocks dash.js)
 * 2. Fires proper updatestart/update/updateend events after transcoding
 * 3. Passes audio and other non-HEVC tracks through untouched
 */

import { hevcMimeToH264Codec } from "./codec-mapping.js";
import { log, setLogLevel } from "./log.js";
import type { LogLevel } from "./log.js";
import { SegmentTranscoder } from "./segment-transcoder.js";
import type { SegmentTranscoderConfig } from "./segment-transcoder.js";
import { isSelfContainedSegment } from "./segment-random-access.js";
import { TranscodePool, recommendedPoolSize } from "./transcode-pool.js";

const HEVC_DETECT_RE = /hev1|hvc1/i;                // Detect HEVC in a string
// Match one HEVC codec string (hev1.2.4.L123.B0). The `[^"',]*` stops at a
// comma as defense-in-depth: `isMuxedHevcMime` already gates both .replace()
// call sites, so a comma should never reach here — but if extraction ever
// failed, this keeps a stray audio entry out of the substituted mime.
const HEVC_CODEC_RE = /hev1[^"',]*|hvc1[^"',]*/gi;
// timestampOffset jump below which a write is routine alignment, not a seek
const TS_OFFSET_FLUSH_THRESHOLD_S = 0.5;
// Codec-string prefixes for audio codecs seen alongside HEVC in HLS/DASH.
const AUDIO_CODEC_PREFIXES = ["mp4a", "ac-3", "ec-3", "opus", "mp3", "alac", "flac", "vorbis"];

/**
 * Detect a muxed audio+video HEVC mime — an HEVC codec AND an audio codec in
 * the same codecs list (e.g. `video/mp4; codecs="hvc1...,mp4a.40.2"`).
 * The MSE intercept uses this to route such a SourceBuffer through the
 * two-track path (transcode video, pass audio through, re-mux both); the
 * Shaka transmuxer uses it to report muxed mimes unsupported (not wired
 * there yet).
 *
 * Requires an actual audio codec, not just a second entry: a video-only
 * multi-codec list (e.g. Dolby Vision `dvh1...,hvc1...`) is not "muxed A/V"
 * and gets the normal treatment (it fails the H.264 probe on its own merits).
 * The unquoted-codecs capture stops at `;` so a trailing mime parameter
 * (`codecs=hvc1...;foo=a,b`) doesn't leak a comma into the check.
 * Exported for tests.
 */
export function isMuxedHevcMime(mimeType: string): boolean {
  if (!HEVC_DETECT_RE.test(mimeType)) return false;
  const m = /codecs\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(mimeType);
  const list = (m?.[1] ?? m?.[2] ?? "").split(",").map((c) => c.trim().toLowerCase());
  const hasHevc = list.some((c) => c.startsWith("hev1") || c.startsWith("hvc1"));
  const hasAudio = list.some((c) => AUDIO_CODEC_PREFIXES.some((a) => c.startsWith(a)));
  return hasHevc && hasAudio;
}

/**
 * The MSE constructor available in this browser: classic `MediaSource`,
 * `ManagedMediaSource` (the only one on iPhone Safari, iOS 17.1+), or null.
 */
export function getMediaSourceConstructor(): typeof MediaSource | null {
  const g = globalThis as Record<string, unknown>;
  return (
    (g.MediaSource as typeof MediaSource | undefined) ??
    (g.ManagedMediaSource as typeof MediaSource | undefined) ??
    null
  );
}

export interface MSEInterceptConfig extends SegmentTranscoderConfig {
  /** URL to the transcode worker script. When provided, transcoding runs off main thread. */
  workerUrl?: string;
  /** Called when video transcoding starts — use to pause player buffering. */
  onTranscodeStart?: () => void;
  /** Called when video transcoding ends — use to resume player buffering. */
  onTranscodeEnd?: () => void;
  /**
   * Only fire updateend for a media append once transcoded data has actually
   * reached the SourceBuffer (first chunk). Required for hls.js, whose
   * watchdog flags updateend without buffered-range growth as
   * `bufferAppendNoProgress`. Default false: dash.js relies on the eager
   * release to create its audio SourceBuffer during video transcode.
   *
   * Throughput trade-off: since the player only hands over the next segment
   * after updateend, strict mode limits pipeline overlap to the tail of the
   * current segment (chunks after the first) instead of a full segment.
   */
  strictAppendProgress?: boolean;
  /**
   * How many transcode workers may run at once, each with its own WASM decoder
   * and DPB. Segments are still appended in order; what overlaps is their
   * transcoding, which is what lets a player buffer ahead on hardware that
   * transcodes below real time. Only a segment that starts on an IDR or a BLA
   * is handed to a second worker — an open-GOP segment stays on the worker that
   * decoded its predecessor, whose DPB holds the pictures its leading pictures
   * reference. Default: 2 from four hardware threads up, 1 below. 1 transcodes
   * one segment at a time, as before this option existed.
   */
  poolSize?: number;
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

  // iPhone Safari only exposes ManagedMediaSource; the transcoding proxy
  // requires classic MSE. No-op instead of throwing a ReferenceError.
  if (typeof MediaSource === "undefined") {
    log.warn("MediaSource is not available in this browser — MSE intercept not installed");
    return;
  }

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
      // Map the HEVC codec to H.264, keeping any audio codec in the list
      // (muxed A/V, e.g. "hvc1...,mp4a..." → "avc1...,mp4a...").
      const h264Codec = hevcMimeToH264Codec(mimeType);
      const h264Mime = mimeType.replace(HEVC_CODEC_RE, h264Codec);
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
        const h264Codec = hevcMimeToH264Codec(cfg.video.contentType);
        const h264Type = cfg.video.contentType.replace(HEVC_CODEC_RE, h264Codec);
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

    const muxed = isMuxedHevcMime(mimeType);
    const h264Codec = hevcMimeToH264Codec(mimeType);
    // Muxed A/V: advertise the combined H.264 + AAC mime so the real
    // SourceBuffer accepts the two-track segments the transcoder produces.
    const h264Mime = muxed
      ? `video/mp4; codecs="${h264Codec},mp4a.40.2"`
      : `video/mp4; codecs="${h264Codec}"`;
    log.info(`addSourceBuffer("${mimeType}") → creating ${muxed ? "A/V" : "H.264"} proxy with ${h264Mime}`);
    const realSB = originalAddSourceBuffer.call(this, h264Mime);

    return createTranscodingProxy(realSB, interceptState!.config, muxed);
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
 * Decide whether a timestampOffset write means "the player repositioned
 * without calling abort" (→ flush the transcode pipeline) or is a routine
 * write that must pass through. Exported for unit tests.
 *
 * A flush is warranted only when ALL hold:
 *  - the jump is large (small deltas are per-append alignment writes);
 *  - segments are QUEUED behind the current one — they were handed over
 *    for the old position and would land misplaced. The segment currently
 *    mid-transcode is deliberately not a trigger: hls.js executes the next
 *    buffer operation synchronously from our updateend dispatch, so
 *    `processing` is still true at that point and using it would flush on
 *    every routine op-boundary offset write;
 *  - a first init segment has been parsed (before that, playback hasn't
 *    started — the write is the player mapping media time to presentation
 *    time, and flushing would discard the queued init).
 *
 * dash.js is unaffected by the narrower trigger: it calls abort() on seek,
 * which flushes the pipeline through the abort patch — this trap only backs
 * up players that reposition without aborting.
 */
export function shouldFlushOnTimestampOffset(
  delta: number,
  hasQueuedSegments: boolean,
  initParsed: boolean,
): boolean {
  return Math.abs(delta) >= TS_OFFSET_FLUSH_THRESHOLD_S && hasQueuedSegments && initParsed;
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
/** One segment handed to the pool, and the chunks it has produced so far. */
interface InFlightSegment {
  /** Chunks emitted by the worker and not yet appended. */
  pending: { h264: Uint8Array; initSeg: Uint8Array | null }[];
  /** The worker has finished with this segment, successfully or not. */
  done: boolean;
  error: unknown;
  /** Resolves the appender's wait when a chunk lands or the transcode ends. */
  wake: (() => void) | null;
  /** The abort generation this segment belongs to. */
  generation: number;
  bytes: number;
}

function createTranscodingProxy(
  realSB: SourceBuffer,
  config: MSEInterceptConfig,
  muxed = false,
): SourceBuffer {
  // Muxed A/V goes through the main-thread transcoder: audio pass-through +
  // two-track muxing isn't in the worker protocol, and the transcoder's
  // combined-segment path (processMediaSegment) is non-streaming anyway.
  // Video-only keeps the worker fast path when workerUrl is set.
  const useWorker = !!config.workerUrl && !muxed;
  let pool: TranscodePool | null = null;
  let transcoder: SegmentTranscoder | null = null;

  let initParsed = false;
  let initAppended = false;
  let lastInitSegment: Uint8Array | null = null; // tracks current H.264 init to detect changes
  let fakeUpdating = false;
  const queue: Uint8Array[] = [];
  /**
   * Segments being transcoded, in the order they must reach the SourceBuffer.
   * The pool transcodes several at once; MSE appends stay sequential, so a
   * segment that finishes early waits here with its chunks until its turn.
   */
  const inFlight: InFlightSegment[] = [];
  let transcodesRunning = 0;
  /**
   * An init segment is being parsed. `initParsed` only flips once that finishes,
   * so without this flag the dispatch from `appendBuffer` would hand a media
   * segment to a transcoder mid-initialisation — and on the main-thread path
   * there is one transcoder, so that is a reentrant call on the instance that is
   * parsing the parameter sets.
   */
  let initializing = false;
  let processing = false;
  let abortGeneration = 0; // incremented on abort — lets processNext detect stale runs
  let cachedInitData: Uint8Array | null = null; // cached for re-send after no-abort seek

  // Pipeline overlap: max segments queued before backpressure blocks dash.js.
  // At 2, dash.js can prefetch the next segment while we transcode the current one.
  // Beyond 2, we block to avoid unbounded memory growth (especially 4K).
  const MAX_QUEUE_BEFORE_BACKPRESSURE = 2;

  const poolSize = config.poolSize ?? recommendedPoolSize();
  if (useWorker) {
    pool = new TranscodePool({
      workerUrl: config.workerUrl!,
      wasmUrl: config.wasmUrl,
      wasmBinaryUrl: config.wasmBinaryUrl,
      fps: config.fps,
      bitrate: config.bitrate,
      poolSize,
    });
    pool.waitReady().then(() => {
      log.info(`Worker transcoder ready (pool of up to ${pool!.maxSize})`);
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
    log.debug(`dispatch "${type}" (listeners: ${listeners.get(type)?.size ?? 0}, queue: ${queue.length}, processing: ${processing})`);
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
      log.debug(`appendBuffer(${bytes.byteLength}B) queued (queue: ${queue.length})`);
      queue.push(bytes);
      // processNext is busy appending the segment at the head of the pool, and
      // will not look at the queue again until that one is done. Hand this
      // segment to a free worker now, which is where the overlap comes from.
      dispatchMore();

      fakeUpdating = true;
      dispatchOnSB("updatestart");

      // Release backpressure immediately if queue is shallow enough.
      // strictAppendProgress defers the release to the first transcoded
      // chunk (or queue drain) so updateend implies real buffered growth.
      if (queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE && !config.strictAppendProgress) {
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
      inFlight.length = 0;
      if (pool) pool.abort();
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

  // Patch changeType() — hls.js queues it on codec switches with the HEVC
  // mime (e.g. `video/mp4;codecs=hvc1.1.6.L120.90`). Passing that through
  // would throw NotSupportedError on any browser without native HEVC.
  // changeType is synchronous — no updateend to relay.
  const realChangeType = (realSB as SourceBuffer & { changeType?: (type: string) => void })
    .changeType?.bind(realSB);
  if (realChangeType) {
    Object.defineProperty(realSB, "changeType", {
      value: function (mimeType: string): void {
        if (HEVC_DETECT_RE.test(mimeType)) {
          const h264Mime = `video/mp4; codecs="${hevcMimeToH264Codec(mimeType)}"`;
          log.debug(`changeType("${mimeType}") → "${h264Mime}"`);
          realChangeType(h264Mime);
          return;
        }
        realChangeType(mimeType);
      },
      writable: true, configurable: true,
    });
  }

  // Intercept 'updating' getter — include our fake state
  Object.defineProperty(realSB, "updating", {
    get() { return fakeUpdating || updatingGetter.call(realSB); },
    configurable: true,
  });

  // Intercept timestampOffset setter — a large jump while segments are in
  // flight means the player repositioned (seek without abort): flush.
  // Not a seek: small alignment deltas (hls.js >=1.6.6 writes them in its
  // nominal append path, tolerance 1e-6) and the initial offset written
  // before the first init segment is parsed (e.g. a media playlist starting
  // at EXT-X-MEDIA-SEQUENCE > 0 maps media time to presentation 0).
  const tsOffsetDesc = Object.getOwnPropertyDescriptor(SourceBuffer.prototype, "timestampOffset");
  Object.defineProperty(realSB, "timestampOffset", {
    get() { return tsOffsetDesc!.get!.call(realSB); },
    set(value: number) {
      const old = tsOffsetDesc!.get!.call(realSB);
      if (shouldFlushOnTimestampOffset(value - old, queue.length > 0, initParsed)) {
        log.debug(`timestampOffset changed (${old} → ${value}) — flushing queue`);
        abortGeneration++;
        queue.length = 0;
        inFlight.length = 0;
        processing = false;
        initParsed = false;
        initAppended = false;
        if (pool) pool.abort();
        if (fakeUpdating) {
          fakeUpdating = false;
          dispatchOnSB("update");
          dispatchOnSB("updateend");
        }
      } else if (value !== old) {
        log.debug(`timestampOffset ${old} → ${value} (pass-through)`);
      }
      tsOffsetDesc!.set!.call(realSB, value);
    },
    configurable: true,
  });

  // Unified transcode interface — works with both Worker and main-thread
  async function transcodeInit(segment: Uint8Array): Promise<void> {
    if (pool) {
      await pool.waitReady();
      await pool.processInitSegment(segment);
    } else {
      while (!transcoder!.isInitialized) await new Promise(r => setTimeout(r, 10));
      await transcoder!.processInitSegment(segment);
    }
  }

  async function transcodeMediaStreaming(
    segment: Uint8Array,
    selfContained: boolean,
    onPartial: (h264: Uint8Array, initSegment: Uint8Array | null, codec: string | null) => Promise<void> | void,
  ): Promise<void> {
    if (pool) {
      return pool.processMediaSegmentStreaming(segment, onPartial, { selfContained });
    }
    return transcoder!.processMediaSegmentStreaming(segment, (h264, init) => {
      return onPartial(h264, init?.initSegment ?? null, init?.codec ?? null);
    });
  }

  /**
   * Hand a segment to the pool and record its place in the append order. The
   * transcode runs on its own; `appendHead` consumes the chunks in turn.
   */
  function startTranscode(segment: Uint8Array, generation: number, selfContained: boolean): void {
    const rec: InFlightSegment = {
      pending: [], done: false, error: null, wake: null, generation,
      bytes: segment.byteLength,
    };
    inFlight.push(rec);
    // The callbacks bracket transcoding as a whole, not each segment: with
    // several in flight, a player told to resume at the first completion would
    // resume while the others are still running.
    if (transcodesRunning++ === 0) config.onTranscodeStart?.();
    log.debug(`Transcoding segment (${segment.byteLength}B) [streaming${selfContained ? "" : ", open GOP"}]...`);
    const wake = () => { const w = rec.wake; rec.wake = null; w?.(); };
    transcodeMediaStreaming(segment, selfContained, (h264, initSeg) => {
      rec.pending.push({ h264, initSeg });
      wake();
    }).then(() => { rec.done = true; }, (err) => { rec.error = err; rec.done = true; })
      .then(() => {
        if (--transcodesRunning === 0) config.onTranscodeEnd?.();
        wake();
      });
  }

  /**
   * Fill the pool from the queue. Stops at an init segment, which is a barrier:
   * it re-initialises the workers, so the segments in flight — belonging to the
   * previous representation — have to be appended first.
   */
  function dispatchMore(): void {
    // Without the pool, transcoding runs on one main-thread SegmentTranscoder,
    // which holds one decoder and one encoder: two overlapping calls would
    // interleave on the same state. One segment at a time there.
    const lookahead = pool ? Math.max(1, poolSize) : 1;
    while (inFlight.length < lookahead && queue.length > 0) {
      const next = queue[0]!;
      if (initializing || !initParsed || isInitSegment(next) || muxed) return;
      // Read before the buffer is transferred to the worker.
      const selfContained = isSelfContainedSegment(next);
      // An open-GOP segment has to be decoded by the worker that decoded its
      // predecessor, whose DPB holds the pictures its leading pictures
      // reference. Dispatching it alongside others would leave which worker
      // takes it to the order the pool happens to hand slots out, so it is a
      // barrier both ways: it waits for the segments in flight, and nothing is
      // dispatched after it until it is done.
      if (!selfContained && inFlight.length > 0) return;
      queue.shift();
      startTranscode(next, abortGeneration, selfContained);
      if (!selfContained) return;
    }
  }

  async function processNext(target: SourceBuffer): Promise<void> {
    if (processing) return;
    processing = true;
    const myGeneration = abortGeneration;

    try {
      while (queue.length > 0 || inFlight.length > 0) {
        if (abortGeneration !== myGeneration) return; // aborted — exit silently

        // Keep the pool fed before appending, so the next segments transcode
        // while the current one is being appended.
        dispatchMore();

        // A segment in flight owns the next append slot.
        if (inFlight.length > 0) {
          await appendHead(target, myGeneration);
          continue;
        }

        // Nothing in flight: what is at the head of the queue needs the serial
        // path — an init segment, or muxed A/V on the main-thread transcoder.
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
          initializing = true;
          try {
            await transcodeInit(initData);
          } finally {
            initializing = false;
          }
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
          // initParsed is now true: this segment is media, and goes through
          // the pool like any other.
          if (!muxed) {
            startTranscode(segment, myGeneration, isSelfContainedSegment(segment));
            continue;
          }
        }

        // Muxed A/V: non-streaming path — the main-thread transcoder returns
        // one combined H.264+AAC segment (audio passed through). Append the
        // two-track init on first, then the combined segment as one chunk.
        if (muxed) {
          log.debug(`Transcoding segment (${segment.byteLength}B) [muxed A/V]...`);
          config.onTranscodeStart?.();
          const combined = await transcoder!.processMediaSegment(segment);
          config.onTranscodeEnd?.();
          if (abortGeneration !== myGeneration) return;

          if (!initAppended) {
            const init = transcoder!.initResult;
            if (init) {
              initAppended = true;
              lastInitSegment = init.initSegment;
              if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
              if (abortGeneration !== myGeneration) return;
              realAppend(init.initSegment.buffer as ArrayBuffer);
              await waitForRealUpdateEnd();
              if (abortGeneration !== myGeneration) return;
              log.debug("A/V init segment appended");
            }
          }

          if (combined) {
            if (updatingGetter.call(realSB)) await waitForRealUpdateEnd();
            if (abortGeneration !== myGeneration) return;
            realAppend(combined.buffer as ArrayBuffer);
            await waitForRealUpdateEnd();
          }

          if (fakeUpdating) {
            fakeUpdating = false;
            dispatchOnSB("update");
            dispatchOnSB("updateend");
          }
          continue;
        }

        // Media segment with the pool available: dispatch it and let the
        // appender take it in turn.
        startTranscode(segment, myGeneration, isSelfContainedSegment(segment));
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

  /**
   * Append the chunks of the segment whose turn it is, as the worker emits
   * them, and wait on it until it is finished. Chunks of the segments behind it
   * pile up in their own records meanwhile; this is what keeps the SourceBuffer
   * in segment order while several transcodes overlap.
   */
  async function appendHead(target: SourceBuffer, myGeneration: number): Promise<void> {
    const rec = inFlight[0]!;
    let chunkCount = 0;
    let firstChunkEmitted = false;

    for (;;) {
      if (abortGeneration !== myGeneration) return;
      if (rec.pending.length === 0) {
        if (rec.done) break;
        // The producer resolves this when a chunk lands or it finishes. Setting
        // the resolver happens synchronously after the emptiness check, so no
        // chunk can slip in between the two.
        await new Promise<void>((resolve) => { rec.wake = resolve; });
        continue;
      }

      const { h264, initSeg } = rec.pending.shift()!;

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

      // Release backpressure after first chunk (player sees content faster).
      // In strict mode this is THE acknowledgment of the current segment's
      // append — data from this very segment is now buffered, so the player's
      // progress watchdog is satisfied — and it fires regardless of queue depth.
      if (!firstChunkEmitted) {
        firstChunkEmitted = true;
        if (fakeUpdating &&
            (config.strictAppendProgress || queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE)) {
          fakeUpdating = false;
          dispatchOnSB("update");
          dispatchOnSB("updateend");
        }
      }
    }

    inFlight.shift();
    if (abortGeneration !== myGeneration) return;
    // The transcode failed: raise it where the serial path used to, so the
    // handler that dispatches "error" on the SourceBuffer still sees it.
    if (rec.error) throw rec.error;

    const buffered = target.buffered;
    const end = buffered.length ? buffered.end(buffered.length - 1).toFixed(2) : "0";
    log.debug(`Streaming done (${chunkCount} chunks, ${rec.bytes}B in), buffered: ${end}s, in flight: ${inFlight.length}`);

        // Release backpressure if queue dropped below threshold.
        // Guard: fakeUpdating may already be false (released in appendBuffer).
        // Skipped in strict mode: a pending fakeUpdating here belongs to the
        // NEXT queued segment — acknowledging it off the back of THIS
        // segment's completion is exactly the misaligned updateend the mode
        // exists to prevent. Its ack comes from its own first chunk.
    if (fakeUpdating && !config.strictAppendProgress &&
        queue.length < MAX_QUEUE_BEFORE_BACKPRESSURE) {
      fakeUpdating = false;
      dispatchOnSB("update");
      dispatchOnSB("updateend");
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
