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

/**
 * Where the fields of the module's HEVCFrame struct sit, as the module itself
 * reports them through hevc_frame_layout(): "name:offset,...,_size:N". This
 * tool ships unbundled, so it cannot import the parser the bundled readers
 * share — what it hardcodes is the field names, not their offsets (#370).
 */
function parseFrameLayout(spec) {
    const offset = {};
    for (const field of spec.split(',')) {
        const sep = field.indexOf(':');
        if (sep < 0) throw new Error('HEVCFrame layout: malformed field ' + field);
        offset[field.slice(0, sep)] = Number(field.slice(sep + 1));
    }
    for (const name of ['y', 'cb', 'cr', 'width', 'height', 'stride_y', 'stride_c',
                        'chroma_width', 'chroma_height', 'bit_depth',
                        'bytes_per_sample', '_size']) {
        if (!Number.isInteger(offset[name])) {
            throw new Error('HEVCFrame layout: missing or invalid ' + name);
        }
    }
    return { offset, size: offset._size };
}

async function main() {
    const m = await HEVCDecoderModule({ locateFile: (p) => path.join(wasmPath, p) });
    const data = fs.readFileSync(input);

    const dataPtr = m._malloc(data.length);
    m.HEAPU8.set(data, dataPtr);
    const dec = m._hevc_decoder_create();
    const layout = parseFrameLayout(m.ccall('hevc_frame_layout', 'string', [], []));
    const at = layout.offset;
    const framePtr = m._malloc(layout.size);
    const fd = fs.openSync(output, 'w');

    try {
        if (m._hevc_decoder_decode(dec, dataPtr, data.length) !== HEVC_OK) return 1;
        const count = m._hevc_decoder_get_frame_count(dec);
        if (count === 0) return 1;

        for (let i = 0; i < count; i++) {
            if (m._hevc_decoder_get_frame(dec, i, framePtr) !== HEVC_OK) return 1;
            const i32 = (off) => m.getValue(framePtr + off, 'i32');
            const width = i32(at.width), height = i32(at.height);
            const strideY = i32(at.stride_y), strideC = i32(at.stride_c);
            const cw = i32(at.chroma_width), ch = i32(at.chroma_height);
            const bitDepth = i32(at.bit_depth);
            // HEVCFrame carries the luma bit depth only; every stream compared has
            // the same depth for chroma.
            const planes = [
                [m.getValue(framePtr + at.y, '*'), width, height, strideY],
                [m.getValue(framePtr + at.cb, '*'), cw, ch, strideC],
                [m.getValue(framePtr + at.cr, '*'), cw, ch, strideC],
            ];
            for (const [ptr, w, h, stride] of planes) {
                if (!ptr || w === 0 || h === 0) continue; // monochrome: no chroma plane
                const bytesPerSample = bitDepth <= 8 ? 1 : 2;
                const buf = Buffer.alloc(w * h * bytesPerSample);
                // Storage: one byte per sample for an 8-bit picture
                const stored = i32(at.bytes_per_sample);
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
