import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExtensionScript } from './support/load.mjs';

const { splitGraphemes, hasEmojiCandidate, isEmojiCluster } = loadExtensionScript('scripts/emoji_detect.js').emoji;

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

  test('rules out text without emoji, apart from three joining characters', () => {
    const hits = [];
    for (const character of everyCharacter()) {
      if (EMOJI.test(character) || PICTOGRAPHIC.test(character)) continue;
      if (hasEmojiCandidate(character)) hits.push(character);
    }

    // These also occur in ordinary text, for example between Devanagari letters. Such a text is
    // then split into clusters, and none of its clusters is an emoji.
    assert.deepEqual(hits, [ZWJ, KEYCAP, VS16]);

    const devanagari = `\u{0915}\u{094D}${ZWJ}\u{0937}`;
    assert.equal(hasEmojiCandidate(devanagari), true);
    assert.deepEqual(emojiIn(devanagari), []);

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
