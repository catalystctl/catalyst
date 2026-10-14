#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Fedora 44 compatibility regression: systemd RestrictSUIDSGID vs openat2(2).
#
# systemd implements RestrictSUIDSGID=yes with a seccomp rule that denies
# openat2(2) and returns ENOSYS. Fedora 44's GNU tar backports gnulib's openat2
# support, so every `tar` extraction the agent runs (backup restore, archive
# decompress) aborted with "Function not implemented".
#   https://github.com/systemd/systemd/issues/43314
#
# Static contract checks always run. The live sandbox checks run when the host
# has root, systemd and a C compiler; they reproduce the failure with
# RestrictSUIDSGID=yes and prove the shipped directives fix it.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

UNIT_SCRIPT="$REPO_ROOT/scripts/deploy-agent.sh"
DROPIN="$REPO_ROOT/systemd/catalyst-agent.service.d/limits.conf"
TUNING="$REPO_ROOT/scripts/node-tuning.sh"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $*" >&2; }
skip() { echo "  SKIP: $*"; }

echo "== Fedora 44 openat2 / RestrictSUIDSGID compatibility =="

# --- Static contract: the shipped sandbox disables only RestrictSUIDSGID -----
if grep -qE '^[[:space:]]*RestrictSUIDSGID=(yes|true|1|on)' "$UNIT_SCRIPT" "$DROPIN" "$TUNING"; then
    fail "a shipped unit/drop-in still enables RestrictSUIDSGID"
else
    pass "no shipped unit/drop-in enables RestrictSUIDSGID"
fi

for f in "$UNIT_SCRIPT" "$DROPIN" "$TUNING"; do
    if grep -qE '^[[:space:]]*RestrictSUIDSGID=no' "$f"; then
        pass "$(basename "$f") sets RestrictSUIDSGID=no"
    else
        fail "$(basename "$f") does not set RestrictSUIDSGID=no"
    fi
done

# --- Static contract: every other sandbox directive stays -------------------
for directive in \
    'NoNewPrivileges=true' \
    'ProtectSystem=full' \
    'ProtectHome=true' \
    'ProtectKernelTunables=true' \
    'ProtectKernelModules=true' \
    'ProtectControlGroups=true' \
    'SystemCallFilter=@system-service @mount' \
    'SystemCallArchitectures=native' \
    'RestrictNamespaces=mnt net uts ipc' \
    'CapabilityBoundingSet=CAP_CHOWN'; do
    if grep -qF "$directive" "$UNIT_SCRIPT"; then
        pass "agent unit keeps $directive"
    else
        fail "agent unit lost $directive"
    fi
done

# --- Static contract: drop-ins are self-healed -------------------------------
if awk '/^write_systemd_unit\(\)/,/^}/' "$UNIT_SCRIPT" | grep -q 'Disabling RestrictSUIDSGID'; then
    pass "write_systemd_unit neutralizes drop-ins that re-enable RestrictSUIDSGID"
else
    fail "write_systemd_unit does not self-heal RestrictSUIDSGID drop-ins"
fi

if grep -q 'systemd/systemd/issues/43314' "$UNIT_SCRIPT"; then
    pass "agent unit documents the systemd issue"
else
    fail "agent unit does not cite systemd/systemd#43314"
fi

# --- Static contract: the extractor auto-detects compression ----------------
if grep -q '"-xzf"' "$REPO_ROOT/catalyst-agent/src/file_manager.rs"; then
    fail "file_manager still forces gzip with -xzf (plain .tar backups fail)"
else
    pass "file_manager extracts with -xf (plain .tar backups restore)"
fi

# --- Live sandbox checks -----------------------------------------------------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
        SUDO="sudo"
    fi
fi

if [ -n "$SUDO" ] || [ "$(id -u)" -eq 0 ]; then
    if ! command -v systemd-run >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
        skip "no systemd here: skipping live sandbox checks"
    elif ! command -v gcc >/dev/null 2>&1; then
        skip "no gcc: skipping live sandbox checks"
    elif ! command -v tar >/dev/null 2>&1; then
        skip "no tar: skipping live sandbox checks"
    else
        WORK="$(mktemp -d)"
        # Extraction runs as root, so cleanup needs the same privileges.
        cleanup_work() { $SUDO rm -rf "$WORK"; }
        trap cleanup_work EXIT
        TAR_BIN="$(command -v tar)"

        cat > "$WORK/probe.c" <<'PROBE'
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/syscall.h>

struct open_how {
    unsigned long long flags;
    unsigned long long mode;
    unsigned long long resolve;
};

int main(void) {
    struct open_how how = {0};
    how.flags = O_RDONLY | O_CLOEXEC;
    long r = syscall(SYS_openat2, AT_FDCWD, "/etc/hostname", &how, sizeof(how));
    if (r >= 0) {
        close((int)r);
        puts("OPENAT2_OK");
        return 0;
    }
    printf("OPENAT2_ERRNO=%d\n", errno);
    return 1;
}
PROBE
        gcc -O0 -o "$WORK/probe" "$WORK/probe.c"

        # A stand-in for Fedora's tar: it issues openat2 before extracting, so
        # it fails exactly where the customer's tar fails.
        cat > "$WORK/fedora-tar" <<FEDORATAR
#!/bin/sh
"$WORK/probe" >/dev/null 2>&1 || exit 1
exec "$TAR_BIN" "\$@"
FEDORATAR
        chmod +x "$WORK/fedora-tar"

        mkdir -p "$WORK/src/sub"
        echo hello > "$WORK/src/hello.txt"
        echo world > "$WORK/src/sub/world.txt"
        tar -czf "$WORK/backup.tar.gz" -C "$WORK/src" .
        tar -cf "$WORK/backup.tar" -C "$WORK/src" .

        # 1. RestrictSUIDSGID=yes must reproduce the ENOSYS root cause.
        out=""
        if out="$($SUDO systemd-run --wait --pipe -p RestrictSUIDSGID=yes "$WORK/probe" 2>&1)"; then
            fail "RestrictSUIDSGID=yes did not block openat2 (probe succeeded: $out)"
        elif grep -q 'OPENAT2_ERRNO=38' <<<"$out"; then
            pass "RestrictSUIDSGID=yes makes openat2 fail with ENOSYS (root cause reproduced)"
        else
            fail "unexpected probe output under RestrictSUIDSGID=yes: $out"
        fi

        # 2. The old sandbox must break a tar that needs openat2.
        $SUDO rm -rf "$WORK/out"
        mkdir -p "$WORK/out"
        if $SUDO systemd-run --wait --pipe -p RestrictSUIDSGID=yes \
            "$WORK/fedora-tar" -xf "$WORK/backup.tar" -C "$WORK/out" >/dev/null 2>&1; then
            fail "openat2-using tar extracted under RestrictSUIDSGID=yes (expected failure)"
        else
            pass "openat2-using tar fails under RestrictSUIDSGID=yes (customer symptom)"
        fi

        # 3. The shipped sandbox must let openat2 through.
        if out="$($SUDO systemd-run --wait --pipe \
            -p RestrictSUIDSGID=no \
            -p 'SystemCallFilter=@system-service @mount' \
            "$WORK/probe" 2>&1)" && grep -q 'OPENAT2_OK' <<<"$out"; then
            pass "shipped sandbox (RestrictSUIDSGID=no) lets openat2 through"
        else
            fail "openat2 still blocked under the shipped sandbox: $out"
        fi

        # 4. Compressed and uncompressed backups both restore under it.
        for archive in backup.tar.gz backup.tar; do
            $SUDO rm -rf "$WORK/out"
            mkdir -p "$WORK/out"
            if $SUDO systemd-run --wait --pipe \
                -p RestrictSUIDSGID=no \
                -p 'SystemCallFilter=@system-service @mount' \
                "$WORK/fedora-tar" -xf "$WORK/$archive" -C "$WORK/out" \
                --no-same-owner --no-same-permissions --anchored >/dev/null 2>&1 \
                && [ -f "$WORK/out/hello.txt" ] && [ -f "$WORK/out/sub/world.txt" ]; then
                pass "$archive restores under the shipped sandbox"
            else
                fail "$archive failed to restore under the shipped sandbox"
            fi
        done
    fi
else
    skip "not root and no passwordless sudo: skipping live sandbox checks"
fi

echo ""
echo "fedora44-openat2: $PASS passed, $FAIL failed"
exit $FAIL
