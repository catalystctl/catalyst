/**
 * Catalyst - Vitest global setup
 *
 * DATABASE_URL handling:
 *  1. If `TEST_DATABASE_URL` is set, use it (overrides DATABASE_URL).
 *  2. Otherwise, run against DATABASE_URL. If it does NOT look like a test
 *     database, print a clear warning so the developer knows they're
 *     running against what looks like a live DB. We do NOT block.
 *
 * Safety contract:
 *  Tests MUST use per-run scoped data (see runId/mkName pattern in
 *  test files). Hardcoded "Administrator" / "admin@example.com" / etc.
 *  in test setup is forbidden — it would destroy real data.
 *  Linting this is hard; the test authors are responsible.
 */
import dotenv from "dotenv";

dotenv.config();

function isTestDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const dbName = u.pathname.replace(/^\//, "");
    if (/_test$|^test_/.test(dbName)) return true;
    if (u.searchParams.get("schema") === "test") return true;
    return false;
  } catch {
    return false;
  }
}

const explicitTestUrl = process.env.TEST_DATABASE_URL;
if (explicitTestUrl) {
  process.env.DATABASE_URL = explicitTestUrl;
  // eslint-disable-next-line no-console
  console.log(
    `[vitest.setup] Using TEST_DATABASE_URL: ${explicitTestUrl.replace(/:[^:@/]+@/, ":***@")}`,
  );
} else if (!isTestDatabaseUrl(process.env.DATABASE_URL)) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n" +
      "====================================================================\n" +
      "[vitest.setup] WARNING: Running tests against a non-test-looking\n" +
      "DATABASE_URL. If this is a live/dev database, ensure your tests\n" +
      "use per-run scoped data (e.g. `runId` + `mkName()`) and clean up\n" +
      "only what they create. Hardcoded references to real users/roles\n" +
      "(e.g. `admin@example.com`, `Administrator`) will be destroyed.\n" +
      "\n" +
      "For isolation, set TEST_DATABASE_URL to a dedicated test database\n" +
      "(e.g. postgresql://user:pass@localhost:5432/catalyst_test) and\n" +
      "create it with `createdb catalyst_test`.\n" +
      "====================================================================\n",
  );
}
