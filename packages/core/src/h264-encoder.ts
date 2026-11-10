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
 * Why try rather than decide. Measured on an Apple M4 Pro / macOS 26.6,
 * Firefox 155 and Zen (Gecko 159) both accept `realtime` at 720p, 1080p and
 * 4K, through `isConfigSupported()` and a real `configure()` alike — while
 * #380 reports a refusal on Zen under macOS too. That refusal was not
 * reproduced here, and what flips it is not established: the Zen version it
 * was seen on was not measured, nor was an Intel Mac.
 *
 * Nothing measured here supports a user-agent test either. The Zen measured
 * reports `Firefox/159.0`, a string that does not name Zen, and accepts — as
 * Firefox 155 does. What is left is asking the encoder.
 */
const LATENCY_MODES = ["realtime", "quality"] as const;

/** Resolution `checkSupport()` probes when the caller does not know one yet. */
const PROBE_WIDTH = 1280;
const PROBE_HEIGHT = 720;

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

    for (const latencyMode of LATENCY_MODES) {
      const encoder = new VideoEncoder({
        output: (chunk, metadata) => this._handleOutput(chunk, metadata),
        error: (e) => { throw new Error(`VideoEncoder error: ${e.message}`); },
      });
      try {
        encoder.configure(
          buildEncoderConfig(this._width, this._height, this._fps, config.bitrate, latencyMode),
        );
        chosen = { encoder, latencyMode };
        break;
      } catch (error) {
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        failures.push(`${latencyMode} — ${reason}`);
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
        `VideoEncoder.configure() refused every latency mode (${failures.join("; ")})`,
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

  /** Flush the encoder — waits for all pending chunks to be output */
  async flush(): Promise<void> {
    await this._encoder.flush();
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
   * Async capability probe — checks that VideoEncoder can actually encode
   * H.264 with the configuration this class builds. A browser may expose
   * VideoEncoder and still refuse H.264, or accept it in one latency mode
   * only, so every mode the constructor would try is probed here too.
   *
   * Pass the stream's dimensions when they are known: the codec string
   * depends on resolution, so a probe at the default 720p cannot answer for
   * a 4K encode. Callers that probe before seeing a segment — both plugins
   * do — get the default, and the constructor's own fallback covers the rest.
   */
  static async checkSupport(options?: {
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
  }): Promise<boolean> {
    if (typeof VideoEncoder === "undefined") return false;
    if (typeof VideoEncoder.isConfigSupported !== "function") return false;

    const width = options?.width ?? PROBE_WIDTH;
    const height = options?.height ?? PROBE_HEIGHT;
    const fps = options?.fps ?? 25;

    for (const latencyMode of LATENCY_MODES) {
      try {
        const result = await VideoEncoder.isConfigSupported(
          buildEncoderConfig(width, height, fps, options?.bitrate, latencyMode),
        );
        if (result.supported === true) return true;
      } catch {
        // Malformed-config rejections land here; try the next mode rather
        // than concluding from one.
      }
    }
    return false;
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
