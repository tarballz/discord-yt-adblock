'use strict';
// Keeps re-running the patcher for a while after launch. Discord often installs
// an update during its splash screen and then restarts itself into the new
// version without going through our launcher; this closes that window.

/**
 * Calls `scan()` (applyAll) on a fast-then-slow schedule until `totalMs` has
 * elapsed. Never throws. Resolves when the watch is over.
 */
function watchAndPatch({ scan, log, shouldStop = () => false, fastMs = 250, fastForMs = 60_000, slowMs = 2_000, totalMs = 600_000 }) {
  return new Promise((resolve) => {
    let elapsed = 0;

    const poll = () => {
      if (shouldStop()) return resolve();
      try {
        const result = scan();
        for (const file of result.patched) log(`patched during watch → ${file}`);
        for (const { file, error } of result.errors) log(`ERROR during watch ${file}: ${error.message}`);
      } catch (err) {
        log(`ERROR during watch: ${err?.message ?? err}`);
      }
      schedule();
    };

    const schedule = () => {
      if (elapsed >= totalMs) return resolve();
      const delay = elapsed < fastForMs ? fastMs : slowMs;
      elapsed += delay;
      setTimeout(poll, delay);
    };

    schedule();
  });
}

module.exports = { watchAndPatch };
