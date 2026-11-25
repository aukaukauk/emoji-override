// Unlike the other content scripts, this one runs in the page's own world. A framework that
// takes over markup rendered on the server ("hydration") keeps its books on the DOM nodes, in
// properties that only scripts of the page can see, and those say exactly whether the takeover
// is still to come. hydration.js asks from the other world with two events on the document.
// The answer is whether the event comes back cancelled: events are what the two worlds share.
//
// Nothing here changes the page, and nothing leaves it.
(() => {
  const TAKING_OVER = 'noto-emoji-override:taking-over';
  const TAKEN_OVER = 'noto-emoji-override:taken-over';

  // A Suspense boundary can stay as the server sent it long after the rest was taken over, for
  // example until its code has loaded. It keeps the answer at "still taking over" for this
  // long and no longer: some boundaries are only taken over once they are needed.
  const BOUNDARY_PATIENCE_MS = 4000;

  // Taken now, before a script of the page can put something else in their place.
  const keysOf = Object.keys;
  const hasOwn = Object.prototype.hasOwnProperty;
  const getter = (prototype, name) => Object.getOwnPropertyDescriptor(prototype, name).get;
  const bodyOf = getter(Document.prototype, 'body');
  const rootElementOf = getter(Document.prototype, 'documentElement');
  const parentOf = getter(Node.prototype, 'parentNode');
  const queryAll = Document.prototype.querySelectorAll;
  const createTreeWalker = Document.prototype.createTreeWalker;
  const clock = Date.now;

  // React 17 and later mark the node they render into with a property whose name starts with
  // `__reactContainer$`, and every node they have taken over with one that starts with
  // `__reactFiber$`. Both names end in a random suffix.
  function keyWith(node, prefix) {
    for (const key of keysOf(node)) {
      if (key.startsWith(prefix)) return key;
    }
    return null;
  }

  // Has this React tree yet to take over what the server sent?
  function rootIsWaiting(container, key) {
    const rootState = container[key].stateNode.current.memoizedState;
    return Boolean(rootState && rootState.isDehydrated);
  }

  // The comments that React's server leaves in what it renders: a space between two texts that
  // follow each other, and these around Suspense boundaries.
  const REACT_COMMENTS = new Set([' ', '$', '$?', '$!', '/$']);

  // Frameworks put scripts and the like inside boundaries. Those are never taken over, and are
  // no content that could be waiting.
  const NOT_CONTENT = new Set(['script', 'style', 'link', 'meta', 'title', 'template', 'noscript']);

  // `open` is the comment `<!--$-->` that React's server puts in front of the content of a
  // finished Suspense boundary; `<!--/$-->` closes it. The boundary has been taken over if any
  // node directly in it has been.
  function boundaryIsWaiting(open) {
    let depth = 0;
    let content = false;

    for (let node = open.nextSibling; node; node = node.nextSibling) {
      const type = node.nodeType;
      if (type === 8) {
        if (node.data === '/$') {
          if (depth === 0) break;
          depth -= 1;
        } else if (node.data === '$' || node.data === '$?' || node.data === '$!') {
          depth += 1;
        }
      } else if (type === 1 ? !NOT_CONTENT.has(node.localName) : type === 3 && node.data.trim() !== '') {
        if (keyWith(node, '__reactFiber$')) return false;
        content = true;
      }
    }

    return content;
  }

  let boundariesSince = 0;
  let last = null;
  let lastAt = 0;

  // `seen`: a framework has made some part of the document its own. `waiting`: one has yet to
  // take over markup that is there.
  function look() {
    const now = clock();
    // Both questions are asked in one go.
    if (last && now - lastAt < 20) return last;

    const state = { seen: false, waiting: false };
    let boundaries = false;

    // What frameworks render into: the document itself, <html>, <body>, or an element that the
    // page can find again, which mostly means one with an id. Where React's server has left
    // its comments, what React renders into is somewhere above them.
    const candidates = new Set([document, rootElementOf.call(document), bodyOf.call(document)]);
    for (const element of queryAll.call(document, '[id]')) {
      candidates.add(element);
    }

    const climbed = new Set();
    const signs = createTreeWalker.call(document, document, NodeFilter.SHOW_COMMENT);
    while (signs.nextNode()) {
      if (!REACT_COMMENTS.has(signs.currentNode.data)) continue;
      for (let node = parentOf.call(signs.currentNode); node && !climbed.has(node); node = parentOf.call(node)) {
        climbed.add(node);
        candidates.add(node);
      }
    }

    for (const node of candidates) {
      if (!node) continue;

      const key = keyWith(node, '__reactContainer$');
      if (!key) {
        // React 16 and Vue 3 mark what they render into as well, once they are done with it.
        if (hasOwn.call(node, '_reactRootContainer') || hasOwn.call(node, '__vue_app__')) state.seen = true;
        continue;
      }

      state.seen = true;
      if (rootIsWaiting(node, key)) {
        state.waiting = true;
        continue;
      }

      if (boundaries) continue;
      const comments = createTreeWalker.call(document, node, NodeFilter.SHOW_COMMENT);
      while (comments.nextNode()) {
        if (comments.currentNode.data === '$' && boundaryIsWaiting(comments.currentNode)) {
          boundaries = true;
          break;
        }
      }
    }

    if (!boundaries) {
      boundariesSince = 0;
    } else {
      boundariesSince = boundariesSince || now;
      if (now - boundariesSince < BOUNDARY_PATIENCE_MS) state.waiting = true;
    }

    last = state;
    lastAt = now;
    return state;
  }

  function answer(event, question) {
    let state;
    try {
      state = look();
    } catch {
      // A framework that keeps its books differently from what is expected here. No answer
      // means "nothing to be seen", and hydration.js goes by the clock then.
      return;
    }

    if (state[question]) event.preventDefault();
  }

  document.addEventListener(TAKING_OVER, (event) => answer(event, 'waiting'), true);
  document.addEventListener(TAKEN_OVER, (event) => answer(event, 'seen'), true);
})();
