'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { watchAndPatch } = require('../src/watch.js');
const { applyAll } = require('../src/patch.js');
const { makeTempDir, addCoreIndex, ORIGINAL_INDEX } = require('./helpers.js');

const SCHEDULE = { fastMs: 250, fastForMs: 60_000, slowMs: 2_000, totalMs: 600_000 };
const INJECTOR = 'C:\\proj\\src\\injector.js';
// MockTimers.tick(ms) moves the clock to the end first, so timers scheduled from
// inside a callback don't fire within the same tick. Advance in small steps.
function advance(t, ms, step = 250) {
  for (let done = 0; done < ms; done += step) t.mock.timers.tick(Math.min(step, ms - done));
}

function startWatch(t, scan) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lines = [];
  const done = watchAndPatch({ scan, log: (l) => lines.push(l), ...SCHEDULE });
  return { lines, done };
}

test('patches a Discord version that appears during the watch, on the next poll', async (t) => {
  const root = makeTempDir(t);
  addCoreIndex(root, 'app-1.0.9267');
  applyAll(root, INJECTOR);
  const { lines } = startWatch(t, () => applyAll(root, INJECTOR));

  t.mock.timers.tick(250);
  const fresh = addCoreIndex(root, 'app-1.0.9300'); // Discord's updater lands a new version
  assert.equal(fs.readFileSync(fresh, 'utf8'), ORIGINAL_INDEX);
  t.mock.timers.tick(250);

  assert.notEqual(fs.readFileSync(fresh, 'utf8'), ORIGINAL_INDEX);
  assert.ok(lines.some((l) => l.includes(fresh)), lines.join('\n'));
});

test('polls fast for the first minute, then slows down', (t) => {
  let scans = 0;
  startWatch(t, () => {
    scans++;
    return { patched: [], errors: [] };
  });

  advance(t, 60_000);
  assert.equal(scans, 240); // every 250 ms
  advance(t, 1_999, 1);
  assert.equal(scans, 240);
  advance(t, 1, 1);
  assert.equal(scans, 241); // then every 2 s
});

test('stops polling and resolves once the watch window is over', async (t) => {
  let scans = 0;
  const { done } = startWatch(t, () => {
    scans++;
    return { patched: [], errors: [] };
  });

  advance(t, 600_000);
  await done;
  const atEnd = scans;
  advance(t, 60_000);

  assert.equal(scans, atEnd);
  assert.equal(atEnd, 240 + 270); // 60 s fast, then 540 s at 2 s
});

test('stops for good (and resolves) once shouldStop says so, e.g. after an uninstall', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let scans = 0;
  let stop = false;
  const done = watchAndPatch({
    scan: () => {
      scans++;
      return { patched: [], errors: [] };
    },
    shouldStop: () => stop,
    log: () => {},
    ...SCHEDULE,
  });

  advance(t, 500);
  assert.equal(scans, 2);
  stop = true;
  advance(t, 60_000);
  await done;

  assert.equal(scans, 2);
});

test('a poll that throws is logged and polling carries on', async (t) => {
  let calls = 0;
  const { lines } = startWatch(t, () => {
    calls++;
    if (calls === 1) throw new Error('EBUSY: resource busy or locked');
    return { patched: ['C:\\Discord\\app-1.0.9300\\index.js'], errors: [] };
  });

  t.mock.timers.tick(250);
  t.mock.timers.tick(250);

  assert.ok(lines.some((l) => l.includes('EBUSY')), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('app-1.0.9300')), lines.join('\n'));
});

test('per-file errors reported by the scan are logged', (t) => {
  const { lines } = startWatch(t, () => ({
    patched: [],
    errors: [{ file: 'C:\\Discord\\app-1.0.9300\\index.js', error: new Error('EPERM: operation not permitted') }],
  }));

  t.mock.timers.tick(250);

  assert.ok(lines.some((l) => l.includes('EPERM') && l.includes('app-1.0.9300')), lines.join('\n'));
});
