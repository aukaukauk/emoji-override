import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// Nothing tells a script that an element has been given a shadow root, so roots that appear
// after their host was looked at have to be searched for.
describe('shadow roots that arrive late', skipWithoutChrome, () => {
  const browser = useBrowser();

  test('a custom element that gets its shadow root later is found', async () => {
    const page = await browser.open({ body: '<x-card id="card">light</x-card><x-card id="never"></x-card>' });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const card = document.getElementById('card');

      await __t.sleep(400);
      const root = card.attachShadow({ mode: 'open' });
      root.innerHTML = `<p>inside ${emoji}</p><x-inner></x-inner>`;
      const inner = root.querySelector('x-inner');

      // Looked at again after 250, 500 and 1000 ms: found at the latest 600 ms from now.
      await __t.sleep(800);
      await __t.settle();
      const found = __t.count(root);

      inner.attachShadow({ mode: 'open' }).innerHTML = `<b>nested ${emoji}</b>`;
      await __t.sleep(1200);
      await __t.settle();
      root.querySelector('p').insertAdjacentText('beforeend', ` more ${emoji}`);
      await __t.settle();

      return { found, nested: __t.count(inner.shadowRoot), observed: __t.count(root) };
    }, E.grin);

    assert.deepEqual(result, { found: 1, nested: 1, observed: 2 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('an ordinary element that gets a shadow root while the page loads is found after loading', async () => {
    const page = await browser.open({
      body: `<div id="host"></div><img src="/delay/900" alt="">
<script>
  // By now the walk has passed the element, and the page is still loading.
  setTimeout(() => {
    window.attachedWhile = document.readyState;
    document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<p>late ${E.grin}</p>';
  }, 450);
</script>`
    });

    const result = await page.evaluate(async () => {
      const root = document.getElementById('host').shadowRoot;
      const atLoad = __t.count(root);
      await __t.sleep(1300);
      await __t.settle();
      return { attachedWhile: window.attachedWhile, atLoad, afterLoad: __t.count(root) };
    });

    assert.deepEqual(result, { attachedWhile: 'interactive', atLoad: 0, afterLoad: 1 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('text in shadow roots is handed back when the extension is switched off', async () => {
    const page = await browser.open({
      body: `<div id="host"></div><script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<p>shadow ${E.grin} text</p>';</script>`
    });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const paragraph = document.getElementById('host').shadowRoot.querySelector('p');
      const on = { wrapped: __t.count(paragraph), nodes: paragraph.childNodes.length };

      await chrome.storage.sync.set({ enabled: false });
      await __t.settle();
      return { on, off: { wrapped: __t.count(paragraph), nodes: paragraph.childNodes.length, text: paragraph.textContent } };
    });

    assert.deepEqual(result, {
      on: { wrapped: 1, nodes: 5 },
      off: { wrapped: 0, nodes: 1, text: `shadow ${E.grin} text` }
    });
    await page.close();
  });
});
