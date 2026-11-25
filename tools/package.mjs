// Builds the file that is uploaded to the Chrome Web Store:
//
//   dist/noto-emoji-override-<version>.zip
//
// It holds everything in extension/, with the licence and privacy documents from the repository
// root next to manifest.json. Entries are sorted and carry a fixed date, so building the same
// sources twice gives the same file.
//
//   node tools/package.mjs [output directory]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The bundled font may only be passed on together with its licence, which is in
// THIRD_PARTY_LICENSES.md.
const ROOT_DOCUMENTS = ['LICENSE', 'NOTICE', 'PRIVACY.md', 'THIRD_PARTY_LICENSES.md'];

function listFiles(directory, prefix = '') {
  const files = [];
  const items = readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const item of items) {
    // Finder and editors leave hidden files behind.
    if (item.name.startsWith('.')) continue;
    if (item.isDirectory()) {
      files.push(...listFiles(join(directory, item.name), `${prefix}${item.name}/`));
    } else if (item.isFile()) {
      files.push(`${prefix}${item.name}`);
    }
  }
  return files;
}

// The package as a list of { name, data }, ordered by name.
export function collectEntries(root = repoRoot) {
  const extensionDir = join(root, 'extension');
  const entries = listFiles(extensionDir).map((name) => ({ name, data: readFileSync(join(extensionDir, name)) }));

  for (const name of ROOT_DOCUMENTS) {
    if (entries.some((entry) => entry.name === name)) {
      throw new Error(`extension/${name} would be replaced by the copy in the repository root. Remove one of the two.`);
    }
    entries.push({ name, data: readFileSync(join(root, name)) });
  }

  return entries.sort((a, b) => (a.name < b.name ? -1 : 1));
}

// Every file that manifest.json, and the pages it opens, point to. A file that is missing here
// would only show up as a broken extension after the upload.
export function referencedFiles(entries) {
  const text = (name) => {
    const entry = entries.find((item) => item.name === name);
    if (!entry) throw new Error(`${name} is missing from the package.`);
    return entry.data.toString('utf8');
  };

  const manifest = JSON.parse(text('manifest.json'));
  const referenced = new Map();
  const add = (name, from) => {
    if (typeof name === 'string' && name && !name.includes('*')) referenced.set(name.replace(/^\//, ''), from);
  };

  for (const icon of Object.values(manifest.icons ?? {})) add(icon, 'icons');
  for (const key of ['action', 'browser_action', 'page_action']) {
    const action = manifest[key] ?? {};
    add(action.default_popup, `${key}.default_popup`);
    const icons = typeof action.default_icon === 'string' ? [action.default_icon] : Object.values(action.default_icon ?? {});
    for (const icon of icons) add(icon, `${key}.default_icon`);
  }
  for (const script of manifest.content_scripts ?? []) {
    for (const name of [...(script.js ?? []), ...(script.css ?? [])]) add(name, 'content_scripts');
  }
  for (const group of manifest.web_accessible_resources ?? []) {
    for (const name of group.resources ?? []) add(name, 'web_accessible_resources');
  }
  add(manifest.background?.service_worker, 'background.service_worker');
  add(manifest.options_page, 'options_page');
  add(manifest.options_ui?.page, 'options_ui.page');
  if (manifest.default_locale) add(`_locales/${manifest.default_locale}/messages.json`, 'default_locale');

  // Scripts and stylesheets of the extension's own pages.
  for (const [page] of [...referenced]) {
    if (!page.endsWith('.html') || !entries.some((entry) => entry.name === page)) continue;
    for (const [, target] of text(page).matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) continue;
      add(posix.normalize(posix.join(posix.dirname(page), target)), page);
    }
  }

  return { manifest, referenced };
}

export function checkEntries(entries) {
  const { manifest, referenced } = referencedFiles(entries);
  const names = new Set(entries.map((entry) => entry.name));
  const missing = [...referenced].filter(([name]) => !names.has(name));

  if (missing.length) {
    const lines = missing.map(([name, from]) => `  ${name} (named in ${from})`);
    throw new Error(`The package would lack files that the extension needs:\n${lines.join('\n')}`);
  }
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? '')) {
    throw new Error(`manifest.json has no usable version: ${JSON.stringify(manifest.version)}`);
  }

  return manifest;
}

// A zip archive with the given entries. Just enough of the format for a few small files: no
// directories, no encryption, no zip64.
export function zip(entries) {
  const UTF8_NAMES = 0x0800;
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1; // 1 January 1980, the earliest date the format has
  const MADE_ON_UNIX = (3 << 8) | 20;
  const REGULAR_FILE = ((0o100644 << 16) >>> 0);

  const parts = [];
  const directory = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length < data.length ? deflated : data;
    const method = stored === deflated ? 8 : 0;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_ON_UNIX, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(REGULAR_FILE, 38);
    central.writeUInt32LE(offset, 42);

    parts.push(local, nameBytes, stored);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + stored.length;
  }

  const directoryLength = directory.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryLength, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, ...directory, end]);
}

export function buildPackage({ root = repoRoot, outDir = join(root, 'dist') } = {}) {
  const entries = collectEntries(root);
  const manifest = checkEntries(entries);
  const archive = zip(entries);
  const file = join(outDir, `noto-emoji-override-${manifest.version}.zip`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, archive);

  return {
    file,
    version: manifest.version,
    entries: entries.map((entry) => entry.name),
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex')
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildPackage(process.argv[2] ? { outDir: resolve(process.argv[2]) } : {});
    console.log(`${result.file}`);
    console.log(`  version ${result.version}, ${result.entries.length} files, ${(result.bytes / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  sha256 ${result.sha256}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
