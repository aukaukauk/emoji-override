import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

describe('emoji replacement', skipWithoutChrome, () => {
  const browser = useBrowser();

  test('wraps emoji clusters and leaves text-style characters alone', async () => {
    const text = `Hello ${E.grin} world ${E.thumbsUpMedium} flag ${E.flagChina} key ${E.keycapOne} `
      + `family ${E.family} heart ${E.heart} | \u{00A9} \u{2122} \u{2665} \u{263A} | 123 #`;
    const page = await browser.open({ body: `<p id="a">${text}</p>` });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const paragraph = document.getElementById('a');
      const style = getComputedStyle(paragraph.querySelector('.noto-emoji-wrapped'));
      return {
        marker: __t.marker(),
        wrapped: __t.wrapped(paragraph).map((span) => span.textContent),
        text: paragraph.textContent,
        display: style.display,
        font: style.fontFamily
      };
    });

    assert.equal(result.marker, true);
    assert.deepEqual(result.wrapped, [E.grin, E.thumbsUpMedium, E.flagChina, E.keycapOne, E.family, E.heart]);
    assert.equal(result.text, text, 'the text content must not change');
    assert.equal(result.display, 'contents');
    assert.match(result.font, /^"?EmojiOverrideNoto/);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('processes content added later, in the page and in open shadow roots', async () => {
    const page = await browser.open({
      body: `<div id="host"></div><div id="closed"></div><p id="target"></p>
<script>
  document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<span>shadow ${E.grin}</span>';
  window.closedRoot = document.getElementById('closed').attachShadow({ mode: 'closed' });
  window.closedRoot.innerHTML = '<span>closed ${E.grin}</span>';
</script>`
    });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const root = document.getElementById('host').shadowRoot;
      const shadowAtFirst = __t.count(root);

      const element = document.createElement('span');
      element.textContent = `element ${emoji}`;
      document.getElementById('target').append(element, document.createTextNode(` text node ${emoji}`));
      const later = document.createElement('b');
      later.textContent = `later ${emoji}`;
      root.appendChild(later);
      await __t.settle();

      return { shadowAtFirst, target: __t.count('#target'), shadowLater: __t.count(root), closed: __t.count(window.closedRoot) };
    }, E.party);

    // Closed shadow roots are reached through an extension API, which a page script does not
    // have. The test with the installed extension covers them.
    assert.deepEqual(result, { shadowAtFirst: 1, target: 2, shadowLater: 2, closed: 0 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('follows the global switch without a reload, and hands the text back when off', async () => {
    const page = await browser.open({ body: `<p id="a">first ${E.grin} and ${E.rocket}!</p>` });

    const result = await page.evaluate(async (emoji) => {
      const paragraph = document.getElementById('a');
      const own = paragraph.firstChild;
      const text = paragraph.textContent;
      const look = () => ({
        marker: __t.marker(),
        active: __t.active(),
        wrapped: __t.count(paragraph),
        nodes: paragraph.childNodes.length,
        ownNodeFirst: paragraph.firstChild === own,
        ownNodeHoldsText: own.data === text,
        text: paragraph.textContent === text
      });

      await __t.settle();
      const on = look();
      const font = getComputedStyle(document.querySelector('.noto-emoji-wrapped')).fontFamily;

      await chrome.storage.sync.set({ enabled: false });
      await __t.settle();
      document.body.insertAdjacentHTML('beforeend', `<p id="off">added while off ${emoji}</p>`);
      await __t.settle();
      const off = { ...look(), addedWhileOff: __t.count('#off') };

      await chrome.storage.sync.set({ enabled: true });
      await __t.settle();
      return { font, on, off, back: { ...look(), addedWhileOff: __t.count('#off') } };
    }, E.party);

    const wrapped = { wrapped: 2, nodes: 7, ownNodeFirst: true, ownNodeHoldsText: false, text: true };
    assert.match(result.font, /EmojiOverrideNoto/);
    assert.deepEqual(result.on, { marker: true, active: true, ...wrapped });
    // Off means that the document is as the page made it: one text node, holding the text.
    assert.deepEqual(result.off, {
      marker: false, active: false, wrapped: 0, nodes: 1, ownNodeFirst: true, ownNodeHoldsText: true, text: true, addedWhileOff: 0
    });
    assert.deepEqual(result.back, { marker: true, active: true, ...wrapped, addedWhileOff: 1 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('stays off on a blocked host until it is allowed again', async () => {
    const page = await browser.open({
      body: `<p id="a">${E.grin}</p>`,
      stub: { storage: { local: { blockedHosts: ['127.0.0.1'] } } }
    });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const blocked = { marker: __t.marker(), wrapped: __t.count('#a') };
      await chrome.storage.local.set({ blockedHosts: ['other.example'] });
      await __t.settle();
      return { blocked, allowed: { marker: __t.marker(), wrapped: __t.count('#a') } };
    });

    assert.deepEqual(result.blocked, { marker: false, wrapped: 0 });
    assert.deepEqual(result.allowed, { marker: true, wrapped: 1 });
    await page.close();
  });

  test('honours a block list that an old version left in sync storage', async () => {
    const page = await browser.open({
      body: `<p id="a">${E.grin}</p>`,
      stub: { storage: { sync: { blockedHosts: ['127.0.0.1'] } } }
    });

    const result = await page.evaluate(async () => {
      await __t.settle();
      return { marker: __t.marker(), wrapped: __t.count('#a') };
    });

    assert.deepEqual(result, { marker: false, wrapped: 0 });
    await page.close();
  });

  test('starts even when the settings arrive after the page has loaded', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>`, stub: { delay: 300 } });

    const result = await page.evaluate(async () => {
      await __t.sleep(500);
      await __t.settle();
      return { marker: __t.marker(), wrapped: __t.count('#a') };
    });

    assert.deepEqual(result, { marker: true, wrapped: 1 });
    await page.close();
  });
});
