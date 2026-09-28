/**
 * Process entrypoint — applies stored environment overrides, then boots the
 * server.
 *
 * Environment values managed in Admin > Environment live in the database, but
 * the application modules read `process.env` while they are being imported.
 * This file loads `.env`, applies the overrides, and only then imports the
 * server (`./server.ts`), so a value saved in the panel is in effect on boot.
 *
 * This is the historical entrypoint (`dist/index.js`), so every way of starting
 * the backend — the Docker image, `pnpm start`, a custom compose `command:`, or
 * a script — goes through the override step. `src/start.ts` is a thin alias for
 * backwards compatibility.
 */
import "dotenv/config";

import { initializeEnvOverrides } from "./services/env-settings.js";

await initializeEnvOverrides();

await import("./server.js");
