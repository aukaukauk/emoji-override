// Starts the locally installed Chrome, headless and with a throwaway profile, and speaks the
// DevTools protocol to it over a pipe. No npm packages are involved.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];

export function findChrome() {
  return CANDIDATES.find((candidate) => candidate && existsSync(candidate)) || null;
}

export async function launchChrome() {
  const executable = findChrome();
  if (!executable) throw new Error('Chrome was not found. Set CHROME_PATH to its executable.');

  const profile = mkdtempSync(join(tmpdir(), 'noto-emoji-override-test-'));
  const child = spawn(executable, [
    '--headless=new',
    '--remote-debugging-pipe',
    // Lets Extensions.loadUnpacked install the extension under test.
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-pings',
    '--window-size=1200,900',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  let nextId = 0;
  let closed = false;
  const pending = new Map();
  const sessions = new Map();
  let buffer = '';

  child.stdio[4].on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, method } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      } else if (message.method && sessions.has(message.sessionId)) {
        sessions.get(message.sessionId)(message.method, message.params);
      }
    }
  });
  child.on('exit', () => {
    closed = true;
    for (const { reject, method } of pending.values()) reject(new Error(`${method}: Chrome exited`));
    pending.clear();
  });

  function send(method, params = {}, sessionId) {
    if (closed) return Promise.reject(new Error(`${method}: Chrome is not running`));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }

  async function newPage() {
    // A window of its own keeps the page in the foreground, where timers and idle callbacks
    // are not throttled.
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const command = (method, params) => send(method, params, sessionId);
    const errors = [];
    const contexts = [];
    let onLoad = null;

    sessions.set(sessionId, (method, params) => {
      if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails;
        errors.push(details.exception && details.exception.description ? details.exception.description : details.text);
      } else if (method === 'Runtime.executionContextCreated') {
        contexts.push(params.context);
      } else if (method === 'Runtime.executionContextsCleared') {
        contexts.length = 0;
      } else if (method === 'Page.loadEventFired' && onLoad) {
        onLoad();
        onLoad = null;
      }
    });

    await command('Page.enable');
    await command('Runtime.enable');

    return {
      // Uncaught exceptions from every script in the page, including the extension's.
      errors,

      // Runs `source` in every new document of this page before any of its scripts.
      addInitScript: (source) => command('Page.addScriptToEvaluateOnNewDocument', { source }),

      async goto(url) {
        const loaded = new Promise((resolve) => { onLoad = resolve; });
        const { errorText } = await command('Page.navigate', { url });
        if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
        await loaded;
      },

      // Calls `fn(arg)` inside the page and returns its (awaited, JSON-serialisable) result.
      // `fn` is sent as source text, so it cannot use variables from the test file.
      async evaluate(fn, arg, { contextId } = {}) {
        const result = await command('Runtime.evaluate', {
          expression: `(${fn})(${JSON.stringify(arg === undefined ? null : arg)})`,
          awaitPromise: true,
          returnByValue: true,
          ...(contextId ? { contextId } : {})
        });
        if (result.exceptionDetails) {
          const { exception, text } = result.exceptionDetails;
          throw new Error(`In page: ${exception && exception.description ? exception.description : text}`);
        }
        return result.result.value;
      },

      // The isolated world the extension's content scripts run in, once they have been injected.
      extensionContextId() {
        const context = contexts.find((candidate) => candidate.auxData
          && candidate.auxData.type === 'isolated'
          && String(candidate.origin).startsWith('chrome-extension://'));
        return context ? context.id : null;
      },

      close: () => send('Target.closeTarget', { targetId })
    };
  }

  return {
    newPage,

    // Installs an unpacked extension into the throwaway profile and returns its id.
    async loadExtension(directory) {
      const { id } = await send('Extensions.loadUnpacked', { path: directory });
      return id;
    },

    async close() {
      if (!closed) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await exited;
      }
      // Chrome's helper processes go on writing to the profile for a moment after the browser
      // itself has gone, and removing the folder meanwhile fails with ENOTEMPTY. A folder that
      // is still there in the end is left behind: it is a temporary one, and no reason for a
      // test to fail.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          rmSync(profile, { recursive: true, force: true });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
    }
  };
}
