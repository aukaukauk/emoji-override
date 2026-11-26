(() => {
  const ENABLED_ATTRIBUTE = 'data-noto-emoji-enabled';

  // The marker is restored from a MutationObserver callback. A page that removes it every time
  // would turn that into an endless loop, so past this rate the page is left alone.
  const RESTORE_LIMIT = 20;
  const RESTORE_WINDOW_MS = 1000;

  // Published by settings.js, which runs first in the same isolated world.
  const shared = globalThis.__notoEmojiOverride;
  if (!shared || !shared.settings) return;

  const { settings } = shared;
  const host = (location.hostname || '').toLowerCase();
  const listeners = new Set();

  // Whether emoji replacement is on for this document. emoji_replacer.js runs after this file in
  // the same isolated world and takes the state from here, where page scripts cannot reach it.
  // The attribute on <html> is only an output: it switches the stylesheet on.
  const state = {
    active: false,
    subscribe(listener) {
      listeners.add(listener);
    }
  };
  shared.state = state;

  // Whose emoji the page would show without this extension: 'mac', 'windows' for Windows 11 and
  // later, or '' for every other system. The stylesheet draws Noto at the size of those emoji
  // (see emoji.css); with '' it keeps its own size. Windows 10 is among the others on purpose:
  // its emoji are larger than those of Windows 11, about as large as Noto's.
  const WINDOWS_11 = 13; // the first platform version that is Windows 11

  async function systemEmoji() {
    const data = navigator.userAgentData;
    const platform = (data && data.platform) || navigator.platform || '';
    if (/mac/i.test(platform)) return 'mac';
    if (!/win/i.test(platform)) return '';

    try {
      const { platformVersion } = await data.getHighEntropyValues(['platformVersion']);
      return parseInt(platformVersion, 10) >= WINDOWS_11 ? 'windows' : '';
    } catch {
      // The version cannot be asked for. Windows 11 is the likely one by now.
      return 'windows';
    }
  }

  const emojiOfSystem = systemEmoji();
  // The value the marker attribute has while replacement is on.
  let markerValue = '';

  let markedRoot = null;
  let restoreTimes = [];
  let abandoned = false;

  const wantedMarker = () => (state.active ? markerValue : null);

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

    const wanted = wantedMarker();
    if (!abandoned && root.getAttribute(ENABLED_ATTRIBUTE) !== wanted) {
      if (wanted === null) root.removeAttribute(ENABLED_ATTRIBUTE);
      else root.setAttribute(ENABLED_ATTRIBUTE, wanted);
    }
  }

  function setActive(shouldEnable) {
    const changed = shouldEnable !== state.active;
    state.active = shouldEnable;
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
    if (root === markedRoot && root.getAttribute(ENABLED_ATTRIBUTE) === wantedMarker()) return;

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

  async function readState() {
    // A storage area that cannot be read counts as empty, which leaves replacement on.
    const [current, system] = await Promise.all([settings.read({ tolerant: true }), emojiOfSystem]);
    markerValue = system;

    // A settings change is a fresh start for a page that had been left alone.
    abandoned = false;
    restoreTimes = [];
    setActive(settings.isActiveFor(current, host));
  }

  rootObserver.observe(document, { childList: true });
  readState();

  try {
    settings.onChange(readState);
  } catch {
    // No extension APIs: the scripts are running as plain page scripts in a test document.
  }
})();
