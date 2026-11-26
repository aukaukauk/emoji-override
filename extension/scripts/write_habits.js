// Decides, from the way a page writes to one of its text nodes, when that node may be wrapped.
//
// A wrapped text node is left in place but emptied, and its text is shown by nodes of our own
// (see emoji_replacer.js). When the page writes to the node afterwards, what it wrote is taken
// to be the complete new text. That is right for a page that sets the whole text each time, as
// the frameworks do. It is wrong for a page that appends to what is there, because its node no
// longer holds the text it is adding to, and what was shown before would be lost.
//
// One write does not tell the two apart, so a node is watched first. This file holds that
// judgement and nothing else: no DOM, no timers.
(() => {
  // What is known about a node, its habit:
  //   undefined   nothing yet
  //   'growing'   every write so far added to the end: a stream of ever longer texts, or a page
  //               that appends
  //   'held'      it was wrapped while growing, and the next write did not repeat the old text.
  //               A page that appends would do exactly that, so the node is left alone until a
  //               write shows that the page sets the whole text.
  //   'replaced'  the page sets the whole text
  //
  // When to wrap after a write:
  //   'now'    the page sets the whole text, so nothing can be lost
  //   'soon'   nothing is known; the write may be the first of several
  //   'later'  the text is growing; wait until it has stopped
  //   'never'  there is nothing to wrap, or the node is held
  const WAIT_MS = { now: 0, soon: 300, later: 1500 };

  function whenFor(habit) {
    if (habit === 'replaced') return 'now';
    if (habit === 'held') return 'never';
    return habit === 'growing' ? 'later' : 'soon';
  }

  const extends_ = (before, after) => after.length > before.length && after.startsWith(before);

  // `wrapped` says whether the node was wrapped when the page wrote to it. `before` is the text
  // it showed until then and `after` is what the node holds now.
  function afterWrite(habit, { wrapped, before, after }) {
    if (after === '') return { habit, wrap: 'never' };

    if (wrapped) {
      // The node was empty, and the page wrote the old text again with more behind it. Only a
      // page that keeps the whole text itself can do that.
      if (before !== '' && extends_(before, after)) return { habit: 'replaced', wrap: 'now' };

      // A new text, or a piece appended to the old one: the write looks the same either way. A
      // node that has been growing is more likely appended to, and gets the benefit of the doubt.
      if (habit === 'growing' || habit === 'held') return { habit: 'held', wrap: 'never' };
      return { habit: 'replaced', wrap: 'now' };
    }

    // The first text in an empty node, or the same text again: nothing learned.
    if (before === '' || before === after) return { habit, wrap: whenFor(habit) };

    if (extends_(before, after)) {
      const next = habit || 'growing';
      return { habit: next, wrap: whenFor(next) };
    }

    // The old text did not survive, so the page was not appending.
    return { habit: 'replaced', wrap: 'now' };
  }

  globalThis.__notoEmojiOverride ||= {};
  globalThis.__notoEmojiOverride.habits = { afterWrite, WAIT_MS };
})();
