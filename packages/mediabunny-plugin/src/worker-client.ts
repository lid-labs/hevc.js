import type { PackedFrame } from "./frames.js";
import type { PictureOrder } from "./output-timestamps.js";
import type { FromWorker, ToWorker } from "./worker-protocol.js";

type InitOptions = Omit<Extract<ToWorker, { type: "init" }>, "type">;

/**
 * Packets sent to the worker and not answered yet. Past this, decode() waits:
 * Mediabunny awaits it before the next packet, so the worker's queue stays
 * short while the page's thread is free.
 */
const MAX_IN_FLIGHT = 4;

/** The page's side of the decode worker. */
export class DecodeWorkerClient {
  private _inFlight = 0;
  private _wake: (() => void)[] = [];
  private _flush: { resolve: (frames: PackedFrame[]) => void; reject: (error: Error) => void } | null = null;
  private _failure: Error | null = null;

  private constructor(
    private readonly _worker: Worker,
    private readonly _onOutput: (suppressed: PictureOrder[], frames: PackedFrame[]) => void,
    private readonly _onError: (error: Error) => void,
  ) {
    _worker.onmessage = (event: MessageEvent<FromWorker>) => this._receive(event.data);
    _worker.onerror = (event: ErrorEvent) => this._fail(new Error(`HEVC decode worker: ${event.message}`));
  }

  /** Starts the worker and resolves once its decoder is ready. */
  static open(
    worker: Worker,
    init: InitOptions,
    onOutput: (suppressed: PictureOrder[], frames: PackedFrame[]) => void,
    onError: (error: Error) => void,
  ): Promise<DecodeWorkerClient> {
    return new Promise((resolve, reject) => {
      // Mediabunny never calls close() on a decoder whose init() failed
      const failed = (error: Error) => {
        worker.terminate();
        reject(error);
      };
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        if (event.data.type === "ready") resolve(new DecodeWorkerClient(worker, onOutput, onError));
        else if (event.data.type === "error") failed(new Error(event.data.message));
      };
      worker.onerror = (event: ErrorEvent) => failed(new Error(`HEVC decode worker: ${event.message}`));
      worker.postMessage({ type: "init", ...init } satisfies ToWorker);
    });
  }

  async decode(packet: Uint8Array): Promise<void> {
    if (this._failure) throw this._failure;
    // A copy the worker can own: the packet's buffer belongs to Mediabunny
    const data = packet.slice().buffer;
    this._inFlight++;
    this._worker.postMessage({ type: "decode", data } satisfies ToWorker, [data]);
    while (this._inFlight >= MAX_IN_FLIGHT && !this._failure) {
      await new Promise<void>(resolve => this._wake.push(resolve));
    }
    if (this._failure) throw this._failure;
  }

  /** Resolves with the frames left in the decoder, after every packet sent before it. */
  flush(): Promise<PackedFrame[]> {
    if (this._failure) return Promise.reject(this._failure);
    return new Promise((resolve, reject) => {
      this._flush = { resolve, reject };
      this._worker.postMessage({ type: "flush" } satisfies ToWorker);
    });
  }

  close(): void {
    this._worker.postMessage({ type: "close" } satisfies ToWorker);
    this._worker.terminate();
  }

  private _receive(message: FromWorker): void {
    switch (message.type) {
      case "output":
        this._inFlight--;
        this._wake.shift()?.();
        this._onOutput(message.suppressed, message.frames);
        break;
      case "flushed":
        this._flush?.resolve(message.frames);
        this._flush = null;
        break;
      case "error":
        this._fail(new Error(message.message));
        break;
    }
  }

  private _fail(error: Error): void {
    if (this._failure) return;
    this._failure = error;
    // Once a call has failed, Mediabunny skips the later ones, close() included
    this._worker.terminate();
    this._flush?.reject(error);
    this._flush = null;
    for (const wake of this._wake.splice(0)) wake();
    this._onError(error);
  }
}

/**
 * A classic worker refuses a script from another origin, even with CORS
 * headers: fetch it and start it from a blob URL instead.
 */
export async function createWorker(workerUrl: string): Promise<Worker> {
  const sameOrigin = typeof location === "undefined" || new URL(workerUrl, location.href).origin === location.origin;
  if (sameOrigin) return new Worker(workerUrl);
  const response = await fetch(workerUrl);
  // An error page would otherwise start as the worker's script
  if (!response.ok) throw new Error(`HEVC decode worker: ${workerUrl}: HTTP ${response.status}`);
  const blobUrl = URL.createObjectURL(new Blob([await response.text()], { type: "application/javascript" }));
  const worker = new Worker(blobUrl);
  // Its first message comes once the script has loaded: the URL can go then
  worker.addEventListener("message", () => URL.revokeObjectURL(blobUrl), { once: true });
  return worker;
}
