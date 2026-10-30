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
      };

      const dec = api.create();
      if (!dec) throw new Error('Failed to create decoder');

      decoder = { m, api, dec };
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
      const framePtr = m._malloc(52);

      for (let i = 0; i < count; i++) {
        if (api.getFrame(dec, i, framePtr) !== 0) continue;

        const yPtr    = m.getValue(framePtr, '*');
        const cbPtr   = m.getValue(framePtr + 4, '*');
        const crPtr   = m.getValue(framePtr + 8, '*');
        const width   = m.getValue(framePtr + 12, 'i32');
        const height  = m.getValue(framePtr + 16, 'i32');
        const strideY = m.getValue(framePtr + 20, 'i32');
        const strideC = m.getValue(framePtr + 24, 'i32');
        const cw      = m.getValue(framePtr + 28, 'i32');
        const ch      = m.getValue(framePtr + 32, 'i32');
        const bd      = m.getValue(framePtr + 36, 'i32');
        const poc     = m.getValue(framePtr + 40, 'i32');

        // Copy planes out of WASM heap as transferable ArrayBuffers
        const bps     = m.getValue(framePtr + 48, 'i32');
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
