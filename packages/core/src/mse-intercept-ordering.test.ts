import { afterEach, describe, expect, it, vi } from "vitest";
import { installMSEIntercept, uninstallMSEIntercept } from "./mse-intercept.js";
import { TranscodePool } from "./transcode-pool.js";
import { setLogLevel } from "./log.js";

/**
 * The worker pool transcodes several segments at once; MSE appends stay
 * sequential. These tests drive the intercept through a fake worker whose
 * completions are released by hand, so a later segment can finish first — the
 * case that would put frames on screen out of order if the appender followed
 * completion instead of segment order.
 *
 * They also pin the dispatch rule the pool's soundness rests on: a segment that
 * does not start on an IDR or a BLA stays on the worker that decoded its
 * predecessor (see segment-random-access.ts).
 */

// --- fMP4 segments, built by hand ------------------------------------------

function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [
    (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...payload,
  ];
}

function nal(type: number): number[] {
  const body = [type << 1, 1, 0, 0];
  return [0, 0, 0, body.length, ...body];
}

const IDR_N_LP = 20;
const CRA_NUT = 21;
const SPS = 33;

/** A media segment whose first VCL NAL has the given type. */
function mediaSegment(leadingVcl: number, marker: number): Uint8Array {
  return new Uint8Array([
    ...box("styp", [...[..."msdh"].map((c) => c.charCodeAt(0))]),
    ...box("moof", box("mfhd", [0, 0, 0, 0, 0, 0, 0, marker])),
    ...box("mdat", [...nal(SPS), ...nal(leadingVcl)]),
  ]);
}

/** ftyp, which is how the intercept recognises an init segment. */
const INIT_SEGMENT = new Uint8Array([
  ...box("ftyp", [...[..."isom"].map((c) => c.charCodeAt(0))]),
  ...box("moov", []),
]);

// --- a fake worker speaking the transcode protocol -------------------------

type Pending = { id: number; worker: number; release: () => void };

class FakeTranscodeWorker {
  static instances: FakeTranscodeWorker[] = [];
  /**
   * Segments handed to a worker and not yet completed, newest last. Releasing
   * one takes it out: the list is what is in flight, which is what the tests
   * below count.
   */
  static pending: Pending[] = [];

  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private _listeners: ((e: MessageEvent) => void)[] = [];
  terminated = false;

  constructor(public url: string) {
    FakeTranscodeWorker.instances.push(this);
  }

  addEventListener(_type: string, handler: (e: MessageEvent) => void): void {
    this._listeners.push(handler);
  }

  removeEventListener(_type: string, handler: (e: MessageEvent) => void): void {
    this._listeners = this._listeners.filter((h) => h !== handler);
  }

  terminate(): void { this.terminated = true; }

  postMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "init":
        this._emit({ type: "ready" });
        break;
      case "initSegment":
        this._emit({ type: "initParsed" });
        break;
      case "mediaSegmentStreaming": {
        const id = msg.id as number;
        // Held until the test releases it, in whatever order it chooses.
        const entry: Pending = {
          id,
          worker: FakeTranscodeWorker.instances.indexOf(this),
          release: () => {
            FakeTranscodeWorker.pending = FakeTranscodeWorker.pending.filter((p) => p !== entry);
            this._emit({
              type: "partialTranscoded",
              id,
              h264: new Uint8Array([id]).buffer,
              initSegment: null,
              codec: "avc1.64002a",
            });
            this._emit({ type: "streamingDone", id, perf: null });
          },
        };
        FakeTranscodeWorker.pending.push(entry);
        break;
      }
      case "abort":
        this._emit({ type: "aborted" });
        break;
      default:
        break;
    }
  }

  private _emit(data: Record<string, unknown>): void {
    const event = { data } as MessageEvent;
    this.onmessage?.(event);
    for (const handler of [...this._listeners]) handler(event);
  }
}

class FakeSourceBuffer {
  mime: string;
  /** First byte of every payload appended, in order. */
  appended: number[] = [];
  private _tsOffset = 0;
  constructor(mime = "") { this.mime = mime; }
  get updating(): boolean { return false; }
  /** The intercept logs the buffered end after each segment. */
  get buffered(): { length: number; end: (i: number) => number } {
    return { length: this.appended.length, end: () => this.appended.length };
  }
  get timestampOffset(): number { return this._tsOffset; }
  set timestampOffset(v: number) { this._tsOffset = v; }
  appendBuffer(data: BufferSource): void {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array((data as ArrayBufferView).buffer);
    this.appended.push(bytes[0]!);
  }
  abort(): void {}
  remove(): void {}
  changeType(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakeMediaSource {
  static isTypeSupported(): boolean { return true; }
  addSourceBuffer(mime: string): FakeSourceBuffer { return new FakeSourceBuffer(mime); }
}

function setup(poolSize: number): FakeSourceBuffer {
  FakeTranscodeWorker.instances = [];
  FakeTranscodeWorker.pending = [];
  vi.stubGlobal("MediaSource", FakeMediaSource);
  vi.stubGlobal("SourceBuffer", FakeSourceBuffer);
  vi.stubGlobal("Worker", FakeTranscodeWorker);
  installMSEIntercept({ workerUrl: "transcode-worker.js", poolSize, logLevel: "error" });
  const ms = new FakeMediaSource();
  return ms.addSourceBuffer("video/mp4;codecs=hvc1.1.6.L120.90") as unknown as FakeSourceBuffer;
}

/**
 * Let every queued promise settle; the pipeline is promise-driven throughout,
 * and one append walks several awaits, so this is generous on purpose.
 */
async function settle(times = 200): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Wait until `count` segments are in flight, or give up after many turns. */
async function waitForPending(count: number): Promise<void> {
  for (let i = 0; i < 200 && FakeTranscodeWorker.pending.length < count; i++) await settle(5);
}

afterEach(() => {
  uninstallMSEIntercept();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLogLevel("info");
});

describe("ordered appends with a worker pool", () => {
  it("appends in segment order when the second segment finishes first", async () => {
    const sb = setup(2);
    sb.appendBuffer(INIT_SEGMENT.buffer as ArrayBuffer);
    await settle();

    sb.appendBuffer(mediaSegment(IDR_N_LP, 1).buffer as ArrayBuffer);
    sb.appendBuffer(mediaSegment(IDR_N_LP, 2).buffer as ArrayBuffer);
    await waitForPending(2);

    // Both segments are being transcoded at once: that is the point of the pool.
    expect(FakeTranscodeWorker.pending).toHaveLength(2);
    expect(FakeTranscodeWorker.instances).toHaveLength(2);
    const [first, second] = FakeTranscodeWorker.pending;

    // The second one comes back first, and must wait its turn.
    second!.release();
    await settle();
    expect(sb.appended).toEqual([]);

    first!.release();
    await settle();
    // Worker ids are per client, so both segments carry id 0; the order is what
    // this asserts, and it is the order they were appended by the player.
    expect(sb.appended).toHaveLength(2);
  });

  it("keeps a single worker when poolSize is 1", async () => {
    const sb = setup(1);
    sb.appendBuffer(INIT_SEGMENT.buffer as ArrayBuffer);
    await settle();

    sb.appendBuffer(mediaSegment(IDR_N_LP, 1).buffer as ArrayBuffer);
    sb.appendBuffer(mediaSegment(IDR_N_LP, 2).buffer as ArrayBuffer);
    await waitForPending(1);

    expect(FakeTranscodeWorker.instances).toHaveLength(1);
    // One segment at a time: the second is still in the queue.
    expect(FakeTranscodeWorker.pending).toHaveLength(1);
  });

  it("keeps an open-GOP segment on the worker that holds its predecessor", async () => {
    const sb = setup(2);
    sb.appendBuffer(INIT_SEGMENT.buffer as ArrayBuffer);
    await settle();

    // A CRA-led segment references the previous segment's pictures: handing it
    // to a second worker would decode its RASL pictures against unrelated ones.
    sb.appendBuffer(mediaSegment(CRA_NUT, 1).buffer as ArrayBuffer);
    sb.appendBuffer(mediaSegment(CRA_NUT, 2).buffer as ArrayBuffer);
    await waitForPending(1);

    expect(FakeTranscodeWorker.instances).toHaveLength(1);
    expect(FakeTranscodeWorker.pending).toHaveLength(1);
  });

  it("holds an open-GOP segment back while a segment is in flight", async () => {
    const sb = setup(2);
    sb.appendBuffer(INIT_SEGMENT.buffer as ArrayBuffer);
    await settle();

    // A mixed stream: the IDR-led segment may go anywhere, the CRA-led one must
    // wait for the worker that will hold its predecessor. Dispatching both at
    // once would leave the choice of worker to the order slots come free.
    sb.appendBuffer(mediaSegment(IDR_N_LP, 1).buffer as ArrayBuffer);
    sb.appendBuffer(mediaSegment(CRA_NUT, 2).buffer as ArrayBuffer);
    await waitForPending(1);
    await settle();

    expect(FakeTranscodeWorker.pending).toHaveLength(1);

    // Once the first is appended, the open-GOP one goes to the same worker.
    FakeTranscodeWorker.pending[0]!.release();
    await settle();
    await waitForPending(1);
    expect(FakeTranscodeWorker.pending).toHaveLength(1);
    expect(FakeTranscodeWorker.instances).toHaveLength(1);
  });

  it("parses the init segment on a worker created later", async () => {
    const sb = setup(2);
    sb.appendBuffer(INIT_SEGMENT.buffer as ArrayBuffer);
    await settle();
    expect(FakeTranscodeWorker.instances).toHaveLength(1);

    sb.appendBuffer(mediaSegment(IDR_N_LP, 1).buffer as ArrayBuffer);
    sb.appendBuffer(mediaSegment(IDR_N_LP, 2).buffer as ArrayBuffer);
    await waitForPending(2);

    // The second worker exists and took a segment, which it only does after
    // parsing the init segment the pool kept a copy of.
    expect(FakeTranscodeWorker.instances).toHaveLength(2);
    expect(FakeTranscodeWorker.pending).toHaveLength(2);
  });
});

describe("TranscodePool lifecycle", () => {
  function pool(poolSize: number): TranscodePool {
    FakeTranscodeWorker.instances = [];
    FakeTranscodeWorker.pending = [];
    vi.stubGlobal("Worker", FakeTranscodeWorker);
    return new TranscodePool({ workerUrl: "transcode-worker.js", poolSize });
  }

  const SEGMENT = () => mediaSegment(IDR_N_LP, 1);

  it("sends an open-GOP segment to the worker that took the segment before it", async () => {
    const p = pool(2);
    await p.waitReady();
    // Two self-contained segments go to two workers in parallel.
    const a = p.processMediaSegmentStreaming(SEGMENT(), () => {}, { selfContained: true });
    await settle();
    const b = p.processMediaSegmentStreaming(SEGMENT(), () => {}, { selfContained: true });
    await settle();
    expect(FakeTranscodeWorker.pending.map((x) => x.worker)).toEqual([0, 1]);

    // The predecessor of the next segment is therefore on worker 1, not on
    // worker 0: its RASL pictures reference what worker 1 holds.
    FakeTranscodeWorker.pending.slice().forEach((x) => x.release());
    await settle();
    await Promise.allSettled([a, b]);

    const c = p.processMediaSegmentStreaming(SEGMENT(), () => {}, { selfContained: false });
    await settle();
    expect(FakeTranscodeWorker.pending).toHaveLength(1);
    expect(FakeTranscodeWorker.pending[0]!.worker).toBe(1);

    FakeTranscodeWorker.pending[0]!.release();
    await settle();
    await c;
  });

  it("rejects a waiting segment after destroy, instead of reviving a worker", async () => {
    const p = pool(1);
    await p.waitReady();
    const first = p.processMediaSegmentStreaming(SEGMENT(), () => {}, { selfContained: true });
    await settle();
    const second = p.processMediaSegmentStreaming(SEGMENT(), () => {}, { selfContained: true });
    await settle();
    expect(FakeTranscodeWorker.pending).toHaveLength(1);

    p.destroy();
    await expect(second).rejects.toThrow(/destroyed/);
    // The waiter must not have found an empty slot list and built itself a
    // worker the pool no longer tracks: that leaks a WASM instance.
    expect(FakeTranscodeWorker.instances).toHaveLength(1);
    await expect(Promise.race([first, Promise.resolve("pending")])).resolves.toBe("pending");
  });

  it("does not let an aborted segment free the worker that took its slot", async () => {
    const p = pool(1);
    await p.waitReady();
    const first = p.processMediaSegmentStreaming(SEGMENT(), () => {}, { selfContained: true });
    await settle();
    const stale = FakeTranscodeWorker.pending[0]!;

    // A seek: every slot is freed for the segments that come after it.
    p.abort();
    const second = p.processMediaSegmentStreaming(SEGMENT(), () => {}, { selfContained: true });
    await settle();
    expect(p.inFlight).toBe(1);

    // The aborted segment now reports back. Its `finally` belongs to the
    // previous epoch and must not free the worker the new segment is using.
    stale.release();
    await settle();
    expect(p.inFlight).toBe(1);

    FakeTranscodeWorker.pending[0]!.release();
    await settle();
    await Promise.allSettled([first, second]);
    expect(p.inFlight).toBe(0);
  });
});
