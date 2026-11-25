import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';
import { extensionDir } from './support/server.mjs';

// The real thing: the unpacked extension installed in a throwaway profile, its content scripts
// in their isolated world, real chrome.storage and the font loaded from the extension URL.
describe('the installed extension', skipWithoutChrome, () => {
  const browser = useBrowser();
  let extensionId;

  before(async () => {
    if (browser.chrome) extensionId = await browser.chrome.loadExtension(extensionDir);
  });

  const PROTECTED = 'pre .noto-emoji-wrapped, code .noto-emoji-wrapped, kbd .noto-emoji-wrapped, samp .noto-emoji-wrapped, '
    + '[contenteditable="true"] .noto-emoji-wrapped, .monaco-editor .noto-emoji-wrapped, .ace_editor .noto-emoji-wrapped';

  test('processes the manual test page and follows its settings', { timeout: 60000 }, async () => {
    const page = await browser.open({ url: browser.server.manualUrl, stub: false });
    const inExtension = (fn, arg) => page.evaluate(fn, arg, { contextId: page.extensionContextId() });
    const marker = async () => {
      await page.evaluate(() => __t.sleep(400));
      return page.evaluate(() => __t.marker());
    };

    const initial = await page.evaluate(async (protectedSelector) => {
      await __t.sleep(600);
      await __t.settle();
      await __t.fontsReady();
      const spans = __t.wrapped();
      return {
        marker: __t.marker(),
        wrapped: spans.length,
        inProtectedPlaces: document.querySelectorAll(protectedSelector).length,
        withoutHtmlParent: spans.filter((span) => span.parentNode.namespaceURI !== 'http://www.w3.org/1999/xhtml').length,
        font: getComputedStyle(spans[0]).fontFamily,
        fontStatus: [...document.fonts].filter((face) => face.family.includes('EmojiOverrideNoto')).map((face) => face.status),
        pageSeesSharedState: typeof window.__notoEmojiOverride
      };
    }, PROTECTED);

    assert.equal(initial.marker, true);
    assert.ok(initial.wrapped > 100, `only ${initial.wrapped} emoji were wrapped`);
    assert.equal(initial.inProtectedPlaces, 0);
    assert.equal(initial.withoutHtmlParent, 0);
    assert.match(initial.font, /^"?EmojiOverrideNoto/);
    assert.deepEqual(initial.fontStatus, ['loaded'], 'the font loads from the extension URL');
    assert.equal(initial.pageSeesSharedState, 'undefined', 'the state object lives in the isolated world only');

    const isolated = await inExtension(() => ({
      active: globalThis.__notoEmojiOverride.state.active,
      modules: Object.keys(globalThis.__notoEmojiOverride).sort(),
      host: location.hostname
    }));
    assert.deepEqual(isolated, { active: true, modules: ['emoji', 'habits', 'settings', 'state'], host: '127.0.0.1' });

    await inExtension(() => chrome.storage.sync.set({ enabled: false }));
    assert.equal(await marker(), false, 'global switch off');
    await inExtension(() => chrome.storage.sync.set({ enabled: true }));
    assert.equal(await marker(), true, 'global switch on');

    await inExtension(() => chrome.storage.local.set({ blockedHosts: [location.hostname] }));
    assert.equal(await marker(), false, 'host blocked');
    await inExtension(() => chrome.storage.local.set({ blockedHosts: [] }));
    assert.equal(await marker(), true, 'host allowed');

    const afterStrip = await page.evaluate(async () => {
      document.getElementById('strip-root-attributes').click();
      await __t.sleep(200);
      document.getElementById('add-emoji').click();
      await __t.settle();
      return { marker: __t.marker(), added: __t.count('#dynamic-target') };
    });
    assert.deepEqual(afterStrip, { marker: true, added: 1 });

    const afterReplace = await page.evaluate(async () => {
      const titleBefore = document.title;
      document.getElementById('replace-body').click();
      await __t.settle();
      return {
        heading: document.querySelector('h1').textContent.startsWith('Replaced body'),
        wrapped: __t.wrapped().length,
        titleKept: document.title === titleBefore
      };
    });
    assert.deepEqual(afterReplace, { heading: true, wrapped: 6, titleKept: true });

    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('reaches closed shadow roots, and keeps up with a script that holds its text node', async () => {
    const page = await browser.open({
      stub: false,
      extension: false,
      body: `<x-widget id="widget"></x-widget><p id="owned"><b>a</b>first ${E.grin}<i>z</i></p>
<script>
  window.closedRoot = document.getElementById('widget').attachShadow({ mode: 'closed' });
  window.closedRoot.innerHTML = '<p>closed ${E.party}</p>';
  window.ownNode = document.getElementById('owned').childNodes[1];
</script>`
    });

    const result = await page.evaluate(async (emoji) => {
      await __t.sleep(600);
      await __t.settle();
      const owned = document.getElementById('owned');
      const first = { closed: __t.count(window.closedRoot), owned: __t.count(owned), anchorKept: owned.childNodes[1] === window.ownNode };

      window.ownNode.nodeValue = `second ${emoji} time`;
      await __t.sleep(0);
      const written = { text: owned.textContent, wrapped: __t.count(owned) };

      owned.removeChild(window.ownNode);
      await __t.sleep(0);
      return { first, written, removed: owned.textContent };
    }, E.rocket);

    assert.deepEqual(result, {
      first: { closed: 1, owned: 1, anchorKept: true },
      written: { text: `asecond ${E.rocket} timez`, wrapped: 1 },
      removed: 'az'
    });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the popup reads and writes the real storage', async () => {
    const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
    const page = await browser.open({ url: popupUrl, stub: false });

    const state = await page.evaluate(async () => {
      await __t.sleep(300);
      const toggle = document.getElementById('toggleBtn');
      return {
        heading: document.getElementById('popupHeading').textContent,
        togglePressed: toggle.getAttribute('aria-pressed'),
        toggleLabelled: toggle.textContent.trim().length > 0,
        // Opened as a tab, the "active tab" is the popup itself, which is not a web page.
        siteDisabled: document.getElementById('siteBtn').disabled
      };
    });

    assert.deepEqual(state, { heading: 'Noto Emoji Override', togglePressed: 'true', toggleLabelled: true, siteDisabled: true });

    const press = () => page.evaluate(async () => {
      const toggle = document.getElementById('toggleBtn');
      toggle.click();
      await __t.sleep(300);
      return {
        stored: (await chrome.storage.sync.get('enabled')).enabled,
        pressed: toggle.getAttribute('aria-pressed'),
        busy: toggle.disabled,
        error: document.getElementById('error').textContent
      };
    });
    assert.deepEqual(await press(), { stored: false, pressed: 'false', busy: false, error: '' });
    assert.deepEqual(await press(), { stored: true, pressed: 'true', busy: false, error: '' });

    // A block list that an old version left in sync storage moves to local storage when the
    // popup opens.
    await page.evaluate(async () => {
      await chrome.storage.local.remove('blockedHosts');
      await chrome.storage.sync.set({ blockedHosts: ['Old.example'] });
    });
    await page.goto(popupUrl);
    const moved = await page.evaluate(async () => {
      await __t.sleep(300);
      return { sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get(null) };
    });
    assert.deepEqual(moved, { sync: { enabled: true }, local: { blockedHosts: ['old.example'] } });

    assert.deepEqual(page.errors, []);
    await page.close();
  });
});
