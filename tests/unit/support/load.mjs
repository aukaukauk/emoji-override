import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const extensionDir = fileURLToPath(new URL('../../../extension/', import.meta.url));

// Runs one of the extension's scripts the way the browser does, as a classic script with this
// process's globals, and returns the object the scripts publish their parts on. `node --test`
// gives every test file a process of its own, so nothing leaks from one file to the next.
export function loadExtensionScript(relativePath) {
  const filename = extensionDir + relativePath;
  vm.runInThisContext(readFileSync(filename, 'utf8'), { filename });
  return globalThis.__notoEmojiOverride;
}
