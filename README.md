<p align="right">
  <a href="./README.zh-CN.md">简体中文</a>
</p>

# Noto Emoji Override

## Overview

Noto Emoji Override is a lightweight Chrome extension that prefers Google's Noto Color Emoji on webpages without replacing the site's normal text font.

Its scope is intentionally narrow: emoji are wrapped and styled separately, while the page's original body, heading, and code fonts remain intact.

## Features

- Wraps emoji grapheme clusters in lightweight spans instead of applying a global `font-family`. The spans use `display: contents`, so they add no box to the page layout.
- Uses `Intl.Segmenter` to keep common emoji sequences together, including flags, skin tones, keycaps, and ZWJ sequences.
- Handles dynamic page updates with `MutationObserver` only while the extension is active.
- Supports open Shadow DOM roots when they can be discovered from the page.
- Avoids DOM rewriting in editing-sensitive areas such as `input`, `textarea`, `select`, `contenteditable`, `pre`, `code`, `kbd`, and `samp`, and inside the Monaco and Ace code editors.
- Provides a global enable/disable switch and an exact-host block list.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Choose "Load unpacked" and select the `extension/` folder.

## Usage

- Click the extension icon to enable or disable the override globally.
- Use "Block This Site" or "Unblock This Site" to manage the current exact host.
- Open `tests/manual/index.html` after loading the extension to check common emoji sequences and dynamic content. Chrome runs an extension on a local file only after "Allow access to file URLs" has been switched on for it in `chrome://extensions`.

Site blocking uses exact-host matching. For example, blocking `example.com` does not automatically block `sub.example.com`.

## Privacy

The extension does not send browsing data anywhere. It stores:

- `enabled` in `chrome.storage.sync` so the global switch can sync across Chrome profiles.
- `blockedHosts` in `chrome.storage.local` so the per-site list stays local to this browser profile.

The content script runs on matched webpages because the extension has to inspect text nodes locally in the page DOM.

See `PRIVACY.md` for the full privacy policy.

## Permissions

- `storage`: saves the global switch and exact-host block list.
- `activeTab`: lets the popup read the current tab URL after the user opens the extension action.
- `<all_urls>` content script match: allows the local DOM pass to run on webpages where emoji may appear.

## Technical Notes

- Emoji detection is based on grapheme segmentation plus Unicode emoji-related properties. This is safer than splitting by single code point, but it is still not a complete Unicode emoji conformance test suite.
- Wrapped emoji use `font-family: var(--emoji-override-font-family, inherit)`, so turning the extension off makes already-wrapped spans visually inherit the page font again.
- Closed Shadow DOM cannot be inspected or modified by the extension.
- Very dynamic pages may briefly show the platform emoji before the queued DOM pass wraps new text.

## Known Limitations

- Inputs and textareas cannot have individual emoji characters wrapped, so the extension leaves them unchanged.
- Pages that render emoji as images or canvas content are outside the scope of this extension.
- Text drawn by inline SVG or MathML elements is left unchanged, because an HTML wrapper is not rendered there. HTML inside `<foreignObject>` is handled normally.
- Text that a page rewrites in place (for example through `nodeValue`) keeps the platform emoji.
- If a page uses unusual custom text rendering or closed Shadow DOM, the extension may not affect that content.

## Development

The extension in `extension/` is plain JavaScript and CSS. It has no dependencies and no build step, and Chrome loads the folder as it is. The tools around it need Node.js 22 or later.

```bash
npm install        # ESLint, which only the checks use
npm run lint
npm test           # unit tests, then browser tests
npm run package    # dist/noto-emoji-override-<version>.zip
```

- `tests/unit/` checks emoji detection, the stored settings and the packaging script. It needs no browser.
- `tests/browser/` loads the extension's scripts into pages in a headless Chrome and checks what they do there. One test file installs the extension itself. These tests use the Chrome installed on the machine and are skipped when there is none; set `CHROME_PATH` if it is in an unusual place.
- `tests/manual/index.html` is a page to check by eye.

`npm run package` builds the zip for the Chrome Web Store from `extension/` and adds `LICENSE`, `NOTICE`, `PRIVACY.md` and `THIRD_PARTY_LICENSES.md` from the repository root. Build releases this way and not by zipping the folder, because the font's license has to travel with the font. To run the browser tests against a built package, unpack it and set `EXTENSION_DIR` to that folder.

## Third-Party Assets

The bundled `extension/fonts/NotoColorEmoji.ttf` file comes from Google Noto Emoji and is licensed separately under the SIL Open Font License 1.1. Its OpenType-SVG table, which Chrome does not use, has been removed to keep the package small. See `THIRD_PARTY_LICENSES.md`.
