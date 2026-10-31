/**
 * @hevcjs/mediabunny-plugin — HEVC decoding for Mediabunny where WebCodecs
 * cannot provide it (Chrome on Linux, Firefox on Windows without the HEVC
 * extension, machines without a hardware HEVC decoder).
 *
 * @example
 * ```ts
 * import { registerHevcDecoder } from '@hevcjs/mediabunny-plugin';
 *
 * await registerHevcDecoder({ workerUrl: '/decode-worker.js' });
 * // Mediabunny now decodes HEVC tracks the browser cannot decode itself.
 * ```
 */

import { CustomVideoDecoder, EncodedPacket, registerDecoder, VideoSample } from "mediabunny";
import type { VideoCodec } from "mediabunny";
// The decoder-only entry: the main one would pull mp4box into the app's bundle
import { HEVCDecoder } from "@hevcjs/core/decoder";
import type { DecoderOptions } from "@hevcjs/core/decoder";
import { packetToAnnexB, readStreamConfig } from "./bitstream.js";
import { packFrame } from "./frames.js";
import type { PackedFrame } from "./frames.js";
import { OutputTimestamps } from "./output-timestamps.js";
import type { SlotTime } from "./output-timestamps.js";
import { DecodeWorkerClient, createWorker } from "./worker-client.js";

export interface HevcDecoderPluginOptions extends DecoderOptions {
  /**
   * Decode with hevc.js even where WebCodecs can decode HEVC natively.
   * Mediabunny prefers a registered decoder over the native one, so without
   * this the plugin only claims the profiles the browser cannot decode.
   */
  force?: boolean;
  /**
   * URL of `decode-worker.js` (shipped in this package's dist/): decodes in a
   * Web Worker, one per track being decoded, off the page's thread. The worker
   * loads `wasmUrl`, by default `hevc-decode.js` next to it. Without it, the
   * page's thread decodes, yielding to the event loop about every 50 ms.
   */
  workerUrl?: string;
}

/** Profiles @hevcjs/core decodes: Main and Main 10. */
const DECODABLE_PROFILES = [1, 2] as const;

/** One codec string per profile, for the native support probe. */
const PROBE_CODECS: Record<(typeof DECODABLE_PROFILES)[number], string> = {
  1: "hvc1.1.6.L93.B0",
  2: "hvc1.2.4.L93.B0",
};

/** How long the page's thread decodes before it lets the page paint and handle input. */
const YIELD_EVERY_MS = 50;

interface Settings {
  /** For the page's thread */
  decoderOptions: DecoderOptions;
  /** For a decode worker: absolute URLs, the worker may run from a blob URL */
  worker: { workerUrl: string; wasmUrl: string; wasmBinaryUrl: string } | null;
  /** Profiles this plugin claims: the decodable ones WebCodecs cannot decode, or all of them when forced */
  profiles: Set<number>;
  /** Whether VideoFrame accepts I420P10; when it does not, 10-bit output is scaled down to 8 bits */
  i420p10: boolean;
}

let settings: Settings | null = null;
let registration: Promise<void> | null = null;

/**
 * Registers the hevc.js decoder with Mediabunny. Call it, and await it,
 * before any decoding task. Later calls return the first registration, so
 * the options of the first call stay in effect.
 *
 * The native probe runs once, here, because Mediabunny asks a custom decoder
 * whether it supports a track synchronously while WebCodecs only answers
 * asynchronously. It probes one level per profile; a browser that decodes
 * HEVC at that level but not at a higher one is not detected.
 */
export function registerHevcDecoder(options: HevcDecoderPluginOptions = {}): Promise<void> {
  registration ??= register(options).catch((error: unknown) => {
    // A failed registration (null options from plain JS, say) must not block a later, valid call
    registration = null;
    throw error;
  });
  return registration;
}

async function register(options: HevcDecoderPluginOptions): Promise<void> {
  const { force = false, workerUrl, ...decoderOptions } = options;

  const profiles = new Set<number>();
  for (const profile of DECODABLE_PROFILES) {
    if (force || !(await nativelyDecodes(PROBE_CODECS[profile]))) profiles.add(profile);
  }

  let worker: Settings["worker"] = null;
  if (workerUrl !== undefined) {
    const absWorkerUrl = absolute(workerUrl);
    const wasmUrl = absolute(decoderOptions.wasmUrl ?? "hevc-decode.js", absWorkerUrl);
    const wasmBinaryUrl = absolute(decoderOptions.wasmBinaryUrl ?? "hevc-decode.wasm", wasmUrl);
    worker = { workerUrl: absWorkerUrl, wasmUrl, wasmBinaryUrl };
  }

  settings = { decoderOptions, worker, profiles, i420p10: supportsI420P10() };
  registerDecoder(HevcDecoder);
}

function absolute(url: string, base?: string): string {
  return new URL(url, base ?? (typeof location === "undefined" ? undefined : location.href)).href;
}

async function nativelyDecodes(codec: string): Promise<boolean> {
  if (typeof VideoDecoder === "undefined") return false;
  try {
    return (await VideoDecoder.isConfigSupported({ codec })).supported === true;
  } catch {
    return false;
  }
}

function supportsI420P10(): boolean {
  // Without VideoFrame (Node, Deno), Mediabunny keeps the raw planes itself
  if (typeof VideoFrame === "undefined") return true;
  try {
    // 2x2 frame: 4 luma + 1 + 1 chroma samples
    const format = "I420P10" as VideoPixelFormat;
    new VideoFrame(new Uint16Array(6), { format, codedWidth: 2, codedHeight: 2, timestamp: 0 }).close();
    return true;
  } catch {
    return false;
  }
}

class HevcDecoder extends CustomVideoDecoder {
  private _worker: DecodeWorkerClient | null = null;
  private _local: HEVCDecoder | null = null;
  private _nalLengthSize = 0;
  private _lastYield = 0;
  private readonly _timestamps = new OutputTimestamps();

  static override supports(codec: VideoCodec, config: VideoDecoderConfig): boolean {
    if (!settings || codec !== "hevc") return false;
    const stream = readStreamConfig(config.codec, config.description);
    return stream.profileIdc !== null
      && settings.profiles.has(stream.profileIdc)
      && (stream.chromaFormatIdc === null || stream.chromaFormatIdc === 1)
      && (stream.bitDepthLuma === null || stream.bitDepthLuma <= 10);
  }

  async init(): Promise<void> {
    const stream = readStreamConfig(this.config.codec, this.config.description);
    const { worker, decoderOptions, i420p10 } = settings!;

    if (worker) {
      this._worker = await DecodeWorkerClient.open(
        await createWorker(worker.workerUrl),
        {
          wasmUrl: worker.wasmUrl,
          wasmBinaryUrl: worker.wasmBinaryUrl,
          nalLengthSize: stream.nalLengthSize,
          parameterSets: stream.parameterSets,
          i420p10,
        },
        (suppressed, frames) => {
          this._timestamps.noteSuppressed(suppressed);
          this._emit(frames);
        },
        error => this.onError(error),
      );
      return;
    }

    this._nalLengthSize = stream.nalLengthSize;
    this._local = await HEVCDecoder.create(decoderOptions);
    if (stream.parameterSets) this._local.feed(stream.parameterSets);
    this._lastYield = performance.now();
  }

  async decode(packet: EncodedPacket): Promise<void> {
    this._timestamps.add({ timestamp: packet.timestamp, duration: packet.duration });
    if (this._worker) return this._worker.decode(packet.data);

    const decoder = this._local!;
    decoder.feed(packetToAnnexB(packet.data, this._nalLengthSize));
    // Read before draining: a frame released by this drain may display after
    // a suppressed picture, and would otherwise take its slot.
    this._timestamps.noteSuppressed(decoder.takeSuppressedPictures());
    this._emit(decoder.drain().map(frame => packFrame(frame, settings!.i420p10)));

    // Mediabunny chains decode() through promises only: without a task
    // boundary now and then, decoding flat out freezes the page until it ends.
    if (performance.now() - this._lastYield > YIELD_EVERY_MS) {
      await new Promise(resolve => setTimeout(resolve, 0));
      this._lastYield = performance.now();
    }
  }

  async flush(): Promise<void> {
    const frames = this._worker
      ? await this._worker.flush()
      : this._local!.flush().map(frame => packFrame(frame, settings!.i420p10));
    this._emit(frames);
    this._timestamps.reset();
  }

  close(): void {
    this._worker?.close();
    this._worker = null;
    this._local?.destroy();
    this._local = null;
  }

  private _emit(frames: PackedFrame[]): void {
    for (const frame of frames) {
      const slot = this._timestamps.next(frame);
      // More frames than packets only comes out of a corrupt stream
      if (!slot) continue;
      this.onSample(toVideoSample(frame, slot));
    }
  }
}

function toVideoSample(frame: PackedFrame, slot: SlotTime): VideoSample {
  const { format, data, width: codedWidth, height: codedHeight } = frame;

  if (typeof VideoFrame !== "undefined") {
    // Build the VideoFrame ourselves: handing Mediabunny raw planes would copy them once more
    const videoFrame = new VideoFrame(data, {
      // TypeScript's DOM types predate I420P10, which WebCodecs defines (here and in the probe)
      format: format as VideoPixelFormat,
      codedWidth,
      codedHeight,
      timestamp: Math.round(slot.timestamp * 1e6),
      duration: Math.round(slot.duration * 1e6),
    });
    return new VideoSample(videoFrame, { timestamp: slot.timestamp, duration: slot.duration });
  }

  return new VideoSample(data, {
    format,
    codedWidth,
    codedHeight,
    timestamp: slot.timestamp,
    duration: slot.duration,
  });
}
