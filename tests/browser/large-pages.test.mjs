import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// The work is cut into slices so that a large page stays responsive. Here the test decides
// when a slice may run, and each one is told that its time is up as soon as it asks.
describe('large pages', skipWithoutChrome, () => {
  const browser = useBrowser();

  const init = `(() => {
    const waiting = [];
    window.requestIdleCallback = (callback) => { waiting.push(callback); };
    window.__slices = {
      run(limit = 1) {
        let done = 0;
        while (waiting.length && done < limit) {
          waiting.shift()({ didTimeout: false, timeRemaining: () => 0 });
          done += 1;
        }
        return done;
      }
    };
  })();`;

  const paragraphs = (count) => Array.from({ length: count }, (_, index) => `<p>item ${index} ${E.grin}</p>`).join('');

  test('are worked through a slice at a time, without leaving anything out', async () => {
    const page = await browser.open({ init, body: `<main id="main">${paragraphs(500)}</main>` });

    const result = await page.evaluate(async () => {
      const main = document.getElementById('main');
      const counts = [];
      let slices = 0;
      while (window.__slices.run() && slices < 500) {
        slices += 1;
        if (slices <= 3) counts.push(__t.count(main));
        // Lets the extension's observer run, as it would between idle periods.
        await __t.sleep(0);
      }
      const all = [...main.children].every((paragraph) => paragraph.querySelectorAll('.noto-emoji-wrapped').length === 1);
      return { slices, counts, wrapped: __t.count(main), all };
    });

    assert.equal(result.wrapped, 500);
    assert.equal(result.all, true);
    assert.ok(result.slices >= 10, `${result.slices} slices`);
    assert.ok(result.counts[0] > 0 && result.counts[0] < 100, `the first slice wrapped ${result.counts[0]}`);
    assert.ok(result.counts[1] > result.counts[0] && result.counts[2] > result.counts[1], result.counts.join(', '));
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('carry on when the page removes the part a slice stopped in', async () => {
    const page = await browser.open({ init, body: `<main id="main">${paragraphs(300)}</main>` });

    const result = await page.evaluate(async () => {
      const main = document.getElementById('main');
      window.__slices.run();
      await __t.sleep(0);
      const afterFirst = __t.count(main);

      // Everything up to well past the place where the walk stopped.
      const removed = [...main.children].slice(0, 100);
      for (const paragraph of removed) paragraph.remove();

      let slices = 1;
      while (window.__slices.run() && slices < 500) {
        slices += 1;
        await __t.sleep(0);
      }
      const all = [...main.children].every((paragraph) => paragraph.querySelectorAll('.noto-emoji-wrapped').length === 1);
      return { afterFirst, left: main.children.length, wrapped: __t.count(main), all };
    });

    assert.ok(result.afterFirst > 0 && result.afterFirst < 100, `the first slice wrapped ${result.afterFirst}`);
    assert.deepEqual([result.left, result.wrapped, result.all], [200, 200, true]);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});
