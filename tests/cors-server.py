"""HTTP server for e2e tests — same as `python3 -m http.server` but with
permissive CORS headers so the cross-origin asset loading test
(localhost ↔ 127.0.0.1) can fetch the worker / wasm scripts."""

import http.server
import socketserver
import sys


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
with socketserver.TCPServer(("", port), CORSHandler) as httpd:
    httpd.serve_forever()
