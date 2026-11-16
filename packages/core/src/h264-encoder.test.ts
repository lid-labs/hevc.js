import { afterEach, describe, expect, it, vi } from "vitest";
import { H264Encoder, __resetLatencyValidation } from "./h264-encoder.js";

// Node has no VideoEncoder: every test stubs the one it needs.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // The validation memo lives in the module, so it would leak into the next
  // test — a realm lasts the whole file.
  __resetLatencyValidation();
});

type Mode = "realtime" | "quality" | undefined;

/**
 * Minimal VideoEncoder stand-in. `refuse` names the latency modes whose
 * configure() throws NotSupportedError, which is how a backend that does not
 * take a mode reports it synchronously. `asyncRefuse` names the modes refused
 * the way Gecko does it (#406): isConfigSupported() says yes, configure()
 * takes it, and the refusal only arrives through the error callback, with
 * flush() rejecting and the encoder closed. Every config it is handed is
 * recorded, so a test can compare what was probed against what was
 * configured.
 */
function fakeVideoEncoder(refuse: Mode[] = [], asyncRefuse: Mode[] = []) {
  const configured: VideoEncoderConfig[] = [];
  const probed: VideoEncoderConfig[] = [];
  const closed: number[] = [];
  let instances = 0;

  class FakeVideoEncoder {
    state = "unconfigured";
    private _id: number;
    private _mode: Mode;
    private _onError: (e: Error) => void;
    constructor(init: VideoEncoderInit) {
      this._id = instances++;
      this._onError = init.error as unknown as (e: Error) => void;
    }
    configure(config: VideoEncoderConfig): void {
      configured.push(config);
      this._mode = config.latencyMode;
      if (refuse.includes(config.latencyMode)) {
        const error = new Error("The given encoding is not supported");
        error.name = "NotSupportedError";
        throw error;
      }
      this.state = "configured";
    }
    encode(): void {}
    flush(): Promise<void> {
      if (asyncRefuse.includes(this._mode)) {
        const error = new Error("The given encoding is not supported.");
        error.name = "EncodingError";
        // Order as measured: the callback fires, the encoder is closed, and
        // the pending flush rejects.
        this._onError(error);
        this.state = "closed";
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    close(): void {
      closed.push(this._id);
      this.state = "closed";
    }
    static isConfigSupported(config: VideoEncoderConfig) {
      probed.push(config);
      return Promise.resolve({ supported: !refuse.includes(config.latencyMode), config });
    }
  }

  vi.stubGlobal("VideoEncoder", FakeVideoEncoder);
  return { configured, probed, closed };
}

describe("H264Encoder.checkSupport", () => {
  it("returns false when VideoEncoder is missing", async () => {
    expect(await H264Encoder.checkSupport()).toBe(false);
  });

  it("returns false when isConfigSupported is missing", async () => {
    vi.stubGlobal("VideoEncoder", class {});
    expect(await H264Encoder.checkSupport()).toBe(false);
  });

  it("probes the configuration the encoder actually uses, not another one", async () => {
    const fake = fakeVideoEncoder();
    expect(await H264Encoder.checkSupport()).toBe(true);

    // The defect behind #380: the probe used to fix codec, resolution and
    // hardwareAcceleration, and to omit latencyMode and avc entirely.
    const [probe] = fake.probed;
    expect(probe).toMatchObject({
      codec: "avc1.640028",
      hardwareAcceleration: "no-preference",
      latencyMode: "realtime",
      avc: { format: "avc" },
    });

    new H264Encoder({ width: probe!.width, height: probe!.height, fps: probe!.framerate });
    expect(fake.configured[fake.configured.length - 1]).toEqual(probe);
  });

  it("accepts a backend that only takes quality, after realtime is refused", async () => {
    const fake = fakeVideoEncoder(["realtime"]);
    expect(await H264Encoder.checkSupport()).toBe(true);
    expect(fake.probed.map(c => c.latencyMode)).toEqual(["realtime", "quality"]);
  });

  it("returns false when no latency mode is supported", async () => {
    const fake = fakeVideoEncoder(["realtime", "quality"]);
    expect(await H264Encoder.checkSupport()).toBe(false);
    expect(fake.probed).toHaveLength(2);
  });

  it("probes the caller's resolution when given one, since the codec depends on it", async () => {
    const fake = fakeVideoEncoder();
    await H264Encoder.checkSupport({ width: 3840, height: 2160 });
    expect(fake.probed[0]).toMatchObject({ codec: "avc1.640033", width: 3840, height: 2160 });
  });
});

describe("H264Encoder constructor", () => {
  it("configures realtime when the backend takes it", () => {
    const fake = fakeVideoEncoder();
    const encoder = new H264Encoder({ width: 1280, height: 720 });
    expect(encoder.latencyMode).toBe("realtime");
    expect(fake.configured).toHaveLength(1);
  });

  it("falls back to quality instead of throwing when realtime is refused", () => {
    const fake = fakeVideoEncoder(["realtime"]);
    const encoder = new H264Encoder({ width: 1280, height: 720 });

    expect(encoder.latencyMode).toBe("quality");
    expect(fake.configured.map(c => c.latencyMode)).toEqual(["realtime", "quality"]);
    // Same configuration both times, latency mode apart: the fallback must not
    // quietly change the output format.
    const [first, second] = fake.configured;
    expect({ ...first, latencyMode: undefined }).toEqual({ ...second, latencyMode: undefined });
    // The refused encoder is discarded rather than reconfigured.
    expect(fake.closed).toEqual([0]);
  });

  it("surfaces every refusal, not just the last one", () => {
    fakeVideoEncoder(["realtime", "quality"]);
    // Whoever reads this error is debugging a browser that claims to encode
    // H.264 and does not; knowing realtime was tried too is the useful part.
    let message = "";
    try {
      new H264Encoder({ width: 1280, height: 720 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/realtime/);
    expect(message).toMatch(/quality/);
    expect(message).toMatch(/not supported/i);
  });

  it("picks the codec from the resolution it is given", () => {
    const fake = fakeVideoEncoder();
    new H264Encoder({ width: 1920, height: 1080 });
    expect(fake.configured[0]).toMatchObject({ codec: "avc1.64002a", width: 1920, height: 1080 });
  });
});

describe("H264Encoder.validateLatencyModes", () => {
  it("rejects a mode the backend only refuses asynchronously", async () => {
    // The defect of #406: isConfigSupported() and configure() both accept
    // realtime, and the encoder dies a few milliseconds later.
    const fake = fakeVideoEncoder([], ["realtime"]);
    expect(await H264Encoder.validateLatencyModes()).toBe("quality");
    expect(fake.probed.map(c => c.latencyMode)).toEqual(["realtime", "quality"]);
    expect(fake.configured.map(c => c.latencyMode)).toEqual(["realtime", "quality"]);
  });

  it("keeps realtime on a backend that encodes in it", async () => {
    fakeVideoEncoder();
    expect(await H264Encoder.validateLatencyModes()).toBe("realtime");
  });

  it("returns null when every mode is refused asynchronously", async () => {
    fakeVideoEncoder([], ["realtime", "quality"]);
    expect(await H264Encoder.validateLatencyModes()).toBeNull();
    expect(await H264Encoder.checkSupport()).toBe(false);
  });

  it("validates once per realm, however many callers ask", async () => {
    const fake = fakeVideoEncoder([], ["realtime"]);
    const [a, b] = await Promise.all([
      H264Encoder.validateLatencyModes(),
      H264Encoder.validateLatencyModes(),
    ]);
    expect([a, b]).toEqual(["quality", "quality"]);
    await H264Encoder.validateLatencyModes();
    expect(fake.probed).toHaveLength(2);
  });

  it("makes the constructor skip the mode it refused", async () => {
    const fake = fakeVideoEncoder([], ["realtime"]);
    await H264Encoder.validateLatencyModes({ width: 1280, height: 720 });
    const before = fake.configured.length;

    const encoder = new H264Encoder({ width: 1280, height: 720 });

    expect(encoder.latencyMode).toBe("quality");
    // Not even tried: a synchronous configure() cannot tell this mode apart
    // from a working one.
    expect(fake.configured.slice(before).map(c => c.latencyMode)).toEqual(["quality"]);
  });

  it("names both modes when validation left none", async () => {
    fakeVideoEncoder([], ["realtime", "quality"]);
    await H264Encoder.validateLatencyModes();
    expect(() => new H264Encoder({ width: 1280, height: 720 })).toThrow(/realtime.*quality/);
  });
});

describe("H264Encoder asynchronous failure", () => {
  // Without validation — a realm that was never primed — the encoder still has
  // to fail where a caller can catch it, instead of throwing from a browser
  // task as it did before #406.
  it("rejects from flush() instead of throwing from the error callback", async () => {
    fakeVideoEncoder([], ["realtime"]);
    const encoder = new H264Encoder({ width: 1280, height: 720 });
    expect(encoder.latencyMode).toBe("realtime");

    await expect(encoder.flush()).rejects.toThrow(/EncodingError.*not supported/);
    await expect(encoder.flush()).rejects.toThrow(/realtime/);
  });

  it("refuses to encode once the encoder has failed", async () => {
    fakeVideoEncoder([], ["realtime"]);
    const encoder = new H264Encoder({ width: 1280, height: 720 });
    await expect(encoder.flush()).rejects.toThrow();

    expect(() => encoder.encode({ width: 1280, height: 720 } as never, 0, true))
      .toThrow(/no longer usable/);
  });
});
