/**
 * Emoji Replacer
 * 
 * This script scans the DOM for emoji characters and wraps them in a span
 * with a specific class. This allows us to apply the Noto Color Emoji font
 * *only* to the emojis, preventing the "font change" issue on other text.
 */

const CLASS_NAME = 'noto-emoji-wrapped';
const ENABLED_CLASS = 'noto-emoji-enabled';

// Regex to match emojis.
const EMOJI_REGEX = /(\p{Extended_Pictographic}|\p{Emoji_Presentation})/u;

function isElement(node) {
    return node.nodeType === Node.ELEMENT_NODE;
}

function shouldSkip(node) {
    if (!isElement(node)) return false;

    const tagName = node.tagName.toUpperCase();
    // Skip inputs, textareas, scripts, styles, etc.
    if (['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'SVG'].includes(tagName)) {
        return true;
    }

    // Skip if already wrapped
    if (node.classList.contains(CLASS_NAME)) {
        return true;
    }

    // Skip contenteditable elements (complexity risk), BUT check if it's just a container
    // If the node itself is contenteditable="true", skip.
    // If it inherits it, we might still want to skip to avoid breaking editors.
    if (node.isContentEditable) {
        return true;
    }

    return false;
}

function processNode(node) {
    // Only process text nodes
    if (node.nodeType !== Node.TEXT_NODE) return;

    // Skip if no emoji
    if (!EMOJI_REGEX.test(node.textContent)) return;

    // Skip if parent should be ignored
    if (shouldSkip(node.parentNode)) return;

    const fragment = document.createDocumentFragment();
    const text = node.textContent;

    const parts = text.split(EMOJI_REGEX);

    // If split didn't work as expected or no split happened
    if (parts.length === 1) return;

    parts.forEach(part => {
        if (!part) return;

        if (EMOJI_REGEX.test(part)) {
            const span = document.createElement('span');
            span.textContent = part;
            span.classList.add(CLASS_NAME);
            fragment.appendChild(span);
        } else {
            fragment.appendChild(document.createTextNode(part));
        }
    });

    node.parentNode.replaceChild(fragment, node);
}

function walk(root) {
    if (!document.documentElement.classList.contains(ENABLED_CLASS)) return;

    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (shouldSkip(node.parentNode)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const nodes = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }

    nodes.forEach(processNode);

    // Handle Shadow DOM
    if (root.shadowRoot) {
        walk(root.shadowRoot);
    }

    // Recursively check children for shadow roots
    const elements = root.querySelectorAll('*');
    elements.forEach(el => {
        if (el.shadowRoot) {
            walk(el.shadowRoot);
        }
    });
}

// Observer to handle dynamic content
const observer = new MutationObserver((mutations) => {
    if (!document.documentElement.classList.contains(ENABLED_CLASS)) return;

    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    processNode(node);
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    walk(node);
                }
            });
        } else if (mutation.type === 'characterData') {
            processNode(mutation.target);
        }
    });
});

function init() {
    // Initial run
    walk(document.body);

    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// Wait for body
if (document.body) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}

// Listen for class changes on HTML to enable/disable
const attrObserver = new MutationObserver((mutations) => {
    mutations.forEach(m => {
        if (m.attributeName === 'class') {
            if (document.documentElement.classList.contains(ENABLED_CLASS)) {
                walk(document.body);
            }
        }
    });
});

attrObserver.observe(document.documentElement, { attributes: true });
