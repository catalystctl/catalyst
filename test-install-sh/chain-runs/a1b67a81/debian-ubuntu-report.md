# Debian/Ubuntu Compatibility Report for install.sh

**Test Date:** 2026-05-02  
**Host:** Debian GNU/Linux 13 (trixie)  
**Script:** /home/karutoil/catalyst/install.sh

---

## Summary

| Test Category | Result |
|--------------|--------|
| Command Compatibility | ✅ PASS |
| shellcheck Analysis | ✅ PASS (no warnings) |
| Mock Execution | ✅ PASS |
| Functional Issues | ⚠️ 5 Issues Identified |

---

## 1. Command Compatibility Tests

All core commands used in `install.sh` are fully compatible with Debian/Ubuntu:

| Command | Flag | Result | Notes |
|---------|------|--------|-------|
| `grep` | `-P` (PCRE) | ✅ PASS | GNU grep supports PCRE natively |
| `sed` | `-i` | ✅ PASS | GNU sed in-place editing works correctly |
| `mktemp` | `-d` | ✅ PASS | Creates temp directories as expected |
| `tar` | `--strip-components` | ✅ PASS | GNU tar supports stripping |
| `openssl` | `rand -base64` | ✅ PASS | OpenSSL available and functional |
| `head` | `-c` | ✅ PASS | Byte count option works |
| `curl` | `-fsSL` | ✅ PASS | All flags recognized |

---

## 2. shellcheck Analysis

```bash
$ shellcheck -s bash install.sh
(no output)
```

**Result:** No warnings, errors, or suggestions from shellcheck.

---

## 3. Mock Execution Test

The script executed successfully with mocked Docker/curl commands:

```
[INFO]  Checking for Docker...
[OK]    Docker found (version 28.0.0)
[INFO]  Checking for Docker Compose...
[OK]    Docker Compose found (version Docker Compose version v2.30.0)
[INFO]  Downloading catalyst-docker from catalystctl/catalyst (main)...
[OK]    Download complete. Extracting...
[OK]    Created 'catalyst-docker' in /tmp/tmp.XXX.
[OK]    Created .env from .env.example
[OK]    Generated secure POSTGRES_PASSWORD and BETTER_AUTH_SECRET.
```

**Post-execution verification:**
- Directory created with correct structure
- `.env` file generated with `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET`
- All required files present

---

## 4. Issues Specific to Debian/Ubuntu

While all commands are compatible, the following **functional issues** exist:

### Issue 1: Password Generation Yields <32 Characters (Line 132)

**Test Results:**
```
Run 1: Generated password length = 32
Run 2: Generated password length = 32
Run 3: Generated password length = 32
Run 4: Generated password length = 31  ← TOO SHORT
Run 5: Generated password length = 32
```

**Root Cause:** The `tr -d '/+='` removes characters from the base64 output, reducing the final length unpredictably.

**Current Code:**
```bash
NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
```

**Impact:** Passwords may be shorter than expected (stochastically 30-31 chars instead of 32).

**Debian/Ubuntu Status:** Not distro-specific; affects all platforms.

---

### Issue 2: Missing `openssl` Dependency Check (Line 63-66)

**Current Code:**
```bash
for cmd in curl tar; do
    if ! command -v "$cmd" &>/dev/null; then
        error "'$cmd' is required but not found. Please install it and re-run."
        exit 1
    fi
done
```

**Problem:** `openssl` is used at lines 132-133 but never checked.

**Debian/Ubuntu Note:** Most Debian/Ubuntu systems have `openssl` pre-installed, but minimal containers (like `debian:slim`) may not.

**Fix:** Add `openssl` to the dependency check loop.

---

### Issue 3: `cp` Glob Misses Dotfiles (Line 102)

**Test:**
```bash
cp src/* dest/  # Does NOT copy .hidden files
```

**Problem:** When updating an existing installation, hidden files (`.dockerignore`, `.env.example`) are silently skipped.

**Debian/Ubuntu Status:** Affects all platforms using GNU cp.

**Fix:** Use `cp -r src/. dest/` instead of `cp src/* dest/`.

---

### Issue 4: `sed -i` Delimiter Collision (Lines 134-135)

**Test:**
```bash
$ NEWVAL="safe|value"
$ sed -i "s|^VAR=.*|VAR=${NEWVAL}|" file
sed: -e expression #1, char 20: unknown option to `s'
```

**Problem:** If the generated password ever contains `|`, the sed command will fail.

**Current Code:**
```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASS}|" "${DEST}/.env"
```

**Debian/Ubuntu Status:** Currently safe due to `tr -d '/+='` removing problematic chars, but fragile.

**Fix:** Use a different delimiter or escape the replacement string.

---

### Issue 5: `TMPDIR` Environment Variable Collision (Line 86)

**Test:**
```bash
$ TMPDIR=/nonexistent mktemp -d
mktemp: failed to create directory via template '/nonexistent/tmp.XXXXXXXXXX': No such file or directory
```

**Problem:** If the caller has set `TMPDIR` to an invalid path, the script fails before it can do anything.

**Code:**
```bash
TMPDIR=$(mktemp -d)
```

**Note:** The script uses `TMPDIR` as a variable name, which conflicts with the standard environment variable.

**Fix:** Use a different variable name like `TEMP_DIR`.

---

## 5. Recommendations

| Priority | Issue | Recommended Fix |
|----------|-------|-----------------|
| High | Missing openssl check | Add `openssl` to the dependency loop at line 63 |
| Medium | Password length | Use `openssl rand -hex 16` for fixed 32-char hex passwords |
| Medium | Dotfiles in cp | Change `cp "${TMPDIR}/${TARGET_DIR}/"* "${DEST}/"` to use `.` instead of `*` |
| Low | sed delimiter | Use `@` or `#` as delimiter, or escape the replacement |
| Low | TMPDIR variable | Rename to `TEMP_DIR` to avoid env var collision |

---

## 6. Debian/Ubuntu-Specific Notes

### GNU Toolchain Compatibility

Debian and Ubuntu use GNU versions of core utilities, which means:

- ✅ `grep -P` works (PCRE support via libpcre)
- ✅ `sed -i` works without backup suffix
- ✅ `tar --strip-components` supported
- ✅ `mktemp -d` works as expected

### Package Availability

| Package | Debian/Ubuntu Status | Min Install? |
|---------|---------------------|--------------|
| `curl` | Usually installed | May need install |
| `tar` | Coreutils (always) | Yes |
| `openssl` | Usually installed | No (slim images) |
| `grep` | Coreutils (always) | Yes |
| `sed` | Coreutils (always) | Yes |

---

## Conclusion

**Overall Status:** ✅ **Compatible with Debian/Ubuntu**

The `install.sh` script runs correctly on Debian/Ubuntu systems. All tested commands work as expected, shellcheck reports no issues, and the mock execution completed successfully.

However, **5 functional issues** were identified that affect reliability:
1. Missing `openssl` dependency check
2. Variable password length generation
3. Dotfiles not copied during updates
4. Potential sed delimiter collision
5. TMPDIR environment variable conflict

None of these are Debian/Ubuntu-specific; they affect all platforms equally.
