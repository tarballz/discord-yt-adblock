'use strict';
// How the shortcut and the login Run entry start the launcher: through
// `conhost.exe --headless`, so the 10-minute watch runs without a console window.

const quote = (p) => `"${p}"`;

function launcherCommand({ conhost, node, script }) {
  const args = `--headless ${quote(node)} ${quote(script)}`;
  return { target: conhost, args, commandLine: `${quote(conhost)} ${args}` };
}

module.exports = { launcherCommand };
