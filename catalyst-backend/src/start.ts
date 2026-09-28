/**
 * Backwards-compatible alias for the process entrypoint.
 *
 * `src/index.ts` is the real loader: it applies the database environment
 * overrides and then imports `src/server.ts`. This file exists only so images
 * or scripts that launch `dist/start.js` keep working.
 */
import "./index.js";
