/**
 * HEVC Decoder Web Worker
 *
 * Messages:
 *   Main -> Worker:
 *     { type: 'init', wasmUrl: string }
 *     { type: 'decode', data: ArrayBuffer }
 *
 *   Worker -> Main:
 *     { type: 'ready' }
 *     { type: 'info', info: HEVCStreamInfo }
 *     { type: 'frame', index: number, frame: HEVCFrame }
 *     { type: 'done', frameCount: number }
 *     { type: 'error', message: string }
 */

/**
 * Where the fields of the module's HEVCFrame struct sit, as the module itself
 * reports them through hevc_frame_layout(): "name:offset,...,_size:N". This
 * file ships unbundled, so it cannot import the parser the bundled readers
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
                      'chroma_width', 'chroma_height', 'bit_depth', 'poc', 'cvs_id',
                      'bytes_per_sample', '_size']) {
    if (!Number.isInteger(offset[name])) {
      throw new Error('HEVCFrame layout: missing or invalid ' + name);
    }
  }
  return { offset, size: offset._size };
}

let decoder = null;

// Import the WASM module (loaded as a classic script in worker context)
let ModuleFactory = null;

self.onmessage = async function (e) {
  const { type } = e.data;

  try {
    if (type === 'init') {
      // Load the WASM module
      importScripts(e.data.wasmUrl);
      ModuleFactory = self.HEVCDecoderModule;
      const m = await ModuleFactory();

      // Create decoder using raw cwrap (no ES module import in worker)
      const api = {
        create: m.cwrap('hevc_decoder_create', 'number', []),
        destroy: m.cwrap('hevc_decoder_destroy', null, ['number']),
        decode: m.cwrap('hevc_decoder_decode', 'number', ['number', 'number', 'number']),
        getFrameCount: m.cwrap('hevc_decoder_get_frame_count', 'number', ['number']),
        getFrame: m.cwrap('hevc_decoder_get_frame', 'number', ['number', 'number', 'number']),
        getInfo: m.cwrap('hevc_decoder_get_info', 'number', ['number', 'number']),
        frameLayout: m.cwrap('hevc_frame_layout', 'string', []),
      };

      const dec = api.create();
      if (!dec) throw new Error('Failed to create decoder');

      decoder = { m, api, dec, layout: parseFrameLayout(api.frameLayout()) };
      self.postMessage({ type: 'ready' });

    } else if (type === 'decode') {
      if (!decoder) throw new Error('Decoder not initialized');

      const { m, api, dec } = decoder;
      const data = new Uint8Array(e.data.data);

      // Copy to WASM heap
      const ptr = m._malloc(data.length);
      m.HEAPU8.set(data, ptr);

      const ret = api.decode(dec, ptr, data.length);
      m._free(ptr);

      if (ret !== 0) throw new Error('Decode failed');

      // Send stream info
      const infoPtr = m._malloc(24);
      if (api.getInfo(dec, infoPtr) === 0) {
        self.postMessage({
          type: 'info',
          info: {
            width:        m.getValue(infoPtr, 'i32'),
            height:       m.getValue(infoPtr + 4, 'i32'),
            bitDepth:     m.getValue(infoPtr + 8, 'i32'),
            chromaFormat: m.getValue(infoPtr + 12, 'i32'),
          }
        });
      }
      m._free(infoPtr);

      // Send frames one by one (transferable for zero-copy)
      const count = api.getFrameCount(dec);
      const at = decoder.layout.offset;
      const framePtr = m._malloc(decoder.layout.size);

      for (let i = 0; i < count; i++) {
        if (api.getFrame(dec, i, framePtr) !== 0) continue;

        const yPtr    = m.getValue(framePtr + at.y, '*');
        const cbPtr   = m.getValue(framePtr + at.cb, '*');
        const crPtr   = m.getValue(framePtr + at.cr, '*');
        const width   = m.getValue(framePtr + at.width, 'i32');
        const height  = m.getValue(framePtr + at.height, 'i32');
        const strideY = m.getValue(framePtr + at.stride_y, 'i32');
        const strideC = m.getValue(framePtr + at.stride_c, 'i32');
        const cw      = m.getValue(framePtr + at.chroma_width, 'i32');
        const ch      = m.getValue(framePtr + at.chroma_height, 'i32');
        const bd      = m.getValue(framePtr + at.bit_depth, 'i32');
        const poc     = m.getValue(framePtr + at.poc, 'i32');

        // Copy planes out of WASM heap as transferable ArrayBuffers
        const bps     = m.getValue(framePtr + at.bytes_per_sample, 'i32');
        const y  = copyPlane(m, yPtr, width, height, strideY, bps);
        const cb = copyPlane(m, cbPtr, cw, ch, strideC, bps);
        const cr = copyPlane(m, crPtr, cw, ch, strideC, bps);

        self.postMessage(
          { type: 'frame', index: i, frame: { y, cb, cr, width, height, chromaWidth: cw, chromaHeight: ch, bitDepth: bd, poc } },
          [y.buffer, cb.buffer, cr.buffer]
        );
      }

      m._free(framePtr);
      self.postMessage({ type: 'done', frameCount: count });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};

// bytesPerSample 1: an 8-bit picture, one byte per sample; set() widens it
function copyPlane(m, ptr, width, height, stride, bytesPerSample) {
  const out = new Uint16Array(width * height);
  const heap = bytesPerSample === 1 ? m.HEAPU8 : m.HEAPU16;
  const base = bytesPerSample === 1 ? ptr : ptr >> 1;
  for (let y = 0; y < height; y++) {
    out.set(heap.subarray(base + y * stride, base + y * stride + width), y * width);
  }
  return out;
}
