"use strict";
(() => {
  // packages/core/dist/chunk-VSR3TVES.js
  var HEVCDecoder = class _HEVCDecoder {
    constructor(module) {
      this._m = module;
      this._api = {
        create: module.cwrap("hevc_decoder_create", "number", []),
        destroy: module.cwrap("hevc_decoder_destroy", null, ["number"]),
        decode: module.cwrap("hevc_decoder_decode", "number", ["number", "number", "number"]),
        getFrameCount: module.cwrap("hevc_decoder_get_frame_count", "number", ["number"]),
        getFrame: module.cwrap("hevc_decoder_get_frame", "number", ["number", "number", "number"]),
        getInfo: module.cwrap("hevc_decoder_get_info", "number", ["number", "number"]),
        feed: module.cwrap("hevc_decoder_feed", "number", ["number", "number", "number"]),
        drain: module.cwrap("hevc_decoder_drain", "number", ["number", "number"]),
        getDrainedFrame: module.cwrap("hevc_decoder_get_drained_frame", "number", ["number", "number", "number"]),
        flush: module.cwrap("hevc_decoder_flush", "number", ["number"]),
        getSuppressedPictureCount: module.cwrap("hevc_decoder_get_suppressed_picture_count", "number", ["number"]),
        takeSuppressedPictures: module.cwrap("hevc_decoder_take_suppressed_pictures", "number", ["number", "number", "number"])
      };
      this._dec = this._api.create();
      if (!this._dec) throw new Error("Failed to create HEVC decoder");
    }
    /**
     * Create a new decoder instance. Loads the WASM module.
     */
    static async create(options) {
      const factoryOpts = {};
      if (options?.wasmBinaryUrl) {
        factoryOpts.locateFile = () => options.wasmBinaryUrl;
      }
      const g = globalThis;
      if (typeof g.HEVCDecoderModule === "function") {
        const module2 = await g.HEVCDecoderModule(factoryOpts);
        return new _HEVCDecoder(module2);
      }
      const wasmUrl = options?.wasmUrl ?? "./wasm/hevc-decode.js";
      const mod = await import(
        /* @vite-ignore */
        wasmUrl
      );
      const fn = mod.default ?? mod;
      const module = await fn(factoryOpts);
      return new _HEVCDecoder(module);
    }
    /**
     * Decode a complete HEVC bitstream.
     * @param data Raw .265 bitstream bytes
     */
    decode(data) {
      const m = this._m;
      const ptr = m._malloc(data.length);
      try {
        m.HEAPU8.set(data, ptr);
        const ret = this._api.decode(this._dec, ptr, data.length);
        if (ret !== 0) throw new Error(`Decode failed (code ${ret})`);
        const count = this._api.getFrameCount(this._dec);
        const frames = [];
        for (let i = 0; i < count; i++) {
          const frame = this._extractFrame(i);
          if (frame) frames.push(frame);
        }
        const info = this._extractInfo();
        return { frames, info };
      } finally {
        m._free(ptr);
      }
    }
    /** Number of decoded frames available */
    get frameCount() {
      return this._api.getFrameCount(this._dec);
    }
    /** Get stream info (available after decode) */
    get info() {
      return this._extractInfo();
    }
    _extractFrame(index) {
      const m = this._m;
      const framePtr = m._malloc(52);
      try {
        const ret = this._api.getFrame(this._dec, index, framePtr);
        if (ret !== 0) return null;
        return this._readFrameFromPtr(framePtr);
      } finally {
        m._free(framePtr);
      }
    }
    _extractDrainedFrame(index) {
      const m = this._m;
      const framePtr = m._malloc(52);
      try {
        const ret = this._api.getDrainedFrame(this._dec, index, framePtr);
        if (ret !== 0) return null;
        return this._readFrameFromPtr(framePtr);
      } finally {
        m._free(framePtr);
      }
    }
    _readFrameFromPtr(framePtr) {
      const m = this._m;
      const yPtr = m.getValue(framePtr, "*");
      const cbPtr = m.getValue(framePtr + 4, "*");
      const crPtr = m.getValue(framePtr + 8, "*");
      const width = m.getValue(framePtr + 12, "i32");
      const height = m.getValue(framePtr + 16, "i32");
      const strideY = m.getValue(framePtr + 20, "i32");
      const strideC = m.getValue(framePtr + 24, "i32");
      const cw = m.getValue(framePtr + 28, "i32");
      const ch = m.getValue(framePtr + 32, "i32");
      const bd = m.getValue(framePtr + 36, "i32");
      const poc = m.getValue(framePtr + 40, "i32");
      const cvsId = m.getValue(framePtr + 44, "i32");
      const bps = m.getValue(framePtr + 48, "i32");
      const y = copyPlane(m, yPtr, width, height, strideY, bps);
      const cb = copyPlane(m, cbPtr, cw, ch, strideC, bps);
      const cr = copyPlane(m, crPtr, cw, ch, strideC, bps);
      return { y, cb, cr, width, height, chromaWidth: cw, chromaHeight: ch, bitDepth: bd, poc, cvsId };
    }
    _extractInfo() {
      const m = this._m;
      const infoPtr = m._malloc(24);
      try {
        const ret = this._api.getInfo(this._dec, infoPtr);
        if (ret !== 0) return null;
        return {
          width: m.getValue(infoPtr, "i32"),
          height: m.getValue(infoPtr + 4, "i32"),
          bitDepth: m.getValue(infoPtr + 8, "i32"),
          chromaFormat: m.getValue(infoPtr + 12, "i32"),
          profile: m.getValue(infoPtr + 16, "i32"),
          level: m.getValue(infoPtr + 20, "i32")
        };
      } finally {
        m._free(infoPtr);
      }
    }
    // --- Incremental API (streaming) ---
    /**
     * Feed a chunk of data containing one or more complete NAL units.
     * The decoder accumulates parameter sets and decodes pictures incrementally.
     * Call drain() after each feed() to retrieve output-ready frames.
     */
    feed(data) {
      const m = this._m;
      const ptr = m._malloc(data.length);
      try {
        m.HEAPU8.set(data, ptr);
        const ret = this._api.feed(this._dec, ptr, data.length);
        if (ret !== 0) throw new Error(`Feed failed (code ${ret})`);
      } finally {
        m._free(ptr);
      }
    }
    /**
     * Drain output-ready frames from the decoder (§C.5.2 bumping process).
     * Returns frames in display order, only when ready per DPB constraints.
     *
     * Planes are copied out of the WASM heap, so the returned frames stay
     * valid across later feed() and destroy() calls. Draining after every
     * feed() is what keeps the DPB at its bound — the decoder cannot reclaim
     * a picture before it has been bumped out. See docs/memory-envelope.md.
     */
    drain() {
      const m = this._m;
      const countPtr = m._malloc(4);
      try {
        const ret = this._api.drain(this._dec, countPtr);
        if (ret !== 0) return [];
        const count = m.getValue(countPtr, "i32");
        const frames = [];
        for (let i = 0; i < count; i++) {
          const frame = this._extractDrainedFrame(i);
          if (frame) frames.push(frame);
        }
        return frames;
      } finally {
        m._free(countPtr);
      }
    }
    /**
     * Flush all remaining frames from the DPB (call at end of stream).
     * Returns all buffered frames in display order.
     */
    flush() {
      const ret = this._api.flush(this._dec);
      if (ret !== 0) return [];
      const m = this._m;
      const countPtr = m._malloc(4);
      try {
        const frames = [];
        const framePtr = m._malloc(52);
        try {
          for (let i = 0; ; i++) {
            const r = this._api.getDrainedFrame(this._dec, i, framePtr);
            if (r !== 0) break;
            frames.push(this._readFrameFromPtr(framePtr));
          }
        } finally {
          m._free(framePtr);
        }
        return frames;
      } finally {
        m._free(countPtr);
      }
    }
    /**
     * The pictures decoded since the last call that will never be output:
     * PicOutputFlag was 0 (§C.3.1, §8.1), or a new sequence emptied them from
     * the DPB without output (§C.5.2.2). Empties the list.
     *
     * A caller that maps output frames onto per-sample timestamps needs these:
     * the sample that carried such a picture produces no frame, and without
     * knowing which one it was, every later frame of the segment takes the
     * timestamp of its predecessor. Each one comes with its CVS, since POC
     * restarts at every IRAP and alone cannot order pictures across one.
     */
    takeSuppressedPictures() {
      const m = this._m;
      const count = this._api.getSuppressedPictureCount(this._dec);
      if (count <= 0) return [];
      const ptr = m._malloc(count * 8);
      try {
        const written = this._api.takeSuppressedPictures(this._dec, ptr, count);
        if (written < 0) return [];
        const out = [];
        for (let i = 0; i < written; i++) {
          out.push({
            cvsId: m.getValue(ptr + i * 8, "i32"),
            poc: m.getValue(ptr + i * 8 + 4, "i32")
          });
        }
        return out;
      } finally {
        m._free(ptr);
      }
    }
    /** Release decoder resources */
    destroy() {
      if (this._dec) {
        this._api.destroy(this._dec);
        this._dec = 0;
      }
    }
  };
  function copyPlane(m, ptr, width, height, stride, bytesPerSample) {
    const out = new Uint16Array(width * height);
    const heap = bytesPerSample === 1 ? m.HEAPU8 : m.HEAPU16;
    const base = bytesPerSample === 1 ? ptr : ptr >> 1;
    for (let y = 0; y < height; y++) {
      out.set(heap.subarray(base + y * stride, base + y * stride + width), y * width);
    }
    return out;
  }

  // packages/mediabunny-plugin/src/bitstream.ts
  function packetToAnnexB(data, nalLengthSize) {
    if (nalLengthSize === 0) return data;
    const nalUnits = [];
    let off = 0;
    while (off + nalLengthSize <= data.byteLength) {
      let size = 0;
      for (let i = 0; i < nalLengthSize; i++) size = size * 256 + data[off + i];
      off += nalLengthSize;
      if (off + size > data.byteLength) throw new Error("NAL unit overruns its packet");
      nalUnits.push(data.subarray(off, off + size));
      off += size;
    }
    return joinAnnexB(nalUnits);
  }
  function joinAnnexB(nalUnits) {
    const out = new Uint8Array(nalUnits.reduce((sum, n) => sum + 4 + n.byteLength, 0));
    let off = 0;
    for (const nal of nalUnits) {
      out[off + 3] = 1;
      out.set(nal, off + 4);
      off += 4 + nal.byteLength;
    }
    return out;
  }

  // packages/mediabunny-plugin/src/frames.ts
  function packFrame(frame, i420p10) {
    const ySize = frame.y.length;
    const cSize = frame.cb.length;
    const { width, height, cvsId, poc } = frame;
    if (frame.bitDepth === 10 && i420p10) {
      const data2 = new Uint16Array(ySize + 2 * cSize);
      data2.set(frame.y);
      data2.set(frame.cb, ySize);
      data2.set(frame.cr, ySize + cSize);
      return { format: "I420P10", data: data2, width, height, cvsId, poc };
    }
    const data = new Uint8Array(ySize + 2 * cSize);
    if (frame.bitDepth > 8) {
      const shift = frame.bitDepth - 8;
      let off = 0;
      for (const plane of [frame.y, frame.cb, frame.cr]) {
        for (let i = 0; i < plane.length; i++) data[off + i] = plane[i] >> shift;
        off += plane.length;
      }
    } else {
      data.set(frame.y);
      data.set(frame.cb, ySize);
      data.set(frame.cr, ySize + cSize);
    }
    return { format: "I420", data, width, height, cvsId, poc };
  }

  // packages/mediabunny-plugin/src/decode-worker.ts
  function createDecodeWorkerHandler(post) {
    let decoder = null;
    let nalLengthSize = 0;
    let i420p10 = false;
    const handle = async (message) => {
      switch (message.type) {
        case "init": {
          if (typeof importScripts === "function") importScripts(message.wasmUrl);
          decoder = await HEVCDecoder.create({ wasmBinaryUrl: message.wasmBinaryUrl });
          nalLengthSize = message.nalLengthSize;
          i420p10 = message.i420p10;
          if (message.parameterSets) decoder.feed(message.parameterSets);
          post({ type: "ready" }, []);
          break;
        }
        case "decode": {
          decoder.feed(packetToAnnexB(new Uint8Array(message.data), nalLengthSize));
          const suppressed = decoder.takeSuppressedPictures();
          const frames = decoder.drain().map((frame) => packFrame(frame, i420p10));
          post({ type: "output", suppressed, frames }, buffersOf(frames));
          break;
        }
        case "flush": {
          const frames = decoder.flush().map((frame) => packFrame(frame, i420p10));
          post({ type: "flushed", frames }, buffersOf(frames));
          break;
        }
        case "close":
          decoder?.destroy();
          decoder = null;
          break;
      }
    };
    let queue = Promise.resolve();
    return (message) => {
      queue = queue.then(() => handle(message)).catch((error) => {
        post({ type: "error", message: error instanceof Error ? error.message : String(error) }, []);
      });
      return queue;
    };
  }
  function buffersOf(frames) {
    return frames.map((frame) => frame.data.buffer);
  }
  if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
    const handle = createDecodeWorkerHandler((message, transfer) => self.postMessage(message, transfer));
    self.onmessage = (event) => void handle(event.data);
  }
})();
//# sourceMappingURL=mediabunny-decode-worker.js.map
