// Single source of truth for the e2e target, shared by playwright.config.ts and
// the specs: E2E_BASE_URL wins, and the default is the local demo — the branch.
export const LOCAL_PORT = 8090;
export const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;

const raw = process.env.E2E_BASE_URL || LOCAL_URL;

/** Trailing slash matters: Playwright resolves relative URLs with `new URL()`. */
export const BASE_URL = raw.endsWith('/') ? raw : `${raw}/`;

const { hostname, port } = new URL(BASE_URL);

/** Whether the config serves demo/ itself. 127.0.0.1 reaches that server too. */
export const IS_LOCAL =
  (hostname === 'localhost' || hostname === '127.0.0.1') && port === String(LOCAL_PORT);

/** The cross-origin test loads the page from localhost and its assets from
 *  127.0.0.1, so it only holds when the page itself is on localhost. */
export const IS_LOCALHOST = IS_LOCAL && hostname === 'localhost';
