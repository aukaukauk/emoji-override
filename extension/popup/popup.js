(() => {
  // Published by scripts/settings.js, which popup.html loads first.
  const { settings } = globalThis.__notoEmojiOverride;

  function msg(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  // Languages that are written from right to left, among those the popup is translated into.
  const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

  // Marks the document with the language its texts are in. That is not always the language of
  // the browser: where there is no translation for it, Chrome shows the English texts. Each
  // messages.json therefore names its own language.
  function applyLanguage() {
    const language = chrome.i18n.getMessage('uiLanguage');
    if (!language) return;

    document.documentElement.lang = language;
    document.documentElement.dir = RTL_LANGUAGES.has(language.split('-')[0]) ? 'rtl' : 'ltr';
  }

  async function queryActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return Array.isArray(tabs) && tabs.length ? tabs[0] : null;
    } catch {
      return null;
    }
  }

  function extractHost(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.hostname.toLowerCase();
      }
    } catch {
      // Ignore invalid or privileged browser URLs.
    }
    return null;
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

    applyLanguage();
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

    async function refreshState({ moveLegacyList = false } = {}) {
      try {
        const state = await settings.read();
        enabled = state.enabled;
        blockedHosts = state.blockedHosts;
        updateDerivedState();
        setError('');

        if (moveLegacyList && state.legacyBlockedHosts.length) {
          // If the move fails, the list simply keeps being read from sync storage.
          await settings.moveLegacyBlockedHosts(state.legacyBlockedHosts).catch(() => {});
        }
      } catch {
        setError(msg('errorLoad'));
      }
      render();
    }

    await refreshState({ moveLegacyList: true });

    toggleBtn.addEventListener('click', async () => {
      const previous = enabled;
      enabled = !enabled;
      saving = true;
      setError('');
      render();

      try {
        await settings.setEnabled(enabled);
      } catch {
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

      blockedHosts = settings.normalizeHosts([...nextBlockedHosts]);
      updateDerivedState();
      saving = true;
      setError('');
      render();

      try {
        await settings.setBlockedHosts(blockedHosts);
      } catch {
        blockedHosts = previousBlockedHosts;
        updateDerivedState();
        setError(msg('errorSave'));
      } finally {
        saving = false;
        render();
      }
    });

    settings.onChange(() => {
      refreshState();
    });
  });
})();
