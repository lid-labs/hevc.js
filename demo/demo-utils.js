// Shared helpers for the demo pages. Loaded via <script src> before each
// page's inline script (no bundler for the inline demo scripts).
(function (global) {
  // Loopback hostnames — used only when the page itself is served from
  // loopback (local dev / the cross-origin E2E test on 127.0.0.1).
  var LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
  var pageIsLoopback = LOOPBACK.indexOf(location.hostname) !== -1;

  /**
   * Validate a transcoder-asset URL override (?workerUrl=, ?wasmUrl=,
   * ?wasmBinaryUrl=). Accepts ONLY the page's own origin (same protocol),
   * or a loopback origin when the page is itself on loopback. Everything
   * else is rejected — including public CDNs, which serve arbitrary
   * third-party scripts: @hevcjs/core wraps a cross-origin worker in a
   * same-origin blob and executes it, so an attacker-controlled workerUrl
   * from a shared link would be a script-execution gadget on this origin.
   * `'off'` is a sentinel ("no worker / main thread") → undefined, no warn.
   */
  function safeAssetUrl(value, name) {
    if (!value || value === "off") return undefined;
    try {
      var u = new URL(value, location.href);
      if (u.origin === location.origin && u.protocol === location.protocol) return value;
      if (pageIsLoopback &&
          (u.protocol === "http:" || u.protocol === "https:") &&
          LOOPBACK.indexOf(u.hostname) !== -1) {
        return value;
      }
    } catch (_) { /* malformed URL → warn below */ }
    console.warn("[demo] ignoring " + name + "=" + value + " (origin not allowed)");
    return undefined;
  }

  global.hevcDemo = { safeAssetUrl: safeAssetUrl };
})(window);
