# Security Review Quick Reference Card

> Use this alongside SECURITY_REVIEW_PROMPT.md for detailed guidance

## PI Teams Setup

Each parallel agent should:
1. Create a dedicated findings file: `security-findings/[domain]-findings.md`
2. Follow the finding format in the main prompt
3. Include file:line references for all issues
4. Mark intentional features with explanation

## Key Files to Start With

| Priority | File | Security Focus |
|----------|------|----------------|
| 1 | `auth.ts` | Session management, token handling |
| 2 | `rbac.ts` | Authorization bypass possibilities |
| 3 | `permissions.ts` | Permission scoping, wildcards |
| 4 | `servers.ts` | Server ownership, IDOR |
| 5 | `sftp-server.ts` | Path traversal, symlinks |
| 6 | `gateway.ts` | WebSocket auth, message types |
| 7 | `agent-auth.ts` | Node authentication |
| 8 | `file-tunnel.ts` | SSRF, file access |

## Common Vulnerability Patterns

### SQL Injection
```typescript
// DANGEROUS - Check for this:
await prisma.$executeRawUnsafe(`SELECT * FROM users WHERE id = ${userId}`)

// SAFE - Parameterized:
await prisma.$executeRaw`SELECT * FROM users WHERE id = ${userId}`
```

### Path Traversal
```typescript
// DANGEROUS:
path.join(baseDir, userPath)

// SAFE - Needs canonical path check:
const resolved = path.resolve(path.join(baseDir, userPath));
if (!resolved.startsWith(baseDir + path.sep)) {
  throw new Error("Traversal!");
}
```

### IDOR
```typescript
// DANGEROUS - No ownership check:
await prisma.server.findUnique({ where: { id: serverId } })

// SAFE - Verify access:
const server = await prisma.server.findUnique({ where: { id: serverId } });
if (server.ownerId !== userId) {
  throw new ForbiddenError();
}
```

### Command Injection
```typescript
// DANGEROUS:
execFile(`tar -xzf ${filename}`)

// SAFE - Validate/quote:
execFile('tar', ['-xzf', validatedFilename])
```

## Brute-Force Protection

Catalyst uses progressive lockouts that increase in duration with repeated failed attempts:

| Failed Attempts | Lockout Duration | Applies To |
|----------------|------------------|------------|
| 5 | 5 minutes | Per-user (email + IP) |
| 10 | 30 minutes | Per-user |
| 15 | 1 hour | Per-user |
| 20 attempts in 15 min | Lockout | IP-based (unknown users) |

**Configuration:** `DEFAULT_SECURITY_SETTINGS` in `catalyst-backend/src/services/mailer.ts`

| Setting | Default | Description |
|---------|---------|-------------|
| `lockoutMaxAttempts` | `5` | Failed attempts before progressive lockout |
| `lockoutWindowMinutes` | `15` | Time window for counting failed attempts |
| `lockoutDurationMinutes` | `15` | Initial lockout duration (first threshold) |

::: tip Admin UI: Lockout Viewer
Admins can view and clear lockouts via the Security Settings page (`/admin/security`). Search by IP or email to see status, failure count, and last failed time.
:::

## Rate Limiting Configuration

Catalyst has **two layers** of rate limiting:

### Layer 1: Fastify Global Rate Limit

| Setting | Value | Description |
|---------|-------|-------------|
| Global limit | `600`/min | Max requests per IP/user |
| Auth endpoints | `5`/min | `/api/auth/login`, `/api/auth/register` |
| Password reset | `3`/15min | `/api/auth/forgot-password`, `/api/auth/reset-password` |
| Avatar upload | `5`/min | `/api/profile/avatar` |
| File operations | `120`/min | Per-file request rate |

**Exempt endpoints** (no rate limiting):
- `/api/internal/*` — Internal service-to-service
- `/api/agent/*` — Node agent traffic (authenticated via API key)
- `/ws` — WebSocket connections
- `/api/sftp/*` — SFTP token operations
- `/api/servers/:id/file-tunnel` — File tunnel operations

### Layer 2: Better Auth Internal Rate Limit

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/sign-in/email` | `5` | 60 seconds |
| `/sign-up/email` | `5` | 60 seconds |
| `/request-password-reset` | `3` | 300 seconds |

::: tip Dual Rate Limiting
The Fastify rate limiter runs first. If a request passes, the Better Auth internal limiter runs second. Both must pass for the request to succeed.
:::

### File Tunnel Rate Limits

| Setting | Default | Description |
|---------|---------|-------------|
| `fileTunnelRateLimitMax` | `100` | Requests per minute |
| `fileTunnelMaxUploadMb` | `100` | Max upload size (MB) |
| `fileTunnelMaxPendingPerNode` | `50` | Max pending requests per node |
| `fileTunnelConcurrentMax` | `10` | Max concurrent tunnels per node |

## CORS Policy

**Allowed origins** are built from:
1. `CORS_ORIGIN` env var (comma-separated)
2. `PUBLIC_URL` env var
3. `FRONTEND_URL` env var
4. Dev origins (only in development): `localhost:3000`, `localhost:5173`, `127.0.0.1:3000`, `127.0.0.1:5173`
5. `DEV_EXTRA_ORIGINS` (development only)

**Settings:**
- **Allowed methods:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
- **Credentials:** `true` (cookies supported)
- **Preflight cache:** `86400` seconds (24 hours)
- **Agent headers excluded:** `X-Catalyst-Node-Id`, `X-Catalyst-Node-Token`, `X-Node-Api-Key` intentionally omitted

## Helmet / Security Headers

Catalyst uses `@fastify/helmet` to enforce security headers. These are **hardcoded** and cannot be changed via environment variables:

| Header | Policy | Purpose |
|--------|--------|--------|
| `Content-Security-Policy` | `default-src: 'self'`, `script-src: 'self'`, `style-src: 'self'`, `img-src: 'self' data: https:` | Prevent XSS by blocking inline scripts and third-party resources |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | **Production only** — 1-year HSTS with subdomains and preload |
| `Referrer-Policy` | `no-referrer-when-downgrade` | Full referrer for HTTPS→HTTPS, strip for HTTPS→HTTP |
| `Cross-Origin-Embedder-Policy` | `false` | Allows WebSocket connections (required for SSE/console streaming) |

## Audit Log Retention

Audit logs are automatically pruned by a background service (`startAuditRetention()`).

| Setting | Default | Description |
|---------|---------|-------------|
| `auditRetentionDays` | `90` | Days to keep audit log entries |
| Run interval | ~1 hour (configurable) | Prunes entries older than `auditRetentionDays` |

**Pruned entry structure:**
- `userId` — Who performed the action
- `action` — Action type (login, create, update, delete, etc.)
- `resource` — Resource type (server, node, user, role, api_key, auth, backup, alert, template, email, security)
- `resourceId` — Resource identifier
- `details` — Additional context

**Similar pruning services exist for:**
- Stats retention (`startStatRetention`)
- Metrics retention (`startMetricsRetention`)
- Backup retention (`startBackupRetention`)
- Log retention (`startLogRetention`)
- Auth retention (`startAuthRetention`) — Prunes failed login attempts

## Red Flags to Watch For

- [ ] `JSON.parse` on user input without validation
- [ ] `innerHTML` or `dangerouslySetInnerHTML` usage
- [ ] `exec` / `execSync` with string concatenation
- [ ] Raw SQL with template literals
- [ ] Missing `onRequest` auth hooks
- [ ] `SELECT *` returning sensitive fields
- [ ] Passwords in logs or error messages
- [ ] Unvalidated file paths from users
- [ ] Missing CSRF on state-changing endpoints
- [ ] CORS allowing `*` for credentials endpoints

## Intentional Features (NOT Bugs)

| Feature | Why It's Intentional |
|---------|---------------------|
| File read/write on servers | Core functionality |
| Console command execution | Server management |
| Mod downloads from Spigot/CurseForge | Game server hosting |
| Custom environment variables | Game configuration |
| WebSocket console output | Real-time monitoring |
| Server state changes | Game server lifecycle |
| Node agent communication | Distributed architecture |
| Full admin user management | Multi-tenant platform |

## Severity Guidelines

| Severity | Criteria | Example |
|----------|----------|---------|
| CRITICAL | Remote code execution, full system compromise | SQL injection with admin access |
| HIGH | Significant data breach, privilege escalation | Auth bypass, IDOR for other users |
| MEDIUM | Limited data exposure, DoS potential | Information disclosure, rate limit bypass |
| LOW | Minor security weakness | Missing security header, verbose errors |

## Quick Security Checklist

- [ ] All routes have `onRequest: [app.authenticate]`
- [ ] All mutations check permissions
- [ ] File paths validated against traversal
- [ ] SQL queries use parameterized syntax
- [ ] Sensitive data excluded from responses
- [ ] Rate limits on sensitive endpoints
- [ ] Errors don't expose stack traces
- [ ] Logs don't contain passwords/keys
- [ ] Sessions expire appropriately
- [ ] API keys are hashed
