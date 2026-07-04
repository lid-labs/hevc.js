#!/usr/bin/env node
// Tiny HTTPS static file server for the demo, called by dev-lan.sh.
// Zero npm deps — uses only Node built-ins.
import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";

const [port, certPath, keyPath, rawRoot] = process.argv.slice(2);
if (!port || !certPath || !keyPath || !rawRoot) {
  console.error("Usage: dev-lan-serve.mjs <port> <cert> <key> <root>");
  process.exit(2);
}

const ROOT = normalize(rawRoot);
const ROOT_PREFIX = ROOT.endsWith(sep) ? ROOT : ROOT + sep;

const cert = await readFile(certPath);
const key = await readFile(keyPath);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".mp4":  "video/mp4",
  ".m4s":  "video/iso.segment",
  ".mpd":  "application/dash+xml",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts":   "video/mp2t",
  ".map":  "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = createServer({ cert, key }, async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "https://x/");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const resolved = normalize(join(ROOT, path));
    // Path traversal guard
    if (resolved !== ROOT && !resolved.startsWith(ROOT_PREFIX)) {
      res.statusCode = 403;
      return res.end("forbidden");
    }
    const data = await readFile(resolved);
    const mime = MIME[extname(resolved).toLowerCase()] ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    res.end(data);
  } catch (err) {
    res.statusCode = err.code === "ENOENT" ? 404 : 500;
    res.end(err.code ?? "error");
  }
});

server.listen(Number(port), "0.0.0.0", () => {
  console.log(`HTTPS file server listening on 0.0.0.0:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
