'use strict';
// Registry helpers, exercised against a throwaway HKCU key (never the real Run key).
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const win = require('../bin/_windows.js');

const skip = process.platform !== 'win32' && 'Windows only';
const TEST_KEY = 'HKCU:\\Software\\discord-yt-adblock-test';
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });

function withTestKey(t) {
  ps(`New-Item -Path '${TEST_KEY}' -Force | Out-Null`);
  t.after(() => ps(`Remove-Item -Path '${TEST_KEY}' -Recurse -Force -ErrorAction SilentlyContinue`));
}

test('removeRunValue is a no-op (not an error) when the value does not exist', { skip }, (t) => {
  withTestKey(t);

  assert.doesNotThrow(() => win.removeRunValue('NotThere', TEST_KEY));
});

test('setRunValue, runValueExists and removeRunValue round-trip a value', { skip }, (t) => {
  withTestKey(t);
  const cmd = '"C:\\Program Files\\x\\y.exe" --flag "C:\\a b\\c.js"';

  win.setRunValue('Entry', cmd, TEST_KEY);
  assert.equal(win.runValueExists('Entry', TEST_KEY), true);
  assert.equal(ps(`(Get-ItemProperty -Path '${TEST_KEY}' -Name 'Entry').Entry`).trim(), cmd);

  win.removeRunValue('Entry', TEST_KEY);
  assert.equal(win.runValueExists('Entry', TEST_KEY), false);
});
