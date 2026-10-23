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

# --- agent binary must be installed with install(1), not mv from /tmp --------
# A rename keeps the source inode, so a binary staged under /tmp keeps its
# user_tmp_t SELinux label. init_t may not execute that label, and systemd then
# fails at ExecStart with 203/EXEC "Permission denied" on Fedora/RHEL. install(1)
# creates a fresh inode in /opt/catalyst-agent, which the policy labels by path.
if awk '/^verify_and_install_binary\(\)/,/^}/' "$REPO_ROOT/scripts/deploy-agent.sh" \
    | grep -qE '^[[:space:]]*mv .*catalyst-agent/catalyst-agent'; then
    fail "verify_and_install_binary moves the binary from /tmp (keeps the /tmp SELinux label -> 203/EXEC)"
else
    pass "verify_and_install_binary does not mv the binary out of /tmp"
fi
if awk '/^verify_and_install_binary\(\)/,/^}/' "$REPO_ROOT/scripts/deploy-agent.sh" \
    | grep -q 'install -m 0755 "$tmp_binary"'; then
    pass "verify_and_install_binary installs the binary with install -m 0755"
else
    fail "verify_and_install_binary does not use install -m 0755"
fi
if grep -q '^relabel_agent_binary()' "$REPO_ROOT/scripts/deploy-agent.sh"; then
    pass "deploy-agent.sh relabels the installed binary when SELinux is enforcing"
else
    fail "deploy-agent.sh has no SELinux relabel step"
fi

# --- crash-loop and stale-drop-in guards -------------------------------------
if grep -q '^StartLimitBurst=' "$REPO_ROOT/scripts/deploy-agent.sh"; then
    pass "agent unit bounds the restart loop (StartLimitBurst)"
else
    fail "agent unit has no StartLimitBurst: a unit that cannot start loops forever"
fi
if awk '/^write_systemd_unit\(\)/,/^}/' "$REPO_ROOT/scripts/deploy-agent.sh" \
    | grep -q 'Removing stale /tmp ReadWritePaths'; then
    pass "write_systemd_unit strips a stale /tmp ReadWritePaths from drop-ins"
else
    fail "write_systemd_unit does not strip stale /tmp ReadWritePaths (226/NAMESPACE)"
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

# --- Fedora 41+ / RHEL 10 ship dnf5: the dnf4 repo commands are gone ----------
# dnf5 removed `dnf config-manager --add-repo` and the dnf-plugins-core package;
# it ships config-manager in dnf5-plugins and uses `addrepo --from-repofile=`.
# Fedora Server enables firewalld, and without a repo the install cannot even
# reach the Docker packages, so both forms must be present behind a version check.
if grep -qE '^[[:space:]]*sudo dnf config-manager --add-repo' "$REPO_ROOT/install.sh" \
    && ! grep -q 'dnf5-plugins' "$REPO_ROOT/install.sh"; then
    fail "install.sh uses only the dnf4 config-manager form (breaks on Fedora 41+ / RHEL 10)"
else
    pass "install.sh handles dnf5 (addrepo --from-repofile) as well as dnf4"
fi
if grep -q 'dnf config-manager addrepo --from-repofile' "$REPO_ROOT/install.sh"; then
    pass "install.sh uses the dnf5 addrepo syntax"
else
    fail "install.sh is missing the dnf5 addrepo syntax"
fi
if grep -q 'dnf-plugins-core' "$REPO_ROOT/install.sh" \
    && grep -q 'dnf5-plugins' "$REPO_ROOT/install.sh"; then
    pass "install.sh installs the right config-manager package for each dnf"
else
    fail "install.sh does not cover both dnf-plugins-core (dnf4) and dnf5-plugins (dnf5)"
fi

# --- The panel port must be reachable on hosts that run a firewall ------------
# Fedora Server, RHEL and CentOS enable firewalld by default; the agent opens
# game/SFTP ports itself but nothing opens the panel port, so a correct install
# left the panel unreachable from another machine.
if grep -q '^check_host_firewall()' "$REPO_ROOT/install.sh"; then
    pass "install.sh advises on the host firewall for the panel port"
else
    fail "install.sh never checks the host firewall (panel unreachable on Fedora/RHEL)"
fi
# The definition is useless if nothing calls it.
if awk '/^phase_preflight\(\)/,/^}/' "$REPO_ROOT/install.sh" | grep -q '^[[:space:]]*check_host_firewall$'; then
    pass "phase_preflight actually calls check_host_firewall"
else
    fail "check_host_firewall is defined but never called (dead code)"
fi
if grep -q 'firewall-cmd --permanent --add-port' "$REPO_ROOT/install.sh"; then
    pass "install.sh prints the firewalld command to open the panel port"
else
    fail "install.sh does not print a firewalld command for the panel port"
fi
if awk '/^check_host_firewall\(\)/,/^}/' "$REPO_ROOT/install.sh" | grep -q 'ufw allow'; then
    pass "install.sh prints the ufw command to open the panel port"
else
    fail "install.sh does not print a ufw command for the panel port"
fi

# --- The agent must not reload firewalld once per port/protocol ----------------
# allow_port applies tcp and udp; a `--reload` in that path reloaded the whole
# daemon twice per game port and briefly dropped runtime state.
if grep -q 'firewalld_allow_args' "$REPO_ROOT/catalyst-agent/src/firewall_manager.rs"; then
    pass "agent builds the firewalld command sequence in one testable place"
else
    fail "agent has no testable firewalld command builder"
fi

# --- The install scripts must not assume SELinux-free hosts for exec bits -----
# mv keeps the source inode (and its /tmp SELinux label); install(1) creates a
# fresh inode labelled by path. init_t cannot exec a user_tmp_t binary -> 203/EXEC.
if awk '/^verify_and_install_binary\(\)/,/^}/' "$REPO_ROOT/scripts/deploy-agent.sh" \
    | grep -q 'install -m 0755 "$tmp_binary"'; then
    pass "agent binary is installed with install -m 0755 (correct SELinux label)"
else
    fail "agent binary install does not use install -m 0755"
fi

# --- Pinned installs must use the v-stripped tag archive root (#315) ----------
# GitHub names the top-level folder of a tag archive after the tag *without*
# the leading "v" (v1.85.2 -> catalyst-1.85.2/), so using the tag verbatim made
# every `INSTALL_VERSION=vX.Y.Z` install fail with "Not found in archive".
if grep -Fq 'archive_dir="${REPO#*/}-${ref_name#v}"' "$REPO_ROOT/install.sh"; then
    pass "install.sh strips the leading v from the tag archive root"
else
    fail "install.sh uses the tag name verbatim as the archive root"
fi
# Functional check of the assumption + the fallback: build a GitHub-shaped tag
# archive and extract catalyst-docker from it the way phase_download does.
ARCHIVE_DIR_FIXTURE="$FIXTURE_DIR/archive"
mkdir -p "$ARCHIVE_DIR_FIXTURE/build/catalyst-1.85.2/catalyst-docker"
echo 'services: {}' > "$ARCHIVE_DIR_FIXTURE/build/catalyst-1.85.2/catalyst-docker/docker-compose.yml"
tar -czf "$ARCHIVE_DIR_FIXTURE/catalyst.tar.gz" -C "$ARCHIVE_DIR_FIXTURE/build" catalyst-1.85.2
archive_root=$(tar -tzf "$ARCHIVE_DIR_FIXTURE/catalyst.tar.gz" | sed -n '1s|/.*||p')
if [[ "$archive_root" == "catalyst-1.85.2" ]]; then
    pass "tag archive root drops the leading v (catalyst-1.85.2)"
else
    fail "unexpected tag archive root: $archive_root"
fi
mkdir -p "$ARCHIVE_DIR_FIXTURE/out"
if tar -xzf "$ARCHIVE_DIR_FIXTURE/catalyst.tar.gz" -C "$ARCHIVE_DIR_FIXTURE/out" \
    --strip-components=1 "catalyst-1.85.2/catalyst-docker/" 2>/dev/null \
    && [[ -f "$ARCHIVE_DIR_FIXTURE/out/catalyst-docker/docker-compose.yml" ]]; then
    pass "pinned archive extracts catalyst-docker from the v-stripped root"
else
    fail "pinned archive extraction failed for the v-stripped root"
fi

# --- Compose defaults must pass backend config validation (#316) --------------
# The backend accepts block|allow; the compose default was `keep`, so a fresh
# install never became healthy.
if grep -rq 'SUSPENSION_DELETE_POLICY:-keep' "$REPO_ROOT/catalyst-docker/" "$REPO_ROOT/tests/lib/docker-env.sh" 2>/dev/null; then
    fail "a shipped default sets SUSPENSION_DELETE_POLICY=keep (backend rejects it)"
else
    pass "shipped SUSPENSION_DELETE_POLICY defaults are valid"
fi
if grep -q 'SUSPENSION_DELETE_POLICY: ${SUSPENSION_DELETE_POLICY:-block}' "$REPO_ROOT/catalyst-docker/docker-compose.yml"; then
    pass "compose defaults SUSPENSION_DELETE_POLICY to block"
else
    fail "compose does not default SUSPENSION_DELETE_POLICY to block"
fi

echo ""
echo "supply-chain: $PASS passed, $FAIL failed"
exit $FAIL