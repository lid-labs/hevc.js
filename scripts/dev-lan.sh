#!/usr/bin/env bash
# Serve the hevc.js demo over HTTPS on the local network.
# Usage: pnpm dev:lan        (default port 8443)
#        PORT=9000 pnpm dev:lan
#
# Browser on the test PC will show a "Not secure" warning since the local
# CA isn't trusted there — click "Advanced → Continue" once. WebCodecs
# still works because isSecureContext is true under accepted HTTPS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CERT_DIR="$SCRIPT_DIR/.certs"
CERT="$CERT_DIR/lan.pem"
KEY="$CERT_DIR/lan-key.pem"
PORT="${PORT:-8443}"

# --- Preflight -------------------------------------------------------------
for bin in mkcert pnpm node openssl; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "Error: '$bin' not found in PATH"
    [ "$bin" = "mkcert" ] && echo "  -> brew install mkcert"
    exit 1
  }
done

# --- Detect LAN IP ---------------------------------------------------------
IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$IP" ]; then
  IP="$(ifconfig 2>/dev/null \
    | grep -E 'inet (192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' \
    | grep -v 127.0.0.1 \
    | awk '{print $2}' | head -1)"
fi
[ -n "$IP" ] || { echo "Error: cannot detect a LAN IP (192.168.x / 10.x / 172.16-31.x)"; exit 1; }

# --- Cert: regen if missing or doesn't cover current IP --------------------
mkdir -p "$CERT_DIR"
needs_regen=1
if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  if openssl x509 -in "$CERT" -text -noout 2>/dev/null \
       | grep -q "IP Address:$IP\b"; then
    needs_regen=0
  fi
fi
if [ "$needs_regen" -eq 1 ]; then
  echo "-> Generating cert for $IP + localhost + 127.0.0.1"
  mkcert -cert-file "$CERT" -key-file "$KEY" "$IP" localhost 127.0.0.1 >/dev/null
fi

# --- Build JS packages + demo bundles (skip WASM: uses committed artifact) -
# `build:js` is required: the demo bundles import @hevcjs/core via the
# package's "exports" map, which resolves to packages/core/dist/index.js.
cd "$PROJECT_DIR"
echo "-> Building JS packages (tsup)"
pnpm -s build:js
echo "-> Building demo bundles (esbuild)"
pnpm -s build:demo:dash-bundle
pnpm -s build:demo:shaka-bundle
pnpm -s build:demo:worker

# --- Output ---------------------------------------------------------------
echo ""
echo "=========================================="
echo "  Shaka:    https://$IP:$PORT/shaka.html"
echo "  Dash.js:  https://$IP:$PORT/dash.html"
echo ""
echo "  On the test PC, click 'Advanced -> Continue'"
echo "  to accept the cert. WebCodecs works under the"
echo "  accepted HTTPS context."
echo "=========================================="
echo ""

exec node "$SCRIPT_DIR/dev-lan-serve.mjs" "$PORT" "$CERT" "$KEY" "$PROJECT_DIR/demo"
