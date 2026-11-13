'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { launcherCommand } = require('../src/startup.js');

const paths = {
  conhost: 'C:\\Windows\\System32\\conhost.exe',
  node: 'C:\\Program Files\\nodejs\\node.exe', // note the space
  script: 'C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js',
};

test('shortcut target is conhost, with node + launcher quoted in the arguments', () => {
  const cmd = launcherCommand(paths);
  assert.equal(cmd.target, 'C:\\Windows\\System32\\conhost.exe');
  assert.equal(cmd.args, '--headless "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js"');
});

test('Run-key command line quotes every path so spaces survive', () => {
  assert.equal(
    launcherCommand(paths).commandLine,
    '"C:\\Windows\\System32\\conhost.exe" --headless "C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\me\\code\\discord-yt-adblock\\bin\\launch.js"',
  );
});
