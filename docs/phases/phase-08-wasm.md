# Phase 8 — WebAssembly Integration

## Goal
Run the decoder in a browser via WebAssembly, with a clean JS API and a Web Worker.

## Prerequisites
Phase 6 at minimum (Main profile). Can start in parallel with Phase 7.

## Tasks

### 8.1 — Embedding C API
- [ ] Clean C interface (no C++ in the public API):
  ```c
  HEVCDecoder* hevc_decoder_create(void);
  void hevc_decoder_destroy(HEVCDecoder* dec);
  int hevc_decoder_feed(HEVCDecoder* dec, const uint8_t* data, size_t size);
  int hevc_decoder_get_frame(HEVCDecoder* dec, HEVCFrame* frame);
  void hevc_decoder_flush(HEVCDecoder* dec);
  int hevc_decoder_get_info(HEVCDecoder* dec, HEVCStreamInfo* info);
  ```
- [ ] `HEVCFrame` structure : pointers to the Y/Cb/Cr planes, dimensions, stride, POC
- [ ] `HEVCStreamInfo` structure : dimensions, profile, level, bit depth, chroma format
- [ ] Incremental feeding support (no need to have the whole file)

### 8.2 — Emscripten build
- [ ] Emscripten CMake toolchain
- [ ] WASM compilation options:
  - `-s WASM=1`
  - `-s ALLOW_MEMORY_GROWTH=1`
  - `-s MODULARIZE=1`
  - `-s EXPORT_NAME=HEVCDecoder`
  - `-s EXPORTED_FUNCTIONS=[...]`
  - `-O3` for performance
- [ ] Optimised .wasm size (strip, -Os if perf is OK)
- [ ] Check that the WASM build produces the same results as the native build

### 8.3 — JavaScript bindings
- [ ] JS wrapper around the C functions (cwrap or Embind)
- [ ] WASM memory management (malloc/free for the data buffers)
- [ ] Promise-based JS API:
  ```js
  const decoder = await HEVCDecoder.create();
  decoder.feed(uint8Array);
  const frame = decoder.getFrame(); // { y, cb, cr, width, height, ... }
  decoder.destroy();
  ```

### 8.4 — Web Worker
- [ ] Decoding in a Web Worker (no blocking of the main thread)
- [ ] Communication via postMessage
- [ ] Frame transfer via Transferable (or SharedArrayBuffer)
- [ ] Message protocol:
  ```
  Main -> Worker : { type: 'feed', data: ArrayBuffer }
  Main -> Worker : { type: 'flush' }
  Worker -> Main : { type: 'frame', frame: { y, cb, cr, ... } }
  Worker -> Main : { type: 'info', info: { width, height, ... } }
  Worker -> Main : { type: 'error', message: string }
  ```

### 8.5 — Rendering
- [ ] Option 1 : YUV -> RGB conversion in JS/WASM, then Canvas 2D
- [ ] Option 2 : YUV -> WebGL (better perf, conversion in the shader)
- [ ] YUV -> RGB shader:
  ```glsl
  // BT.709 (HD/4K)
  vec3 yuv = vec3(texY, texCb - 0.5, texCr - 0.5);
  vec3 rgb = mat3(1.0, 1.0, 1.0,
                  0.0, -0.187, 1.856,
                  1.575, -0.468, 0.0) * yuv;
  ```
- [ ] Chroma upsampling handling (4:2:0 -> 4:4:4 for display)

### 8.6 — HTML demo
- [ ] Minimal HTML page with:
  - File input to load a .265
  - Canvas to display the frames
  - Play/pause/step controls
  - Info : dimensions, profile, FPS, frame count
- [ ] Streaming : progressive file reading (fetch + ReadableStream)

### 8.7 — Memory Management
- [ ] Buffer pool for the frames (avoid malloc/free per frame)
- [ ] Reasonable WASM memory limit (128MB initial, growth)
- [ ] Monitoring of the memory used

## Exit criterion

- Working HTML demo that decodes and displays a .265 file
- Works on Chrome and Firefox
- No memory crash on long sequences
- The frames are identical to the native build (no WASM regression)

## Complexity estimate
Moderate. The decoding code already exists. It is mainly integration and plumbing.
