import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, skipWithoutChrome, useBrowser } from './support/harness.mjs';

// Translators, search highlighters, and scripts that replace words or tidy up the document all
// work on whatever text nodes they find, without knowing whose they are. Whatever they do, no
// text may get lost and the emoji stay wrapped.
describe('scripts that edit text all over the page', skipWithoutChrome, () => {
  const browser = useBrowser();

  const body = `<main id="main">
<p>The cloud is ${E.fire} today, see https://example.com/a now ${E.rocket}.</p>
<p>${E.grin} Leading emoji and a cloud</p>
<p><b>Bold cloud</b> then ${E.thumbsUpMedium} plain cloud text ${E.party}</p>
<ul><li>${E.check}</li><li>cloud ${E.flagChina} cloud</li><li>no emoji, just a cloud</li></ul>
</main>`;

  // Runs a tool in a page where everything has been wrapped. `tool` gets the root element and
  // may return a function that undoes what it did.
  async function withTool(tool, { expected = (text) => text } = {}) {
    const page = await browser.open({ body });
    const result = await page.evaluate(`async () => {
      const root = document.getElementById('main');
      const textNodes = () => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        return nodes;
      };
      await __t.settle();
      const before = { text: root.textContent, wrapped: __t.count(root) };

      const undo = (${tool})(root, textNodes);
      await __t.sleep(0);
      await __t.settle();
      const after = { text: root.textContent, wrapped: __t.count(root) };

      let undone = null;
      if (undo) {
        undo();
        await __t.sleep(0);
        await __t.settle();
        undone = { text: root.textContent, wrapped: __t.count(root) };
      }

      // The extension still does its work afterwards.
      root.insertAdjacentHTML('beforeend', '<p id="late">late ${E.grin}</p>');
      await __t.settle();
      return { before, after, undone, late: __t.count('#late') };
    }`);

    assert.equal(result.before.wrapped, 7);
    assert.equal(result.after.text, expected(result.before.text));
    assert.equal(result.after.wrapped, 7, 'every emoji is still wrapped');
    if (result.undone) assert.deepEqual(result.undone, result.before);
    assert.equal(result.late, 1);
    assert.deepEqual(page.errors, []);
    await page.close();
  }

  const upperCased = (text) => text.replace(/[a-z]+/gi, (word) => word.toUpperCase());

  test('a translator that replaces each text node with an element, and can put the original back', async () => {
    await withTool((root, textNodes) => {
      // What the translation built into Chrome does: <font><font>translated</font></font>.
      const replaced = [];
      for (const node of textNodes()) {
        if (!/[a-z]/i.test(node.data)) continue;
        const outer = document.createElement('font');
        const inner = outer.appendChild(document.createElement('font'));
        inner.textContent = node.data.replace(/[a-z]+/gi, (word) => word.toUpperCase());
        node.parentNode.replaceChild(outer, node);
        replaced.push([outer, node]);
      }
      return () => {
        for (const [outer, node] of replaced) outer.parentNode.replaceChild(node, outer);
      };
    }, { expected: upperCased });
  });

  test('a translator that rewrites text nodes in place', async () => {
    await withTool((root, textNodes) => {
      const originals = new Map();
      for (const node of textNodes()) {
        if (!/[a-z]/i.test(node.data)) continue;
        originals.set(node, node.data);
        node.textContent = node.data.replace(/[a-z]+/gi, (word) => word.toUpperCase());
      }
      return () => {
        for (const [node, text] of originals) node.textContent = text;
      };
    }, { expected: upperCased });
  });

  test('a search highlighter that splits text nodes, and normalizes when it removes its marks', async () => {
    await withTool((root, textNodes) => {
      // The way mark.js and Sphinx do it.
      for (let node of textNodes()) {
        let index = node.data.indexOf('cloud');
        while (index !== -1) {
          const match = node.splitText(index);
          node = match.splitText('cloud'.length);
          const mark = document.createElement('mark');
          mark.textContent = match.data;
          match.parentNode.replaceChild(mark, match);
          index = node.data.indexOf('cloud');
        }
      }
      return () => {
        for (const mark of root.querySelectorAll('mark')) {
          const parent = mark.parentNode;
          parent.replaceChild(document.createTextNode(mark.textContent), mark);
          parent.normalize();
        }
      };
    });
  });

  test('Node.normalize() on its own', async () => {
    await withTool((root) => {
      root.normalize();
    });
  });

  test('a script that removes empty text nodes', async () => {
    await withTool((root, textNodes) => {
      for (const node of textNodes()) {
        if (node.data === '') node.remove();
      }
    });
  });

  test('a word replacer that writes back only what it changed', async () => {
    await withTool((root, textNodes) => {
      for (const node of textNodes()) {
        const replaced = node.nodeValue.replace(/cloud/g, 'butt');
        if (replaced !== node.nodeValue) node.nodeValue = replaced;
      }
    }, { expected: (text) => text.replace(/cloud/g, 'butt') });
  });

  test('a script that writes every text node back, changed or not', async () => {
    await withTool((root, textNodes) => {
      // Hyphenation and typography scripts tend to be written like this.
      for (const node of textNodes()) {
        node.nodeValue = node.nodeValue.replace(/cloud/g, 'cl\u{AD}oud');
      }
    }, { expected: (text) => text.replace(/cloud/g, 'cl\u{AD}oud') });
  });

  test('a linkifier that replaces a text node with text and a link', async () => {
    await withTool((root, textNodes) => {
      for (const node of textNodes()) {
        const match = /https:\/\/\S+/.exec(node.data);
        if (!match) continue;
        const link = Object.assign(document.createElement('a'), { href: match[0], textContent: match[0] });
        const fragment = document.createDocumentFragment();
        fragment.append(node.data.slice(0, match.index), link, node.data.slice(match.index + match[0].length));
        node.parentNode.replaceChild(fragment, node);
      }
    });
  });

  test('a script that wraps every piece of text in an element of its own', async () => {
    await withTool((root, textNodes) => {
      for (const node of textNodes()) {
        if (!node.data.trim() || node.parentNode.closest('.noto-emoji-wrapped')) continue;
        const wrapper = document.createElement('span');
        node.parentNode.insertBefore(wrapper, node);
        wrapper.appendChild(node);
      }
    });
  });
});
