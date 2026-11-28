import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// What a page, its user or another script does to a text after its emoji were wrapped.
describe('wrapped text that is changed from outside', skipWithoutChrome, () => {
  const browser = useBrowser();

  test('an element that becomes editable gets its text nodes back, and is wrapped again when it stops being one', async () => {
    const page = await browser.open({ body: `<p id="title">${E.rocket} My title</p>` });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const title = document.getElementById('title');
      const node = title.firstChild;
      const look = () => ({ wrapped: __t.count(title), nodes: title.childNodes.length, text: title.textContent, sameNode: title.firstChild === node });
      const out = { atFirst: look() };

      // What a title does that can be edited after a click.
      title.contentEditable = 'true';
      await __t.settle();
      out.editable = look();

      // The user types at the start.
      node.insertData(0, 'A');
      await __t.settle();
      out.typed = look();

      title.removeAttribute('contenteditable');
      await __t.settle();
      out.readOnlyAgain = { wrapped: __t.count(title), text: title.textContent };
      return out;
    });

    assert.deepEqual(result.atFirst, { wrapped: 1, nodes: 4, text: `${E.rocket} My title`, sameNode: true });
    assert.deepEqual(result.editable, { wrapped: 0, nodes: 1, text: `${E.rocket} My title`, sameNode: true });
    assert.deepEqual(result.typed, { wrapped: 0, nodes: 1, text: `A${E.rocket} My title`, sameNode: true });
    assert.deepEqual(result.readOnlyAgain, { wrapped: 1, text: `A${E.rocket} My title` });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('typing into a text that became editable unseen does not take the rest of it away', async () => {
    const page = await browser.open({ body: `<p id="title">${E.rocket} My title</p>` });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const title = document.getElementById('title');
      const node = title.firstChild;
      // No attribute changes, so nothing announces this.
      document.designMode = 'on';
      node.data = 'A';
      await __t.settle();
      const typed = title.textContent;
      title.removeChild(node);
      await __t.settle();
      return { typed, removed: title.textContent };
    });

    assert.deepEqual(result, { typed: `A${E.rocket} My title`, removed: `${E.rocket} My title` });
    await page.close();
  });

  test('pieces that another script has replaced do not come back when the page moves things around', async () => {
    const page = await browser.open({ body: `<p id="a">Hello ${E.grin} world</p><p id="b">Hello ${E.grin} world</p>` });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const out = {};
      for (const id of ['a', 'b']) {
        const paragraph = document.getElementById(id);
        const anchor = paragraph.firstChild;
        // What a translator does to a piece of text: something of its own takes its place.
        const hello = [...paragraph.childNodes].find((node) => node.data === 'Hello ');
        const translated = document.createElement('font');
        translated.textContent = 'HALLO ';
        paragraph.replaceChild(translated, hello);
        await __t.settle();

        if (id === 'a') {
          // The page puts something right behind its text node.
          const badge = document.createElement('b');
          badge.textContent = '[new]';
          paragraph.insertBefore(badge, anchor.nextSibling);
        } else {
          // The page moves its text node to the end.
          paragraph.appendChild(anchor);
        }
        await __t.settle();
        out[id] = paragraph.textContent;
      }
      return out;
    });

    assert.deepEqual(result, { a: `[new]HALLO ${E.grin} world`, b: `HALLO ${E.grin} world` });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('a text that the page clears goes, whatever another script does to another text at the same time', async () => {
    const page = await browser.open({ body: `<p id="a">First ${E.grin}</p><p id="b">Second ${E.party}</p>` });

    const result = await page.evaluate(async () => {
      await __t.settle();
      const a = document.getElementById('a');
      const b = document.getElementById('b');
      // In one go: the page clears one text, and a script edits a piece of the other.
      a.firstChild.data = '';
      [...b.childNodes].find((node) => node.data === 'Second ').data = '2nd ';
      await __t.settle();
      return { a: a.textContent, b: b.textContent };
    });

    assert.deepEqual(result, { a: '', b: `2nd ${E.party}` });
    await page.close();
  });

  test('the user\'s selection stays on the text it was made on', async () => {
    const page = await browser.open({ body: '<p id="a"></p><p id="b"></p><p id="c">before <b id="inner">bold</b></p>' });

    const result = await page.evaluate(async (emoji) => {
      const out = {};
      const select = (startNode, start, endNode, end) => getSelection().setBaseAndExtent(startNode, start, endNode, end);

      // Text and selection arrive in the same task, before the extension has seen the text.
      const a = document.getElementById('a');
      const first = a.appendChild(document.createTextNode(`hello ${emoji} world`));
      select(first, 0, first, 5);
      await __t.settle();
      out.beforeEmoji = [getSelection().toString(), __t.count(a)];

      // Across the emoji, and made backwards.
      const b = document.getElementById('b');
      const second = b.appendChild(document.createTextNode(`hello ${emoji} world`));
      select(second, 8 + emoji.length, second, 3);
      await __t.settle();
      out.acrossEmoji = [getSelection().toString(), getSelection().anchorNode.data, __t.count(b)];

      // From another node into the text.
      const third = document.getElementById('c').appendChild(document.createTextNode(` after ${emoji} end`));
      select(document.getElementById('inner').firstChild, 1, third, 6);
      await __t.settle();
      out.fromOutside = [getSelection().toString(), __t.count('#c')];
      return out;
    }, E.grin);

    assert.deepEqual(result, {
      beforeEmoji: ['hello', 1],
      acrossEmoji: [`lo ${E.grin} w`, ' world', 1],
      fromOutside: ['old after', 1]
    });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('a walk that is waiting for its next turn starts over when the page moves the node it stopped at', async () => {
    const page = await browser.open({ body: '<div id="host"></div>' });

    const result = await page.evaluate(async (grin) => {
      // A second after the page has loaded, one more walk goes over all of it. That walk would
      // make up for what is checked here, so it is waited for first.
      await __t.sleep(1200);
      await __t.settle();

      // Enough text that its walk takes more than one turn, and all of it in one element that
      // arrives at once: elements that arrive one by one are each walked on their own.
      const total = 6000;
      const list = document.createElement('div');
      list.innerHTML = Array.from({ length: total }, (_, index) => `<p>item ${index} ${grin} text</p>`).join('');
      document.getElementById('host').appendChild(list);

      // Wait until some of it is done and some is not, then move the first item that is not to
      // the end, as a list does that puts its rows to new use.
      let moved = false;
      for (let turn = 0; turn < 2000 && !moved; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const done = __t.count(list);
        if (done > 0 && done < total - 200) {
          const next = [...list.children].find((item) => !item.querySelector('.noto-emoji-wrapped'));
          list.appendChild(next);
          moved = true;
        }
      }

      // The rest takes a number of turns, and many more of them on a slow machine. So the wait
      // lasts for as long as the count still grows, and ends when it has stood still for a while.
      let wrapped = __t.count(list);
      let grewAt = performance.now();
      while (wrapped < total && performance.now() - grewAt < 5000) {
        await __t.sleep(100);
        const now = __t.count(list);
        if (now > wrapped) {
          wrapped = now;
          grewAt = performance.now();
        }
      }
      return { moved, wrapped, total };
    }, E.grin);

    // On a machine that does all of it in one turn there is nothing to move, and nothing to check.
    if (result.moved) assert.equal(result.wrapped, result.total);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});
