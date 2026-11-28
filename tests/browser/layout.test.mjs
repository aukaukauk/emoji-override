import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// The wrapper must not take part in layout. Every check compares against the same document
// without the extension, or against a line without emoji, so it does not depend on which
// fonts the machine has.
describe('layout around wrapped emoji', skipWithoutChrome, () => {
  const browser = useBrowser();

  const containers = {
    head: `<style>
.case{font:16px Arial;margin:4px 0;padding:4px 6px;border:1px solid #bbb}
.flex{display:flex;gap:10px;align-items:center}
.column{flex-direction:column;align-items:flex-start}
.grid{display:grid}
.between{justify-content:space-between;width:380px;box-sizing:border-box}
</style>`,
    body: `<div class="case flex" data-case="flex row with gap">${E.rocket} Getting started</div>
<div class="case flex column" data-case="flex column">Step one ${E.grin} then step two</div>
<div class="case grid" data-case="grid">Grid text ${E.grin} keeps going</div>
<div class="case flex between" data-case="space-between">Saved ${E.check} just now</div>
<button class="case flex" style="display:inline-flex" data-case="inline-flex button">Save ${E.check} changes</button>
<div id="narrow" style="font:16px Arial;width:400px">Approve this change ${E.thumbsUp}.</div>`
  };

  const measureContainers = async () => {
    await __t.settle();
    await __t.fontsReady();
    // Where the pieces of text inside a container ended up. A wrapper that takes part in layout
    // moves them onto separate lines or pushes them apart.
    const content = (element) => {
      const whole = document.createRange();
      whole.selectNodeContents(element);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const pieces = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.data.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        pieces.push(range.getBoundingClientRect());
      }
      const centres = pieces.map((box) => box.top + box.height / 2);
      const gaps = pieces.slice(1).map((box, index) => box.left - pieces[index].right);
      return {
        width: whole.getBoundingClientRect().width,
        verticalSpread: Math.max(...centres) - Math.min(...centres),
        widestGap: Math.max(0, ...gaps)
      };
    };
    const cases = {};
    for (const element of document.querySelectorAll('[data-case]')) cases[element.dataset.case] = content(element);

    // Widths at which the final full stop ends up alone on a later line than the emoji.
    const narrow = document.getElementById('narrow');
    let orphanedFullStops = 0;
    for (let width = 400; width >= 30; width--) {
      narrow.style.width = `${width}px`;
      const walker = document.createTreeWalker(narrow, NodeFilter.SHOW_TEXT);
      const texts = [];
      while (walker.nextNode()) texts.push(walker.currentNode);
      const last = texts[texts.length - 1];
      const stop = document.createRange();
      stop.setStart(last, last.data.length - 1);
      stop.setEnd(last, last.data.length);
      const emojiNode = texts.find((node) => /\p{Emoji_Presentation}/u.test(node.data));
      const emoji = document.createRange();
      const at = emojiNode.data.search(/\p{Emoji_Presentation}/u);
      emoji.setStart(emojiNode, at);
      emoji.setEnd(emojiNode, at + 2);
      if (stop.getBoundingClientRect().top > emoji.getBoundingClientRect().top + 8) orphanedFullStops += 1;
    }
    return { cases, orphanedFullStops, wrapped: __t.wrapped().length };
  };

  test('bare text in flex and grid containers stays one run of text', async () => {
    const control = await browser.open({ ...containers, extension: false, stub: false });
    const extension = await browser.open(containers);
    const [without, withExtension] = [await control.evaluate(measureContainers), await extension.evaluate(measureContainers)];

    assert.equal(without.wrapped, 0);
    assert.equal(withExtension.wrapped, 6);
    for (const [name, expected] of Object.entries(without.cases)) {
      const actual = withExtension.cases[name];
      assert.ok(actual.verticalSpread <= 6, `${name}: text pieces are ${actual.verticalSpread}px apart vertically`);
      assert.ok(actual.widestGap <= 6, `${name}: ${actual.widestGap}px gap between text pieces`);
      assert.ok(Math.abs(actual.width - expected.width) <= 6, `${name}: width ${actual.width} vs ${expected.width}`);
    }
    assert.equal(withExtension.orphanedFullStops, without.orphanedFullStops, 'a full stop wraps exactly where it did');
    await control.close();
    await extension.close();
  });

  test('a line with emoji is as tall as a line without', async () => {
    const fonts = ['Arial', 'Times', 'Georgia', 'Menlo'];
    const lineHeights = ['1.6', '2', 'normal'];
    const page = await browser.open({
      body: fonts.flatMap((font) => lineHeights.map((lineHeight) => `<div class="pair" data-key="${font} / ${lineHeight}" `
        + `style="font:16px '${font}';line-height:${lineHeight}"><p style="margin:0">Plain line</p>`
        + `<p style="margin:0">Line with ${E.grin} ${E.thumbsUpMedium} emoji</p></div>`)).join('')
    });

    const rows = await page.evaluate(async () => {
      await __t.settle();
      await __t.fontsReady();
      return [...document.querySelectorAll('.pair')].map((pair) => {
        const [plain, emoji] = [...pair.children].map((row) => row.getBoundingClientRect().height);
        return { key: pair.dataset.key, plain, emoji };
      });
    });

    assert.equal(rows.length, fonts.length * lineHeights.length);
    for (const { key, plain, emoji } of rows) {
      // With generous leading the emoji fits inside the line for any text font, so the heights
      // match exactly. `normal` depends on the font's own metrics; allow rounding there.
      const tolerance = key.endsWith('normal') ? 1 : 0;
      assert.ok(Math.abs(emoji - plain) <= tolerance, `${key}: ${emoji} vs ${plain}`);
    }
    await page.close();
  });

  for (const [mode, doctype] of [
    ['standards', '<!doctype html>'],
    ['quirks', ''],
    ['limited-quirks', '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">']
  ]) {
    test(`a line that holds only emoji keeps its height in ${mode} mode`, async () => {
      const page = await browser.open({
        doctype,
        head: '<style>p{margin:0;font:16px/1.5 Arial}</style>',
        body: `<p id="only">${E.grin}</p><p id="first">${E.grin} then text</p><p id="plain">plain text</p>`
      });

      const heights = await page.evaluate(async () => {
        await __t.settle();
        await __t.fontsReady();
        const height = (id) => document.getElementById(id).getBoundingClientRect().height;
        return { only: height('only'), first: height('first'), plain: height('plain'), replaced: __t.count(document.body), held: __t.held().map((element) => element.id) };
      });

      // The first paragraph gets the font as a whole, the second gets a wrapper.
      assert.equal(heights.replaced, 2);
      assert.deepEqual(heights.held, ['only']);
      assert.equal(heights.first, heights.plain);
      // In the quirks modes such a line is as tall as the emoji's own line-height (1em), not 0.
      assert.ok(heights.only >= 14 && heights.only <= heights.plain, `emoji-only line is ${heights.only}px`);
      await page.close();
    });
  }

  test('the wrapper generates no box', async () => {
    const page = await browser.open({ body: `<p><a href="#" id="link">link with ${E.grin} emoji</a></p>` });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const span = document.querySelector('.noto-emoji-wrapped');
      const box = span.getBoundingClientRect();
      return { display: getComputedStyle(span).display, box: [box.width, box.height] };
    });

    assert.deepEqual(result, { display: 'contents', box: [0, 0] });
    await page.close();
  });
});
