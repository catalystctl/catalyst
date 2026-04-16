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
