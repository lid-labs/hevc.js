/** The plugin decoding on the page's thread, end to end through Mediabunny under Node. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerHevcDecoder } from "./index.js";
import { DECODE_TEST_TIMEOUT, expectDecodesThroughMediabunny, installWasmGlobal, removeWasmGlobal } from "./test-utils.js";

beforeAll(installWasmGlobal);
afterAll(removeWasmGlobal);

describe("registerHevcDecoder", () => {
  // Runs first: registration is module-wide, and the next test needs it to succeed afterwards
  it("lets a call retry after a failed registration", async () => {
    await expect(registerHevcDecoder(null as unknown as {})).rejects.toThrow(TypeError);
    await expect(registerHevcDecoder()).resolves.toBeUndefined();
  });

  it("decodes an HEVC track through Mediabunny, frames timed in display order", async () => {
    await registerHevcDecoder();
    await expectDecodesThroughMediabunny();
  }, DECODE_TEST_TIMEOUT);
});
