import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skipWithoutChrome, useBrowser } from './support/harness.mjs';
import { extensionDir } from './support/server.mjs';

const messages = JSON.parse(readFileSync(join(extensionDir, '_locales/en/messages.json'), 'utf8'));
const label = (key) => messages[key].message;

// The popup document runs as a normal page here, with chrome.storage, chrome.tabs and
// chrome.i18n replaced by the stand-in.
describe('popup', skipWithoutChrome, () => {
  const browser = useBrowser();

  const open = (stub = {}) => browser.open({
    url: `${browser.server.origin}/extension/popup/popup.html`,
    stub: { tab: { id: 1, url: 'https://example.com/some/page' }, messages, ...stub }
  });

  const snapshot = async () => {
    await __t.sleep(80);
    const text = (id) => document.getElementById(id).textContent;
    const site = document.getElementById('siteBtn');
    const error = document.getElementById('error');
    return {
      host: text('hostName'),
      status: text('status'),
      toggle: text('toggleBtn'),
      site: site.textContent,
      siteDisabled: site.disabled,
      siteState: text('siteState'),
      hint: document.getElementById('siteHint').classList.contains('visible'),
      error: error.classList.contains('visible') ? error.textContent : '',
      store: JSON.parse(JSON.stringify(__chromeStub.store))
    };
  };
  const click = (id) => document.getElementById(id).click();

  test('shows the state for the active tab', async () => {
    const page = await open();
    const state = await page.evaluate(snapshot);

    assert.equal(state.host, 'example.com');
    assert.equal(state.status, label('statusEnabled'));
    assert.equal(state.toggle, label('disableButton'));
    assert.equal(state.site, label('blockSiteButton'));
    assert.equal(state.siteState, label('siteActive'));
    assert.deepEqual([state.siteDisabled, state.hint, state.error], [false, false, '']);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the global button switches replacement off and on', async () => {
    const page = await open();
    await page.evaluate(snapshot);

    await page.evaluate(click, 'toggleBtn');
    const off = await page.evaluate(snapshot);
    assert.equal(off.store.sync.enabled, false);
    assert.deepEqual([off.status, off.toggle, off.siteState], [label('statusDisabled'), label('enableButton'), label('siteGloballyDisabled')]);

    await page.evaluate(click, 'toggleBtn');
    const on = await page.evaluate(snapshot);
    assert.equal(on.store.sync.enabled, true);
    assert.deepEqual([on.status, on.toggle], [label('statusEnabled'), label('disableButton')]);
    await page.close();
  });

  test('the site button blocks and allows the exact host', async () => {
    const page = await open({ storage: { local: { blockedHosts: ['zzz.example'] } } });
    await page.evaluate(snapshot);

    await page.evaluate(click, 'siteBtn');
    const blocked = await page.evaluate(snapshot);
    assert.deepEqual(blocked.store.local.blockedHosts, ['example.com', 'zzz.example']);
    assert.deepEqual([blocked.site, blocked.siteState], [label('unblockSiteButton'), label('siteBlocked')]);

    await page.evaluate(click, 'siteBtn');
    const allowed = await page.evaluate(snapshot);
    assert.deepEqual(allowed.store.local.blockedHosts, ['zzz.example']);
    assert.deepEqual([allowed.site, allowed.siteState], [label('blockSiteButton'), label('siteActive')]);
    await page.close();
  });

  test('offers no site control on pages that are not http or https', async () => {
    const page = await open({ tab: { id: 1, url: 'chrome://extensions/' } });
    const state = await page.evaluate(snapshot);

    assert.equal(state.host, label('hostUnavailable'));
    assert.equal(state.site, label('siteButtonUnavailable'));
    assert.equal(state.siteState, label('siteUnavailable'));
    assert.deepEqual([state.siteDisabled, state.hint], [true, true]);
    await page.close();
  });

  test('moves a block list from sync storage to local storage', async () => {
    const page = await open({ storage: { sync: { blockedHosts: ['b.example', 'Example.com ', 'a.example'] } } });
    const state = await page.evaluate(snapshot);

    assert.deepEqual(state.store.local.blockedHosts, ['a.example', 'b.example', 'example.com']);
    assert.equal(Object.hasOwn(state.store.sync, 'blockedHosts'), false);
    assert.equal(state.site, label('unblockSiteButton'), 'the moved list applies right away');
    await page.close();
  });

  test('reports a failed save and puts the switch back', async () => {
    const page = await open();
    await page.evaluate(snapshot);

    await page.evaluate(() => {
      __chromeStub.failing.write = true;
      document.getElementById('toggleBtn').click();
    });
    const state = await page.evaluate(snapshot);

    assert.equal(state.error, label('errorSave'));
    assert.deepEqual([state.status, state.toggle], [label('statusEnabled'), label('disableButton')]);
    assert.equal(Object.hasOwn(state.store.sync, 'enabled'), false);
    await page.close();
  });

  test('reports settings that cannot be read', async () => {
    const page = await browser.open({ url: `${browser.server.origin}/manual/index.html`, stub: { messages } });
    // Open the popup in the same tab with reads failing from the start.
    await page.addInitScript('window.__chromeStub.failing.read = true;');
    await page.goto(`${browser.server.origin}/extension/popup/popup.html`);
    const state = await page.evaluate(snapshot);

    assert.equal(state.error, label('errorLoad'));
    await page.close();
  });
});
