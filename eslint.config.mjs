import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/'] },

  js.configs.recommended,

  {
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error'
    }
  },

  {
    // The extension: classic scripts with no build step. `ecmaVersion` keeps out syntax that the
    // oldest Chrome the manifest allows (minimum_chrome_version) cannot parse. It does not check
    // which built-in functions exist there.
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' }
    },
    rules: {
      // The files of one content script share a global scope, so each keeps to itself inside
      // a function.
      'no-implicit-globals': 'error',

      // Joiners and selectors are invisible, and belong in the source as escapes only.
      'no-misleading-character-class': ['error', { allowEscape: true }]
    }
  },

  {
    // Tests and tools run on Node.
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    }
  },

  {
    // Browser tests also hold functions that are sent to the page and run there. `__t` and
    // `__chromeStub` are put into the page by tests/browser/support/harness.mjs.
    files: ['tests/browser/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly', __t: 'readonly', __chromeStub: 'readonly' }
    }
  }
];
