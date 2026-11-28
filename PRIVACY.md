# Privacy Policy

Noto Emoji Override changes how emoji are displayed on webpages by applying the bundled Google Noto Color Emoji font to detected emoji characters.

## Data processed locally

The extension runs a content script on supported webpages. That script inspects page text nodes locally in the browser to find emoji grapheme clusters and wrap them for styling.

One small script runs in the page's own JavaScript world, where it can see whether the page's framework has finished starting up. It answers the other scripts with yes or no, reads nothing else, and changes nothing.

This processing happens on the user's device. Page content is not sent to the developer or to external services.

## Stored settings

The extension stores these settings:

- `enabled`: a boolean stored in `chrome.storage.sync` to remember whether the extension is globally enabled.
- `blockedHosts`: an array of exact hostnames stored in `chrome.storage.local` to remember sites where the user disabled the override. Early versions stored this list in `chrome.storage.sync`. A list that is still there is copied to `chrome.storage.local` and is not removed, so that each browser signed in to the account can make its own copy.

These settings are used only to provide the extension's emoji display controls.

## Data sharing

The extension does not sell, transfer, or share user data with third parties. It does not use user data for advertising, credit-worthiness, or any purpose unrelated to emoji display replacement.

## Remote code

The extension does not load or execute remote JavaScript or WebAssembly. The bundled font file is included in the extension package.
