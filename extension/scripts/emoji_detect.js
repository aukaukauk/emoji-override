// Decides which pieces of a text are emoji that should be drawn with the emoji font.
(() => {
  // Made for the first text that is split. Setting it up takes a few milliseconds, which a page
  // without emoji never has to spend.
  let segmenter;

  // U+200D is the zero width joiner, U+FE0F and U+FE0E select emoji and text presentation, and
  // U+20E3 is the keycap that encloses a digit. They are written as escapes because they are
  // invisible in an editor.
  const RECENT_EMOJI_REGEX = /[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const BROAD_EMOJI_REGEX = /[\u{200D}\u{FE0F}\u{20E3}]|\p{Emoji_Presentation}|\p{Regional_Indicator}|[\u{1F6D8}\u{1FA89}\u{1FA8A}\u{1FA8E}\u{1FA8F}\u{1FABE}\u{1FAC6}\u{1FAC8}\u{1FACD}\u{1FADC}\u{1FADF}\u{1FAE9}\u{1FAEA}\u{1FAEF}]/u;
  const EMOJI_PRESENTATION_REGEX = /\p{Emoji_Presentation}/u;
  const EMOJI_VARIATION_REGEX = /\p{Emoji}\u{FE0F}/u;
  const KEYCAP_REGEX = /^[#*0-9]\u{FE0F}?\u{20E3}$/u;
  const REGIONAL_PAIR_REGEX = /^\p{Regional_Indicator}{2}$/u;
  // The same test as BROAD_EMOJI_REGEX, for finding one place after the other.
  const BROAD_EMOJI_SEARCH = new RegExp(BROAD_EMOJI_REGEX, 'gu');

  function splitGraphemes(text) {
    if (segmenter === undefined) {
      segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
    }
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

  // Printable ASCII and the common Han characters, as UTF-16 code units. None of them joins up
  // with a neighbour of its own kind, so between two of them one grapheme cluster always ends
  // and another begins, whatever the text around them is.
  function isPlainCodeUnit(code) {
    return (code >= 0x20 && code <= 0x7E) || (code >= 0x4E00 && code <= 0x9FFF);
  }

  function breaksAt(text, index) {
    return isPlainCodeUnit(text.charCodeAt(index - 1)) && isPlainCodeUnit(text.charCodeAt(index));
  }

  // Cuts a text at its emoji. Returns the stretches of other text and the emoji in turn, as
  // [text, emoji, text, emoji, ..., text], where a stretch may be empty, or null for a text
  // without emoji.
  //
  // Splitting a text into clusters is slow, and most of a text is nowhere near an emoji. So only
  // the surroundings of the characters that can be part of one are split: from the last sure
  // boundary in front of such a character to the first one behind it. The result is the same
  // as that of going through the whole text cluster by cluster.
  function splitAtEmoji(text) {
    let parts = null;
    let plain = '';
    let done = 0;

    BROAD_EMOJI_SEARCH.lastIndex = 0;
    for (let match = BROAD_EMOJI_SEARCH.exec(text); match; match = BROAD_EMOJI_SEARCH.exec(text)) {
      let start = match.index;
      while (start > done && !breaksAt(text, start)) start -= 1;
      let end = match.index + match[0].length;
      while (end < text.length && !breaksAt(text, end)) end += 1;

      plain += text.slice(done, start);
      for (const cluster of splitGraphemes(text.slice(start, end))) {
        if (isEmojiCluster(cluster)) {
          parts ||= [];
          parts.push(plain, cluster);
          plain = '';
        } else {
          plain += cluster;
        }
      }

      done = end;
      BROAD_EMOJI_SEARCH.lastIndex = end;
    }

    if (!parts) return null;
    parts.push(plain + text.slice(done));
    return parts;
  }

  globalThis.__notoEmojiOverride ||= {};
  globalThis.__notoEmojiOverride.emoji = {
    splitGraphemes,
    hasEmojiCandidate,
    isEmojiCluster,
    splitAtEmoji,
    isPlainCodeUnit
  };
})();
