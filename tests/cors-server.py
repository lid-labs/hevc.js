"""HTTP server for e2e tests — same as `python3 -m http.server` but with
permissive CORS headers so the cross-origin asset loading test
(localhost ↔ 127.0.0.1) can fetch the worker / wasm scripts.

Sends Cache-Control: no-store for /streams/ — regenerated demo streams keep
the same filenames (seg_000.m4s, ...), and a browser serving stale cached
segments during manual testing is a painful red herring. Other assets
(multi-MB wasm, bundles) stay cacheable: with no-store the browser re-fetches
hevc-decode.wasm on every page load, which starves a single-threaded server
and breaks Playwright's networkidle. The server is threaded for the same
reason (parallel segment + asset fetches)."""

import http.server
import socketserver
import sys


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        if self.path.split("?", 1)[0].startswith("/streams/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
with ThreadingTCPServer(("", port), CORSHandler) as httpd:
    httpd.serve_forever()
