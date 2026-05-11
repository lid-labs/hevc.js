/**
 * Web Worker for SegmentTranscoder.
 *
 * Runs the heavy HEVC→H.264 transcoding pipeline off the main thread:
 *   mp4box.js demux → WASM decode → WebCodecs encode → fMP4 mux
 *
 * Communication protocol (postMessage):
 *   Main → Worker:
 *     { type: "init", config }
 *     { type: "initSegment", data: ArrayBuffer }
 *     { type: "mediaSegment", data: ArrayBuffer, id: number }
 *     { type: "prepareInit", data: ArrayBuffer, id: number }
 *
 *   Worker → Main:
 *     { type: "ready" }
 *     { type: "initParsed" }
 *     { type: "initPrepared", id: number, initSegment: ArrayBuffer, codec: string }
 *     { type: "transcoded", id: number, h264: ArrayBuffer | null, initSegment?: ArrayBuffer, codec?: string }
 *     { type: "error", id: number, message: string }
 */

import { SegmentTranscoder } from "./segment-transcoder.js";
import type { SegmentTranscoderConfig } from "./segment-transcoder.js";

let transcoder: SegmentTranscoder | null = null;
let lastConfig: SegmentTranscoderConfig | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.type) {
    case "init": {
      try {
        const config = msg.config as SegmentTranscoderConfig;

        // In Worker context, load WASM glue via importScripts
        // This makes globalThis.HEVCDecoderModule available for HEVCDecoder.create()
        const wasmUrl = config.wasmUrl || "./hevc-decode.js";
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (self as any).importScripts(wasmUrl);
          console.log("[hevc.js/worker] WASM glue loaded via importScripts");
        } catch (err) {
          console.warn("[hevc.js/worker] importScripts failed, will try import():", (err as Error).message);
        }

        lastConfig = config;
        transcoder = new SegmentTranscoder(config);
        await transcoder.init();
        self.postMessage({ type: "ready" });
      } catch (err) {
        self.postMessage({ type: "error", id: -1, message: (err as Error).message });
      }
      break;
    }

    case "initSegment": {
      try {
        if (!transcoder) throw new Error("Transcoder not initialized");
        await transcoder.processInitSegment(new Uint8Array(msg.data));
        self.postMessage({ type: "initParsed" });
      } catch (err) {
        self.postMessage({ type: "error", id: -1, message: (err as Error).message });
      }
      break;
    }

    case "prepareInit": {
      try {
        if (!transcoder) throw new Error("Transcoder not initialized");
        const result = await transcoder.prepareInit(new Uint8Array(msg.data));
        const response: Record<string, unknown> = {
          type: "initPrepared",
          id: msg.id,
          initSegment: result.initSegment.buffer,
          codec: result.codec,
        };
        self.postMessage(response, [result.initSegment.buffer]);
      } catch (err) {
        self.postMessage({ type: "error", id: msg.id, message: (err as Error).message });
      }
      break;
    }

    case "mediaSegment": {
      try {
        if (!transcoder) throw new Error("Transcoder not initialized");
        const h264 = await transcoder.processMediaSegment(new Uint8Array(msg.data));

        const response: Record<string, unknown> = {
          type: "transcoded",
          id: msg.id,
          h264: h264 ? h264.buffer : null,
          perf: transcoder.lastPerfStats ? { ...transcoder.lastPerfStats } : null,
        };

        // Include H.264 init segment on first transcode
        const initResult = transcoder.initResult;
        if (initResult && msg.id === 0) {
          response.initSegment = initResult.initSegment.buffer;
          response.codec = initResult.codec;
        }

        // Transfer ArrayBuffers for zero-copy
        const transfers: ArrayBuffer[] = [];
        if (response.h264) transfers.push(response.h264 as ArrayBuffer);
        if (response.initSegment) transfers.push(response.initSegment as ArrayBuffer);

        self.postMessage(response, transfers);
      } catch (err) {
        self.postMessage({ type: "error", id: msg.id, message: (err as Error).message });
      }
      break;
    }

    case "mediaSegmentStreaming": {
      try {
        if (!transcoder) throw new Error("Transcoder not initialized");
        await transcoder.processMediaSegmentStreaming(
          new Uint8Array(msg.data),
          (h264, init) => {
            const transfers: ArrayBuffer[] = [h264.buffer as ArrayBuffer];
            const resp: Record<string, unknown> = {
              type: "partialTranscoded",
              id: msg.id,
              h264: h264.buffer,
              isFirst: false,
            };
            if (init) {
              // Copy init segment — original buffer is reused across calls
              const initCopy = new Uint8Array(init.initSegment);
              resp.initSegment = initCopy.buffer;
              resp.codec = init.codec;
              resp.isFirst = true;
              transfers.push(initCopy.buffer as ArrayBuffer);
            }
            self.postMessage(resp, transfers);
          },
        );
        self.postMessage({ type: "streamingDone", id: msg.id });
      } catch (err) {
        self.postMessage({ type: "error", id: msg.id, message: (err as Error).message });
      }
      break;
    }

    case "flush": {
      try {
        if (!transcoder) break;
        const remaining = await transcoder.flush();
        const response: Record<string, unknown> = {
          type: "flushed",
          h264: remaining ? remaining.buffer : null,
        };
        const transfers = remaining ? [remaining.buffer] : [];
        self.postMessage(response, transfers);
      } catch (err) {
        self.postMessage({ type: "error", id: -1, message: (err as Error).message });
      }
      break;
    }

    case "abort": {
      // Destroy current transcoder and re-create with same config
      if (transcoder) {
        transcoder.destroy();
        transcoder = null;
      }
      if (lastConfig) {
        transcoder = new SegmentTranscoder(lastConfig);
        transcoder.init().then(() => {
          self.postMessage({ type: "aborted" });
        }).catch((err) => {
          self.postMessage({ type: "error", id: -1, message: (err as Error).message });
        });
      } else {
        self.postMessage({ type: "aborted" });
      }
      break;
    }

    case "destroy": {
      if (transcoder) {
        transcoder.destroy();
        transcoder = null;
      }
      self.close();
      break;
    }
  }
};
