'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFileLog, readFlags, injectorPath } = require('../src/runtime.js');
const { makeTempDir } = require('./helpers.js');

test('createFileLog starts a fresh file each run and appends one line per call', (t) => {
  const file = path.join(makeTempDir(t), 'logs', 'injector.log'); // logs/ does not exist yet
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, 'old session\n');

  const log = createFileLog(file);
  log('first');
  log('second');

  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z first$/);
  assert.match(lines[1], / second$/);
});

test('createFileLog creates a missing logs directory', (t) => {
  const file = path.join(makeTempDir(t), 'logs', 'injector.log');

  createFileLog(file)('hello');

  assert.match(fs.readFileSync(file, 'utf8'), / hello\n$/);
});

test('createFileLog never throws, even when the file cannot be written', (t) => {
  const dirInsteadOfFile = makeTempDir(t);

  assert.doesNotThrow(() => createFileLog(dirInsteadOfFile)('hello'));
});

test('injectorPath is the absolute, on-disk-cased path of src/injector.js', () => {
  const p = injectorPath();
  assert.equal(p, path.join(path.resolve(__dirname, '..'), 'src', 'injector.js').replace(/^[a-z]:/, (d) => d.toUpperCase()));
  assert.equal(fs.realpathSync.native(p), p, 'already canonical, so launcher and injector write identical blocks');
});

test('readFlags reports which flag files exist in the project folder', (t) => {
  const dir = makeTempDir(t);
  assert.deepEqual(readFlags(dir), { debug: false, disabled: false, uninstalled: false });

  fs.writeFileSync(path.join(dir, 'debug'), '');
  assert.deepEqual(readFlags(dir), { debug: true, disabled: false, uninstalled: false });

  fs.writeFileSync(path.join(dir, 'disabled'), '');
  assert.deepEqual(readFlags(dir), { debug: true, disabled: true, uninstalled: false });

  fs.writeFileSync(path.join(dir, 'uninstalled'), '');
  assert.deepEqual(readFlags(dir), { debug: true, disabled: true, uninstalled: true });
});
