(() => {
  // Published by toggle.js, which runs first in the same isolated world.
  const shared = globalThis.__notoEmojiOverride;
  if (!shared || typeof shared.subscribe !== 'function') return;

  const CLASS_NAME = 'noto-emoji-wrapped';
  const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

  // Text directly inside these elements is left alone. This is tested against the parent of
  // every text node in a walk, so it stays a plain lookup. SVG and MathML need no entry: text in
  // any non-HTML element is skipped by namespace, and HTML inside <foreignObject> is ordinary
  // HTML that can be wrapped.
  const SKIP_TAGS = new Set([
    'input',
    'textarea',
    'select',
    'option',
    'script',
    'style',
    'noscript',
    'title',
    'iframe',
    'canvas',
    'pre',
    'code',
    'kbd',
    'samp'
  ]);

  // The same elements as ancestors at any depth, plus regions that are off limits as a whole:
  // <head>, editing hosts (including read-only islands inside them), spans created here, and
  // the Monaco and Ace code editors. Those two draw their lines with ordinary elements rather
  // than <pre> or contenteditable, and measure that DOM to place the cursor.
  const SKIP_SELECTOR = [
    ...SKIP_TAGS,
    'head',
    '[contenteditable=""]',
    '[contenteditable="true" i]',
    '[contenteditable="plaintext-only" i]',
    '.monaco-editor',
    '.ace_editor',
    `.${CLASS_NAME}`
  ].join(',');

  // A <form> exposes its controls as properties and a document exposes named forms and images,
  // so `form.parentNode`, `form.classList` or `document.body` may be an element the page gave
  // that name. Where a wrong answer would throw or send the ancestor walk in circles, the lookup
  // goes through the prototype instead.
  const prototypeGetter = (prototype, name) => Object.getOwnPropertyDescriptor(prototype, name).get;
  const bodyOf = prototypeGetter(Document.prototype, 'body');
  const classListOf = prototypeGetter(Element.prototype, 'classList');
  const parentNodeOf = prototypeGetter(Node.prototype, 'parentNode');
  const matchesSelector = Element.prototype.matches;
  const replaceChild = Node.prototype.replaceChild;

  // start() needs a <body>. If there is none yet it looks again at this interval, for a while.
  const START_RETRY_MS = 1000;
  const START_RETRY_LIMIT = 60;

  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  const RECENT_EMOJI_REGEX = /[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const BROAD_EMOJI_REGEX = /[‍️⃣]|\p{Emoji_Presentation}|\p{Regional_Indicator}|[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const EMOJI_PRESENTATION_REGEX = /\p{Emoji_Presentation}/u;
  const EMOJI_VARIATION_REGEX = /\p{Emoji}️/u;
  const KEYCAP_REGEX = /^[#*0-9]️?⃣$/u;
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
  let startRetryTimer = null;
  let startRetries = 0;
  let contextCache = new Map();

  function isActive() {
    return shared.active;
  }

  function isElement(node) {
    return Boolean(node && node.nodeType === Node.ELEMENT_NODE);
  }

  // Cheap test on the direct parent of a text node. Wrapping inserts an HTML <span>, which only
  // renders inside HTML elements: in SVG <text> or MathML it would make the emoji disappear.
  function isSkippedParent(parent) {
    return isElement(parent)
      && (parent.namespaceURI !== HTML_NAMESPACE
        || SKIP_TAGS.has(parent.localName)
        || classListOf.call(parent).contains(CLASS_NAME));
  }

  // Cheap test for the root of a subtree about to be scanned. It runs for every node the page
  // adds, so it looks at the element alone; text that contains emoji gets the full test below.
  function isSkippedRoot(root) {
    return isElement(root)
      && (SKIP_TAGS.has(root.localName)
        || classListOf.call(root).contains(CLASS_NAME)
        || root.isContentEditable);
  }

  // Only a shadow root has a host. `.host` is never read off anything else: on a document or a
  // form it can be an element the page named "host".
  function hostOf(node) {
    return node && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && isElement(node.host)
      ? node.host
      : null;
  }

  // Full test for the element (or shadow root) holding the text: is it, or anything above it
  // across shadow boundaries, off limits? Verdicts are kept for the length of one flush, so text
  // nodes deep inside the same subtree share a single walk up the tree.
  function isSkippedContext(container) {
    let element = isElement(container) ? container : hostOf(container);
    if (!element) return false;

    // Covers designMode and CSS user-modify. Editing hosts declared by attribute are in the
    // selector, which also catches read-only islands inside them.
    if (element.isContentEditable) return true;

    const visited = [];
    let skipped = false;

    while (element) {
      const known = contextCache.get(element);
      if (known !== undefined) {
        skipped = known;
        break;
      }

      visited.push(element);
      if (matchesSelector.call(element, SKIP_SELECTOR)) {
        skipped = true;
        break;
      }

      const parent = parentNodeOf.call(element);
      element = isElement(parent) ? parent : hostOf(parent);
    }

    for (const seen of visited) {
      contextCache.set(seen, skipped);
    }

    return skipped;
  }

  function splitGraphemes(text) {
    if (!segmenter) return Array.from(text);
    return Array.from(segmenter.segment(text), (item) => item.segment);
  }

  function hasEmojiCandidate(text) {
    return BROAD_EMOJI_REGEX.test(text);
  }

  function isEmojiCluster(text) {
    if (!text || text.includes('︎')) return false;
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
    // The namespace is spelled out because createElement() makes a plain XML element, without
    // `style`, in XML documents such as a feed shown by the browser's XML viewer.
    const span = document.createElementNS(HTML_NAMESPACE, 'span');
    span.classList.add(CLASS_NAME);
    // Repeated inline because the stylesheet does not reach into shadow trees, while the
    // inherited custom property does.
    span.style.display = 'contents';
    span.style.fontFamily = 'var(--emoji-override-font-family, inherit)';
    span.style.lineHeight = 'var(--emoji-override-line-height, inherit)';
    span.textContent = text;
    return span;
  }

  function processTextNode(node) {
    if (!isActive()) return;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    const parent = node.parentNode;
    if (!parent || isSkippedParent(parent)) return;

    const text = node.data;
    if (!text || !hasEmojiCandidate(text)) return;
    if (isSkippedContext(parent)) return;

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
    replaceChild.call(parent, fragment, node);
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
    // Nodes that left the document before this pass are skipped. If they come back they are
    // queued again.
    if (!isActive() || !root || !root.isConnected) return;

    if (root.nodeType === Node.TEXT_NODE) {
      processTextNode(root);
      return;
    }

    if (isSkippedRoot(root)) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return isSkippedParent(node.parentNode) || !hasEmojiCandidate(node.data)
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

    try {
      for (const root of roots) {
        walk(root);
      }
    } finally {
      // The page may change the tree before the next flush, so the verdicts end here.
      contextCache.clear();
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

    const body = bodyOf.call(document);
    if (!isActive() || !body) return;

    discoverShadowRoots(body);
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

  function cancelStartRetry() {
    if (startRetryTimer) {
      window.clearInterval(startRetryTimer);
      startRetryTimer = null;
    }
  }

  // DOMContentLoaded normally brings start() back once there is a <body>. That event never fires
  // after window.stop(), and document.open() drops its listener, so without this a body that
  // shows up later would go unnoticed.
  function retryStartLater() {
    if (startRetryTimer || startRetries >= START_RETRY_LIMIT) return;

    startRetryTimer = window.setInterval(() => {
      startRetries += 1;
      if (startRetries >= START_RETRY_LIMIT) cancelStartRetry();
      if (document.readyState !== 'loading') syncState();
    }, START_RETRY_MS);
  }

  function start() {
    if (observerActive) return;

    const body = bodyOf.call(document);
    if (!body) {
      retryStartLater();
      return;
    }

    cancelStartRetry();
    startRetries = 0;
    observerActive = true;
    // Observe the document rather than the current <body>: pages swap the body element
    // (Turbo-style navigation) or even the root element (document.open), and the replacement
    // then simply arrives as an added node.
    observeRoot(document);
    scheduleWalk(body);
    startShadowDiscovery();
  }

  function stop() {
    observer.disconnect();
    cancelStartRetry();
    startRetries = 0;
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

  shared.subscribe(syncState);
  document.addEventListener('DOMContentLoaded', syncState, { once: true });
  syncState();
})();
