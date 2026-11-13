'use strict';
// Test-only utilities: fake Discord install trees and a sandbox that runs a
// patched index.js the way Node's module loader would.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Exact bytes of Discord 1.0.9267's discord_desktop_core/index.js (CRLF ending).
const ORIGINAL_INDEX = "module.exports = require('./core.asar');\r\n";

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Creates <root>/<appDir>/modules/discord_desktop_core-1/discord_desktop_core/index.js
// and returns the index.js path.
function addCoreIndex(root, appDir, contents = ORIGINAL_INDEX) {
  const dir = path.join(root, appDir, 'modules', 'discord_desktop_core-1', 'discord_desktop_core');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.js');
  fs.writeFileSync(file, contents);
  return file;
}

// Evaluates index.js source with a fake `require`, recording which modules it
// loads, in order. `throwFor` lists module ids whose require() should throw.
function runIndexSource(src, { throwFor = [] } = {}) {
  const required = [];
  const errors = [];
  const module = { exports: undefined };
  const fakeRequire = (id) => {
    required.push(id);
    if (throwFor.includes(id)) throw new Error(`cannot find ${id}`);
    return { fakeModule: id };
  };
  const fakeConsole = { error: (...args) => errors.push(args) };
  new Function('require', 'module', 'console', src)(fakeRequire, module, fakeConsole);
  return { required, exports: module.exports, errors };
}

module.exports = { ORIGINAL_INDEX, makeTempDir, addCoreIndex, runIndexSource };
