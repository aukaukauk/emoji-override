(() => {
  const KEY_ENABLED = 'enabled';
  const KEY_BLOCKED = 'blockedHosts';
  const ENABLED_CLASS = 'noto-emoji-enabled';

  const root = document.documentElement;
  const host = (location.hostname || '').toLowerCase();

  let lastActive = null;

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list
      .map((item) => (typeof item === 'string' ? item.toLowerCase().trim() : ''))
      .filter(Boolean))];
  }

  function setActive(shouldEnable) {
    if (shouldEnable === lastActive) return;
    lastActive = shouldEnable;

    if (shouldEnable) {
      root.classList.add(ENABLED_CLASS);
    } else {
      root.classList.remove(ENABLED_CLASS);
    }
  }

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

  readState();
  subscribe();
})();
