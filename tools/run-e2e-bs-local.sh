#!/bin/bash
# Run E2E tests on BrowserStack using Local tunnel (tests against localhost)
# Usage: ./tools/run-e2e-bs-local.sh [test-file]
set -e

# Source credentials
source ~/.zshrc 2>/dev/null

if [ -z "$BROWSERSTACK_ACCESS_KEY" ]; then
  echo "ERROR: BROWSERSTACK_ACCESS_KEY not set"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Start BrowserStack Local tunnel
echo "=== Starting BrowserStack Local tunnel ==="
npx browserstack-local --key "$BROWSERSTACK_ACCESS_KEY" --daemon start 2>/dev/null
sleep 2

# Verify tunnel is running
if npx browserstack-local --key "$BROWSERSTACK_ACCESS_KEY" --daemon status 2>/dev/null | grep -q "running"; then
  echo "Tunnel active"
else
  echo "WARNING: Tunnel status unclear, proceeding anyway"
fi

TEST_FILE="${1:-tests/e2e/bugfix-validation.spec.ts}"

echo "=== Running E2E tests on BrowserStack (local tunnel) ==="
echo "Test file: $TEST_FILE"

# The default target is the local demo, which is what puts browserstack.local
# in the caps and starts the demo server.
npx playwright test \
  --project=bs-chrome-windows \
  --project=bs-edge-windows \
  --project=bs-firefox-windows \
  --project=bs-chrome-macos \
  --project=bs-safari-macos \
  "$TEST_FILE" || true

echo "=== Stopping BrowserStack Local tunnel ==="
npx browserstack-local --key "$BROWSERSTACK_ACCESS_KEY" --daemon stop 2>/dev/null

echo "=== Done ==="
echo "Report: npx playwright show-report"
