import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExtensionScript } from './support/load.mjs';

const { splitGraphemes, hasEmojiCandidate, isEmojiCluster, splitAtEmoji, isPlainCodeUnit } = loadExtensionScript('scripts/emoji_detect.js').emoji;

const VS15 = '\u{FE0E}'; // asks for text presentation
const VS16 = '\u{FE0F}'; // asks for emoji presentation
const ZWJ = '\u{200D}';
const KEYCAP = '\u{20E3}';

// The reference is this JavaScript engine's own Unicode data, so the tests need no list of emoji
// to maintain. That data can be older than the bundled font; see the test on recent emoji.
const RGI_EMOJI = /^\p{RGI_Emoji}$/v;
const EMOJI = /^\p{Emoji}$/u;
const EMOJI_PRESENTATION = /^\p{Emoji_Presentation}$/u;
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;
const MODIFIER_BASE = /^\p{Emoji_Modifier_Base}$/u;

const SKIN_TONES = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const REGIONAL_INDICATORS = Array.from({ length: 26 }, (_, index) => String.fromCodePoint(0x1F1E6 + index));

function* everyCharacter() {
  for (let code = 0; code <= 0x10FFFF; code++) {
    if (code >= 0xD800 && code <= 0xDFFF) continue;
    yield String.fromCodePoint(code);
  }
}

// Every emoji the engine knows that can be built without a table of sequences: single
// characters, with the emoji selector where they need one, skin tones, flags and keycaps.
function* knownEmoji() {
  for (const character of everyCharacter()) {
    if (RGI_EMOJI.test(character)) yield character;
    if (RGI_EMOJI.test(character + VS16)) yield character + VS16;
    if (!MODIFIER_BASE.test(character)) continue;
    for (const tone of SKIN_TONES) {
      if (RGI_EMOJI.test(character + tone)) yield character + tone;
    }
  }
  for (const first of REGIONAL_INDICATORS) {
    for (const second of REGIONAL_INDICATORS) {
      if (RGI_EMOJI.test(first + second)) yield first + second;
    }
  }
  for (const key of '#*0123456789') yield key + VS16 + KEYCAP;
}

function describeText(text) {
  const codes = Array.from(text, (character) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  return `${JSON.stringify(text)} (${codes.join(' ')})`;
}

function assertNone(offenders, message) {
  const shown = offenders.slice(0, 8).map(describeText).join(', ');
  const more = offenders.length > 8 ? `, and ${offenders.length - 8} more` : '';
  assert.equal(offenders.length, 0, `${message}: ${shown}${more}`);
}

// The clusters of a text that would be drawn with the emoji font.
const emojiIn = (text) => splitGraphemes(text).filter(isEmojiCluster);

describe('isEmojiCluster', () => {
  test('accepts every emoji the engine knows', () => {
    const missed = [];
    const split = [];
    let total = 0;

    for (const emoji of knownEmoji()) {
      total += 1;
      if (!isEmojiCluster(emoji)) missed.push(emoji);
      if (splitGraphemes(emoji).length !== 1) split.push(emoji);
    }

    assert.ok(total > 2000, `the engine only produced ${total} emoji to check`);
    assertNone(missed, 'not recognised');
    assertNone(split, 'not kept in one piece');
  });

  test('accepts emoji sequences joined by a zero width joiner or built from tags', () => {
    const sequences = {
      family: `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}${ZWJ}\u{1F466}`,
      technologist: `\u{1F469}${ZWJ}\u{1F4BB}`,
      'astronaut with a skin tone': `\u{1F9D1}\u{1F3FD}${ZWJ}\u{1F680}`,
      'rainbow flag': `\u{1F3F3}${VS16}${ZWJ}\u{1F308}`,
      'pirate flag': `\u{1F3F4}${ZWJ}\u{2620}${VS16}`,
      'heart on fire': `\u{2764}${VS16}${ZWJ}\u{1F525}`,
      'eye in speech bubble': `\u{1F441}${VS16}${ZWJ}\u{1F5E8}${VS16}`,
      'couple with different skin tones': `\u{1F469}\u{1F3FB}${ZWJ}\u{1F91D}${ZWJ}\u{1F468}\u{1F3FF}`,
      'flag of Scotland': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
    };

    for (const [name, sequence] of Object.entries(sequences)) {
      assert.match(sequence, RGI_EMOJI, `${name}: the test data is not an emoji`);
      assert.deepEqual(splitGraphemes(sequence), [sequence], `${name} is kept in one piece`);
      assert.equal(isEmojiCluster(sequence), true, name);
    }
  });

  test('wants the emoji selector on characters that are text by default', () => {
    const wrong = [];
    let total = 0;

    for (const character of everyCharacter()) {
      if (!EMOJI.test(character) || EMOJI_PRESENTATION.test(character)) continue;
      total += 1;
      const bare = isEmojiCluster(character);
      const asEmoji = isEmojiCluster(character + VS16);
      const asText = isEmojiCluster(character + VS15);
      if (bare || !asEmoji || asText) wrong.push(character);
    }

    // The copyright sign, arrows, digits, card suits and so on.
    assert.ok(total > 150, `the engine only produced ${total} such characters`);
    assertNone(wrong, 'handled wrongly');
  });

  test('rejects any emoji that carries the text selector', () => {
    const wrong = [];

    for (const character of everyCharacter()) {
      if (EMOJI_PRESENTATION.test(character) && isEmojiCluster(character + VS15)) wrong.push(character);
    }

    assertNone(wrong, 'accepted with a text selector');
    assert.equal(isEmojiCluster(`\u{2764}${VS15}`), false);
    assert.equal(isEmojiCluster(`1${VS15}${KEYCAP}`), false);
  });

  test('accepts a keycap that was written without the emoji selector', () => {
    for (const key of '#*0123456789') {
      const keycap = key + KEYCAP;
      assert.deepEqual(splitGraphemes(keycap), [keycap]);
      assert.equal(isEmojiCluster(keycap), true, describeText(keycap));
      assert.equal(hasEmojiCandidate(keycap), true, describeText(keycap));
    }
    assert.equal(isEmojiCluster(`a${KEYCAP}`), false);
  });

  test('rejects every character that is not an emoji, with or without a selector', () => {
    const wrong = [];

    for (const character of everyCharacter()) {
      if (EMOJI.test(character) || PICTOGRAPHIC.test(character)) continue;
      if (isEmojiCluster(character) || isEmojiCluster(character + VS16)) wrong.push(character);
    }

    assertNone(wrong, 'taken for an emoji');
    assert.equal(isEmojiCluster(''), false);
  });

  test('accepts the emoji of Unicode 16 and 17', () => {
    // The browser's Unicode data can be older than the bundled font, so these must not depend
    // on it. An engine that already knows them cannot show that: there, this test only confirms
    // that they are accepted.
    const recent = [
      '\u{1FAE9}', '\u{1FAC6}', '\u{1FABE}', '\u{1FADC}', '\u{1FA89}', '\u{1FA8F}', '\u{1FADF}',
      '\u{1FAEA}', '\u{1FAEF}', '\u{1FAC8}', '\u{1FACD}', '\u{1F6D8}', '\u{1FA8A}', '\u{1FA8E}',
      '\u{1F1E8}\u{1F1F6}',
      `\u{1F9D1}${ZWJ}\u{1FA70}`
    ];

    for (const emoji of recent) {
      assert.equal(isEmojiCluster(emoji), true, describeText(emoji));
      assert.equal(hasEmojiCandidate(`a${emoji}b`), true, describeText(emoji));
      assert.deepEqual(emojiIn(`a${emoji}b`), [emoji], describeText(emoji));
    }
  });
});

describe('hasEmojiCandidate', () => {
  test('never rules out a text that holds an emoji', () => {
    const missed = [];
    for (const emoji of knownEmoji()) {
      if (!hasEmojiCandidate(emoji) || !hasEmojiCandidate(`before ${emoji} after`)) missed.push(emoji);
    }
    assertNone(missed, 'ruled out');
  });

  test('rules out text without emoji, apart from two characters that go with emoji', () => {
    const hits = [];
    for (const character of everyCharacter()) {
      if (EMOJI.test(character) || PICTOGRAPHIC.test(character)) continue;
      if (hasEmojiCandidate(character)) hits.push(character);
    }

    // A text with one of these and no emoji is split into clusters, and none of them is an emoji.
    assert.deepEqual(hits, [KEYCAP, VS16]);

    // The joiner is not one of them: it is part of ordinary words in several scripts, and a
    // whole paragraph of those would be split for nothing.
    const devanagari = `\u{0915}\u{094D}${ZWJ}\u{0937}`;
    assert.equal(hasEmojiCandidate(devanagari), false);
    assert.deepEqual(emojiIn(devanagari), []);
    const sinhala = `\u{0DC1}\u{0DCA}${ZWJ}\u{0DBB}\u{0DD3} \u{0DBD}\u{0D82}\u{0D9A}\u{0DCF}`;
    assert.equal(hasEmojiCandidate(sinhala), false);

    for (const text of ['', 'Plain text, 12:30 #1 * (c)', '\u{00A9} \u{2122} \u{00AE} \u{2665} \u{2639} \u{2194}', '\u{4E2D}\u{6587}\u{FF0C}\u{65E5}\u{672C}\u{8A9E}\u{3001}\u{D55C}\u{AD6D}\u{C5B4}']) {
      assert.equal(hasEmojiCandidate(text), false, JSON.stringify(text));
    }
  });
});

describe('splitGraphemes', () => {
  test('keeps each emoji whole and separates neighbours', () => {
    const thumbsUp = '\u{1F44D}\u{1F3FD}';
    const china = '\u{1F1E8}\u{1F1F3}';
    const japan = '\u{1F1EF}\u{1F1F5}';
    const one = `1${VS16}${KEYCAP}`;
    const two = `2${VS16}${KEYCAP}`;
    const family = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;

    assert.deepEqual(splitGraphemes(`a${thumbsUp}b`), ['a', thumbsUp, 'b']);
    assert.deepEqual(splitGraphemes(china + japan), [china, japan]);
    assert.deepEqual(splitGraphemes(one + two), [one, two]);
    assert.deepEqual(splitGraphemes(`${family}\u{1F600}\u{1F600}`), [family, '\u{1F600}', '\u{1F600}']);
    assert.deepEqual(splitGraphemes(''), []);
  });

  test('loses nothing', () => {
    const text = `Cafe\u{0301} \u{1F469}${ZWJ}\u{1F4BB} \u{0915}\u{094D}${ZWJ}\u{0937} \u{1F1E8}\u{1F1F3}\u{1F1EF} ok\r\n`;
    assert.equal(splitGraphemes(text).join(''), text);
  });

  test('sets up what it needs for the first text that is split, not before', () => {
    const Real = Intl.Segmenter;
    let made = 0;
    Intl.Segmenter = class extends Real {
      constructor(...options) {
        super(...options);
        made += 1;
      }
    };

    try {
      // The script once more, as a page loads it.
      const fresh = loadExtensionScript('scripts/emoji_detect.js').emoji;
      assert.equal(fresh.hasEmojiCandidate('no emoji in here'), false);
      assert.equal(fresh.splitAtEmoji('no emoji in here'), null);
      assert.equal(made, 0);

      assert.deepEqual(fresh.splitAtEmoji('one \u{1F600}'), ['one ', '\u{1F600}', '']);
      assert.deepEqual(fresh.splitGraphemes('two'), ['t', 'w', 'o']);
      assert.equal(made, 1);
    } finally {
      Intl.Segmenter = Real;
    }
  });
});

describe('splitAtEmoji', () => {
  // What the text is cut into when every cluster of it is looked at, one after the other.
  function clusterByCluster(text) {
    const parts = [''];
    for (const cluster of splitGraphemes(text)) {
      if (isEmojiCluster(cluster)) parts.push(cluster, '');
      else parts[parts.length - 1] += cluster;
    }
    return parts.length > 1 ? parts : null;
  }

  test('gives the text and the emoji in turn', () => {
    const grin = '\u{1F600}';
    const thumbsUp = '\u{1F44D}\u{1F3FD}';
    const family = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;
    const one = `1${VS16}${KEYCAP}`;

    assert.deepEqual(splitAtEmoji(`Hello ${grin} world`), ['Hello ', grin, ' world']);
    assert.deepEqual(splitAtEmoji(grin), ['', grin, '']);
    assert.deepEqual(splitAtEmoji(`${grin}${thumbsUp} ok ${family}`), ['', grin, '', thumbsUp, ' ok ', family, '']);
    assert.deepEqual(splitAtEmoji(`step ${one}: go`), ['step ', one, ': go']);
    assert.deepEqual(splitAtEmoji(`\u{4E2D}\u{6587}${grin}\u{6587}\u{5B57}`), ['\u{4E2D}\u{6587}', grin, '\u{6587}\u{5B57}']);
  });

  test('gives nothing for a text without emoji', () => {
    assert.equal(splitAtEmoji(''), null);
    assert.equal(splitAtEmoji('plain text, 100% #1 * 2'), null);
    assert.equal(splitAtEmoji(`\u{2764} \u{2764}${VS15} \u{00A9} 2026`), null);
    // Characters that may belong to an emoji, but do not make one here.
    assert.equal(splitAtEmoji(`a${ZWJ}b ${VS16} 1${VS15}`), null);
  });

  test('loses nothing and changes nothing', () => {
    const text = `Cafe\u{0301} \u{1F469}${ZWJ}\u{1F4BB} \u{0915}\u{094D}${ZWJ}\u{0937} \u{1F1E8}\u{1F1F3}\u{1F1EF} ok\r\n`;
    assert.equal(splitAtEmoji(text).join(''), text);
  });

  test('finds the emoji of a long text without splitting all of it', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = `${sentence.repeat(200)}\u{1F600}${sentence.repeat(200)}\u{1F389} end`;
    const real = Intl.Segmenter.prototype.segment;
    let split = 0;

    Intl.Segmenter.prototype.segment = function segment(input) {
      split += input.length;
      return real.call(this, input);
    };
    try {
      assert.deepEqual(splitAtEmoji(text), [sentence.repeat(200), '\u{1F600}', sentence.repeat(200), '\u{1F389}', ' end']);
    } finally {
      Intl.Segmenter.prototype.segment = real;
    }

    assert.ok(split > 0 && split < 20, `${split} of ${text.length} characters were split into clusters`);
  });

  test('only takes a boundary for granted between characters that never join their neighbours', () => {
    const wrong = [];
    for (let code = 0; code <= 0xFFFF; code++) {
      if (!isPlainCodeUnit(code)) continue;

      const character = String.fromCharCode(code);
      // Next to itself, to a letter and to a Han character, and on either side of an emoji:
      // always a cluster of its own.
      const alone = [`${character}${character}`, `a${character}`, `${character}a`, `\u{4E00}${character}`, `${character}\u{4E00}`]
        .every((pair) => splitGraphemes(pair).length === 2)
        && splitGraphemes(`\u{1F600}${character}\u{1F600}`).length === 3;
      if (!alone) wrong.push(character);
    }

    assertNone(wrong, 'join a neighbour');
    assert.equal(isPlainCodeUnit(0x0A), false);
    assert.equal(isPlainCodeUnit(0x0301), false);
    assert.equal(isPlainCodeUnit(0xD83D), false);
  });

  test('agrees with going through the whole text cluster by cluster', () => {
    const alphabet = [
      'a', 'b', 'x', ' ', ' ', '1', '9', '#', '*', '.', '\n', '\r', '\t',
      'e\u{0301}', '\u{0301}', ZWJ, VS16, VS15, KEYCAP,
      '\u{1F600}', '\u{1F44D}', '\u{1F3FD}', '\u{1F1E8}', '\u{1F1F3}', '\u{1F468}', '\u{1F469}', '\u{1F3F4}',
      '\u{2764}', '\u{2705}', '\u{231A}', '\u{00A9}', '\u{1FAE9}', '\u{E0067}', '\u{E007F}',
      '\u{4E2D}', '\u{6587}', '\u{3042}', '\u{3099}', '\u{FF9E}', '\u{AC00}', '\u{1100}', '\u{1161}',
      '\u{0915}', '\u{094D}', '\u{0937}', '\u{0600}', '\u{0E01}', '\u{0E33}', '\u{D83D}'
    ];

    // A fixed sequence, so that a failure can be repeated.
    let seed = 20261125;
    const next = (below) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7FFFFFFF;
      return seed % below;
    };

    const wrong = [];
    let withEmoji = 0;
    for (let round = 0; round < 40000; round++) {
      let text = '';
      for (let length = 1 + next(16); length > 0; length--) text += alphabet[next(alphabet.length)];

      const expected = clusterByCluster(text);
      if (expected) withEmoji += 1;
      if (JSON.stringify(splitAtEmoji(text)) !== JSON.stringify(expected)) wrong.push(text);
    }

    assertNone(wrong, 'are cut differently');
    assert.ok(withEmoji > 20000, `only ${withEmoji} of the texts held an emoji`);
  });
});

describe('emoji in running text', () => {
  test('follows the presentation each character asks for', () => {
    const heart = '\u{2764}';
    const check = '\u{2705}';

    assert.deepEqual(
      emojiIn(`Done ${check}, ${heart}${VS16} it. Not ${heart}, not ${heart}${VS15}, not \u{00A9} 2026.`),
      [check, heart + VS16]
    );
    assert.deepEqual(
      emojiIn(`\u{2639}${VS16} \u{2665}${VS16} \u{2122}${VS16} \u{00A9}${VS16} \u{00AE}${VS16} 1${VS16}${KEYCAP} #${VS16}${KEYCAP} *${VS16}${KEYCAP}`).length,
      8
    );
    assert.deepEqual(emojiIn('\u{00A9} \u{2122} \u{00AE} \u{2665} \u{2639} 1 # *'), []);
  });
});
