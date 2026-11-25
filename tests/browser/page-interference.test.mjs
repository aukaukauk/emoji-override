import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// Things pages do to the document that used to switch the extension off, hang it or make it throw.
describe('pages that rework the document', skipWithoutChrome, () => {
  const browser = useBrowser();

  test('rewriting <html> attributes does not switch replacement off', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>` });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const root = document.documentElement;
      const add = async (id) => {
        document.body.insertAdjacentHTML('beforeend', `<p id="${id}">${emoji}</p>`);
        await __t.settle();
        return __t.count('#' + id);
      };
      const out = {};

      root.className = 'theme-dark';
      out.afterClassOverwrite = [__t.marker(), await add('b')];

      root.removeAttribute('data-noto-emoji-enabled');
      await __t.sleep(0);
      out.afterMarkerRemoved = [__t.marker(), await add('c')];

      // What a client-side router does when it swaps the root attributes for the next page's.
      for (const { name } of [...root.attributes]) root.removeAttribute(name);
      root.setAttribute('lang', 'fr');
      await __t.sleep(0);
      out.afterAttributeSwap = [__t.marker(), await add('d')];
      return out;
    }, E.party);

    assert.deepEqual(result, {
      afterClassOverwrite: [true, 1],
      afterMarkerRemoved: [true, 1],
      afterAttributeSwap: [true, 1]
    });
    await page.close();
  });

  test('a page that removes the marker every time is left alone instead of looping', { timeout: 20000 }, async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>` });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const root = document.documentElement;
      let removals = 0;
      const fight = new MutationObserver(() => {
        if (root.hasAttribute('data-noto-emoji-enabled')) {
          removals += 1;
          root.removeAttribute('data-noto-emoji-enabled');
        }
      });
      fight.observe(root, { attributes: true });
      root.removeAttribute('data-noto-emoji-enabled');
      await __t.sleep(100);
      const during = { marker: __t.marker(), active: __t.active(), removals };

      fight.disconnect();
      document.body.insertAdjacentHTML('beforeend', `<p id="b">${emoji}</p>`);
      // Any settings change is a fresh start.
      await chrome.storage.local.set({ blockedHosts: ['other.example'] });
      await __t.settle();
      return { during, after: { marker: __t.marker(), active: __t.active(), wrapped: __t.count('#b') } };
    }, E.party);

    assert.equal(result.during.marker, false);
    assert.equal(result.during.active, false);
    assert.ok(result.during.removals > 0 && result.during.removals <= 25, `stopped after ${result.during.removals} rounds`);
    assert.deepEqual(result.after, { marker: true, active: true, wrapped: 1 });
    await page.close();
  });

  test('a replaced <body> is processed, and so is what is added to it', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>` });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const body = document.createElement('body');
      body.innerHTML = `<p id="next">next page ${emoji}</p>`;
      document.body.replaceWith(body);
      await __t.settle();
      const next = __t.count('#next');
      document.body.insertAdjacentHTML('beforeend', `<p id="later">later ${emoji}</p>`);
      await __t.settle();
      return { next, later: __t.count('#later'), marker: __t.marker() };
    }, E.party);

    assert.deepEqual(result, { next: 1, later: 1, marker: true });
    await page.close();
  });

  test('a replaced root element gets the marker and is processed', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>` });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const html = document.createElement('html');
      html.innerHTML = `<head><title>Swapped ${emoji}</title></head><body><p id="next">new root ${emoji}</p></body>`;
      document.replaceChild(html, document.documentElement);
      await __t.settle();
      return { marker: __t.marker(), next: __t.count('#next'), title: document.title, spansInHead: __t.count(document.head) };
    }, E.party);

    assert.deepEqual(result, { marker: true, next: 1, title: `Swapped ${E.party}`, spansInHead: 0 });
    await page.close();
  });

  test('a document rewritten with document.open() and write() is processed', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>` });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      document.open();
      document.write(`<!doctype html><html><head><title>Rewritten</title></head><body><p id="written">written ${emoji}</p></body></html>`);
      document.close();
      await __t.settle();
      const written = __t.count('#written');
      document.body.insertAdjacentHTML('beforeend', `<p id="later">later ${emoji}</p>`);
      await __t.settle();
      return { marker: __t.marker(), written, later: __t.count('#later') };
    }, E.party);

    assert.deepEqual(result, { marker: true, written: 1, later: 1 });
    await page.close();
  });

  test('replacement starts once a <body> appears, even if it was switched on without one', async () => {
    const page = await browser.open({ body: `<p id="a">${E.grin}</p>`, stub: { storage: { sync: { enabled: false } } } });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      document.body.remove();
      await chrome.storage.sync.set({ enabled: true });
      await __t.sleep(50);
      const body = document.createElement('body');
      body.innerHTML = `<p id="next">new body ${emoji}</p>`;
      document.documentElement.appendChild(body);
      // The content script looks for a body again once a second.
      await __t.sleep(1300);
      await __t.settle();
      return { marker: __t.marker(), next: __t.count('#next') };
    }, E.party);

    assert.deepEqual(result, { marker: true, next: 1 });
    await page.close();
  });

  test('named forms and form controls that shadow DOM members neither hang nor throw', { timeout: 20000 }, async () => {
    const members = ['closest', 'matches', 'classList', 'parentNode', 'nodeType', 'isConnected', 'localName',
      'getRootNode', 'querySelectorAll', 'shadowRoot', 'host', 'style', 'tagName', 'replaceChild'];
    const page = await browser.open({
      // A form named "host" makes document.host that form.
      body: `<form name="host" id="named"><label>Host ${E.rocket} <input name="x"></label></form>`
        + members.map((name) => `<form data-member="${name}">direct ${E.grin} <b>nested ${E.thumbsUp}</b><input name="${name}"></form>`).join('')
        + `<pre><form id="inPre"><span>in pre ${E.grin}</span><input name="parentNode"></form></pre><p id="after">after ${E.party}</p>`
    });

    const result = await page.evaluate(async () => {
      await __t.settle();
      // The forms shadow their own members, so the test must not trust them either.
      const count = (element) => Element.prototype.querySelectorAll.call(element, '.noto-emoji-wrapped').length;
      const get = (element, name) => Element.prototype.getAttribute.call(element, name);
      const forms = [...document.querySelectorAll('form[data-member]')];
      return {
        named: count(document.getElementById('named')),
        untouchedForms: forms.filter((form) => count(form) === 0).map((form) => get(form, 'data-member')),
        inPre: count(document.getElementById('inPre')),
        after: count(document.getElementById('after'))
      };
    });

    assert.deepEqual(result, { named: 1, untouchedForms: [], inPre: 0, after: 1 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('such forms are followed out of the document and back like any other element', { timeout: 20000 }, async () => {
    const members = ['isConnected', 'querySelector', 'querySelectorAll', 'getRootNode', 'contains', 'parentNode', 'nodeType', 'firstChild'];
    const page = await browser.open({
      body: members.map((name) => `<form data-member="${name}"><b>[</b>before ${E.grin}<i>]</i><input name="${name}"></form>`).join('')
    });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const text = (form) => Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').get.call(form);
      const count = (form) => Element.prototype.querySelectorAll.call(form, '.noto-emoji-wrapped').length;
      const seen = {};

      for (const form of [...document.querySelectorAll('form[data-member]')]) {
        const own = Object.getOwnPropertyDescriptor(Node.prototype, 'childNodes').get.call(form)[1];
        Element.prototype.remove.call(form);
        await __t.sleep(20);
        own.data = 'after';
        await __t.sleep(20);
        document.body.appendChild(form);
        await __t.settle();
        const back = `${text(form)} /${count(form)}`;

        own.data = `again ${emoji}`;
        await __t.settle();
        seen[Element.prototype.getAttribute.call(form, 'data-member')] = `${back}, then ${text(form)} /${count(form)}`;
      }
      return seen;
    }, E.rocket);

    assert.deepEqual(result, Object.fromEntries(members.map((name) => [name, `[after] /0, then [again ${E.rocket}] /1`])));
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});
