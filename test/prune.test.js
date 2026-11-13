'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PRUNE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'prune.js'), 'utf8');

// A fresh browser-like global per test: its own JSON, plus a minimal Response
// whose json() parses the body the way the real one does.
function page() {
  const ctx = vm.createContext({});
  vm.runInContext(
    `var window = globalThis;
     class Response { constructor(body) { this.body = body; } async json() { return JSON.parse(this.body); } }
     globalThis.Response = Response;`,
    ctx,
  );
  return ctx;
}
const inject = (ctx) => vm.runInContext(PRUNE, ctx);

// Shape seen by the diagnostic probe on /youtubei/v1/player (2026-11-12), trimmed.
const PLAYER_RESPONSE = JSON.stringify({
  playabilityStatus: { status: 'OK' },
  videoDetails: { videoId: 'dQw4w9WgXcQ' },
  adSlots: [{ adSlotRenderer: { fulfillmentContent: { fulfilledLayout: { playerBytesAdLayoutRenderer: {} } } } }],
  adBreakHeartbeatParams: 'Q0FB',
});

test('JSON.parse hands the page a player response without adSlots', () => {
  const ctx = page();
  inject(ctx);
  ctx.src = PLAYER_RESPONSE;

  const parsed = vm.runInContext('JSON.parse(src)', ctx);

  assert.equal('adSlots' in parsed, false);
  assert.equal(parsed.videoDetails.videoId, 'dQw4w9WgXcQ');
  assert.equal(parsed.adBreakHeartbeatParams, 'Q0FB');
});

test('Response.json() hands the page a player response without adSlots', async () => {
  const ctx = page();
  inject(ctx);
  ctx.src = PLAYER_RESPONSE;

  const parsed = await vm.runInContext('new Response(src).json()', ctx);

  assert.equal('adSlots' in parsed, false);
  assert.equal(parsed.playabilityStatus.status, 'OK');
});

test('removes adSlots nested inside a larger response (e.g. playerResponse in /next)', () => {
  const ctx = page();
  inject(ctx);
  ctx.src = JSON.stringify({ contents: {}, playerResponse: JSON.parse(PLAYER_RESPONSE) });

  const parsed = vm.runInContext('JSON.parse(src)', ctx);

  assert.equal('adSlots' in parsed.playerResponse, false);
  assert.equal(parsed.playerResponse.videoDetails.videoId, 'dQw4w9WgXcQ');
});

test('passes non-object JSON and reviver arguments through unchanged', () => {
  const ctx = page();
  inject(ctx);

  assert.equal(vm.runInContext('JSON.parse("42")', ctx), 42);
  assert.equal(vm.runInContext('JSON.parse("null")', ctx), null);
  assert.equal(vm.runInContext(`JSON.parse('{"a":1}', (k, v) => (k === 'a' ? v + 1 : v)).a`, ctx), 2);
});

test('injecting twice does not wrap twice', () => {
  const ctx = page();
  inject(ctx);
  const once = vm.runInContext('JSON.parse', ctx);
  inject(ctx);

  assert.equal(vm.runInContext('JSON.parse', ctx), once);
});
