# hevc.js

[![Build](https://github.com/privaloops/hevc.js/actions/workflows/build.yml/badge.svg)](https://github.com/privaloops/hevc.js/actions/workflows/build.yml)
[![Tests](https://github.com/privaloops/hevc.js/actions/workflows/test.yml/badge.svg)](https://github.com/privaloops/hevc.js/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm downloads core](https://img.shields.io/npm/dw/@hevcjs/core?label=core)](https://www.npmjs.com/package/@hevcjs/core)
[![npm downloads plugin](https://img.shields.io/npm/dw/@hevcjs/dashjs-plugin?label=dashjs-plugin)](https://www.npmjs.com/package/@hevcjs/dashjs-plugin)

##### [English](./README.md) | 简体中文

**让浏览器在没有原生支持的情况下播放 HEVC/H.265 视频。无需插件,无需安装,无需修改服务器配置。**

一个用 C++17 从零开始编写的 HEVC 解码器,编译为 WebAssembly,并附带一个开箱即用的 dash.js 插件。在 Web Worker 中通过 WebCodecs 实时将 HEVC 转码为 H.264,完全在客户端完成。可在所有支持 WebCodecs H.264 编码的 Chrome、Edge 和 Firefox 上运行。

1080p @ 60fps。WASM 体积仅 236KB。零依赖。无需特殊服务器标头。

由一名开发者在 AI 协助下用 8 天构建完成 — [阅读完整故事](https://www.developpement.ai/blog/hevcjs-decodeur-h265-navigateur-wasm)。

---

## JavaScript 插件

### 安装

```bash
npm install @hevcjs/dashjs-plugin
```

### 配置

插件依赖 `@hevcjs/core`(作为传递依赖自动安装)中的 3 个静态文件,这些文件必须由你的 Web 服务器提供:

- `transcode-worker.js` — Web Worker(IIFE 格式,独立运行)
- `wasm/hevc-decode.js` — Emscripten 胶水代码
- `wasm/hevc-decode.wasm` — WASM 二进制文件(236KB)

将它们从 `node_modules/@hevcjs/core/dist/` 复制到你的公共目录:

```bash
cp node_modules/@hevcjs/core/dist/transcode-worker.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.wasm public/
```

在下方示例中通过 `workerUrl` 传入 Worker 文件的路径。Worker 会自动从同一目录加载 `hevc-decode.js` 和 `.wasm`。

### dash.js

```js
import dashjs from 'dashjs';
import { attachHevcSupport } from '@hevcjs/dashjs-plugin';

const player = dashjs.MediaPlayer().create();
attachHevcSupport(player, { workerUrl: './transcode-worker.js' });
player.initialize(videoElement, 'https://example.com/manifest.mpd', true);
```

### 转码工作原理

1. **MSE 拦截** — 在播放器初始化前对 `MediaSource.addSourceBuffer()` 打补丁。当播放器创建 HEVC SourceBuffer 时,我们返回一个代理对象,它接收 HEVC 数据但向真正的 SourceBuffer 推送 H.264。

2. **Worker 流水线** — 所有重活都在 Web Worker 中执行:
   - **解封装**:mp4box.js 从 fMP4 分片中提取原始 HEVC NAL 单元
   - **解码**:WASM 解码器输出 YUV 帧(符合规范,逐像素精确)
   - **编码**:WebCodecs `VideoEncoder` 将其压缩为 H.264
   - **封装**:自定义 fMP4 muxer 用正确的时间戳将 H.264 包装为 ISO BMFF

3. **对播放器透明** — 代理会上报 `updating` 状态,触发 `updatestart`/`updateend` 事件,并返回真实的 `buffered` 范围。播放器的缓冲管理、ABR 逻辑和 seek 处理都无需修改即可正常工作。

**权衡**:软件回退会在第一个分片上引入 2-3 秒的启动延迟(相比原生硬件解码的即时播放)。一旦缓冲完成,播放是流畅的。当原生 HEVC 可用时,hevc.js 会检测到并不做任何处理。

### 浏览器兼容性

hevc.js 在客户端将 HEVC 转码为 H.264。这需要浏览器提供两样东西:**WebAssembly**(用于运行 HEVC 解码器)和 **支持 H.264 的 WebCodecs VideoEncoder**(用于重新编码解码后的帧)。当原生 HEVC 可用时,插件检测到后不做任何事 — 零开销。

**检测策略**:`MediaSource.isTypeSupported()` 可能会撒谎(Windows 上的 Firefox 即使没有安装 HEVC 视频扩展也会上报 HEVC 支持)。hevc.js 通过实际创建一个 SourceBuffer 来验证原生支持 — 如果失败,就回退到转码。

每个浏览器在 Windows 上都有自己的解码路径,依赖也各不相同:

- **Chrome 107+(Windows)** 直接使用 `D3D11VideoDecoder` → D3D11VA(DXVA)。**无需 Microsoft 扩展。** 需要支持 HEVC 硬件解码的 GPU(Intel Skylake 2015+、NVIDIA Maxwell 2nd gen / GTX 960 2015+、AMD Fiji / R9 Fury 2015+)。没有软件回退 — 如果 GPU 无法解码 HEVC,Chrome 就无法播放。Chrome < 130 还有 1920×1088 @ 30fps 的上限。
- **Edge(Windows)** 使用 `VDAVideoDecoder` → MFT(Media Foundation)。**需要 Microsoft [HEVC 视频扩展](https://apps.microsoft.com/detail/9nmzlz57r3t7)**(应用商店约 ¥6)。没有它,无论 GPU 如何都没有 HEVC。
- **Firefox 133+(Windows)** 也使用 MFT,对 Microsoft HEVC 视频扩展有相同的依赖。
- **macOS(Safari / Chrome / Edge / Firefox)** 通过 VideoToolbox 原生解码 HEVC。无需扩展。

| 浏览器 + 系统 + 条件 | 原生 HEVC | hevc.js 激活? | 转码可用? | 说明 |
|---|---|---|---|---|
| **Safari 13+**(macOS/iOS) | 是(VideoToolbox) | 否 — 原生 | — | 通过 macOS/iOS 硬件解码 |
| **Chrome/Edge/Firefox**(Mac) | 是(VideoToolbox) | 否 — 原生 | — | 通过 macOS 原生解码 |
| **Chrome 107+**(Win,支持 HEVC 的 GPU) | 是(D3D11VA) | 否 — 原生 | — | 直接 GPU 解码,无需扩展 |
| **Chrome 107+**(Win,GPU 不支持 HEVC) | 否 | **是** | **是** | Chrome 没有 HEVC 软件回退 |
| **Edge**(Win,装了 HEVC 视频扩展) | 是(MFT) | 否 — 原生 | — | 需要 Microsoft [HEVC 视频扩展](https://apps.microsoft.com/detail/9nmzlz57r3t7) |
| **Edge**(Win,无扩展) | 否 | **是** | **是** | MFT 没有扩展时无解码器 |
| **Firefox 133+**(Win,装了 HEVC 视频扩展) | 是(MFT) | 否 — 原生 | — | 需要 Microsoft 扩展 |
| **Firefox 133+**(Win,无扩展) | 上报但是假的 | **是** | **是** | SourceBuffer 探测会捕获这个误报,回退到转码 |
| **Chrome/Edge 94–106** | 否 | **是** | **是** | 浏览器尚未支持 HEVC,但 WebCodecs H.264 编码器已可用 |
| **Chrome/Edge < 94** | 否 | 否 | 否 | 没有 WebCodecs — 直接提供 AVC 内容 |
| **Chrome**(Linux,启用 VAAPI) | 视情况 | 有时 | **是** | 取决于驱动和 GPU |
| **Chrome**(Linux,无 VAAPI) | 否 | **是** | **是** | 通过 WebCodecs 进行软件 H.264 编码 |
| **Firefox**(Linux) | 否 | **是** | 视情况 | 需要通过 WebCodecs 提供可用的 H.264 编码器 — 在无头/虚拟机环境下会失败 |

**要求**(所有现代浏览器都支持):
- **WebAssembly** + **Web Workers**
- **安全上下文**(HTTPS 或 localhost)— WebCodecs 在普通 HTTP 下不可用
- **支持 H.264 的 WebCodecs VideoEncoder** — 这是主要的限制因素

无需 `Cross-Origin-Embedder-Policy` 或 `Cross-Origin-Opener-Policy` 标头 — WASM 解码器是单线程的,不使用 `SharedArrayBuffer`。可在任何静态文件服务器上工作。

---

## C/C++ 解码器

### 为什么要从零开始写一个解码器?

[libde265](https://github.com/strukturag/libde265) 已经存在,成熟,而且能用。那为什么还要再写一个 HEVC 解码器?

这个实现在三个维度上瞄准了不同的细分市场:

- **体积** — 编译为 WASM 后只有 236 KB,而 libde265 编译到 WASM 大约 2 MB。**小 8 倍** — 这在向浏览器、microVM 或沙盒运行时分发时很关键。
- **现代化与许可证** — 全代码使用 C++17(`std::optional`、`std::shared_ptr`、`std::array`、`constexpr`),单线程,零依赖,**MIT 许可证**(libde265 是 LGPL — 这对在商业产品中静态链接很重要)。
- **规范可追溯性** — 函数命名直接对应 ITU-T H.265 规范的章节号,且 [`docs/cross-reference.md`](docs/cross-reference.md) 把每个规范章节映射到对应的源文件和测试。如果你想 *理解* HEVC 而不只是解码它,这很有用(高校、编解码器研究、贡献者)。

这 **不是 libde265 的替代品** — libde265 在纯原生环境下更快,且在生产环境中久经考验(GStreamer、VLC、libheif、FFmpeg 回退)。但对于在浏览器、microVM 和沙盒环境中嵌入,当二进制大小、许可证或可读性比最后那 20% 的原生吞吐量更重要时,这个解码器是一个可行的替代方案。

### C API

```c
#include "wasm/hevc_api.h"

HEVCDecoder* dec = hevc_decoder_create();
hevc_decoder_decode(dec, data, size);

int count = hevc_decoder_get_frame_count(dec);
for (int i = 0; i < count; i++) {
    HEVCFrame frame;
    hevc_decoder_get_frame(dec, i, &frame);
    // frame.y / frame.cb / frame.cr — YUV 平面(uint16_t*)
    // frame.width / frame.height — 亮度尺寸
    // frame.bit_depth — 8 或 10
}

hevc_decoder_destroy(dec);
```

### API 参考

```c
// 生命周期
HEVCDecoder* hevc_decoder_create(void);
void          hevc_decoder_destroy(HEVCDecoder* dec);

// 解码完整的 HEVC 比特流(Annex B 格式)
int hevc_decoder_decode(HEVCDecoder* dec, const uint8_t* data, size_t size);

// 增量解码(逐步喂入 NAL 单元)
int hevc_decoder_feed(HEVCDecoder* dec, const uint8_t* data, size_t size);
int hevc_decoder_drain(HEVCDecoder* dec);

// 访问已解码的帧(显示顺序)
int hevc_decoder_get_frame_count(HEVCDecoder* dec);
int hevc_decoder_get_frame(HEVCDecoder* dec, int index, HEVCFrame* frame);
```

| HEVCFrame 字段 | 类型 | 说明 |
|---|---|---|
| `y`、`cb`、`cr` | `const uint16_t*` | YUV 平面指针 |
| `width`、`height` | `int` | 亮度尺寸(已应用 conformance window) |
| `stride_y`、`stride_c` | `int` | 平面 stride(以采样为单位) |
| `bit_depth` | `int` | 8 或 10 |
| `poc` | `int` | 图像顺序计数(显示顺序) |

### 构建

#### 原生(调试 + 测试)

```bash
cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
cd build && ctest --output-on-failure    # 128 个测试
```

#### WebAssembly

需要 [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)。

```bash
source ~/emsdk/emsdk_env.sh
emcmake cmake -B build-wasm -DBUILD_WASM=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build-wasm
# 输出:build-wasm/hevc-decode.js + hevc-decode.wasm(236KB)
```

### 性能

单线程,Apple Silicon(M 系列):

| | 原生 C++ | WASM(Chrome) | 对比 libde265(WASM) |
|---|---|---|---|
| **1080p 解码** | 76 fps | 61 fps | libde265 速度的 **83%** |
| **4K 解码** | 28 fps | 21 fps | — |
| **1080p 转码** | — | ~2.5 倍实时(6 秒分片用 2.4 秒处理) | — |

WASM 解码器的性能在原生 C++ 性能的 20% 以内,在两者都编译为 WASM 时,达到了 **libde265 速度的 83%**(libde265 是一个成熟的、经过 10 年优化的 HEVC 解码器)— 而二进制大小只有 **1/8**(236 KB vs ~2 MB)。

### 规范一致性

按 **ITU-T H.265(v8,08/2021)** 实现 — 716 页规范直接转录为代码。在 128 个测试比特流上与 ffmpeg 进行了逐像素对比验证。每个规范章节都在 [`docs/cross-reference.md`](docs/cross-reference.md) 中 1:1 映射到对应的源文件和测试。

| 特性 | 状态 |
|---|---|
| CABAC 算术解码(§9.3) | 完成 |
| 35 种帧内预测模式(§8.4) | 完成 |
| 帧间预测 — merge、AMVP、TMVP(§8.5) | 完成 |
| 8-tap 亮度 / 4-tap 色度插值(§8.5.3) | 完成 |
| 加权预测 — 默认 + 显式(§8.5.3.3) | 完成 |
| 反变换 — DCT 4-32、DST 4(§8.6) | 完成 |
| 缩放列表(§8.6.3) | 完成 |
| 去块滤波(§8.7.2) | 完成 |
| SAO — 边缘 + 带偏移(§8.7.3) | 完成 |
| 10-bit 解码(Main 10 profile) | 完成 |
| 多 slice(dependent + independent) | 完成 |
| Tiles | 已解析 + 顺序解码 |
| WPP(波前并行处理) | 完成 |

---

## 架构

```
hevc.js/
├── src/                    C++17 HEVC 解码器(符合 ITU-T H.265 规范)
│   ├── bitstream/          Annex B 解析、NAL 单元、RBSP、Exp-Golomb
│   ├── syntax/             VPS、SPS、PPS、slice header 解析
│   ├── decoding/           CABAC、coding tree、帧内/帧间预测、变换
│   ├── filters/            去块滤波、SAO
│   ├── common/             类型、Picture 缓冲区、线程池
│   └── wasm/               C API、Emscripten 绑定
│
├── packages/
│   ├── core/               @hevcjs/core — WASM 解码器 + 转码流水线
│   └── dashjs-plugin/      @hevcjs/dashjs-plugin — dash.js 插件
│
├── demo/                   浏览器 demo(DASH)
└── tests/                  单元测试 + 128 个 oracle 测试(逐像素对比 ffmpeg)
```

## Demo

**[在线 demo](https://hevcjs.dev/demo/)** — 在浏览器中试用每个插件:

| Demo | 说明 |
|---|---|
| [Decoder](https://hevcjs.dev/demo/) | 原始 WASM 解码器 — 拖一个 .265 文件,逐帧播放 |
| [dash.js](https://hevcjs.dev/demo/dash.html) | 通过 dash.js + WASM 转码播放 HEVC DASH 流 |

每个 demo 都包含一个 **"Force transcoding"** 开关,用于绕过原生 HEVC 检测 — 这在已经支持 HEVC 的浏览器上测试 WASM 流水线时很有用。

### 本地运行

```bash
pnpm install
pnpm build:demo     # 构建 WASM + JS bundle + 复制资源
npx serve demo      # 打开 http://localhost:3000
```

## 贡献者

感谢以下人员([emoji 含义](https://allcontributors.org/docs/en/emoji-key)):

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/privaloops">
        <img src="https://github.com/privaloops.png" width="80" alt="privaloops" /><br />
        <sub><b>Thibaut Lion</b></sub>
      </a><br />
      💻 📖 🤔 👀 🚇 ⚠️ 🚧
    </td>
    <td align="center">
      <a href="https://github.com/kasty">
        <img src="https://github.com/kasty.png" width="80" alt="kasty" /><br />
        <sub><b>Marie</b></sub>
      </a><br />
      🤔 👀 ⚠️
    </td>
  </tr>
</table>

## 许可证

MIT — 详见 [LICENSE](LICENSE)。

HEVC/H.265 可能涉及由 Access Advance 等专利池管理的专利。本软件是一个独立实现,不包含也不授予任何专利许可。用户有责任在其所在司法管辖区和使用场景下评估专利义务。

媒体样本使用 [Big Buck Bunny](https://peach.blender.org/)(CC-BY 3.0,Blender Foundation)。完整归属说明请参见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
