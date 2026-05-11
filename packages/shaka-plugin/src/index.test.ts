import { beforeEach, describe, expect, it, vi } from "vitest";
import { HevcTransmuxer, registerHevcTransmuxer } from "./index.js";

vi.mock("@hevcjs/core", () => ({
  SegmentTranscoder: vi.fn(),
  hevcMimeToH264Codec: vi.fn(() => "avc1.640028"),
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
});
