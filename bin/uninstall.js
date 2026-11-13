#!/usr/bin/env node
'use strict';
// Restores every Discord index.js and removes the shortcuts and login entry.
const fs = require('node:fs');
const path = require('node:path');
const { removeAll } = require('../src/patch.js');
const { setOpenOnStartup, readStartMinimized } = require('../src/autostart.js');
const { discordAutostartCommand } = require('../src/startup.js');
const win = require('./_windows.js');

// Written first: tells a running injector / launcher watch to stop re-patching.
fs.writeFileSync(path.join(__dirname, '..', 'uninstalled'), `${new Date().toISOString()}\n`);

const result = removeAll(path.join(process.env.LOCALAPPDATA, 'Discord'));
for (const file of result.restored) console.log(`restored: ${file}`);
for (const { file, error } of result.errors) console.log(`ERROR ${file}: ${error.message}`);

for (const lnk of win.shortcutPaths()) {
  fs.rmSync(lnk, { force: true });
  console.log(`removed shortcut: ${lnk}`);
}
const hadLoginEntry = win.runValueExists(win.RUN_VALUE);
win.removeRunValue(win.RUN_VALUE);
if (hadLoginEntry) {
  // We took start-at-login over from Discord on install; give it back.
  if (!win.discordRunning()) {
    setOpenOnStartup(win.discordSettingsFile(), true);
    // Exactly what Discord itself writes: its root launcher if present, else Update.exe.
    const discordRoot = path.join(process.env.LOCALAPPDATA, 'Discord');
    const rootLauncher = path.join(discordRoot, 'Discord.exe');
    const targetExe = fs.existsSync(rootLauncher) ? rootLauncher : path.join(discordRoot, 'Update.exe');
    win.setRunValue('Discord', discordAutostartCommand({ targetExe, startMinimized: readStartMinimized(win.discordSettingsFile()) }));
    console.log('gave start-at-login back to Discord');
  } else {
    console.log('removed login entry; turn "Open Discord" back on in Discord\'s Windows Settings to start it at login');
  }
}
console.log('\nRestart Discord to unload the blocker.');
