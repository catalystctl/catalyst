# Troubleshooting Guide

Common errors, solutions, FAQ, and debugging steps for Catalyst deployments.

## Table of Contents

- [Quick Reference](#quick-reference)
- [Installation & Setup Failures](#installation--setup-failures)
- [Database Connectivity Issues](#database-connectivity-issues)
- [Authentication Problems](#authentication-problems)
- [Agent Connection & WebSocket Issues](#agent-connection--websocket-issues)
- [Container & Runtime Issues](#container--runtime-issues)
- [Console & SFTP Access Problems](#console--sftp-access-problems)
- [Backup Failures](#backup-failures)
- [CORS & Frontend Errors](#cors--frontend-errors)
- [Plugin Failures](#plugin-failures)
- [Performance & Resource Limits](#performance--resource-limits)
- [Rate Limiting](#rate-limiting)
- [Network & Firewall Issues](#network--firewall-issues)
- [Debug Logging](#debug-logging)
- [FAQ](#faq)
- [Reporting Issues](#reporting-issues)
- [Known Limitations](#known-limitations)

---

## Quick Reference

| Problem | Likely Cause | First Thing to Check |
|---------|-------------|---------------------|
| Panel won't start | Database not running | `docker compose ps postgres` |
| "Connection refused" on API | Backend not healthy | `curl http://localhost:3000/health` |
| Agent shows offline in panel | WebSocket connection failed | `journalctl -u catalyst-agent -f` |
| Server won't start | containerd/CNI issue | Agent logs for container errors |
| File manager hangs | File tunnel timeout | Agent logs for tunnel errors |
| Backups fail (S3) | Wrong credentials/region | S3 config in panel or agent |
| Can't login | Auth config issue | Check `BETTER_AUTH_SECRET`, SMTP |
| SFTP connection refused | Port not mapped / firewall | Docker compose port mapping |
| High CPU/memory usage | Too many servers per node | Panel admin → Nodes → health |
| "Permission denied" on container | containerd socket access | Agent runs as root? |

---

## Installation & Setup Failures

### One-Line Install Fails

**Symptoms:** `install.sh` exits with an error or hangs.

**Common causes:**

- Outdated Docker or Docker Compose version
- Insufficient disk space
- Conflicting ports already in use
- Corrupted `.env` file

**Fix:**

```bash
# Check prerequisites
docker --version
docker compose version
df -h
ss -tlnp | grep -E ':(80|3000|2022|5432)\s'

# Remove old installation and retry
cd catalyst-docker
docker compose down
rm -rf .env docker-compose.yml

# Redownload and reinstall
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/catalyst-docker/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/catalyst-docker/.env.example -o .env.example
cp .env.example .env
nano .env
docker compose up -d
```text

### Database Initialization Fails

**Symptoms:** Backend container crashes on startup with database errors.

**Common causes:**
- PostgreSQL not ready when backend starts
- Corrupted database volume
- Wrong `DATABASE_URL`

**Fix:**

```bash
# Check PostgreSQL status
docker compose ps postgres
docker compose logs postgres

# Recreate the database volume (⚠️ this wipes your data)
docker compose down
docker volume rm catalyst-catalyst-postgres-data
docker compose up -d

# Re-run migrations
docker compose exec backend bun run db:migrate
docker compose exec backend bun run db:seed
```

### Containerd Not Found (Agent)

**Symptoms:** Agent fails to start with "containerd socket is not available".

**Fix:**

```bash
# Check if containerd is installed and running
sudo systemctl status containerd

# If not installed, install it:
sudo apt install containerd.io    # Debian/Ubuntu
sudo dnf install containerd       # Fedora/RHEL

# Ensure the socket is accessible
ls -la /run/containerd/containerd.sock

# Verify the agent can access it
sudo /usr/local/bin/catalyst-agent --help
```text

### CNI Plugins Missing

**Symptoms:** Servers fail to start with "CNI network setup failed" in agent logs.

**Check:**

```bash
# Verify CNI plugins exist
ls -la /opt/cni/bin/

# Required plugins: bridge, host-local, portmap, macvlan
# If any are missing, reinstall:
sudo rm -f /opt/cni/bin/*
curl -LO https://github.com/containernetworking/plugins/releases/download/v1.9.0/cni-plugins-linux-$(uname -m)-v1.9.0.tgz
sudo tar -C /opt/cni/bin -xzf cni-plugins-linux-*.tgz
sudo rm cni-plugins-linux-*.tgz
```

---

## Database Connectivity Issues

### PostgreSQL Connection Refused

**Symptoms:** Backend logs show "connection refused" or "ECONNREFUSED".

**Check:**

```bash
# Verify PostgreSQL is healthy
docker compose ps postgres
docker compose exec postgres pg_isready

# Check PostgreSQL logs
docker compose logs postgres

# Ensure correct port mapping
grep -A2 'postgres' catalyst-docker/docker-compose.yml
```text

**Fix:**

```bash
# Restart PostgreSQL
docker compose restart postgres

# If still failing, recreate the database
docker compose down postgres
docker volume prune --filter "label=catalyst-postgres-data" --force
docker compose up -d postgres
docker compose exec backend bun run db:migrate
```

### Prisma Migration Errors

**Symptoms:** `bun run db:migrate` fails or hangs.

**Common causes:**
- Stale migration files
- Database schema drift
- Concurrent migration attempts

**Fix:**

```bash
# Stop all services
docker compose down

# Back up existing database
docker compose exec postgres pg_dump -U postgres catalyst > backup.sql

# Reset the database
docker compose exec postgres dropdb --if-exists catalyst
docker compose exec postgres createdb -U postgres catalyst

# Re-run migrations
docker compose exec backend bun run db:migrate
docker compose exec backend bun run db:seed

# Restart all services
docker compose up -d
```text

### PostgreSQL Too Many Connections

**Symptoms:** "FATAL: too many connections for role" or "FATAL: sorry, too many clients already".

**Fix:**

```bash
# Increase max_connections in PostgreSQL
# Edit catalyst-docker/docker-compose.yml postgres service:
# Add: environment:
#   POSTGRES_MAX_CONNECTIONS: "200"

# Or connect to PostgreSQL and adjust:
docker compose exec postgres psql -U postgres
ALTER SYSTEM SET max_connections = '200';
SELECT pg_reload_conf();
```

---

## Authentication Problems

### Can't Log In

**Symptoms:** Login fails with "Invalid credentials" or "User not found".

**Check:**

```bash
# Verify the user exists in the database
docker compose exec backend bun run db:studio
# Or via SQL:
docker compose exec postgres psql -U postgres -d catalyst -c "SELECT email, name FROM users ORDER BY created_at DESC LIMIT 5;"

# Check if Better Auth is misconfigured
docker compose logs backend | grep -i "auth"
```text

**Common causes:**

| Cause | Fix |
|-------|-----|
| `BETTER_AUTH_SECRET` not set or changed | Set a strong secret and restart backend |
| Frontend URL mismatch | Ensure `PUBLIC_URL` matches the browser URL |
| Domain/HTTPS misconfigured | Check `AUTH_TRUSTED_HOSTS` (better-auth config) |
| Stale session cookies | Clear browser cookies for the panel domain |

**Regenerate auth secret:**

```bash
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
echo "New secret: $BETTER_AUTH_SECRET"
# Update .env and restart
docker compose restart backend
```

### Two-Factor Authentication (2FA) Issues

**Symptoms:** Can't log in after enabling 2FA; "Invalid 2FA code" or "QR code not displaying".

**Fix:**

::: danger Admin Override
If you've lost access to 2FA, you'll need to disable it via the database.
:::

```bash
# Disable 2FA for a user via database
docker compose exec postgres psql -U postgres -d catalyst -c \
  "UPDATE users SET two_factor_enabled = false WHERE email = 'your@email.com';"

# Verify it worked
docker compose exec postgres psql -U postgres -d catalyst -c \
  "SELECT email, two_factor_enabled FROM users WHERE email = 'your@email.com';"
```text

**Common 2FA issues:**

| Issue | Cause | Fix |
|-------|-------|-----|
| Code rejected | Clock drift between device and server | Sync device time; use NTP |
| QR code blank | CORS blocking frontend requests | Check browser console for CORS errors |
| Can't disable 2FA | No recovery codes saved | You'll need admin override via DB |

### Passkey (WebAuthn) Issues

**Symptoms:** "WebAuthn not supported" or passkey registration fails.

**Common causes:**

| Cause | Fix |
|-------|-----|
| Not using HTTPS (production) | Passkeys require secure context |
| Browser doesn't support WebAuthn | Use Chrome 67+, Firefox 65+, Safari 13+ |
| Wrong `PASSKEY_RP_ID` | Set to your production domain |
| localhost testing | Set `PASSKEY_RP_ID` to `localhost` for dev |

```bash
# Check current passkey config
grep PASSKEY_RP_ID catalyst-docker/.env.example

# For production, set to your domain:
PASSKEY_RP_ID=panel.example.com
```

### OAuth / OIDC Login Fails

**Symptoms:** OAuth callback returns an error or user is redirected back to login.

**Check:**

```bash
# Verify OAuth callback URL matches your provider's config
# The callback URL is: https://panel.example.com/auth/callback/[provider]

# Check provider configuration in the panel
# Admin → Settings → Authentication → [Provider]

# Check backend logs for OAuth errors
docker compose logs backend | grep -i oauth
docker compose logs backend | grep -i oidc
```text

**Common OIDC issues:**

| Provider | Common Issue | Fix |
|----------|-------------|-----|
| **WHMCS** | Wrong client ID/secret | Regenerate OAuth credentials in WHMCS |
| **Paymenter** | Scopes not granted | Ensure `openid profile email` are requested |
| **Custom OIDC** | Wrong issuer URL | Check the full issuer URL (trailing slash matters) |
| **All** | Callback URL mismatch | Set the correct callback in your provider's dashboard |

---

## Agent Connection & WebSocket Issues

### Agent Shows Offline in the Panel

**Symptoms:** Node appears offline in the admin panel, no resource stats are reported.

**Check:**

```bash
# Check agent systemd status
sudo systemctl status catalyst-agent

# View agent logs
sudo journalctl -u catalyst-agent -f --no-pager

# Verify WebSocket URL in config
grep backend_url /etc/catalyst-agent/config.toml

# Test WebSocket connectivity (from agent host)
curl -v https://panel.example.com/health
```

**Common causes:**

| Cause | Fix |
|-------|-----|
| `backend_url` points to wrong host | Update `config.toml` and restart agent |
| API key expired or revoked | Regenerate from panel → Nodes → Agent tab |
| Firewall blocking outbound WS | Open outbound WebSocket connections |
| TLS certificate issue | Ensure CA certs are installed; check agent logs |
| Panel changed, token invalidated | Regenerate deployment token |

**Regenerate deployment token:**

```bash
# In the panel UI: Admin → Nodes → [Your Node] → Agent tab → Generate Deployment Token
# Then run:
curl -fsSL https://panel.example.com/api/deploy/YOUR_NEW_TOKEN | sudo bash
```text

### WebSocket Connection Drops Repeatedly

**Symptoms:** Agent logs show "Connection error" or "WebSocket error" repeatedly.

**Check:**

```bash
# Check for network instability
ping -c 10 panel.example.com

# Check for proxy timeouts (NGINX, Caddy, Traefik)
# Ensure proxy settings are configured:
# - WebSocket upgrade headers
# - No proxy timeout shorter than agent heartbeat (15s)
```

**Proxy configuration fixes:**

**NGINX:**
```nginx
location /ws {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```text

**Caddy:**
```caddy
reverse_proxy /ws* localhost:3000 {
    header_up Upgrade $http_upgrade
    header_up Connection "upgrade"
}
```

**Traefik:**
```yaml
# docker-compose.traefik.yml
labels:
  - traefik.http.routers.websocket.rule=Host(`panel.example.com`) && PathPrefix(`/ws`)
  - traefik.http.routers.websocket.websocket=true
```text

### Agent Authentication Lockout

**Symptoms:** Agent logs show "Backend auth lockout active — must wait Xs before reconnecting".

**Cause:** The backend rejected the agent's API key too many times, triggering a progressive lockout.

**Fix:**

```bash
# The agent will automatically reconnect after the lockout period.
# If you need to reset immediately:

# 1. Regenerate the API key from the panel
# 2. Update config.toml with the new key
sudo nano /etc/catalyst-agent/config.toml

# 3. Restart the agent
sudo systemctl restart catalyst-agent

# 4. Verify connection
sudo journalctl -u catalyst-agent -f --no-pager | grep -i "connected"
```

### Password Reset & Forgot Password

**Symptoms:**
- Password reset email never arrives
- Reset link shows "Invalid token" or "Expired"
- Can't access `/forgot-password` or `/reset-password` pages

**Fix:**

```bash
# 1. Verify SMTP is configured (Admin → System Settings → Email)
# Check the SMTP settings are correct in the panel UI

# 2. Check if email service is working
docker compose logs backend | grep -i "mail\|smtp\|email"

# 3. Test email sending from the panel
# Admin → System Settings → Send Test Email

# 4. If SMTP is misconfigured, reset it:
# Admin → System Settings → Reset SMTP settings to defaults

# 5. For immediate password reset (no email): use seed command
cd catalyst-backend
npx prisma db seed -- --admin-password newpassword123

# 6. Check if email verification is required (default: yes)
# If a user's email is not verified, they may not receive the reset email
# Check the user's verified status in the database
```

::: tip Reset Token Validation
The `/api/auth/reset-password/validate` endpoint performs a constant-time comparison of the reset token. If the token is invalid or expired, a generic error is returned (no enumeration). Check `logs/backend` for the actual reason.
:::

### 2FA Issues

**Symptoms:**
- QR code appears blank or won't scan
- "Invalid 2FA code" errors
- Locked out after entering wrong code multiple times
- "Device trusted for 30 days" option not appearing

**Fix:**

```bash
# Blank QR code: Check that PUBLIC_URL is set correctly
# The QR code generator needs a valid base URL
# Admin → System Settings → Verify PUBLIC_URL is set

# Invalid code — time sync issue:
# TOTP codes are time-based. Ensure server clock is synced
timedatectl status
sudo ntpdate pool.ntp.org

# Locked out after wrong codes — progressive lockout:
# 5 failed attempts → 5 min lockout
# 10 failed attempts → 30 min lockout
# 15 failed attempts → 1 hour lockout
# Wait for the lockout period to expire, then try again

# Disable 2FA via database (emergency only):
npm exec @prisma/client -- prisma db execute --stdin
# Then run:
UPDATE "User" SET "twoFactorEnabled" = false WHERE "email" = 'user@example.com';
```

### Session Sync & Cross-Tab Issues

**Symptoms:**
- Logging out on one tab doesn't log out other tabs
- Stale session data showing after permission changes
- Session shows as active but user can't access resources
- Session cookie cache showing stale data

**Fix:**

```bash
# Check session cookie cache status:
# The session cookie cache is disabled by default (always fresh)
# If enabled, stale data can persist for up to 5 minutes
# To disable:
# In catalyst-backend/src/auth.ts, set:
# session: { cookieCache: { enabled: false } }

# Clear browser cookies for the panel:
# Ctrl+Shift+Delete → Cookies → panel.example.com
# Or use developer tools → Application → Cookies → Delete

# Check for BroadcastChannel issues:
# Cross-tab sync uses BroadcastChannel('catalyst-auth')
# If it's not working, check browser compatibility
# The fallback is localStorage event listeners

# Verify session state:
# Check authStore.getState() in browser console
# Look for: user, isAuthenticated, token, twoFactorEnabled

# If BETTER_AUTH_SECRET was rotated:
# All existing sessions are invalidated immediately
# Users will need to log in again
# Check if the rotation was expected:
docker compose logs backend | grep -i "secret\|rotate\|session"
```

### Account Deletion Issues

**Symptoms:**
- Can't delete account because "User owns servers"
- Account deletion fails silently
- Deleted user still appears in the system

**Fix:**

```bash
# Account deletion requires:
# 1. Current password confirmation
# 2. No owned servers (must transfer or delete them first)

# Check server ownership:
npm exec @prisma/client -- prisma db execute --stdin
# Run:
SELECT id, name, ownerId FROM "Server" WHERE ownerId = 'user-uuid';

# Transfer ownership:
# API: POST /api/servers/:id/transfer-ownership
# Payload: { "newOwnerId": "new-user-uuid" }

# Delete account via API (if no servers):
# POST /api/auth/profile/delete
# Headers: { "Content-Type": "application/json" }
# Body: { "confirm": "DELETE", "currentPassword": "actual-password" }

# What gets cleaned up on deletion:
# - All active sessions
# - SFTP tokens
# - WebSocket connections
# - Webhook notifications
# - Better Auth cookies
```

### GDPR Data Export Issues

**Symptoms:**
- Export request times out
- Export file is empty or missing data
- Can't access `/api/auth/profile/export`

**Fix:**

```bash
# The GDPR export includes:
# - User profile data
# - Session history
# - Linked OAuth accounts
# - API keys (non-sensitive)
# - Audit log entries
# - Server access information

# Export is generated as a ZIP file
# If timeout, check if the user has a large audit log

# Generate export manually:
npm exec @prisma/client -- prisma db execute --stdin
# Run:
SELECT * FROM "AuditLog" WHERE userId = 'user-uuid' LIMIT 100;
```

### Agent Config File Errors

**Symptoms:** Agent fails to start with "Configuration error".

**Check:**

```bash
# Validate config file format
sudo cat /etc/catalyst-agent/config.toml

# Ensure the file is not world-readable (security warning)
ls -la /etc/catalyst-agent/config.toml
sudo chmod 600 /etc/catalyst-agent/config.toml

# Test with a config from environment variables
BACKEND_URL="wss://panel.example.com/ws" \
NODE_ID="your-node-uuid" \
NODE_API_KEY="your-api-key" \
sudo /usr/local/bin/catalyst-agent --help
```text

---

## Container & Runtime Issues

### Container Fails to Start

**Symptoms:** Server shows "Starting" indefinitely or crashes on startup.

**Check:**

```bash
# View container logs
docker compose exec backend curl -s http://localhost:3000/api/servers/SERVER_ID/logs

# Check containerd logs (from agent host)
sudo ctr -n catalyst tasks ls

# Check agent logs for container errors
sudo journalctl -u catalyst-agent -f --no-pager | grep -i "container"
```

**Common causes:**

| Issue | Fix |
|-------|-----|
| Image not found / pull failed | Check container registry access; verify image tag in template |
| Insufficient resources (CPU/memory) | Increase server allocation in template |
| Port conflict | Check if the port is in use on the host; adjust template |
| Missing dependencies in image | Ensure the container image has required binaries |
| EULA not accepted | Server requires EULA acceptance before starting |

### Container Crashes on Start (OOM)

**Symptoms:** Container starts briefly then crashes; logs show "Out of memory".

**Fix:**

```bash
# Check container memory usage
sudo ctr -n catalyst tasks ls --format json | grep -A 5 "memory"

# Increase memory allocation in the template
# Admin → Templates → [Template] → Resources
# Or set via environment variable on the server

# Check if cgroup memory limits are set correctly
cat /sys/fs/cgroup/catalyst/SERVER_ID/memory.max
```text

### containerd Errors

**Symptoms:** Agent logs show "Failed to connect to containerd" or "gRPC error".

**Check:**

```bash
# Check containerd status
sudo systemctl status containerd

# Check containerd logs
sudo journalctl -u containerd -f --no-pager

# Test containerd gRPC
sudo ctr namespaces ls

# Verify namespace
sudo ctr -n catalyst containers ls
```

**Fix:**

```bash
# Restart containerd
sudo systemctl restart containerd

# Verify socket permissions
ls -la /run/containerd/containerd.sock
sudo chmod 660 /run/containerd/containerd.sock
sudo chown root:containerd /run/containerd/containerd.sock

# Clean up stale containers
sudo ctr -n catalyst containers rm --force --all 2>/dev/null || true
sudo ctr -n catalyst containers ls
```text

### CNI Network Leases Stale

**Symptoms:** Servers fail to start; agent logs show IP allocation errors or "stale CNI lease".

**Check:**

```bash
# Check for stale CNI leases
ls -la /var/lib/cni/results/

# The agent automatically cleans stale leases on startup.
# Verify the cleanup ran:
sudo journalctl -u catalyst-agent -f --no-pager | grep -i "stale"
```

**Manual cleanup:**

```bash
# If the agent's automatic cleanup didn't work:
sudo rm -f /var/lib/cni/results/catalyst-*
sudo systemctl restart catalyst-agent
```text

---

## Console & SFTP Access Problems

### Console Not Loading / Shows Blank

**Symptoms:** Server console tab is blank or "Connecting..." forever.

**Check:**

```bash
# Check if the container is actually running
docker compose exec backend curl -s http://localhost:3000/api/servers/SERVER_ID | jq '.state'

# Verify the agent has a WebSocket connection
sudo journalctl -u catalyst-agent -f --no-pager | grep "connected"

# Check container logs (stdout/stderr)
ls -la /var/log/catalyst/console/SERVER_ID/
cat /var/log/catalyst/console/SERVER_ID/stdout
```

**Common fixes:**

1. **Restart the server** from the panel — forces console stream reconnection
2. **Restart the agent** — restores all console writers
   ```bash
   sudo systemctl restart catalyst-agent
   ```text
3. **Check browser console** — WebSocket connection might be blocked by CORS
4. **Verify SSE endpoint** is accessible:
   ```bash
   curl http://localhost:3000/api/servers/SERVER_ID/console-stream
   ```

### SFTP Connection Refused

**Symptoms:** SFTP client says "Connection refused" or "Timeout".

**Check:**

```bash
# Verify SFTP port is exposed in Docker
grep 2022 catalyst-docker/docker-compose.yml

# Check if SFTP is enabled
grep SFTP_ENABLED catalyst-docker/.env.example

# Test connectivity from the client machine
nc -zv sftp-host 2022

# Check for firewall blocking port 2022
sudo ufw status
sudo iptables -L -n | grep 2022
```text

**Fix:**

```bash
# Ensure SFTP is enabled and the port is exposed
# In catalyst-docker/.env:
SFTP_ENABLED=true

# In catalyst-docker/docker-compose.yml, verify:
# ports:
#   - "2022:2022"

# Restart the backend
docker compose restart backend

# Get an SFTP token (from the panel or API)
# Admin → [Server] → Files → SFTP Connection Info
```

### File Manager Fails to Load Files

**Symptoms:** File manager shows "Failed to load directory" or hangs.

**Check:**

```bash
# Check the file tunnel in agent logs
sudo journalctl -u catalyst-agent -f --no-pager | grep -i "file_tunnel\|file operation"

# Verify the server data directory exists and has correct permissions
ls -la /var/lib/catalyst/SERVER_ID/

# Check disk space on the data partition
df -h /var/lib/catalyst
```text

**Common fixes:**

1. **Restart the server** — refreshes file tunnel connection
2. **Increase file size limits** if uploading large files
3. **Check for disk full** — file operations fail silently when disk is full
4. **Verify file permissions** — server data must be owned by UID 1000

---

## Backup Failures

### Local Backup Fails

**Symptoms:** Backup shows "Failed" in the panel or agent logs.

**Check:**

```bash
# Check backup directory
ls -la /var/lib/catalyst/backups/

# Check disk space
df -h /var/lib/catalyst

# Check agent logs for backup errors
sudo journalctl -u catalyst-agent -f --no-pager | grep -i "backup"
```

**Common causes:**

| Cause | Fix |
|-------|-----|
| Disk full | Clean up old backups; increase disk size |
| Permission denied | Ensure `/var/lib/catalyst` is writable |
| Backup directory not configured | Set `BACKUP_DIR` in `.env` |
| Server still running (locked) | Stop server before backup; some templates allow live backups |

### S3 Backup Fails

**Symptoms:** "Failed to upload to S3" or "Access Denied".

**Check:**

```bash
# Verify S3 credentials in panel settings
# Admin → Settings → Backup → S3 Configuration

# Test S3 connectivity from the backend
docker compose exec backend curl -s https://s3.amazonaws.com

# Check S3 bucket policy
# The bucket must allow: s3:PutObject, s3:GetObject, s3:DeleteObject
```text

**Common S3 issues:**

| Issue | Cause | Fix |
|-------|-------|-----|
| "Access Denied" | Wrong AWS credentials or bucket policy | Verify IAM policy allows S3 operations |
| "Connection timeout" | VPC endpoint / network restriction | Check network configuration |
| "Invalid bucket" | Bucket doesn't exist or wrong region | Create bucket in correct region |
| Upload hangs | Large file + no progress | Backups up to 10GB; expect 10-min timeout for inactivity |

**S3 backup troubleshooting:**

```bash
# Reconfigure S3 credentials from the panel:
# Admin → Settings → Backup → Edit S3 Configuration

# Or set environment variables for the backend:
BACKUP_STORAGE_MODE=s3
BACKUP_S3_BUCKET=your-bucket
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ENDPOINT=https://s3.amazonaws.com  # Optional for custom S3-compatible
BACKUP_S3_ACCESS_KEY_ID=AKIA...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)

docker compose restart backend
```

---

## CORS & Frontend Errors

### Frontend Shows Blank Page

**Symptoms:** Browser shows a blank page or "Cannot GET /".

**Check:**

```bash
# Verify the frontend container is running
docker compose ps frontend

# Check frontend logs
docker compose logs frontend

# Check if Nginx is serving files
curl -I http://localhost:80
```text

**Common fixes:**

1. **Rebuild the frontend image** — files may be missing
   ```bash
   docker compose build frontend
   docker compose up -d frontend
   ```

2. **Clear browser cache** — stale JS bundles can cause blank pages

3. **Check `PUBLIC_URL`** — must match the domain used to access the panel

4. **Verify Nginx configuration** — check for proxy errors to the backend

### CORS Errors in Browser Console

**Symptoms:** Browser console shows "Access-Control-Allow-Origin" errors.

**Check:**

```bash
# Check CORS origin setting
grep CORS_ORIGIN catalyst-docker/.env.example

# Set the correct CORS origin in .env
CORS_ORIGIN=https://panel.example.com

docker compose restart backend
```text

**Common CORS causes:**

| Scenario | Fix |
|----------|-----|
| Accessing via different domain | Set `CORS_ORIGIN` to your actual domain |
| Using `localhost` for dev | `CORS_ORIGIN=http://localhost:5173` |
| Using IP address instead of domain | Use a domain name or set `CORS_ORIGIN=*` (dev only) |
| Subdomain mismatch | Include `https://subdomain.example.com` exactly |

### Frontend Can't Reach Backend API

**Symptoms:** Network tab shows 404/500 errors to `/api/*`.

**Check:**

```bash
# Verify the backend health endpoint
curl -v http://localhost:3000/health

# Check if CORS headers are present
curl -I -H "Origin: https://panel.example.com" http://localhost:3000/

# Verify the frontend is proxying correctly
# Check the Nginx config in catalyst-frontend/nginx.conf
```

---

## Admin Page Troubleshooting

### System Settings Page (Admin → System)

**Symptoms:**
- Page shows blank or crashes
- SMTP config form doesn't save
- Mod Manager API keys not persisting
- Auto Updater status shows "Unknown"

**Fix:**

```bash
# Check backend logs for errors
sudo journalctl -u catalyst-backend -f --no-pager | grep -i "settings\|system"

# Verify database has ThemeSettings row
npm exec @prisma/client -- prisma db execute --stdin
SELECT * FROM "ThemeSettings" WHERE id = 'default';

# Recreate if missing
npm exec @prisma/client -- prisma db execute --stdin
INSERT INTO "ThemeSettings" (id, panelName, logoUrl, primaryColor, secondaryColor, accentColor, customCss, defaultTheme) VALUES ('default', 'Catalyst', null, '#3B82F6', '#10B981', '#8B5CF6', '', 'system');
```

### Security Settings Page

**Symptoms:**
- Rate limit settings don't save
- Lockout policy changes don't take effect
- File tunnel settings reset after restart
- Security page shows stale data

**Fix:**

```bash
# Security settings are stored in the database (SystemSetting table)
# Verify current values:
npm exec @prisma/client -- prisma db execute --stdin
SELECT * FROM "SystemSetting" WHERE id = 'security';

# Reset to defaults:
npm exec @prisma/client -- prisma db execute --stdin
DELETE FROM "SystemSetting" WHERE id = 'security';

# Default values (from DEFAULT_SECURITY_SETTINGS):
# authRateLimitMax: 30
# fileRateLimitMax: 120
# consoleRateLimitMax: 60
# consoleOutputLinesMax: 2000
# consoleOutputByteLimitBytes: 262144
# agentMessageMax: 10000
# agentMetricsMax: 10000
# serverMetricsMax: 60
# lockoutMaxAttempts: 5
# lockoutWindowMinutes: 15
# lockoutDurationMinutes: 15
# auditRetentionDays: 90
# maxBufferMb: 50
# fileTunnelRateLimitMax: 100
# fileTunnelMaxUploadMb: 100
# fileTunnelMaxPendingPerNode: 50
# fileTunnelConcurrentMax: 10

# Progressive lockout behavior:
# 5 failed attempts → 5 min lockout
# 10 failed attempts → 30 min lockout
# 15 failed attempts → 1 hour lockout
# IP-based (unknown users): 20 attempts / 15 min window
```

### System Errors Page

**Symptoms:**
- Page shows no errors but frontend errors are occurring
- `reportSystemError()` calls not appearing
- Stack traces not showing sensitive data redaction

**Fix:**

```bash
# The SystemErrorsPage fetches from /api/admin/system-errors
# This is a frontend client-side error tracker
# Check if reportSystemError is being called:
# Search for reportSystemError in frontend source
grep -r "reportSystemError" catalyst-frontend/src/

# It's used by 60+ modules including AuthStore, useFileManager, useSetupStatus, useSseConsole
# If no errors are showing, verify the frontend can reach the API
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/admin/system-errors

# System errors are reported with these fields:
# { level: 'error'|'warn'|'critical', component, message, stack, metadata, timestamp }
# Sensitive data (passwords, tokens) is redacted before storage
```

### Audit Logs Page

**Symptoms:**
- Empty or missing entries
- Filter not working (by action, resource type, user, date)
- 15-second auto-refresh not updating

**Fix:**

```bash
# Audit log entries are stored in the AuditLog table
# Check if entries exist
npm exec @prisma/client -- prisma db execute --stdin
SELECT action, "resourceType", userId, "createdAt" FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 50;

# Filter by resource type:
npm exec @prisma/client -- prisma db execute --stdin
SELECT * FROM "AuditLog" WHERE "resourceType" IN ('server', 'node', 'user', 'role', 'api_key', 'auth', 'backup', 'alert', 'template', 'email', 'security');

# Audit log retention is configurable (default: 90 days)
# Check the current setting:
npm exec @prisma/client -- prisma db execute --stdin
SELECT * FROM "SystemSetting" WHERE id = 'security';

# To manually prune old entries:
npm exec @prisma/client -- prisma db execute --stdin
DELETE FROM "AuditLog" WHERE "createdAt" < NOW() - INTERVAL '90 days';
```

---

## Plugin Failures

### Plugin Won't Install / Activate

**Symptoms:** Plugin shows "Failed" or is not listed in the plugin manager.

**Check:**

```bash
# Check the plugin directory
ls -la /var/lib/catalyst/plugins/

# Check backend logs for plugin errors
docker compose logs backend | grep -i "plugin"

# Verify plugin compatibility with your Catalyst version
# Check the plugin's documentation for version requirements
```text

**Common causes:**

| Cause | Fix |
|-------|-----|
| Wrong Catalyst version | Update Catalyst or find a compatible plugin |
| Missing plugin dependencies | Install required npm packages in the plugin directory |
| Hot reload disabled in prod | `PLUGIN_HOT_RELOAD=false` is correct for production |
| Plugin SDK incompatibility | Update the Plugin SDK to match your Catalyst version |

### Plugin SDK Build Fails

**Symptoms:** `npm run build` in a plugin project fails.

**Check:**

```bash
# Ensure you're using the correct Plugin SDK version
cat packages/plugin-sdk/package.json

# Rebuild the SDK
cd packages/plugin-sdk
npm run build

# Rebuild your plugin
cd ../path/to/plugin
npm run build
```

### Plugin Frontend Slots Not Rendering

**Symptoms:**
- Registered plugin tabs don't appear in Admin panel
- Plugin frontend components not showing in server detail views
- `PluginErrorBoundary` catches errors but doesn't display fallback

**Fix:**

```bash
# Plugin frontend slots are registered via:
# 1. Plugin manifest (plugins.json) declaring frontend routes
# 2. PluginRoutePage.tsx rendering dynamic routes
# 3. PluginTabPage.tsx rendering admin tabs

# Check plugin manifest
cat /var/lib/catalyst/plugins/<plugin-name>/plugins.json | grep -A5 "frontend"

# Verify plugin is loaded in the backend
docker compose logs backend | grep -i "plugin.*loaded\|plugin.*register"

# Plugin frontend code is bundled at build time
# If the plugin was installed after the frontend build:
# 1. Rebuild the frontend image
sudo docker compose build frontend
sudo docker compose up -d frontend

# Plugin slot types:
# - Admin tabs: /admin/plugin/:pluginTabId (PluginTabPage.tsx)
# - Server views: injected via usePluginSlots hook
# - Dynamic routes: /:pluginRouteName (PluginRoutePage.tsx)
# - Error boundary: catches plugin rendering errors (PluginErrorBoundary.tsx)

# If PluginErrorBoundary shows:
# "Plugin rendering failed" — check the plugin's console output
# in the frontend's system errors page (/admin/system-errors)
```

### Plugin Ticketing System Issues (WHMCS Integration)

**Symptoms:**
- Ticketing plugin shows "Connection error"
- WHMCS OAuth flow fails
- Tickets not syncing between Catalyst and WHMCS

**Fix:**

```bash
# Check if WHMCS OIDC is configured
# Admin → System Settings → OIDC Providers

# Verify WHMCS connection:
# 1. WHMCS_OIDC_CLIENT_ID and WHMCS_OIDC_CLIENT_SECRET must match
# 2. WHMCS_OIDC_DISCOVERY_URL must resolve:
   curl -s https://billing.example.com/.well-known/openid-configuration

# Check plugin logs:
docker compose logs backend | grep -i "whmcs\|ticketing\|plugin"

# Reset plugin state:
# Admin → Plugins → Ticketing → Reset Configuration

# Verify ticket creation works from the API:
curl -X POST http://localhost:3000/api/plugins/ticketing/tickets \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test","body":"Test ticket"}'
```

### Plugin Hot Reload Not Working

**Symptoms:**
- Plugin changes not reflecting in the panel
- `PLUGIN_HOT_RELOAD=true` set but no updates
- Plugin directory exists but not loading

**Fix:**

```bash
# Hot reload only works in development mode
# In production, PLUGIN_HOT_RELOAD should be false

# Check if hot reload is enabled
# Admin → Plugins → Hot Reload status

# In production, you must rebuild after plugin changes:
sudo docker compose build backend
sudo docker compose up -d backend

# Hot reload watches:
# /var/lib/catalyst/plugins/ for new plugin directories
# Plugin manifest changes (plugins.json)
# Plugin source file changes (in dev only)

# Common hot reload issues:
# 1. Permission denied on plugin directory
sudo chmod -R 755 /var/lib/catalyst/plugins/

# 2. Plugin directory not in expected path
# Default: /var/lib/catalyst/plugins/
# Check backend logs for plugin directory configuration

# 3. Stale cache — clear Docker build cache:
sudo docker compose build --no-cache backend
```

### Plugin Permission Errors

**Symptoms:**
- Plugin works for admins but not regular users
- Plugin shows "Access denied" errors
- Plugin can't access server data

**Fix:**

```bash
# Plugins inherit the current user's permissions
# Check what permissions the plugin needs:
# Look at the plugin's manifest for required permissions

cat /var/lib/catalyst/plugins/<plugin>/plugins.json | grep -A10 "permissions"

# Common permission mappings:
# - File operations: file.read, file.write
# - Console: console.read, console.write
# - Server management: server.read, server.start, server.stop
# - User management: user.read
# - Backup: backup.read, backup.create, backup.delete

# Verify current user permissions:
npm exec @prisma/client -- prisma db execute --stdin
SELECT u.email, r.name, p.name as permission
FROM "User" u
JOIN "UserRole" ur ON u.id = ur.userId
JOIN "Role" r ON ur.roleId = r.id
JOIN "RolePermission" rp ON r.id = rp.roleId
JOIN "Permission" p ON rp.permissionId = p.id
WHERE u.email = 'user@example.com';
```

---

## Performance & Resource Limits

### High CPU Usage on Node

**Symptoms:** Node reports >80% CPU; servers respond slowly.

**Check:**

```bash
# Check per-container CPU usage
sudo ctr -n catalyst tasks ls --format json | jq '.[].cpu'

# Check system-wide
top -bn1 | head -20

# Check if agent is the culprit
sudo journalctl -u catalyst-agent --since "1 hour ago" | grep -c "WARN"
```text

**Fix:**

1. **Identify resource-heavy servers** — check resource usage in the panel
2. **Adjust CPU/memory limits** in the template settings
3. **Distribute servers across multiple nodes** (if available)
4. **Check for runaway processes** inside containers
   ```bash
   sudo ctr -n catalyst tasks ls
   ```

### Out of Memory

**Symptoms:** Servers crash or fail to start with OOM errors.

**Check:**

```bash
# Check system memory
free -h

# Check container memory usage
sudo ctr -n catalyst tasks ls --format json | grep -A 3 "memory"

# Check cgroup limits
cat /sys/fs/cgroup/catalyst/memory.max
cat /sys/fs/cgroup/catalyst/memory.current
```text

**Fix:**

1. **Reduce per-server memory allocation** in template settings
2. **Limit max servers per node** in the agent config (`max_connections`)
3. **Add more RAM** to the node
4. **Enable swap** as a safety net (not recommended as a primary solution)

### Disk Space Full

**Symptoms:** Servers can't start; backups fail; agents report disk errors.

**Check:**

```bash
# Check overall disk usage
df -h /var/lib/catalyst

# Check data directory size
du -sh /var/lib/catalyst/servers/

# Check individual server sizes
du -sh /var/lib/catalyst/servers/*/ | sort -rh | head -10

# Check backup sizes
du -sh /var/lib/catalyst/backups/

# Check console log sizes (can grow large)
du -sh /var/log/catalyst/console/*/
```

**Fix:**

```bash
# Clean up old backups
# Admin → Backups → Delete old backups

# Clean up stale server data
# First, delete the server from the panel, then manually remove:
sudo rm -rf /var/lib/catalyst/servers/DELETED-SERVER-UUID/

# Rotate console logs (done automatically if MAX_LOG_SIZE is set)
# Force rotation:
sudo systemctl restart catalyst-agent

# Expand the disk partition if still full
```text

---

## Rate Limiting

### "Too Many Requests" (429) Errors

**Symptoms:** API returns 429 status with "Too many requests" message.

**Current rate limits:**

| Tier | Limit | Window | Endpoints |
|------|-------|--------|-----------|
| **Critical** | 5 req/min | 1 minute | `/api/auth/login`, `/api/auth/register`, `/api/auth/forgot-password`, `/api/auth/reset-password` |
| **High** | 10 req/min | 1 minute | `/api/servers/*` (create, start, stop, restart, delete) |
| **Medium** | 30 req/min | 1 minute | File operations (list, read, write, upload, delete) |
| **Normal** | 60 req/min | 1 minute | General API endpoints |
| **Read** | 120 req/min | 1 minute | Read-only endpoints (GET /api/servers, GET /api/nodes, etc.) |

**Fix:**

1. **Check if you're hitting rate limits** — look at the `X-RateLimit-*` headers in API responses
2. **Implement retry with exponential backoff** in your scripts
3. **For login brute-force protection:** Use strong passwords; consider disabling password auth temporarily if locked out
4. **For file operations:** Batch operations instead of individual requests

---

## Network & Firewall Issues

### Firewall Blocking Server Ports

**Symptoms:** Server starts but can't be accessed from the internet.

**Check:**

```bash
# Check firewall rules managed by the agent
cat /var/lib/catalyst/firewall-rules.jsonl

# Check current firewall status
sudo ufw status
# or
sudo iptables -L -n -t nat
# or
sudo firewall-cmd --list-all

# Check if ports are listening
sudo ss -tlnp | grep :25565
```

**Fix:**

```bash
# If using UFW:
sudo ufw allow 25565/tcp

# If using firewalld:
sudo firewall-cmd --permanent --add-port=25565/tcp
sudo firewall-cmd --reload

# If using iptables directly:
sudo iptables -A INPUT -p tcp --dport 25565 -j ACCEPT
```text

### MACVLAN Network Issues

**Symptoms:** Servers on macvlan can't reach the internet or other containers.

**Check:**

```bash
# Verify the macvlan interface exists
ip addr show macvlan0

# Check the CNI config
cat /etc/cni/net.d/mc-lan-static.conflist

# Test network connectivity from a container
sudo ctr -n catalyst run --exec docker.io/library/alpine:latest ping -c 3 8.8.8.8
```

**Common fixes:**

1. **Restart the agent** — regenerates CNI network config
2. **Verify the parent interface is up** (e.g., `eth0`)
3. **Check ARP tables** on the gateway/router for stale entries
4. **Update gateway MAC address** in your router if needed:
   ```bash
   # Flush ARP cache on the router/gateway
   arp -d <macvlan-gateway-ip>
   ```text

---

## Debug Logging

### Enable Debug Logging (Panel Backend)

```bash
# Set in catalyst-docker/.env
LOG_LEVEL=debug

# Restart the backend
docker compose restart backend

# View debug logs
docker compose logs -f backend | grep -i "error\|warn"
```

### Enable Debug Logging (Agent)

```toml
# /etc/catalyst-agent/config.toml
[logging]
level = "debug"
format = "text"
```text

```bash
sudo systemctl restart catalyst-agent
sudo journalctl -u catalyst-agent -f --no-pager | grep -i "error\|warn"
```

### Containerd Debug

```bash
# Enable containerd debug logging
sudo systemctl edit containerd

# Add:
# [debug]
#   level = "debug"

sudo systemctl daemon-reload
sudo systemctl restart containerd

# View logs
sudo journalctl -u containerd -f --no-pager
```text

---

## FAQ

### Q: How do I reset the admin password?

**A:** Seed a new admin user:
```bash
docker compose exec backend bun run db:seed:admin
# Or create one manually:
docker compose exec postgres psql -U postgres -d catalyst -c \
  "INSERT INTO users (email, name, username, password, role) VALUES ('admin@example.com', 'Admin', 'admin', 'hashed_password', 'admin');"
```
Then use the panel's "Forgot Password" flow if you have SMTP configured.

### Q: Can I run multiple Catalyst panels on the same server?

**A:** No, not recommended. Each panel expects to be the sole administrator. If you need multi-tenant, use the node system with multiple agent nodes pointing to one panel.

### Q: How do I migrate from Pterodactyl?

**A:** Use the built-in migration tool:
```bash
# Admin → Migration in the panel UI
# Follow the wizard:
# 1. Enter your Pterodactyl URL and API key
# 2. Test connection
# 3. Choose migration scope (full, node, or server)
# 4. Map Pterodactyl nodes to Catalyst nodes
# 5. Map servers
# 6. Execute migration
```text

### Q: How do I back up my Catalyst data?

**A:** Backup everything under `/var/lib/catalyst/` plus the PostgreSQL database:
```bash
# Database backup
docker compose exec postgres pg_dump -U postgres catalyst > catalyst-backup-$(date +%Y%m%d).sql

# Data directory backup
tar czf catalyst-data-$(date +%Y%m%d).tar.gz /var/lib/catalyst/

# Restoring: stop services, extract files, restore database, restart
```

### Q: Why do servers take so long to start?

**A:** First-time starts pull the container image, which can take several minutes. Subsequent starts are faster. You can pre-pull images on the agent node:
```bash
sudo ctr -n catalyst images pull docker.io/your-image:tag
```text

### Q: Can I use Traefik instead of the included reverse proxy?

**A:** Yes. Use `catalyst-docker/docker-compose.traefik.yml` for Traefik setup, or `docker-compose.caddy.yml` for Caddy. These replace the default Nginx proxy with full TLS automation.

---

## Reporting Issues

### Before Opening a GitHub Issue

1. **Search existing issues** — your problem may already be reported or fixed
2. **Gather diagnostic information:**
   ```bash
   # Panel backend logs
   docker compose logs backend --tail=100

   # Agent logs (on the node)
   sudo journalctl -u catalyst-agent --tail=100

   # Panel version
   docker compose exec backend cat /version 2>/dev/null || docker compose exec backend node -e "console.log(require('./package.json').version)"

   # Agent version
   /usr/local/bin/catalyst-agent --version

   # System info
   uname -a
   cat /etc/os-release
   ```

3. **Describe your setup clearly:**
   - Deployment method (Docker, one-line install, source)
   - OS and version
   - Docker version
   - Catalyst version
   - Relevant log output

4. **Open an issue on GitHub:**
   ```text
   https://github.com/catalystctl/catalyst/issues/new
   ```
   Include all diagnostic information from above.

### Security Issues

For security vulnerabilities, **do not** open a public GitHub issue. Instead:

- Read [docs/SECURITY.md](./SECURITY.md) for the full security policy
- Read [docs/SECURITY_QUICK_REFERENCE.md](./SECURITY_QUICK_REFERENCE.md) for the quick guide
- Report via the channel specified in the security policy

---

## Known Limitations

The following are known limitations that are not bugs but may affect your deployment:

| Limitation | Details | Workaround |
|-----------|---------|------------|
| **Single panel instance** | Only one panel can manage a deployment | Use the node system for multi-node setups |
| **No Windows support for nodes** | Agent requires Linux (containerd + CNI) | Use Linux VMs or bare metal for nodes |
| **containerd required** | Agent uses containerd, not Docker runtime | Install containerd alongside Docker (they coexist) |
| **macvlan requires root on host** | MACVLAN network creation needs elevated privileges | Run the agent as root or with `CAP_NET_ADMIN` |
| **SFTP is not encrypted** | SFTP uses plain TCP; TLS requires an external proxy | Place SFTP behind a reverse proxy with TLS |
| **Backup encryption is client-side** | S3 backups are encrypted by the agent before upload | Ensure `BACKUP_CREDENTIALS_ENCRYPTION_KEY` is backed up |
| **Console logs rotate but aren't archived** | Old logs are gzip-compressed and kept for 2 rotations | Monitor disk usage if servers are very verbose |
| **One restore stream at a time** | The agent only supports one backup restore at a time | Wait for the current restore to complete |
| **Plugin hot reload is dev-only** | `PLUGIN_HOT_RELOAD=true` is intended for development | Set to `false` in production to prevent memory leaks |
| **No built-in load balancing** | Only one backend instance is supported in Docker Compose | Use external load balancer (HAProxy, NGINX) for production |
| **Rate limits are per-node** | Rate limiting applies per backend instance | Add more backend instances with external LB for high traffic |

::: tip Contributing
If you find a bug or have a feature request, please open a GitHub issue. For documentation improvements, submit a pull request. See [development.md](./development.md) for contribution guidelines.
:::
