import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// An element that holds nothing but emoji gets the emoji font as a whole: it is marked, and its
// text node stays as the page made it. Taking the text apart is kept for emoji that stand in
// the middle of other text.
describe('elements that hold nothing but emoji', skipWithoutChrome, () => {
  const browser = useBrowser();

  const MARK = 'data-noto-emoji-only';

  test('are marked, and their text nodes are left alone', async () => {
    const page = await browser.open({
      body: `<p id="one" style="font:40px Arial">${E.grin}</p><p id="some" style="font:40px Arial"> ${E.grin} ${E.family}\n ${E.keycapOne} </p>`
        + `<p id="mixed" style="font:40px Arial">${E.grin} and text</p><button id="button">${E.thumbsUpMedium}</button>`
        + '<script>window.first = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element.firstChild]));</script>'
    });

    const result = await page.evaluate(async (mark) => {
      await __t.settle();
      await __t.fontsReady();
      const width = (node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return Math.round(range.getBoundingClientRect().width * 10) / 10;
      };
      const out = {};
      for (const id of ['one', 'some', 'mixed', 'button']) {
        const element = document.getElementById(id);
        out[id] = {
          marked: element.hasAttribute(mark),
          wrappers: element.querySelectorAll('.noto-emoji-wrapped').length,
          nodes: element.childNodes.length,
          sameNode: element.firstChild === window.first[id] && element.firstChild.data !== '',
          font: getComputedStyle(element).fontFamily.split(',')[0].replace(/["']/g, '').trim().replace(/(Mac|Windows)$/, '')
        };
      }
      // The same emoji is as wide in a marked element as in a wrapper.
      out.widths = [width(document.getElementById('one')), width(document.querySelector('#mixed .noto-emoji-wrapped'))];
      // The system's emoji font would draw it narrower or wider than Noto does.
      out.loaded = [...document.fonts].filter((face) => face.status === 'loaded').length;
      return out;
    }, MARK);

    const marked = { marked: true, wrappers: 0, nodes: 1, sameNode: true, font: 'EmojiOverrideNotoOnly' };
    assert.deepEqual(result.one, marked);
    assert.deepEqual(result.some, marked);
    assert.deepEqual(result.button, marked);
    assert.deepEqual(result.mixed, { marked: false, wrappers: 1, nodes: 4, sameNode: false, font: 'Arial' });
    assert.equal(result.widths[0], result.widths[1]);
    assert.equal(result.loaded, 2);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('take the measures of their line from the system font, not from the emoji font', async () => {
    const page = await browser.open({
      head: '<style>p{margin:0;font:40px system-ui} .tall{line-height:2}</style>',
      body: `<p id="held">${E.grin}</p><p id="text">x</p><p id="heldTall" class="tall">${E.grin}</p><p id="wrappedTall" class="tall">x${E.grin}</p>`
    });

    const result = await page.evaluate(async () => {
      await __t.settle();
      await __t.fontsReady();
      const height = (id) => document.getElementById(id).getBoundingClientRect().height;
      return {
        marked: __t.held().map((element) => element.id),
        heights: [height('held'), height('text'), height('heldTall'), height('wrappedTall')]
      };
    });

    assert.deepEqual(result.marked, ['held', 'heldTall']);
    const [held, text, heldTall, wrappedTall] = result.heights;
    assert.ok(Math.abs(held - text) <= 3, `a line of emoji is ${held}px high, a line of text ${text}px`);
    assert.equal(heldTall, wrappedTall);
    await page.close();
  });

  test('lose the mark when they come to hold something else, and get it back', async () => {
    const page = await browser.open({ body: `<p id="a" style="font:20px Georgia">${E.grin}</p>` });

    const result = await page.evaluate(async ([mark, party]) => {
      await __t.settle();
      const a = document.getElementById('a');
      const node = a.firstChild;
      const look = () => ({
        marked: a.hasAttribute(mark),
        wrappers: a.querySelectorAll('.noto-emoji-wrapped').length,
        font: getComputedStyle(a).fontFamily.split(',')[0].replace(/["']/g, '').trim().replace(/(Mac|Windows)$/, ''),
        text: a.textContent
      });
      const out = { atFirst: look() };

      node.data = 'Loading';
      await __t.sleep(0);
      out.plainText = look();

      node.data = party;
      await __t.sleep(600);
      await __t.settle();
      out.emojiAgain = { ...look(), sameNode: a.firstChild === node && a.childNodes.length === 1 };

      // Another emoji in a marked element needs no work at all.
      node.data = party + party;
      await __t.sleep(0);
      out.moreEmoji = look();

      a.append(' and text');
      await __t.settle();
      out.withText = look();

      a.textContent = party;
      await __t.settle();
      out.replaced = look();

      a.appendChild(document.createElement('b')).textContent = 'bold';
      await __t.settle();
      out.withElement = look();
      return out;
    }, [MARK, E.party]);

    const marked = (text) => ({ marked: true, wrappers: 0, font: 'EmojiOverrideNotoOnly', text });
    assert.deepEqual(result.atFirst, marked(E.grin));
    assert.deepEqual(result.plainText, { marked: false, wrappers: 0, font: 'Georgia', text: 'Loading' });
    assert.deepEqual(result.emojiAgain, { ...marked(E.party), sameNode: true });
    assert.deepEqual(result.moreEmoji, marked(E.party + E.party));
    assert.deepEqual(result.withText, { marked: false, wrappers: 2, font: 'Georgia', text: `${E.party}${E.party} and text` });
    assert.deepEqual(result.replaced, marked(E.party));
    assert.deepEqual(result.withElement, { marked: false, wrappers: 1, font: 'Georgia', text: `${E.party}bold` });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('are wrapped instead where their font draws something else as well, or the stylesheet does not reach', async () => {
    const page = await browser.open({
      head: '<style>.new::before{content:"New "} .end::after{content:" (1)"}</style>',
      body: `<ol><li id="item">${E.grin}</li></ol><p id="before" class="new">${E.grin}</p><p id="after" class="end">${E.grin}</p>`
        + `<div id="host"></div><p id="plain">${E.grin}</p>`
        + `<script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<p>${E.grin}</p>';</script>`
    });

    const result = await page.evaluate(async (mark) => {
      await __t.settle();
      const root = document.getElementById('host').shadowRoot;
      const state = (element) => [element.hasAttribute(mark), element.querySelectorAll('.noto-emoji-wrapped').length];
      return {
        item: state(document.getElementById('item')),
        before: state(document.getElementById('before')),
        after: state(document.getElementById('after')),
        shadow: state(root.querySelector('p')),
        plain: state(document.getElementById('plain'))
      };
    }, MARK);

    assert.deepEqual(result, { item: [false, 1], before: [false, 1], after: [false, 1], shadow: [false, 1], plain: [true, 0] });
    await page.close();
  });

  test('switching off takes the marks off, and no node is added, removed or written to either way', async () => {
    const COUNT = 4000;
    const page = await browser.open({
      body: `<div id="grid"></div><script>
  document.getElementById('grid').innerHTML = '<div class="cell">${E.grin}</div>'.repeat(${COUNT});
  window.changes = { nodes: 0, texts: 0, marks: 0 };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') window.changes.nodes += 1;
      else if (record.type === 'characterData') window.changes.texts += 1;
      else window.changes.marks += 1;
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
</script>`
    });

    const result = await page.evaluate(async (mark) => {
      const settled = async () => {
        await __t.sleep(100);
        await __t.settle();
        await __t.settle();
      };
      const look = () => ({
        marker: __t.marker(),
        marked: document.querySelectorAll(`[${mark}]`).length,
        wrappers: __t.wrapped().length,
        ...window.changes
      });
      const out = {};
      await settled();
      out.on = look();
      await chrome.storage.sync.set({ enabled: false });
      await settled();
      out.off = look();
      await chrome.storage.sync.set({ enabled: true });
      await settled();
      out.onAgain = look();
      return out;
    }, MARK);

    assert.deepEqual(result.on, { marker: true, marked: COUNT, wrappers: 0, nodes: 0, texts: 0, marks: COUNT });
    assert.deepEqual(result.off, { marker: false, marked: 0, wrappers: 0, nodes: 0, texts: 0, marks: 2 * COUNT });
    assert.deepEqual(result.onAgain, { marker: true, marked: COUNT, wrappers: 0, nodes: 0, texts: 0, marks: 3 * COUNT });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('a page that takes the mark off gets it back twice, and wrappers after that', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>` });

    const result = await page.evaluate(async (mark) => {
      await __t.settle();
      const a = document.getElementById('a');
      const seen = [];
      for (let round = 0; round < 3; round += 1) {
        a.removeAttribute(mark);
        await __t.settle();
        seen.push([a.hasAttribute(mark), a.querySelectorAll('.noto-emoji-wrapped').length]);
      }
      return { seen, text: a.textContent };
    }, MARK);

    assert.deepEqual(result, { seen: [[true, 0], [true, 0], [false, 1]], text: E.grin });
    await page.close();
  });

  test('a copy, or an element that was changed while out of the document, is looked at when it arrives', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p><p id="b">${E.party}</p><div id="target"></div>` });

    const result = await page.evaluate(async (mark) => {
      await __t.settle();
      const target = document.getElementById('target');
      const state = (element) => [element.hasAttribute(mark), element.querySelectorAll('.noto-emoji-wrapped').length, element.textContent];

      const same = document.getElementById('a').cloneNode(true);
      same.id = 'same';
      const changed = document.getElementById('a').cloneNode(true);
      changed.id = 'changed';
      changed.firstChild.data = 'Not an emoji';
      target.append(same, changed);

      const b = document.getElementById('b');
      b.remove();
      b.firstChild.data = 'Text now';
      await __t.sleep(20);
      target.append(b);

      await __t.settle();
      const out = { same: state(same), changed: state(changed), moved: state(b) };

      // A copy that is taken on is followed like any other marked element.
      same.firstChild.data = 'Later';
      await __t.sleep(0);
      out.sameLater = state(same);
      return out;
    }, MARK);

    assert.deepEqual(result, {
      same: [true, 0, E.grin],
      changed: [false, 0, 'Not an emoji'],
      moved: [false, 0, 'Text now'],
      sameLater: [false, 0, 'Later']
    });
    await page.close();
  });

  test('an element that becomes editable loses its mark', async () => {
    const page = await browser.open({ body: `<div id="box"><p id="a">${E.grin}</p></div>` });

    const result = await page.evaluate(async (mark) => {
      await __t.settle();
      const a = document.getElementById('a');
      const before = a.hasAttribute(mark);
      document.getElementById('box').contentEditable = 'true';
      await __t.settle();
      const editable = a.hasAttribute(mark);
      document.getElementById('box').contentEditable = 'false';
      await __t.settle();
      return { before, editable, after: a.hasAttribute(mark) };
    }, MARK);

    assert.deepEqual(result, { before: true, editable: false, after: true });
    await page.close();
  });
});
