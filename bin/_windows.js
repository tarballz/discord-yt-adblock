'use strict';
// Windows glue shared by install.js / uninstall.js: shortcuts and the login Run entry.
// Values travel to PowerShell through environment variables, never string-spliced
// into the script, so paths with spaces/quotes can't break (or inject into) it.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SHORTCUT_NAME = 'Discord (no YT ads).lnk';
const RUN_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'DiscordYtAdblock';

function powershell(script, env = {}) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim();
}

function shortcutPaths() {
  const desktop = powershell("[Environment]::GetFolderPath('Desktop')"); // follows OneDrive redirection
  const startMenu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  return [path.join(startMenu, SHORTCUT_NAME), path.join(desktop, SHORTCUT_NAME)];
}

function createShortcut(lnk, { target, args, cwd, icon }) {
  powershell(
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:DYTA_LNK); ' +
      '$s.TargetPath = $env:DYTA_TARGET; $s.Arguments = $env:DYTA_ARGS; $s.WorkingDirectory = $env:DYTA_CWD; ' +
      "$s.IconLocation = $env:DYTA_ICON; $s.Description = 'Discord with YouTube ads blocked (discord-yt-adblock)'; $s.Save()",
    { DYTA_LNK: lnk, DYTA_TARGET: target, DYTA_ARGS: args, DYTA_CWD: cwd, DYTA_ICON: icon },
  );
}

function setRunEntry(commandLine) {
  powershell(`Set-ItemProperty -Path '${RUN_KEY}' -Name '${RUN_VALUE}' -Value $env:DYTA_CMD`, { DYTA_CMD: commandLine });
}

function removeRunEntry() {
  powershell(`Remove-ItemProperty -Path '${RUN_KEY}' -Name '${RUN_VALUE}' -ErrorAction SilentlyContinue`);
}

/** True while Discord's own "Open Discord" (start at login) setting is on. */
function discordAutostartEnabled() {
  return powershell(`[bool](Get-ItemProperty -Path '${RUN_KEY}' -Name 'Discord' -ErrorAction SilentlyContinue)`) === 'True';
}

module.exports = { shortcutPaths, createShortcut, setRunEntry, removeRunEntry, discordAutostartEnabled };
