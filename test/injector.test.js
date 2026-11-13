'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attach } = require('../src/injector.js');

// Stand-in for the vendored AdGuard script: it marks the window the same way.
const SCRIPT = 'window.adguardInjected = true';

// Mirrors the parts of Electron's WebFrameMain the injector uses: url, parent,
// executeJavaScript (evaluated against this frame's own fake `window`), events.
class FakeFrame extends EventEmitter {
  constructor(url, parent = null) {
    super();
    this.url = url;
    this.parent = parent;
    this.window = {};
    this.executed = [];
  }
  async executeJavaScript(code) {
    this.executed.push(code);
    return new Function('window', `return (${code});`)(this.window);
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup({ pick = () => 'self', flags = {} } = {}) {
  const app = new EventEmitter();
  const lines = [];
  attach(app, {
    script: SCRIPT,
    log: (line) => lines.push(line),
    flags: typeof flags === 'function' ? flags : () => flags,
    pickTarget: pick,
  });
  const webContents = new EventEmitter();
  app.emit('web-contents-created', {}, webContents);
  const load = async (frame) => {
    webContents.emit('frame-created', {}, { frame });
    frame.emit('dom-ready');
    await settle();
  };
  return { lines, load };
}

test('injects into a frame the matcher picks, and logs that it verified', async () => {
  const { lines, load } = setup({ pick: () => 'self' });
  const frame = new FakeFrame('https://www.youtube.com/embed/abc');

  await load(frame);

  assert.equal(frame.window.adguardInjected, true);
  assert.ok(lines.some((l) => l.includes('https://www.youtube.com/embed/abc') && l.includes('adguardInjected=true')), lines.join('\n'));
});

test('logs a failed verification when the script did not take effect', async () => {
  const { lines, load } = setup();
  const frame = new FakeFrame('https://www.youtube.com/embed/abc');
  frame.executeJavaScript = async function (code) {
    this.executed.push(code); // pretend the page swallowed the script
    return code === SCRIPT ? undefined : this.window.adguardInjected === true;
  };

  await load(frame);

  assert.ok(lines.some((l) => l.includes('adguardInjected=false')), lines.join('\n'));
});

test('injects into the parent frame when the matcher says parent', async () => {
  const { load } = setup({ pick: () => 'parent' });
  const parent = new FakeFrame('https://www.youtube.com/embed/abc');
  const child = new FakeFrame('about:blank', parent);

  await load(child);

  assert.equal(parent.window.adguardInjected, true);
  assert.deepEqual(child.executed, []);
});

test('passes the frame and parent URLs to the matcher', async () => {
  const seen = [];
  const { load } = setup({ pick: (url, parentUrl) => (seen.push([url, parentUrl]), null) });

  await load(new FakeFrame('https://child.example/', new FakeFrame('https://parent.example/')));
  await load(new FakeFrame('https://top.example/'));

  assert.deepEqual(seen, [['https://child.example/', 'https://parent.example/'], ['https://top.example/', undefined]]);
});

test('leaves frames the matcher rejects alone', async () => {
  const { lines, load } = setup({ pick: () => null });
  const frame = new FakeFrame('https://discord.com/channels/@me');

  await load(frame);

  assert.deepEqual(frame.executed, []);
  assert.deepEqual(lines, []);
});

test('disabled flag: logs the match but does not inject', async () => {
  const { lines, load } = setup({ flags: { disabled: true } });
  const frame = new FakeFrame('https://www.youtube.com/embed/abc');

  await load(frame);

  assert.deepEqual(frame.executed, []);
  assert.ok(lines.some((l) => l.includes('https://www.youtube.com/embed/abc')), lines.join('\n'));
});

test('flags are re-read per frame, so toggling disabled needs no restart', async () => {
  let disabled = true;
  const { load } = setup({ flags: () => ({ disabled }) });
  const first = new FakeFrame('https://www.youtube.com/embed/one');
  const second = new FakeFrame('https://www.youtube.com/embed/two');

  await load(first);
  disabled = false;
  await load(second);

  assert.equal(first.window.adguardInjected, undefined);
  assert.equal(second.window.adguardInjected, true);
});

test('debug flag: logs every frame URL, matching or not', async () => {
  const { lines, load } = setup({ pick: () => null, flags: { debug: true } });

  await load(new FakeFrame('https://123456789012345678.discordsays.com/', new FakeFrame('https://discord.com/app')));

  assert.ok(lines.some((l) => l.includes('https://123456789012345678.discordsays.com/') && l.includes('https://discord.com/app')), lines.join('\n'));
});

test('a rejected executeJavaScript is logged, not thrown', async () => {
  const { lines, load } = setup();
  const frame = new FakeFrame('https://www.youtube.com/embed/abc');
  frame.executeJavaScript = async () => {
    throw new Error('Render frame was disposed');
  };

  await load(frame);

  assert.ok(lines.some((l) => l.includes('Render frame was disposed')), lines.join('\n'));
});

test('a matcher that throws is logged and does not break Discord’s event loop', async () => {
  const { lines, load } = setup({
    pick: () => {
      throw new Error('bad matcher');
    },
  });

  await assert.doesNotReject(load(new FakeFrame('https://www.youtube.com/embed/abc')));
  assert.ok(lines.some((l) => l.includes('bad matcher')), lines.join('\n'));
});

test('a frame-created event without a frame is ignored', () => {
  const app = new EventEmitter();
  attach(app, { script: SCRIPT, log: () => {}, flags: () => ({}), pickTarget: () => 'self' });
  const webContents = new EventEmitter();
  app.emit('web-contents-created', {}, webContents);

  assert.doesNotThrow(() => webContents.emit('frame-created', {}, { frame: null }));
});

// ---- keeping newly installed Discord versions patched while Discord runs ----

function setupRepatch(t, repatch, flags = () => ({})) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const app = new EventEmitter();
  const lines = [];
  attach(app, {
    script: SCRIPT,
    log: (line) => lines.push(line),
    flags,
    pickTarget: () => null,
    repatch,
    repatchEveryMs: 600_000,
  });
  return { app, lines };
}

test('repatches on an interval while Discord is running, logging new patches', (t) => {
  let calls = 0;
  const { lines } = setupRepatch(t, () => {
    calls++;
    return { patched: calls === 2 ? ['C:\\Discord\\app-1.0.9300\\index.js'] : [], errors: [] };
  });

  t.mock.timers.tick(599_999);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
  t.mock.timers.tick(600_000);
  assert.equal(calls, 2);
  assert.ok(lines.some((l) => l.includes('app-1.0.9300')), lines.join('\n'));
});

test('repatches once more as Discord quits (it may be restarting into an update)', (t) => {
  let calls = 0;
  const { app } = setupRepatch(t, () => {
    calls++;
    return { patched: [], errors: [] };
  });

  app.emit('before-quit');

  assert.equal(calls, 1);
});

test('after an uninstall, neither the interval nor quitting re-patches Discord', (t) => {
  let uninstalled = false;
  let calls = 0;
  const { app } = setupRepatch(
    t,
    () => {
      calls++;
      return { patched: [], errors: [] };
    },
    () => ({ uninstalled }),
  );

  uninstalled = true; // `npm run uninstall` ran while Discord was open
  t.mock.timers.tick(600_000);
  app.emit('before-quit');

  assert.equal(calls, 0);
});

test('a repatch that throws is logged and does not break Discord', (t) => {
  const { app, lines } = setupRepatch(t, () => {
    throw new Error('EACCES: permission denied');
  });

  assert.doesNotThrow(() => app.emit('before-quit'));
  assert.doesNotThrow(() => t.mock.timers.tick(600_000));
  assert.equal(lines.filter((l) => l.includes('EACCES')).length, 2);
});
