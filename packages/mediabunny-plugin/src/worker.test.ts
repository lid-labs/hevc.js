/**
 * The plugin decoding in a decode worker, end to end through Mediabunny under
 * Node. Node has no Web Worker: a stand-in runs the real worker handler, with
 * the real WASM, and delivers messages asynchronously both ways, as a worker
 * would. Its own module, since registration is module-wide and first-wins.
 */
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDecodeWorkerHandler } from "./decode-worker.js";
import { registerHevcDecoder } from "./index.js";
import type { ToWorker } from "./worker-protocol.js";
import { DECODE_TEST_TIMEOUT, expectDecodesThroughMediabunny, installWasmGlobal, removeWasmGlobal, wasmDir } from "./test-utils.js";

const started: string[] = [];
let outputMessages = 0;

class StandInWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  private readonly _handle = createDecodeWorkerHandler((message) => {
    if (message.type === "output") outputMessages++;
    setTimeout(() => this.onmessage?.({ data: message }), 0);
  });

  constructor(url: string) {
    started.push(url);
  }

  postMessage(message: ToWorker): void {
    setTimeout(() => void this._handle(message), 0);
  }

  terminate(): void {}
}

beforeAll(() => {
  installWasmGlobal();
  (globalThis as Record<string, unknown>).Worker = StandInWorker;
});

afterAll(() => {
  removeWasmGlobal();
  delete (globalThis as Record<string, unknown>).Worker;
});

describe("registerHevcDecoder({ workerUrl })", () => {
  it("decodes an HEVC track in the worker, frames timed in display order", async () => {
    // The default glue and binary sit next to the worker: core's wasm/ directory here
    const workerUrl = pathToFileURL(`${wasmDir}decode-worker.js`).href;
    await registerHevcDecoder({ workerUrl });

    await expectDecodesThroughMediabunny();
    expect(started).toEqual([workerUrl]);
    // One answer per packet: every frame came back from the worker
    expect(outputMessages).toBe(250);
  }, DECODE_TEST_TIMEOUT);
});
