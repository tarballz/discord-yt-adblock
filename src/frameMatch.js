'use strict';

const YOUTUBE_EMBED_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);

/** True for the YouTube embed player (Watch Together's is `/embed/` with no video id). */
function isYouTubeEmbed(url) {
  if (!url) return false;
  try {
    const { hostname, pathname } = new URL(url);
    return YOUTUBE_EMBED_HOSTS.has(hostname) && pathname.startsWith('/embed/');
  } catch {
    return false; // not a parseable URL
  }
}

/**
 * Decides which frame (if any) should get the ad-blocking script.
 *
 * Called from the injector for every frame Discord loads, once its DOM is ready.
 *
 * @param {string} frameUrl              URL of the frame that just became ready
 * @param {string | undefined} parentUrl URL of its parent frame (undefined for top-level frames)
 * @returns {'self' | 'parent' | null}
 *   'self'   → inject into this frame (it IS the YouTube player)
 *   'parent' → inject into the parent (this is a sub-frame *inside* the YouTube player)
 *   null     → leave it alone
 */
function pickInjectionTarget(frameUrl, parentUrl) {
  if (isYouTubeEmbed(frameUrl)) return 'self';
  // Sub-frames inside the player (about:blank, Google's ad-verification frame):
  // re-target the player itself, never the sub-frame.
  if (isYouTubeEmbed(parentUrl)) return 'parent';
  return null;
}

module.exports = { pickInjectionTarget };
