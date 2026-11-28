(() => {
  // Published by the scripts that run before this one in the same isolated world.
  const { state, emoji, habits, hydration } = globalThis.__notoEmojiOverride || {};
  if (!state || !emoji || !habits || !hydration) return;

  const { hasEmojiCandidate, splitAtEmoji } = emoji;

  const CLASS_NAME = 'noto-emoji-wrapped';
  // Set on an element of the page that holds nothing but emoji: the stylesheet gives the font to
  // the element itself, and its text is left as it is (see mark() below).
  const HELD_ATTRIBUTE = 'data-noto-emoji-only';
  const HELD_SELECTOR = `[${HELD_ATTRIBUTE}]`;
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
  // the Monaco and Ace code editors and the xterm.js terminal. Those draw their lines with
  // ordinary elements rather than <pre> or contenteditable, and measure that DOM to place the
  // cursor or to keep their columns in line.
  const SKIP_SELECTOR = [
    ...SKIP_TAGS,
    'head',
    '[contenteditable=""]',
    '[contenteditable="true" i]',
    '[contenteditable="plaintext-only" i]',
    '.monaco-editor',
    '.ace_editor',
    '.xterm',
    `.${CLASS_NAME}`
  ].join(',');

  // A <form> exposes its controls as properties and a document exposes named forms and images,
  // so `form.parentNode`, `form.classList` or `document.body` may be an element the page gave
  // that name. Where a wrong answer would throw, send a walk up the tree in circles, leave a
  // form out, or make a form that was removed look as if it were still in the document, the
  // lookup goes through the prototype instead. That holds for everything asked of the document.
  const prototypeGetter = (prototype, name) => Object.getOwnPropertyDescriptor(prototype, name).get;
  const bodyOf = prototypeGetter(Document.prototype, 'body');
  const classListOf = prototypeGetter(Element.prototype, 'classList');
  const parentNodeOf = prototypeGetter(Node.prototype, 'parentNode');
  const nodeTypeOf = prototypeGetter(Node.prototype, 'nodeType');
  const isConnectedOf = prototypeGetter(Node.prototype, 'isConnected');
  const localNameOf = prototypeGetter(Element.prototype, 'localName');
  const namespaceOf = prototypeGetter(Element.prototype, 'namespaceURI');
  const openShadowRootOf = prototypeGetter(Element.prototype, 'shadowRoot');
  const firstChildOf = prototypeGetter(Node.prototype, 'firstChild');
  const lastChildOf = prototypeGetter(Node.prototype, 'lastChild');
  const hasAttribute = Element.prototype.hasAttribute;
  const setAttribute = Element.prototype.setAttribute;
  const removeAttribute = Element.prototype.removeAttribute;
  const isContentEditableOf = prototypeGetter(HTMLElement.prototype, 'isContentEditable');
  const readyStateOf = prototypeGetter(Document.prototype, 'readyState');
  const createElementNS = Document.prototype.createElementNS;
  const createTextNode = Document.prototype.createTextNode;
  const createDocumentFragment = Document.prototype.createDocumentFragment;
  const createTreeWalker = Document.prototype.createTreeWalker;
  const listen = EventTarget.prototype.addEventListener;
  const selectionOf = Document.prototype.getSelection;
  const matchesSelector = Element.prototype.matches;
  const querySelector = Element.prototype.querySelector;
  const rootNodeOf = Node.prototype.getRootNode;
  const containsNode = Node.prototype.contains;
  const insertBefore = Node.prototype.insertBefore;
  const removeChild = Node.prototype.removeChild;
  const cloneNode = Node.prototype.cloneNode;

  // start() needs a <body>. If there is none yet it looks again at this interval, for a while.
  const START_RETRY_MS = 1000;
  const START_RETRY_LIMIT = 60;

  // Work on the queue is done in slices, so that a large page does not freeze. A slice ends
  // when the browser's idle time is used up, or after SLICE_MS when it gives none. The clock is
  // read once per NODES_PER_CHECK steps. If the page keeps pulling the ground from under a walk,
  // the walk is finished in one go after WALK_RESTART_LIMIT new starts.
  const SLICE_MS = 8;
  const NODES_PER_CHECK = 64;
  const WALK_RESTART_LIMIT = 3;

  // A custom element may get its shadow root long after it entered the page, and nothing
  // announces that. Elements without one are looked at again 1, 2, 4, ... ticks after they were
  // first seen, for the last time after HOST_CHECK_TICKS.
  const HOST_CHECK_MS = 250;
  const HOST_CHECK_TICKS = 128;

  // Elements other than custom elements that can have a shadow root. A closed one is asked for
  // each time a walk comes by, and not again later.
  const SHADOW_TAGS = new Set([
    'article', 'aside', 'blockquote', 'body', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'main', 'nav', 'p', 'section', 'span'
  ]);

  // The only attributes whose changes are followed. An element that becomes editable is to be
  // left alone from then on, and one that stops being editable can be worked on. The other is
  // our own mark, which some pages take off the elements they update.
  const WATCHED_ATTRIBUTES = ['contenteditable', HELD_ATTRIBUTE];

  // A page that takes the mark off an element this many times keeps it off.
  const MARK_LIMIT = 3;

  const requestIdle = window.requestIdleCallback || ((callback) => {
    return window.setTimeout(() => callback(), 50);
  });

  // A wrapped text. The text node of the page stays where the page put it, but empty: the
  // anchor. Scripts keep hold of their text nodes and later set a new value, take the node out,
  // or insert next to it, and all of that only works on a node that is still in its place. The
  // text itself is shown by nodes made here and placed right behind the anchor: plain text, and
  // one span for each emoji.
  //
  // The anchor is empty rather than left with the text before the first emoji, so that anything
  // that edits text in the page, such as a translator or a search highlighter, only ever meets
  // nodes of ours, which are ordinary nodes to it. What the page writes to the anchor can then
  // only be a new text as a whole.
  //
  // The first of our nodes is an empty text node as well, the canary. A script that knows the
  // anchor does not know the canary. One that goes through the document and removes or rewrites
  // every text node it finds deals with both, and that is how the two are told apart.
  const wrappedTexts = new WeakMap(); // anchor -> { pieces, text }; pieces[0] is the canary
  const anchorOf = new WeakMap(); // each piece -> its anchor

  // What the page's writes to a text node have shown so far (see write_habits.js), and the
  // nodes that wait for their text to settle before they are wrapped.
  const habitOf = new WeakMap();
  const pendingWraps = new Map();

  // Elements that hold nothing but emoji and carry the mark: element -> the text it held when it
  // was last looked at. And how often the page has taken the mark off an element.
  let held = new WeakMap();
  let unmarked = new WeakMap();
  // Elements that are about to be marked: [element, its text node, the text, ...]. They are
  // looked at together at the end of a stretch of work, because that takes their computed
  // styles, and asking for those between changes to the document makes the browser work them
  // out again each time.
  let toHold = [];

  const pendingRoots = new Set();
  // Nodes that the page put into a node whose walk is still to come: that walk meets them, so
  // they get none of their own. A page that builds its content node by node, and the parser,
  // would otherwise have every node walked once for each of the nodes above it.
  const covered = new Set();
  const contextCache = new Map();
  // Custom elements without a shadow root that are looked at again later: the tick at which that
  // is due -> [element, ticks since it was first seen, element, ticks, ...]
  const hostChecks = new Map();
  let waitingHosts = new WeakSet();
  let hostTick = 0;
  // Weak references to the shadow roots that have been taken on, and to the elements that left
  // the document with wrapped text in them (see watchDetached).
  const shadowRoots = new Set();
  const detachedRoots = new Set();

  let observedRoots = new WeakSet();
  // Shadow trees in which something was left undone because their host was out of the document.
  let missedRoots = new WeakSet();
  // Markup that the server rendered is left alone until its framework has taken it over (see
  // hydration.js). That is waited for once per document.
  let holding = false;
  let heldBefore = false;
  let endHold = null;
  // Whether anything has been wrapped in this document so far. Until then no node in it is one
  // of ours, and what the page removes or moves needs no looking at.
  let wrappedBefore = false;
  let spanTemplate = null;
  let observerActive = false;
  let scheduled = false;
  let walkQueue = [];
  let walkIndex = 0;
  let currentWalk = null;
  let hostCheckTimer = null;
  let rescanTimer = null;
  let startRetryTimer = null;
  let startRetries = 0;

  function isActive() {
    return state.active;
  }

  function isElement(node) {
    return Boolean(node && nodeTypeOf.call(node) === Node.ELEMENT_NODE);
  }

  // Covers designMode and CSS user-modify as well as the attribute.
  function isEditable(node) {
    return isElement(node) && namespaceOf.call(node) === HTML_NAMESPACE && isContentEditableOf.call(node);
  }

  // Cheap test on the direct parent of a text node. Wrapping inserts an HTML <span>, which only
  // renders inside HTML elements: in SVG <text> or MathML it would make the emoji disappear.
  function isSkippedParent(parent) {
    return isElement(parent)
      && (namespaceOf.call(parent) !== HTML_NAMESPACE
        || SKIP_TAGS.has(localNameOf.call(parent))
        || classListOf.call(parent).contains(CLASS_NAME));
  }

  // Cheap test for the root of a subtree about to be scanned. It runs for every node the page
  // adds, so it looks at the element alone; text that contains emoji gets the full test below.
  function isSkippedRoot(root) {
    return isElement(root)
      && (SKIP_TAGS.has(localNameOf.call(root))
        || classListOf.call(root).contains(CLASS_NAME)
        || isEditable(root));
  }

  // Only a shadow root has a host. `.host` is never read off anything else: on a document or a
  // form it can be an element the page named "host".
  function hostOf(node) {
    return node && nodeTypeOf.call(node) === Node.DOCUMENT_FRAGMENT_NODE && isElement(node.host)
      ? node.host
      : null;
  }

  // Full test for the element (or shadow root) holding the text: is it, or anything above it
  // across shadow boundaries, off limits? Verdicts are kept for the length of one flush, so text
  // nodes deep inside the same subtree share a single walk up the tree.
  function isSkippedContext(container) {
    let element = isElement(container) ? container : hostOf(container);
    if (!element) return false;

    // Editing hosts declared by attribute are in the selector as well, which also catches
    // read-only islands inside them.
    if (isEditable(element)) return true;

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

  function createEmojiSpan(text) {
    if (!spanTemplate) {
      // The namespace is spelled out because createElement() makes a plain XML element, without
      // `style`, in XML documents such as a feed shown by the browser's XML viewer.
      spanTemplate = createElementNS.call(document, HTML_NAMESPACE, 'span');
      spanTemplate.classList.add(CLASS_NAME);
      // Repeated inline because the stylesheet does not reach into shadow trees, while the
      // inherited custom property does.
      // Marked important, like the font in the stylesheet: a rule of the page for every <span>
      // would otherwise give the wrapper a box, or its own font.
      spanTemplate.style.setProperty('display', 'contents', 'important');
      spanTemplate.style.setProperty('font-family', 'var(--emoji-override-font-family, inherit)', 'important');
      spanTemplate.style.lineHeight = 'var(--emoji-override-line-height, inherit)';
    }

    // A copy is several times cheaper than setting the class and the styles on a new element.
    const span = cloneNode.call(spanTemplate, false);
    span.textContent = text;
    return span;
  }

  // Where the user's selection begins and ends, if either is in this text node of the page.
  // Emptying the node would leave that end at its start, and the user with a selection that is
  // not the one they made.
  function selectionEndsIn(node) {
    const selection = selectionOf.call(document);
    if (!selection || !selection.rangeCount) return null;

    const { anchorNode, focusNode } = selection;
    if (anchorNode !== node && focusNode !== node) return null;
    return { selection, anchorNode, anchorOffset: selection.anchorOffset, focusNode, focusOffset: selection.focusOffset };
  }

  // The place in the pieces that shows what was at `offset` in the text they were made from.
  function placeInPieces(pieces, offset) {
    let rest = offset;
    let text = null;
    // The first piece is the canary, which is empty.
    for (let index = 1; index < pieces.length; index += 1) {
      text = pieces[index].nodeType === Node.TEXT_NODE ? pieces[index] : pieces[index].firstChild;
      if (rest <= text.length) return [text, rest];
      rest -= text.length;
    }
    return [text, text.length];
  }

  function keepSelection(ends, node, pieces) {
    const anchor = ends.anchorNode === node ? placeInPieces(pieces, ends.anchorOffset) : [ends.anchorNode, ends.anchorOffset];
    const focus = ends.focusNode === node ? placeInPieces(pieces, ends.focusOffset) : [ends.focusNode, ends.focusOffset];
    try {
      ends.selection.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
    } catch {
      // The other end is no longer where it was. The selection stays as the browser left it.
    }
  }

  // Wraps the emoji of one text node of the page. Returns the last text node it made, which is
  // where a walk through the document carries on, or null if there was nothing to wrap.
  function wrap(node) {
    if (!isActive() || holding || !node || node.nodeType !== Node.TEXT_NODE) return null;
    if (anchorOf.has(node) || pendingWraps.has(node) || habitOf.get(node) === 'held') return null;

    const parent = node.parentNode;
    if (!parent || isSkippedParent(parent)) return null;

    const text = node.data;
    if (!text || !hasEmojiCandidate(text)) return null;

    // Text in an element that is out of the document waits until the element is back: only then
    // is it known where the text ends up.
    if (!node.isConnected) {
      noteMissed(node);
      return null;
    }

    if (isSkippedContext(parent)) return null;

    // Still wrapped although it holds text again: the page wrote to it where that could not be
    // seen, and the pieces show the old text.
    if (wrappedTexts.has(node)) discard(node);

    // Text and emoji in turn, starting and ending with text that may be empty.
    const parts = splitAtEmoji(text);
    if (!parts) {
      if (held.has(parent)) letGoOf(parent);
      return null;
    }

    if (isOnlyEmoji(parts) && mayHold(parent, node)) {
      if (held.has(parent)) held.set(parent, text);
      else toHold.push(parent, node, text);
      return null;
    }

    if (held.has(parent)) letGoOf(parent);
    return wrapInPieces(node, parent, text, parts);
  }

  function wrapInPieces(node, parent, text, parts) {
    const pieces = [createTextNode.call(document, '')];
    for (let index = 0; index < parts.length; index += 1) {
      if (index % 2) {
        pieces.push(createEmojiSpan(parts[index]));
      } else if (parts[index]) {
        pieces.push(createTextNode.call(document, parts[index]));
      }
    }

    const fragment = createDocumentFragment.call(document);
    for (const piece of pieces) {
      fragment.appendChild(piece);
      anchorOf.set(piece, node);
    }

    const selected = selectionEndsIn(node);
    insertBefore.call(parent, fragment, node.nextSibling);
    node.data = '';
    wrappedTexts.set(node, { pieces, text });
    wrappedBefore = true;
    if (selected) keepSelection(selected, node, pieces);

    const last = pieces[pieces.length - 1];
    return last.firstChild || last;
  }

  // An element that holds nothing but emoji needs no wrappers: the font can be given to the
  // element as a whole, with a mark that the stylesheet goes by. Its text node is not touched,
  // which is the least a page can be asked to put up with, and the only way that costs next to
  // nothing where a page shows thousands of emoji, each in an element of its own. (Taking a
  // text apart and putting it together again tells every program that follows the page through
  // the accessibility interface about each node, and on Windows that alone can take seconds.)
  //
  // The stylesheet's font for such elements has no space character, so the browser takes the
  // measures of the line from the font that follows it, the system's, and draws only the emoji
  // with it.

  const BLANKS = /^[ \t\n\r\f]*$/;

  // Emoji with at most blanks around and between them?
  function isOnlyEmoji(parts) {
    for (let index = 0; index < parts.length; index += 2) {
      if (parts[index] && !BLANKS.test(parts[index])) return false;
    }
    return true;
  }

  // The cheap part of the question whether an element can be given the font as a whole: the
  // text is all there is in it, and the stylesheet reaches it.
  function mayHold(parent, node) {
    return firstChildOf.call(parent) === node
      && lastChildOf.call(parent) === node
      && localNameOf.call(parent) !== 'body'
      && rootNodeOf.call(parent) === document
      && (unmarked.get(parent) || 0) < MARK_LIMIT;
  }

  // The dear part: nothing else in the element is drawn with its font. A list item draws its
  // number with it, and `::before` and `::after` draw their text with it.
  function drawsNothingElse(element) {
    return window.getComputedStyle(element).display !== 'list-item'
      && window.getComputedStyle(element, '::before').content === 'none'
      && window.getComputedStyle(element, '::after').content === 'none';
  }

  function mark(element, text) {
    setAttribute.call(element, HELD_ATTRIBUTE, '');
    held.set(element, text);
    // From here on something in the document is ours.
    wrappedBefore = true;
  }

  // Takes the mark off. What becomes of the element's text is the caller's business.
  function letGoOf(element) {
    held.delete(element);
    removeAttribute.call(element, HELD_ATTRIBUTE);
  }

  // The text of an element if that text is all there is in it, or null.
  function onlyTextOf(element) {
    const node = firstChildOf.call(element);
    return node && node === lastChildOf.call(element) && nodeTypeOf.call(node) === Node.TEXT_NODE ? node.data : null;
  }

  // Marks the elements that were found to hold only emoji, or wraps their text after all.
  function holdWaiting() {
    if (!toHold.length) return;

    const waiting = toHold;
    toHold = [];

    // First everything that only reads, then everything that writes.
    const verdicts = [];
    for (let index = 0; index < waiting.length; index += 3) {
      const element = waiting[index];
      const node = waiting[index + 1];
      const unchanged = isActive() && !holding && isConnectedOf.call(element) && !held.has(element)
        && mayHold(element, node) && node.data === waiting[index + 2];
      verdicts.push(unchanged ? drawsNothingElse(element) : null);
    }

    for (let index = 0; index < waiting.length; index += 3) {
      const verdict = verdicts[index / 3];
      if (verdict) {
        mark(waiting[index], waiting[index + 2]);
      } else if (verdict === false) {
        const parts = splitAtEmoji(waiting[index + 2]);
        if (parts) wrapInPieces(waiting[index + 1], waiting[index], waiting[index + 2], parts);
      }
      // null: something has changed since. Whatever changed it has queued the node again.
    }
  }

  // Looks at a marked element again after the page has done something to it. Returns whether
  // it still holds nothing but emoji; if not, the mark is taken off.
  function stillHolds(element) {
    const text = onlyTextOf(element);
    if (text !== null && text === held.get(element) && !isEditable(element)) return true;

    const parts = text === null || isSkippedContext(element) ? null : splitAtEmoji(text);
    if (parts && isOnlyEmoji(parts)) {
      held.set(element, text);
      return true;
    }

    letGoOf(element);
    return false;
  }

  // The marked elements in a subtree that has just been walked: ones that were out of the
  // document for a while and may have been changed there, and copies that the page has made of
  // a marked element, mark included.
  function lookAtMarked(root) {
    const marked = Array.from(queryAll(root, HELD_SELECTOR));
    if (isElement(root) && hasAttribute.call(root, HELD_ATTRIBUTE)) marked.push(root);

    for (const element of marked) {
      if (held.has(element)) {
        stillHolds(element);
        continue;
      }

      // A copy. It is taken on if it could have been marked here, and stripped otherwise.
      const text = onlyTextOf(element);
      const parts = text === null || isSkippedContext(element) || !mayHold(element, firstChildOf.call(element))
        ? null
        : splitAtEmoji(text);
      if (parts && isOnlyEmoji(parts)) held.set(element, text);
      else removeAttribute.call(element, HELD_ATTRIBUTE);
    }
  }

  // The page has changed the mark of an element.
  function pageChangedMark(element) {
    if (!isElement(element)) return;

    if (!held.has(element)) {
      // Not one of ours, or no longer. A mark on it is the page's doing, and comes off.
      if (hasAttribute.call(element, HELD_ATTRIBUTE)) removeAttribute.call(element, HELD_ATTRIBUTE);
      return;
    }
    if (hasAttribute.call(element, HELD_ATTRIBUTE)) return;

    // A page that brings its elements in line with what its server sent takes off what it does
    // not know. The mark goes back on, but not for ever: then the text is wrapped instead.
    const times = (unmarked.get(element) || 0) + 1;
    unmarked.set(element, times);
    if (times < MARK_LIMIT && stillHolds(element)) {
      setAttribute.call(element, HELD_ATTRIBUTE, '');
    } else {
      held.delete(element);
      scheduleWalk(element);
    }
  }

  // Takes the marks off everything in a subtree.
  function letGoIn(root) {
    for (const element of queryAll(root, HELD_SELECTOR)) {
      letGoOf(element);
    }
    if (isElement(root) && hasAttribute.call(root, HELD_ATTRIBUTE)) letGoOf(root);
  }

  // Takes the pieces of a wrapped text out of the document. The anchor is the caller's business.
  // Pieces in `taken` stay where they are, as ordinary nodes: the page has written to them, so
  // they are the page's now.
  function discard(anchor, taken) {
    const wrapped = wrappedTexts.get(anchor);
    if (!wrapped) return;

    wrappedTexts.delete(anchor);
    for (const piece of wrapped.pieces) {
      anchorOf.delete(piece);
      if (taken && taken.has(piece)) {
        scheduleWalk(piece);
        continue;
      }
      const parent = piece.parentNode;
      if (parent) removeChild.call(parent, piece);
    }
  }

  // Leaves the pieces in the document as ordinary nodes, and forgets that they were ours.
  function release(anchor) {
    const wrapped = wrappedTexts.get(anchor);
    if (!wrapped) return;

    wrappedTexts.delete(anchor);
    for (const piece of wrapped.pieces) {
      anchorOf.delete(piece);
    }
  }

  function isIntact(anchor, wrapped) {
    let node = anchor.nextSibling;
    for (const piece of wrapped.pieces) {
      if (node !== piece) return false;
      node = node.nextSibling;
    }
    return true;
  }

  // The text as the pieces show it now. Other scripts may have edited them since.
  function shownText(wrapped) {
    return wrapped.pieces.map((piece) => piece.textContent).join('');
  }

  // Are the pieces still one run of nodes, wherever that is?
  function isTogether(wrapped) {
    let node = wrapped.pieces[0];
    if (!node.parentNode) return false;
    for (const piece of wrapped.pieces) {
      if (node !== piece) return false;
      node = node.nextSibling;
    }
    return true;
  }

  // Puts the pieces back right behind their anchor, after the page moved the anchor or put
  // something in between.
  function follow(anchor) {
    const wrapped = wrappedTexts.get(anchor);
    const parent = anchor.parentNode;
    if (!wrapped || !parent || isIntact(anchor, wrapped)) return;

    // Another script has put nodes of its own in the place of some pieces, as a translator or a
    // search highlighter does. The pieces it took out are not to come back next to what it
    // made of them, so what is in the page stays where it is, as ordinary nodes.
    if (!isTogether(wrapped)) {
      release(anchor);
      return;
    }

    const fragment = createDocumentFragment.call(document);
    for (const piece of wrapped.pieces) {
      fragment.appendChild(piece);
    }
    insertBefore.call(parent, fragment, anchor.nextSibling);
  }

  // Gives the anchor its text back, as if it had never been wrapped.
  function restore(anchor) {
    const wrapped = wrappedTexts.get(anchor);
    if (!wrapped) return;

    if (anchor.data !== '') {
      // The page has written to it unseen. That is the text now, and ours is out of date.
      discard(anchor);
      return;
    }

    if (!isIntact(anchor, wrapped)) {
      release(anchor);
      return;
    }

    const text = shownText(wrapped);
    discard(anchor);
    anchor.data = text;
  }

  function queryAll(root, selector) {
    const type = nodeTypeOf.call(root);
    const prototype = type === Node.ELEMENT_NODE
      ? Element.prototype
      : type === Node.DOCUMENT_NODE ? Document.prototype : DocumentFragment.prototype;
    return prototype.querySelectorAll.call(root, selector);
  }

  // Gives the texts in an element their nodes back, and takes the marks off.
  function restoreIn(root) {
    for (const span of queryAll(root, `.${CLASS_NAME}`)) {
      const anchor = anchorOf.get(span);
      if (anchor) restore(anchor);
    }
    letGoIn(root);
  }

  function restoreAll() {
    const roots = [document];
    for (const references of [shadowRoots, detachedRoots]) {
      for (const reference of references) {
        const root = reference.deref();
        if (root) roots.push(root);
      }
    }

    for (const root of roots) {
      restoreIn(root);
    }
  }

  function observeRoot(root) {
    if (!isActive() || !root || observedRoots.has(root)) return;

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES
    });

    observedRoots.add(root);
  }

  // Adds a weak reference to one of the two sets above, and now and then drops the references
  // whose object is gone.
  function remember(references, object) {
    references.add(new WeakRef(object));
    if (references.size % 256 !== 0) return;

    for (const reference of references) {
      if (!reference.deref()) references.delete(reference);
    }
  }

  // A page may go on working on an element that it has taken out of the document, and put it
  // back later: a cached view, a row of a list that is used again. What it does in there to a
  // wrapped text has to be seen, or our nodes would still show the old text when the element
  // returns.
  function watchDetached(root) {
    if (observedRoots.has(root)) return;
    if (!held.has(root) && !querySelector.call(root, `.${CLASS_NAME}, ${HELD_SELECTOR}`)) return;

    observeRoot(root);
    remember(detachedRoots, root);
  }

  // Nothing is wrapped outside the document. A light tree is walked as a whole when it comes
  // back, because it arrives as an added node. A shadow tree does not arrive, its host does, so
  // the shadow roots around `node` are marked to be walked again when their hosts are met.
  function noteMissed(node) {
    let top = rootNodeOf.call(node);
    let host = hostOf(top);
    while (host) {
      missedRoots.add(top);
      top = rootNodeOf.call(host);
      host = hostOf(top);
    }
  }

  // Open shadow roots are a property of their host. Closed ones are reachable for extensions
  // through chrome.dom, which does not exist when these scripts run as page scripts in a test.
  const canOpenClosedRoots = typeof chrome !== 'undefined' && Boolean(chrome.dom && chrome.dom.openOrClosedShadowRoot);

  function closedShadowRootOf(element) {
    if (!canOpenClosedRoots) return null;

    try {
      return chrome.dom.openOrClosedShadowRoot(element);
    } catch {
      return null;
    }
  }

  function adoptShadowRoot(root) {
    if (!isActive()) return;

    if (observedRoots.has(root)) {
      if (missedRoots.delete(root)) scheduleWalk(root);
      return;
    }

    observeRoot(root);
    remember(shadowRoots, root);
    scheduleWalk(root);
  }

  // Called for every element of a subtree, so the common case, no shadow root and not a custom
  // element, has to be cheap. Asking chrome.dom is kept to custom elements, which is where
  // closed shadow roots are found.
  function lookForShadowRoot(element) {
    const open = openShadowRootOf.call(element);
    if (open) {
      adoptShadowRoot(open);
      return;
    }

    const name = localNameOf.call(element);
    if (namespaceOf.call(element) !== HTML_NAMESPACE) return;
    if (!name.includes('-')) {
      if (SHADOW_TAGS.has(name) && !classListOf.call(element).contains(CLASS_NAME)) {
        const root = closedShadowRootOf(element);
        if (root) adoptShadowRoot(root);
      }
      return;
    }

    // Its next look is due later. Asking chrome.dom is the dear part, so a walk that comes by
    // in the meantime does not ask again.
    if (waitingHosts.has(element)) return;

    const closed = closedShadowRootOf(element);
    if (closed) {
      adoptShadowRoot(closed);
    } else {
      waitingHosts.add(element);
      checkHostAt(element, 1);
      scheduleHostCheck();
    }
  }

  // Books the next look at a host, for when it will have been known for `age` ticks. It is
  // looked at when it has been known for 1, 2, 4, ... ticks, so the look before this one was at
  // half that age. A page can have thousands of such elements: each is only touched when its
  // look is due, not on every tick.
  function checkHostAt(host, age) {
    const due = hostTick + (age === 1 ? 1 : age / 2);
    let hosts = hostChecks.get(due);
    if (!hosts) {
      hosts = [];
      hostChecks.set(due, hosts);
    }
    hosts.push(host, age);
  }

  function scheduleHostCheck() {
    if (hostCheckTimer || !hostChecks.size) return;
    hostCheckTimer = window.setTimeout(checkLateHosts, HOST_CHECK_MS);
  }

  function checkLateHosts() {
    hostCheckTimer = null;
    if (!isActive()) return;

    hostTick += 1;
    const hosts = hostChecks.get(hostTick) || [];
    hostChecks.delete(hostTick);

    for (let index = 0; index < hosts.length; index += 2) {
      const host = hosts[index];
      const age = hosts[index + 1];
      const root = host.isConnected ? openShadowRootOf.call(host) || closedShadowRootOf(host) : null;

      if (root) adoptShadowRoot(root);
      if (root || !host.isConnected || age >= HOST_CHECK_TICKS) {
        // Forgotten. If it comes back into the document, the walk that finds it starts anew.
        waitingHosts.delete(host);
      } else {
        checkHostAt(host, age * 2);
      }
    }

    scheduleHostCheck();
  }

  // A walk goes through the text of a subtree first and through its elements, looking for
  // shadow roots, second. The browser does the stepping from one text node to the next, which
  // is several times faster than visiting every node from here.
  function beginWalk(root) {
    // Nodes that left the document before their turn are skipped. If they come back they are
    // queued again.
    if (!root) return null;
    if (!isConnectedOf.call(root)) {
      noteMissed(root);
      return null;
    }

    if (nodeTypeOf.call(root) === Node.TEXT_NODE) {
      wrap(root);
      return null;
    }

    if (isSkippedRoot(root)) return null;

    const texts = createTreeWalker.call(document, root, NodeFilter.SHOW_TEXT);
    return { root, texts, next: texts.nextNode(), elements: null, index: 0, restarts: 0, moved: false };
  }

  // Goes on with a walk until the time is up. Returns true when the walk is done.
  function continueWalk(walk, timeIsUp) {
    const { root, texts } = walk;
    const unhurried = walk.restarts > WALK_RESTART_LIMIT;

    // The page cannot take the root out while a slice is running, only between two of them.
    if (!isConnectedOf.call(root)) {
      noteMissed(root);
      return true;
    }

    if (!walk.elements) {
      // The page may have removed the node the last slice stopped at, and a walker cannot find
      // its way back from a node that is no longer under its root. Or it has moved that node to
      // another place under the root, and going on from there would leave out what lies in
      // between. Start over: text that is wrapped already costs next to nothing the second time.
      if (walk.next && (walk.moved || !containsNode.call(root, walk.next))) {
        walk.moved = false;
        walk.restarts += 1;
        texts.currentNode = root;
        walk.next = texts.nextNode();
      }

      let node = walk.next;
      while (node) {
        if (hasEmojiCandidate(node.data)) {
          const last = wrap(node);
          if (last) texts.currentNode = last;
        }

        node = texts.nextNode();

        if (timeIsUp() && node && !unhurried) {
          walk.next = node;
          return false;
        }
      }

      walk.next = null;

      lookAtMarked(root);
      if (isElement(root)) lookForShadowRoot(root);
      walk.elements = queryAll(root, '*');
    }

    const { elements } = walk;
    while (walk.index < elements.length) {
      lookForShadowRoot(elements[walk.index]);
      walk.index += 1;

      if (timeIsUp() && walk.index < elements.length && !unhurried) {
        return false;
      }
    }

    return true;
  }

  function flushQueue(deadline) {
    scheduled = false;

    if (!isActive()) {
      forgetWalks();
      return;
    }

    // Called once for each node or queued root that has been dealt with. It reads the clock
    // only now and then, because on a large page that alone would take longer than the work.
    const started = performance.now();
    let steps = 0;
    let late = false;
    const timeIsUp = () => {
      steps += 1;
      if (!late && steps % NODES_PER_CHECK === 0) {
        late = deadline && !deadline.didTimeout
          ? deadline.timeRemaining() <= 1
          : performance.now() - started >= SLICE_MS;
      }
      return late;
    };

    try {
      do {
        let walk = currentWalk;
        currentWalk = null;

        if (!walk) {
          if (walkIndex >= walkQueue.length) {
            // Taking the roots out of the set one at a time gets slower with every root taken,
            // so the set is emptied into a list.
            if (!pendingRoots.size) break;
            walkQueue = Array.from(pendingRoots);
            walkIndex = 0;
            pendingRoots.clear();
            // From here on these walks may have begun, and a walk that has begun does not meet
            // what is added behind the place it has reached.
            covered.clear();
          }

          walk = beginWalk(walkQueue[walkIndex]);
          walkQueue[walkIndex] = null;
          walkIndex += 1;
        }

        // A walk that throws is not picked up again: `currentWalk` is only set once a slice
        // has ended in good order.
        if (walk && !continueWalk(walk, timeIsUp)) {
          currentWalk = walk;
        }
      } while (!timeIsUp());
    } finally {
      settle();
      if (currentWalk || walkIndex < walkQueue.length || pendingRoots.size) scheduleFlush();
    }
  }

  function forgetWalks() {
    toHold = [];
    pendingRoots.clear();
    covered.clear();
    walkQueue = [];
    walkIndex = 0;
    currentWalk = null;
  }

  // Ends a stretch of our own work. The verdicts on where text may be wrapped are only good
  // until the page changes the tree again, and the changes made here are no news to the
  // observer: left in its queue, they would look like the page writing to its text nodes.
  function settle() {
    try {
      holdWaiting();
    } finally {
      contextCache.clear();
      observer.takeRecords();
    }
  }

  function scheduleFlush() {
    if (scheduled) return;
    scheduled = true;
    requestIdle(flushQueue, { timeout: 500 });
  }

  function scheduleWalk(root) {
    // While server-rendered markup is held back nothing would be wrapped, so nothing is walked.
    // When that ends, the document is walked as a whole.
    if (!isActive() || !root || holding) return;

    pendingRoots.add(root);
    scheduleFlush();
  }

  // Wraps a node the page has written to: at once, or when its text has stopped changing.
  function wrapWhen(node, when) {
    const pending = pendingWraps.get(node);
    if (pending) {
      window.clearTimeout(pending);
      pendingWraps.delete(node);
    }

    if (when === 'never' || !hasEmojiCandidate(node.data)) return;

    const delay = habits.WAIT_MS[when];
    if (!delay) {
      wrap(node);
      return;
    }

    pendingWraps.set(node, window.setTimeout(() => {
      pendingWraps.delete(node);
      if (!isActive()) return;

      try {
        wrap(node);
      } finally {
        settle();
      }
    }, delay));
  }

  // Was this node, or something around it, put into the document by the changes at hand?
  function arrivedWith(added, node) {
    let current = node;
    while (current && added.size) {
      if (added.has(current)) return true;
      const parent = parentNodeOf.call(current);
      current = parent || hostOf(current);
    }
    return false;
  }

  // The page wrote to the anchor of a wrapped text: that is the new text, and our pieces show
  // the old one.
  function pageWroteAnchor(anchor, wrapped, taken) {
    const value = anchor.data;

    // The element has become editable since the text was wrapped, and what was written is what
    // the user typed. The rest of the text stays, as ordinary nodes.
    if (isEditable(anchor.parentNode)) {
      release(anchor);
      return;
    }

    // A script that runs over every text node and writes each one back also writes the empty
    // anchor, and with it the canary and the rest of our text nodes. That is not the page
    // clearing its text.
    if (value === '' && wrapped.pieces.some((piece) => taken.has(piece))) return;

    const { habit, wrap: when } = habits.afterWrite(habitOf.get(anchor), {
      wrapped: true,
      before: wrapped.text,
      after: value
    });

    if (habit) habitOf.set(anchor, habit);
    discard(anchor, taken);
    wrapWhen(anchor, when);
  }

  // The page wrote to a text node that is not wrapped.
  function pageWroteText(node, before, added) {
    const parent = node.parentNode;
    if (!parent || isSkippedParent(parent) || before === node.data) return;

    // Text that is set while its node is being put into the document is new text, not a change
    // to old text. The walk that is queued for the new nodes takes care of it.
    if (arrivedWith(added, node)) return;

    const { habit, wrap: when } = habits.afterWrite(habitOf.get(node), {
      wrapped: false,
      before,
      after: node.data
    });

    if (habit) habitOf.set(node, habit);
    wrapWhen(node, when);
  }

  function handleMutations(records) {
    if (!isActive()) return;

    const written = new Map(); // text node of the page -> its text before these changes
    const added = new Map(); // node -> the parent the page put it into, the last time
    const removed = new Map(); // node -> the parent the page took it from, the first time
    const crowded = new Set(); // anchors that got something put right behind them
    const disturbed = new Set(); // anchors with pieces the page removed or moved
    // Pieces of ours that the page wrote to. A framework that makes do with the nodes it finds
    // when it takes over server-rendered markup, as Preact does, picks ours up as its own.
    const taken = new Set();
    // Elements whose `contenteditable` changed, whose mark the page changed, and marked ones
    // that the page did something else to.
    const switched = new Set();
    const remarked = new Set();
    const touched = new Set();
    // While the document is being parsed, what the parser adds may be the first sign of markup
    // that a framework is going to take over.
    const parsing = !heldBefore && readyStateOf.call(document) === 'loading';
    let serverRendered = false;
    // Nothing was wrapped before these changes, so none of them can have touched a node of ours.
    const nothingOfOurs = !wrappedBefore;

    for (const record of records) {
      if (record.type === 'attributes') {
        (record.attributeName === HELD_ATTRIBUTE ? remarked : switched).add(record.target);
        continue;
      }

      if (!nothingOfOurs) {
        const holder = record.type === 'characterData' ? parentNodeOf.call(record.target) : record.target;
        if (holder && held.has(holder)) touched.add(holder);
      }

      if (record.type === 'characterData') {
        const node = record.target;
        // Comments change this way as well.
        if (node.nodeType !== Node.TEXT_NODE) continue;

        if (anchorOf.has(node)) {
          taken.add(node);
        } else if (anchorOf.has(node.parentNode)) {
          taken.add(node.parentNode);
        } else if (!written.has(node)) {
          written.set(node, record.oldValue || '');
        }
        continue;
      }

      // A walk that waits for its next slice goes on from a node that it remembers. If that
      // node is taken out, alone or with something around it, the walk has to find its place
      // anew.
      if (currentWalk && currentWalk.next && !currentWalk.moved) {
        const { removedNodes } = record;
        for (let index = 0; index < removedNodes.length; index += 1) {
          const node = removedNodes[index];
          if (node === currentWalk.next || (isElement(node) && containsNode.call(node, currentWalk.next))) {
            currentWalk.moved = true;
            break;
          }
        }
      }

      // The two lists are gone through by index: on a page that adds tens of thousands of
      // nodes, an iterator for each of them takes longer than the rest of this loop.
      if (!nothingOfOurs) {
        const { removedNodes } = record;
        for (let index = 0; index < removedNodes.length; index += 1) {
          const node = removedNodes[index];
          if (!removed.has(node)) removed.set(node, record.target);
          const anchor = anchorOf.get(node);
          if (anchor) disturbed.add(anchor);
        }
      }

      const { addedNodes } = record;
      if (addedNodes.length) {
        for (let index = 0; index < addedNodes.length; index += 1) {
          const node = addedNodes[index];
          // A node that is put somewhere a second time is where it was put last.
          added.set(node, record.target);
          if (parsing && !serverRendered && hydration.signOn(node)) serverRendered = true;
        }

        if (!nothingOfOurs && wrappedTexts.has(record.previousSibling)) crowded.add(record.previousSibling);
      }
    }

    try {
      for (const element of switched) {
        if (!isElement(element)) continue;
        if (isEditable(element)) {
          restoreIn(element);
        } else {
          scheduleWalk(element);
        }
      }

      for (const element of remarked) {
        pageChangedMark(element);
      }
      // Before the texts that were written are looked at, so that those find the marks as
      // they should be.
      for (const element of touched) {
        if (held.has(element) && !stillHolds(element)) scheduleWalk(element);
      }

      for (const [node, parent] of removed) {
        const wrapped = wrappedTexts.get(node);
        if (!wrapped) continue;

        // Taken out of an element that has become editable: by the user's editing, then, and
        // the rest of the text is not to go with it.
        if (isEditable(parent)) {
          release(node);
          continue;
        }

        if (node.isConnected) {
          // The page moved its text node. The text goes with it, unless the page is moving the
          // pieces as well.
          if (!disturbed.has(node)) follow(node);
          continue;
        }

        const [canary, ...pieces] = wrapped.pieces;
        if (removed.has(canary) && pieces.some((piece) => piece.isConnected || piece.parentNode === parent)) {
          // The canary went together with the anchor while the text stayed: in the document,
          // or where it was in an element that is itself out of the document. Whoever did that
          // was clearing out empty text nodes, as Node.normalize() does, and did not mean the
          // text. It stays, as ordinary nodes.
          release(node);
          continue;
        }

        // The page took its text node out, so the text goes too. The node gets its text back:
        // some scripts put the same node in again later.
        const text = shownText(wrapped);
        discard(node, taken);
        if (!written.has(node) && node.data === '') node.data = text;
      }

      // Also in an element that is out of the document. Nothing is wrapped there, but pieces
      // that show an old text have to go, and a write says the same about its script as it
      // does anywhere else.
      for (const [node, before] of written) {
        const wrapped = wrappedTexts.get(node);
        if (wrapped) {
          pageWroteAnchor(node, wrapped, taken);
        } else {
          pageWroteText(node, before, added);
        }
      }

      for (const anchor of crowded) {
        if (!disturbed.has(anchor)) follow(anchor);
      }

      // In the order they were first added. A node mostly comes after the node it was put
      // into; where it does not, it gets a walk of its own, which is one too many and no harm.
      for (const [node, parent] of added) {
        if (anchorOf.has(node)) continue;

        // A text without emoji needs no walk. If the page writes emoji into it later, that is
        // seen as a write.
        const type = nodeTypeOf.call(node);
        if (type !== Node.ELEMENT_NODE && !(type === Node.TEXT_NODE && hasEmojiCandidate(node.data))) continue;

        if (pendingRoots.has(parent) || covered.has(parent)) {
          covered.add(node);
        } else {
          // Moved out of a node that waits, perhaps: then it no longer goes with that node.
          covered.delete(node);
          scheduleWalk(node);
        }
      }

      for (const node of removed.keys()) {
        if (isElement(node) && !isConnectedOf.call(node)) watchDetached(node);
      }

      // Last, so that it also reaches what these changes took out of the document.
      if (serverRendered) holdBack();
    } finally {
      settle();
    }
  }

  const observer = new MutationObserver(handleMutations);

  // The document holds markup that a framework is going to take over. What was wrapped before
  // the signs of that showed up is put back, and nothing is wrapped until the framework is done.
  function holdBack() {
    if (holding || heldBefore) return;

    holding = true;
    heldBefore = true;
    forgetWalks();
    restoreAll();
    settle();
    endHold = hydration.whenTakenOver(letGo);
  }

  function letGo() {
    endHold = null;
    if (!holding) return;
    holding = false;

    // The walk that starts now does not meet the shadow roots it knows already as new ones.
    for (const reference of shadowRoots) {
      const root = reference.deref();
      if (root) missedRoots.add(root);
    }
    scheduleWalk(bodyOf.call(document));
  }

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
      if (readyStateOf.call(document) !== 'loading') syncState();
    }, START_RETRY_MS);
  }

  function cancelRescan() {
    if (rescanTimer) {
      window.clearTimeout(rescanTimer);
      rescanTimer = null;
    }
  }

  // Scripts that run while the page loads may give ordinary elements a shadow root after the
  // walk has passed them. One more walk shortly after loading finds those.
  function rescanAfterLoad() {
    if (readyStateOf.call(document) === 'complete') return;

    window.addEventListener('load', () => {
      if (!observerActive) return;
      cancelRescan();
      rescanTimer = window.setTimeout(() => {
        rescanTimer = null;
        scheduleWalk(bodyOf.call(document));
      }, 1000);
    }, { once: true });
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
    if (hydration.signIn()) holdBack();
    scheduleWalk(body);
    rescanAfterLoad();
  }

  function stop() {
    observer.disconnect();
    cancelStartRetry();
    cancelRescan();
    startRetries = 0;

    if (hostCheckTimer) {
      window.clearTimeout(hostCheckTimer);
      hostCheckTimer = null;
    }
    for (const timer of pendingWraps.values()) {
      window.clearTimeout(timer);
    }

    pendingWraps.clear();
    toHold = [];
    hostChecks.clear();
    waitingHosts = new WeakSet();
    hostTick = 0;
    forgetWalks();
    scheduled = false;

    // A document is held back once, and switching off and on again does not start that anew.
    // Unless it was switched off in the middle of it: then the framework may still be to come.
    if (holding) heldBefore = false;
    if (endHold) endHold();
    endHold = null;
    holding = false;

    // Switched off means off: the page gets its text nodes back as they were.
    if (observerActive) restoreAll();

    shadowRoots.clear();
    detachedRoots.clear();
    held = new WeakMap();
    unmarked = new WeakMap();
    observedRoots = new WeakSet();
    missedRoots = new WeakSet();
    observerActive = false;
  }

  function syncState() {
    if (isActive()) {
      start();
    } else {
      stop();
    }
  }

  state.subscribe(syncState);
  listen.call(document, 'DOMContentLoaded', syncState, { once: true });
  syncState();
})();
