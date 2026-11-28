import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Runs one file of browser tests on a machine that seems to have no Chrome.
function runWithoutChrome(env) {
  return spawnSync(process.execPath, ['--test', 'tests/browser/skip-rules.test.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    // Without the variable that tells a test file it is run by this very runner: the run
    // started here is one of its own.
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, CHROME_PATH: resolve(repoRoot, 'no-such-chrome'), CI: '', REQUIRE_CHROME: '', ...env }
  });
}

describe('browser tests on a machine without Chrome', () => {
  test('are skipped, and the run passes', () => {
    const run = runWithoutChrome({});
    assert.equal(run.status, 0, run.stdout);
    assert.match(run.stdout, /# SKIP Chrome was not found/);
    assert.match(run.stdout, /# fail 0/);
  });

  for (const name of ['CI', 'REQUIRE_CHROME']) {
    test(`stop the run when ${name} says that they have to be run`, () => {
      const run = runWithoutChrome({ [name]: '1' });
      assert.notEqual(run.status, 0);
      assert.match(run.stdout + run.stderr, /Chrome was not found, and the browser tests may not be skipped here/);
      assert.match(run.stdout, /# fail 1/);
    });
  }
});
