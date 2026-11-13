'use strict';
// Start-at-login handling. Discord's own setting lives in
// %APPDATA%\discord\settings.json (OPEN_ON_STARTUP) and Discord re-creates its
// HKCU Run entry from it, so taking over login startup means flipping that flag
// (only while Discord is closed: it rewrites the file itself while running).
const fs = require('node:fs');

/** Sets OPEN_ON_STARTUP in Discord's settings.json. Returns false (and writes nothing) if the file is missing or unreadable. */
function setOpenOnStartup(settingsFile, value) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return false;
  }
  settings.OPEN_ON_STARTUP = value;
  const tmp = `${settingsFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, settingsFile);
  return true;
}

/**
 * Decides login startup after an install: we only start Discord at login if the
 * user already had Discord doing that (or we took it over on an earlier install).
 */
function planAutostart({ discordAutostart, ourEntry, discordRunning }) {
  return {
    ourEntry: discordAutostart || ourEntry,
    disableDiscordAutostart: discordAutostart && !discordRunning,
  };
}

module.exports = { setOpenOnStartup, planAutostart };
