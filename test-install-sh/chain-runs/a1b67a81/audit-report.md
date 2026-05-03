# Cross-Distro Compatibility Audit: `install.sh`

**Script:** `/home/karutoil/catalyst/install.sh`  
**Distros reviewed:** Ubuntu, Debian, Fedora, RHEL/CentOS/Rocky, Alpine Linux, Arch Linux, openSUSE  
**Date:** 2026-05-02  
**Auditor:** review-and-fix subagent

---

## 1. Critical Issues (Script Will Crash or Fail)

### 1.1 `grep -oP` (PCRE) — BusyBox grep does not support `-P`

| | |
|---|---|
| **Lines** | 34, 57 |
| **Code** | `grep -oP '(?<=version )[^,]+'` |
| **Affected** | **Alpine Linux** (busybox grep by default), any minimal container using busybox grep |
| **Impact** | Script exits with code 2 due to `set -euo pipefail`. |

**Details:**
- **Line 34:** `DOCKER_VERSION=$(docker version --format ... || docker -v | grep -oP ...)` — If the `docker version` command fails (e.g., user not in `docker` group, daemon not running), the fallback `docker -v | grep -oP` executes and crashes on Alpine.
- **Line 57:** `COMPOSE_VERSION=$(docker-compose --version | grep -oP ...)` — If standalone `docker-compose` is installed, the script enters this branch and crashes immediately on Alpine.

**Fix:** Replace `grep -oP` with POSIX-compatible alternatives:

```bash
# For Docker version
docker -v | sed -n 's/.*version \([^,]*\).*/\1/p'
# or
docker -v | awk '{print $3}' | tr -d ','

# For docker-compose version
docker-compose --version | sed -n 's/.*version \([^,]*\).*/\1/p'
# or
docker-compose --version | awk '{print $3}' | tr -d ','
```

---

### 1.2 Missing `openssl` Dependency Check

| | |
|---|---|
| **Lines** | 63–66, 123–124 |
| **Code** | `for cmd in curl tar; do` (openssl is not listed) |
| **Affected** | **All distros**, especially Alpine Linux (not installed by default), Debian/Ubuntu slim/minimal images |
| **Impact** | Script passes all checks, then crashes at line 123 with `openssl: command not found`. |

**Fix:** Add `openssl` to the dependency loop:

```bash
for cmd in curl tar openssl; do
    if ! command -v "$cmd" &>/dev/null; then
        error "'$cmd' is required but not found. Please install it and re-run."
        exit 1
    fi
done
```

---

### 1.3 `sed -i` Breaks When Replacement Contains the Delimiter `|`

| | |
|---|---|
| **Lines** | 127–128 |
| **Code** | `sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASS}|"` |
| **Affected** | **All distros** (both GNU sed and busybox sed) |
| **Impact** | If `NEW_PG_PASS` ever contains a `|` character, `sed` fails with "bad option in substitution expression" (busybox) or "unknown option to `s`" (GNU). |

**Details:**
- Currently the password is generated from base64 with `/+=` removed, so `|` cannot appear.
- **However**, this is extremely fragile. If the generation logic is ever changed, or if a user manually edits the script to use a different secret source, it will break silently or noisily.
- `NEW_AUTH_SECRET` (line 124) uses base64 which cannot produce `|`, so line 128 is safe for now.

**Fix:** Escape the variable before passing to `sed`, or use a different approach:

```bash
# Option A: Use a delimiter that is extremely unlikely in base64/alphanumeric output
# (still theoretically fragile)
sed -i "s~^POSTGRES_PASSWORD=.*~POSTGRES_PASSWORD=${NEW_PG_PASS}~" "${DEST}/.env"

# Option B: Use awk (fully safe from delimiter collisions)
awk -v val="$NEW_PG_PASS" 'BEGIN{FS=OFS="="} /^POSTGRES_PASSWORD=/{ $2=val }1' \
    "${DEST}/.env" > "${DEST}/.env.tmp" && mv "${DEST}/.env.tmp" "${DEST}/.env"
```

---

## 2. High Issues (Incorrect Behavior or Data Loss)

### 2.1 Password Generation Can Produce Secrets Shorter Than 32 Characters

| | |
|---|---|
| **Line** | 123 |
| **Code** | `openssl rand -base64 24 | tr -d '/+=' | head -c 32` |
| **Affected** | **All distros** |
| **Impact** | Password entropy is reduced. `tr -d` removes characters from a fixed 32-character base64 string; the result is often 30–31 characters and occasionally much shorter. |

**Details:**
- `openssl rand -base64 24` emits exactly 32 base64 characters (24 bytes × 4/3).
- `tr -d '/+='` stochastically removes 3 of the 64 base64 alphabet symbols.
- Testing showed lengths of 30–31 characters in practice. In pathological cases (e.g., many `=` padding chars), it could be even shorter.
- The `head -c 32` does not pad; it merely truncates or passes through what remains.

**Fix:** Generate 32 bytes and encode without filtering, or use `/dev/urandom`:

```bash
# Option A: Generate 32 raw bytes, base64-encode (no filtering needed)
NEW_PG_PASS=$(openssl rand -base64 32 | tr -d '\n')

# Option B: Alphanumeric only, using /dev/urandom (no openssl dependency for this step)
NEW_PG_PASS=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
```

If the intent is to remove `/+=` for URL-safety or shell-safety, generate MORE raw bytes so that even after stripping you still have 32 characters:

```bash
NEW_PG_PASS=$(openssl rand -base64 48 | tr -d '/+=' | head -c 32)
```

---

### 2.2 `cp` Glob Misses Hidden (Dot) Files During Update

| | |
|---|---|
| **Line** | 102 |
| **Code** | `cp "${TMPDIR}/${TARGET_DIR}/"* "$DEST/" 2>/dev/null || true` |
| **Affected** | **All distros** |
| **Impact** | When updating an existing `catalyst-docker` directory that already has a `.env`, hidden files (`.dockerignore`, `.gitignore`, updated `.env.example`, etc.) are **not copied**. Only visible files and the `nginx/` directory are updated. |

**Details:**
- Bash glob `*` does **not** match filenames beginning with `.`.
- The `|| true` suppresses the error, so the user is never warned.
- This is a silent data-loss / stale-config bug.

**Fix:** Use `cp -r` with `/.` or explicitly copy dotfiles:

```bash
# Copy everything including dotfiles, preserving existing .env
cp -r "${TMPDIR}/${TARGET_DIR}/." "$DEST/"
# Then restore the original .env if it existed
```

Or, more safely, preserve `.env` explicitly before clobbering:

```bash
if [[ -f "${DEST}/.env" ]]; then
    mv "${DEST}/.env" "${DEST}/.env.backup.$$"
    cp -r "${TMPDIR}/${TARGET_DIR}/." "$DEST/"
    mv "${DEST}/.env.backup.$$" "${DEST}/.env"
else
    cp -r "${TMPDIR}/${TARGET_DIR}/." "$DEST/"
fi
```

---

### 2.3 `mktemp -d` Fails When User Has `TMPDIR` Set to a Nonexistent Path

| | |
|---|---|
| **Line** | 86 |
| **Code** | `TMPDIR=$(mktemp -d)` |
| **Affected** | **All distros** |
| **Impact** | If the caller has exported `TMPDIR=/nonexistent` (or a path with broken permissions), `mktemp -d` attempts to create a directory under that prefix and fails, crashing the script. |

**Details:**
- `mktemp -d` with no template creates a directory in the path pointed to by the **environment variable** `TMPDIR`, falling back to `/tmp`.
- The script **overwrites** the `TMPDIR` shell variable after calling `mktemp`, but the environment variable is read by the `mktemp` binary at invocation time.
- The variable name collision (`TMPDIR`) is also poor practice because child processes spawned by this script lose the original `TMPDIR` value.

**Fix:** Use a differently named variable and an explicit template:

```bash
WORK_DIR=$(mktemp -d /tmp/catalyst-install.XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT
```

---

## 3. Medium Issues (Portability & Maintainability)

### 3.1 `tar` Errors Silently Discarded

| | |
|---|---|
| **Line** | 92 |
| **Code** | `tar -xzf ... --strip-components=1 ... 2>/dev/null` |
| **Affected** | **All distros** |
| **Impact** | Real extraction errors (corrupt archive, missing member, permission denied, unsupported flag) are hidden. The user sees a misleading follow-up error: *"Extraction failed — the 'catalyst-docker' folder was not found in the archive."* |

**Fix:** Remove `2>/dev/null`, or redirect to a log file:

```bash
if ! tar -xzf "${WORK_DIR}/catalyst.tar.gz" -C "$WORK_DIR" --strip-components=1 "${REPO#*/}-${BRANCH}/${TARGET_DIR}/"; then
    error "Extraction failed. The archive may be corrupt or the repository structure has changed."
    exit 1
fi
```

---

### 3.2 `tar --strip-components` on Very Old BusyBox

| | |
|---|---|
| **Line** | 92 |
| **Code** | `tar ... --strip-components=1` |
| **Affected** | **Very old Alpine Linux** (busybox < 1.20), some embedded/toybox tar implementations |
| **Impact** | If unsupported, tar extracts the full path (`catalyst-main/catalyst-docker/...`) instead of flattening it. The subsequent directory check fails. |

**Details:**
- Modern busybox (1.30+, current Alpine) supports `--strip-components`.
- This is a low-probability issue today but is a GNU-specific extension, not POSIX.

**Fix:** Acceptable risk for 2026, but document the requirement. Alternatively, extract everything and move:

```bash
tar -xzf "${WORK_DIR}/catalyst.tar.gz" -C "$WORK_DIR"
mv "${WORK_DIR}/${REPO#*/}-${BRANCH}/${TARGET_DIR}" "${WORK_DIR}/${TARGET_DIR}"
```

---

### 3.3 Bash Sheighan Not Satisfied in Minimal Containers

| | |
|---|---|
| **Line** | 1 |
| **Code** | `#!/usr/bin/env bash` |
| **Affected** | **Alpine Linux** (base image has no bash), **Debian/Ubuntu slim** (if bash was removed) |
| **Impact** | Script cannot even start; the kernel returns "command not found" for `bash`. |

**Details:**
- Alpine base images ship `/bin/sh` (busybox ash) only. Bash requires `apk add bash`.
- The script uses bashisms (`[[ ]]`, `&>/dev/null`, `set -o pipefail`, `${var#*}`, etc.), so it legitimately requires bash.
- This is acceptable for an installer, but should be documented in the header comment.

**Fix:** Add a prominent comment at the top:

```bash
# REQUIREMENTS: bash 4+, docker, docker compose (or docker-compose), curl, tar, openssl
```

---

### 3.4 `docker compose version --short` Can Exit the Script on Older Plugin Versions

| | |
|---|---|
| **Line** | 51 |
| **Code** | `COMPOSE_VERSION=$(docker compose version --short 2>/dev/null)` |
| **Affected** | **All distros** with an early Docker Compose V2 plugin that lacks `--short` |
| **Impact** | Due to `set -euo pipefail`, if `docker compose version` succeeds (entering the `if`) but `--short` fails, the script exits. |

**Details:**
- The preceding `if docker compose version &>/dev/null` only validates that the subcommand exists, not that `--short` is supported.
- The `2>/dev/null` hides stderr but does **not** change the exit code.

**Fix:** Make the assignment failure-safe:

```bash
COMPOSE_VERSION=$(docker compose version --short 2>/dev/null) || COMPOSE_VERSION="unknown"
```

Or parse the full output:

```bash
COMPOSE_VERSION=$(docker compose version | awk '{print $NF}')
```

---

## 4. Minor Observations

| # | Observation | Line | Risk |
|---|-------------|------|------|
| 4.1 | `sed -i` breaks symlinks (replaces symlink with a regular file). If `.env` is symlinked to a secrets manager, the symlink is destroyed. | 127–128 | Low |
| 4.2 | `warn ".env already exists — skipping configuration."` does not verify that the existing `.env` actually contains the required keys. | 119 | Low |
| 4.3 | `curl -fsSL` uses `-S` (show errors). If GitHub returns a 404, curl exits 22 and prints a brief error. This is correct behavior. | 89 | None |
| 4.4 | `head -c 32` is not POSIX but is universal on Linux (GNU, busybox, toybox). | 123 | Negligible |
| 4.5 | `tr -d '/+='` is portable across GNU and busybox. | 123 | None |
| 4.6 | The script assumes `docker` is the official Docker engine. Podman aliased as `docker` may behave differently (e.g., `docker compose` plugin might not exist). | 34, 41, 51 | Low |
| 4.7 | `command -v` is POSIX and works in bash, dash, busybox ash, zsh. | 29, 49, 63 | None |

---

## 5. Summary Table

| Severity | Count | Categories |
|----------|-------|------------|
| **Critical** | 3 | `grep -oP` (2×), missing `openssl` check, `sed` delimiter fragility |
| **High** | 3 | Short passwords, missed dotfiles, `TMPDIR` env collision |
| **Medium** | 4 | Silent `tar` errors, old busybox `--strip-components`, bash requirement, `docker compose --short` |
| **Minor** | 7 | Symlinks, missing `.env` validation, POSIX nuances |

---

## 6. Recommended Priority Fixes

1. **Replace `grep -oP` with `sed` or `awk`** (fixes Alpine crash).
2. **Add `openssl` to the dependency check loop** (prevents late failure).
3. **Fix password generation** to guarantee 32 characters.
4. **Fix `cp` to include dotfiles** when updating an existing directory.
5. **Rename `TMPDIR` to `WORK_DIR`** and use an explicit `mktemp` template.
6. **Harden `sed` substitutions** against delimiter collisions (use `awk` or a very rare delimiter).
7. **Remove `2>/dev/null` from `tar`** or replace with explicit error handling.
8. **Guard `docker compose version --short`** with `|| true` or parse the default output.
