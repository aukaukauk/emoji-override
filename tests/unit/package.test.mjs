import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { buildPackage, checkEntries, collectEntries, zip } from '../../tools/package.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'emoji-override-package-'));

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// Reads an archive back by following its directory, the way an unzip program does. Gives the
// content of each file, and in `unzip.methods` how the last archive stored each one.
function unzip(archive) {
  unzip.methods = new Map();
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50, 'the archive ends with its directory record');

  const files = new Map();
  let position = archive.readUInt32LE(end + 16);

  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    assert.equal(archive.readUInt32LE(position), 0x02014b50);
    const method = archive.readUInt16LE(position + 10);
    const checksum = archive.readUInt32LE(position + 16);
    const storedSize = archive.readUInt32LE(position + 20);
    const size = archive.readUInt32LE(position + 24);
    const nameLength = archive.readUInt16LE(position + 28);
    const local = archive.readUInt32LE(position + 42);
    const name = archive.toString('utf8', position + 46, position + 46 + nameLength);

    assert.equal(archive.readUInt32LE(local), 0x04034b50, `${name} starts with a file header`);
    assert.equal(archive.toString('utf8', local + 30, local + 30 + archive.readUInt16LE(local + 26)), name);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const stored = archive.subarray(start, start + storedSize);
    const data = method === 8 ? inflateRawSync(stored) : stored;

    assert.equal(data.length, size, `${name} has the recorded size`);
    assert.equal(crc32(data), checksum, `${name} has the recorded checksum`);
    files.set(name, data);
    unzip.methods.set(name, method === 8 ? 'deflated' : 'stored');
    position += 46 + nameLength + archive.readUInt16LE(position + 30) + archive.readUInt16LE(position + 32);
  }

  assert.equal(position, end, 'the directory runs up to its end record');
  return files;
}

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => (item.isDirectory()
    ? listFiles(join(directory, item.name), `${prefix}${item.name}/`)
    : [`${prefix}${item.name}`]));
}

function entry(name, content) {
  return { name, data: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) };
}

const minimalManifest = {
  manifest_version: 3,
  name: 'Test',
  version: '1.2.3',
  icons: { 32: 'icons/icon.png' },
  action: { default_popup: 'popup/popup.html', default_icon: { 16: 'icons/icon.png' } },
  content_scripts: [{ matches: ['<all_urls>'], js: ['scripts/a.js'], css: ['styles/a.css'] }],
  web_accessible_resources: [{ resources: ['fonts/font.ttf', 'images/*.png'], matches: ['<all_urls>'] }],
  default_locale: 'en'
};

function minimalEntries(changes = {}) {
  const files = {
    'manifest.json': minimalManifest,
    'icons/icon.png': 'png',
    'popup/popup.html': '<link rel="stylesheet" href="popup.css"><script src="../scripts/shared.js"></script><script src="popup.js"></script><a href="https://example.com/">x</a>',
    'popup/popup.css': '',
    'popup/popup.js': '',
    'scripts/shared.js': '',
    'scripts/a.js': '',
    'styles/a.css': '',
    'fonts/font.ttf': 'font',
    '_locales/en/messages.json': {},
    ...changes
  };
  return Object.entries(files).filter(([, content]) => content !== null).map(([name, content]) => entry(name, content));
}

describe('the package', () => {
  const result = buildPackage({ outDir: join(scratch, 'first') });
  const files = unzip(readFileSync(result.file));

  test('is named after the version in the manifest', () => {
    const { version } = JSON.parse(readFileSync(join(repoRoot, 'extension/manifest.json'), 'utf8'));
    assert.equal(result.version, version);
    assert.ok(result.file.endsWith(`noto-emoji-override-${version}.zip`), result.file);
  });

  test('holds every file of extension/ unchanged, with manifest.json at the top', () => {
    const sources = listFiles(join(repoRoot, 'extension')).filter((name) => !name.split('/').some((part) => part.startsWith('.')));

    assert.ok(files.has('manifest.json'));
    for (const name of sources) {
      assert.ok(files.has(name), `${name} is in the package`);
      assert.ok(files.get(name).equals(readFileSync(join(repoRoot, 'extension', name))), `${name} is unchanged`);
    }
    assert.equal(files.size, sources.length + 4);
  });

  test('holds the licence and privacy documents from the repository root', () => {
    for (const name of ['LICENSE', 'NOTICE', 'PRIVACY.md', 'THIRD_PARTY_LICENSES.md']) {
      assert.ok(files.get(name)?.equals(readFileSync(join(repoRoot, name))), name);
    }
    assert.match(files.get('THIRD_PARTY_LICENSES.md').toString(), /SIL Open Font License/i, 'the font licence travels with the font');
  });

  test('holds nothing else: no tests, no tools, no hidden files', () => {
    const unwanted = [...files.keys()].filter((name) => /(^|\/)\.|^(tests?|tools|node_modules|dist)\//.test(name)
      || /package(-lock)?\.json$|eslint|README/.test(name));
    assert.deepEqual(unwanted, []);
  });

  test('comes out the same when it is built again', () => {
    const again = buildPackage({ outDir: join(scratch, 'second') });
    assert.equal(again.sha256, result.sha256);
    assert.ok(readFileSync(again.file).equals(readFileSync(result.file)));
  });
});

describe('zip', () => {
  test('compresses a file only when that makes it smaller', () => {
    // Bytes without a pattern, the same on every run.
    let state = 0x2545F491;
    const noise = Buffer.from(Array.from({ length: 4096 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state & 0xFF;
    }));
    const entries = [entry('empty.txt', ''), { name: 'noise.bin', data: noise }, entry('text/repeated.txt', 'emoji '.repeat(500))];
    const files = unzip(zip(entries));

    for (const { name, data } of entries) assert.ok(files.get(name).equals(data), name);
    assert.deepEqual([...unzip.methods], [['empty.txt', 'stored'], ['noise.bin', 'stored'], ['text/repeated.txt', 'deflated']]);
  });
});

describe('the check before packaging', () => {
  test('passes a package that has every file the manifest and its pages name', () => {
    assert.equal(checkEntries(minimalEntries()).version, '1.2.3');
  });

  for (const [missing, namedIn] of [
    ['scripts/a.js', 'content_scripts'],
    ['styles/a.css', 'content_scripts'],
    ['fonts/font.ttf', 'web_accessible_resources'],
    ['icons/icon.png', 'default_icon'],
    ['popup/popup.html', 'default_popup'],
    ['_locales/en/messages.json', 'default_locale'],
    ['scripts/shared.js', 'popup/popup.html'],
    ['popup/popup.css', 'popup/popup.html']
  ]) {
    test(`stops when ${missing} is missing`, () => {
      assert.throws(() => checkEntries(minimalEntries({ [missing]: null })), (error) => {
        assert.ok(error.message.includes(missing), error.message);
        assert.ok(error.message.includes(namedIn), error.message);
        return true;
      });
    });
  }

  test('stops when there is no manifest or no usable version', () => {
    assert.throws(() => checkEntries(minimalEntries({ 'manifest.json': null })), /manifest\.json is missing/);
    assert.throws(() => checkEntries(minimalEntries({ 'manifest.json': { ...minimalManifest, version: 'next' } })), /version/);
  });
});

describe('collecting the files', () => {
  function fakeRepository(name, extensionFiles) {
    const root = join(scratch, name);
    for (const [file, content] of Object.entries({ LICENSE: 'l', NOTICE: 'n', 'PRIVACY.md': 'p', 'THIRD_PARTY_LICENSES.md': 't', ...extensionFiles })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
    }
    return root;
  }

  test('skips hidden files and orders the rest by name', () => {
    const root = fakeRepository('hidden', {
      'extension/manifest.json': '{}',
      'extension/.DS_Store': 'x',
      'extension/scripts/.swp': 'x',
      'extension/scripts/b.js': 'b',
      'extension/scripts/a.js': 'a'
    });

    assert.deepEqual(collectEntries(root).map((item) => item.name), [
      'LICENSE', 'NOTICE', 'PRIVACY.md', 'THIRD_PARTY_LICENSES.md', 'manifest.json', 'scripts/a.js', 'scripts/b.js'
    ]);
  });

  test('refuses a second copy of a root document inside extension/', () => {
    const root = fakeRepository('duplicate', { 'extension/manifest.json': '{}', 'extension/NOTICE': 'old notice' });
    assert.throws(() => collectEntries(root), /extension\/NOTICE/);
  });
});
