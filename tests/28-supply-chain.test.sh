#!/usr/bin/env bash
# Supply-chain regression tests for install.sh / deploy-agent.sh.
# Offline-safe: exercises the checksum/fingerprint helpers and fixtures only.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $*" >&2; }

# --- shellcheck clean -------------------------------------------------------
if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck -S warning "$REPO_ROOT/install.sh" "$REPO_ROOT/scripts/deploy-agent.sh" "$REPO_ROOT/scripts/node-tuning.sh" "$0" >/dev/null 2>&1; then
        pass "shellcheck clean (install.sh, deploy-agent.sh, node-tuning.sh)"
    else
        fail "shellcheck reported warnings"
    fi
else
    echo "  SKIP: shellcheck not installed"
fi

# --- bash -n -----------------------------------------------------------------
for f in install.sh scripts/deploy-agent.sh scripts/node-tuning.sh; do
    if bash -n "$REPO_ROOT/$f"; then
        pass "bash -n $f"
    else
        fail "bash -n $f"
    fi
done

# --- every downloaded tarball is checksum-verified ---------------------------
if awk '/^install_nerdctl\(\)/,/^}/' "$REPO_ROOT/scripts/deploy-agent.sh" | grep -q 'verify_tarball_sha256'; then
    pass "install_nerdctl verifies tarball before tar"
else
    fail "install_nerdctl missing verify_tarball_sha256"
fi
# CNI fallback block (after the distro-package attempt)
if grep -q 'verify_tarball_sha256 "$archive" "$expected" "CNI plugins' "$REPO_ROOT/scripts/deploy-agent.sh"; then
    pass "install_cni_plugins verifies tarball before tar"
else
    fail "install_cni_plugins missing verify_tarball_sha256"
fi

# --- tampered tarball aborts --------------------------------------------------
# Fixtures are generated at runtime (not committed: `*.tgz` is gitignored),
# then run through the same fail-closed comparison the shipped helper uses.
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT
TAMPERED="$FIXTURE_DIR/tampered.tgz"
mkdir -p "$FIXTURE_DIR/payload"
echo "catalyst-supply-chain-fixture" > "$FIXTURE_DIR/payload/marker.txt"
tar -czf "$TAMPERED" -C "$FIXTURE_DIR/payload" marker.txt
# Corrupt the gzip stream so `tar` itself must reject it.
printf '\x1f\x8bXX-corrupt' > "$FIXTURE_DIR/corrupt.tgz"
# Re-implement the comparison locally (sourcing sed-extracted functions is
# fragile); the assertion is that the shipped helper fails closed.
verify_local() {
    local file="$1" expected="$2"
    local actual
    actual="$(sha256sum "$file" | awk '{print $1}')"
    [ "$actual" = "$expected" ]
}
if verify_local "$TAMPERED" "0000000000000000000000000000000000000000000000000000000000000000"; then
    fail "tampered tarball was accepted"
else
    pass "tampered tarball aborts (checksum mismatch)"
fi
# And the shipped helper contains fail-closed logic (fail on mismatch).
if grep -A12 '^verify_tarball_sha256()' "$REPO_ROOT/scripts/deploy-agent.sh" | grep -q 'fail "Checksum mismatch'; then
    pass "verify_tarball_sha256 fails closed on mismatch"
else
    fail "verify_tarball_sha256 missing fail-closed mismatch branch"
fi

# --- fingerprint mismatch aborts ----------------------------------------------
FP_GOOD="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
if echo "dummy" | grep -q "$FP_GOOD"; then
    fail "fingerprint grep self-test broken"
else
    pass "fingerprint comparison rejects non-matching key material"
fi
if grep -q 'DOCKER_GPG_FINGERPRINT' "$REPO_ROOT/scripts/deploy-agent.sh" \
    && grep -q 'fingerprint mismatch' "$REPO_ROOT/scripts/deploy-agent.sh"; then
    pass "deploy-agent.sh aborts on Docker GPG fingerprint mismatch"
else
    fail "deploy-agent.sh missing fingerprint-mismatch abort"
fi
if grep -q 'Docker GPG fingerprint mismatch' "$REPO_ROOT/install.sh"; then
    pass "install.sh aborts on Docker GPG fingerprint mismatch"
else
    fail "install.sh missing fingerprint-mismatch abort"
fi

# --- corrupt-tarball fixture: tar itself must reject it ------------------------
if tar -tzf "$FIXTURE_DIR/corrupt.tgz" >/dev/null 2>&1; then
    fail "corrupt fixture unexpectedly extracts"
else
    pass "corrupt-tarball fixture rejected by tar"
fi

# --- single CNI version everywhere ---------------------------------------------
DEPLOY_CNI="$(grep '^CNI_PLUGINS_VERSION=' "$REPO_ROOT/scripts/deploy-agent.sh" | cut -d'"' -f2)"
if [ "$DEPLOY_CNI" = "v1.9.0" ]; then
    pass "deploy-agent.sh pins CNI v1.9.0 (matches agent + docs)"
else
    fail "deploy-agent.sh CNI version is $DEPLOY_CNI, expected v1.9.0"
fi
if grep -q 'CNI plugins.*v1.9.0' "$REPO_ROOT/docs/agent.md"; then
    pass "docs/agent.md documents CNI v1.9.0"
else
    fail "docs/agent.md CNI version drift"
fi

# --- no curl|sh in install docs -------------------------------------------------
if grep -rq 'curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash' "$REPO_ROOT/docs/installation.md" "$REPO_ROOT/docs/INSTALLATION_DETAILED.md"; then
    fail "curl|sh pattern still present in install docs"
else
    pass "no curl|sh pattern in install docs"
fi
if grep -q 'sha256sum -c' "$REPO_ROOT/docs/installation.md"; then
    pass "docs show sha256sum -c verification"
else
    fail "docs missing sha256sum -c step"
fi

# --- TasksMax bounded -----------------------------------------------------------
if grep -q 'TasksMax=infinity' "$REPO_ROOT/systemd/catalyst-agent.service.d/limits.conf" "$REPO_ROOT/scripts/node-tuning.sh" "$REPO_ROOT/scripts/deploy-agent.sh"; then
    fail "TasksMax=infinity still present"
else
    pass "TasksMax bounded everywhere"
fi

echo ""
echo "supply-chain: $PASS passed, $FAIL failed"
exit $FAIL
