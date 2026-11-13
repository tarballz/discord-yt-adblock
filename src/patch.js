'use strict';
// Adds/removes a small managed block at the top of Discord's
// discord_desktop_core/index.js that loads our injector before Discord's core.
const fs = require('node:fs');
const path = require('node:path');

const BEGIN = '// >>> discord-yt-adblock (managed; remove with `npm run uninstall`) >>>';
const END = '// <<< discord-yt-adblock <<<';

function blockFor(injectorPath) {
  const load = `try { require(${JSON.stringify(injectorPath)}); } catch (e) { console.error("[discord-yt-adblock]", e); }`;
  return `${BEGIN}\n${load}\n${END}\n`;
}

// What Discord ships: a single `module.exports = require('./core.asar');`.
// Anything else (empty, truncated mid-install, or reshaped by a future Discord
// release) is left untouched rather than guessed at.
const ORIGINAL_SHAPE = /^\s*module\.exports\s*=\s*require\((['"])\.\/core\.asar\1\);?\s*$/;

function splitBlock(src) {
  if (!src.startsWith(BEGIN)) return { block: null, rest: src };
  const end = src.indexOf(`${END}\n`);
  if (end === -1) return { block: null, rest: src };
  const cut = end + END.length + 1;
  return { block: src.slice(0, cut), rest: src.slice(cut) };
}

function isPatched(src) {
  return splitBlock(src).block !== null;
}

function unpatchIndexSource(src) {
  return splitBlock(src).rest;
}

/** Returns the patched source, or null if `src` isn't a recognizable index.js. */
function patchIndexSource(src, injectorPath) {
  const original = unpatchIndexSource(src);
  if (!ORIGINAL_SHAPE.test(original)) return null;
  return blockFor(injectorPath) + original;
}

// ---- filesystem ----

const BACKUP_SUFFIX = '.yt-adblock.bak';
// `app-1.0.9267` yes; `.app-1.0.9268.installing` (updater staging dir) no.
const APP_DIR = /^app-\d+(\.\d+)*$/;
const CORE_DIR = /^discord_desktop_core-\d+$/;

function listDirs(dir, pattern) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && pattern.test(e.name)).map((e) => path.join(dir, e.name));
}

/** Every installed discord_desktop_core/index.js under a Discord root, across all app versions. */
function findCoreIndexFiles(root) {
  const files = [];
  for (const appDir of listDirs(root, APP_DIR)) {
    for (const coreDir of listDirs(path.join(appDir, 'modules'), CORE_DIR)) {
      const file = path.join(coreDir, 'discord_desktop_core', 'index.js');
      if (fs.existsSync(file)) files.push(file);
    }
  }
  return files;
}

// Write-then-rename so Discord can never `require` a half-written file.
function writeAtomic(file, contents) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Patches every installed version. Never throws; per-file problems land in `errors`. */
function applyAll(root, injectorPath) {
  const result = { patched: [], unchanged: [], skipped: [], errors: [] };
  for (const file of findCoreIndexFiles(root)) {
    try {
      const src = fs.readFileSync(file, 'utf8');
      const next = patchIndexSource(src, injectorPath);
      if (next === null) {
        result.skipped.push(file);
        continue;
      }
      if (next === src) {
        result.unchanged.push(file);
        continue;
      }
      if (!isPatched(src)) fs.writeFileSync(file + BACKUP_SUFFIX, src);
      writeAtomic(file, next);
      result.patched.push(file);
    } catch (error) {
      result.errors.push({ file, error });
    }
  }
  return result;
}

/** Strips our block from every installed version and deletes the backups. */
function removeAll(root) {
  const result = { restored: [], errors: [] };
  for (const file of findCoreIndexFiles(root)) {
    try {
      const src = fs.readFileSync(file, 'utf8');
      if (!isPatched(src)) continue;
      writeAtomic(file, unpatchIndexSource(src));
      fs.rmSync(file + BACKUP_SUFFIX, { force: true });
      result.restored.push(file);
    } catch (error) {
      result.errors.push({ file, error });
    }
  }
  return result;
}

module.exports = { patchIndexSource, unpatchIndexSource, isPatched, findCoreIndexFiles, applyAll, removeAll };
