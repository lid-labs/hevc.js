import { describe, expect, it } from "vitest";
import { DecodeWorkerClient } from "./worker-client.js";
import type { FromWorker } from "./worker-protocol.js";

/** A worker whose answers the test sends by hand. */
class ScriptedWorker {
  onmessage: ((event: { data: FromWorker }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  postMessage(): void {}
  terminate(): void {
    this.terminated = true;
  }
  answer(data: FromWorker): void {
    this.onmessage?.({ data });
  }
}

const INIT = { wasmUrl: "x.js", wasmBinaryUrl: "x.wasm", nalLengthSize: 4, parameterSets: null, i420p10: false };

function open(worker: ScriptedWorker, onError: (error: Error) => void = () => {}) {
  return DecodeWorkerClient.open(worker as unknown as Worker, INIT, () => {}, onError);
}

describe("DecodeWorkerClient", () => {
  it("terminates a worker that fails to start", async () => {
    const worker = new ScriptedWorker();
    const opening = open(worker);
    worker.answer({ type: "error", message: "no wasm" });
    await expect(opening).rejects.toThrow("no wasm");
    expect(worker.terminated).toBe(true);
  });

  it("terminates the worker on a decoding error and fails the calls waiting on it", async () => {
    const worker = new ScriptedWorker();
    const opening = open(worker, error => errors.push(error.message));
    const errors: string[] = [];
    worker.answer({ type: "ready" });
    const client = await opening;

    const flushing = client.flush();
    worker.answer({ type: "error", message: "corrupt slice" });
    await expect(flushing).rejects.toThrow("corrupt slice");
    expect(worker.terminated).toBe(true);
    expect(errors).toEqual(["corrupt slice"]);
    await expect(client.decode(new Uint8Array(1))).rejects.toThrow("corrupt slice");
  });
});
