import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (the folder that contains bin/, src/, assets/). */
export const packageRoot = path.resolve(here, '..');

function existingDir(candidate, list) {
  try {
    if (candidate && fs.statSync(candidate).isDirectory()) list.push(candidate);
  } catch {
    /* ignore */
  }
}

/**
 * Places where JS dependencies may live, in priority order:
 *   1. $MD2PDF_MODULES (path-separated list)
 *   2. this repository's node_modules
 *   3. node_modules folders walking up from the current working directory
 *   4. the global npm root
 *   5. runtimes shipped with Codex (so the tool works with zero install)
 */
export function moduleRoots() {
  const roots = [];

  for (const entry of (process.env.MD2PDF_MODULES || '').split(path.delimiter)) {
    existingDir(entry.trim(), roots);
  }

  existingDir(path.join(packageRoot, 'node_modules'), roots);

  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    existingDir(path.join(dir, 'node_modules'), roots);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (process.env.APPDATA) existingDir(path.join(process.env.APPDATA, 'npm', 'node_modules'), roots);

  const runtimeBases = [
    path.join(os.homedir(), '.cache', 'codex-runtimes'),
    path.join(os.homedir(), 'AppData', 'Local', 'codex-runtimes'),
  ];
  for (const base of runtimeBases) {
    let entries = [];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      existingDir(path.join(base, entry, 'dependencies', 'node', 'node_modules'), roots);
    }
  }

  return [...new Set(roots)];
}

const cache = new Map();

/**
 * Import a package from the first location that has it.
 * Returns the module namespace, so ESM-only and CJS packages both work.
 */
export async function loadPackage(name, subpaths = []) {
  const key = `${name}|${subpaths.join(',')}`;
  if (cache.has(key)) return cache.get(key);

  // Preferred entry points first (e.g. pdfjs-dist/legacy/build/pdf.mjs in Node).
  const specs = [...subpaths.map((sub) => `${name}/${sub}`), name];
  const attempts = [];

  for (const root of moduleRoots()) {
    const requireFrom = createRequire(path.join(root, '__md2pdf__.cjs'));
    for (const spec of specs) {
      try {
        const resolved = requireFrom.resolve(spec);
        const mod = await import(pathToFileURL(resolved).href);
        cache.set(key, mod);
        return mod;
      } catch (err) {
        attempts.push(`${spec} @ ${root}: ${err.code || err.message}`);
      }
    }
  }

  const error = new Error(
    `Cannot find package "${name}".\n` +
      `Install it with:  npm install ${name}\n` +
      `Searched:\n  ${moduleRoots().join('\n  ') || '(no node_modules folder found)'}\n` +
      `Last resolution errors:\n  ${attempts.slice(-4).join('\n  ')}`
  );
  error.code = 'MD2PDF_MODULE_NOT_FOUND';
  throw error;
}

/** Same as loadPackage, but returns null instead of throwing. */
export async function loadPackageOptional(name, subpaths = []) {
  try {
    return await loadPackage(name, subpaths);
  } catch {
    return null;
  }
}

/** CJS packages arrive wrapped in a `default` export when imported from ESM. */
export function pick(mod, exportName) {
  if (!mod) return undefined;
  if (mod[exportName]) return mod[exportName];
  if (mod.default && mod.default[exportName]) return mod.default[exportName];
  return undefined;
}

export function readAsset(relativePath) {
  return fs.readFileSync(path.join(packageRoot, relativePath), 'utf8');
}
