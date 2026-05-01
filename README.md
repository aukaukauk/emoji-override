# Noto Emoji Override / Noto Emoji 覆盖

## Overview / 概述

Noto Emoji Override is a lightweight Chrome extension that prefers Google's Noto Color Emoji on webpages without replacing the site's normal text font.

这个扩展的目标很窄：尽量只把网页里的 emoji 替换成 Google Noto Color Emoji，同时保留网页原来的正文、标题和代码字体。

## Features / 功能

- Wraps emoji grapheme clusters in lightweight spans instead of applying a global `font-family`.
- Uses `Intl.Segmenter` to keep common emoji sequences together, including flags, skin tones, keycaps, and ZWJ sequences.
- Handles dynamic page updates with `MutationObserver` only while the extension is active.
- Supports open Shadow DOM roots when they can be discovered from the page.
- Avoids DOM rewriting in editing-sensitive areas such as `input`, `textarea`, `select`, `contenteditable`, `pre`, `code`, `kbd`, and `samp`.
- Provides a global enable/disable switch and an exact-host block list.

## Installation / 安装

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Choose "Load unpacked" and select the `extension/` folder.

## Usage / 使用

- Click the extension icon to enable or disable the override globally.
- Use "Block This Site" / "Unblock This Site" to manage the current exact host.
- Open `extension/test/index.html` after loading the extension to check common emoji sequences and dynamic content.

站点屏蔽是 exact host 规则。例如屏蔽 `example.com` 不会自动屏蔽 `sub.example.com`。

## Privacy / 隐私

The extension does not send browsing data anywhere. It stores:

- `enabled` in `chrome.storage.sync` so the global switch can sync across Chrome profiles.
- `blockedHosts` in `chrome.storage.local` so the per-site list stays local to this browser profile.

The content script runs on matched webpages because the extension has to inspect text nodes locally in the page DOM.

See `PRIVACY.md` for the full privacy policy.

## Permissions / 权限

- `storage`: saves the global switch and exact-host block list.
- `activeTab`: lets the popup read the current tab URL after the user opens the extension action.
- `<all_urls>` content script match: allows the local DOM pass to run on webpages where emoji may appear.

## Technical Notes / 技术说明

- Emoji detection is based on grapheme segmentation plus Unicode emoji-related properties. This is much safer than splitting by single code point, but it is still not a complete Unicode emoji conformance test suite.
- Wrapped emoji use `font-family: var(--emoji-override-font-family, inherit)`, so turning the extension off makes already-wrapped spans visually inherit the page font again.
- Closed Shadow DOM cannot be inspected or modified by the extension.
- Very dynamic pages may briefly show the platform emoji before the queued DOM pass wraps new text.

## Known Limitations / 已知限制

- Inputs and textareas cannot have individual emoji characters wrapped, so the extension leaves them unchanged.
- Pages that render emoji as images or canvas content are outside the scope of this extension.
- If a page uses unusual custom text rendering or closed Shadow DOM, the extension may not affect that content.

## Third-Party Assets / 第三方资源

The bundled `extension/fonts/NotoColorEmoji.ttf` file comes from Google Noto Emoji and is licensed separately under the SIL Open Font License 1.1. See `THIRD_PARTY_LICENSES.md`.
