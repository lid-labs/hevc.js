import { beforeEach, describe, expect, it, vi } from "vitest";
import { HevcTransmuxer, registerHevcTransmuxer } from "./index.js";

vi.mock("@hevcjs/core", () => ({
  SegmentTranscoder: vi.fn(),
  hevcMimeToH264Codec: vi.fn(() => "avc1.640028"),
  // compute-aware imports — stubbed so the index module loads under the mock.
  // Real wiring is exercised by compute-aware.test.ts which doesn't mock core.
  ComputeAwareDecider: vi.fn().mockImplementation(() => ({
    setLadderSize: vi.fn(),
    observe: vi.fn(() => ({ capIndex: null, avgSpeedX: 1, reason: "hold" })),
  })),
  subscribeSegmentStat: vi.fn(() => () => {}),
}));

interface MockShaka {
  transmuxer?: {
    TransmuxerEngine?: {
      registerTransmuxer: ReturnType<typeof vi.fn>;
      unregisterTransmuxer: ReturnType<typeof vi.fn>;
      PluginPriority?: { PREFERRED?: number; APPLICATION?: number };
    };
  };
}

// Real shaka.transmuxer.TransmuxerEngine.PluginPriority values.
const REAL_PRIORITY = {
  FALLBACK: 1,
  PREFERRED_SECONDARY: 2,
  PREFERRED: 3,
  APPLICATION: 4,
};

function buildShakaMock(opts: { withUnregister?: boolean } = {}): MockShaka {
  return {
    transmuxer: {
      TransmuxerEngine: {
        registerTransmuxer: vi.fn(),
        unregisterTransmuxer: opts.withUnregister === false
          ? (undefined as unknown as ReturnType<typeof vi.fn>)
          : vi.fn(),
        PluginPriority: { ...REAL_PRIORITY },
      },
    },
  };
}

describe("registerHevcTransmuxer", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("registers HevcTransmuxer for hev1 and hvc1 mime types", () => {
    const shaka = buildShakaMock();
    registerHevcTransmuxer(shaka);

    const calls = shaka.transmuxer!.TransmuxerEngine!.registerTransmuxer.mock.calls;
    const mimes = calls.map((c: unknown[]) => c[0]).sort();
    expect(mimes).toEqual([
      'video/mp4; codecs="hev1"',
      'video/mp4; codecs="hvc1"',
    ]);
  });

  it("uses PluginPriority.APPLICATION (override built-ins) when available", () => {
    const shaka = buildShakaMock();
    registerHevcTransmuxer(shaka);
    const firstCall =
      shaka.transmuxer!.TransmuxerEngine!.registerTransmuxer.mock.calls[0]!;
    expect(firstCall[2]).toBe(REAL_PRIORITY.APPLICATION);
  });

  it("falls back to PluginPriority.PREFERRED when APPLICATION is missing", () => {
    const shaka = buildShakaMock();
    delete shaka.transmuxer!.TransmuxerEngine!.PluginPriority!.APPLICATION;
    registerHevcTransmuxer(shaka);
    const firstCall =
      shaka.transmuxer!.TransmuxerEngine!.registerTransmuxer.mock.calls[0]!;
    expect(firstCall[2]).toBe(REAL_PRIORITY.PREFERRED);
  });

  it("falls back to a numeric default when PluginPriority is absent", () => {
    const shaka = buildShakaMock();
    delete shaka.transmuxer!.TransmuxerEngine!.PluginPriority;
    registerHevcTransmuxer(shaka);
    const firstCall =
      shaka.transmuxer!.TransmuxerEngine!.registerTransmuxer.mock.calls[0]!;
    expect(typeof firstCall[2]).toBe("number");
  });

  it("returns a cleanup that unregisters both mime types with the same priority", () => {
    const shaka = buildShakaMock();
    const cleanup = registerHevcTransmuxer(shaka);

    cleanup();

    const calls =
      shaka.transmuxer!.TransmuxerEngine!.unregisterTransmuxer.mock.calls;
    const mimes = calls.map((c: unknown[]) => c[0]).sort();
    expect(mimes).toEqual([
      'video/mp4; codecs="hev1"',
      'video/mp4; codecs="hvc1"',
    ]);
    // Priority must match what we registered with, otherwise the unregister
    // is a silent no-op (key in transmuxerMap_ is `${mime}-${priority}`).
    for (const call of calls) {
      expect(call[1]).toBe(REAL_PRIORITY.APPLICATION);
    }
  });

  it("returns a no-op cleanup when unregisterTransmuxer is not exposed", () => {
    const shaka = buildShakaMock({ withUnregister: false });
    const cleanup = registerHevcTransmuxer(shaka);
    expect(() => cleanup()).not.toThrow();
  });

  it("warns and returns a no-op cleanup when TransmuxerEngine is missing", () => {
    const shaka: MockShaka = {};
    const cleanup = registerHevcTransmuxer(shaka);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/TransmuxerEngine/);
    expect(() => cleanup()).not.toThrow();
  });

  it("invokes the factory to construct an HevcTransmuxer for the given mime", () => {
    const shaka = buildShakaMock();
    registerHevcTransmuxer(shaka);

    const firstCall =
      shaka.transmuxer!.TransmuxerEngine!.registerTransmuxer.mock.calls[0]!;
    const factory = firstCall[1] as () => HevcTransmuxer;
    const instance = factory();
    expect(instance).toBeInstanceOf(HevcTransmuxer);
    expect(instance.getOriginalMimeType()).toBe(firstCall[0]);
  });

  it("forwards wasmUrl / wasmBinaryUrl config to the HevcTransmuxer factory", async () => {
    const shaka = buildShakaMock();
    registerHevcTransmuxer(shaka, {
      wasmUrl: "/custom-hevc-decode.js",
      wasmBinaryUrl: "/custom-hevc-decode.wasm",
    });

    const firstCall =
      shaka.transmuxer!.TransmuxerEngine!.registerTransmuxer.mock.calls[0]!;
    const factory = firstCall[1] as () => HevcTransmuxer;
    const instance = factory();

    // The config is private state; we verify the cable indirectly by
    // triggering a transmux() call and checking that SegmentTranscoder
    // (mocked in vi.mock above) is constructed with our config.
    const { SegmentTranscoder } = await import("@hevcjs/core");
    const SegmentTranscoderMock = SegmentTranscoder as unknown as ReturnType<
      typeof vi.fn
    >;
    SegmentTranscoderMock.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SegmentTranscoderMock as any).mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      prepareInit: vi.fn().mockResolvedValue({
        initSegment: new Uint8Array(),
        codec: "avc1.640028",
      }),
      processMediaSegment: vi.fn(),
      destroy: vi.fn(),
    }));

    await instance.transmux(
      new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]),
      null,
      null,
      0,
      "video",
    );

    expect(SegmentTranscoderMock).toHaveBeenCalledWith({
      wasmUrl: "/custom-hevc-decode.js",
      wasmBinaryUrl: "/custom-hevc-decode.wasm",
    });
  });

  it("returns a handle that is callable AND exposes unregister/attachComputeAware", () => {
    const shaka = buildShakaMock();
    const handle = registerHevcTransmuxer(shaka);
    expect(typeof handle).toBe("function");
    expect(typeof handle.unregister).toBe("function");
    expect(typeof handle.attachComputeAware).toBe("function");
  });

  it("attachComputeAware actively wires by default (no adaptiveCompute flag)", async () => {
    const shaka = buildShakaMock();
    const { subscribeSegmentStat } = await import("@hevcjs/core");
    const subscribeMock = subscribeSegmentStat as unknown as ReturnType<typeof vi.fn>;
    subscribeMock.mockClear();

    const handle = registerHevcTransmuxer(shaka); // no config -> default on
    const cleanup = handle.attachComputeAware({});

    expect(typeof cleanup).toBe("function");
    expect(subscribeMock).toHaveBeenCalled();
    // No "missing flag" warn — defaults are on, nothing surprising.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("attachComputeAware merges register-time and attach-time options", async () => {
    const shaka = buildShakaMock();
    // Use the actual @hevcjs/core ComputeAwareDecider semantics — the mock
    // at the top of this file returns capIndex: null / reason: "hold" for
    // every observe(), which is enough to confirm the merge wiring.
    const { subscribeSegmentStat } = await import("@hevcjs/core");
    const subscribeMock = subscribeSegmentStat as unknown as ReturnType<typeof vi.fn>;

    let publishedToBus: ((stat: unknown) => void) | null = null;
    subscribeMock.mockImplementation((cb: (stat: unknown) => void) => {
      publishedToBus = cb;
      return () => { publishedToBus = null; };
    });

    const registerOnObs = vi.fn();
    const attachOnObs = vi.fn();
    const handle = registerHevcTransmuxer(shaka, {
      adaptiveCompute: { onObservation: registerOnObs, measureWindow: 99 },
    });
    // Player needs at least one video variant or readLadder bails early.
    const playerMock = {
      getVariantTracks: () => [
        { active: true, height: 1080, videoBandwidth: 5_000_000 },
      ],
    };
    handle.attachComputeAware(playerMock, { onObservation: attachOnObs });

    // Fire a stat: attach-time onObservation must win over register-time.
    publishedToBus!({
      totalMs: 1000,
      segDurMs: 1000,
      speedX: 1,
      frames: 25,
      width: 1920,
      height: 1080,
    });
    // The mock decider's observe returns hold; the adapter still invokes
    // onObservation on every stat. Attach-time callback wins.
    expect(attachOnObs).toHaveBeenCalled();
    expect(registerOnObs).not.toHaveBeenCalled();
  });

  it("attachComputeAware is a silent no-op when adaptiveCompute: false", async () => {
    const shaka = buildShakaMock();
    const { subscribeSegmentStat } = await import("@hevcjs/core");
    const subscribeMock = subscribeSegmentStat as unknown as ReturnType<typeof vi.fn>;
    subscribeMock.mockClear();

    const handle = registerHevcTransmuxer(shaka, { adaptiveCompute: false });
    const cleanup = handle.attachComputeAware({});

    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
    // Explicit opt-out: no subscription happens, and no warn (the user
    // asked for this, no surprise).
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("handle() tears down both the transmuxer AND the active compute-aware listener", async () => {
    const shaka = buildShakaMock();
    const { subscribeSegmentStat } = await import("@hevcjs/core");
    const subscribeMock = subscribeSegmentStat as unknown as ReturnType<typeof vi.fn>;
    const detachSpy = vi.fn();
    subscribeMock.mockReturnValue(detachSpy);

    const handle = registerHevcTransmuxer(shaka, { adaptiveCompute: true });
    handle.attachComputeAware({}); // attaches via mocked subscribe

    handle(); // tearDown both
    expect(detachSpy).toHaveBeenCalled();
    // Transmuxer also unregistered
    expect(
      shaka.transmuxer!.TransmuxerEngine!.unregisterTransmuxer,
    ).toHaveBeenCalled();
  });

  it("does NOT forward adaptiveCompute to the HevcTransmuxer factory", async () => {
    const shaka = buildShakaMock();
    registerHevcTransmuxer(shaka, { adaptiveCompute: true });

    const firstCall =
      shaka.transmuxer!.TransmuxerEngine!.registerTransmuxer.mock.calls[0]!;
    const factory = firstCall[1] as () => HevcTransmuxer;
    const instance = factory();

    const { SegmentTranscoder } = await import("@hevcjs/core");
    const SegmentTranscoderMock = SegmentTranscoder as unknown as ReturnType<
      typeof vi.fn
    >;
    SegmentTranscoderMock.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (SegmentTranscoderMock as any).mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      prepareInit: vi.fn().mockResolvedValue({
        initSegment: new Uint8Array(),
        codec: "avc1.640028",
      }),
      processMediaSegment: vi.fn(),
      destroy: vi.fn(),
    }));

    await instance.transmux(
      new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]),
      null,
      null,
      0,
      "video",
    );

    // adaptiveCompute is consumed by the handle layer; the transmuxer
    // should receive an empty (or transcoder-only) config.
    const callArg = SegmentTranscoderMock.mock.calls[0]![0];
    expect(callArg).not.toHaveProperty("adaptiveCompute");
  });
});
