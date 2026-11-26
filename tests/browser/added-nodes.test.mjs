import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// A page that builds its content node by node, and the parser, tell the extension about every
// node. A node that was put into a node whose walk is still to come is met by that walk, and
// gets none of its own.
describe('nodes that the page adds one by one', skipWithoutChrome, () => {
  const browser = useBrowser();

  // The test decides when the queued walks run, and sees where each walk through text begins.
  const init = `(() => {
    const waiting = [];
    window.requestIdleCallback = (callback) => { waiting.push(callback); };

    const createTreeWalker = Document.prototype.createTreeWalker;
    const roots = [];
    Document.prototype.createTreeWalker = function (root, whatToShow, ...rest) {
      if (whatToShow === NodeFilter.SHOW_TEXT) roots.push(root);
      return createTreeWalker.call(this, root, whatToShow, ...rest);
    };

    window.__walks = {
      // Where the walks began, apart from those of <body>: one of them comes a second after
      // loading, whenever that is.
      begun: () => roots.filter((root) => root !== document.body),
      forget() { roots.length = 0; },
      // Runs everything that is queued, to the end.
      async run() {
        let slices = 0;
        while (waiting.length && slices < 500) {
          waiting.shift()({ didTimeout: true, timeRemaining: () => 0 });
          slices += 1;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    };
  })();`;

  const open = (body) => browser.open({ init, body });

  test('are met by the walk of the node they were put into, and by no other', async () => {
    const page = await open('<div id="host"></div>');

    const result = await page.evaluate(async (emoji) => {
      await window.__walks.run();
      window.__walks.forget();

      const list = document.getElementById('host').appendChild(document.createElement('ul'));
      let text = '';
      for (let index = 0; index < 40; index += 1) {
        const item = list.appendChild(document.createElement('li'));
        const label = item.appendChild(document.createElement('span'));
        label.appendChild(document.createTextNode(`row ${index} ${emoji}`));
        text += `row ${index} ${emoji}`;
        // Every tenth row in a turn of its own, as a page does that builds a list in steps.
        if (index % 10 === 9) await __t.sleep(0);
      }
      await window.__walks.run();

      const begun = window.__walks.begun();
      const each = [...list.children].every((item) => item.querySelectorAll('.noto-emoji-wrapped').length === 1);
      const built = { wrapped: __t.count(list), each, walks: begun.length, atTheList: begun[0] === list, text: list.textContent === text };

      // That walk is over. What is put into one of its nodes now needs a walk of its own.
      window.__walks.forget();
      const late = list.children[3].appendChild(document.createElement('b'));
      late.appendChild(document.createTextNode(`late ${emoji}`));
      await __t.sleep(0);
      await window.__walks.run();

      return { built, late: { wrapped: __t.count(late), walks: window.__walks.begun().length } };
    }, E.grin);

    assert.deepEqual(result, {
      built: { wrapped: 40, each: true, walks: 1, atTheList: true, text: true },
      late: { wrapped: 1, walks: 1 }
    });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('are walked where they went when they are moved out of a node that waits', async () => {
    const page = await open('<div id="host"></div><div id="other"></div>');

    const result = await page.evaluate(async (emoji) => {
      await window.__walks.run();
      const host = document.getElementById('host');
      const other = document.getElementById('other');

      // Moved before the extension hears of either step.
      const box = host.appendChild(document.createElement('div'));
      const atOnce = box.appendChild(document.createElement('p'));
      atOnce.textContent = `moved at once ${emoji}`;
      other.appendChild(atOnce);

      // Moved after it has heard that the node is in the box.
      const later = box.appendChild(document.createElement('p'));
      later.textContent = `moved later ${emoji}`;
      const inside = later.appendChild(document.createElement('b'));
      inside.textContent = `inside ${emoji}`;
      await __t.sleep(0);
      other.appendChild(later);
      await __t.sleep(0);

      const stays = box.appendChild(document.createElement('p'));
      stays.textContent = `stays ${emoji}`;
      await __t.sleep(0);
      await window.__walks.run();

      return { atOnce: __t.count(atOnce), later: __t.count(later), stays: __t.count(stays), text: other.textContent };
    }, E.grin);

    assert.deepEqual(result, {
      atOnce: 1,
      later: 2,
      stays: 1,
      text: `moved at once ${E.grin}moved later ${E.grin}inside ${E.grin}`
    });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('are walked when the node they were put into is taken out before its walk and they are not', async () => {
    const page = await open('<div id="host"></div><div id="other"></div>');

    const result = await page.evaluate(async (emoji) => {
      await window.__walks.run();
      const host = document.getElementById('host');

      const box = host.appendChild(document.createElement('div'));
      const kept = box.appendChild(document.createElement('p'));
      kept.textContent = `kept ${emoji}`;
      const left = box.appendChild(document.createElement('p'));
      left.textContent = `left behind ${emoji}`;
      await __t.sleep(0);

      document.getElementById('other').appendChild(kept);
      box.remove();
      await __t.sleep(0);
      await window.__walks.run();
      const whileOut = { kept: __t.count(kept), left: __t.count(left) };

      host.appendChild(box);
      await __t.sleep(0);
      await window.__walks.run();
      return { whileOut, back: __t.count(left) };
    }, E.grin);

    // Nothing is wrapped outside the document.
    assert.deepEqual(result, { whileOut: { kept: 1, left: 0 }, back: 1 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('are left alone in an element that is left alone', async () => {
    const page = await open('<div id="host"></div>');

    const result = await page.evaluate(async (emoji) => {
      await window.__walks.run();
      const host = document.getElementById('host');

      const code = host.appendChild(document.createElement('pre'));
      const line = code.appendChild(document.createElement('span'));
      line.appendChild(document.createTextNode(`code ${emoji}`));

      const editor = host.appendChild(document.createElement('div'));
      editor.contentEditable = 'true';
      const island = editor.appendChild(document.createElement('p'));
      island.contentEditable = 'false';
      island.appendChild(document.createTextNode(`island ${emoji}`));

      const plain = host.appendChild(document.createElement('p'));
      plain.appendChild(document.createTextNode(`plain ${emoji}`));

      await __t.sleep(0);
      await window.__walks.run();
      return { code: __t.count(code), editor: __t.count(editor), plain: __t.count(plain) };
    }, E.grin);

    assert.deepEqual(result, { code: 0, editor: 0, plain: 1 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('get no walk as a text without emoji, and are wrapped when emoji are written into it', async () => {
    const page = await open('<div id="host"></div>');

    const result = await page.evaluate(async (emoji) => {
      await window.__walks.run();
      const paragraph = document.getElementById('host').appendChild(document.createElement('p'));
      await __t.sleep(0);
      await window.__walks.run();

      const text = paragraph.appendChild(document.createTextNode('nothing yet'));
      const sibling = paragraph.appendChild(document.createTextNode(` beside ${emoji}`));
      await __t.sleep(0);
      await window.__walks.run();
      const atFirst = __t.count(paragraph);

      text.data = `now ${emoji}`;
      // Wrapped once the text has stayed the same for 300 ms.
      await __t.sleep(600);
      return { atFirst, later: __t.count(paragraph), text: paragraph.textContent, anchors: [text.data, sibling.data] };
    }, E.grin);

    assert.deepEqual(result, { atFirst: 1, later: 2, text: `now ${E.grin} beside ${E.grin}`, anchors: ['', ''] });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('are followed from the first emoji on in a page that had none', async () => {
    const page = await open('<div id="host"><p id="old">no emoji here</p></div>');

    const result = await page.evaluate(async (emoji) => {
      await window.__walks.run();
      const host = document.getElementById('host');
      const old = document.getElementById('old');

      // What the page does while nothing is wrapped needs no following.
      old.remove();
      host.appendChild(old);
      old.firstChild.data = 'still none';
      await __t.sleep(0);

      const paragraph = host.appendChild(document.createElement('p'));
      const text = paragraph.appendChild(document.createTextNode(`first ${emoji}`));
      await __t.sleep(0);
      await window.__walks.run();
      const wrapped = __t.count(paragraph);

      // From here on it does: the page takes its text node out, and the text goes with it.
      text.remove();
      await __t.sleep(0);
      const taken = { wrapped: __t.count(paragraph), text: paragraph.textContent, own: text.data };

      paragraph.appendChild(text);
      await __t.sleep(0);
      await window.__walks.run();
      return { wrapped, taken, back: { wrapped: __t.count(paragraph), text: paragraph.textContent } };
    }, E.grin);

    assert.deepEqual(result, {
      wrapped: 1,
      taken: { wrapped: 0, text: '', own: `first ${E.grin}` },
      back: { wrapped: 1, text: `first ${E.grin}` }
    });
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});
