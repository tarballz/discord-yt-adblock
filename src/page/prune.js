// Runs inside the YouTube embed page, alongside the vendored AdGuard script.
// AdGuard strips `adPlacements` and `playerAds`; current YouTube player responses
// also schedule video ads through `adSlots` (playerBytesAdLayoutRenderer), which
// AdGuard misses, so those ads started and were only fast-forwarded afterwards.
// Removing `adSlots` before the player sees the response stops them starting.
(() => {
  if (window.__dytaPrune) return;
  window.__dytaPrune = true;

  const AD_KEYS = ['adSlots'];
  const MAX_DEPTH = 12;

  const strip = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) return;
    for (const key of AD_KEYS) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) delete obj[key];
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') strip(value, depth + 1);
    }
  };

  const parse = JSON.parse;
  JSON.parse = function (...args) {
    const result = parse.apply(this, args);
    strip(result, 0);
    return result;
  };

  const json = Response.prototype.json;
  Response.prototype.json = async function (...args) {
    const result = await json.apply(this, args);
    strip(result, 0);
    return result;
  };
})();
