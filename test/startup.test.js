'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { launcherCommand, discordStartArgs, discordAutostartCommand } = require('../src/startup.js');

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

test('the login entry tells the launcher it is starting at login', () => {
  for (const host of [HOST, null]) {
    const cmd = launcherCommand({ ...paths, host, atLogin: true });
    assert.match(cmd.commandLine, / --at-login$/);
    assert.match(cmd.args, / --at-login$/);
  }
});

// Discord's own login entry (resources/app.asar, autoStart install) forwards
// --start-inactive always and --start-minimized when START_MINIMIZED is on.
test('opened by hand (shortcut): Discord starts normally, no extra flags', () => {
  assert.deepEqual(discordStartArgs({ atLogin: false, startMinimized: true }), ['--processStart', 'Discord.exe']);
});

test('at login: same flags Discord itself would use', () => {
  assert.deepEqual(discordStartArgs({ atLogin: true, startMinimized: false }), [
    '--processStart', 'Discord.exe', '--process-start-args', '--start-inactive',
  ]);
  assert.deepEqual(discordStartArgs({ atLogin: true, startMinimized: true }), [
    '--processStart', 'Discord.exe', '--process-start-args', '--start-inactive --start-minimized',
  ]);
});

test('uninstall restores Discord’s login entry in Discord’s own format', () => {
  const exe = 'C:\\Users\\me\\AppData\\Local\\Discord\\Discord.exe';
  assert.equal(
    discordAutostartCommand({ targetExe: exe, startMinimized: false }),
    '"C:\\Users\\me\\AppData\\Local\\Discord\\Discord.exe" --processStart Discord.exe --process-start-args "--start-inactive"',
  );
  assert.equal(
    discordAutostartCommand({ targetExe: exe, startMinimized: true }),
    '"C:\\Users\\me\\AppData\\Local\\Discord\\Discord.exe" --processStart Discord.exe --process-start-args "--start-inactive --start-minimized"',
  );
});
