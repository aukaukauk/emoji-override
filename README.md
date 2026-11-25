<p align="right">
  <a href="./README.zh-CN.md">简体中文</a>
</p>

# Noto Emoji Override

## Overview

Noto Emoji Override is a lightweight Chrome extension that prefers Google's Noto Color Emoji on webpages without replacing the site's normal text font.

Its scope is intentionally narrow: emoji are wrapped and styled separately, while the page's original body, heading, and code fonts remain intact.

## Features

- Wraps emoji grapheme clusters in lightweight spans instead of applying a global `font-family`. The spans use `display: contents`, so they add no box to the page layout.
- Leaves the page's own text nodes where they are, so scripts that keep using them, such as React, Vue, Preact, Lit and Angular, go on working.
- On server-rendered pages, waits until the page's framework has taken over the markup before it changes any text, so that the framework finds the page as the server sent it.
- Uses `Intl.Segmenter` to keep common emoji sequences together, including flags, skin tones, keycaps, and ZWJ sequences.
- Handles dynamic page updates with `MutationObserver` only while the extension is active, including text that a script changes in place.
- Works inside shadow roots, open and closed, including ones that are attached shortly after their element appeared.
- Avoids DOM rewriting in editing-sensitive areas such as `input`, `textarea`, `select`, `contenteditable`, `pre`, `code`, `kbd`, and `samp`, and inside the Monaco and Ace code editors.
- Provides a global enable/disable switch and an exact-host block list. Switching off, or blocking a site, puts the text of open pages back as it was.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Choose "Load unpacked" and select the `extension/` folder.

The extension needs Chrome 111 or later.

## Usage

- Click the extension icon and use "Disable" or "Enable" to switch the override off or on everywhere.
- Use "Disable on this site" or "Allow on this site" there to switch it off or back on for the current exact host.
- Both take effect in open pages at once, without a reload.
- Open `tests/manual/index.html` after loading the extension to check common emoji sequences and dynamic content. Chrome runs an extension on a local file only after "Allow access to file URLs" has been switched on for it in `chrome://extensions`.

Site blocking uses exact-host matching. For example, blocking `example.com` does not automatically block `sub.example.com`.

## Privacy

The extension does not send browsing data anywhere. It stores:

- `enabled` in `chrome.storage.sync` so the global switch follows your Chrome account to other devices.
- `blockedHosts` in `chrome.storage.local` so the per-site list stays local to this browser profile.

The content script runs on matched webpages because the extension has to inspect text nodes locally in the page DOM. One small script runs in the page's own world, where it can see whether the page's framework has finished starting up. It tells the other scripts yes or no, reads nothing else and sends nothing anywhere.

See `PRIVACY.md` for the full privacy policy.

## Permissions

- `storage`: saves the global switch and exact-host block list.
- `activeTab`: lets the popup read the current tab URL after the user opens the extension action.
- `<all_urls>` content script match: allows the local DOM pass to run on webpages where emoji may appear.

## Technical Notes

- Emoji detection is based on grapheme segmentation plus Unicode emoji-related properties. This is safer than splitting by single code point, but it is still not a complete Unicode emoji conformance test suite. Characters that are shown as text by default, such as © and ™, count as emoji only when the emoji variation selector follows them.
- A text node with emoji is emptied and stays in its place. Its text is shown by nodes placed right after it: plain text, and one span per emoji. When the page writes to its node again, removes it or moves it, those nodes are replaced, removed or moved with it. That also holds while the element around it is out of the document, as a cached view is; text is only wrapped inside the document, so new text in such an element is wrapped when the element comes back.
- Turning the extension off removes the added nodes and gives each text node its text back. Where another script has rearranged them in the meantime (with `normalize()`, for example), the wrappers stay in the page without their styling.
- Server-rendered markup is recognised by what the server leaves in it: the comments that React, Vue, Svelte and Solid put between texts and around blocks, and the elements that Next.js, Nuxt, Gatsby, Docusaurus and Angular render into. In such a document nothing is wrapped until the framework has taken the markup over ("hydration"). For React and Vue that moment is known exactly: `scripts/page_probe.js` runs in the page's own world, where the marks these frameworks keep on their nodes can be seen, and answers the other scripts with yes or no. Angular and Vue 2 take attributes off the markup as they take it over. For other frameworks the moment is judged by the clock: the document has been parsed, the scripts that were in it have run, and the page has been idle twice in a row.
- Closed shadow roots are reached through `chrome.dom.openOrClosedShadowRoot`.
- Work is done in the browser's idle time, in slices, so very dynamic pages may briefly show the platform emoji before new text is wrapped.
- Text that a script changes in place is wrapped at once when the script is known to set the whole text each time. Otherwise it is wrapped shortly after it has stopped changing, which for a streamed text means after the stream ends or pauses.

## Known Limitations

- Inputs and textareas cannot have individual emoji characters wrapped, so the extension leaves them unchanged.
- Pages that render emoji as images or canvas content are outside the scope of this extension.
- Text drawn by inline SVG or MathML elements is left unchanged, because an HTML wrapper is not rendered there. HTML inside `<foreignObject>` is handled normally.
- A script that appends to a text node in place (`appendData`, `nodeValue +=`) instead of setting the whole text cannot be told from one that replaces the text. Text that is still growing is therefore not wrapped until it stops. If such a script appends again after a pause of more than a second or two, the text it showed before is lost once, and the node is left unwrapped from then on.
- Solid, and Svelte 3 and 4, skip a write when the text node already holds the new value. A wrapped text that such a page clears by setting it to an empty string stays visible.
- On server-rendered pages the emoji keep the platform style until the page's framework has taken over, usually a fraction of a second after the page has loaded. A page that shows none of the usual signs of server rendering is not recognised, and a part that is taken over much later than the rest is not waited for: an island that is only hydrated when it scrolls into view, a Suspense boundary that waits more than a few seconds. Markup that a script puts into the page later and hydrates then is not recognised either. Text in all of these is wrapped early, as it was before this was added. React then reports a hydration error and renders that part again in the browser, and the page ends up correct.
- A shadow root that is attached more than about half a minute after its element appeared, or after loading to an element that is not a custom element, is not found.
- Content inside frames is not handled: the extension runs in the top document of a tab only.
- A copy of wrapped content made with `cloneNode` carries the wrappers and the emptied text node along, and nothing ties the copy to the extension. A script that then writes to a text node of the copy by its position shows the new text next to the old one.
- Where a page leaves `line-height` at `normal`, a line with emoji can be several pixels lower with the extension on than off. The platform's emoji font stretches such a line, and the wrapper keeps the bundled font from doing the same.
- Chrome's built-in page translation treats each wrapper as a break in the sentence, so a sentence with an emoji in the middle is translated in pieces. No text or emoji is lost, and showing the original again works.
- If a page uses unusual custom text rendering, the extension may not affect that content.

## Development

The extension in `extension/` is plain JavaScript and CSS. It has no dependencies and no build step, and Chrome loads the folder as it is. The tools around it need Node.js 22 or later.

```bash
npm install        # ESLint, which only the checks use
npm run lint
npm test           # unit tests, then browser tests
npm run check      # lint, then all tests
npm run package    # dist/noto-emoji-override-<version>.zip
```

- `tests/unit/` checks emoji detection, the stored settings, the decisions about text that a page changes in place, and the packaging script. It needs no browser.
- `tests/browser/` loads the extension's scripts into pages in a headless Chrome and checks what they do there. One test file installs the extension itself. These tests use the Chrome installed on the machine and are skipped when there is none; set `CHROME_PATH` if it is in an unusual place.
- `tests/manual/index.html` is a page to check by eye.

`npm run package` builds the zip for the Chrome Web Store from `extension/` and adds `LICENSE`, `NOTICE`, `PRIVACY.md` and `THIRD_PARTY_LICENSES.md` from the repository root. Build releases this way and not by zipping the folder, because the font's license has to travel with the font. To run the browser tests against a built package, unpack it and set `EXTENSION_DIR` to that folder.

## Third-Party Assets

The bundled `extension/fonts/NotoColorEmoji.ttf` file comes from Google Noto Emoji and is licensed separately under the SIL Open Font License 1.1. Its OpenType-SVG table, which Chrome does not use, has been removed to keep the package small. See `THIRD_PARTY_LICENSES.md`.
