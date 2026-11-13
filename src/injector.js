'use strict';
// Runs inside Discord's Electron main process (loaded by the patched
// discord_desktop_core/index.js). Watches every frame Discord creates and runs
// the ad-stripping script in the YouTube embed frames.

const VERIFY = 'window.adguardInjected === true';

/**
 * @param {import('events').EventEmitter} app  Electron `app` (or a fake in tests)
 * @param {object} deps
 * @param {string} deps.script                 code to run in matching frames
 * @param {(line: string) => void} deps.log
 * @param {() => {debug?: boolean, disabled?: boolean}} deps.flags  re-read per frame
 * @param {(url: string, parentUrl?: string) => 'self'|'parent'|null} deps.pickTarget
 * @param {() => {patched: string[], errors: {file: string, error: Error}[]}} [deps.repatch]
 *        re-applies the patch to any newly installed Discord version (applyAll)
 * @param {number} [deps.repatchEveryMs]
 */
function attach(app, { script, log, flags, pickTarget, repatch, repatchEveryMs = 10 * 60_000 }) {
  if (repatch) {
    const runRepatch = () => {
      try {
        if (flags().uninstalled) return; // don't undo `npm run uninstall`
        const result = repatch();
        for (const file of result.patched) log(`repatched → ${file}`);
        for (const { file, error } of result.errors) log(`ERROR repatching ${file}: ${error.message}`);
      } catch (err) {
        log(`ERROR repatching: ${err?.message ?? err}`);
      }
    };
    // Background updates land while Discord runs; patch them before Discord restarts into them.
    setInterval(runRepatch, repatchEveryMs);
    app.on('before-quit', runRepatch);
  }

  async function onDomReady(frame) {
    let url;
    try {
      url = frame.url;
      const parentUrl = frame.parent?.url;
      const { debug, disabled } = flags();
      if (debug) log(`frame ${url} (parent ${parentUrl ?? 'none'})`);

      const target = pickTarget(url, parentUrl);
      if (target !== 'self' && target !== 'parent') return;
      const targetFrame = target === 'self' ? frame : frame.parent;

      if (disabled) {
        log(`disabled; would inject → ${targetFrame.url}`);
        return;
      }
      await targetFrame.executeJavaScript(script);
      const verified = await targetFrame.executeJavaScript(VERIFY);
      log(`injected → ${targetFrame.url} adguardInjected=${verified === true}`);
    } catch (err) {
      log(`inject failed (${url ?? 'unknown frame'}): ${err?.message ?? err}`);
    }
  }

  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('frame-created', (_e, details) => {
      const frame = details?.frame;
      if (!frame) return;
      // `on`, not `once`: a frame that navigates gets a fresh document. The
      // script's own adguardInjected guard makes repeat runs on one document no-ops.
      frame.on('dom-ready', () => onDomReady(frame));
    });
  });
}

// Real wiring, only when loaded by Discord's main process (tests load this file
// under plain Node, where process.versions.electron is undefined). Any throw
// here is caught by the try/catch in the patched index.js.
function start() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { app } = require('electron');
  const { createFileLog, readFlags, injectorPath } = require('./runtime.js');
  const { pickInjectionTarget } = require('./frameMatch.js');
  const { applyAll } = require('./patch.js');

  const projectDir = path.resolve(__dirname, '..');
  // process.execPath = <Discord root>\app-1.0.XXXX\Discord.exe
  const discordRoot = path.dirname(path.dirname(process.execPath));
  const self = injectorPath();
  const log = createFileLog(path.join(projectDir, 'logs', 'injector.log'));
  // Our adSlots pruner + the vendored AdGuard script, run as one injection.
  const script = [path.join(__dirname, 'page', 'prune.js'), path.join(__dirname, 'vendor', 'adguard.js')]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  attach(app, {
    script,
    log,
    flags: () => readFlags(projectDir),
    pickTarget: pickInjectionTarget,
    repatch: () => applyAll(discordRoot, self),
  });
  log(`loaded into ${path.basename(path.dirname(process.execPath))} (Electron ${process.versions.electron})`);
}

if (process.versions.electron && process.type === 'browser') start();

module.exports = { attach };
