(() => {
  const CLASS_NAME = 'noto-emoji-wrapped';
  const ENABLED_CLASS = 'noto-emoji-enabled';

  const SKIP_TAGS = new Set([
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'OPTION',
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'IFRAME',
    'CANVAS',
    'SVG',
    'MATH',
    'PRE',
    'CODE',
    'KBD',
    'SAMP'
  ]);

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  const RECENT_EMOJI_REGEX = /[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const BROAD_EMOJI_REGEX = /[\u200D\uFE0F\u20E3]|\p{Emoji_Presentation}|\p{Regional_Indicator}|[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const EMOJI_PRESENTATION_REGEX = /\p{Emoji_Presentation}/u;
  const EMOJI_VARIATION_REGEX = /\p{Emoji}\uFE0F/u;
  const KEYCAP_REGEX = /^[#*0-9]\uFE0F?\u20E3$/u;
  const REGIONAL_PAIR_REGEX = /^\p{Regional_Indicator}{2}$/u;

  const requestIdle = window.requestIdleCallback || ((callback) => {
    return window.setTimeout(() => callback(), 50);
  });

  let observedRoots = new WeakSet();
  let observerActive = false;
  let pendingRoots = new Set();
  let scheduled = false;
  let shadowDiscoveryTimer = null;
  let shadowDiscoveryPasses = 0;

  function isActive() {
    return document.documentElement.classList.contains(ENABLED_CLASS);
  }

  function isElement(node) {
    return Boolean(node && node.nodeType === Node.ELEMENT_NODE);
  }

  function shouldSkip(node) {
    if (!isElement(node)) return false;

    const tagName = node.tagName.toUpperCase();
    if (SKIP_TAGS.has(tagName)) return true;
    if (node.classList.contains(CLASS_NAME)) return true;
    if (node.isContentEditable) return true;

    return false;
  }

  function splitGraphemes(text) {
    if (!segmenter) return Array.from(text);
    return Array.from(segmenter.segment(text), (item) => item.segment);
  }

  function hasEmojiCandidate(text) {
    return BROAD_EMOJI_REGEX.test(text);
  }

  function isEmojiCluster(text) {
    if (!text || text.includes('\uFE0E')) return false;
    return KEYCAP_REGEX.test(text)
      || REGIONAL_PAIR_REGEX.test(text)
      || EMOJI_VARIATION_REGEX.test(text)
      || RECENT_EMOJI_REGEX.test(text)
      || EMOJI_PRESENTATION_REGEX.test(text);
  }

  function appendText(fragment, text) {
    if (text) {
      fragment.appendChild(document.createTextNode(text));
    }
  }

  function createEmojiSpan(text) {
    const span = document.createElement('span');
    span.classList.add(CLASS_NAME);
    span.style.display = 'var(--emoji-override-display, inline)';
    span.style.fontFamily = 'var(--emoji-override-font-family, inherit)';
    span.style.fontSize = 'var(--emoji-override-font-size, inherit)';
    span.style.lineHeight = 'var(--emoji-override-line-height, inherit)';
    span.style.verticalAlign = 'var(--emoji-override-vertical-align, baseline)';
    span.textContent = text;
    return span;
  }

  function processTextNode(node) {
    if (!isActive()) return;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (!node.parentNode || shouldSkip(node.parentNode)) return;

    const text = node.textContent;
    if (!text || !hasEmojiCandidate(text)) return;

    const fragment = document.createDocumentFragment();
    let plainText = '';
    let changed = false;

    for (const cluster of splitGraphemes(text)) {
      if (isEmojiCluster(cluster)) {
        appendText(fragment, plainText);
        plainText = '';
        fragment.appendChild(createEmojiSpan(cluster));
        changed = true;
      } else {
        plainText += cluster;
      }
    }

    if (!changed) return;

    appendText(fragment, plainText);

    if (node.parentNode) {
      node.parentNode.replaceChild(fragment, node);
    }
  }

  function observeRoot(root) {
    if (!isActive() || !root || observedRoots.has(root)) return;

    observer.observe(root, {
      childList: true,
      subtree: true
    });

    observedRoots.add(root);
  }

  function discoverShadowRoots(root) {
    if (!root || !root.querySelectorAll) return;

    if (isElement(root) && root.shadowRoot) {
      observeRoot(root.shadowRoot);
      scheduleWalk(root.shadowRoot);
    }

    const elements = root.querySelectorAll('*');
    for (const element of elements) {
      if (element.shadowRoot) {
        observeRoot(element.shadowRoot);
        scheduleWalk(element.shadowRoot);
      }
    }
  }

  function walk(root) {
    if (!isActive() || !root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      processTextNode(root);
      return;
    }

    if (shouldSkip(root)) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return shouldSkip(node.parentNode)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const textNode of textNodes) {
      processTextNode(textNode);
    }

    discoverShadowRoots(root);
  }

  function flushQueue() {
    scheduled = false;

    if (!isActive()) {
      pendingRoots.clear();
      return;
    }

    const roots = Array.from(pendingRoots);
    pendingRoots.clear();

    for (const root of roots) {
      walk(root);
    }

    if (pendingRoots.size) {
      scheduleFlush();
    }
  }

  function scheduleFlush() {
    if (scheduled) return;
    scheduled = true;
    requestIdle(flushQueue, { timeout: 500 });
  }

  function scheduleWalk(root) {
    if (!isActive() || !root) return;

    pendingRoots.add(root);
    scheduleFlush();
  }

  function runShadowDiscoveryPass() {
    shadowDiscoveryTimer = null;

    if (!isActive() || !document.body) return;

    discoverShadowRoots(document.body);
    shadowDiscoveryPasses += 1;

    if (shadowDiscoveryPasses < 12) {
      shadowDiscoveryTimer = window.setTimeout(runShadowDiscoveryPass, 250);
    }
  }

  function startShadowDiscovery() {
    if (shadowDiscoveryTimer) return;

    shadowDiscoveryPasses = 0;
    shadowDiscoveryTimer = window.setTimeout(runShadowDiscoveryPass, 0);
  }

  const observer = new MutationObserver((mutations) => {
    if (!isActive()) return;

    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) {
          scheduleWalk(node);
        }
      }
    }
  });

  function start() {
    if (!document.body || observerActive) return;

    observerActive = true;
    observeRoot(document.body);
    scheduleWalk(document.body);
    startShadowDiscovery();
  }

  function stop() {
    observer.disconnect();
    if (shadowDiscoveryTimer) {
      window.clearTimeout(shadowDiscoveryTimer);
      shadowDiscoveryTimer = null;
    }
    observedRoots = new WeakSet();
    pendingRoots.clear();
    scheduled = false;
    observerActive = false;
  }

  function syncState() {
    if (isActive()) {
      start();
    } else {
      stop();
    }
  }

  if (document.body) {
    syncState();
  } else {
    document.addEventListener('DOMContentLoaded', syncState, { once: true });
  }

  const stateObserver = new MutationObserver(syncState);
  stateObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  });
})();
