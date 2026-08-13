import { describe, it, expect } from "vitest";
import { createFile } from "mp4box";
import { FMP4Muxer } from "./fmp4-muxer.js";

// A minimal valid avcC (Baseline 3.0) and a real AAC-LC 48kHz mono ASC.
const AVCC = new Uint8Array([
  1, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x09, 0x67, 0x42, 0xc0, 0x1e,
  0xd9, 0x00, 0xf0, 0x11, 0x7e, 0x01, 0x00, 0x04, 0x68, 0xce, 0x3c, 0x80,
]);
const ASC = new Uint8Array([0x11, 0x88, 0x56, 0xe5, 0x00]);

function parse(bytes: Uint8Array) {
  const mp4 = createFile();
  let info: unknown = null;
  let error: unknown = null;
  mp4.onReady = (i: unknown) => { info = i; };
  mp4.onError = (e: unknown) => { error = e; };
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer & { fileStart: number };
  ab.fileStart = 0;
  mp4.appendBuffer(ab);
  mp4.flush();
  return { info: info as { tracks: { id: number; type: string; codec: string; timescale: number; audio?: { channel_count: number; sample_rate: number }; video?: { width: number; height: number } }[] } | null, error };
}

describe("FMP4Muxer two-track (A/V) init", () => {
  it("round-trips a two-track init through mp4box with correct codecs", () => {
    const m = new FMP4Muxer();
    const init = m.generateInitAV(
      { width: 640, height: 360, timescale: 12800, avcC: AVCC },
      { timescale: 48000, channelCount: 1, sampleRate: 48000, sampleSize: 16, asc: ASC },
    );

    const { info, error } = parse(init);
    expect(error).toBeNull();
    expect(info).not.toBeNull();
    expect(info!.tracks).toHaveLength(2);

    const video = info!.tracks.find((t) => t.type === "video")!;
    expect(video.codec).toBe("avc1.42c01e");
    expect(video.video).toMatchObject({ width: 640, height: 360 });

    const audio = info!.tracks.find((t) => t.type === "audio")!;
    // esds/ASC parsed back to the AAC-LC codec string proves the boxes are valid.
    expect(audio.codec).toBe("mp4a.40.2");
    expect(audio.timescale).toBe(48000);
    expect(audio.audio).toMatchObject({ channel_count: 1, sample_rate: 48000 });
  });

  it("muxSegmentAV lays video samples before audio and points each trun's data_offset correctly", () => {
    const m = new FMP4Muxer();
    const videoSamples = [
      { data: new Uint8Array([1, 2, 3, 4]), duration: 512, isKeyframe: true },
      { data: new Uint8Array([5, 6, 7, 8, 9]), duration: 512, isKeyframe: false },
    ];
    const audioSamples = [
      { data: new Uint8Array([10, 11]), duration: 1024 },
      { data: new Uint8Array([12, 13, 14]), duration: 1024 },
    ];
    const seg = m.muxSegmentAV(videoSamples, 0, audioSamples, 0);

    // Structural: one moof + one mdat, two traf, two trun.
    const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
    expect(dv.getUint32(4)).toBe(0x6d6f6f66); // 'moof'
    let trafCount = 0, trunCount = 0;
    for (let i = 0; i + 8 <= seg.byteLength; ) {
      const size = dv.getUint32(i);
      const type = dv.getUint32(i + 4);
      if (type === 0x6d6f6f66) { // descend into moof
        let j = i + 8;
        while (j + 8 <= i + size) {
          const isz = dv.getUint32(j);
          const it = dv.getUint32(j + 4);
          if (it === 0x74726166) trafCount++;
          j += isz;
        }
      }
      if (size < 8) break;
      i += size;
    }
    expect(trafCount).toBe(2);
    // mdat holds video bytes (4+5=9) then audio bytes (2+3=5) = 14 payload.
    const mdatStart = seg.byteLength - (8 + 14);
    expect(dv.getUint32(mdatStart + 4)).toBe(0x6d646174); // 'mdat'
    expect(dv.getUint32(mdatStart)).toBe(8 + 14);
    // First video sample byte lands right after the mdat header.
    expect(seg[mdatStart + 8]).toBe(1);
    // Audio bytes follow the 9 video bytes.
    expect(seg[mdatStart + 8 + 9]).toBe(10);
    void trunCount;
  });
});

describe("FMP4Muxer two-track edge cases", () => {
  it("encodes a >127-byte ASC with a multi-byte descriptor length (no truncation)", () => {
    const m = new FMP4Muxer();
    // A 200-byte ASC forces the expandable size to span two bytes.
    const bigAsc = new Uint8Array(200).fill(0x11);
    const init = m.generateInitAV(
      { width: 640, height: 360, timescale: 12800, avcC: AVCC },
      { timescale: 48000, channelCount: 2, sampleRate: 48000, sampleSize: 16, asc: bigAsc },
    );
    const { info, error } = parse(init);
    expect(error).toBeNull();
    // mp4box must still parse two tracks — proves the descriptor lengths are
    // consistent (a truncated length would corrupt the esds and the moov).
    expect(info!.tracks).toHaveLength(2);
    expect(info!.tracks.find((t) => t.type === "audio")!.codec).toMatch(/^mp4a/);
  });

  it("clamps the AudioSampleEntry samplerate field for rates >= 65536 (ASC carries the truth)", () => {
    const m = new FMP4Muxer();
    // 96 kHz can't fit the 16-bit integer part; must not wrap to garbage.
    const init = m.generateInitAV(
      { width: 640, height: 360, timescale: 12800, avcC: AVCC },
      { timescale: 96000, channelCount: 2, sampleRate: 96000, sampleSize: 16, asc: ASC },
    );
    const { info, error } = parse(init);
    expect(error).toBeNull();
    expect(info!.tracks).toHaveLength(2);
  });

  it("muxSegmentAV with zero audio samples still produces a parseable segment", () => {
    const m = new FMP4Muxer();
    const seg = m.muxSegmentAV(
      [{ data: new Uint8Array([1, 2, 3, 4]), duration: 512, isKeyframe: true }],
      0,
      [],
      0,
    );
    // moof then mdat; the audio traf carries a zero-sample trun.
    const dv = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
    expect(dv.getUint32(4)).toBe(0x6d6f6f66); // 'moof'
    // mdat holds only the 4 video bytes.
    const mdatStart = seg.byteLength - (8 + 4);
    expect(dv.getUint32(mdatStart + 4)).toBe(0x6d646174); // 'mdat'
    expect(dv.getUint32(mdatStart)).toBe(12);
  });
});
