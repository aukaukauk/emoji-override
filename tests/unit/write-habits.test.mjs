import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExtensionScript } from './support/load.mjs';

const { habits } = loadExtensionScript('scripts/write_habits.js');

// Plays a page's writes to one text node and returns what was decided after each of them.
// A step is `[kind, before, after]`, where the kind says whether the node was wrapped when the
// page wrote to it.
function play(steps, habit) {
  const decisions = [];
  let current = habit;
  for (const [kind, before, after] of steps) {
    const result = habits.afterWrite(current, { wrapped: kind === 'wrapped', before, after });
    current = result.habit;
    decisions.push(`${result.habit ?? 'unknown'}/${result.wrap}`);
  }
  return decisions;
}

describe('a page that sets the whole text', () => {
  test('is recognised when it overwrites a wrapped text, and wrapped at once from then on', () => {
    assert.deepEqual(play([
      ['wrapped', 'Saved \u{2705}', 'Failed \u{274C}'],
      ['wrapped', 'Failed \u{274C}', 'Saved \u{2705}'],
      ['plain', 'Saved \u{2705}', 'Done']
    ]), ['replaced/now', 'replaced/now', 'replaced/now']);
  });

  test('is recognised when the old text does not survive a write to a plain node', () => {
    assert.deepEqual(play([['plain', '12:00', '12:01']]), ['replaced/now']);
    assert.deepEqual(play([['plain', 'Hello world', 'Hello']]), ['replaced/now']);
  });

  test('is recognised when a wrapped text comes back longer: only it still has the old text', () => {
    assert.deepEqual(play([['wrapped', 'Hi \u{1F600}', 'Hi \u{1F600} there']], 'growing'), ['replaced/now']);
    assert.deepEqual(play([['wrapped', 'Hi \u{1F600}', 'Hi \u{1F600} there']], 'held'), ['replaced/now']);
  });

  test('stays recognised through clearing, filling and growing', () => {
    assert.deepEqual(play([
      ['wrapped', 'a \u{1F600}', ''],
      ['plain', '', 'b \u{1F600}'],
      ['plain', 'b \u{1F600}', 'b \u{1F600} c']
    ], 'replaced'), ['replaced/never', 'replaced/now', 'replaced/now']);
  });
});

describe('a text that only ever gets longer', () => {
  const stream = [
    ['plain', 'Hi', 'Hi there'],
    ['plain', 'Hi there', 'Hi there \u{1F600}'],
    ['plain', 'Hi there \u{1F600}', 'Hi there \u{1F600} and']
  ];

  test('waits until it has stopped', () => {
    assert.deepEqual(play(stream), ['growing/later', 'growing/later', 'growing/later']);
  });

  test('is held when, once wrapped, the next write does not repeat the old text', () => {
    // Appending " more" to the emptied node and setting the text to " more" look the same.
    assert.deepEqual(play([
      ...stream,
      ['wrapped', 'Hi there \u{1F600} and', ' more'],
      ['plain', ' more', ' more and more'],
      ['plain', ' more and more', ' more and more \u{1F600}']
    ]).slice(3), ['held/never', 'held/never', 'held/never']);
  });

  test('is let go again when a write shows that the page sets the whole text', () => {
    assert.deepEqual(play([['plain', 'chunk one two', 'new text']], 'held'), ['replaced/now']);
  });

  test('keeps its habit when it is cleared and filled again', () => {
    assert.deepEqual(play([
      ['plain', 'Hi there', ''],
      ['plain', '', 'Again'],
      ['plain', 'Again', 'Again and']
    ], 'growing'), ['growing/never', 'growing/later', 'growing/later']);
  });
});

describe('a write that says nothing', () => {
  test('the first text in an empty node is wrapped soon, in case more follows', () => {
    assert.deepEqual(play([['plain', '', '\u{1F44B} Hello']]), ['unknown/soon']);
  });

  test('the same text again changes nothing', () => {
    assert.deepEqual(play([['plain', 'same', 'same']]), ['unknown/soon']);
    assert.deepEqual(play([['plain', 'same', 'same']], 'growing'), ['growing/later']);
    assert.deepEqual(play([['plain', 'same', 'same']], 'held'), ['held/never']);
  });

  test('an emptied node has nothing to wrap', () => {
    for (const habit of [undefined, 'growing', 'held', 'replaced']) {
      assert.equal(habits.afterWrite(habit, { wrapped: true, before: 'a \u{1F600}', after: '' }).wrap, 'never');
      assert.equal(habits.afterWrite(habit, { wrapped: false, before: 'a', after: '' }).wrap, 'never');
      assert.equal(habits.afterWrite(habit, { wrapped: true, before: 'a \u{1F600}', after: '' }).habit, habit);
    }
  });

  test('a wrapped text that comes back exactly as it was is not proof of anything', () => {
    // Appending the same emoji again to the emptied node gives the same result.
    assert.deepEqual(play([['wrapped', '\u{2B50}', '\u{2B50}']], 'growing'), ['held/never']);
    assert.deepEqual(play([['wrapped', '\u{2B50}', '\u{2B50}']]), ['replaced/now']);
  });
});

describe('the waiting times', () => {
  test('are none for "now", short for "soon" and longer for "later"', () => {
    const { now, soon, later } = habits.WAIT_MS;
    assert.equal(now, 0);
    assert.ok(soon > 0 && later > soon, `${soon} / ${later}`);
  });
});
