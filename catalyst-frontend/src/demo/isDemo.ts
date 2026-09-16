// Demo-mode flag for the Cloudflare Pages mock deployment.
//
// When the frontend is built with `VITE_DEMO_MODE=true`, the API client
// serves canned fixtures instead of calling a real backend, so the panel
// can run as a static site with no database, auth server, or agents.
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
