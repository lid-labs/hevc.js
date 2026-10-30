/**
 * The decode worker: runs the WASM decoder off the page's thread. Bundled on
 * its own as dist/decode-worker.js, which the app serves and passes to
 * `registerHevcDecoder({ workerUrl })`.
 */
import { HEVCDecoder } from "@hevcjs/core/decoder";
import { packetToAnnexB } from "./bitstream.js";
import { packFrame } from "./frames.js";
import type { PackedFrame } from "./frames.js";
import type { FromWorker, ToWorker } from "./worker-protocol.js";

type Post = (message: FromWorker, transfer: Transferable[]) => void;

/** The message handler, separate from the worker global so tests can drive it. */
export function createDecodeWorkerHandler(post: Post): (message: ToWorker) => Promise<void> {
  let decoder: HEVCDecoder | null = null;
  let nalLengthSize = 0;
  let i420p10 = false;

  const handle = async (message: ToWorker): Promise<void> => {
    switch (message.type) {
      case "init": {
        // Defines the global factory HEVCDecoder.create() picks up
        if (typeof importScripts === "function") importScripts(message.wasmUrl);
        decoder = await HEVCDecoder.create({ wasmBinaryUrl: message.wasmBinaryUrl });
        nalLengthSize = message.nalLengthSize;
        i420p10 = message.i420p10;
        if (message.parameterSets) decoder.feed(message.parameterSets);
        post({ type: "ready" }, []);
        break;
      }
      case "decode": {
        decoder!.feed(packetToAnnexB(new Uint8Array(message.data), nalLengthSize));
        // Read before draining, as on the page's thread: the page notes them before timing the frames
        const suppressed = decoder!.takeSuppressedPictures();
        const frames = decoder!.drain().map(frame => packFrame(frame, i420p10));
        post({ type: "output", suppressed, frames }, buffersOf(frames));
        break;
      }
      case "flush": {
        const frames = decoder!.flush().map(frame => packFrame(frame, i420p10));
        post({ type: "flushed", frames }, buffersOf(frames));
        break;
      }
      case "close":
        decoder?.destroy();
        decoder = null;
        break;
    }
  };

  // One message at a time: "init" awaits the WASM, and nothing may run before it ends
  let queue = Promise.resolve();
  return (message) => {
    queue = queue.then(() => handle(message)).catch((error: unknown) => {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) }, []);
    });
    return queue;
  };
}

function buffersOf(frames: PackedFrame[]): Transferable[] {
  return frames.map(frame => frame.data.buffer as ArrayBuffer);
}

declare const self: DedicatedWorkerGlobalScope;
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const handle = createDecodeWorkerHandler((message, transfer) => self.postMessage(message, transfer));
  self.onmessage = (event: MessageEvent<ToWorker>) => void handle(event.data);
}
