// URL flags honoured from the first milestone: ?skipintro=1 (no title card / flyover), ?debug=1
// (uncertain badges, FPS meter, test marker), ?tier=high|mid|low, ?mode=nature|culture|conservation.
const q = new URLSearchParams(location.search);
export const flags = {
  skipIntro: q.get('skipintro') === '1',
  debug: q.get('debug') === '1',
  tier: q.get('tier'),
  mode: q.get('mode'),
  atmo: q.get('atmo'),
  /** On-screen FPS + tier meter only (for testing on real phones): ?fps=1 */
  fps: q.get('fps') === '1',
  /** FPS watchdog: on by default for real visitors, off under automation (software GL is always "slow")
   *  unless ?watchdog=1; ?watchdog=0 turns it off. */
  watchdog: q.get('watchdog') === '1' ? true : q.get('watchdog') === '0' ? false : !navigator.webdriver,
};
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Base URL of the deployed app (Vite `base: './'`), used for every data fetch. */
export const BASE = import.meta.env.BASE_URL;
