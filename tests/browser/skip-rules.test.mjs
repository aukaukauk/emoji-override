import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { E, chromeStub, skipWithoutChrome, useBrowser } from './support/harness.mjs';

const SVG = 'http://www.w3.org/2000/svg';

describe('places that must be left alone', skipWithoutChrome, () => {
  const browser = useBrowser();

  test('code, keyboard and sample text at any depth', async () => {
    const page = await browser.open({
      body: `<pre id="pre">direct ${E.grin}</pre>
<pre><code id="code"><span class="token">"highlighted ${E.grin}"</span> <span>// ${E.party}</span></code></pre>
<p>inline <code id="inline">code <b>bold ${E.grin}</b></code> <kbd id="kbd"><span>Ctrl ${E.grin}</span></kbd> <samp id="samp"><i>out ${E.grin}</i></samp></p>
<textarea id="textarea">textarea ${E.grin}</textarea>
<p id="ordinary">ordinary ${E.grin} <b>bold ${E.thumbsUp}</b></p>`
    });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const counts = () => Object.fromEntries(['pre', 'code', 'inline', 'kbd', 'samp', 'textarea', 'ordinary']
        .map((id) => [id, __t.count('#' + id)]));
      const first = counts();
      const span = document.createElement('span');
      span.textContent = ` appended ${emoji}`;
      document.getElementById('pre').appendChild(span);
      await __t.settle();
      return { first, preAfterAppend: __t.count('#pre') };
    }, E.party);

    assert.deepEqual(result.first, { pre: 0, code: 0, inline: 0, kbd: 0, samp: 0, textarea: 0, ordinary: 2 });
    assert.equal(result.preAfterAppend, 0);
    await page.close();
  });

  test('text drawn by SVG and MathML, but not HTML inside foreignObject', async () => {
    const page = await browser.open({
      body: `<svg width="320" height="40"><text id="text" x="4" y="28" font-size="20">Deploy ${E.rocket} <tspan>done ${E.check}</tspan></text></svg>
<svg width="320" height="40"><foreignObject width="320" height="40"><div xmlns="http://www.w3.org/1999/xhtml" id="label">label ${E.rocket}</div></foreignObject></svg>
<math><mtext id="math">math ${E.grin}</mtext></math>
<div id="slot"></div>
<script>window.lengthBefore = document.getElementById('text').getComputedTextLength();</script>`
    });

    const result = await page.evaluate(async ({ emoji, svgNamespace }) => {
      await __t.settle();
      // A finished drawing inserted in one piece, the way diagram libraries mount their output.
      const drawing = document.createElementNS(svgNamespace, 'svg');
      drawing.innerHTML = `<text x="4" y="20">drawn ${emoji}</text><foreignObject width="300" height="40">`
        + `<div xmlns="http://www.w3.org/1999/xhtml" id="mounted">mounted ${emoji}</div></foreignObject>`;
      document.getElementById('slot').appendChild(drawing);
      await __t.settle();
      return {
        svgText: __t.count('#text'),
        math: __t.count('#math'),
        label: __t.count('#label'),
        mounted: __t.count('#mounted'),
        spansWithoutHtmlParent: __t.wrapped().filter((span) => span.parentNode.namespaceURI !== 'http://www.w3.org/1999/xhtml').length,
        lengthUnchanged: window.lengthBefore === document.getElementById('text').getComputedTextLength()
      };
    }, { emoji: E.party, svgNamespace: SVG });

    assert.deepEqual(result, { svgText: 0, math: 0, label: 1, mounted: 1, spansWithoutHtmlParent: 0, lengthUnchanged: true });
    await page.close();
  });

  test('editors, including read-only islands and hidden ones', async () => {
    const page = await browser.open({
      body: `<div contenteditable id="empty">empty attribute <b>${E.grin}</b></div>
<div contenteditable="true" id="true">true <b>${E.grin}</b> <span contenteditable="false" id="island">island ${E.grin}</span></div>
<div contenteditable="TRUE" id="upper">upper case <b>${E.grin}</b></div>
<div contenteditable="plaintext-only" id="plaintext">plaintext-only <b>${E.grin}</b></div>
<div contenteditable="true" style="display:none" id="hidden"><p>hidden <b>${E.grin}</b></p></div>
<div contenteditable="false" id="notEditable">not editable <b>${E.grin}</b></div>
<div contenteditable="bogus" id="invalid">an invalid value means inherit <b>${E.grin}</b></div>`
    });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const later = document.createElement('i');
      later.textContent = ` later ${emoji}`;
      document.getElementById('island').appendChild(later);
      await __t.settle();
      return Object.fromEntries(['empty', 'true', 'island', 'upper', 'plaintext', 'hidden', 'notEditable', 'invalid']
        .map((id) => [id, __t.count('#' + id)]));
    }, E.party);

    assert.deepEqual(result, { empty: 0, true: 0, island: 0, upper: 0, plaintext: 0, hidden: 0, notEditable: 1, invalid: 1 });
    await page.close();
  });

  test('code editors that draw their lines with plain elements', async () => {
    const line = `<div class="view-line"><span><span class="mtk1">graph TD; A[Deploy ${E.rocket}] --&gt; B[Done ${E.check}]</span></span></div>`;
    const page = await browser.open({
      body: `<div class="monaco-editor" id="monaco"><div class="view-lines" id="lines">${line}</div></div>
<div class="ace_editor" id="ace"><div class="ace_line"><span class="ace_string">"Hello ${E.grin}"</span> ${E.party}</div></div>`
    });

    const result = await page.evaluate(async (lineHtml) => {
      await __t.settle();
      const first = { monaco: __t.count('#monaco'), ace: __t.count('#ace') };
      // The editor re-renders a line after a keystroke.
      document.getElementById('lines').innerHTML = lineHtml;
      await __t.settle();
      return { first, afterRerender: __t.count('#monaco'), tokenChildren: document.querySelector('#monaco .mtk1').childNodes.length };
    }, line);

    assert.deepEqual(result, { first: { monaco: 0, ace: 0 }, afterRerender: 0, tokenChildren: 1 });
    await page.close();
  });

  test('the document head, including a title that changes later', async () => {
    const page = await browser.open({ head: `<title>Initial ${E.grin} title</title>`, body: `<p id="a">${E.grin}</p>` });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const initialTitle = document.title;
      document.title = `Changed ${emoji} title`;
      const style = document.createElement('style');
      style.textContent = `#a::after { content: " ${emoji}"; }`;
      document.head.appendChild(style);
      await __t.settle();
      return {
        initialTitle,
        title: document.title,
        spansInHead: __t.count(document.head),
        styleIntact: style.textContent === `#a::after { content: " ${emoji}"; }`,
        body: __t.count('#a')
      };
    }, E.party);

    assert.deepEqual(result, {
      initialTitle: `Initial ${E.grin} title`,
      title: `Changed ${E.party} title`,
      spansInHead: 0,
      styleIntact: true,
      body: 1
    });
    await page.close();
  });

  test('text written in place inside such places is left alone as well', async () => {
    const page = await browser.open({
      body: `<pre id="pre">code</pre>
<div id="editor" contenteditable="true"><p>typed</p></div>
<div class="monaco-editor"><div class="view-line"><span id="monaco">let a</span></div></div>
<svg width="200" height="30"><text id="svg" x="0" y="20">label</text></svg>
<textarea id="area">field</textarea>
<style id="style">p{color:inherit}</style>
<p id="plain">plain</p>
<p id="comment"><!--note--></p>`
    });

    const result = await page.evaluate(async (emoji) => {
      await __t.settle();
      const ids = ['pre', 'editor', 'monaco', 'svg', 'area', 'style', 'plain'];
      const nodes = ids.map((id) => {
        const walker = document.createTreeWalker(document.getElementById(id), NodeFilter.SHOW_TEXT);
        return walker.nextNode();
      });
      const comment = document.getElementById('comment').firstChild;

      // First a longer text, then a different one: both ways of changing a text node.
      for (const node of nodes) node.appendData(` ${emoji}`);
      comment.data = `note ${emoji}`;
      await __t.sleep(window.__notoEmojiOverride.habits.WAIT_MS.later + 200);
      const grown = ids.map((id) => __t.count(`#${id}`));

      // Two different texts in a row: after the first, a text that had been growing is left
      // alone, because the page might be appending. The second shows that it is not.
      for (const text of [`other ${emoji} text`, `another ${emoji} text`]) {
        for (const node of nodes) node.nodeValue = text;
        comment.data = text;
        await __t.sleep(0);
      }
      await __t.settle();
      return { grown, replaced: ids.map((id) => __t.count(`#${id}`)), commentWrapped: __t.count('#comment') };
    }, E.grin);

    // Only the ordinary paragraph, last in the list, is wrapped.
    assert.deepEqual(result, { grown: [0, 0, 0, 0, 0, 0, 1], replaced: [0, 0, 0, 0, 0, 0, 1], commentWrapped: 0 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('XML documents get working wrappers instead of an exception', async () => {
    const page = await browser.chrome.newPage();
    await page.addInitScript(chromeStub());
    // In an XML document createElement() makes a plain element without `style`.
    await page.goto(browser.server.rawPage(
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>xml</title>${browser.server.extensionTags}</head>
<body><p id="p">xml paragraph ${E.grin}</p></body></html>`,
      'application/xml'
    ));

    const result = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const span = document.querySelector('.noto-emoji-wrapped');
      return {
        contentType: document.contentType,
        wrapped: document.querySelectorAll('.noto-emoji-wrapped').length,
        styled: Boolean(span && span.style && span.style.display === 'contents')
      };
    });

    assert.deepEqual(result, { contentType: 'application/xml', wrapped: 1, styled: true });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the rows of an xterm.js terminal', async () => {
    const page = await browser.open({
      body: `<div class="terminal xterm"><div class="xterm-screen"><div class="xterm-rows"><div><span>$ echo ${E.grin}</span></div><div><span>${E.grin}</span></div></div></div></div><p id="a">outside ${E.grin}</p>`
    });

    const result = await page.evaluate(async () => {
      await __t.settle();
      return { terminal: __t.count('.xterm'), outside: __t.count('#a') };
    });

    assert.deepEqual(result, { terminal: 0, outside: 1 });
    await page.close();
  });
});
