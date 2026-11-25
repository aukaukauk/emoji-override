import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// Scripts keep the text nodes they created and come back to them: to set a new value, to take
// the node out, or to insert next to it. Each test does to a text node what one family of
// frameworks does, and checks that the page ends up showing what the script meant.
describe('pages that keep hold of their text nodes', skipWithoutChrome, () => {
  const browser = useBrowser();

  // Runs `steps` in a page whose body is `body`, after the extension has wrapped what is there.
  // Inside, `tick()` waits for the extension to react to what the page just did.
  async function inPage(body, steps, arg) {
    const page = await browser.open({ body });
    const result = await page.evaluate(`async (arg) => {
      const tick = () => __t.sleep(0);
      const WAIT = window.__notoEmojiOverride.habits.WAIT_MS;
      const look = (element) => ({ text: element.textContent, wrapped: __t.count(element) });
      await __t.settle();
      return (${steps})(arg, { tick, WAIT, look });
    }`, arg);
    assert.deepEqual(page.errors, []);
    await page.close();
    return result;
  }

  test('the text node stays in its place, empty, with its text right behind it', async () => {
    const result = await inPage(`<p id="p">Hello ${E.grin} world</p>`, async () => {
      const paragraph = document.getElementById('p');
      return [...paragraph.childNodes].map((node) => (node.nodeType === Node.TEXT_NODE ? node.data : `<${node.localName}>`));
    });

    // The page's node, an empty node of ours that tells a sweep from a removal, and the pieces.
    assert.deepEqual(result, ['', '', 'Hello ', '<span>', ' world']);
  });

  test('taking the node out, or inserting in front of it, works and leaves nothing behind', async () => {
    const result = await inPage(`<p id="p"><b>a</b>new ${E.party} here<i>z</i></p>`, async (arg, { tick, look }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.childNodes[1];
      const failures = [];
      const attempt = (name, action) => {
        try {
          action();
        } catch (error) {
          failures.push(`${name}: ${error.name}`);
        }
      };

      attempt('insertBefore', () => paragraph.insertBefore(document.createElement('u'), own));
      await tick();
      const afterInsert = look(paragraph);
      const order = [...paragraph.children].map((element) => element.localName).join(' ');

      attempt('removeChild', () => paragraph.removeChild(own));
      await tick();
      return { failures, afterInsert, order, afterRemoval: look(paragraph), nodeGotItsTextBack: own.data };
    });

    assert.deepEqual(result, {
      failures: [],
      afterInsert: { text: `anew ${E.party} herez`, wrapped: 1 },
      order: 'b u span i',
      afterRemoval: { text: 'az', wrapped: 0 },
      nodeGotItsTextBack: `new ${E.party} here`
    });
  });

  test('a value written to the node is the new text, whatever was there', async () => {
    const result = await inPage(`<p id="p">Saved ${E.check}</p>`, async (emoji, { tick, look }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.firstChild;
      const seen = [];

      for (const value of [`Failed ${emoji.fire} again`, 'Saving', `${emoji.rocket}`, '', `${emoji.grin} back`, `${emoji.grin} back`]) {
        own.nodeValue = value;
        await tick();
        seen.push({ ...look(paragraph), sameNode: paragraph.firstChild === own });
      }
      return seen;
    }, E);

    assert.deepEqual(result, [
      { text: `Failed ${E.fire} again`, wrapped: 1, sameNode: true },
      { text: 'Saving', wrapped: 0, sameNode: true },
      { text: E.rocket, wrapped: 1, sameNode: true },
      { text: '', wrapped: 0, sameNode: true },
      { text: `${E.grin} back`, wrapped: 1, sameNode: true },
      { text: `${E.grin} back`, wrapped: 1, sameNode: true }
    ]);
  });

  test('writers that find their node by position still find it', async () => {
    const result = await inPage(
      `<p id="lit"><!--start-->${E.grin} one<!--end--></p><p id="solid">${E.grin} one<b>!</b></p>`,
      async (emoji, { tick, look }) => {
        // lit-html writes to the node after its start marker; Solid writes to the first child.
        const lit = document.getElementById('lit');
        const solid = document.getElementById('solid');
        lit.firstChild.nextSibling.data = `two ${emoji.party}`;
        solid.firstChild.data = `two ${emoji.party}`;
        await tick();
        return { lit: look(lit), solid: look(solid) };
      },
      E
    );

    assert.deepEqual(result, {
      lit: { text: `two ${E.party}`, wrapped: 1 },
      solid: { text: `two ${E.party}!`, wrapped: 1 }
    });
  });

  test('React\'s way of setting the text of an element works for any number of changes', async () => {
    const result = await inPage('<p id="p">tick 0</p>', async (emoji, { look, WAIT }) => {
      const paragraph = document.getElementById('p');
      // ReactDOM: write to the only child if that is a text node, else replace the content.
      const setText = (text) => {
        const first = paragraph.firstChild;
        if (first && first === paragraph.lastChild && first.nodeType === Node.TEXT_NODE) first.nodeValue = text;
        else paragraph.textContent = text;
      };

      const seen = [];
      for (const text of [`tick 1 ${emoji.grin}`, `tick 2 ${emoji.grin}`, 'tick 3', `tick 4 ${emoji.party} done`]) {
        setText(text);
        await __t.settle();
        await __t.sleep(WAIT.soon + 150);
        seen.push(look(paragraph));
      }
      return seen;
    }, E);

    assert.deepEqual(result, [
      { text: `tick 1 ${E.grin}`, wrapped: 1 },
      { text: `tick 2 ${E.grin}`, wrapped: 1 },
      { text: 'tick 3', wrapped: 0 },
      { text: `tick 4 ${E.party} done`, wrapped: 1 }
    ]);
  });

  test('replacing the node, as Vue, Preact and Solid do, removes its text', async () => {
    const result = await inPage(
      `<p id="solid"><b>a</b>${E.grin} old<i>z</i></p><p id="vue"><b>a</b>${E.grin} old<i>z</i></p><p id="preact"><b>a</b>${E.grin} old<i>z</i></p>`,
      async (arg, { tick, look }) => {
        const make = () => Object.assign(document.createElement('u'), { textContent: 'NEW' });

        const solid = document.getElementById('solid');
        solid.replaceChild(make(), solid.childNodes[1]);

        // Vue takes the next sibling as its anchor, removes the old node, then inserts.
        const vue = document.getElementById('vue');
        const old = vue.childNodes[1];
        const anchor = old.nextSibling;
        vue.removeChild(old);
        vue.insertBefore(make(), anchor);

        // Preact inserts in front of the old node, then removes it.
        const preact = document.getElementById('preact');
        preact.insertBefore(make(), preact.childNodes[1]);
        preact.removeChild(preact.childNodes[2]);

        await tick();
        return [look(solid), look(vue), look(preact)];
      }
    );

    assert.deepEqual(result, Array(3).fill({ text: 'aNEWz', wrapped: 0 }));
  });

  test('clearing everything between two markers, as lit-html does, clears the text too', async () => {
    const result = await inPage(`<p id="p">a<!--start-->${E.grin} one ${E.party}<!--end-->z</p>`, async (emoji, { tick, look }) => {
      const paragraph = document.getElementById('p');
      const [start, end] = [...paragraph.childNodes].filter((node) => node.nodeType === Node.COMMENT_NODE);

      let node = start.nextSibling;
      while (node !== end) {
        const next = node.nextSibling;
        node.remove();
        node = next;
      }
      await tick();
      const cleared = look(paragraph);

      paragraph.insertBefore(document.createTextNode(`two ${emoji.rocket}`), end);
      await __t.settle();
      return { cleared, filled: look(paragraph) };
    }, E);

    assert.deepEqual(result, {
      cleared: { text: 'az', wrapped: 0 },
      filled: { text: `atwo ${E.rocket}z`, wrapped: 1 }
    });
  });

  test('a node that is taken out and put back later shows its text again', async () => {
    const result = await inPage(`<p id="p"><b>a</b>${E.grin} kept<i>z</i></p>`, async (arg, { tick, look }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.childNodes[1];

      own.remove();
      await tick();
      const out = look(paragraph);

      paragraph.insertBefore(own, paragraph.lastChild);
      await __t.settle();
      return { out, back: look(paragraph) };
    });

    assert.deepEqual(result, {
      out: { text: 'az', wrapped: 0 },
      back: { text: `a${E.grin} keptz`, wrapped: 1 }
    });
  });

  test('moving the node moves its text, and what is inserted behind the node lands behind the text', async () => {
    const result = await inPage(`<p id="list">${E.grin} one;</p>`, async (emoji, { tick, look }) => {
      const list = document.getElementById('list');
      const first = list.firstChild;

      // Solid appends to a list of text nodes by inserting before the last one's next sibling.
      const second = document.createTextNode(`${emoji.party} two;`);
      list.insertBefore(second, first.nextSibling);
      await __t.settle();
      const appended = look(list);

      // A keyed list that is reordered moves the nodes themselves.
      list.insertBefore(second, first);
      await tick();
      return { appended, moved: look(list) };
    }, E);

    assert.deepEqual(result, {
      appended: { text: `${E.grin} one;${E.party} two;`, wrapped: 2 },
      moved: { text: `${E.party} two;${E.grin} one;`, wrapped: 2 }
    });
  });

  // A cached view, or a row that a list uses again, is out of the document for a while, and its
  // script goes on working on it there. The element is not being observed then, so it has to be
  // followed on purpose.
  test('what the page does to a text while its element is out of the document shows when the element returns', async () => {
    const result = await inPage('<div id="host"></div>', async (emoji, { look }) => {
      const host = document.getElementById('host');
      const element = (name, text) => Object.assign(document.createElement(name), { textContent: text });
      const changes = {
        'left alone': () => {},
        'a new text with emoji': (own) => { own.data = `count ${emoji.party} 4`; },
        'a new text without emoji': (own) => { own.data = 'none'; },
        'the text cleared': (own) => { own.data = ''; },
        'the node taken out': (own, paragraph) => { paragraph.removeChild(own); },
        'the node replaced': (own, paragraph) => { paragraph.replaceChild(document.createTextNode('other'), own); },
        'something put right behind the node': (own, paragraph) => { paragraph.insertBefore(element('u', 'X'), own.nextSibling); }
      };

      const seen = {};
      for (const [name, change] of Object.entries(changes)) {
        const paragraph = document.createElement('p');
        const own = document.createTextNode(`count ${emoji.grin} 3`);
        paragraph.append(element('b', '['), own, element('i', ']'));
        host.appendChild(paragraph);
        await __t.settle();

        paragraph.remove();
        await __t.sleep(20);
        change(own, paragraph);
        await __t.sleep(20);
        const out = paragraph.textContent;

        host.appendChild(paragraph);
        await __t.settle();
        seen[name] = { out, ...look(paragraph) };
        paragraph.remove();
      }
      return seen;
    }, E);

    const same = (text, wrapped) => ({ out: text, text, wrapped });
    assert.deepEqual(result, {
      'left alone': same(`[count ${E.grin} 3]`, 1),
      'a new text with emoji': same(`[count ${E.party} 4]`, 1),
      'a new text without emoji': same('[none]', 0),
      'the text cleared': same('[]', 0),
      'the node taken out': same('[]', 0),
      'the node replaced': same('[other]', 0),
      'something put right behind the node': same(`[count ${E.grin} 3X]`, 1)
    });
  });

  test('tidying up an element that is out of the document does not lose its text', async () => {
    const result = await inPage(`<div id="host"><p id="p"><b>[</b>Tidy ${E.party} up<i>]</i></p></div>`, async (arg, { look }) => {
      const paragraph = document.getElementById('p');
      const host = paragraph.parentNode;

      paragraph.remove();
      await __t.sleep(20);
      paragraph.normalize();
      await __t.sleep(20);
      const out = paragraph.textContent;

      host.appendChild(paragraph);
      await __t.settle();
      return { out, back: look(paragraph) };
    });

    assert.deepEqual(result, {
      out: `[Tidy ${E.party} up]`,
      back: { text: `[Tidy ${E.party} up]`, wrapped: 1 }
    });
  });

  test('text written while its element is out of the document is not wrapped before it is known where the element ends up', async () => {
    const result = await inPage(`<div id="host"><p id="p"><b>[</b>first ${E.grin}<i>]</i></p></div><pre id="code"></pre>`, async (emoji, { look }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.childNodes[1];

      paragraph.remove();
      await __t.sleep(20);
      own.data = `second ${emoji}`;
      await __t.sleep(20);
      const out = look(paragraph);

      // It comes back inside a place that is left alone.
      document.getElementById('code').appendChild(paragraph);
      await __t.settle();
      return { out, back: look(paragraph) };
    }, E.rocket);

    assert.deepEqual(result, {
      out: { text: `[second ${E.rocket}]`, wrapped: 0 },
      back: { text: `[second ${E.rocket}]`, wrapped: 0 }
    });
  });

  test('a shadow tree that changes while its host is out of the document is caught up with when the host returns', async () => {
    const result = await inPage('<div id="host"></div>', async (emoji) => {
      const host = document.getElementById('host');
      const changes = {
        'a wrapped text rewritten': { start: `unread ${emoji.grin} 3`, change: (own) => { own.data = `unread ${emoji.grin} 4`; } },
        'a plain text replaced by one with emoji': { start: 'unread', change: (own) => { own.data = `read ${emoji.party}`; } },
        'a paragraph added': { start: 'unread', change: (own, root) => { root.appendChild(document.createElement('p')).textContent = `new ${emoji.party}`; } }
      };

      const seen = {};
      for (const [name, { start, change }] of Object.entries(changes)) {
        const widget = document.createElement('x-widget');
        const root = widget.attachShadow({ mode: 'open' });
        root.innerHTML = `<p><b>[</b>${start}<i>]</i></p>`;
        host.appendChild(widget);
        await __t.settle();

        widget.remove();
        await __t.sleep(20);
        change(root.querySelector('p').childNodes[1], root);
        await __t.sleep(20);
        const out = { text: root.textContent, wrapped: __t.count(root) };

        host.appendChild(widget);
        await __t.settle();
        seen[name] = { out, back: { text: root.textContent, wrapped: __t.count(root) } };
      }
      return seen;
    }, E);

    const caughtUp = (text) => ({ out: { text, wrapped: 0 }, back: { text, wrapped: 1 } });
    assert.deepEqual(result, {
      'a wrapped text rewritten': caughtUp(`[unread ${E.grin} 4]`),
      'a plain text replaced by one with emoji': caughtUp(`[read ${E.party}]`),
      'a paragraph added': caughtUp(`[unread]new ${E.party}`)
    });
  });

  test('a text that grows while its host is out of the document is still wrapped only once it has stopped', async () => {
    const result = await inPage('<div id="host"></div>', async (emoji, { WAIT }) => {
      const host = document.getElementById('host');
      const widget = document.createElement('x-widget');
      const root = widget.attachShadow({ mode: 'open' });
      root.innerHTML = '<p>Hi</p>';
      host.appendChild(widget);
      await __t.settle();
      const own = root.querySelector('p').firstChild;

      widget.remove();
      await __t.sleep(20);
      own.appendData(' there');
      await __t.sleep(20);
      own.appendData(` ${emoji}`);
      await __t.sleep(20);

      host.appendChild(widget);
      await __t.settle();
      const back = __t.count(root);
      await __t.sleep(WAIT.later + 200);
      return { back, settled: __t.count(root), text: root.textContent };
    }, E.grin);

    assert.deepEqual(result, { back: 0, settled: 1, text: `Hi there ${E.grin}` });
  });

  test('an element that is out of the document when the extension is switched off gets its text back as well', async () => {
    const result = await inPage(`<div id="host"><p id="p"><b>[</b>kept ${E.grin} view<i>]</i></p></div>`, async (emoji) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.childNodes[1];
      const host = paragraph.parentNode;

      paragraph.remove();
      await __t.sleep(20);
      await chrome.storage.sync.set({ enabled: false });
      await __t.settle();
      const off = { ownNodeHolds: own.data, wrapped: __t.count(paragraph), nodes: paragraph.childNodes.length };

      // Nobody is looking now. What the page writes has to be all there is to show.
      own.data = `kept ${emoji} view, updated`;
      host.appendChild(paragraph);
      await __t.settle();
      return { off, shown: paragraph.textContent };
    }, E.rocket);

    assert.deepEqual(result, {
      off: { ownNodeHolds: `kept ${E.grin} view`, wrapped: 0, nodes: 3 },
      shown: `[kept ${E.rocket} view, updated]`
    });
  });

  // An element that moves into the document of a frame is still "connected", but nothing sees
  // what happens to it there. When it is back, its text node holds text while our nodes show
  // the old one.
  test('a text that was changed unseen is shown once, when it is wrapped again and when the extension is switched off', async () => {
    const result = await inPage(`<div id="host"><p id="a"><b>[</b>frame ${E.grin} 1<i>]</i></p><p id="b"><b>[</b>frame ${E.grin} 1<i>]</i></p></div><iframe id="frame"></iframe>`, async (emoji, { look }) => {
      const host = document.getElementById('host');
      const elsewhere = document.getElementById('frame').contentDocument.body;
      const first = document.getElementById('a');
      const second = document.getElementById('b');

      for (const paragraph of [first, second]) {
        const own = paragraph.childNodes[1];
        elsewhere.appendChild(paragraph);
        await __t.sleep(20);
        own.data = `frame ${emoji} 2`;
        await __t.sleep(20);
      }

      host.appendChild(first);
      await __t.settle();
      const wrappedAgain = look(first);

      // The second one comes back and the extension goes off before it has been looked at.
      host.appendChild(second);
      await chrome.storage.sync.set({ enabled: false });
      await __t.settle();
      return { wrappedAgain, switchedOff: look(second) };
    }, E.rocket);

    assert.deepEqual(result, {
      wrappedAgain: { text: `[frame ${E.rocket} 2]`, wrapped: 1 },
      switchedOff: { text: `[frame ${E.rocket} 2]`, wrapped: 0 }
    });
  });

  test('a text that grows is wrapped once it has stopped, and at once from then on', async () => {
    const result = await inPage('<p id="p">Hi</p>', async (emoji, { tick, look, WAIT }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.firstChild;

      // Each write holds the whole text so far, the way a streamed answer is rendered.
      let text = 'Hi';
      for (const more of [' there', ` ${emoji.grin}`, ' how', ' are']) {
        text += more;
        own.nodeValue = text;
        await __t.sleep(30);
      }
      const whileGrowing = look(paragraph);

      await __t.sleep(WAIT.later + 200);
      const stopped = look(paragraph);

      text += ` you ${emoji.party}`;
      own.nodeValue = text;
      await tick();
      const resumed = look(paragraph);

      own.nodeValue = `Bye ${emoji.rocket}`;
      await tick();
      return { whileGrowing, stopped, resumed, replaced: look(paragraph) };
    }, E);

    assert.deepEqual(result, {
      whileGrowing: { text: `Hi there ${E.grin} how are`, wrapped: 0 },
      stopped: { text: `Hi there ${E.grin} how are`, wrapped: 1 },
      resumed: { text: `Hi there ${E.grin} how are you ${E.party}`, wrapped: 2 },
      replaced: { text: `Bye ${E.rocket}`, wrapped: 1 }
    });
  });

  test('a page that appends to its node loses nothing while it keeps going', async () => {
    const result = await inPage('<p id="p">Log:</p>', async (emoji, { look, WAIT }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.firstChild;
      const seen = [];

      let expected = 'Log:';
      for (const chunk of [' start', ` ${emoji.check}`, ' step', ` ${emoji.fire}`, ' more', ' and more']) {
        own.appendData(chunk);
        expected += chunk;
        // Longer than the wait for a first write, shorter than the wait for a growing text.
        await __t.sleep(WAIT.soon + 150);
        seen.push(paragraph.textContent === expected);
      }
      return { nothingLost: seen, ...look(paragraph) };
    }, E);

    assert.deepEqual(result.nothingLost, Array(6).fill(true));
    assert.equal(result.wrapped, 0, 'still growing, so not wrapped yet');
  });

  test('a page that appends after a long pause is left alone from the first sign on', async () => {
    const result = await inPage('<p id="p">Log:</p>', async (emoji, { tick, WAIT }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.firstChild;

      own.appendData(` one ${emoji.check}`);
      await __t.sleep(WAIT.later + 200);
      const wrappedDuringPause = __t.count(paragraph);

      // The node is empty now, so this cannot be told from a new text, and the old text goes.
      // That happens once: afterwards the node is not wrapped again.
      own.appendData(' two');
      await tick();
      own.appendData(` three ${emoji.fire}`);
      await __t.sleep(WAIT.later + 200);
      own.appendData(' four');
      await tick();
      return { wrappedDuringPause, text: paragraph.textContent, wrapped: __t.count(paragraph) };
    }, E);

    assert.deepEqual(result, { wrappedDuringPause: 1, text: ` two three ${E.fire} four`, wrapped: 0 });
  });

  test('text set to nothing and filled again, as React does to hide and show it, comes back wrapped', async () => {
    const result = await inPage(`<p id="p"><b>a</b>${E.grin} shown<i>z</i></p>`, async (arg, { tick, look, WAIT }) => {
      const paragraph = document.getElementById('p');
      const own = paragraph.childNodes[1];
      const text = own.nextSibling.nextSibling ? paragraph.textContent.slice(1, -1) : '';

      own.nodeValue = '';
      await tick();
      const hidden = look(paragraph);

      own.nodeValue = text;
      await tick();
      const shown = look(paragraph);
      await __t.sleep(WAIT.soon + 150);
      return { hidden, shown, settled: look(paragraph) };
    });

    assert.deepEqual(result, {
      hidden: { text: 'az', wrapped: 0 },
      shown: { text: `a${E.grin} shownz`, wrapped: 0 },
      settled: { text: `a${E.grin} shownz`, wrapped: 1 }
    });
  });

  for (const seed of [1, 2, 3, 4]) {
    test(`random writes, removals, insertions and moves always show what the page meant (seed ${seed})`, { timeout: 60000 }, async () => {
      const result = await inPage('<p id="p"></p>', async ({ emoji, seed }, { tick }) => {
        let state = seed;
        const random = () => {
          state = (state + 0x6D2B79F5) | 0;
          let value = Math.imul(state ^ (state >>> 15), 1 | state);
          value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
        const pick = (list) => list[Math.floor(random() * list.length)];
        const words = ['alpha', 'beta ', ' gamma', 'x', '12:30', ' ', ...Object.values(emoji)];
        const makeText = () => Array.from({ length: Math.floor(random() * 4) }, () => pick(words)).join('');

        // The script's own picture of its text: nodes in order, the value it gave each one, and
        // whether the node is in the page. The nodes themselves are empty while wrapped.
        const paragraph = document.getElementById('p');
        const own = Array.from({ length: 6 }, () => ({ node: document.createTextNode(makeText()), present: false }));
        const values = new Map(own.map((item) => [item, item.node.data]));
        const meant = () => own.filter((item) => item.present).map((item) => values.get(item)).join('');
        const shown = () => paragraph.textContent;

        const place = (item) => {
          const index = own.indexOf(item);
          const next = own.slice(index + 1).find((other) => other.present);
          const previous = own.slice(0, index).reverse().find((other) => other.present);
          // Either in front of the script's next node, or behind its previous one.
          if (previous && random() < 0.5) paragraph.insertBefore(item.node, previous.node.nextSibling);
          else paragraph.insertBefore(item.node, next ? next.node : null);
          item.present = true;
        };

        const failures = [];
        for (let step = 0; step < 400 && failures.length < 3; step++) {
          // Now and then the paragraph as a whole leaves the document or comes back. The script
          // goes on working on it either way.
          if (random() < 0.06) {
            if (paragraph.isConnected) paragraph.remove();
            else document.body.appendChild(paragraph);
          }

          const item = pick(own);
          const action = random();

          try {
            if (action < 0.4) {
              const text = makeText();
              values.set(item, text);
              item.node.nodeValue = text;
            } else if (action < 0.6) {
              if (item.present) {
                paragraph.removeChild(item.node);
                item.present = false;
              } else {
                place(item);
              }
            } else if (action < 0.8) {
              // Move: a different order of the same nodes.
              const from = own.indexOf(item);
              own.splice(from, 1);
              own.splice(Math.floor(random() * (own.length + 1)), 0, item);
              if (item.present) place(item);
            } else if (action < 0.9) {
              // A new node takes the place of the old one.
              const fresh = { node: document.createTextNode(makeText()), present: item.present };
              values.set(fresh, fresh.node.data);
              if (item.present) paragraph.replaceChild(fresh.node, item.node);
              own[own.indexOf(item)] = fresh;
            } else {
              values.set(item, '');
              item.node.nodeValue = '';
            }
          } catch (error) {
            failures.push(`step ${step}: ${error.name}: ${error.message}`);
          }

          // Several changes in one go about half of the time.
          if (random() < 0.5) {
            await tick();
            if (shown() !== meant()) failures.push(`step ${step}: shows ${JSON.stringify(shown())}, meant ${JSON.stringify(meant())}`);
          }
          if (step % 97 === 96) await __t.settle();
        }

        if (!paragraph.isConnected) document.body.appendChild(paragraph);
        await __t.settle();
        if (shown() !== meant()) failures.push(`in the end: shows ${JSON.stringify(shown())}, meant ${JSON.stringify(meant())}`);
        return failures;
      }, { emoji: { grin: E.grin, party: E.party, flag: E.flagChina, family: E.family, keycap: E.keycapOne, heart: E.heart }, seed });

      assert.deepEqual(result, []);
    });
  }

  test('text that is set while its node is being built is wrapped like any new text', async () => {
    const result = await inPage('<div id="host"></div>', async (emoji, { look }) => {
      // Angular makes an empty text node in the document and sets its value right after.
      const host = document.getElementById('host');
      const paragraph = host.appendChild(document.createElement('p'));
      const own = paragraph.appendChild(document.createTextNode(''));
      own.nodeValue = `bound ${emoji.grin}`;
      await __t.settle();
      return look(paragraph);
    }, E);

    assert.deepEqual(result, { text: `bound ${E.grin}`, wrapped: 1 });
  });
});
