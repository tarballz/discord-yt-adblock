#!/usr/bin/env node
'use strict';
// Patches every installed Discord version, starts Discord, then keeps patching
// for 10 minutes to catch an update Discord installs during its splash screen.
// Usage: node bin/launch.js [--discord-root <dir>] [--no-start]
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const { applyAll } = require('../src/patch.js');
const { watchAndPatch } = require('../src/watch.js');
const { createFileLog, injectorPath, readFlags } = require('../src/runtime.js');

const projectDir = path.resolve(__dirname, '..');

const { values: args } = parseArgs({
  options: {
    'discord-root': { type: 'string', default: path.join(process.env.LOCALAPPDATA ?? '', 'Discord') },
    'no-start': { type: 'boolean', default: false },
  },
});
const root = args['discord-root'];
const injector = injectorPath();
const log = createFileLog(path.join(projectDir, 'logs', 'launcher.log'));
const say = (line) => {
  log(line);
  console.log(line);
};

const uninstalled = () => readFlags(projectDir).uninstalled;

if (uninstalled()) {
  say('uninstalled (run `npm run install-patch` to re-enable) — starting Discord without patching');
} else {
  const result = applyAll(root, injector);
  for (const file of result.patched) say(`patched → ${file}`);
  for (const file of result.unchanged) say(`already patched → ${file}`);
  for (const file of result.skipped) say(`skipped (unrecognized index.js) → ${file}`);
  for (const { file, error } of result.errors) say(`ERROR ${file}: ${error.message}`);
}

if (!args['no-start']) {
  const updateExe = path.join(root, 'Update.exe');
  spawn(updateExe, ['--processStart', 'Discord.exe'], { detached: true, stdio: 'ignore' }).unref();
  say(`started ${updateExe} --processStart Discord.exe`);
}

if (!uninstalled()) {
  say('watching for Discord updates for 10 minutes');
  watchAndPatch({ scan: () => applyAll(root, injector), shouldStop: uninstalled, log: say }).then(() => say('watch finished'));
}
