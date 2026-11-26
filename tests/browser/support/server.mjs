// Serves the extension's files, the manual test page and generated test documents over HTTP
// on 127.0.0.1.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// EXTENSION_DIR points the tests at another copy of the extension, such as an unpacked package.
export const extensionDir = process.env.EXTENSION_DIR
  ? resolve(process.env.EXTENSION_DIR)
  : join(repoRoot, 'extension');
const manualDir = join(repoRoot, 'tests/manual');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.png': 'image/png'
};

function readInside(root, relativePath) {
  const file = resolve(root, relativePath);
  if (!file.startsWith(root + sep)) return null;
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

export async function startServer({ port = 0 } = {}) {
  const pages = new Map();
  const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));
  // A script that the manifest puts into the page's own world is in place before the others
  // ask it anything, so it comes first here as well.
  const contentScripts = [...manifest.content_scripts].sort((a, b) => Number(b.world === 'MAIN') - Number(a.world === 'MAIN'));
  const styles = contentScripts.flatMap((entry) => entry.css ?? []);
  const scripts = contentScripts.flatMap((entry) => entry.js ?? []);

  const server = http.createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let type = TYPES[extname(path)] || 'application/octet-stream';
    let body = null;

    // /delay/<ms> answers late with nothing. As an image source it holds back the load event.
    const delay = /^\/delay\/(\d+)$/.exec(path);
    if (delay) {
      setTimeout(() => {
        response.writeHead(204);
        response.end();
      }, Number(delay[1]));
      return;
    }

    if (pages.has(path)) {
      ({ body, type } = pages.get(path));
    } else if (path.startsWith('/extension/')) {
      body = readInside(extensionDir, path.slice('/extension/'.length));
      if (body && path.endsWith('.css')) {
        // The stylesheet names the font by its extension URL, which only resolves once the
        // extension is installed. Here the same file is served from this server.
        body = body.toString('utf8').replaceAll('chrome-extension://__MSG_@@extension_id__/', '/extension/');
      }
    } else if (path.startsWith('/manual/')) {
      body = readInside(manualDir, path.slice('/manual/'.length));
    }

    if (body === null) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(body);
  });

  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Tags that load the content scripts and their stylesheet as ordinary page resources, in the
  // order the manifest lists them.
  const extensionTags = styles.map((file) => `<link rel="stylesheet" href="/extension/${file}"/>`).join('')
    + scripts.map((file) => `<script src="/extension/${file}"></script>`).join('');

  function register(body, type) {
    const path = `/page/${pages.size + 1}`;
    pages.set(path, { body, type });
    return origin + path;
  }

  return {
    origin,
    extensionTags,
    manualUrl: `${origin}/manual/index.html`,

    // Registers an HTML test document and returns its URL. Pass `doctype: ''` for quirks mode.
    page({ body = '', head = '', doctype = '<!doctype html>', extension = true } = {}) {
      return register(
        `${doctype}<html><head><meta charset="utf-8"><style>body{font:16px/1.5 Arial,sans-serif;margin:8px}</style>`
          + `${extension ? extensionTags : ''}${head}</head><body>${body}</body></html>`,
        TYPES['.html']
      );
    },

    // Registers a document that is served exactly as given, for example XML.
    rawPage: register,

    close() {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    }
  };
}
