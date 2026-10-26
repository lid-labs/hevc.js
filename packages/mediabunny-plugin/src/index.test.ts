/**
 * End to end through Mediabunny, under Node: the real WASM decoder, the DASH
 * 720p demo stream (fMP4, hvcC, B-frames) read by Mediabunny's demuxer.
 * Node has no WebCodecs, so the plugin claims every decodable profile and
 * Mediabunny keeps the decoded planes as raw samples.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input, VideoSampleSink } from "mediabunny";
import { HEVCDecoder } from "@hevcjs/core/decoder";
import type { HEVCFrame } from "@hevcjs/core/decoder";
import { packetToAnnexB, readStreamConfig } from "./bitstream.js";
import { registerHevcDecoder } from "./index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const wasmGlue = `${repoRoot}packages/core/wasm/hevc-decode.js`;
const streamDir = `${repoRoot}demo/streams/dash_720p/`;

/** init + the five media segments of the video representation, as one fragmented MP4 */
function loadStream(): Uint8Array {
  const parts = ["init_0.mp4", ...[1, 2, 3, 4, 5].map(n => `seg_0_00${n}.m4s`)]
    .map(name => readFileSync(streamDir + name));
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.byteLength, 0));
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.byteLength;
  }
  return out;
}

beforeAll(() => {
  // HEVCDecoder.create() picks up a global factory first. The Emscripten glue
  // expects CommonJS globals under Node, so they are handed in explicitly.
  const factory = new Function("require", "__dirname", "__filename",
    `${readFileSync(wasmGlue, "utf8")}\nreturn HEVCDecoderModule;`,
  )(createRequire(wasmGlue), `${repoRoot}packages/core/wasm`, wasmGlue);
  (globalThis as Record<string, unknown>).HEVCDecoderModule = factory;
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).HEVCDecoderModule;
});

describe("registerHevcDecoder", () => {
  // Runs first: registration is module-wide, and the next test needs it to succeed afterwards
  it("lets a call retry after a failed registration", async () => {
    await expect(registerHevcDecoder(null as unknown as {})).rejects.toThrow(TypeError);
    await expect(registerHevcDecoder()).resolves.toBeUndefined();
  });

  it("decodes an HEVC track through Mediabunny, frames timed in display order", async () => {
    await registerHevcDecoder();

    const input = new Input({ source: new BufferSource(loadStream()), formats: ALL_FORMATS });
    const track = (await input.getPrimaryVideoTrack())!;
    expect(await track.getCodec()).toBe("hevc");
    expect(await track.canDecode()).toBe(true);

    const packetTimestamps: number[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) packetTimestamps.push(packet.timestamp);
    // B-frames: decode order differs from display order, which is what the timing has to undo
    const displayOrder = [...packetTimestamps].sort((a, b) => a - b);
    expect(packetTimestamps).not.toEqual(displayOrder);

    const sampleTimestamps: number[] = [];
    const firstAndLast: Uint8Array[] = [];
    let format: string | null = null;
    let size = "";
    for await (const sample of new VideoSampleSink(track).samples()) {
      if (sampleTimestamps.length === 0 || sampleTimestamps.length === displayOrder.length - 1) {
        const bytes = new Uint8Array(sample.allocationSize());
        await sample.copyTo(bytes);
        firstAndLast.push(bytes);
      }
      sampleTimestamps.push(sample.timestamp);
      format = sample.format;
      size = `${sample.codedWidth}x${sample.codedHeight}`;
      sample.close();
    }

    expect(sampleTimestamps).toEqual(displayOrder);
    expect(format).toBe("I420");
    expect(size).toBe("1280x720");

    // Same pixels as the decoder fed directly, so nothing is lost or shifted between the two
    const config = (await track.getDecoderConfig())!;
    const stream = readStreamConfig(config.codec, config.description);
    const decoder = await HEVCDecoder.create();
    decoder.feed(stream.parameterSets!);
    const frames: HEVCFrame[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) {
      decoder.feed(packetToAnnexB(packet.data, stream.nalLengthSize));
      frames.push(...decoder.drain());
    }
    frames.push(...decoder.flush());
    decoder.destroy();

    expect(frames).toHaveLength(displayOrder.length);
    const i420 = (f: HEVCFrame) => Uint8Array.from([...f.y, ...f.cb, ...f.cr]);
    expect(firstAndLast[0]).toEqual(i420(frames[0]!));
    expect(firstAndLast[1]).toEqual(i420(frames[frames.length - 1]!));
    // Decodes 250 frames of 720p twice: ~4s on an M4 Pro, 11.6s on a GitHub runner
  }, 60_000);
});
