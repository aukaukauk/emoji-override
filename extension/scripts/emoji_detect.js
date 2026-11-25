// Decides which pieces of a text are emoji that should be drawn with the emoji font.
(() => {
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  // U+200D is the zero width joiner, U+FE0F and U+FE0E select emoji and text presentation, and
  // U+20E3 is the keycap that encloses a digit. They are written as escapes because they are
  // invisible in an editor.
  const RECENT_EMOJI_REGEX = /[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const BROAD_EMOJI_REGEX = /[\u{200D}\u{FE0F}\u{20E3}]|\p{Emoji_Presentation}|\p{Regional_Indicator}|[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const EMOJI_PRESENTATION_REGEX = /\p{Emoji_Presentation}/u;
  const EMOJI_VARIATION_REGEX = /\p{Emoji}\u{FE0F}/u;
  const KEYCAP_REGEX = /^[#*0-9]\u{FE0F}?\u{20E3}$/u;
  const REGIONAL_PAIR_REGEX = /^\p{Regional_Indicator}{2}$/u;

  function splitGraphemes(text) {
    if (!segmenter) return Array.from(text);
    return Array.from(segmenter.segment(text), (item) => item.segment);
  }

  // Cheap test for a whole text: can it contain an emoji cluster at all?
  function hasEmojiCandidate(text) {
    return BROAD_EMOJI_REGEX.test(text);
  }

  // Exact test for one grapheme cluster. Characters that are text-style by default (such as the
  // copyright sign) only count with an emoji variation selector, and never with a text one.
  function isEmojiCluster(text) {
    if (!text || text.includes('\u{FE0E}')) return false;
    return KEYCAP_REGEX.test(text)
      || REGIONAL_PAIR_REGEX.test(text)
      || EMOJI_VARIATION_REGEX.test(text)
      || RECENT_EMOJI_REGEX.test(text)
      || EMOJI_PRESENTATION_REGEX.test(text);
  }

  globalThis.__notoEmojiOverride ||= {};
  globalThis.__notoEmojiOverride.emoji = { splitGraphemes, hasEmojiCandidate, isEmojiCluster };
})();
