#!/usr/bin/env node
'use strict';
// Patches Discord, adds "Discord (no YT ads)" shortcuts (Start Menu + Desktop)
// and a login Run entry that start Discord through bin/launch.js.
const fs = require('node:fs');
const path = require('node:path');
const { applyAll } = require('../src/patch.js');
const { injectorPath } = require('../src/runtime.js');
const { launcherCommand } = require('../src/startup.js');
const { setOpenOnStartup, planAutostart } = require('../src/autostart.js');
const win = require('./_windows.js');

const projectDir = path.resolve(__dirname, '..');
const discordRoot = path.join(process.env.LOCALAPPDATA, 'Discord');

fs.rmSync(path.join(projectDir, 'uninstalled'), { force: true }); // re-enable re-patching
const result = applyAll(discordRoot, injectorPath());
for (const file of [...result.patched, ...result.unchanged]) console.log(`patched: ${file}`);
for (const file of result.skipped) console.log(`SKIPPED (unrecognized index.js): ${file}`);
for (const { file, error } of result.errors) console.log(`ERROR ${file}: ${error.message}`);
if (result.patched.length + result.unchanged.length === 0) {
  console.error(`Could not patch Discord under ${discordRoot}. Is the Discord desktop app (stable) installed there?`);
  process.exit(1);
}

const cmd = launcherCommand({
  conhost: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'conhost.exe'),
  node: process.execPath,
  script: path.join(projectDir, 'bin', 'launch.js'),
});
for (const lnk of win.shortcutPaths()) {
  // Working directory deliberately NOT the project folder: a live process's cwd
  // locks that folder, which would block the one-shot installer's update swap.
  win.createShortcut(lnk, { target: cmd.target, args: cmd.args, cwd: discordRoot, icon: path.join(discordRoot, 'app.ico') });
  console.log(`shortcut: ${lnk}`);
}
// Start at login only if Discord already did; if so, take that over from Discord.
const discordAutostart = win.runValueExists('Discord');
const plan = planAutostart({
  discordAutostart,
  ourEntry: win.runValueExists(win.RUN_VALUE),
  discordRunning: win.discordRunning(),
});
if (plan.ourEntry) {
  win.setRunValue(win.RUN_VALUE, cmd.commandLine);
  console.log(`login entry: ${cmd.commandLine}`);
} else {
  win.removeRunValue(win.RUN_VALUE);
  console.log('login entry: none (Discord was not set to start at login)');
}
if (plan.disableDiscordAutostart) {
  setOpenOnStartup(win.discordSettingsFile(), false);
  win.removeRunValue('Discord');
  console.log("took over start-at-login from Discord (its own \"Open Discord\" setting is now off)");
} else if (discordAutostart) {
  console.log(
    "\nDiscord is running, so its own start-at-login is still on and would bypass the blocker after updates.\n" +
      'Close Discord fully and run this again, or turn OFF "Open Discord" in User Settings → Windows Settings.',
  );
}
console.log('\nFrom now on, start Discord with the "Discord (no YT ads)" shortcut (pin it to the taskbar).');
