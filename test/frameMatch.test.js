'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickInjectionTarget } = require('../src/frameMatch.js');

// Captured from a live Watch Together session on 2026-11-12 (guild/channel/launch
// ids replaced with fakes). Note the embed has NO video id in its path: Discord
// creates one empty player and switches videos through the IFrame player API.
const WT_ACTIVITY =
  'https://880218394199220334.discordsays.com/?instance_id=i-1111111111111111111-gc-222222222222222222-333333333333333333&location_id=gc-222222222222222222-333333333333333333&launch_id=1111111111111111111&theme=midnight&platform=desktop&discord_shim=1';
const WT_EMBED =
  'https://www.youtube.com/embed/?autoplay=0&controls=1&disablekb=1&iv_load_policy=3&playsinline=1&rel=1&fs=0&start=0' +
  '&origin=https%3A%2F%2F880218394199220334.discordsays.com&widget_referrer=https%3A%2F%2Fdiscord.com%2F&pageType=1&enablejsapi=1&widgetid=1' +
  '&forigin=https%3A%2F%2F880218394199220334.discordsays.com%2F%3Finstance_id%3Di-1111111111111111111-gc-222222222222222222-333333333333333333' +
  '&aoriginsup=1&aorigins=https%3A%2F%2Fdiscord.com&gporigin=https%3A%2F%2Fdiscord.com%2F&vf=6';
const DISCORD_APP = 'https://discord.com/app?_=1794537047650';
const DISCORD_CHANNEL = 'https://discord.com/channels/222222222222222222/333333333333333333';
// Google ad-verification frame that YouTube loads *inside* the embed.
const SODAR = 'https://tpc.googlesyndication.com/sodar/5k7CCto5.html';
// Not captured (chat embed skipped during recon): standard chat-embed shape.
const CHAT_EMBED = 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&auto_play=1';

const cases = [
  // [description, frameUrl, parentUrl, expected]
  ['Watch Together YouTube player', WT_EMBED, WT_ACTIVITY, 'self'],
  ['YouTube chat embed', CHAT_EMBED, DISCORD_APP, 'self'],
  ['the Watch Together activity page itself', WT_ACTIVITY, DISCORD_CHANNEL, null],
  ['Discord app (top-level frame)', DISCORD_APP, undefined, null],
  ['blank helper frame under Discord', 'about:blank', DISCORD_APP, null],
  ['blank helper frame under the activity', 'about:blank', WT_ACTIVITY, null],
  ['frame with no URL yet', '', DISCORD_APP, null],
];

for (const [name, url, parentUrl, expected] of cases) {
  test(`${name} → ${expected}`, () => {
    assert.equal(pickInjectionTarget(url, parentUrl), expected);
  });
}

// ---- Design decisions -------------------------------------------------------
const decisions = [
  // Strict host + path check: lookalikes and URLs that merely *mention* an embed don't match.
  ['lookalike host', 'https://notyoutube.com/embed/x', DISCORD_APP, null],
  ['youtube.com as a subdomain of another site', 'https://www.youtube.com.evil.example/embed/x', DISCORD_APP, null],
  ['embed URL inside a query string', 'https://evil.example/?u=https://www.youtube.com/embed/x', DISCORD_APP, null],
  ['YouTube page that is not the embed player', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', DISCORD_APP, null],
  // Same player, same ads: covered in case Discord ever switches to it.
  ['privacy-enhanced (nocookie) embed', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', DISCORD_APP, 'self'],
  // Frames inside the player re-target the player (fallback if its own dom-ready was missed;
  // a no-op re-run otherwise thanks to adguard.js's guard). Never inject into the child itself.
  ['Google ad-verification frame inside the player', SODAR, WT_EMBED, 'parent'],
  ['blank helper frame inside the player', 'about:blank', WT_EMBED, 'parent'],
];

for (const [name, url, parentUrl, expected] of decisions) {
  test(`${name} → ${expected}`, () => {
    assert.equal(pickInjectionTarget(url, parentUrl), expected);
  });
}
