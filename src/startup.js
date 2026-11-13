'use strict';
// How Discord gets started: by the shortcut, by our login entry, or (after an
// uninstall) by Discord's own login entry.

const quote = (p) => `"${p}"`;

/**
 * How the shortcut / login entry run the launcher (node bin/launch.js) without a
 * console window. Preferred: our own small launcher program (src/launcher-host),
 * which Startup apps shows as "Discord (no YT ads)". Fallback: `conhost.exe
 * --headless`, shown as "Console Window Host". `atLogin` marks the login entry.
 */
function launcherCommand({ host, conhost, node, script, atLogin = false }) {
  const target = host || conhost;
  const args = `${host ? '' : '--headless '}${quote(node)} ${quote(script)}${atLogin ? ' --at-login' : ''}`;
  return { target, args, commandLine: `${quote(target)} ${args}` };
}

// Mirrors Discord's own autostart (resources/app.asar, autoStart install()):
// at login it forwards --start-inactive (don't steal focus) and, when the user's
// "Start Minimized" setting is on, --start-minimized (stay in the tray).
function loginFlags(startMinimized) {
  return ['--start-inactive', ...(startMinimized ? ['--start-minimized'] : [])].join(' ');
}

/** Update.exe arguments for starting Discord. */
function discordStartArgs({ atLogin, startMinimized }) {
  const args = ['--processStart', 'Discord.exe'];
  if (atLogin) args.push('--process-start-args', loginFlags(startMinimized));
  return args;
}

/** Discord's own HKCU Run command line, exactly as Discord writes it. */
function discordAutostartCommand({ targetExe, startMinimized }) {
  return `${quote(targetExe)} --processStart Discord.exe --process-start-args ${quote(loginFlags(startMinimized))}`;
}

module.exports = { launcherCommand, discordStartArgs, discordAutostartCommand };
