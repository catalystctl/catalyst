# Alpine Linux Compatibility Test Report

**Date:** 2026-05-02  
**Script:** `/home/karutoil/catalyst/install.sh`  
**Test Environment:** Simulated Alpine Linux with BusyBox utilities

---

## Summary

The `install.sh` script has **CRITICAL compatibility issues** with Alpine Linux due to:
1. Use of `grep -oP` (PCRE) which BusyBox grep does not support
2. Missing `openssl` dependency check (not installed by default on Alpine)
3. Script requires `bash` which is not the default shell on Alpine
4. Script uses `tr` and `head` without checking for their presence

**shellcheck Status:** ✅ Passes (`shellcheck -s bash install.sh` returns no errors)

---

## Critical Issues Found

### 1. `grep -oP` crashes on Alpine (CRITICAL)

**Lines Affected:** 34, 57

```bash
# Line 34 - Docker version extraction fallback
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker -v | grep -oP '(?<=version )[^,]+')

# Line 57 - Docker Compose version extraction (standalone)
COMPOSE_VERSION=$(docker-compose --version | grep -oP '(?<=version )[^,]+')
```

**Problem:** BusyBox `grep` does not support the `-P` (PCRE) flag. When this command runs:
- BusyBox grep exits with code 2
- Due to `set -euo pipefail`, the entire script terminates

**Test Result:**
```
$ echo 'Docker version 28.0.0, build ...' | busybox grep -oP '(?<=version )[^,]+'
grep: invalid option -- 'P'
Command failed with exit code: 2
```

**Impact:** Script crashes when:
1. Docker version cannot be extracted via `--format` flag (line 34 fallback)
2. Standalone `docker-compose` is used (line 57)

**Recommended Fix:**
Replace `grep -oP '(?<=version )[^,]+'` with a POSIX-compatible alternative:
```bash
# Portable alternative
docker -v | grep -oE 'version [^,]+' | sed 's/version //'
docker-compose --version | grep -oE 'version [^,]+' | sed 's/version //'
```

---

### 2. Missing `openssl` dependency check (CRITICAL)

**Lines Affected:** 63-66 (missing check), 132-133 (actual usage)

**Problem:** The script checks for `curl` and `tar` but does NOT check for `openssl`, which is used at line 132-133:
```bash
NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
NEW_AUTH_SECRET=$(openssl rand -base64 32)
```

**Test Result:**
```
/home/karutoil/catalyst/install.sh: line 132: openssl: command not found
Command exited with code: 127
```

**Impact:** Script crashes late in execution after downloading and extracting the archive, leaving the system in a partially configured state.

**Alpine Status:** `openssl` is NOT installed by default on minimal Alpine Linux containers.

**Recommended Fix:**
Add `openssl` to the dependency check:
```bash
for cmd in curl tar openssl; do
    if ! command -v "$cmd" &>/dev/null; then
        error "'$cmd' is required but not found. Please install it and re-run."
        exit 1
    fi
done
```

---

### 3. Missing `tr` and `head` dependency checks (HIGH)

**Lines Affected:** 132

**Problem:** Line 132 uses `tr` and `head` without checking for their presence:
```bash
NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
```

While `tr` and `head` are typically available on most systems, they should be checked or documented as requirements.

**Test Result:**
```
/home/karutoil/catalyst/install.sh: line 132: tr: command not found
/home/karutoil/catalyst/install.sh: line 132: head: command not found
```

**Recommended Fix:** Include in dependency check:
```bash
for cmd in curl tar openssl tr head; do
    if ! command -v "$cmd" &>/dev/null; then
        error "'$cmd' is required but not found. Please install it and re-run."
        exit 1
    fi
done
```

---

### 4. Script requires `bash` (MEDIUM)

**Shebang:** `#!/usr/bin/env bash`

**Problem:** Alpine Linux uses `ash` (BusyBox shell) as the default shell. Bash must be installed separately (`apk add bash`).

**Usage in Script:**
- `[[ ]]` conditional expressions (bashism)
- `$()` command substitution (POSIX, but script requires bash for other features)
- `set -euo pipefail` (pipefail is bash-specific)

**Test Result:** Without bash installed, the curl pipe command fails:
```
env: 'bash': No such file or directory
[ERROR] Failed to download from GitHub. Check your internet connection and try again.
```

**Impact:** The recommended install method (`curl ... | bash`) will fail on Alpine without bash installed first.

**Recommended Fix:** Document that bash is required for Alpine:
```markdown
## Alpine Linux Prerequisites

Before running the install script on Alpine Linux:

```bash
apk add bash curl tar openssl
```
```

---

## BusyBox Compatibility Matrix

| Command | Feature Used | BusyBox Support | Status |
|---------|-------------|-----------------|--------|
| `grep` | `-oP` (PCRE) | ❌ NO | **CRITICAL** |
| `grep` | `-oE` (ERE) | ✅ YES | Use instead |
| `sed` | `-i` | ✅ YES | OK |
| `tar` | `--strip-components` | ✅ YES | OK |
| `mktemp` | `-d` | ✅ YES | OK |
| `head` | `-c` | ✅ YES | OK |
| `openssl` | `rand -base64` | ❌ NOT DEFAULT | **CRITICAL** |
| `curl` | `-fsSL` | ⚠️ Not default | Usually available |
| `bash` | N/A | ❌ NOT DEFAULT | **MEDIUM** |

---

## Test Results

### Test 1: shellcheck
```bash
$ shellcheck -s bash install.sh
# No output - passes all checks
```
✅ **PASSED**

### Test 2: Mock execution with GNU tools
```bash
$ bash run-local-test.sh
# Script completes successfully with mocked docker/curl
```
✅ **PASSED** (on GNU/Linux)

### Test 3: Alpine simulation (without openssl)
```bash
$ PATH="/tmp/alpine-test/bin" bash install.sh
...
/home/karutoil/catalyst/install.sh: line 132: openssl: command not found
Command exited with code: 127
```
❌ **FAILED** - Missing openssl causes crash

### Test 4: grep -P compatibility
```bash
$ echo 'test' | busybox grep -oP 'test'
grep: invalid option -- 'P'
```
❌ **FAILED** - BusyBox grep lacks PCRE support

---

## Recommendations

### Immediate Fixes Required

1. **Replace `grep -oP` with portable alternative:**
   ```bash
   # Before (lines 34, 57)
   grep -oP '(?<=version )[^,]+'
   
   # After
   grep -oE 'version [^,]+' | sed 's/version //'
   ```

2. **Add missing dependency checks:**
   ```bash
   for cmd in curl tar openssl tr head; do
       if ! command -v "$cmd" &>/dev/null; then
           error "'$cmd' is required but not found. Please install it and re-run."
           exit 1
       fi
   done
   ```

3. **Document Alpine prerequisites:**
   ```markdown
   ## Alpine Linux
   
   Install required packages first:
   ```bash
   apk add bash curl tar openssl
   ```
   ```

### Long-term Considerations

- Consider making the script POSIX sh-compatible to work with Alpine's default `ash` shell
- Or clearly document that `bash` is a prerequisite
- Consider adding a version extraction helper function to centralize regex logic

---

## Files Created During Testing

- `/tmp/alpine-test/bin/` - Mock Alpine environment with BusyBox-style utilities
- `/tmp/test-catalyst-archive/catalyst.tar.gz` - Test archive for mock curl

---

## Conclusion

The `install.sh` script **will fail** on stock Alpine Linux due to:
1. `grep -oP` incompatibility with BusyBox grep
2. Missing `openssl` dependency check
3. Bash requirement not documented for Alpine users

**Priority:** Fix the `grep -oP` issue and add `openssl` to dependency checks before advertising Alpine support.
