// Demo-mode flag for the Cloudflare Pages mock deployment.
//
// When the frontend is built with `VITE_DEMO_MODE=true`, the API client
// serves canned fixtures instead of calling a real backend, so the panel
// can run as a static site with no database, auth server, or agents.
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

/**
 * Dev-only chrome preview: `?demo=1` shows the demo banner and the shell
 * offset that goes with it WITHOUT switching the API client to fixtures, so
 * the banner can be reviewed against real data. Production builds are
 * unaffected (`import.meta.env.DEV` is false).
 */
export const isDemoChromePreview =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');

/** Demo banner + shell offsets: either the real demo build or the dev preview. */
export const showsDemoChrome = isDemoMode || isDemoChromePreview;
