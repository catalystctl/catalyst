/**
 * Process entrypoint.
 *
 * Environment overrides live in the database (Admin > Environment), but the
 * application modules read `process.env` while they are being imported. This
 * entry loads `.env`, applies the stored overrides, and only then imports the
 * server — so a value saved in the panel is already in effect on boot.
 *
 * `src/index.ts` stays importable on its own (tests and scripts use it); this
 * file exists solely to guarantee the ordering above.
 */
import "dotenv/config";

import { initializeEnvOverrides } from "./services/env-settings.js";

await initializeEnvOverrides();

await import("./index.js");
