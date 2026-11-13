'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { launcherCommand } = require('../src/startup.js');

const paths = {
  conhost: 'C:\\Windows\\System32\\conhost.exe',
  node: 'C:\\Program Files\\nodejs\\node.exe', // note the space
  script: 'C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js',
};
const HOST = 'C:\\Users\\me\\AppData\\Local\\discord-yt-adblock\\discord-no-yt-ads.exe';

test('with our launcher program: it is the target, so Startup apps shows its name', () => {
  const cmd = launcherCommand({ ...paths, host: HOST });
  assert.equal(cmd.target, HOST);
  assert.equal(cmd.args, '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js"');
  assert.equal(
    cmd.commandLine,
    '"C:\\Users\\me\\AppData\\Local\\discord-yt-adblock\\discord-no-yt-ads.exe" "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js"',
  );
});

test('without it (could not be built): falls back to conhost --headless', () => {
  const cmd = launcherCommand({ ...paths, host: null });
  assert.equal(cmd.target, 'C:\\Windows\\System32\\conhost.exe');
  assert.equal(cmd.args, '--headless "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js"');
  assert.equal(
    cmd.commandLine,
    '"C:\\Windows\\System32\\conhost.exe" --headless "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js"',
  );
});
