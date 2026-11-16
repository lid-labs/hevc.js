#!/usr/bin/env node
/**
 * Does this browser actually encode H.264 in the latency mode it accepts?
 *
 * Gecko refuses `latencyMode: "realtime"` asynchronously (#406): the probe
 * `isConfigSupported()` answers `true`, `configure()` does not throw, and the
 * encoder then closes with `EncodingError` through its error callback. So the
 * only honest check configures a real encoder and flushes it — the empty
 * `flush()` right after `configure()` settles it without encoding a frame.
 *
 * The probe itself is the one uplg posted in #399; this driver speaks
 * WebDriver BiDi (Gecko) and CDP (Chromium) directly, so it needs no
 * dependency beyond node 22+ (global WebSocket) and a browser on the machine.
 *
 *   node tools/probe_webcodecs_latency.mjs gecko /Applications/Zen.app/Contents/MacOS/zen
 *   node tools/probe_webcodecs_latency.mjs chromium "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
 *
 * Exits 1 when a mode that `isConfigSupported()` accepted and `configure()`
 * took without throwing produced no chunk — so it can sit in a CI job as it
 * is. Exit 2 means the browser could not be driven, which is not a verdict.
 */
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [engine, executablePath] = process.argv.slice(2);
if (!["gecko", "chromium"].includes(engine) || !executablePath) {
  console.error("usage: node tools/probe_webcodecs_latency.mjs <gecko|chromium> <path to browser binary>");
  process.exit(2);
}

/** Runs in a worker, because that is where hevc.js encodes. */
const PROBE_BODY = `
  const SIZES = [[1280, 720, 'avc1.640028'], [1920, 1080, 'avc1.64002a'], [3840, 2160, 'avc1.640033']];
  async function tryCase(width, height, codec, latencyMode) {
    // The config buildEncoderConfig() produces in packages/core/src/h264-encoder.ts.
    const config = { codec, width, height, bitrate: width * height * 25 * 0.1, framerate: 25,
      hardwareAcceleration: 'no-preference', latencyMode, avc: { format: 'avc' } };
    const r = { size: width + 'x' + height, codec, latencyMode, errorCallback: 'none', chunks: 0 };
    r.isConfigSupported = (await VideoEncoder.isConfigSupported(config)).supported;
    const enc = new VideoEncoder({
      output: () => { r.chunks++; },
      error: (e) => { r.errorCallback = e.name + ': ' + e.message; },
    });
    try { enc.configure(config); r.configure = 'no throw'; }
    catch (e) { r.configure = 'threw ' + e.name; return r; }
    r.stateAfterConfigure = enc.state;
    r.emptyFlush = await enc.flush().then(() => 'resolved', (e) => 'rejected ' + e.name);
    if (enc.state === 'configured') {
      for (let i = 0; i < 3; i++) {
        const frame = new VideoFrame(new Uint8Array(width * height * 1.5),
          { format: 'I420', codedWidth: width, codedHeight: height, timestamp: i * 40000 });
        enc.encode(frame, { keyFrame: i === 0 });
        frame.close();
      }
      await enc.flush().catch(() => {});
    }
    r.finalState = enc.state;
    if (enc.state !== 'closed') enc.close();
    return r;
  }
  (async () => {
    const rows = [];
    for (const [w, h, codec] of SIZES) for (const mode of ['realtime', 'quality']) rows.push(await tryCase(w, h, codec, mode));
    postMessage({ ua: navigator.userAgent, rows });
  })();`;

const PROBE_FN = `() => new Promise((resolve) => {
  const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(PROBE_BODY)}], { type: 'text/javascript' })));
  worker.onmessage = (e) => resolve(JSON.stringify(e.data));
  worker.onerror = (e) => resolve(JSON.stringify({ ua: navigator.userAgent, rows: [], workerError: e.message || 'worker failed' }));
})`;

// WebCodecs needs a secure context, and http://127.0.0.1 is one.
const server = createServer((_, res) =>
  res.setHeader("content-type", "text/html").end("<!doctype html><title>probe</title>"));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

// A port the OS says is free, rather than a guess: 9222 is the usual CDP
// port, and a browser the user already has open would answer there — the
// probe would then drive their session instead of its own.
const port = await new Promise((resolve, reject) => {
  const probeSocket = createSocketServer();
  probeSocket.on("error", reject);
  probeSocket.listen(0, "127.0.0.1", () => {
    const { port: free } = probeSocket.address();
    probeSocket.close(() => resolve(free));
  });
});
const profile = mkdtempSync(join(tmpdir(), "webcodecs-probe-"));

// A throwaway profile, and --no-remote for Gecko: never attach to the
// browser the user has open.
const args = engine === "gecko"
  ? ["--headless", "--no-remote", "--new-instance", "--profile", profile, "--remote-debugging-port", String(port)]
  : ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, url];
const child = spawn(executablePath, args, { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });

const connect = async (endpoint) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const target = typeof endpoint === "function" ? await endpoint() : endpoint;
      const socket = new WebSocket(target);
      await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error("not up yet"));
      });
      return socket;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return null;
};

/** One request/response channel over either protocol. */
function rpc(socket, { errorOf, resultOf }) {
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const settle = pending.get(message.id);
    if (!settle) return;
    pending.delete(message.id);
    const error = errorOf(message);
    error ? settle.reject(new Error(error)) : settle.resolve(resultOf(message));
  };
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

let out;
let socket;
try {
  if (engine === "gecko") {
    socket = await connect(`ws://127.0.0.1:${port}/session`);
    if (!socket) throw new Error("the remote agent never came up");
    const send = rpc(socket, {
      errorOf: (m) => (m.type === "error" ? `${m.error}: ${m.message}` : null),
      resultOf: (m) => m.result,
    });
    await send("session.new", { capabilities: { alwaysMatch: {} } });
    const { contexts } = await send("browsingContext.getTree", {});
    const context = contexts[0].context;
    await send("browsingContext.navigate", { context, url, wait: "complete" });
    const res = await send("script.callFunction", {
      functionDeclaration: PROBE_FN, awaitPromise: true, target: { context },
    });
    if (res.type === "exception") throw new Error(JSON.stringify(res.exceptionDetails));
    out = JSON.parse(res.result.value);
  } else {
    socket = await connect(async () => {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1"));
      if (!page) throw new Error("no page target yet");
      return page.webSocketDebuggerUrl;
    });
    if (!socket) throw new Error("no debuggable page target");
    const send = rpc(socket, {
      errorOf: (m) => m.error?.message ?? null,
      resultOf: (m) => m.result,
    });
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: `(${PROBE_FN})()`, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
    out = JSON.parse(result.value);
  }
} catch (error) {
  console.error(`could not drive ${engine}: ${error.message}\n${stderr.slice(-2000)}`);
  process.exitCode = 2;
} finally {
  try { socket?.close(); } catch { /* never opened */ }
  child.kill("SIGTERM");
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold it */ }
}

if (out) {
  console.log(out.ua);
  if (out.workerError) console.log("worker error:", out.workerError);
  console.table(out.rows);
  // A mode the browser said yes to twice and then encoded nothing in.
  const refused = out.rows.filter((r) => r.isConfigSupported && r.configure === "no throw" && r.chunks === 0);
  console.log(refused.length > 0
    ? `${refused.length} mode(s) silently refused: ${refused.map((r) => `${r.size} ${r.latencyMode}`).join(", ")}`
    : "every accepted mode encoded");
  process.exitCode = refused.length > 0 ? 1 : 0;
}
