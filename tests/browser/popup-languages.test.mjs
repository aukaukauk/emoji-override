import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skipWithoutChrome, useBrowser } from './support/harness.mjs';
import { extensionDir } from './support/server.mjs';

const localesDir = join(extensionDir, '_locales');
const locales = readdirSync(localesDir).sort();
const read = (locale) => JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8'));

const RIGHT_TO_LEFT = ['ar', 'fa', 'he', 'ur'];
// Chrome shows this much of a popup's height and scrolls the rest.
const TALLEST_POPUP = 600;
// Long enough to take two lines, as many real hosts do.
const HOST = 'subdomain.long-example-hostname.example.com';

// Runs in the popup: what it shows, and whether every text has the room it needs. The numbers
// depend on the fonts of the machine, so the limits below are generous rather than exact.
const look = async (errorText) => {
  await __t.sleep(80);
  const shell = document.querySelector('.popup-shell');
  const bounds = shell.getBoundingClientRect();
  const byId = (id) => document.getElementById(id);
  const text = (id) => byId(id).textContent;

  const outside = [];
  const cut = [];
  for (const element of shell.querySelectorAll('*')) {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const name = element.id || element.className || element.localName;
    if (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5) outside.push(name);
    if (getComputedStyle(element).display !== 'inline' && element.scrollWidth > element.clientWidth + 1) cut.push(name);
  }

  // A label is broken inside a word when its button is narrower than its longest word.
  const brokenWords = [];
  for (const button of shell.querySelectorAll('button')) {
    const width = button.getBoundingClientRect().width;
    const before = button.getAttribute('style');
    button.style.cssText = 'max-width: none; width: min-content; overflow-wrap: normal;';
    if (button.getBoundingClientRect().width > width + 0.5) brokenWords.push(button.textContent);
    if (before === null) button.removeAttribute('style');
    else button.setAttribute('style', before);
  }

  const heading = byId('popupHeading');
  const status = byId('status');
  const lines = (element) => Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight));

  // The tallest the popup gets in this state: with the longer of its two error messages.
  const error = byId('error');
  const shown = [error.textContent, error.classList.contains('visible')];
  error.textContent = errorText;
  error.classList.add('visible');
  const height = Math.round(shell.getBoundingClientRect().height);
  error.textContent = shown[0];
  error.classList.toggle('visible', shown[1]);

  return {
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    // In a language written from right to left the badge is to the left of the name.
    badgeOnTheLeft: status.getBoundingClientRect().left < heading.getBoundingClientRect().left,
    nameLines: lines(heading),
    outside,
    cut,
    brokenWords,
    height,
    texts: {
      title: document.title,
      eyebrow: text('popupEyebrow'),
      heading: text('popupHeading'),
      subtitle: text('popupSubtitle'),
      globalTitle: text('globalTitle'),
      globalDescription: text('globalDescription'),
      siteTitle: text('siteTitle'),
      siteDescription: text('siteDescription'),
      status: text('status'),
      toggle: text('toggleBtn'),
      host: text('hostName'),
      site: text('siteBtn'),
      siteState: text('siteState'),
      hint: byId('siteHint').classList.contains('visible') ? text('siteHint') : ''
    }
  };
};

const click = async (id) => {
  document.getElementById(id).click();
  // The buttons are disabled until the change has been saved.
  await __t.sleep(40);
};

// Each language's own texts, in the popup's three states, which between them show every text
// but the two error messages.
describe('popup in every language', skipWithoutChrome, () => {
  const browser = useBrowser();

  const open = (messages, url) => browser.open({
    url: `${browser.server.origin}/extension/popup/popup.html`,
    stub: { tab: { id: 1, url }, messages }
  });

  for (const locale of locales) {
    test(`${locale}: shows its texts, each with the room it needs`, async () => {
      const messages = read(locale);
      const label = (key) => messages[key].message;
      const longerError = [label('errorLoad'), label('errorSave')].sort((a, b) => b.length - a.length)[0];
      const rightToLeft = RIGHT_TO_LEFT.includes(locale);
      const fixed = {
        title: label('popupTitle'),
        eyebrow: label('popupEyebrow'),
        heading: label('popupHeading'),
        subtitle: label('popupSubtitle'),
        globalTitle: label('globalTitle'),
        globalDescription: label('globalDescription'),
        siteTitle: label('siteTitle'),
        siteDescription: label('siteDescription')
      };
      const fits = { nameLines: 1, outside: [], cut: [], brokenWords: [] };
      const layout = (seen) => ({
        lang: seen.lang, dir: seen.dir, badgeOnTheLeft: seen.badgeOnTheLeft,
        nameLines: seen.nameLines, outside: seen.outside, cut: seen.cut, brokenWords: seen.brokenWords
      });

      const onSite = await open(messages, `https://${HOST}/page`);
      const on = await onSite.evaluate(look, longerError);
      await onSite.evaluate(click, 'toggleBtn');
      await onSite.evaluate(click, 'siteBtn');
      const off = await onSite.evaluate(look, longerError);
      assert.deepEqual(onSite.errors, []);
      await onSite.close();

      const elsewhere = await open(messages, 'chrome://extensions/');
      const other = await elsewhere.evaluate(look, longerError);
      assert.deepEqual(elsewhere.errors, []);
      await elsewhere.close();

      assert.deepEqual(on.texts, {
        ...fixed, status: label('statusEnabled'), toggle: label('disableButton'), host: HOST,
        site: label('blockSiteButton'), siteState: label('siteActive'), hint: ''
      });
      assert.deepEqual(off.texts, {
        ...fixed, status: label('statusDisabled'), toggle: label('enableButton'), host: HOST,
        site: label('unblockSiteButton'), siteState: label('siteGloballyDisabledAndBlocked'), hint: ''
      });
      assert.deepEqual(other.texts, {
        ...fixed, status: label('statusEnabled'), toggle: label('disableButton'), host: label('hostUnavailable'),
        site: label('siteButtonUnavailable'), siteState: label('siteUnavailable'), hint: label('siteHint')
      });

      for (const [state, seen] of Object.entries({ on, off, other })) {
        assert.deepEqual(
          layout(seen),
          { lang: locale.replace('_', '-'), dir: rightToLeft ? 'rtl' : 'ltr', badgeOnTheLeft: rightToLeft, ...fits },
          `state "${state}"`
        );
        assert.ok(seen.height <= TALLEST_POPUP, `state "${state}": the popup is ${seen.height}px tall`);
      }
    });
  }

  // What a translation or a font may yet bring: texts twice as long as the English ones, each
  // with a word that no line has room for.
  test('texts that are much longer, with words longer than a line, stay inside the popup', async () => {
    const english = read('en');
    const names = ['uiLanguage', 'appName', 'shortName', 'actionTitle', 'popupTitle', 'popupHeading'];
    const messages = Object.fromEntries(Object.entries(english).map(([key, entry]) => [key, {
      message: names.includes(key) ? entry.message : `${entry.message} ${'W'.repeat(40)} ${entry.message}`
    }]));

    for (const url of [`https://${HOST}/page`, 'chrome://extensions/']) {
      const page = await open(messages, url);
      const seen = await page.evaluate(look, messages.errorLoad.message);
      assert.deepEqual({ nameLines: seen.nameLines, outside: seen.outside, cut: seen.cut }, { nameLines: 1, outside: [], cut: [] }, url);
      await page.close();
    }
  });
});
