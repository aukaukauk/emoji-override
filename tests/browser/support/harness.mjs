// Shared setup for the browser tests: one Chrome and one local server per test file, plus the
// helpers and the chrome.* stand-in that are injected into test documents.
import { after, before } from 'node:test';
import { findChrome, launchChrome } from './chrome.mjs';
import { startServer } from './server.mjs';

// Without Chrome these tests are skipped, so that the rest can be run on a machine that has
// none. Where they must run, on a CI machine (`CI`) or when `REQUIRE_CHROME` is set, a missing
// Chrome stops the run instead: a release check that passes without having opened a page is
// worse than one that fails.
const mustRun = (name) => Boolean(process.env[name]) && process.env[name] !== '0' && process.env[name] !== 'false';
if (!findChrome() && (mustRun('CI') || mustRun('REQUIRE_CHROME'))) {
  throw new Error('Chrome was not found, and the browser tests may not be skipped here. Set CHROME_PATH to its executable.');
}

export const skipWithoutChrome = findChrome() ? {} : { skip: 'Chrome was not found (set CHROME_PATH)' };

// Emoji used in tests, spelled with escapes so that the invisible joiners and variation
// selectors cannot get lost in an editor.
export const E = {
  grin: '\u{1F600}',
  party: '\u{1F389}',
  rocket: '\u{1F680}',
  fire: '\u{1F525}',
  check: '\u{2705}',
  thumbsUp: '\u{1F44D}',
  thumbsUpMedium: '\u{1F44D}\u{1F3FD}',
  flagChina: '\u{1F1E8}\u{1F1F3}',
  keycapOne: '1\u{FE0F}\u{20E3}',
  family: '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
  heart: '\u{2764}\u{FE0F}'
};

// Available inside test documents as `__t`.
const HELPERS = `window.__t = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  idle: () => new Promise((resolve) => requestIdleCallback(() => resolve(), { timeout: 700 })),
  // Resolves once the extension has had the chance to process everything queued so far. Its
  // work runs in idle callbacks, and one pass can queue a second one.
  async settle() {
    await this.idle();
    await this.idle();
    await this.sleep(40);
  },
  async fontsReady() {
    void document.body.offsetHeight;
    await document.fonts.ready;
    await this.sleep(60);
  },
  wrapped: (root = document) => [...root.querySelectorAll('.noto-emoji-wrapped')],
  count(target) {
    const root = typeof target === 'string' ? document.querySelector(target) : target;
    return root.querySelectorAll('.noto-emoji-wrapped').length;
  },
  marker: () => document.documentElement.hasAttribute('data-noto-emoji-enabled'),
  active: () => Boolean(window.__notoEmojiOverride?.state?.active)
};`;

// A stand-in for the extension APIs that the content scripts and the popup call. Storage reads
// resolve on a microtask unless `delay` (ms) is given. Inside the page, `__chromeStub.store`
// exposes the stored values and `__chromeStub.failing.read / .write` make calls fail.
export function chromeStub({ storage = {}, delay = 0, tab = null, messages = null } = {}) {
  const config = { storage: { sync: {}, local: {}, ...storage }, delay, tab, messages };
  return `(() => {
  const config = ${JSON.stringify(config)};
  const store = config.storage;
  const failing = { read: false, write: false };
  const listeners = [];
  const later = (value) => (config.delay
    ? new Promise((resolve) => setTimeout(() => resolve(value), config.delay))
    : Promise.resolve(value));
  // The real APIs return a promise, or call back when a callback is passed.
  const reply = (promise, callback) => {
    if (typeof callback !== 'function') return promise;
    promise.then((value) => callback(value), (error) => {
      window.chrome.runtime.lastError = { message: String(error.message) };
      callback();
      delete window.chrome.runtime.lastError;
    });
    return undefined;
  };
  const notify = (changes, areaName) => { for (const listener of listeners) listener(changes, areaName); };
  const area = (name) => ({
    get(keys, callback) {
      const run = async () => {
        if (failing.read) throw new Error('storage read failed');
        const out = {};
        for (const key of [].concat(keys)) {
          if (Object.hasOwn(store[name], key)) out[key] = store[name][key];
        }
        return later(out);
      };
      return reply(run(), callback);
    },
    set(items, callback) {
      const run = async () => {
        if (failing.write) throw new Error('storage write failed');
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: store[name][key], newValue: value };
          store[name][key] = value;
        }
        await later();
        notify(changes, name);
      };
      return reply(run(), callback);
    },
    remove(keys, callback) {
      const run = async () => {
        if (failing.write) throw new Error('storage write failed');
        const changes = {};
        for (const key of [].concat(keys)) {
          if (Object.hasOwn(store[name], key)) {
            changes[key] = { oldValue: store[name][key] };
            delete store[name][key];
          }
        }
        await later();
        notify(changes, name);
      };
      return reply(run(), callback);
    }
  });
  window.chrome = {
    runtime: {},
    storage: {
      sync: area('sync'),
      local: area('local'),
      onChanged: { addListener: (listener) => { listeners.push(listener); } }
    },
    tabs: { query: (query, callback) => reply(Promise.resolve(config.tab ? [config.tab] : []), callback) },
    i18n: { getMessage: (key) => (config.messages && config.messages[key] ? config.messages[key].message : '') }
  };
  window.__chromeStub = { store, failing };
})();`;
}

// Call once per test file, inside its `describe`.
export function useBrowser() {
  const browser = { chrome: null, server: null };

  before(async () => {
    if (!findChrome()) return;
    browser.chrome = await launchChrome();
    browser.server = await startServer();
  });

  after(async () => {
    try {
      if (browser.chrome) await browser.chrome.close();
    } finally {
      // Left open, the server would keep the test file's process from ending.
      if (browser.server) await browser.server.close();
    }
  });

  // Opens a test document and returns the page. Unless `url` is given, the document is built
  // from `body` / `head` / `doctype` and loads the extension's content scripts as page scripts
  // (`extension: false` leaves them out). `stub` configures the chrome.* stand-in; `false`
  // omits it, for pages that run under the real, installed extension. `init` is script source
  // that runs in the document before anything else does.
  browser.open = async ({ url, stub = {}, init, ...document } = {}) => {
    const page = await browser.chrome.newPage();
    await page.addInitScript(HELPERS);
    if (stub) await page.addInitScript(chromeStub(stub));
    if (init) await page.addInitScript(init);
    await page.goto(url || browser.server.page(document));
    return page;
  };

  return browser;
}
