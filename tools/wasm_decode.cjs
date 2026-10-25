#!/usr/bin/env node
// Decode a stream with the WASM decoder under Node and write the pictures as raw YUV,
// in the same layout as the native `hevc-decode -o`: output order, cropped planes,
// one byte per sample up to 8 bits, two (little-endian) above.
// Usage: node tools/wasm_decode.cjs <wasm_dir> <bitstream.265> <out.yuv>
// Exit status: 0 written, 1 decode failed or produced no picture, 2 usage or load error.

const fs = require('fs');
const path = require('path');

const [wasmDir, input, output] = process.argv.slice(2);
if (!wasmDir || !input || !output) {
    console.error('Usage: node tools/wasm_decode.cjs <wasm_dir> <bitstream.265> <out.yuv>');
    process.exit(2);
}
const wasmPath = path.resolve(wasmDir);

// Same loading workaround as tools/bench_wasm.cjs: the MODULARIZE wrapper returns
// undefined under Node, so evaluate it here and pick up the global it declares.
eval(fs.readFileSync(path.join(wasmPath, 'hevc-decode.js'), 'utf8'));
if (typeof HEVCDecoderModule !== 'function') {
    console.error('Failed to load HEVCDecoderModule from ' + wasmPath);
    process.exit(2);
}

const HEVC_OK = 0;
const FRAME_SIZE = 52; // sizeof(HEVCFrame) under wasm32, asserted in src/wasm/hevc_api.cpp

async function main() {
    const m = await HEVCDecoderModule({ locateFile: (p) => path.join(wasmPath, p) });
    const data = fs.readFileSync(input);

    const dataPtr = m._malloc(data.length);
    m.HEAPU8.set(data, dataPtr);
    const dec = m._hevc_decoder_create();
    const framePtr = m._malloc(FRAME_SIZE);
    const fd = fs.openSync(output, 'w');

    try {
        if (m._hevc_decoder_decode(dec, dataPtr, data.length) !== HEVC_OK) return 1;
        const count = m._hevc_decoder_get_frame_count(dec);
        if (count === 0) return 1;

        for (let i = 0; i < count; i++) {
            if (m._hevc_decoder_get_frame(dec, i, framePtr) !== HEVC_OK) return 1;
            const i32 = (off) => m.getValue(framePtr + off, 'i32');
            const width = i32(12), height = i32(16);
            const strideY = i32(20), strideC = i32(24);
            const cw = i32(28), ch = i32(32), bitDepth = i32(36);
            // HEVCFrame carries the luma bit depth only; every stream compared has
            // the same depth for chroma.
            const planes = [
                [m.getValue(framePtr, '*'), width, height, strideY],
                [m.getValue(framePtr + 4, '*'), cw, ch, strideC],
                [m.getValue(framePtr + 8, '*'), cw, ch, strideC],
            ];
            for (const [ptr, w, h, stride] of planes) {
                if (!ptr || w === 0 || h === 0) continue; // monochrome: no chroma plane
                const bytesPerSample = bitDepth <= 8 ? 1 : 2;
                const buf = Buffer.alloc(w * h * bytesPerSample);
                // Storage: one byte per sample for an 8-bit picture
                const stored = i32(48);
                for (let y = 0; y < h; y++) {
                    // The heap is re-read every row: memory growth replaces the buffer
                    const row = stored === 1
                        ? m.HEAPU8.subarray(ptr + y * stride, ptr + y * stride + w)
                        : m.HEAPU16.subarray(ptr / 2 + y * stride, ptr / 2 + y * stride + w);
                    if (bytesPerSample === 1) {
                        for (let x = 0; x < w; x++) buf[y * w + x] = row[x];
                    } else {
                        for (let x = 0; x < w; x++) buf.writeUInt16LE(row[x], (y * w + x) * 2);
                    }
                }
                fs.writeSync(fd, buf);
            }
        }
        return 0;
    } finally {
        fs.closeSync(fd);
        m._free(framePtr);
        m._hevc_decoder_destroy(dec);
        m._free(dataPtr);
    }
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
