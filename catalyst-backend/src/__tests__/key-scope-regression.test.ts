/**
 * Key-scope Phase 4 regression guards (source-scan, no app boot).
 *
 * Guard A: the ensureServerAccess-family access helpers must keep their
 * mandatory `actor` parameter — a call site that cannot produce an actor
 * (request.user, or SYSTEM_ACTOR for system/cron paths) is a key-scope
 * bypass, and the compiler must surface it.
 *
 * Guard B: every authenticated route registration must carry a key-scope
 * mechanism: a route-config declaration (requiredPermission /
 * requiredAllPermissions / keyScopeExemptReason with a reason), or an
 * in-handler gate — an actor-threaded family helper call, or a
 * request-based permission gate (request.user.permissions IS the key's
 * scope on the API-key path, so any hasGrant-over-request-user check is a
 * ceiling). Deliberately exempted routes carry keyScopeExemptReason with
 * their reason inline; new local gate helpers should be added to GATE_PATTERNS.
 *
 * Drift guard (TODO-activate): auto-activates when audit-server-core lands
 * src/__tests__/route-contract.matrix.ts — every scanned route must then
 * carry a matrix row.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = join(HERE, "..");
const readSrc = (rel: string) => readFileSync(join(BACKEND_SRC, rel), "utf8");

describe("key-scope — mandatory actor on the access helpers (Guard A)", () => {
  it("family signatures take a required actor (no silent ceiling skip)", () => {
    const helpers = readSrc("routes/servers/_helpers.ts");
    expect(helpers).toContain("actor: Actor,");
    expect(helpers).not.toMatch(/actor\?:/);
    expect(helpers).toContain("export const SYSTEM_ACTOR");

    for (const file of ["routes/servers/files.ts", "routes/backups.ts", "routes/tasks.ts"]) {
      const src = readSrc(file);
      expect(src, `${file} must thread a required actor`).toContain("actor: Actor,");
      expect(src, `${file} must not keep an optional actor`).not.toMatch(/actor\?:/);
    }
  });

  it("power's gate enforces its own key ceiling from request.user", () => {
    const power = readSrc("routes/servers/power.ts");
    expect(power).toContain("request: FastifyRequest");
    expect(power).toContain("enforceKeyScope(request.user");
  });

  it("Actor threading survives in the call sites (spot anchors)", () => {
    // The signatures above are only a bypass-guard if the call sites keep
    // passing request.user; anchors catch wholesale copy-paste regressions.
    const invites = readSrc("routes/servers/invites.ts");
    expect(invites).toContain("canManageSubusers(userId, server, request.user)");
    expect(invites).toContain("canAccessServer(userId, server, request.user)");
    const core = readSrc("routes/servers/core.ts");
    expect(core).toContain("canAccessServer(userId, { id: source.id, ownerId: source.ownerId, nodeId: source.nodeId }, request.user)");
  });
});

// ── Guard B: route inventory source scan ────────────────────────────────────

const GATE_PATTERNS: RegExp[] = [
  // Route-config declarations (the preferred, uniform idiom).
  /requiredPermission/, /requiredAllPermissions/, /keyScopeExemptReason/,
  // Actor-threaded access helpers (the key ceiling lives inside them).
  /ensureServerAccess\(/, /ensureBackupAccess\(/, /ensurePowerAccess\(/,
  /ensureSchedulePermission\(/, /ensureActionPermission\(/, /ensureDatabasePermission\(/,
  /ensureSuspendPermission\(/, /ensureArchivePermission\(/, /requireFileAccess\(/,
  /canAccessServer\(/, /canManageSubusers\(/,
  /enforceKeyScope\(/, /enforceRouteKeyScope\(/,
  // Request-based permission gates (request.user.permissions = key scope).
  /checkPerm\(/, /checkAnyPerm\(/, /checkIsAdmin\(/, /checkPermission\(/,
  /canManageUsers\(/, /ensurePermission\(/, /ensureAnyPermission\(/,
  /requireAdmin\(/, /ensureAdmin\(/, /isAdminCaller\(/, /isAdminUser\(/,
  /requireRead\(/, /requireWrite\(/, /requirePermission\(/, /requireApiKeyRead\b/,
  /hasGrant\(/, /permissionMatches\(/, /isAdmin\(/,
];

const ROUTE_RE = /app\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2\s*,/g;

function listRouteFiles(): string[] {
  const files: string[] = [join(BACKEND_SRC, "server.ts")];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    }
  };
  walk(join(BACKEND_SRC, "routes"));
  return files;
}

/** Balanced-brace extraction of the route options object after the path. */
function extractOptions(src: string, from: number): string {
  const open = src.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  let i = open;
  let inStr: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (c === inStr && src[i - 1] !== "\\") inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i++;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
    i++;
  }
  return "";
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

interface AuthedRoute {
  file: string;
  method: string;
  path: string;
}

function scanAuthenticatedRoutes(): AuthedRoute[] {
  const routes: AuthedRoute[] = [];
  for (const file of listRouteFiles()) {
    const src = readFileSync(file, "utf8");
    const matches = [...src.matchAll(ROUTE_RE)];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const opts = extractOptions(src, m.index + m[0].length);
      if (!/\bauthenticate\b|\bwithAuth\b/.test(opts)) continue;
      routes.push({
        file: file.replace(`${BACKEND_SRC}/`, ""),
        method: m[1].toUpperCase(),
        path: m[3],
      });
    }
  }
  return routes;
}

describe("key-scope — every authenticated route carries a gate (Guard B)", () => {
  it("authenticated routes declare a config ceiling, a family helper, or a request-based gate", () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const file of listRouteFiles()) {
      const src = readFileSync(file, "utf8");
      const matches = [...src.matchAll(ROUTE_RE)];
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const opts = extractOptions(src, m.index + m[0].length);
        if (!/\bauthenticate\b|\bwithAuth\b/.test(opts)) continue;
        scanned++;
        const segEnd = i + 1 < matches.length ? matches[i + 1].index : src.length;
        const segment = stripComments(src.slice(m.index, segEnd));
        const gated = GATE_PATTERNS.some((re) => re.test(segment));
        if (!gated) {
          violations.push(`${file.replace(`${BACKEND_SRC}/`, "")} ${m[1].toUpperCase()} ${m[3]}`);
        }
      }
    }
    // Sanity: the scan must actually see the route surface (~295 today).
    expect(scanned).toBeGreaterThan(250);
    expect(
      violations,
      `authenticated routes with no key-scope mechanism (add a config declaration, thread an actor, or a keyScopeExemptReason with reason):\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });

  it("exemption markers always carry a reason string", () => {
    const markers = /keyScopeExemptReason\s*:\s*(['"])([^'"]+)\1/g;
    for (const file of listRouteFiles()) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(markers)) {
        expect(m[2].length, `${file} has an empty keyScopeExemptReason`).toBeGreaterThan(10);
      }
    }
  });
});

// ── Drift guard (TODO-activate with route-contract.matrix.ts) ────────────────

const MATRIX_PATH = join(HERE, "route-contract.matrix.ts");

describe.skipIf(!existsSync(MATRIX_PATH))(
  "key-scope — route matrix drift guard (activates when route-contract.matrix.ts lands)",
  () => {
    it("matrix covers the scanned route surface (provisional check)", () => {
      // TODO-activate (with audit-server-core): replace the non-emptiness
      // check with the real diff — every route in scanAuthenticatedRoutes()
      // must carry a matrix row; fail on any route without one. That is the
      // test-plan.md §4 lock that makes the suite fail on future drift.
      const matrixSrc = readFileSync(MATRIX_PATH, "utf8");
      expect(matrixSrc.length).toBeGreaterThan(0);
      const routes = scanAuthenticatedRoutes();
      expect(routes.length).toBeGreaterThan(250);
    });
  },
);

it.skip("TODO-activate: full drift diff completes with audit-server-core's matrix format", () => {
  // The skipIf describe above turns on automatically when
  // src/__tests__/route-contract.matrix.ts lands; this marker records that
  // the full row-by-row diff still needs the matrix's real shape.
});
