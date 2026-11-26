import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// A framework that takes over server-rendered markup must find it as the server sent it. The
// pages here do what such frameworks do, on a timetable of their own: they keep their books on
// the nodes the way React and Vue do, or take attributes off the way Angular does, and they
// write down what they found at each step. A script that takes long to load stands in for the
// framework's code, and keeps the page from looking finished before the framework is.
describe('markup that a framework takes over', skipWithoutChrome, () => {
  const browser = useBrowser();

  // `books.root()` and `books.own()` mark a node as React marks what it renders into and what
  // it has taken over. `look()` notes how many emoji are wrapped at that moment.
  const page = (markup, script) => `<script>
  window.books = {
    root(container, waiting) {
      container.__reactContainer$test = { stateNode: { current: { memoizedState: { isDehydrated: waiting } } } };
    },
    own(...nodes) {
      for (const node of nodes) node.__reactFiber$test = {};
    }
  };
  window.seen = {};
  window.wrapped = () => document.querySelectorAll('.noto-emoji-wrapped').length;
  window.look = (name) => { window.seen[name] = window.wrapped(); };
</script>${markup}<script>${script}</script>`;

  async function open(markup, script, { settle = 200, stub = {} } = {}) {
    const opened = await browser.open({ body: page(markup, script), stub });
    const result = await opened.evaluate(async (wait) => {
      await __t.sleep(wait);
      await __t.settle();
      return { ...window.seen, inTheEnd: window.wrapped() };
    }, settle);
    assert.deepEqual(opened.errors, []);
    await opened.close();
    return result;
  }

  test('is left as the server sent it until React has taken it over, and is wrapped right after', async () => {
    const result = await open(
      `<div id="__next"><p id="a"><b>[</b>Hello <!-- -->${E.grin} there<i>]</i></p></div><p id="clock">tick 1 ${E.rocket}</p><script src="/delay/1500" async></script>`,
      `const container = document.getElementById('__next');
      const paragraph = document.getElementById('a');
      const sent = [...paragraph.childNodes];
      const asSent = () => paragraph.childNodes.length === sent.length && sent.every((node, index) => paragraph.childNodes[index] === node) && sent[3].data !== '';
      // A text that is set anew would be wrapped at once at any other time.
      setTimeout(() => { document.getElementById('clock').firstChild.data = 'tick 2 ${E.rocket}'; }, 150);
      setTimeout(() => { seen.beforeReactStarts = [asSent(), wrapped()]; books.root(container, true); }, 300);
      setTimeout(() => { seen.whenReactIsDone = [asSent(), wrapped()]; books.root(container, false); books.own(paragraph, ...sent); }, 600);
      // The slow script is still on its way: it is React's word that counts, not the clock.
      setTimeout(() => { seen.rightAfter = wrapped(); seen.nodeKept = paragraph.childNodes[3] === sent[3]; }, 900);`
    );

    assert.deepEqual(result, {
      beforeReactStarts: [true, 0],
      whenReactIsDone: [true, 0],
      rightAfter: 2,
      nodeKept: true,
      inTheEnd: 2
    });
  });

  test('is taken over by a React that renders into an element without an id, and that is seen too', async () => {
    const result = await open(
      `<main><div class="app"><p id="a">Hello <!-- -->${E.grin}</p></div></main><script src="/delay/1500" async></script>`,
      `const container = document.querySelector('.app');
      setTimeout(() => { look('beforeReactStarts'); books.root(container, true); }, 300);
      setTimeout(() => { look('whenReactIsDone'); books.root(container, false); books.own(...container.querySelectorAll('*')); }, 600);
      setTimeout(() => look('rightAfter'), 900);`
    );

    assert.deepEqual(result, { beforeReactStarts: 0, whenReactIsDone: 0, rightAfter: 1, inTheEnd: 1 });
  });

  test('gets back what was wrapped before the first sign of it showed up', async () => {
    const result = await open(
      `<p id="early">early ${E.grin}</p><x-box id="box"></x-box>
<script>
  window.shadow = document.getElementById('box').attachShadow({ mode: 'open' });
  window.shadow.innerHTML = '<p>shadow ${E.rocket}</p>';
  const inShadow = () => window.shadow.querySelectorAll('.noto-emoji-wrapped').length;
  setTimeout(() => { look('whileTheParserWaits'); seen.shadowWhileTheParserWaits = inShadow(); }, 300);
</script>
<script src="/delay/600"></script>
<div id="__next"><p id="a">Hello <!-- -->${E.party}</p></div>`,
      `const early = document.getElementById('early');
      seen.whenTheSignShowed = [wrapped(), early.childNodes.length, early.firstChild.data, inShadow()];
      const container = document.getElementById('__next');
      books.root(container, true);
      setTimeout(() => { books.root(container, false); books.own(...container.querySelectorAll('*')); }, 300);
      setTimeout(() => { seen.shadowInTheEnd = inShadow(); }, 800);`,
      // The settings arrive when there is a <body> already, as they often do. The scripts then
      // start on the page while it is still being parsed.
      { settle: 900, stub: { delay: 50 } }
    );

    assert.deepEqual(result, {
      whileTheParserWaits: 1,
      shadowWhileTheParserWaits: 1,
      whenTheSignShowed: [0, 1, `early ${E.grin}`, 0],
      shadowInTheEnd: 1,
      inTheEnd: 2
    });
  });

  test('of a framework that cannot be seen is wrapped once the scripts have run and the page is at rest', async () => {
    const result = await open(
      `<main><!--[--><p id="a">Hello ${E.grin}</p><!--]--></main><script src="/delay/600" async></script>`,
      `setTimeout(() => look('whileTheScriptLoads'), 400);
      setTimeout(() => look('afterIt'), 1250);`,
      { settle: 800 }
    );

    assert.deepEqual(result, { whileTheScriptLoads: 0, afterIt: 1, inTheEnd: 1 });
  });

  test('that React never comes for is wrapped a while after loading', async () => {
    const opened = await browser.open({
      body: page(`<div id="root"><p id="a">Hello <!-- -->${E.grin}</p></div>`, 'window.addEventListener("load", () => setTimeout(() => look("soonAfterLoading"), 400));')
    });
    const result = await opened.evaluate(async () => {
      await __t.sleep(window.__notoEmojiOverride.hydration.GRACE_MS + 400);
      await __t.settle();
      return { ...window.seen, inTheEnd: window.wrapped() };
    });

    assert.deepEqual(result, { soonAfterLoading: 0, inTheEnd: 1 });
    await opened.close();
  });

  test('inside a Suspense boundary is waited for as well, and a boundary that only holds a script is not', async () => {
    const result = await open(
      `<div id="__next"><p id="shell">Shell ${E.grin}</p><!--$--><p id="lazy">Lazy ${E.party}</p><!--/$--><!--$--><script>window.streamed = true;</script><!--/$--></div>
<script src="/delay/1500" async></script>`,
      `books.root(document.getElementById('__next'), false);
      books.own(document.getElementById('shell'));
      setTimeout(() => look('whileTheBoundaryWaits'), 400);
      setTimeout(() => books.own(document.getElementById('lazy')), 600);
      setTimeout(() => look('onceItIsTakenOver'), 900);`
    );

    assert.deepEqual(result, { whileTheBoundaryWaits: 0, onceItIsTakenOver: 2, inTheEnd: 2 });
  });

  test('is wrapped as soon as Vue has mounted on it', async () => {
    const result = await open(
      `<div id="app"><!--[--><p id="a">Hello ${E.grin}</p><!--]--></div><script src="/delay/1500" async></script>`,
      `setTimeout(() => { look('beforeMounting'); document.getElementById('app').__vue_app__ = {}; }, 400);
      setTimeout(() => look('afterMounting'), 700);`
    );

    assert.deepEqual(result, { beforeMounting: 0, afterMounting: 1, inTheEnd: 1 });
  });

  test('is wrapped as soon as Angular has taken its attributes off', async () => {
    const result = await open(
      `<app-root ng-server-context="ssr"><p id="a" ngh="0">Hello ${E.grin}</p></app-root><script src="/delay/1500" async></script>`,
      `setTimeout(() => { look('beforeTakingOver'); document.getElementById('a').removeAttribute('ngh'); }, 400);
      setTimeout(() => look('afterTakingOver'), 700);`
    );

    assert.deepEqual(result, { beforeTakingOver: 0, afterTakingOver: 1, inTheEnd: 1 });
  });

  test('that still carries Angular\'s attributes is waited for although the page is at rest', async () => {
    const result = await open(
      `<app-root ng-server-context="ssr"><p id="a" ngh="0">Hello ${E.grin}</p></app-root>`,
      `setTimeout(() => { look('atRestButNotTakenOver'); document.getElementById('a').removeAttribute('ngh'); }, 600);`,
      { settle: 700 }
    );

    assert.deepEqual(result, { atRestButNotTakenOver: 0, inTheEnd: 1 });
  });

  test('that is still arriving is not wrapped, even where React is done with what is there', async () => {
    const result = await open(
      `<div id="__next"><p id="a">Hello <!-- -->${E.grin}</p></div>
<script>
  books.root(document.getElementById('__next'), false);
  books.own(...document.getElementById('__next').querySelectorAll('*'));
  setTimeout(() => look('whileTheRestArrives'), 350);
</script>
<script src="/delay/700"></script>
<p id="tail">tail ${E.party}</p>`,
      '',
      // As above: the scripts are at work while the page is still being parsed.
      { stub: { delay: 50 } }
    );

    assert.deepEqual(result, { whileTheRestArrives: 0, inTheEnd: 2 });
  });

  test('is not waited for after the extension was switched off, nor again when it comes back on', async () => {
    const opened = await browser.open({
      body: page(`<div id="__next"><p id="a">Hello ${E.grin}</p></div>`, '')
    });
    const result = await opened.evaluate(async () => {
      // React has left its sign and has not come: this is being waited for.
      await __t.sleep(200);
      const waiting = window.wrapped();

      await chrome.storage.sync.set({ enabled: false });
      await __t.sleep(window.__notoEmojiOverride.hydration.GRACE_MS + 300);
      const off = window.wrapped();

      // By the time it is switched on again, React has long been done.
      const container = document.getElementById('__next');
      window.books.root(container, false);
      window.books.own(...container.querySelectorAll('*'));
      await chrome.storage.sync.set({ enabled: true });
      await __t.sleep(150);
      await __t.settle();
      return { waiting, off, onAgain: window.wrapped() };
    });

    assert.deepEqual(result, { waiting: 0, off: 0, onAgain: 1 });
    assert.deepEqual(opened.errors, []);
    await opened.close();
  });

  test('does not hold back a page that shows no sign of it', async () => {
    const result = await open(
      `<p id="a">Hello ${E.grin}</p><!-- an ordinary comment --><script src="/delay/900" async></script>`,
      'setTimeout(() => look("whileAScriptLoads"), 400);'
    );

    assert.deepEqual(result, { whileAScriptLoads: 1, inTheEnd: 1 });
  });
});
