'use strict';
// How the shortcut and the login Run entry start the launcher (node bin/launch.js)
// without a console window. Preferred: our own small launcher program (see
// src/launcher-host), which Windows' Startup apps list shows as "Discord (no YT
// ads)". Fallback: `conhost.exe --headless`, which it shows as "Console Window Host".

const quote = (p) => `"${p}"`;

function launcherCommand({ host, conhost, node, script }) {
  const target = host || conhost;
  const args = `${host ? '' : '--headless '}${quote(node)} ${quote(script)}`;
  return { target, args, commandLine: `${quote(target)} ${args}` };
}

module.exports = { launcherCommand };
