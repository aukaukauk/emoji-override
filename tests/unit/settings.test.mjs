import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExtensionScript } from './support/load.mjs';

const { settings } = loadExtensionScript('scripts/settings.js');

// Stands in for chrome.storage. Each call is recorded as "area.method", and a call named in
// `failing` rejects, or throws at once when it is named with an exclamation mark.
function useStorage({ sync = {}, local = {} } = {}) {
  const data = { sync: { ...sync }, local: { ...local } };
  const calls = [];
  const failing = new Set();
  const listeners = [];

  const emit = (areaName, changes) => {
    for (const listener of listeners) listener(changes, areaName);
  };

  function area(name) {
    const stored = data[name];
    const call = (method, run) => {
      const id = `${name}.${method}`;
      calls.push(id);
      if (failing.has(`${id}!`)) throw new Error('Extension context invalidated.');
      if (failing.has(id)) return Promise.reject(new Error(`${id} failed`));
      return Promise.resolve().then(run);
    };

    return {
      get: (keys) => call('get', () => Object.fromEntries(
        [keys].flat().filter((key) => Object.hasOwn(stored, key)).map((key) => [key, structuredClone(stored[key])])
      )),
      set: (items) => call('set', () => {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: stored[key], newValue: value };
          stored[key] = structuredClone(value);
        }
        emit(name, changes);
      }),
      remove: (keys) => call('remove', () => {
        const changes = {};
        for (const key of [keys].flat()) {
          if (!Object.hasOwn(stored, key)) continue;
          changes[key] = { oldValue: stored[key] };
          delete stored[key];
        }
        if (Object.keys(changes).length) emit(name, changes);
      })
    };
  }

  globalThis.chrome = {
    storage: {
      sync: area('sync'),
      local: area('local'),
      onChanged: { addListener: (listener) => listeners.push(listener) }
    }
  };

  return { data, calls, failing, emit };
}

afterEach(() => {
  delete globalThis.chrome;
});

describe('normalizeHosts', () => {
  test('lower-cases, trims, removes duplicates and sorts', () => {
    assert.deepEqual(
      settings.normalizeHosts([' Example.com ', 'b.example', 'example.com', 'A.example']),
      ['a.example', 'b.example', 'example.com']
    );
  });

  test('drops what is not a host name', () => {
    assert.deepEqual(settings.normalizeHosts(['', '   ', null, 42, { host: 'x' }, 'ok.example']), ['ok.example']);
    for (const notAList of [undefined, null, 'example.com', { 0: 'example.com', length: 1 }]) {
      assert.deepEqual(settings.normalizeHosts(notAList), []);
    }
  });
});

describe('read', () => {
  test('is on with no blocked sites when nothing is stored', async () => {
    useStorage();
    assert.deepEqual(await settings.read(), { enabled: true, blockedHosts: [], legacyBlockedHosts: [], complete: true });
  });

  test('takes the switch from sync storage and the block list from local storage', async () => {
    useStorage({ sync: { enabled: false }, local: { blockedHosts: ['B.example', 'a.example'] } });
    assert.deepEqual(await settings.read(), {
      enabled: false,
      blockedHosts: ['a.example', 'b.example'],
      legacyBlockedHosts: [],
      complete: true
    });
  });

  test('uses a block list left in sync storage until there is a local one', async () => {
    useStorage({ sync: { blockedHosts: ['Old.example'] } });
    assert.deepEqual(await settings.read(), {
      enabled: true,
      blockedHosts: ['old.example'],
      legacyBlockedHosts: ['old.example'],
      complete: true
    });
  });

  test('lets a local block list win, even an empty one', async () => {
    useStorage({ sync: { blockedHosts: ['old.example'] }, local: { blockedHosts: [] } });
    assert.deepEqual(await settings.read(), { enabled: true, blockedHosts: [], legacyBlockedHosts: [], complete: true });
  });

  test('survives values of the wrong type', async () => {
    useStorage({ sync: { enabled: 0 }, local: { blockedHosts: 'example.com' } });
    assert.deepEqual(await settings.read(), { enabled: false, blockedHosts: [], legacyBlockedHosts: [], complete: true });
  });

  for (const failure of ['sync.get', 'sync.get!', 'local.get', 'local.get!']) {
    test(`rejects when ${failure} fails, unless asked to be tolerant`, async () => {
      const storage = useStorage({ sync: { enabled: false }, local: { blockedHosts: ['a.example'] } });
      storage.failing.add(failure);

      await assert.rejects(settings.read());

      // The area that failed counts as empty; the other one is still used. `complete` says
      // that this is not what is stored.
      const expected = failure.startsWith('sync')
        ? { enabled: true, blockedHosts: ['a.example'], legacyBlockedHosts: [], complete: false }
        : { enabled: false, blockedHosts: [], legacyBlockedHosts: [], complete: false };
      assert.deepEqual(await settings.read({ tolerant: true }), expected);
    });
  }

  test('reads nothing, and says so, when there is no extension API at all and it is tolerant', async () => {
    assert.equal(typeof globalThis.chrome, 'undefined');
    assert.deepEqual(await settings.read({ tolerant: true }), { enabled: true, blockedHosts: [], legacyBlockedHosts: [], complete: false });
    await assert.rejects(settings.read());
  });
});

describe('isActiveFor', () => {
  const stored = { enabled: true, blockedHosts: ['example.com'] };

  test('is off for a blocked host and on for any other', () => {
    assert.equal(settings.isActiveFor(stored, 'example.com'), false);
    assert.equal(settings.isActiveFor(stored, 'example.org'), true);
  });

  test('matches the whole host name only', () => {
    assert.equal(settings.isActiveFor(stored, 'sub.example.com'), true);
    assert.equal(settings.isActiveFor(stored, 'notexample.com'), true);
  });

  test('is on for a document without a host, such as a local file', () => {
    assert.equal(settings.isActiveFor(stored, ''), true);
    assert.equal(settings.isActiveFor({ enabled: true, blockedHosts: [''] }, ''), true);
  });

  test('is off everywhere when the switch is off', () => {
    const off = { enabled: false, blockedHosts: [] };
    assert.equal(settings.isActiveFor(off, 'example.org'), false);
    assert.equal(settings.isActiveFor(off, ''), false);
  });
});

describe('writing', () => {
  test('setEnabled writes the switch to sync storage', async () => {
    const storage = useStorage();
    await settings.setEnabled(false);
    assert.deepEqual(storage.data, { sync: { enabled: false }, local: {} });
  });

  test('setBlockedHosts writes a tidy list to local storage', async () => {
    const storage = useStorage({ sync: { enabled: true } });
    await settings.setBlockedHosts(['B.example', 'a.example', 'b.example']);
    assert.deepEqual(storage.data, { sync: { enabled: true }, local: { blockedHosts: ['a.example', 'b.example'] } });
  });

  test('both reject when the write fails', async () => {
    const storage = useStorage();
    storage.failing.add('sync.set').add('local.set');
    await assert.rejects(settings.setEnabled(false));
    await assert.rejects(settings.setBlockedHosts(['a.example']));
    assert.deepEqual(storage.data, { sync: {}, local: {} });
  });
});

describe('keepLegacyBlockedHosts', () => {
  test('copies the list to local storage and leaves it in sync storage', async () => {
    const storage = useStorage({ sync: { enabled: false, blockedHosts: ['old.example'] } });
    const { legacyBlockedHosts } = await settings.read();
    storage.calls.length = 0;

    await settings.keepLegacyBlockedHosts(legacyBlockedHosts);

    assert.deepEqual(storage.calls, ['local.set']);
    assert.deepEqual(storage.data, {
      sync: { enabled: false, blockedHosts: ['old.example'] },
      local: { blockedHosts: ['old.example'] }
    });
    assert.deepEqual(await settings.read(), {
      enabled: false,
      blockedHosts: ['old.example'],
      legacyBlockedHosts: [],
      complete: true
    });
  });

  test('rejects when the copy fails, and the list is still read from sync storage', async () => {
    const storage = useStorage({ sync: { blockedHosts: ['old.example'] } });
    storage.failing.add('local.set');

    await assert.rejects(settings.keepLegacyBlockedHosts(['old.example']));

    storage.failing.clear();
    assert.deepEqual(storage.data, { sync: { blockedHosts: ['old.example'] }, local: {} });
    assert.deepEqual((await settings.read()).blockedHosts, ['old.example']);
  });

  // Two browsers of one account share sync storage and have a local storage each. The stand-in
  // keeps a copy of what it is given, so after each step what it holds is carried over.
  test('leaves the list for another browser of the same account, in either order', async () => {
    for (const order of [['a', 'b'], ['b', 'a']]) {
      let shared = { blockedHosts: ['blocked.example'] };
      const locals = { a: {}, b: {} };
      const on = async (name, work) => {
        const storage = useStorage({ sync: shared, local: locals[name] });
        const result = await work();
        shared = storage.data.sync;
        locals[name] = storage.data.local;
        return result;
      };
      // What the popup does when it opens.
      const open = (name) => on(name, async () => {
        const state = await settings.read();
        if (state.legacyBlockedHosts.length) await settings.keepLegacyBlockedHosts(state.legacyBlockedHosts);
        return (await settings.read()).blockedHosts;
      });
      const [first, second] = order;

      // The second browser reads the list before and after the first one has opened its popup.
      assert.deepEqual(await on(second, async () => (await settings.read()).blockedHosts), ['blocked.example']);
      assert.deepEqual(await open(first), ['blocked.example']);
      assert.deepEqual(await on(second, async () => (await settings.read()).blockedHosts), ['blocked.example'], `order ${order}`);
      assert.deepEqual(await open(second), ['blocked.example']);

      // The first browser allows the site again. The other one keeps its own list.
      await on(first, () => settings.setBlockedHosts([]));
      assert.deepEqual(await on(first, async () => (await settings.read()).blockedHosts), []);
      assert.deepEqual(await on(second, async () => (await settings.read()).blockedHosts), ['blocked.example']);
    }
  });
});

describe('onChange', () => {
  function listen() {
    const storage = useStorage();
    let count = 0;
    settings.onChange(() => {
      count += 1;
    });
    return { storage, count: () => count };
  }

  test('reports a change of the switch or of either block list', async () => {
    const { storage, count } = listen();

    await settings.setEnabled(false);
    assert.equal(count(), 1);
    await settings.setBlockedHosts(['a.example']);
    assert.equal(count(), 2);
    storage.emit('sync', { blockedHosts: { oldValue: ['old.example'] } });
    assert.equal(count(), 3);
  });

  test('ignores other keys and other storage areas', () => {
    const { storage, count } = listen();

    storage.emit('sync', { somethingElse: { newValue: 1 } });
    storage.emit('local', { enabled: { newValue: false } });
    storage.emit('session', { enabled: { newValue: false }, blockedHosts: { newValue: [] } });
    storage.emit('managed', { blockedHosts: { newValue: [] } });
    assert.equal(count(), 0);
  });
});
