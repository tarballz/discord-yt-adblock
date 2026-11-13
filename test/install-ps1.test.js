'use strict';
// Runs install.ps1 under Windows PowerShell 5.1 (what `irm | iex` users have)
// against a fake GitHub archive whose bin/ scripts are stubs, so the real
// Discord install, shortcuts and registry are never touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeTempDir } = require('./helpers.js');

const INSTALL_PS1 = path.join(__dirname, '..', 'install.ps1');
const skip = process.platform !== 'win32' && 'Windows only';

const stub = (name, body) =>
  `const fs = require('fs'), path = require('path');
   fs.writeFileSync(path.join(process.env.DYTA_TEST_EVIDENCE, '${name}.json'), JSON.stringify({ dir: __dirname }));
   ${body}`;

// Builds <base>/source.zip shaped like GitHub's archive: one top-level folder.
function fakeArchive(t, { installExit = 0 } = {}) {
  const base = makeTempDir(t);
  const root = path.join(base, 'archive', 'discord-yt-adblock-master');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"discord-yt-adblock"}');
  fs.writeFileSync(path.join(root, 'bin', 'install.js'), stub('install-ran', `process.exit(${installExit});`));
  fs.writeFileSync(
    path.join(root, 'bin', 'uninstall.js'),
    stub('uninstall-ran', "fs.writeFileSync(path.join(__dirname, '..', 'uninstalled'), '');"),
  );
  fs.writeFileSync(path.join(root, 'bin', 'launch.js'), stub('launch-ran', ''));
  const zip = path.join(base, 'source.zip');
  const made = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -LiteralPath '${root}' -DestinationPath '${zip}'`]);
  assert.equal(made.status, 0, String(made.stderr));
  const evidence = path.join(base, 'evidence');
  fs.mkdirSync(evidence);
  const installDir = path.join(base, 'apps', 'discord-yt-adblock');
  return { base, zip, evidence, installDir };
}

function runPs(evidence, args, exe = 'powershell.exe') {
  const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
    env: { ...process.env, DYTA_TEST_EVIDENCE: evidence },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const runFile = (fx, extra = []) =>
  runPs(fx.evidence, ['-File', INSTALL_PS1, '-InstallDir', fx.installDir, '-Source', fx.zip, '-RestartDiscord', 'No', ...extra]);

const evidence = (fx, name) => {
  const f = path.join(fx.evidence, `${name}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

test('installs the downloaded project into InstallDir and runs its installer', { skip }, (t) => {
  const fx = fakeArchive(t);

  const r = runFile(fx);

  assert.equal(r.status, 0, r.out);
  assert.ok(fs.existsSync(path.join(fx.installDir, 'package.json')), r.out);
  assert.equal(evidence(fx, 'install-ran')?.dir, path.join(fx.installDir, 'bin'));
});

test('re-running replaces the old files and leaves no staging folders behind', { skip }, (t) => {
  const fx = fakeArchive(t);
  fs.mkdirSync(fx.installDir, { recursive: true });
  fs.writeFileSync(path.join(fx.installDir, 'stale.txt'), 'from an older version');

  const r = runFile(fx);

  assert.equal(r.status, 0, r.out);
  assert.equal(fs.existsSync(path.join(fx.installDir, 'stale.txt')), false);
  assert.deepEqual(fs.readdirSync(path.dirname(fx.installDir)), ['discord-yt-adblock']);
});

test('re-running keeps the logs folder, so the running Discord’s log survives an update', { skip }, (t) => {
  const fx = fakeArchive(t);
  fs.mkdirSync(path.join(fx.installDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(fx.installDir, 'logs', 'injector.log'), 'loaded into app-1.0.9267\n');

  const r = runFile(fx);

  assert.equal(r.status, 0, r.out);
  assert.equal(fs.readFileSync(path.join(fx.installDir, 'logs', 'injector.log'), 'utf8'), 'loaded into app-1.0.9267\n');
});

test('also works in the scriptblock form used with irm (parameters included)', { skip }, (t) => {
  const fx = fakeArchive(t);

  const r = runPs(fx.evidence, [
    '-Command',
    `& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '${INSTALL_PS1}'))) -InstallDir '${fx.installDir}' -Source '${fx.zip}' -RestartDiscord No`,
  ]);

  assert.equal(r.status, 0, r.out);
  assert.equal(evidence(fx, 'install-ran')?.dir, path.join(fx.installDir, 'bin'));
});

const hasPwsh = process.platform === 'win32' && spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

test('also installs under PowerShell 7', { skip: skip || (!hasPwsh && 'pwsh not installed') }, (t) => {
  const fx = fakeArchive(t);

  const r = runPs(fx.evidence, ['-File', INSTALL_PS1, '-InstallDir', fx.installDir, '-Source', fx.zip, '-RestartDiscord', 'No'], 'pwsh');

  assert.equal(r.status, 0, r.out);
  assert.equal(evidence(fx, 'install-ran')?.dir, path.join(fx.installDir, 'bin'));
});

test('a failed download stops with a clear error and leaves an existing install intact', { skip }, (t) => {
  const fx = fakeArchive(t);
  fs.mkdirSync(fx.installDir, { recursive: true });
  fs.writeFileSync(path.join(fx.installDir, 'keep.txt'), 'current install');

  const r = runFile({ ...fx, zip: path.join(fx.base, 'missing.zip') });

  assert.notEqual(r.status, 0);
  assert.match(r.out, /missing\.zip/);
  assert.equal(fs.readFileSync(path.join(fx.installDir, 'keep.txt'), 'utf8'), 'current install');
  assert.equal(evidence(fx, 'install-ran'), null);
});

test('a failing installer step makes the script fail too', { skip }, (t) => {
  const fx = fakeArchive(t, { installExit: 3 });

  const r = runFile(fx);

  assert.notEqual(r.status, 0);
  assert.match(r.out, /install\.js/);
});

test('-Uninstall runs the project uninstaller and removes the folder (keeping only the marker while Discord runs)', { skip }, (t) => {
  const fx = fakeArchive(t);
  assert.equal(runFile(fx).status, 0);

  const r = runFile(fx, ['-Uninstall']);

  assert.equal(r.status, 0, r.out);
  assert.equal(evidence(fx, 'uninstall-ran')?.dir, path.join(fx.installDir, 'bin'));
  const left = fs.existsSync(fx.installDir) ? fs.readdirSync(fx.installDir) : [];
  assert.ok(left.length === 0 || (left.length === 1 && left[0] === 'uninstalled'), `left behind: ${left}`);
});
