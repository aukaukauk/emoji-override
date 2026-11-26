import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// Noto's pictures are larger than those of the emoji fonts of macOS and Windows 11 at the same
// font size. The stylesheet has a face of the font for each of those systems that is scaled
// down, and the marker on <html> says which one a document uses.
describe('the size of replaced emoji', skipWithoutChrome, () => {
  const browser = useBrowser();

  // The advance width of a Noto Color Emoji glyph, in em, at its own size.
  const NOTO_ADVANCE = 1.245;

  // Makes the document believe it runs on another system.
  const system = ({ platform, version, legacy, refuses }) => `(() => {
    const data = ${platform === undefined ? 'undefined' : `{
      platform: ${JSON.stringify(platform)},
      getHighEntropyValues: async () => {
        if (${Boolean(refuses)}) throw new Error('not allowed');
        return { platformVersion: ${JSON.stringify(version || '0.0.0')} };
      }
    }`};
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => data, configurable: true });
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => ${JSON.stringify(legacy || '')}, configurable: true });
  })();`;

  const look = async () => {
    await __t.settle();
    await __t.fontsReady();
    const span = document.querySelector('#a .noto-emoji-wrapped');
    const range = document.createRange();
    range.selectNodeContents(span);
    return {
      marker: document.documentElement.getAttribute('data-noto-emoji-enabled'),
      font: getComputedStyle(span).fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      // How much room the emoji takes, in em.
      advance: Math.round((range.getBoundingClientRect().width / parseFloat(getComputedStyle(span).fontSize)) * 1000) / 1000,
      loaded: [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, ''))
    };
  };

  const cases = [
    ['macOS', { platform: 'macOS' }, 'mac', 'EmojiOverrideNotoMac', 0.875],
    ['a Mac that only says so the old way', { legacy: 'MacIntel' }, 'mac', 'EmojiOverrideNotoMac', 0.875],
    ['Windows 11', { platform: 'Windows', version: '15.0.0' }, 'windows', 'EmojiOverrideNotoWindows', 0.925],
    ['the first Windows 11', { platform: 'Windows', version: '13.0.0' }, 'windows', 'EmojiOverrideNotoWindows', 0.925],
    ['Windows that does not tell its version', { platform: 'Windows', refuses: true }, 'windows', 'EmojiOverrideNotoWindows', 0.925],
    ['Windows 10, whose own emoji are as large as Noto', { platform: 'Windows', version: '10.0.0' }, '', 'EmojiOverrideNoto', 1],
    ['Linux, where the system font is Noto', { platform: 'Linux' }, '', 'EmojiOverrideNoto', 1],
    ['Chrome OS', { platform: 'Chrome OS' }, '', 'EmojiOverrideNoto', 1]
  ];

  for (const [name, pretend, marker, font, factor] of cases) {
    test(`on ${name}: ${factor === 1 ? 'Noto at its own size' : `${factor * 100}% of it`}`, async () => {
      const page = await browser.open({
        init: system(pretend),
        body: `<p id="a" style="font:40px Arial">size ${E.grin} check</p>`
      });
      const seen = await page.evaluate(look);

      assert.equal(seen.marker, marker);
      assert.equal(seen.font, font);
      assert.ok(Math.abs(seen.advance - NOTO_ADVANCE * factor) < 0.012, `the emoji is ${seen.advance} em wide, expected ${(NOTO_ADVANCE * factor).toFixed(3)}`);
      // The other faces of the font are not fetched.
      assert.deepEqual(seen.loaded, [font]);
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  test('the picture of an emoji is about as large as the one it replaces on this machine', async () => {
    const page = await browser.open({ body: `<p id="a" style="font:40px Arial">size ${E.grin} check</p>` });

    const seen = await page.evaluate(async (emoji) => {
      await __t.settle();
      await __t.fontsReady();
      const ours = getComputedStyle(document.querySelector('#a .noto-emoji-wrapped')).fontFamily;

      const SIZE = 160;
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 480;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      // The box of the picture, in em. A row or column counts when it holds more than a few
      // stray dots: Apple's faces have a dot in two of their corners.
      const picture = (font) => {
        context.clearRect(0, 0, 480, 480);
        context.font = `${SIZE}px ${font}`;
        context.fillText(emoji, 120, 300);
        const { data } = context.getImageData(0, 0, 480, 480);
        const columns = new Array(480).fill(0);
        const rows = new Array(480).fill(0);
        for (let y = 0; y < 480; y += 1) {
          for (let x = 0; x < 480; x += 1) {
            if (data[(y * 480 + x) * 4 + 3] > 40) {
              columns[x] += 1;
              rows[y] += 1;
            }
          }
        }
        const extent = (counts) => counts.filter((count) => count > 3).length / SIZE;
        return Math.sqrt(extent(columns) * extent(rows));
      };

      return { system: picture('sans-serif'), ours: picture(ours), marker: document.documentElement.getAttribute('data-noto-emoji-enabled') };
    }, E.grin);

    assert.ok(seen.system > 0.5 && seen.ours > 0.5, `nothing was drawn: ${JSON.stringify(seen)}`);
    const ratio = seen.ours / seen.system;
    assert.ok(ratio > 0.92 && ratio < 1.08, `ours is ${seen.ours.toFixed(3)} em, the system's ${seen.system.toFixed(3)} em (marker ${JSON.stringify(seen.marker)})`);
    await page.close();
  });

  test('a page that writes another value to the marker gets the right one back', async () => {
    const page = await browser.open({
      init: system({ platform: 'macOS' }),
      body: `<p id="a" style="font:40px Arial">size ${E.grin} check</p>`
    });

    const seen = await page.evaluate(async () => {
      await __t.settle();
      const root = document.documentElement;
      root.setAttribute('data-noto-emoji-enabled', 'windows');
      await __t.sleep(50);
      const afterWrongValue = root.getAttribute('data-noto-emoji-enabled');
      root.setAttribute('data-noto-emoji-enabled', '');
      await __t.sleep(50);
      return { afterWrongValue, afterEmptyValue: root.getAttribute('data-noto-emoji-enabled') };
    });

    assert.deepEqual(seen, { afterWrongValue: 'mac', afterEmptyValue: 'mac' });
    await page.close();
  });
});
