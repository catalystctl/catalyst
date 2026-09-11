#!/usr/bin/env bash
# Ephemeral runner entrypoint. Registers with --ephemeral (runs exactly ONE job,
# then auto-deregisters from GitHub), runs the job, and exits. The supervisor
# respawns a fresh container for the next job. No state survives between jobs
# except the /cache toolchain volume.
set -uo pipefail

: "${REPO:?REPO not set}"
: "${REGISTRATION_TOKEN:?REGISTRATION_TOKEN not set}"
: "${RUNNER_NAME:?RUNNER_NAME not set}"
: "${LABELS:=self-hosted,Linux,X64,catalyst-ci}"

cd /runner
mkdir -p /cache/go-mod /cache/go-build /cache/toolcache /cache/pip /cache/npm

# Belt-and-suspenders: deregister on any exit. (--ephemeral already auto-removes
# after one job, but this covers crash/kill paths too.)
deregister() {
  ./config.sh remove --token "${REGISTRATION_TOKEN}" 2>/dev/null || true
}
trap deregister EXIT

echo "[entrypoint] registering ephemeral runner '${RUNNER_NAME}' for ${REPO}"

./config.sh --unattended \
  --url "https://github.com/${REPO}" \
  --token "${REGISTRATION_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${LABELS}" \
  --ephemeral \
  --work _work

echo "[entrypoint] registered; waiting for a job..."
# Runs the listener. With --ephemeral, it exits after exactly one job completes.
./run.sh
echo "[entrypoint] job done; exiting (supervisor will respawn)"
