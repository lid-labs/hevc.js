/**
 * A pool of transcode workers, so that several segments transcode at once.
 *
 * The decoder is single-threaded in WASM, and one worker transcodes one segment
 * at a time: on hardware that transcodes below real time, that is what starves
 * the buffer. Each worker holds its own WASM instance, so N of them decode N
 * segments in parallel without `SharedArrayBuffer`, and so without the COOP and
 * COEP headers WASM threads would require.
 *
 * What the pool does **not** decide is the order data reaches the SourceBuffer:
 * MSE appends are sequential, and the caller keeps them in segment order. The
 * pool only answers "which worker takes this segment".
 *
 * **A segment goes to a free worker only when it is self-contained**, which
 * `isSelfContainedSegment` decides from the type of its first VCL NAL. A
 * CRA-led (open GOP) segment is kept on the worker that decoded its
 * predecessor, because its RASL pictures reference that predecessor, still held
 * in that instance's DPB. See `segment-random-access.ts` for why handing one to
 * another instance would produce wrong frames rather than an error.
 */

import { log } from "./log.js";
import type { SegmentTranscoderConfig, TranscodedInit } from "./segment-transcoder.js";
import { TranscodeWorkerClient } from "./transcode-worker-client.js";

export interface TranscodePoolConfig extends SegmentTranscoderConfig {
  /** URL to the worker script (transcode-worker.js). */
  workerUrl: string;
  /**
   * Upper bound on worker instances, each with its own WASM decoder and DPB —
   * tens of megabytes at 1080p, so the bound matters. 1 keeps the behaviour of
   * a single worker, segment after segment. Default: `recommendedPoolSize()`.
   */
  poolSize?: number;
}

type Slot = {
  client: TranscodeWorkerClient;
  /** Segments currently on this worker. A worker takes one at a time. */
  busy: boolean;
  /** Set once this worker has parsed the current init segment. */
  initialized: boolean;
};

/**
 * Two workers on four or more hardware threads, one below that.
 *
 * The decode of one segment saturates one thread, and the WebCodecs encode of
 * another segment often runs on hardware, so two transcodes overlap well on
 * four threads. Below that they would contend for the same core, which buys
 * throughput back at the price of per-segment latency, and per-segment latency
 * is what the compute-aware cap reads. `hardwareConcurrency` is a hint, not a
 * guarantee, and is undefined outside a browser: 1 then, the safe answer.
 */
export function recommendedPoolSize(): number {
  const threads = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  if (!threads || threads < 4) return 1;
  return 2;
}

export class TranscodePool {
  private _config: TranscodePoolConfig;
  private _maxSize: number;
  private _slots: Slot[] = [];
  /** The init segment, kept so a worker created later can parse it too. */
  private _initData: Uint8Array | null = null;
  /** Resolvers waiting for a worker to come free. */
  private _waiters: (() => void)[] = [];
  /**
   * Bumped by `abort()` and `destroy()`. A call that took a worker before the
   * bump must not touch the pool's state afterwards: `abort()` frees every slot
   * at once, so a stale `finally` would free a worker another segment has since
   * taken, and two segments would share one decoder.
   */
  private _epoch = 0;
  private _destroyed = false;

  constructor(config: TranscodePoolConfig) {
    this._config = config;
    const requested = config.poolSize ?? recommendedPoolSize();
    this._maxSize = Math.max(1, Math.floor(requested));
    // The first worker exists from the start: it carries the init segment, the
    // Shaka warmup path, and every segment that is not self-contained.
    this._slots.push(this._createSlot());
  }

  /** How many workers exist. Grows up to `poolSize` as parallel work arrives. */
  get size(): number { return this._slots.length; }
  /** The cap on workers, after clamping. */
  get maxSize(): number { return this._maxSize; }
  /** Segments being transcoded right now. */
  get inFlight(): number { return this._slots.filter((s) => s.busy).length; }

  get isInitialized(): boolean { return this._primary.client.isInitialized; }
  get isInitParsed(): boolean { return this._primary.client.isInitParsed; }
  get initResult(): TranscodedInit | null { return this._primary.client.initResult; }
  /** The most recent per-segment stats of any worker. */
  get lastPerfStats(): TranscodeWorkerClient["lastPerfStats"] {
    let latest: TranscodeWorkerClient["lastPerfStats"] = null;
    for (const slot of this._slots) {
      const stats = slot.client.lastPerfStats;
      if (stats) latest = stats;
    }
    return latest;
  }

  private get _primary(): Slot { return this._slots[0]!; }

  async waitReady(): Promise<void> {
    return this._primary.client.waitReady();
  }

  /**
   * Parse an init segment. It is a barrier: the caller drains the segments in
   * flight before calling this, because the workers that hold them are about to
   * be re-initialised with other parameter sets. Workers beyond the first are
   * marked for re-initialisation and parse it when they next take a segment.
   */
  async processInitSegment(data: Uint8Array): Promise<void> {
    // The client transfers the buffer it is given, so the pool keeps its own
    // copy for the workers that will parse it later.
    this._initData = new Uint8Array(data);
    for (const slot of this._slots) slot.initialized = false;
    await this._primary.client.processInitSegment(data);
    this._primary.initialized = true;
  }

  /** Shaka's warmup path: an H.264 init segment before any media is seen. */
  async prepareInit(data: Uint8Array): Promise<TranscodedInit> {
    return this._primary.client.prepareInit(data);
  }

  /**
   * Transcode one segment, with `onChunk` called for each H.264 chunk the
   * worker emits, in the order that worker emits them. Chunks of two segments
   * transcoding at once interleave freely: keeping the SourceBuffer in order is
   * the caller's job.
   *
   * `selfContained` says whether the segment may go to any worker. The caller
   * reads it from the bytes with `isSelfContainedSegment`, before the buffer is
   * transferred.
   */
  async processMediaSegmentStreaming(
    data: Uint8Array,
    onChunk: (h264: Uint8Array, initSegment: Uint8Array | null, codec: string | null) => Promise<void> | void,
    options: { selfContained: boolean },
  ): Promise<void> {
    const slot = await this._acquire(options.selfContained);
    const epoch = this._epoch;
    try {
      await this._ensureInitialized(slot, epoch);
      await slot.client.processMediaSegmentStreaming(data, onChunk);
    } finally {
      this._release(slot, epoch);
    }
  }

  abort(): void {
    this._epoch++;
    for (const slot of this._slots) {
      slot.client.abort();
      slot.busy = false;
      // abort() makes the worker destroy and re-create its transcoder, which
      // drops the parsed init segment with it.
      slot.initialized = false;
    }
    this._primary.initialized = false;
    this._wakeWaiters();
  }

  destroy(): void {
    this._epoch++;
    this._destroyed = true;
    for (const slot of this._slots) slot.client.destroy();
    this._slots = [];
    this._initData = null;
    // Waiters wake into a destroyed pool and reject, rather than find no slot,
    // create a worker nothing will ever destroy, and leak a WASM instance.
    this._wakeWaiters();
  }

  /**
   * Take a worker. A segment that is not self-contained always takes the first
   * one, which is the only worker that sees every such segment and therefore
   * the only one whose DPB holds the right predecessor.
   */
  private async _acquire(selfContained: boolean): Promise<Slot> {
    for (;;) {
      if (this._destroyed) throw new Error("Transcode pool destroyed");
      if (!selfContained) {
        if (!this._primary.busy) {
          this._primary.busy = true;
          return this._primary;
        }
      } else {
        const free = this._slots.find((s) => !s.busy);
        if (free) {
          free.busy = true;
          return free;
        }
        if (this._slots.length < this._maxSize) {
          const slot = this._createSlot();
          this._slots.push(slot);
          slot.busy = true;
          log.debug(`Transcode pool grew to ${this._slots.length} workers`);
          return slot;
        }
      }
      await new Promise<void>((resolve) => this._waiters.push(resolve));
    }
  }

  private _release(slot: Slot, epoch: number): void {
    // An abort or a destroy came between: that already freed the slots, and
    // this one may belong to another segment now.
    if (epoch !== this._epoch) {
      this._wakeWaiters();
      return;
    }
    slot.busy = false;
    this._wakeWaiters();
  }

  private _wakeWaiters(): void {
    const waiters = this._waiters;
    this._waiters = [];
    for (const wake of waiters) wake();
  }

  private _createSlot(): Slot {
    return {
      client: new TranscodeWorkerClient(this._config),
      busy: false,
      initialized: false,
    };
  }

  /**
   * A worker takes no segment before it has the parameter sets of the stream.
   * Each await is followed by an epoch check: an abort in between re-created the
   * worker's transcoder without an init segment, so marking the slot
   * initialised afterwards would let it take a segment it cannot decode.
   */
  private async _ensureInitialized(slot: Slot, epoch: number): Promise<void> {
    if (slot.initialized) return;
    await slot.client.waitReady();
    if (epoch !== this._epoch) return;
    if (!this._initData) {
      // Nothing to parse yet: the caller is about to send the init segment, or
      // the stream carries its parameter sets in band.
      slot.initialized = true;
      return;
    }
    await slot.client.processInitSegment(new Uint8Array(this._initData));
    if (epoch !== this._epoch) return;
    slot.initialized = true;
  }
}
