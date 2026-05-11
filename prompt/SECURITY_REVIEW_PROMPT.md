# Security Review Prompt for Catalyst Game Server Platform

## Parallel Execution with PI Teams

**IMPORTANT**: Use PI Teams to parallelize this security review for maximum efficiency. This codebase is large and contains many security domains. DO NOT attempt to review everything sequentially.

### PI Teams Workflow

```
1. CREATE TEAM     → team_create(team_name="security-review")
2. SPAWN MEMBERS → spawn_teammate (one per security domain)
3. CREATE TASKS  → task_create (for each agent's work items)
4. COMMUNICATE   → send_message / read_inbox
5. MONITOR       → task_list, check_teammate
6. SHUTDOWN      → team_shutdown
```

### Step 1: Create the Security Review Team

```
Create a team named "catalyst-security" for reviewing the Catalyst game server platform.
```

### Step 2: Spawn Specialized Agents

Spawn ONE agent per security domain. Each gets a focused role:

| Teammate Name | Security Domain | Files to Focus On |
|---------------|----------------|-------------------|
| `auth-reviewer` | Authentication & Sessions | `auth.ts`, `routes/auth.ts`, `sftp-token-manager.ts`, `agent-auth.ts` |
| `rbac-reviewer` | Authorization & RBAC | `rbac.ts`, `permissions.ts`, `admin.ts`, server routes |
| `files-reviewer` | File Operations & SFTP | `sftp-server.ts`, `path-validation.ts`, `file-tunnel.ts` |
| `ws-reviewer` | WebSocket & Real-time | `gateway.ts`, `console-stream.ts`, `sse-events.ts` |
| `plugins-reviewer` | Plugin System & Mods | `plugins/loader.ts`, `plugins/validator.ts` |
| `injection-reviewer` | Input Validation & Injection | All route handlers, raw SQL queries |

**Spawn command example:**
```
Spawn a teammate named "auth-reviewer" in the current directory.
Tell them: Review all authentication code for session bypass, token prediction, and credential exposure.
Focus on: catalyst-backend/src/auth.ts, catalyst-backend/src/routes/auth.ts, catalyst-backend/src/lib/agent-auth.ts
```

### Step 3: Create Tasks for Each Agent

```
Create these tasks for the team:
- Task 1 (auth-reviewer): "Audit authentication: sessions, tokens, brute-force protection, SFTP auth. Write findings to security-findings/auth-findings.md"
- Task 2 (rbac-reviewer): "Audit authorization: RBAC permissions, IDOR, privilege escalation, node assignment. Write to security-findings/rbac-findings.md"
- Task 3 (files-reviewer): "Audit file operations: SFTP path traversal, path-validation, file-tunnel, symlink handling. Write to security-findings/files-findings.md"
- Task 4 (ws-reviewer): "Audit WebSocket: gateway auth, message types, rate limiting, console injection. Write to security-findings/ws-findings.md"
- Task 5 (plugins-reviewer): "Audit plugin system: manifest validation, path escaping, sandboxing, API surface. Write to security-findings/plugins-findings.md"
- Task 6 (injection-reviewer): "Audit injection risks: SQL injection, command injection, XSS, SSRF, input validation. Write to security-findings/injection-findings.md"
```

### Step 4: Coordinate via Messaging

Each agent should:
1. Start by reading `SECURITY_REVIEW_PROMPT.md` for context
2. Create findings directory: `mkdir -p security-findings`
3. Update their task status to `in_progress`
4. Work autonomously, sending periodic updates to team-lead
5. On completion, send summary to team-lead with findings file locations

**Agent inbox check pattern:**
```javascript
// At start of work
const inbox = read_inbox({ team_name: "catalyst-security", unread_only: true });
```

### Step 5: Monitor Progress

```
List all tasks for "catalyst-security" to see completion status.
Check teammate "auth-reviewer" status.
```

### Step 6: Synthesize and Shutdown

After all agents complete:
1. Spawn a `merger` agent to synthesize all findings
2. Create final report from `security-findings/*.md`
3. Shut down the team:
```
Shut down the team "catalyst-security" and close all panes.
```

### Example Complete Workflow

```
# 1. Create team
Create a team named "catalyst-security".

# 2. Spawn all reviewers
Spawn "auth-reviewer" with focus on authentication security.
Spawn "rbac-reviewer" with focus on authorization and RBAC.
Spawn "files-reviewer" with focus on file operations and SFTP.
Spawn "ws-reviewer" with focus on WebSocket security.
Spawn "plugins-reviewer" with focus on plugin system.
Spawn "injection-reviewer" with focus on injection vulnerabilities.

# 3. Create tasks
Create tasks for all teammates (see Step 3 above).

# 4. Broadcast initial context
Broadcast to team: "The codebase is in /home/karutoil/catalyst. Read SECURITY_REVIEW_PROMPT.md for context on intentional features. Create security-findings directory. Write findings to security-findings/[domain]-findings.md"

# 5. Monitor and coordinate
List all tasks - check status.
Send message to auth-reviewer: "Prioritize the agent-auth.ts file, it handles node API keys."

# 6. Synthesize final report
Spawn "merger" with: "Read all security-findings/*.md files, remove duplicates, categorize by severity, create final report in SECURITY_REPORT.md"

# 7. Cleanup
Shut down the team when done.
```

### Agent Coordination Notes

- Each reviewer writes findings to a dedicated file: `security-findings/[domain]-findings.md`
- Use consistent finding format: `[CRITICAL/HIGH/MEDIUM/LOW] Title` with location, description, impact, recommendation
- Mark intentional features with explanation (file access, console commands, mod downloads are features not bugs)
- If a reviewer finds issues in another domain, note them for cross-reference in their findings
- The merger agent should consolidate and prioritize findings

### Finding File Format

Each agent writes findings in this format:

```markdown
# [Domain] Security Findings

## [CRITICAL] Title
**Location:** `file:line`
**Description:** ...
**Impact:** ...
**Recommendation:** ...
**Intentional?:** YES/NO

---

## [HIGH] Another Issue
...
```

---

## Context

You are reviewing a **game server management platform** (similar to Pterodactyl Panel) called **Catalyst**. This platform manages:
- Game servers (Minecraft, Rust, Valheim, etc.)
- Container orchestration (Docker/containerd via agent)
- File management (SFTP, web-based file browser)
- User authentication and multi-tenant RBAC
- Node clusters (remote game server hosts)
- Backups (S3, SFTP)
- Plugin/mod management (CurseForge, Modrinth, Spigot)
- WebSocket real-time communication
- Administrative functions

**IMPORTANT CONTEXT**: This platform intentionally:
- Provides server operators full control over game server files (read/write)
- Allows console command execution on game servers
- Enables mod/plugin installation from third-party sources
- Supports game-specific features that may look like exploits to outsiders

## What to Look For

### 1. **CRITICAL: True Security Vulnerabilities**

#### Authentication & Authorization
- [ ] Broken authentication (session hijacking, token prediction)
- [ ] Privilege escalation (sub-users gaining admin access)
- [ ] IDOR (Insecure Direct Object Reference) in resource access checks
- [ ] Missing authorization checks on sensitive endpoints
- [ ] RBAC bypass via permission edge cases (wildcard `*`, scoping issues)
- [ ] API key authentication bypass or privilege escalation

#### Injection Vulnerabilities
- [ ] SQL injection (Prisma raw queries, unsafe string interpolation)
- [ ] Command injection (child_process.exec, shell metacharacters)
- [ ] Path traversal (file operations, SFTP, archive extraction)
- [ ] SSRF (internal service communication, agent callbacks)
- [ ] XSS (audit logs, error messages, plugin output)

#### Data Protection
- [ ] Sensitive data exposure (API keys, secrets in logs/responses)
- [ ] Backup credential encryption weaknesses
- [ ] SFTP token management flaws
- [ ] Password/storage of secrets in plain text

#### Cryptographic Issues
- [ ] Weak encryption or hashing
- [ ] Insecure random number generation
- [ ] Missing HTTPS/TLS enforcement

#### Infrastructure
- [ ] Container escape vectors
- [ ] Node-to-backend communication security
- [ ] File system permission issues
- [ ] Rate limiting bypasses

### 2. **IMPORTANT: Security Misconfigurations**

- [ ] CORS misconfiguration
- [ ] Missing security headers
- [ ] Debug mode in production
- [ ] Excessive error messages exposing internals
- [ ] Missing or weak rate limiting
- [ ] Missing input validation
- [ ] Unsafe defaults in configuration

### 3. **LOW PRIORITY: Code Quality Issues**

- [ ] Code that is confusing/misleading (potential for future bugs)
- [ ] Missing error handling
- [ ] Resource exhaustion possibilities
- [ ] Inefficient algorithms that could be DoS vectors

## What to IGNORE (Intentional by Design)

The following are **NOT vulnerabilities** - they are intentional features:

1. **Game Console Access**: Users can execute commands on their own game servers - this is the core feature. The RBAC controls WHO can send commands, not WHAT commands are allowed.

2. **File Read/Write on Game Servers**: Full file access to server directories is a feature. Path validation prevents escaping the server directory.

3. **Mod/Plugin Downloads**: Fetching from CurseForge, Modrinth, Spigot is intentional. Validate URLs are from legitimate sources only.

4. **Server State Management**: Starting/stopping/modifying game server state is the core purpose. Permissions control authorization.

5. **Custom Game Variables**: Environment variables passed to game containers are expected behavior.

6. **Archive Extraction**: Tar/Zip handling with path validation is intentional. The validation is what matters.

7. **WebSocket for Real-time**: Console output, metrics, and state changes delivered via WebSocket is core functionality.

8. **Admin User Management**: Full CRUD on users/roles is admin functionality, not a vulnerability.

9. **Node Communication**: Agent heartbeat, metrics, and commands between backend and nodes are core architecture.

10. **Database Credentials**: Game server database provisioning stores credentials - the question is HOW securely, not WHETHER.

## Review Methodology

### Phase 1: Authentication & Session Management
```
Files to examine:
- catalyst-backend/src/auth.ts
- catalyst-backend/src/middleware/auth.ts
- catalyst-backend/src/routes/auth.ts
- catalyst-backend/src/services/sftp-token-manager.ts
- catalyst-backend/src/lib/agent-auth.ts
```

**Check for:**
- Session token generation entropy
- Session expiration handling
- Cookie security settings
- CSRF protection
- Session fixation
- Concurrent session limits

### Phase 2: Authorization & RBAC
```
Files to examine:
- catalyst-backend/src/middleware/rbac.ts
- catalyst-backend/src/lib/permissions.ts
- catalyst-backend/src/routes/servers.ts (server-level permissions)
- catalyst-backend/src/routes/nodes.ts (node-level permissions)
- catalyst-backend/src/routes/admin.ts
```

**Check for:**
- All endpoints have proper authorization
- Permission checks before sensitive operations
- Node assignment validation
- Server ownership checks
- Permission scoping works correctly
- Wildcard `*` permission is handled securely

### Phase 3: Input Validation & Sanitization
```
Files to examine:
- catalyst-backend/src/lib/validation.ts
- catalyst-backend/src/lib/path-validation.ts
- catalyst-backend/src/routes/servers.ts (all user inputs)
- catalyst-backend/src/sftp-server.ts
```

**Check for:**
- All user inputs are validated
- Path traversal prevention (especially with symlinks)
- SQL injection in raw queries
- Command injection in child_process calls
- XSS in displayed data
- File upload size limits

### Phase 4: Secure Data Handling
```
Files to examine:
- catalyst-backend/src/services/backup-credentials.ts
- catalyst-backend/src/services/api-key-service.ts
- catalyst-backend/src/routes/api-keys.ts
- catalyst-backend/src/services/mailer.ts
```

**Check for:**
- Encryption at rest for secrets
- Secure key storage
- Backup credentials not exposed to clients
- API key hashing
- Environment variable security

### Phase 5: WebSocket Security
```
Files to examine:
- catalyst-backend/src/websocket/gateway.ts
- catalyst-backend/src/routes/console-stream.ts
- catalyst-backend/src/routes/sse-events.ts
```

**Check for:**
- Authentication on WebSocket connections
- Message type validation
- Rate limiting on WebSocket traffic
- Injection in console output
- Subscription authorization

### Phase 6: Plugin System Security
```
Files to examine:
- catalyst-backend/src/plugins/loader.ts
- catalyst-backend/src/plugins/validator.ts
- catalyst-backend/src/plugins/context.ts
- catalyst-backend/src/plugins/registry.ts
```

**Check for:**
- Plugin path escaping prevention
- Plugin manifest validation
- Sandboxed execution
- API surface exposed to plugins
- Plugin lifecycle security

### Phase 7: SFTP Security
```
Files to examine:
- catalyst-backend/src/sftp-server.ts
- catalyst-backend/src/services/sftp-token-manager.ts
```

**Check for:**
- Path traversal prevention (with symlinks)
- Authentication token security
- Session idle timeout
- Permission enforcement per file operation

### Phase 8: Network & Infrastructure
```
Files to examine:
- catalyst-backend/src/lib/network-isolation.ts
- catalyst-backend/src/routes/file-tunnel.ts
- catalyst-backend/src/services/file-tunnel.ts
- catalyst-backend/src/routes/migration.ts
```

**Check for:**
- Network isolation modes are enforced
- Node communication is authenticated
- File tunnel doesn't expose internal APIs
- Migration doesn't leak credentials

## Output Format

For each finding, use this structure:

```markdown
## [CRITICAL/HIGH/MEDIUM/LOW] Title

**Location:** `file:line` or `component`

**Description:**
Clear description of the vulnerability.

**Proof of Concept:**
If applicable, show how to exploit.

**Impact:**
What an attacker could achieve.

**Recommendation:**
How to fix it.

**Intentional?**
YES/NO - If YES, explain why this is by design.
```

## Summary Checklist

After your review, provide:

1. **Critical Issues Found:** (list with file locations)
2. **High Priority Issues:** (list with file locations)
3. **Medium Priority Issues:** (list with file locations)
4. **Low Priority Issues:** (list with file locations)
5. **False Positives (Intentional Features):** (list with explanations)
6. **Overall Security Posture:** (assessment)
7. **Recommended Next Steps:** (prioritized)

## Additional Guidance

- Look for **authentication bypass** via missing middleware
- Check **all raw SQL queries** for injection
- Examine **symlink handling** in file operations
- Review **WebSocket message handling** for type confusion
- Verify **permission checks** on bulk operations
- Check **API key metadata** for sensitive data exposure
- Look for **race conditions** in concurrent operations
- Review **error handling** for information disclosure
- Examine **logging** for sensitive data leakage
- Check **third-party integrations** for SSRF

Start your review by examining the authentication flow, then authorization, then work through each phase systematically.
