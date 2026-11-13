#!/usr/bin/env node
'use strict';
// Patches Discord, adds "Discord (no YT ads)" shortcuts (Start Menu + Desktop)
// and a login Run entry that start Discord through bin/launch.js.
const fs = require('node:fs');
const path = require('node:path');
const { applyAll } = require('../src/patch.js');
const { injectorPath } = require('../src/runtime.js');
const { launcherCommand } = require('../src/startup.js');
const win = require('./_windows.js');

const projectDir = path.resolve(__dirname, '..');
const discordRoot = path.join(process.env.LOCALAPPDATA, 'Discord');

fs.rmSync(path.join(projectDir, 'uninstalled'), { force: true }); // re-enable re-patching
const result = applyAll(discordRoot, injectorPath());
for (const file of [...result.patched, ...result.unchanged]) console.log(`patched: ${file}`);
for (const file of result.skipped) console.log(`SKIPPED (unrecognized index.js): ${file}`);
for (const { file, error } of result.errors) console.log(`ERROR ${file}: ${error.message}`);

const cmd = launcherCommand({
  conhost: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'conhost.exe'),
  node: process.execPath,
  script: path.join(projectDir, 'bin', 'launch.js'),
});
for (const lnk of win.shortcutPaths()) {
  win.createShortcut(lnk, { target: cmd.target, args: cmd.args, cwd: projectDir, icon: path.join(discordRoot, 'app.ico') });
  console.log(`shortcut: ${lnk}`);
}
win.setRunEntry(cmd.commandLine);
console.log(`login entry: ${cmd.commandLine}`);

if (win.discordAutostartEnabled()) {
  console.log(
    "\nOne manual step: Discord's own start-at-login is still on, and it would bypass the launcher.\n" +
      'In Discord: User Settings → Windows Settings → turn OFF "Open Discord".',
  );
}
console.log('\nFrom now on, start Discord with the "Discord (no YT ads)" shortcut (pin it to the taskbar).');
