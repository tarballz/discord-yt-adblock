'use strict';
// Compiles src/launcher-host/Launcher.cs into a small .exe with the C# compiler
// that ships with .NET Framework 4.x on Windows 10/11 (no download, no binary
// in the repo). See Launcher.cs for why it exists.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SOURCE = path.join(__dirname, 'launcher-host', 'Launcher.cs');

function findCsc(systemRoot = process.env.SystemRoot || 'C:\\Windows') {
  for (const framework of ['Framework64', 'Framework']) {
    const csc = path.join(systemRoot, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe');
    if (fs.existsSync(csc)) return csc;
  }
  return null;
}

/** Builds the launcher at `out` (optionally with an icon). Returns `out`, or null if it couldn't be built. */
function buildLauncherHost({ out, icon, csc = findCsc() }) {
  if (!csc || !fs.existsSync(csc)) return null;
  const args = ['/nologo', '/target:winexe', '/optimize+', `/out:${out}`];
  if (icon && fs.existsSync(icon)) args.push(`/win32icon:${icon}`);
  args.push(SOURCE);
  try {
    execFileSync(csc, args, { stdio: 'pipe' });
  } catch {
    return null;
  }
  return fs.existsSync(out) ? out : null;
}

module.exports = { buildLauncherHost };
