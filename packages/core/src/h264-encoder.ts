/**
 * H264Encoder — Wraps WebCodecs VideoEncoder to transcode YUV frames to H.264.
 *
 * Pipeline: HEVCFrame (Uint16Array YUV planes) → VideoFrame(I420) → VideoEncoder → EncodedVideoChunk
 */

import type { HEVCFrame } from "./types.js";

export interface H264EncoderConfig {
  width: number;
  height: number;
  fps?: number;
  bitrate?: number;
}

/** Latency mode an encoder ended up configured with. */
export type LatencyMode = (typeof LATENCY_MODES)[number];

export interface EncodedChunk {
  data: Uint8Array;
  timestamp: number;
  duration: number;
  isKeyframe: boolean;
}

/**
 * Pick an appropriate H.264 codec string based on resolution.
 * Baseline L3.1 caps at 720p — higher resolutions need higher levels.
 */
function pickH264Codec(w: number, h: number): string {
  const pixels = w * h;
  if (pixels > 2073600) return "avc1.640033"; // > 1080p → High 5.1 (4K)
  if (pixels > 921600)  return "avc1.64002a"; // > 720p  → High 4.2 (1080p)
  return "avc1.640028";                        // ≤ 720p  → High 4.0
}

/**
 * Tried in this order. `realtime` is what a live transcode wants; `quality`
 * is the fallback, and the two configs differ by `latencyMode` alone.
 *
 * Why trying has to be asynchronous. Measured in a worker with the config
 * `buildEncoderConfig()` produces, at 720p, 1080p and 4K alike, on an Apple
 * M4 Pro / macOS 27.2.1, 2026-11-14:
 *
 * - Chrome 157 encodes in both modes, which is why `realtime` stays first.
 * - Zen 1.24.1b (Gecko 159) refuses `realtime` *asynchronously*:
 *   `isConfigSupported()` answers `true`, `configure()` does not throw, the
 *   state is `configured` — and then the encoder closes, the `error` callback
 *   receives `EncodingError: The given encoding is not supported.`, and no
 *   chunk ever comes out. An empty `flush()` right after `configure()` is
 *   what sees it: it rejects for the refused mode and resolves for the
 *   viable one, without encoding a frame. #406, reported in #399 by @uplg,
 *   who measured the same on an M1 Max and on Playwright's Firefox 159.
 *
 * So no synchronous check can choose the mode — `validateLatencyModes()`
 * does, and the constructor skips what it refused. A user-agent test could
 * not stand in for it either: the Zen measured reports `Firefox/159.0`, a
 * string that names no fork, so it cannot be told apart from the Gecko
 * builds nobody here has measured.
 */
const LATENCY_MODES = ["realtime", "quality"] as const;

/** Resolution `checkSupport()` probes when the caller does not know one yet. */
const PROBE_WIDTH = 1280;
const PROBE_HEIGHT = 720;

/**
 * Latency modes this realm's backend refused, and the validation that fills
 * it. Refusal is taken as a property of the backend rather than of the
 * resolution: Gecko refuses `realtime` at 720p, 1080p and 4K alike and
 * Chrome accepts it at all three (#406), so one validation answers for every
 * codec string `pickH264Codec()` can build. A validation at 720p does
 * therefore commit the higher profiles — that is the assumption it rests on,
 * not a measurement of each.
 *
 * Per realm, because the encoder lives in the transcode worker while the
 * plugins' `checkSupport()` runs on the main thread: each realm primes its
 * own memo from its async entry points.
 */
const refusedLatencyModes = new Set<LatencyMode>();
let latencyValidation: Promise<LatencyMode | null> | null = null;

/**
 * Drop the memo. A test seam — the validation is per realm and a realm lasts
 * a whole test file, so a test cannot otherwise validate against a second
 * backend. Deliberately not re-exported from the package's entry point.
 */
export function __resetLatencyValidation(): void {
  refusedLatencyModes.clear();
  latencyValidation = null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Does this configuration actually encode? `configure()` returning is not an
 * answer (see LATENCY_MODES); the empty `flush()` is, and it costs no frame.
 *
 * Everything is caught: this feeds a memoised promise, and a rejection there
 * would be remembered for the lifetime of the realm.
 */
async function probeLatencyMode(config: VideoEncoderConfig): Promise<boolean> {
  let callbackError: Error | null = null;
  let encoder: VideoEncoder | null = null;
  try {
    encoder = new VideoEncoder({
      output: () => { /* nothing is encoded here */ },
      error: (e) => { callbackError = e as Error; },
    });
    encoder.configure(config);
    await encoder.flush();
    return encoder.state === "configured" && callbackError === null;
  } catch {
    return false;
  } finally {
    // The probe encoder is a throwaway either way; a refusal may have closed
    // it already.
    try { encoder?.close(); } catch { /* already closed */ }
  }
}

/**
 * The single description of this encoder. `checkSupport()` and `configure()`
 * both go through it, so the probe can no longer answer for a configuration
 * the encoder never uses — which is what let the plugins report encoding as
 * available and then throw on the first segment (#380).
 */
function buildEncoderConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number | undefined,
  latencyMode: (typeof LATENCY_MODES)[number],
): VideoEncoderConfig {
  return {
    codec: pickH264Codec(width, height),
    width,
    height,
    bitrate: bitrate ?? width * height * fps * 0.1, // ~0.1 bpp
    framerate: fps,
    hardwareAcceleration: "no-preference",
    latencyMode,
    avc: { format: "avc" },
  };
}

export class H264Encoder {
  private _encoder: VideoEncoder;
  private _width: number;
  private _height: number;
  private _fps: number;
  private _latencyMode: LatencyMode;
  private _codecDescription: Uint8Array | null = null;
  /** Set by the encoder's error callback; surfaced by flush() and encode(). */
  private _error: Error | null = null;

  /** Callback invoked for each encoded chunk */
  onChunk: ((chunk: EncodedChunk) => void) | null = null;

  /** Callback invoked when codec description (avcC) is available */
  onCodecDescription: ((desc: Uint8Array) => void) | null = null;

  constructor(config: H264EncoderConfig) {
    this._width = config.width;
    this._height = config.height;
    this._fps = config.fps ?? 25;

    let chosen: { encoder: VideoEncoder; latencyMode: LatencyMode } | null = null;
    const failures: string[] = [];

    // What validateLatencyModes() refused is not retried: its refusals are
    // the ones a synchronous configure() cannot see.
    for (const latencyMode of LATENCY_MODES.filter((m) => !refusedLatencyModes.has(m))) {
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => this._handleOutput(chunk, metadata),
        // Never throw from here: this runs as a browser task, outside any
        // catchable stack, which is what made #406 a dead stream instead of a
        // fallback. flush() surfaces it.
        error: (e) => { this._error = e as Error; },
      });
      try {
        encoder.configure(
          buildEncoderConfig(this._width, this._height, this._fps, config.bitrate, latencyMode),
        );
        chosen = { encoder, latencyMode };
        break;
      } catch (error) {
        failures.push(`${latencyMode} — ${describeError(error)}`);
        // A refused configure() may leave the encoder unusable, and what its
        // state becomes afterwards is not the same across implementations, so
        // the next attempt gets a fresh one rather than reconfiguring this.
        try { encoder.close(); } catch { /* already closed */ }
      }
    }

    if (!chosen) {
      // Every mode refused: surface it, as this constructor always has. The
      // plugins gate on checkSupport() precisely so they never get here.
      //
      // Every failure is named, not just the last. Whoever hits this is
      // debugging a browser that claims to encode H.264 and does not, and
      // "quality was refused" alone does not say whether realtime was tried.
      throw new Error(
        failures.length > 0
          ? `VideoEncoder.configure() refused every latency mode (${failures.join("; ")})`
          : `Every latency mode was refused by this backend (${[...refusedLatencyModes].join(", ")})`,
      );
    }

    this._encoder = chosen.encoder;
    this._latencyMode = chosen.latencyMode;
  }

  /**
   * The latency mode this encoder actually got. `"quality"` means `"realtime"`
   * was refused by the backend; output format is identical either way.
   */
  get latencyMode(): LatencyMode {
    return this._latencyMode;
  }

  /** Get the H.264 codec string used by this encoder */
  get codec(): string {
    return pickH264Codec(this._width, this._height);
  }

  /** Get the avcC codec description (available after first keyframe) */
  get codecDescription(): Uint8Array | null {
    return this._codecDescription;
  }

  /**
   * Encode a decoded HEVC frame.
   * Converts Uint16Array YUV planes to I420 Uint8Array, creates VideoFrame, encodes.
   */
  encode(frame: HEVCFrame, timestampUs: number, keyFrame = false): void {
    if (this._error) {
      throw new Error(
        `VideoEncoder is no longer usable in latencyMode "${this._latencyMode}" (${describeError(this._error)})`,
      );
    }
    const w = frame.width;
    const h = frame.height;
    const cw = frame.chromaWidth;
    const ch = frame.chromaHeight;
    const shift = frame.bitDepth > 8 ? frame.bitDepth - 8 : 0;

    // Build I420 buffer: Y plane + U (Cb) plane + V (Cr) plane
    const ySize = w * h;
    const cSize = cw * ch;
    const i420 = new Uint8Array(ySize + cSize * 2);

    // Y plane
    for (let i = 0; i < ySize; i++) {
      const v = frame.y[i]! >> shift;
      i420[i] = v > 255 ? 255 : v;
    }
    // U (Cb) plane
    for (let i = 0; i < cSize; i++) {
      const v = frame.cb[i]! >> shift;
      i420[ySize + i] = v > 255 ? 255 : v;
    }
    // V (Cr) plane
    for (let i = 0; i < cSize; i++) {
      const v = frame.cr[i]! >> shift;
      i420[ySize + cSize + i] = v > 255 ? 255 : v;
    }

    const videoFrame = new VideoFrame(i420, {
      format: "I420",
      codedWidth: w,
      codedHeight: h,
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / this._fps),
      colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709" },
    });

    this._encoder.encode(videoFrame, { keyFrame });
    videoFrame.close();
  }

  /**
   * Flush the encoder — waits for all pending chunks to be output.
   *
   * Also where an asynchronous failure surfaces. The error callback only
   * records (#406), so this is what turns it into a rejection, on a path
   * every caller already awaits.
   */
  async flush(): Promise<void> {
    try {
      await this._encoder.flush();
    } catch (error) {
      throw new Error(
        `VideoEncoder.flush() failed in latencyMode "${this._latencyMode}": ${describeError(this._error ?? error)}`,
      );
    }
    if (this._error) {
      throw new Error(
        `VideoEncoder failed in latencyMode "${this._latencyMode}": ${describeError(this._error)}`,
      );
    }
  }

  /** Close the encoder and release resources */
  close(): void {
    this._encoder.close();
  }

  /** Check if VideoEncoder is supported in the current environment */
  static isSupported(): boolean {
    return typeof VideoEncoder !== "undefined";
  }

  /**
   * Async capability probe — answers whether this environment can encode
   * H.264 with the configuration this class builds, by actually configuring
   * an encoder and flushing it empty. `isConfigSupported()` alone cannot
   * answer: it says yes for a mode Gecko then refuses asynchronously (#406).
   *
   * Pass the stream's dimensions when they are known: the codec string
   * depends on resolution, so a probe at the default 720p cannot answer for
   * a 4K encode. Callers that probe before seeing a segment — both plugins
   * do — keep that gap: the fallback changes `latencyMode`, not the codec
   * (#399).
   */
  static async checkSupport(options?: {
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
  }): Promise<boolean> {
    if (typeof VideoEncoder === "undefined") return false;
    if (typeof VideoEncoder.isConfigSupported !== "function") return false;

    return (await H264Encoder.validateLatencyModes(options)) !== null;
  }

  /**
   * Resolve which latency mode this backend really encodes in, and remember
   * it for the realm. Returns the first viable mode, or `null` when none is.
   *
   * Call it from an async path before anything constructs an encoder: the
   * constructor is synchronous and cannot run this check itself, which is
   * exactly how #406 shipped. Repeat calls return the first result — the
   * memo is a promise, so concurrent callers share one validation.
   */
  static async validateLatencyModes(options?: {
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
  }): Promise<LatencyMode | null> {
    if (typeof VideoEncoder === "undefined") return null;

    latencyValidation ??= (async () => {
      const width = options?.width ?? PROBE_WIDTH;
      const height = options?.height ?? PROBE_HEIGHT;
      const fps = options?.fps ?? 25;

      for (const latencyMode of LATENCY_MODES) {
        const config = buildEncoderConfig(width, height, fps, options?.bitrate, latencyMode);

        if (typeof VideoEncoder.isConfigSupported === "function") {
          try {
            const result = await VideoEncoder.isConfigSupported(config);
            if (result.supported !== true) {
              refusedLatencyModes.add(latencyMode);
              continue;
            }
          } catch {
            // Malformed-config rejections land here; let the real configure()
            // answer rather than concluding from this.
          }
        }

        if (await probeLatencyMode(config)) return latencyMode;
        refusedLatencyModes.add(latencyMode);
      }
      return null;
    })();

    return latencyValidation;
  }

  private _handleOutput(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    // Capture codec description (avcC) from first chunk with decoderConfig
    if (metadata?.decoderConfig?.description && !this._codecDescription) {
      const desc = metadata.decoderConfig.description;
      if (desc instanceof ArrayBuffer) {
        this._codecDescription = new Uint8Array(desc);
      } else if (desc instanceof Uint8Array) {
        this._codecDescription = new Uint8Array(desc);
      } else if (ArrayBuffer.isView(desc)) {
        this._codecDescription = new Uint8Array((desc as ArrayBufferView).buffer);
      }
      this.onCodecDescription?.(this._codecDescription!);
    }

    // Extract chunk data
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    const encoded: EncodedChunk = {
      data,
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? Math.round(1_000_000 / this._fps),
      isKeyframe: chunk.type === "key",
    };

    this.onChunk?.(encoded);
  }
}
