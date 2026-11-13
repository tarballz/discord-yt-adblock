'use strict';
// Builds the real launcher program with Windows' built-in C# compiler and runs it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { buildLauncherHost } = require('../src/launcherHost.js');
const { makeTempDir } = require('./helpers.js');

const skip = process.platform !== 'win32' && 'Windows only';
const fileDescription = (exe) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${exe}').VersionInfo.FileDescription`], {
    encoding: 'utf8',
  }).trim();

test('the built launcher calls itself "Discord (no YT ads)" (what Startup apps shows)', { skip }, (t) => {
  const out = path.join(makeTempDir(t), 'discord-no-yt-ads.exe');

  assert.equal(buildLauncherHost({ out }), out);

  assert.equal(fileDescription(out), 'Discord (no YT ads)');
});

test('it starts node with the script and arguments exactly as given, then exits', { skip }, async (t) => {
  const dir = makeTempDir(t);
  const out = path.join(dir, 'discord-no-yt-ads.exe');
  buildLauncherHost({ out });
  const scriptDir = path.join(dir, 'my scripts'); // space in the path
  fs.mkdirSync(scriptDir);
  const result = path.join(scriptDir, 'argv.json');
  const script = path.join(scriptDir, 'probe.js');
  fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(result)}, JSON.stringify(process.argv.slice(2)));`);
  const extra = ['a b', 'say "hi"', 'C:\\trailing\\', ''];

  const r = spawnSync(out, [process.execPath, script, ...extra], { timeout: 10_000 });

  assert.equal(r.status, 0);
  for (let i = 0; i < 50 && !fs.existsSync(result); i++) await new Promise((res) => setTimeout(res, 100));
  assert.deepEqual(JSON.parse(fs.readFileSync(result, 'utf8')), extra);
});

test('returns null (so install falls back to conhost) when the compiler is missing', { skip }, (t) => {
  const out = path.join(makeTempDir(t), 'discord-no-yt-ads.exe');

  assert.equal(buildLauncherHost({ out, csc: 'C:\\does-not-exist\\csc.exe' }), null);
  assert.equal(fs.existsSync(out), false);
});
