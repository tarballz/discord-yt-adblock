'use strict';
// Small I/O helpers shared by the injector (inside Discord) and the launcher.
const fs = require('node:fs');
const path = require('node:path');

/** Truncates `file`, then returns a log(line) that appends timestamped lines. Never throws. */
function createFileLog(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  } catch {
    // Logging is best-effort; never let it take Discord down.
  }
  return (line) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // see above
    }
  };
}

/**
 * Flag files in the project folder: `debug` (log every frame), `disabled`
 * (don't inject), `uninstalled` (written by uninstall: never re-patch).
 */
function readFlags(projectDir) {
  const has = (name) => fs.existsSync(path.join(projectDir, name));
  return { debug: has('debug'), disabled: has('disabled'), uninstalled: has('uninstalled') };
}

/**
 * The injector path written into Discord's index.js. Canonicalized (true on-disk
 * casing) so the launcher and the in-Discord repatcher always write the exact
 * same block and never "re-patch" each other's spelling of the path.
 */
function injectorPath() {
  return fs.realpathSync.native(path.join(__dirname, 'injector.js'));
}

module.exports = { createFileLog, readFlags, injectorPath };
