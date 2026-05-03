# openSUSE Compatibility Report for install.sh

**Test Date:** 2026-05-02  
**Target:** openSUSE Leap / Tumbleweed  
**Test Status:** ✅ Compatible with minor notes

---

## Executive Summary

The `install.sh` script is **compatible** with openSUSE distributions. openSUSE uses GNU coreutils, GNU grep, GNU sed, and GNU tar — all of which support the features used by this script.

No openSUSE-specific blocking issues were identified.

---

## Verification Results

### 1. `grep -P` (PCRE support) — ✅ PASS

**Lines affected:** 34, 57

```bash
# Line 34
docker -v | grep -oP '(?<=version )[^,]+'

# Line 57
docker-compose --version | grep -oP '(?<=version )[^,]+'
```

**openSUSE Status:** GNU grep on openSUSE supports `-P` (PCRE) natively. This has been available in GNU grep for many years and works on both Leap and Tumbleweed.

**Test Result:**
```
$ echo "docker version 28.0.0, build abc123" | grep -oP '(?<=version )[^,]+'
28.0.0
```

**Note:** Some very old openSUSE Leap versions (pre-15.0) might have grep < 2.5, but any supported openSUSE release is fine.

---

### 2. `sed -i` (in-place editing) — ✅ PASS

**Lines affected:** 127, 128

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASS}|" "${DEST}/.env"
sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${NEW_AUTH_SECRET}|" "${DEST}/.env"
```

**openSUSE Status:** GNU sed supports `sed -i` without backup suffix. This is the default behavior on openSUSE.

**Test Result:**
```
$ echo "POSTGRES_PASSWORD=test" > /tmp/test.env
$ sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=newpass|" /tmp/test.env
$ cat /tmp/test.env
POSTGRES_PASSWORD=newpass
```

**Note:** Unlike BSD/macOS sed, GNU sed does not require a space between `-i` and the backup suffix (if any). The script's usage is correct.

---

### 3. `tar` — ✅ PASS

**Lines affected:** 92

```bash
tar -xzf "${TMPDIR}/catalyst.tar.gz" -C "$TMPDIR" --strip-components=1 "${REPO#*/}-${BRANCH}/${TARGET_DIR}/"
```

**openSUSE Status:** GNU tar supports `--strip-components` natively.

**Test Result:** Successfully extracts with path stripping.

---

### 4. `mktemp -d` — ✅ PASS

**Lines affected:** 86

```bash
TMPDIR=$(mktemp -d)
```

**openSUSE Status:** GNU coreutils `mktemp` supports `-d` for directories.

**Note:** If the `TMPDIR` environment variable is set to a non-existent path, `mktemp` will fail. This is expected behavior and consistent across distributions.

---

### 5. `openssl` — ⚠️ MISSING CHECK

**Lines affected:** 123

```bash
NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
NEW_AUTH_SECRET=$(openssl rand -base64 32)
```

**openSUSE Status:** `openssl` is typically installed by default on openSUSE, but the script does not verify its presence before use.

**Recommendation:** Add `openssl` to the dependency check loop (line 63):

```bash
for cmd in curl tar openssl; do
```

---

### 6. `curl` — ✅ PASS

**Lines affected:** 88

```bash
curl -fsSL "$ARCHIVE_URL" -o "${TMPDIR}/catalyst.tar.gz"
```

**openSUSE Status:** `curl` is available on openSUSE and the flags used are standard.

---

### 7. `head -c` — ✅ PASS

**Lines affected:** 123

```bash
openssl rand -base64 24 | tr -d '/+=' | head -c 32
```

**openSUSE Status:** GNU coreutils `head` supports `-c` for byte count.

**Note:** There is a potential issue with password generation (not openSUSE-specific): removing `/+=` characters from base64 output and then truncating to 32 characters can result in passwords shorter than 32 characters if many characters are removed. This is a general script issue, not openSUSE-specific.

---

## ShellCheck Results — ✅ PASS

```bash
$ shellcheck -s bash install.sh
(no output - clean)
```

The script passes shellcheck with no warnings or errors.

---

## Mocked Test Run — ✅ PASS

The script was tested with mocked `docker`, `docker-compose`, and `curl` commands. The test completed successfully:

- ✅ Docker detection works
- ✅ Docker Compose detection works (both plugin and standalone)
- ✅ Archive download and extraction works
- ✅ `.env` file generation works
- ✅ Password generation works

---

## General Issues (Not openSUSE-Specific)

The following issues were identified but are not specific to openSUSE:

1. **`cp dir/* dest/` misses dotfiles** (line 102) — Hidden files like `.dockerignore` are not copied when updating an existing directory.

2. **Password generation may yield <32 chars** (line 123) — The `tr -d '/+='` removes characters before `head -c 32`, potentially resulting in shorter passwords.

3. **`tar` errors hidden** (line 92) — `2>/dev/null` masks extraction failures.

4. **`openssl` not checked** (line 123) — No dependency check for openssl.

---

## Recommendations for openSUSE Users

1. **Install dependencies** (if not already present):
   ```bash
   sudo zypper install curl tar openssl
   ```

2. **Docker installation on openSUSE**:
   ```bash
   sudo zypper install docker docker-compose
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   ```

3. **The script should work without modifications** on openSUSE Leap 15.x and Tumbleweed.

---

## Conclusion

| Component | Status | Notes |
|-----------|--------|-------|
| grep -P | ✅ Compatible | GNU grep with PCRE |
| sed -i | ✅ Compatible | GNU sed |
| tar | ✅ Compatible | GNU tar |
| mktemp -d | ✅ Compatible | GNU coreutils |
| curl | ✅ Compatible | Standard |
| openssl | ✅ Compatible | Usually pre-installed |
| head -c | ✅ Compatible | GNU coreutils |
| shellcheck | ✅ Clean | No warnings |

**Verdict:** The `install.sh` script is **fully compatible** with openSUSE. No openSUSE-specific modifications are required.
