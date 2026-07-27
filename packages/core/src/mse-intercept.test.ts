import { afterEach, describe, expect, it, vi } from "vitest";
import { getMediaSourceConstructor, installMSEIntercept, uninstallMSEIntercept } from "./mse-intercept.js";

// Node has no MediaSource/ManagedMediaSource — each test stubs what it needs.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMediaSourceConstructor", () => {
  it("returns null when neither MediaSource nor ManagedMediaSource exists", () => {
    expect(getMediaSourceConstructor()).toBeNull();
  });

  it("returns ManagedMediaSource when it is the only MSE flavor (iPhone Safari)", () => {
    class FakeManagedMediaSource {}
    vi.stubGlobal("ManagedMediaSource", FakeManagedMediaSource);
    expect(getMediaSourceConstructor()).toBe(FakeManagedMediaSource);
  });

  it("prefers classic MediaSource when both exist", () => {
    class FakeMediaSource {}
    class FakeManagedMediaSource {}
    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.stubGlobal("ManagedMediaSource", FakeManagedMediaSource);
    expect(getMediaSourceConstructor()).toBe(FakeMediaSource);
  });
});

describe("installMSEIntercept without classic MediaSource", () => {
  it("no-ops with a warning instead of throwing (iPhone Safari)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => installMSEIntercept()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[hevc.js]",
      expect.stringContaining("MediaSource is not available"),
    );
    warn.mockRestore();
  });

  it("leaves uninstallMSEIntercept a safe no-op afterwards", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installMSEIntercept();
    expect(() => uninstallMSEIntercept()).not.toThrow();
  });
});
