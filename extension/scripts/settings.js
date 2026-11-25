// The extension's two settings and where they are stored. Loaded by the content script and by
// the popup, before their own code.
(() => {
  const KEY_ENABLED = 'enabled';
  const KEY_BLOCKED = 'blockedHosts';

  function normalizeHosts(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list
      .map((item) => (typeof item === 'string' ? item.toLowerCase().trim() : ''))
      .filter(Boolean))]
      .sort();
  }

  function getArea(area, keys, tolerant) {
    let request;
    try {
      request = chrome.storage[area].get(keys);
    } catch (error) {
      request = Promise.reject(error);
    }
    return tolerant ? request.catch(() => ({})) : request;
  }

  // `enabled` syncs across the user's browsers, `blockedHosts` stays in this profile. Early
  // versions kept the block list in sync storage as well; that copy is used until the popup
  // moves it (moveLegacyBlockedHosts), and is reported as `legacyBlockedHosts` until then.
  //
  // With `tolerant`, a storage area that cannot be read counts as empty instead of rejecting.
  async function read({ tolerant = false } = {}) {
    const [syncData, localData] = await Promise.all([
      getArea('sync', [KEY_ENABLED, KEY_BLOCKED], tolerant),
      getArea('local', [KEY_BLOCKED], tolerant)
    ]);

    const hasLocalList = Object.hasOwn(localData, KEY_BLOCKED);
    const legacyBlockedHosts = hasLocalList ? [] : normalizeHosts(syncData[KEY_BLOCKED]);

    return {
      enabled: Object.hasOwn(syncData, KEY_ENABLED) ? Boolean(syncData[KEY_ENABLED]) : true,
      blockedHosts: hasLocalList ? normalizeHosts(localData[KEY_BLOCKED]) : legacyBlockedHosts,
      legacyBlockedHosts
    };
  }

  // Hosts are matched exactly: blocking example.com leaves sub.example.com alone.
  function isActiveFor(settings, host) {
    return settings.enabled && !(host && settings.blockedHosts.includes(host));
  }

  function setEnabled(enabled) {
    return chrome.storage.sync.set({ [KEY_ENABLED]: enabled });
  }

  function setBlockedHosts(hosts) {
    return chrome.storage.local.set({ [KEY_BLOCKED]: normalizeHosts(hosts) });
  }

  async function moveLegacyBlockedHosts(hosts) {
    await chrome.storage.local.set({ [KEY_BLOCKED]: normalizeHosts(hosts) });
    await chrome.storage.sync.remove(KEY_BLOCKED);
  }

  // Calls `listener` whenever one of the two settings changes, in any tab or window.
  function onChange(listener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      const enabledChanged = areaName === 'sync' && KEY_ENABLED in changes;
      const blockedChanged = (areaName === 'local' || areaName === 'sync') && KEY_BLOCKED in changes;

      if (enabledChanged || blockedChanged) {
        listener();
      }
    });
  }

  globalThis.__notoEmojiOverride ||= {};
  globalThis.__notoEmojiOverride.settings = {
    read,
    isActiveFor,
    setEnabled,
    setBlockedHosts,
    moveLegacyBlockedHosts,
    onChange,
    normalizeHosts
  };
})();
