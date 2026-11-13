#!/usr/bin/env node
'use strict';
// Restores every Discord index.js and removes the shortcuts and login entry.
const fs = require('node:fs');
const path = require('node:path');
const { removeAll } = require('../src/patch.js');
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
win.removeRunEntry();
console.log('removed login entry');
console.log('\nRestart Discord to unload the blocker. Turn "Open Discord" back on in Discord\'s Windows Settings if you want it at login.');
