/**
 * HEVC Decoder — JavaScript wrapper for the WASM module
 * Usage:
 *   const decoder = await HEVCDecoder.create();
 *   const frames = await decoder.decode(uint8Array);
 *   // frames[i] = { y, cb, cr, width, height, ... }
 *   decoder.destroy();
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
                      'chroma_width', 'chroma_height', 'bit_depth', 'poc',
                      'bytes_per_sample', '_size']) {
    if (!Number.isInteger(offset[name])) {
      throw new Error('HEVCFrame layout: missing or invalid ' + name);
    }
  }
  return { offset, size: offset._size };
}

export class HEVCDecoder {
  constructor(module) {
    this._m = module;
    this._dec = null;
    this._api = {
      create: module.cwrap('hevc_decoder_create', 'number', []),
      destroy: module.cwrap('hevc_decoder_destroy', null, ['number']),
      decode: module.cwrap('hevc_decoder_decode', 'number', ['number', 'number', 'number']),
      getFrameCount: module.cwrap('hevc_decoder_get_frame_count', 'number', ['number']),
      getFrame: module.cwrap('hevc_decoder_get_frame', 'number', ['number', 'number', 'number']),
      getInfo: module.cwrap('hevc_decoder_get_info', 'number', ['number', 'number']),
      frameLayout: module.cwrap('hevc_frame_layout', 'string', []),
    };
    this._layout = parseFrameLayout(this._api.frameLayout());
    this._dec = this._api.create();
    if (!this._dec) throw new Error('Failed to create decoder');
  }

  /**
   * Create a new decoder instance
   * @param {string} [wasmPath] - path to hevc-decode.js module
   */
  static async create(wasmPath) {
    const factory = wasmPath
      ? (await import(wasmPath)).default
      : (await import('./hevc-decode.js')).default;
    const module = await factory();
    return new HEVCDecoder(module);
  }

  /**
   * Decode a complete HEVC bitstream
   * @param {Uint8Array} data - raw .265 bitstream
   * @returns {{ frames: HEVCFrame[], info: HEVCStreamInfo }}
   */
  decode(data) {
    const m = this._m;
    const ptr = m._malloc(data.length);
    try {
      m.HEAPU8.set(data, ptr);
      const ret = this._api.decode(this._dec, ptr, data.length);
      if (ret !== 0) throw new Error('Decode failed (code ' + ret + ')');

      const count = this._api.getFrameCount(this._dec);
      const frames = [];
      for (let i = 0; i < count; i++) {
        frames.push(this._extractFrame(i));
      }

      const info = this._extractInfo();
      return { frames, info };
    } finally {
      m._free(ptr);
    }
  }

  /** Extract a decoded frame as typed arrays (copies data out of WASM heap) */
  _extractFrame(index) {
    const m = this._m;
    const at = this._layout.offset;
    const framePtr = m._malloc(this._layout.size);
    try {
      const ret = this._api.getFrame(this._dec, index, framePtr);
      if (ret !== 0) return null;

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

      // Copy plane data out of WASM heap (contiguous rows)
      const bps     = m.getValue(framePtr + at.bytes_per_sample, 'i32');
      const y  = this._copyPlane(m, yPtr, width, height, strideY, bps);
      const cb = this._copyPlane(m, cbPtr, cw, ch, strideC, bps);
      const cr = this._copyPlane(m, crPtr, cw, ch, strideC, bps);

      return { y, cb, cr, width, height, chromaWidth: cw, chromaHeight: ch, bitDepth: bd, poc };
    } finally {
      m._free(framePtr);
    }
  }

  /** Copy a plane out of the WASM heap, handling stride != width; bytesPerSample 1 is an 8-bit picture */
  _copyPlane(m, ptr, width, height, stride, bytesPerSample) {
    const out = new Uint16Array(width * height);
    const heap = bytesPerSample === 1 ? m.HEAPU8 : m.HEAPU16;
    const base = bytesPerSample === 1 ? ptr : ptr >> 1;
    for (let y = 0; y < height; y++) {
      const src = heap.subarray(base + y * stride, base + y * stride + width);
      out.set(src, y * width);
    }
    return out;
  }

  /** Extract stream info */
  _extractInfo() {
    const m = this._m;
    const infoPtr = m._malloc(24);
    try {
      const ret = this._api.getInfo(this._dec, infoPtr);
      if (ret !== 0) return null;
      return {
        width:        m.getValue(infoPtr, 'i32'),
        height:       m.getValue(infoPtr + 4, 'i32'),
        bitDepth:     m.getValue(infoPtr + 8, 'i32'),
        chromaFormat: m.getValue(infoPtr + 12, 'i32'),
        profile:      m.getValue(infoPtr + 16, 'i32'),
        level:        m.getValue(infoPtr + 20, 'i32'),
      };
    } finally {
      m._free(infoPtr);
    }
  }

  /** Release decoder resources */
  destroy() {
    if (this._dec) {
      this._api.destroy(this._dec);
      this._dec = null;
    }
  }
}
