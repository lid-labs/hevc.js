/**
 * @hevcjs/mediabunny-plugin — HEVC decoding for Mediabunny where WebCodecs
 * cannot provide it (Firefox, Chrome on Linux, machines without a hardware
 * HEVC decoder).
 *
 * @example
 * ```ts
 * import { registerHevcDecoder } from '@hevcjs/mediabunny-plugin';
 *
 * await registerHevcDecoder({ wasmUrl: '/hevc-decode.js' });
 * // Mediabunny now decodes HEVC tracks the browser cannot decode itself.
 * ```
 */

import { CustomVideoDecoder, EncodedPacket, registerDecoder, VideoSample } from "mediabunny";
import type { VideoCodec } from "mediabunny";
import { HEVCDecoder } from "@hevcjs/core";
import type { DecoderOptions, HEVCFrame } from "@hevcjs/core";
import { packetToAnnexB, readStreamConfig } from "./bitstream.js";
import { OutputTimestamps } from "./output-timestamps.js";
import type { SlotTime } from "./output-timestamps.js";

export interface HevcDecoderPluginOptions extends DecoderOptions {
  /**
   * Decode with hevc.js even where WebCodecs can decode HEVC natively.
   * Mediabunny prefers a registered decoder over the native one, so without
   * this the plugin only claims the profiles the browser cannot decode.
   */
  force?: boolean;
}

/** Profiles @hevcjs/core decodes: Main and Main 10. */
const DECODABLE_PROFILES = [1, 2] as const;

/** One codec string per profile, for the native support probe. */
const PROBE_CODECS: Record<(typeof DECODABLE_PROFILES)[number], string> = {
  1: "hvc1.1.6.L93.B0",
  2: "hvc1.2.4.L93.B0",
};

interface Settings {
  decoderOptions: DecoderOptions;
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
  registration ??= register(options);
  return registration;
}

async function register(options: HevcDecoderPluginOptions): Promise<void> {
  const { force = false, ...decoderOptions } = options;

  const profiles = new Set<number>();
  for (const profile of DECODABLE_PROFILES) {
    if (force || !(await nativelyDecodes(PROBE_CODECS[profile]))) profiles.add(profile);
  }

  settings = { decoderOptions, profiles, i420p10: supportsI420P10() };
  registerDecoder(HevcDecoder);
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
  private _decoder: HEVCDecoder | null = null;
  private _nalLengthSize = 0;
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
    this._nalLengthSize = stream.nalLengthSize;
    this._decoder = await HEVCDecoder.create(settings!.decoderOptions);
    if (stream.parameterSets) this._decoder.feed(stream.parameterSets);
  }

  decode(packet: EncodedPacket): void {
    const decoder = this._decoder!;
    this._timestamps.add({ timestamp: packet.timestamp, duration: packet.duration });
    decoder.feed(packetToAnnexB(packet.data, this._nalLengthSize));
    // Read before draining: a frame released by this drain may display after
    // a suppressed picture, and would otherwise take its slot.
    this._timestamps.noteSuppressed(decoder.takeSuppressedPictures());
    this._emit(decoder.drain());
  }

  flush(): void {
    this._emit(this._decoder!.flush());
    this._timestamps.reset();
  }

  close(): void {
    this._decoder?.destroy();
    this._decoder = null;
  }

  private _emit(frames: HEVCFrame[]): void {
    for (const frame of frames) {
      const slot = this._timestamps.next(frame);
      // More frames than packets only comes out of a corrupt stream
      if (!slot) continue;
      this.onSample(toVideoSample(frame, slot, settings!.i420p10));
    }
  }
}

function toVideoSample(frame: HEVCFrame, slot: SlotTime, i420p10: boolean): VideoSample {
  const { format, data } = packPlanes(frame, i420p10);
  const codedWidth = frame.width;
  const codedHeight = frame.height;

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

/** The three planes, contiguous, in the layout VideoFrame expects for I420 / I420P10. */
function packPlanes(frame: HEVCFrame, i420p10: boolean): { format: "I420" | "I420P10"; data: Uint8Array | Uint16Array } {
  const ySize = frame.y.length;
  const cSize = frame.cb.length;

  if (frame.bitDepth === 10 && i420p10) {
    const out = new Uint16Array(ySize + 2 * cSize);
    out.set(frame.y);
    out.set(frame.cb, ySize);
    out.set(frame.cr, ySize + cSize);
    return { format: "I420P10", data: out };
  }

  const out = new Uint8Array(ySize + 2 * cSize);
  if (frame.bitDepth > 8) {
    const shift = frame.bitDepth - 8;
    const planes = [frame.y, frame.cb, frame.cr];
    let off = 0;
    for (const plane of planes) {
      for (let i = 0; i < plane.length; i++) out[off + i] = plane[i]! >> shift;
      off += plane.length;
    }
  } else {
    // 8-bit samples fit a byte: set() converts them as they are copied
    out.set(frame.y);
    out.set(frame.cb, ySize);
    out.set(frame.cr, ySize + cSize);
  }
  return { format: "I420", data: out };
}
