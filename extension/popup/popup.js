(() => {
  const KEY_ENABLED = 'enabled';
  const KEY_BLOCKED = 'blockedHosts';

  function msg(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function getStorage(area, keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage[area].get(keys, (data) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(data || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function setStorage(area, payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage[area].set(payload, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function removeStorage(area, keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage[area].remove(keys, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(Array.isArray(tabs) && tabs.length ? tabs[0] : null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function extractHost(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.hostname.toLowerCase();
      }
    } catch (error) {
      // Ignore invalid or privileged browser URLs.
    }
    return null;
  }

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list
      .map((item) => (typeof item === 'string' ? item.toLowerCase().trim() : ''))
      .filter(Boolean))]
      .sort();
  }

  async function readStateFromStorage({ migrateBlockedHosts = false } = {}) {
    const [syncData, localData] = await Promise.all([
      getStorage('sync', [KEY_ENABLED, KEY_BLOCKED]),
      getStorage('local', [KEY_BLOCKED])
    ]);

    const enabled = hasOwn(syncData, KEY_ENABLED)
      ? Boolean(syncData[KEY_ENABLED])
      : true;

    const syncBlockedHosts = normalizeList(syncData[KEY_BLOCKED]);
    const localHasBlockedHosts = hasOwn(localData, KEY_BLOCKED);
    const blockedHosts = normalizeList(
      localHasBlockedHosts ? localData[KEY_BLOCKED] : syncBlockedHosts
    );

    if (migrateBlockedHosts && !localHasBlockedHosts && syncBlockedHosts.length) {
      try {
        await setStorage('local', { [KEY_BLOCKED]: syncBlockedHosts });
        await removeStorage('sync', KEY_BLOCKED);
      } catch (error) {
        // Keep using the sync fallback if migration fails.
      }
    }

    return { enabled, blockedHosts };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const popupEyebrowEl = document.getElementById('popupEyebrow');
    const popupHeadingEl = document.getElementById('popupHeading');
    const popupSubtitleEl = document.getElementById('popupSubtitle');
    const globalTitleEl = document.getElementById('globalTitle');
    const globalDescriptionEl = document.getElementById('globalDescription');
    const siteTitleEl = document.getElementById('siteTitle');
    const siteDescriptionEl = document.getElementById('siteDescription');
    const toggleBtn = document.getElementById('toggleBtn');
    const statusEl = document.getElementById('status');
    const hostNameEl = document.getElementById('hostName');
    const siteStateEl = document.getElementById('siteState');
    const siteBtn = document.getElementById('siteBtn');
    const hintEl = document.getElementById('siteHint');
    const errorEl = document.getElementById('error');

    document.title = msg('popupTitle');
    popupEyebrowEl.textContent = msg('popupEyebrow');
    popupHeadingEl.textContent = msg('popupHeading');
    popupSubtitleEl.textContent = msg('popupSubtitle');
    globalTitleEl.textContent = msg('globalTitle');
    globalDescriptionEl.textContent = msg('globalDescription');
    siteTitleEl.textContent = msg('siteTitle');
    siteDescriptionEl.textContent = msg('siteDescription');
    hintEl.textContent = msg('siteHint');

    const activeTab = await queryActiveTab();
    const currentHost = extractHost(activeTab ? activeTab.url : null);

    let enabled = true;
    let blockedHosts = [];
    let isBlocked = false;
    let saving = false;

    function setError(message) {
      errorEl.textContent = message || '';
      errorEl.classList.toggle('visible', Boolean(message));
    }

    function updateDerivedState() {
      isBlocked = currentHost ? blockedHosts.includes(currentHost) : false;
    }

    function render() {
      hostNameEl.textContent = currentHost || msg('hostUnavailable');
      hintEl.classList.toggle('visible', !currentHost);

      toggleBtn.classList.toggle('enabled', enabled);
      toggleBtn.classList.toggle('disabled', !enabled);
      toggleBtn.textContent = enabled ? msg('disableButton') : msg('enableButton');
      toggleBtn.disabled = saving;
      toggleBtn.setAttribute('aria-pressed', String(enabled));

      statusEl.textContent = enabled ? msg('statusEnabled') : msg('statusDisabled');
      statusEl.classList.toggle('enabled', enabled);
      statusEl.classList.toggle('disabled', !enabled);

      siteBtn.disabled = saving || !currentHost;
      siteBtn.classList.toggle('blocked', isBlocked);
      siteBtn.textContent = !currentHost
        ? msg('siteButtonUnavailable')
        : isBlocked
          ? msg('unblockSiteButton')
          : msg('blockSiteButton');
      siteBtn.setAttribute('aria-pressed', String(isBlocked));

      if (!currentHost) {
        siteBtn.classList.remove('blocked');
        siteStateEl.textContent = msg('siteUnavailable');
      } else if (!enabled) {
        siteStateEl.textContent = isBlocked
          ? msg('siteGloballyDisabledAndBlocked')
          : msg('siteGloballyDisabled');
      } else {
        siteStateEl.textContent = isBlocked
          ? msg('siteBlocked')
          : msg('siteActive');
      }
    }

    async function refreshState(options) {
      try {
        const state = await readStateFromStorage(options);
        enabled = state.enabled;
        blockedHosts = state.blockedHosts;
        updateDerivedState();
        setError('');
      } catch (error) {
        setError(msg('errorLoad'));
      }
      render();
    }

    await refreshState({ migrateBlockedHosts: true });

    toggleBtn.addEventListener('click', async () => {
      const previous = enabled;
      enabled = !enabled;
      saving = true;
      setError('');
      render();

      try {
        await setStorage('sync', { [KEY_ENABLED]: enabled });
      } catch (error) {
        enabled = previous;
        setError(msg('errorSave'));
      } finally {
        saving = false;
        updateDerivedState();
        render();
      }
    });

    siteBtn.addEventListener('click', async () => {
      if (!currentHost) return;

      const previousBlockedHosts = blockedHosts;
      const nextBlockedHosts = new Set(blockedHosts);

      if (isBlocked) {
        nextBlockedHosts.delete(currentHost);
      } else {
        nextBlockedHosts.add(currentHost);
      }

      blockedHosts = normalizeList(Array.from(nextBlockedHosts));
      updateDerivedState();
      saving = true;
      setError('');
      render();

      try {
        await setStorage('local', { [KEY_BLOCKED]: blockedHosts });
      } catch (error) {
        blockedHosts = previousBlockedHosts;
        updateDerivedState();
        setError(msg('errorSave'));
      } finally {
        saving = false;
        render();
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      const enabledChanged = areaName === 'sync' && Boolean(changes[KEY_ENABLED]);
      const blockedChanged = (areaName === 'local' || areaName === 'sync') && Boolean(changes[KEY_BLOCKED]);

      if (enabledChanged || blockedChanged) {
        refreshState();
      }
    });
  });
})();
