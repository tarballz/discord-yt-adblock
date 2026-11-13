'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setOpenOnStartup, planAutostart } = require('../src/autostart.js');
const { makeTempDir } = require('./helpers.js');

// Trimmed copy of a real %APPDATA%\discord\settings.json (values made up).
const SETTINGS = {
  chromiumSwitches: {},
  OPEN_ON_STARTUP: true,
  IS_MAXIMIZED: false,
  WINDOW_BOUNDS: { x: 10, y: 20, width: 1280, height: 720 },
  BACKGROUND_COLOR: '#202225',
};

function writeSettings(t, contents = JSON.stringify(SETTINGS, null, 2)) {
  const file = path.join(makeTempDir(t), 'settings.json');
  fs.writeFileSync(file, contents);
  return file;
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('setOpenOnStartup turns Discord’s own start-at-login off and keeps every other setting', (t) => {
  const file = writeSettings(t);

  assert.equal(setOpenOnStartup(file, false), true);

  assert.deepEqual(readJson(file), { ...SETTINGS, OPEN_ON_STARTUP: false });
});

test('setOpenOnStartup adds the key when Discord has not written it yet', (t) => {
  const { OPEN_ON_STARTUP, ...rest } = SETTINGS;
  const file = writeSettings(t, JSON.stringify(rest));

  setOpenOnStartup(file, true);

  assert.equal(readJson(file).OPEN_ON_STARTUP, true);
});

test('setOpenOnStartup leaves a missing or corrupt settings file alone', (t) => {
  const missing = path.join(makeTempDir(t), 'settings.json');
  assert.equal(setOpenOnStartup(missing, false), false);
  assert.equal(fs.existsSync(missing), false);

  const corrupt = writeSettings(t, '{ "OPEN_ON_STARTUP": tr');
  assert.equal(setOpenOnStartup(corrupt, false), false);
  assert.equal(fs.readFileSync(corrupt, 'utf8'), '{ "OPEN_ON_STARTUP": tr');
});

// planAutostart: who should start Discord at login after installing?
const plans = [
  // [description, state, expected]
  ['Discord starts at login, Discord closed → take it over now',
    { discordAutostart: true, ourEntry: false, discordRunning: false }, { ourEntry: true, disableDiscordAutostart: true }],
  ['Discord starts at login, Discord running → our entry now, take over once Discord is closed',
    { discordAutostart: true, ourEntry: false, discordRunning: true }, { ourEntry: true, disableDiscordAutostart: false }],
  ['Discord does not start at login → respect that, add nothing',
    { discordAutostart: false, ourEntry: false, discordRunning: false }, { ourEntry: false, disableDiscordAutostart: false }],
  ['already taken over on a previous install → keep ours',
    { discordAutostart: false, ourEntry: true, discordRunning: false }, { ourEntry: true, disableDiscordAutostart: false }],
];

for (const [name, state, expected] of plans) {
  test(`planAutostart: ${name}`, () => {
    assert.deepEqual(planAutostart(state), expected);
  });
}
