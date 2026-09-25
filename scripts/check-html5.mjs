// Validate a browser-game folder before `butler push` to an itch.io HTML channel.
// Engine-agnostic by default; pass --unity for Unity WebGL template checks.
// Usage: node check-html5.mjs <dir> [--unity]
import { readdir, readFile, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// itch.io HTML5 limits: https://itch.io/docs/creators/html5
const MAX_FILES = 1000;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_PATH = 240;

async function walk(root) {
  const files = [];
  async function visit(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      assert(!item.isSymbolicLink(), `No symlinks allowed in bundle: ${path.relative(root, file)}`);
      if (item.isDirectory()) await visit(file); else files.push(file);
    }
  }
  await visit(root);
  return files;
}

function localRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)[^"']*["']/gi)) {
    const ref = m[1].trim();
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue; // http:, data:, //cdn, mailto: ...
    refs.push(ref);
  }
  return refs;
}

async function exists(file) {
  try { return (await stat(file)).isFile() || (await stat(file)).isDirectory(); } catch { return false; }
}

export async function validate(root, { unity = false } = {}) {
  const indexPath = path.join(root, 'index.html');
  assert(await exists(indexPath), 'index.html must be at the bundle root (zip the folder contents, not the folder)');
  const files = await walk(root);
  const html = await readFile(indexPath, 'utf8');

  assert(files.length <= MAX_FILES, `itch.io maximum ${MAX_FILES} files (found ${files.length})`);
  let total = 0;
  for (const file of files) {
    const size = (await lstat(file)).size;
    total += size;
    const rel = path.relative(root, file);
    assert(size <= MAX_FILE_BYTES, `itch.io maximum single file size exceeded: ${rel}`);
    assert(rel.length <= MAX_PATH, `itch.io maximum path length exceeded: ${rel}`);
  }
  assert(total <= MAX_TOTAL_BYTES, 'itch.io maximum bundle size exceeded');

  for (const ref of localRefs(html)) {
    assert(!ref.startsWith('/'), `Asset paths must be relative (itch serves from a subpath): ${ref}`);
    assert(!path.normalize(ref).startsWith('..'), `Asset escapes bundle root: ${ref}`);
    assert(await exists(path.join(root, decodeURI(ref))), `Referenced file is missing: ${ref}`);
  }

  if (unity) {
    assert(!html.includes('{{{'), 'Unity template must be expanded');
    assert(html.includes('matchWebGLToCanvasSize:true'), 'Unity canvas must resize with the iframe (matchWebGLToCanvasSize:true)');
    for (const field of ['dataUrl', 'frameworkUrl', 'codeUrl']) {
      const match = html.match(new RegExp(field + ':\\s*"([^" ]+)"'));
      assert(match, `Missing Unity ${field}`);
      assert(!match[1].startsWith('/') && !match[1].includes('..'), 'Unity assets must stay relative');
      assert((await stat(path.join(root, match[1]))).size > 0, `Missing Unity ${field} asset`);
    }
  }
  console.log(`HTML5_PACKAGE_OK${unity ? ' (unity)' : ''}: ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MiB`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--'));
  if (!dir) { console.error('usage: node check-html5.mjs <dir> [--unity]'); process.exit(2); }
  await validate(dir, { unity: args.includes('--unity') });
}
