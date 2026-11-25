import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/_locales');
const read = (locale) => JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8'));
const locales = readdirSync(localesDir).sort();
const english = read('en');

// The locales of the Chrome Web Store, which shows the name and the description in them.
// https://developer.chrome.com/docs/extensions/reference/api/i18n#locales
const STORE = ['ar', 'am', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'en_AU', 'en_GB', 'en_US', 'es', 'es_419', 'et',
  'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nl', 'no',
  'pl', 'pt_BR', 'pt_PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh_CN', 'zh_TW'];
// The languages that Chrome's own interface comes in (the .lproj folders of Chrome 158 for
// macOS). Chrome takes the texts from the folder named after the language of its interface,
// whether the store knows that name or not. Three of them are not in the store's list:
// Afrikaans, Urdu, and Norwegian, which Chrome calls nb and the store calls no.
const CHROME = ['af', 'am', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en_GB', 'en_US', 'es', 'es_419', 'et', 'fa', 'fi',
  'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'ms', 'nb', 'nl', 'pl',
  'pt_BR', 'pt_PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 'zh_CN', 'zh_TW'];
// Both fall back from a regional variant to the language, so these need no folder of their
// own: their texts would be the English ones.
const COVERED_BY_ENGLISH = ['en_AU', 'en_GB', 'en_US'];

// The product's name is the same everywhere.
const NAMES = ['appName', 'shortName', 'actionTitle', 'popupTitle', 'popupHeading'];
const TRANSLATED = Object.keys(english).filter((key) => key !== 'uiLanguage' && !NAMES.includes(key));

// The zero-width non-joiner belongs to the spelling of these languages. Anywhere else an
// invisible character is an accident.
const USES_NON_JOINER = ['fa', 'kn', 'te'];
const INVISIBLE = /[\u{00AD}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{FEFF}]/gu;

describe('the translations', () => {
  test('exist for every locale of the Chrome Web Store and of Chrome, and for no other', () => {
    const wanted = [...new Set([...STORE, ...CHROME])].filter((locale) => !COVERED_BY_ENGLISH.includes(locale)).sort();
    assert.deepEqual(locales, wanted);
  });

  test('Norwegian reads the same under the name Chrome gives it and the one the store gives it', () => {
    const texts = (locale) => Object.fromEntries(Object.entries(read(locale)).filter(([key]) => key !== 'uiLanguage'));
    assert.deepEqual(texts('nb'), texts('no'));
  });

  for (const locale of locales) {
    test(`${locale}: has every message, and nothing else`, () => {
      const messages = read(locale);
      assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort());

      for (const [key, entry] of Object.entries(messages)) {
        assert.equal(typeof entry.message, 'string', key);
        assert.notEqual(entry.message, '', key);
        assert.equal(entry.message, entry.message.trim(), `${key} has space around it`);
        // A dollar sign starts a placeholder, and no message has one.
        assert.ok(!entry.message.includes('$'), `${key} contains "$"`);
      }
    });

    test(`${locale}: names its language and keeps the product's name`, () => {
      const messages = read(locale);
      assert.equal(messages.uiLanguage.message, locale.replace('_', '-'));
      for (const key of NAMES) {
        assert.equal(messages[key].message, english[key].message, key);
      }
    });

    test(`${locale}: fits the limits of the Chrome Web Store`, () => {
      const messages = read(locale);
      // https://developer.chrome.com/docs/extensions/reference/manifest/description
      assert.ok([...messages.appDesc.message].length <= 132, `the description has ${[...messages.appDesc.message].length} characters`);
      assert.ok(messages.appName.message.length <= 75);
      assert.ok(messages.shortName.message.length <= 12);
    });

    test(`${locale}: has no invisible characters that do not belong`, () => {
      const messages = read(locale);
      for (const [key, entry] of Object.entries(messages)) {
        const found = (entry.message.match(INVISIBLE) || []).map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase()}`);
        const allowed = USES_NON_JOINER.includes(locale) ? found.filter((name) => name !== 'U+200C') : found;
        assert.deepEqual(allowed, [], key);
      }
    });

    if (locale !== 'en') {
      test(`${locale}: is translated`, () => {
        const messages = read(locale);
        const untranslated = TRANSLATED.filter((key) => messages[key].message === english[key].message);
        assert.deepEqual(untranslated, []);
      });
    }
  }
});
