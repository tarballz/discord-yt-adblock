'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { patchIndexSource, unpatchIndexSource, isPatched } = require('../src/patch.js');
const { ORIGINAL_INDEX, runIndexSource } = require('./helpers.js');

const INJECTOR = 'C:\\Users\\me\\code\\discord-yt-adblock\\src\\injector.js';

test('patched index.js loads the injector before core.asar', () => {
  const run = runIndexSource(patchIndexSource(ORIGINAL_INDEX, INJECTOR));
  assert.deepEqual(run.required, [INJECTOR, './core.asar']);
  assert.deepEqual(run.exports, { fakeModule: './core.asar' });
});

test('Discord still loads core.asar when the injector cannot be required', () => {
  const run = runIndexSource(patchIndexSource(ORIGINAL_INDEX, INJECTOR), { throwFor: [INJECTOR] });
  assert.deepEqual(run.exports, { fakeModule: './core.asar' });
  assert.equal(run.errors.length, 1, 'the failure is reported, not swallowed silently');
});

test('patching twice with the same path changes nothing', () => {
  const once = patchIndexSource(ORIGINAL_INDEX, INJECTOR);
  assert.equal(patchIndexSource(once, INJECTOR), once);
});

test('re-patching with a new injector path loads only the new path', () => {
  const moved = 'D:\\elsewhere\\injector.js';
  const src = patchIndexSource(patchIndexSource(ORIGINAL_INDEX, INJECTOR), moved);
  assert.deepEqual(runIndexSource(src).required, [moved, './core.asar']);
});

test('unpatching restores the original bytes exactly', () => {
  for (const original of [ORIGINAL_INDEX, "module.exports = require('./core.asar');", 'module.exports = require("./core.asar");\n']) {
    assert.equal(unpatchIndexSource(patchIndexSource(original, INJECTOR)), original);
  }
});

test('unpatching an unpatched file leaves it alone', () => {
  assert.equal(unpatchIndexSource(ORIGINAL_INDEX), ORIGINAL_INDEX);
});

test('isPatched tells patched and original sources apart', () => {
  assert.equal(isPatched(ORIGINAL_INDEX), false);
  assert.equal(isPatched(patchIndexSource(ORIGINAL_INDEX, INJECTOR)), true);
});

test('refuses to patch a file that is not the expected one-liner (e.g. mid-install)', () => {
  for (const weird of ['', 'module.exports = requ', "module.exports = require('./core.asar');\nsomethingElse();\n"]) {
    assert.equal(patchIndexSource(weird, INJECTOR), null, JSON.stringify(weird));
  }
});

// ---- filesystem: applyAll / removeAll against a fake Discord root ----
const fs = require('node:fs');
const path = require('node:path');
const { applyAll, removeAll } = require('../src/patch.js');
const { makeTempDir, addCoreIndex } = require('./helpers.js');

const read = (f) => fs.readFileSync(f, 'utf8');

test('applyAll patches every installed version and ignores in-progress installs', (t) => {
  const root = makeTempDir(t);
  const a = addCoreIndex(root, 'app-1.0.9267');
  const b = addCoreIndex(root, 'app-1.0.10000');
  const installing = addCoreIndex(root, '.app-1.0.10001.installing');

  const result = applyAll(root, INJECTOR);

  assert.deepEqual(result.patched.sort(), [a, b].sort());
  assert.deepEqual(runIndexSource(read(a)).required, [INJECTOR, './core.asar']);
  assert.deepEqual(runIndexSource(read(b)).required, [INJECTOR, './core.asar']);
  assert.equal(read(installing), ORIGINAL_INDEX);
});

test('applyAll keeps a byte-exact backup of the original, written only once', (t) => {
  const root = makeTempDir(t);
  const file = addCoreIndex(root, 'app-1.0.9267');
  const backup = `${file}.yt-adblock.bak`;

  applyAll(root, INJECTOR);
  assert.equal(read(backup), ORIGINAL_INDEX);

  applyAll(root, 'D:\\moved\\injector.js'); // re-patch with a new path
  assert.equal(read(backup), ORIGINAL_INDEX);
});

test('applyAll reports already-patched files as unchanged, not newly patched', (t) => {
  const root = makeTempDir(t);
  const file = addCoreIndex(root, 'app-1.0.9267');
  applyAll(root, INJECTOR);

  const second = applyAll(root, INJECTOR);

  assert.deepEqual(second.patched, []);
  assert.deepEqual(second.unchanged, [file]);
});

test('applyAll skips an index.js it does not recognize and leaves it untouched', (t) => {
  const root = makeTempDir(t);
  const truncated = addCoreIndex(root, 'app-1.0.9267', 'module.exports = requ');

  const result = applyAll(root, INJECTOR);

  assert.deepEqual(result.skipped, [truncated]);
  assert.equal(read(truncated), 'module.exports = requ');
  assert.equal(fs.existsSync(`${truncated}.yt-adblock.bak`), false);
});

test('applyAll records a file it cannot write and still patches the others', (t) => {
  const root = makeTempDir(t);
  const locked = addCoreIndex(root, 'app-1.0.9267');
  const ok = addCoreIndex(root, 'app-1.0.9300');
  fs.chmodSync(locked, 0o444); // read-only: replacing it fails on Windows
  try {
    const result = applyAll(root, INJECTOR);

    assert.deepEqual(result.errors.map((e) => e.file), [locked]);
    assert.deepEqual(result.patched, [ok]);
    assert.equal(read(locked), ORIGINAL_INDEX);
    assert.deepEqual(fs.readdirSync(path.dirname(locked)).filter((n) => n.endsWith('.tmp')), []);
  } finally {
    fs.chmodSync(locked, 0o666);
  }
});

test('applyAll on a missing Discord root reports nothing instead of throwing', (t) => {
  const result = applyAll(path.join(makeTempDir(t), 'nope'), INJECTOR);
  assert.deepEqual(result, { patched: [], unchanged: [], skipped: [], errors: [] });
});

test('removeAll restores every version byte-for-byte and removes the backups', (t) => {
  const root = makeTempDir(t);
  const a = addCoreIndex(root, 'app-1.0.9267');
  const b = addCoreIndex(root, 'app-1.0.10000');
  applyAll(root, INJECTOR);

  const result = removeAll(root);

  assert.deepEqual(result.restored.sort(), [a, b].sort());
  for (const f of [a, b]) {
    assert.equal(read(f), ORIGINAL_INDEX);
    assert.equal(fs.existsSync(`${f}.yt-adblock.bak`), false);
  }
});
