// A framework that takes over markup rendered on the server ("hydration") expects to find that
// markup as the server sent it. Where it does not, React gives up on that part or on the whole
// page and renders it again from nothing, and others repair what they find or end up attached
// to the wrong nodes. So in a document that shows the signs of such markup, nothing is wrapped
// until the framework has taken over. From then on its text nodes are nodes that a script keeps
// using, which emoji_replacer.js can live with.
//
// For React and Vue the page itself says when that is (see page_probe.js). For the others it is
// judged by the clock: the document has been parsed, the scripts that were in it have run, and
// the page has come to rest.
(() => {
  const TAKING_OVER = 'noto-emoji-override:taking-over';
  const TAKEN_OVER = 'noto-emoji-override:taken-over';

  const POLL_MS = 100;
  const SCRIPT_POLL_MS = 30;
  // Two idle periods this far apart count as the page having come to rest.
  const QUIET_MS = 100;
  // How long after loading a framework that has left its signs, but has not shown up, is still
  // waited for. Its code may be on its way.
  const GRACE_MS = 1000;
  // After this long from the end of parsing nothing is held back any more, whatever the signs.
  const LIMIT_MS = 10000;
  // The same for a document that does not finish loading.
  const LOADING_LIMIT_MS = 20000;

  // Comments that a server leaves between the parts a framework fills in. React puts a space
  // between two neighbouring texts and `$` and its relatives around Suspense boundaries, Vue 3
  // and Svelte 5 put brackets around lists and blocks, Solid uses `#` and `/`.
  const SIGN_COMMENTS = new Set([' ', '$', '$?', '$!', '/$', '[', ']', '[!', '#', '/', '!$']);
  // Children of <body> that frameworks render into.
  const SIGN_ROOTS = '#__next, #__nuxt, #___gatsby, #__docusaurus, [data-server-rendered], [ng-server-context]';

  // The signs of React and Vue alone. Their taking over can be seen, so as long as it has not
  // been seen it is still to come.
  const SEEN_COMMENTS = new Set([' ', '$?', '$!', '/$']);
  const SEEN_ROOTS = '#__next, #__nuxt, #___gatsby, #__docusaurus';
  // Vue 2 and Angular take these attributes off the markup as they take it over.
  const UNTOUCHED = '[data-server-rendered], [ngh]';

  // A page can shadow members of its document and of its forms with named elements, so these go
  // through the prototype.
  const prototypeGetter = (prototype, name) => Object.getOwnPropertyDescriptor(prototype, name).get;
  const bodyOf = prototypeGetter(Document.prototype, 'body');
  const scriptsOf = prototypeGetter(Document.prototype, 'scripts');
  const nodeTypeOf = prototypeGetter(Node.prototype, 'nodeType');
  const parentNodeOf = prototypeGetter(Node.prototype, 'parentNode');
  const readyStateOf = prototypeGetter(Document.prototype, 'readyState');
  const createTreeWalker = Document.prototype.createTreeWalker;
  const listen = EventTarget.prototype.addEventListener;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const matches = Element.prototype.matches;
  const queryIn = (root, selector) => (root === document ? Document.prototype : Element.prototype).querySelector.call(root, selector);

  const requestIdle = window.requestIdleCallback
    ? (callback) => window.requestIdleCallback(callback)
    : (callback) => window.setTimeout(callback, 50);

  function hasComment(root, wanted) {
    const comments = createTreeWalker.call(document, root, NodeFilter.SHOW_COMMENT);
    while (comments.nextNode()) {
      if (wanted.has(comments.currentNode.data)) return true;
    }
    return false;
  }

  // Is this node, which the parser has just added, a sign of markup that will be taken over?
  function signOn(node) {
    const type = nodeTypeOf.call(node);
    if (type === Node.COMMENT_NODE) return SIGN_COMMENTS.has(node.data);

    return type === Node.ELEMENT_NODE
      && parentNodeOf.call(node) === bodyOf.call(document)
      && matches.call(node, SIGN_ROOTS);
  }

  // Is there such a sign in the document as it is now?
  function signIn() {
    const body = bodyOf.call(document);
    if (!body) return false;

    return Boolean(queryIn(body, `:scope > :is(${SIGN_ROOTS})`)) || hasComment(body, SIGN_COMMENTS);
  }

  // Which scripts have run or have failed to load: a script element does not say so itself.
  // The events are followed from the very start, when the document has no scripts yet. (Where
  // these files are tested as scripts of a page, the ones in front of this one have run.)
  const finished = new WeakSet();
  for (const script of scriptsOf.call(document)) {
    finished.add(script);
  }

  const noteScript = (event) => {
    if (event.target instanceof HTMLScriptElement) finished.add(event.target);
  };
  listen.call(document, 'load', noteScript, true);
  listen.call(document, 'error', noteScript, true);

  const SCRIPT_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

  function loadingScripts() {
    const loading = [];
    for (const script of scriptsOf.call(document)) {
      if (finished.has(script) || !script.src || script.noModule) continue;

      const type = script.type.trim();
      if (type === '' || SCRIPT_TYPE.test(type)) loading.push(script);
    }
    return loading;
  }

  // An event that comes back cancelled is a "yes" from page_probe.js.
  function asksPage(question) {
    return !dispatch.call(document, new Event(question, { cancelable: true }));
  }

  // Calls `done` once the framework has taken the document over, as far as that can be told.
  // Returns a function that calls the waiting off.
  function whenTakenOver(done) {
    const startedAt = performance.now();
    let parsedAt = 0;
    let loadedAt = 0;
    let calm = false;
    let expectsToSee = null;
    let sawUntouched = false;
    let over = false;
    let timer = 0;

    const finish = () => {
      if (over) return;
      over = true;
      window.clearTimeout(timer);
      done();
    };

    // The clock's part. A framework's code is among the scripts that are in the document when
    // parsing ends, or among those that these bring in. What comes after that is advertising
    // and the like, which a page keeps loading for a long time. While the framework works the
    // page gets no idle time, so two idle periods in a row mean that it is not at work.
    const comeToRest = () => {
      requestIdle(() => {
        window.setTimeout(() => {
          requestIdle(() => {
            calm = true;
          });
        }, QUIET_MS);
      });
    };

    const waitForScripts = (round) => {
      const scripts = round < 2 ? loadingScripts() : [];

      const poll = () => {
        if (over) return;

        const loaded = readyStateOf.call(document) === 'complete';
        if (!loaded && !scripts.every((script) => finished.has(script) || !script.isConnected)) {
          window.setTimeout(poll, SCRIPT_POLL_MS);
        } else if (!loaded && scripts.length) {
          waitForScripts(round + 1);
        } else {
          comeToRest();
        }
      };

      poll();
    };

    // Has React or Vue left its signs? Then it is still to come, as it has not been seen.
    const expected = () => {
      if (expectsToSee === null) {
        const body = bodyOf.call(document);
        expectsToSee = Boolean(body)
          && (Boolean(queryIn(body, `:scope > :is(${SEEN_ROOTS})`)) || hasComment(body, SEEN_COMMENTS));
      }
      return expectsToSee;
    };

    const check = () => {
      if (over) return;

      const now = performance.now();
      const again = () => {
        timer = window.setTimeout(check, POLL_MS);
      };

      // Markup that is still arriving is still to be taken over, whatever has become of the
      // part that is there.
      if (readyStateOf.call(document) === 'loading') {
        if (now - startedAt > LOADING_LIMIT_MS) finish();
        else again();
        return;
      }

      if (!parsedAt) {
        parsedAt = now;
        waitForScripts(0);
      }
      if (!loadedAt && readyStateOf.call(document) === 'complete') loadedAt = now;

      // Markup that still carries what its framework takes off has not been taken over. Once
      // that is gone, it has been.
      const untouched = Boolean(queryIn(document, UNTOUCHED));
      sawUntouched = sawUntouched || untouched;

      if (now - parsedAt > LIMIT_MS) {
        finish();
      } else if (asksPage(TAKING_OVER)) {
        again();
      } else if (asksPage(TAKEN_OVER) || (sawUntouched && !untouched)) {
        finish();
      } else if (!calm || ((untouched || expected()) && !(loadedAt && now - loadedAt > GRACE_MS))) {
        again();
      } else {
        finish();
      }
    };

    timer = window.setTimeout(check, 0);

    return () => {
      over = true;
      window.clearTimeout(timer);
    };
  }

  globalThis.__notoEmojiOverride ||= {};
  globalThis.__notoEmojiOverride.hydration = { signOn, signIn, whenTakenOver, GRACE_MS, LIMIT_MS };
})();
