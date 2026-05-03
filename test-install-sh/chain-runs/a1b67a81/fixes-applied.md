# Fixes Applied to install.sh

**Date:** 2026-05-02  
**Script:** `/home/karutoil/catalyst/install.sh`  
**Based on reports:** audit-report.md, debian-ubuntu-report.md, rhel-fedora-report.md, alpine-report.md, arch-report.md, opensuse-report.md

---

## Summary of Issues Fixed

| # | Issue | Severity | Lines | Status |
|---|-------|----------|-------|--------|
| 1 | `grep -oP` not portable (BusyBox/Alpine) | **Critical** | 38, 66 | ✅ Fixed |
| 2 | Missing `openssl` dependency check | **Critical** | 75 | ✅ Fixed |
| 3 | `docker compose version --short` can crash on older plugins | **Medium** | 63 | ✅ Fixed |
| 4 | `TMPDIR` env variable collision | **Medium** | 88–119 | ✅ Fixed |
| 5 | Silent `tar` errors | **Medium** | 98 | ✅ Fixed |
| 6 | `cp` glob misses hidden (dot) files | **High** | 109–113 | ✅ Fixed |
| 7 | Password generation can yield <32 characters | **High** | 132 | ✅ Fixed |
| 8 | `sed` delimiter fragile (`\|`) | **Medium** | 136–137 | ✅ Fixed |

---

## 1. Replaced `grep -oP` with POSIX-compatible `sed`

**Problem:** BusyBox `grep` on Alpine Linux does not support the `-P` (PCRE) flag. When the fallback version extraction ran, the script crashed with exit code 2.

**Changes:**
- **Line 38** — Docker version fallback:
  ```bash
  # Before
  docker -v | grep -oP '(?<=version )[^,]+'
  # After
  docker -v | sed -n 's/.*version \([^,]*\).*/\1/p'
  ```

- **Line 66** — Standalone `docker-compose` version:
  ```bash
  # Before
  docker-compose --version | grep -oP '(?<=version )[^,]+'
  # After
  docker-compose --version | sed -n 's/.*version \([^,]*\).*/\1/p'
  ```

- **Line 63** — `docker compose version` (bonus fix):
  ```bash
  # Before
  docker compose version --short 2>/dev/null
  # After
  docker compose version | sed -n 's/.*version \([^,]*\).*/\1/p'
  ```
  This avoids relying on the `--short` flag, which is missing on some older Compose V2 plugin versions.

**Validation:**
```bash
$ echo 'docker-compose version 1.29.2, build 5becea4c' | sed -n 's/.*version \([^,]*\).*/\1/p'
1.29.2
$ echo 'Docker version 28.0.0, build xxxxx' | sed -n 's/.*version \([^,]*\).*/\1/p'
28.0.0
```

---

## 2. Added `openssl` to Prerequisite Checks

**Problem:** `openssl` is used for password generation (line 132) but was never checked in the dependency loop. On minimal systems (Alpine containers, Debian slim), this caused a late crash after download/extraction.

**Change:**
```bash
# Before
for cmd in curl tar; do
# After
for cmd in curl tar openssl; do
```

---

## 3. Renamed `TMPDIR` → `WORK_DIR`

**Problem:**
1. `mktemp -d` reads the `TMPDIR` environment variable to decide where to create the temp directory. If the caller had `TMPDIR=/nonexistent`, `mktemp -d` would fail before the script could do anything.
2. Overwriting `TMPDIR` pollutes the environment for child processes.

**Change:**
```bash
# Before
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# After
WORK_DIR=$(mktemp -d /tmp/catalyst-install.XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT
```

All references to `${TMPDIR}` throughout the script were updated to `${WORK_DIR}`.

---

## 4. Removed Silent `tar` Error Suppression

**Problem:** `2>/dev/null` on the `tar` command hid real extraction errors (corrupt archive, permission denied, unsupported flags). Users saw only a misleading follow-up message.

**Change:**
```bash
# Before
tar -xzf "${TMPDIR}/catalyst.tar.gz" -C "$TMPDIR" --strip-components=1 "..." 2>/dev/null

# After
tar -xzf "${WORK_DIR}/catalyst.tar.gz" -C "$WORK_DIR" --strip-components=1 "..."
```

With `set -euo pipefail`, a genuine `tar` failure now surfaces its own error message immediately.

---

## 5. Fixed `cp` to Include Hidden (Dot) Files During Update

**Problem:** When updating an existing `catalyst-docker` directory, `cp "${TMPDIR}/${TARGET_DIR}/"* "$DEST/"` skipped dotfiles (`.dockerignore`, `.env.example`, etc.) because bash globs do not match hidden files.

**Change:**
```bash
# Before
if [[ -f "${DEST}/.env" ]]; then
    cp "${TMPDIR}/${TARGET_DIR}/"* "$DEST/" 2>/dev/null || true
    cp -r "${TMPDIR}/${TARGET_DIR}/nginx" "$DEST/nginx" 2>/dev/null || true
    ok "Updated files (kept your existing .env)."

# After
if [[ -f "${DEST}/.env" ]]; then
    mv "${DEST}/.env" "${DEST}/.env.backup.$$"
    cp -r "${WORK_DIR}/${TARGET_DIR}/." "$DEST/" 2>/dev/null || true
    mv "${DEST}/.env.backup.$$" "${DEST}/.env"
    ok "Updated files (kept your existing .env)."
```

This copies **all** files (including dotfiles) while safely preserving the existing `.env`.

---

## 6. Fixed Password Generation to Guarantee 32 Characters

**Problem:** `openssl rand -base64 24` emits exactly 32 base64 characters. `tr -d '/+='` stochastically removes 3 of the 64 alphabet symbols, yielding passwords of 30–31 characters (or shorter in pathological cases).

**Change:**
```bash
# Before
NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

# After
NEW_PG_PASS=$(openssl rand -base64 48 | tr -d '/+=' | head -c 32)
```

Generating 48 raw bytes (64 base64 chars) ensures that even after stripping `/+=`, at least 32 characters remain for `head -c 32` to truncate.

---

## 7. Hardened `sed` Substitutions Against Delimiter Collisions

**Problem:** The `sed` replacement used `|` as the delimiter. While the current password generation cannot produce `|`, the combination is fragile—any future change to the secret source would silently break the substitution.

**Change:**
```bash
# Before
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASS}|" "${DEST}/.env"
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${NEW_AUTH_SECRET}|" "${DEST}/.env"

# After
sed -i "s~^POSTGRES_PASSWORD=.*~POSTGRES_PASSWORD=${NEW_PG_PASS}~" "${DEST}/.env"
sed -i "s~^BETTER_AUTH_SECRET=.*~BETTER_AUTH_SECRET=${NEW_AUTH_SECRET}~" "${DEST}/.env"
```

`~` is not a valid base64 character, making this delimiter collision-safe for the current and likely future secret formats.

---

## Validation Results

| Check | Result |
|-------|--------|
| `shellcheck -s bash install.sh` | ✅ No warnings or errors |
| `bash run-local-test.sh` | ✅ Passes end-to-end with mocked docker/curl |
| Password length verification | ✅ 32 characters confirmed |
| `sed` pattern extraction | ✅ Verified on docker, docker-compose, and docker compose outputs |

---

## Issues NOT Fixed (Deferred)

The following issues were identified in the audit but were **not addressed** in this round because they are lower priority, distro-specific documentation concerns, or require product decisions:

| Issue | Severity | Reason |
|-------|----------|--------|
| Podman compatibility on RHEL/Fedora | Medium | Product decision: script targets Docker; Podman users can alias or use `podman-compose` |
| SELinux context warnings | Low-Medium | Documentation concern; `restorecon` is RHEL-specific and may not apply to all users |
| firewalld port blocking | Low | Documentation concern; ports vary by user config |
| Bash shebang not satisfied in minimal Alpine | Medium | Documented in usage instructions; Alpine users need `apk add bash` |
| `tr` and `head` dependency checks | Low | POSIX utilities universally available on Linux |
| `sed -i` breaks symlinks | Low | Edge case; secrets-manager symlinks are uncommon for `.env` |
| `.env` key validation on skip | Low | Existing `.env` may be intentionally minimal |
