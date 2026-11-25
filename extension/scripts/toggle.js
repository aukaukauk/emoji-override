(() => {
  const KEY_ENABLED = 'enabled';
  const KEY_BLOCKED = 'blockedHosts';
  const ENABLED_ATTRIBUTE = 'data-noto-emoji-enabled';

  // The marker is restored from a MutationObserver callback. A page that removes it every time
  // would turn that into an endless loop, so past this rate the page is left alone.
  const RESTORE_LIMIT = 20;
  const RESTORE_WINDOW_MS = 1000;

  const host = (location.hostname || '').toLowerCase();
  const listeners = new Set();

  // Whether emoji replacement is on for this document. emoji_replacer.js runs after this file in
  // the same isolated world and takes the state from here, where page scripts cannot reach it.
  // The attribute on <html> is only an output: it switches the stylesheet on.
  const shared = {
    active: false,
    subscribe(listener) {
      listeners.add(listener);
    }
  };
  globalThis.__notoEmojiOverride = shared;

  let markedRoot = null;
  let restoreTimes = [];
  let abandoned = false;

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list
      .map((item) => (typeof item === 'string' ? item.toLowerCase().trim() : ''))
      .filter(Boolean))];
  }

  function syncMarker() {
    const root = document.documentElement;
    if (!root) return;

    if (root !== markedRoot) {
      // First call, or the page swapped the root element (document.open, replaceChild).
      markerObserver.disconnect();
      markerObserver.observe(root, {
        attributes: true,
        attributeFilter: [ENABLED_ATTRIBUTE]
      });
      markedRoot = root;
    }

    if (!abandoned && root.hasAttribute(ENABLED_ATTRIBUTE) !== shared.active) {
      root.toggleAttribute(ENABLED_ATTRIBUTE, shared.active);
    }
  }

  function setActive(shouldEnable) {
    const changed = shouldEnable !== shared.active;
    shared.active = shouldEnable;
    syncMarker();

    if (changed) {
      for (const listener of listeners) {
        listener(shouldEnable);
      }
    }
  }

  // Pages rewrite <html> attributes wholesale (theme switches, client-side navigation) or replace
  // the element itself (document.open), which takes the marker with it. Put it back, unless the
  // page keeps undoing that.
  function restoreMarker() {
    const root = document.documentElement;
    if (abandoned || !root) return;
    if (root === markedRoot && root.hasAttribute(ENABLED_ATTRIBUTE) === shared.active) return;

    const now = Date.now();
    restoreTimes = restoreTimes.filter((time) => now - time < RESTORE_WINDOW_MS);
    restoreTimes.push(now);

    if (restoreTimes.length > RESTORE_LIMIT) {
      abandoned = true;
      setActive(false);
      return;
    }

    syncMarker();
  }

  const markerObserver = new MutationObserver(restoreMarker);
  const rootObserver = new MutationObserver(restoreMarker);

  function getStorage(area, keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage[area].get(keys, (data) => {
          if (chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(data || {});
        });
      } catch (error) {
        resolve({});
      }
    });
  }

  async function readState() {
    const [syncData, localData] = await Promise.all([
      getStorage('sync', [KEY_ENABLED, KEY_BLOCKED]),
      getStorage('local', [KEY_BLOCKED])
    ]);

    const enabled = Object.prototype.hasOwnProperty.call(syncData, KEY_ENABLED)
      ? Boolean(syncData[KEY_ENABLED])
      : true;

    const blockedHosts = normalizeList(
      Object.prototype.hasOwnProperty.call(localData, KEY_BLOCKED)
        ? localData[KEY_BLOCKED]
        : syncData[KEY_BLOCKED]
    );

    // A settings change is a fresh start for a page that had been left alone.
    abandoned = false;
    restoreTimes = [];
    setActive(enabled && !(host && blockedHosts.includes(host)));
  }

  function subscribe() {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        const enabledChanged = areaName === 'sync' && Boolean(changes[KEY_ENABLED]);
        const blockedChanged = (areaName === 'local' || areaName === 'sync') && Boolean(changes[KEY_BLOCKED]);

        if (enabledChanged || blockedChanged) {
          readState();
        }
      });
    } catch (error) {
      // Ignore missing extension APIs in non-extension test contexts.
    }
  }

  rootObserver.observe(document, { childList: true });
  readState();
  subscribe();
})();
