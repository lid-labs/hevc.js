// Single source of truth for the e2e target, shared by playwright.config.ts and
// the specs: E2E_BASE_URL wins, and the default is the local demo — the branch.
export const LOCAL_PORT = 8090;
export const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;

const raw = process.env.E2E_BASE_URL || LOCAL_URL;

function parseTarget(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`E2E_BASE_URL must be an absolute URL, got: ${url}`);
  }
  // "localhost:8090" parses without throwing, as scheme "localhost:" with no host.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`E2E_BASE_URL must start with http:// or https://, got: ${url}`);
  }
  // Relative resolution drops both, so carrying them would be a silent loss.
  if (parsed.search || parsed.hash) {
    throw new Error(`E2E_BASE_URL must have no query or fragment, got: ${url}`);
  }
  return parsed;
}

const target = parseTarget(raw);

// Trailing slash matters: Playwright resolves relative URLs with `new URL()`,
// which drops the last path segment without one.
if (!target.pathname.endsWith('/')) target.pathname += '/';

export const BASE_URL = target.href;

/** Whether the config serves demo/ itself. 127.0.0.1 reaches that server too. */
export const IS_LOCAL =
  (target.hostname === 'localhost' || target.hostname === '127.0.0.1') &&
  target.port === String(LOCAL_PORT);

/** The cross-origin test loads the page from localhost and its assets from
 *  127.0.0.1, so it only holds when the page itself is on localhost. */
export const IS_LOCALHOST = IS_LOCAL && target.hostname === 'localhost';
