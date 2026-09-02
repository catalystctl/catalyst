# Security Audit — Coverage Ledger (FINAL, 2026-09-02)

Repo: catalystctl/catalyst @ 42a21af98 (v1.31.4). No git submodules. Nested repos (data-only): `eggs/.git`, `catalyst-template/.git`.

## Architecture (rediscovered)
- **Frontend**: React 19 SPA, Nginx container; xterm.js console; no XSS sinks (no dangerouslySetInnerHTML; console via term.write).
- **Backend**: Fastify + TS + Prisma/PostgreSQL. Better Auth (sessions, 2FA, passkeys), API keys, RBAC (global roles + RoleServerGrant/RoleNodeGrant + NodeAssignment), in-process plugin host, WS gateway (/ws), SSE, schedulers, webhooks, auto-updater, marketplace, SFTP token manager.
- **Agent**: Rust, root on game nodes. WS→backend (node API key), containerd, iptables/ufw/firewalld/ipset, SFTP :2022, file tunnel, self-update, backup crypto.
- **Deploy**: docker-compose + install.sh (curl|bash), Caddy/Traefik overlays; backend/redis/postgres loopback-bound by default.
- **Plugins**: SDK + bundled; admin-installed .catpkg.zip, in-process execution; NEW during audit: fileTunnel capability + fastdl-sync plugin (reviewed: rides agent resolve_path jail + permission gates).
- **CI**: 6 workflows; no pull_request_target; actions pinned by tag only.

## Reviewer coverage (3 sessions total)
| Area | Reviewer | Status |
|---|---|---|
| Architecture/threat model | Lead | Done |
| RBAC/authorization | A2 + validation sweep | Done |
| Injection/SSRF | A3 | Done |
| Agent WS/containers | A4 | Done |
| WS/SSE protocol | A6 | Done |
| Container isolation | A8 | Done |
| Plugins | A9 | Done |
| Frontend/browser | A10 | Done |
| CI/install/supply-chain | A11 | Done |
| DoS/races | A12 | Done |
| Auth/session/2FA/SFTP-token/API-keys | A1 | Done |
| Crypto/secrets/backups/updaters | A5 | Done |
| Backup/restore/file-tunnel/SFTP (agent) | A7 | Done |
| Second-pass: backend fixes | R-B1 | Done (4 regressions + 4 variants found → fixed) |
| Second-pass: agent/infra fixes | R-B2 | Done (8 variants found → fixed/annotated) |

## All fixes (final state, all verified: tsc clean, 10030 backend tests, 129 agent tests)
Wave 1 (prior session, repaired to compile this session): tracked config.toml secret removal, atomic_write 0600/no-window, file_manager dangling-symlink final-component rejection, tar --no-same-owner/--no-same-permissions/--no-devices (restore + decompress), firewall dpt/spt token match (compile-repaired), storage_resize/delete_server path-segment validation, char-boundary panic fix, install container cgroup/limits/devices, swap=limit when 0, SFTP-token mint access check, node secret echo suppression, plugin config redaction (rewritten: schema-based, fail-closed), task IDOR scoping, setup password proof-of-control, alert webhook SSRF guard (DNS + redirect re-validation), IPAM hard-delete + P2002 handling, SystemError flood caps, ReDoS caps, Redis requirepass, NODE_ENV=production default, CSP headers, .env staging 0600.

Wave 2 (authz): bare-node grants require node.update pairing — tasks, metrics (x2), metrics-stream, console-stream (x2), alerts, gateway subscribe; server_control whitelist forwarding; backup-settings → backup.create + credential changes owner/admin/node-manage only; role-NAME admin fallbacks removed (alerts/nests/locations/_helpers); node deployment-token + api-key minting require node-manage; roles assignment validates scoped grants; plugin redaction made functional + isAdminCaller pure predicate.

Wave 3 (auth/crypto/agent): persistent setup-completed flag (SystemSetting id "setup"; set on fresh install, recovery, and admin-count backfill); recovery unknown-email → 403 (enumeration oracle closed); nginx XFF overwrite + scoped real_ip for Caddy/Traefik overlays; CHANGE_ME placeholder boot guard (5 secrets); backup-credentials fail-closed in production + config encryptor routed through hardened wrapper + install.sh generates/preserves key; Redis healthcheck via REDISCLI_AUTH; agent O_EXCL unpredictable temp writes (write_file, write_file_bytes, write_file_stream, file_tunnel upload, config_parser — V1); TempFile Drop cleanup; ownership lchown (no-follow); SFTP file.read gates on read/stat/lstat/fstat/realpath/readdir; streaming-restore tar flags; SFTP validate-token suspension gate + RBAC-derived admin (not legacy role column); symlink-scan parent anchoring; firewall UFW/container-IP token matching; console_input whitelist; admin.ts user-create scoped-role authority.

Second-pass regressions found and fixed: wildcard admins locked out of metrics/metrics-stream/node-minting (rolePerms "*" expansion added); setup flag not persisted on recovery path.

## Regression tests added
- secret-hygiene.test.ts, security-fixes-regression.test.ts (wave 1)
- security-wave2-regression.test.ts (7 tests: server_control whitelist incl. exact-key-set, subscribe node.update pairing, plugin redaction, roles scoped-grant, node minting contracts)
- security-wave3-regression.test.ts (7 tests: setup flag re-arm block, placeholder boot guard, backup-cred fail-closed, nginx XFF overwrite)
- file_manager.rs: planted_tmp_symlink_is_not_followed_on_write, planted_dangling_symlink_at_target_is_rejected, secure_temp_sibling_rejects_preplanted_name

## Remaining (documented, not fixed — see final report)
- Agent self-update integrity (checksum-only, no signature) — requires release-infra change
- ws:// cleartext allowed on RFC1918 by default — operator-facing tradeoff
- Fleet-wide BACKUP_ENCRYPTION_KEY — requires schema/architecture change (per-server DEK)
- unzip extraction hardening + pre-extraction validation design — partial mitigations in place
- Traefik dashboard insecure:true (pre-existing, overlay file)
