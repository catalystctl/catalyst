#!/usr/bin/env bash
# Pool supervisor: keeps up to CONCURRENCY ephemeral runner containers alive.
#
# Each container registers --ephemeral, runs ONE job, then exits; this loop
# respawns a fresh container for the next job. A FRESH registration token is
# fetched per spawn (tokens live ~1h). The high-value gh credential stays HERE
# on the host supervisor and NEVER enters the containers — only short-lived
# registration tokens (which can only register a runner, nothing else) are
# passed in.
set -uo pipefail

: "${REPO:=catalystctl/catalyst}"
: "${IMAGE:=localhost/gh-runner-catalyst:latest}"
: "${CONCURRENCY:=2}"
: "${LABELS:=self-hosted,Linux,X64,catalyst-ci}"
: "${RUNNER_PREFIX:=catalyst-ci}"
: "${CACHE_BASE:=gh-catalyst-cache}"
: "${MEM_LIMIT:=5g}"
: "${CPU_LIMIT:=4}"

HOST="$(hostname -s)"
log() { printf '[%s] [supervisor] %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

# Mint a fresh, short-lived runner registration token via gh (POST endpoint).
fetch_token() {
  gh api -X POST "repos/${REPO}/actions/runners/registration-token" --jq .token 2>/dev/null
}

# Best-effort cleanup of offline runners leaked by crashed containers. Safe
# here because this pool uses distinctive RUNNER_PREFIX names; only remove
# offline runners matching our prefix.
cleanup_offline() {
  local runners ids
  runners="$(gh api "repos/${REPO}/actions/runners" --jq '.runners[] | select(.status=="offline") | "\(.id) \(.name)"' 2>/dev/null || true)"
  [ -z "$runners" ] && return 0
  ids="$(echo "$runners" | grep "$RUNNER_PREFIX" | awk '{print $1}' || true)"
  [ -z "$ids" ] && return 0
  for id in $ids; do
    log "cleaning up leaked offline runner id=$id"
    gh api -X DELETE "repos/${REPO}/actions/runners/${id}" >/dev/null 2>&1 || true
  done
}

run_slot() {
  local slot="$1"
  local name="${RUNNER_PREFIX}-${HOST}-${slot}"
  while true; do
    local token
    token="$(fetch_token)"
    if [ -z "$token" ]; then
      log "slot $slot: failed to fetch registration token (gh auth/network?), retry in 30s"
      sleep 30
      continue
    fi
    # Drop any stale container holding the name (crashed without --rm cleanup).
    podman rm -f "$name" >/dev/null 2>&1 || true
    # Pass the registration token via an env file (0600), never -e: -e values
    # are visible to every local user in the process list.
    local env_file
    env_file="$(mktemp)"
    chmod 600 "$env_file"
    printf 'REPO=%s\nREGISTRATION_TOKEN=%s\nRUNNER_NAME=%s\nLABELS=%s\nRUNNER_ALLOW_RUNASROOT=1\n' \
      "$REPO" "$token" "$name" "$LABELS" > "$env_file"
    log "slot $slot: launching ephemeral runner '${name}'"
    podman run --rm \
      --name "$name" \
      --memory="${MEM_LIMIT}" --memory-swap="${MEM_LIMIT}" \
      --cpus="${CPU_LIMIT}" --pids-limit=1024 \
      --security-opt=no-new-privileges \
      --cap-drop=all \
      --cap-add=CHOWN --cap-add=DAC_OVERRIDE --cap-add=FOWNER \
      --cap-add=FSETID --cap-add=KILL --cap-add=SETFCAP \
      --cap-add=SETGID --cap-add=SETUID --cap-add=SYS_CHROOT \
      --env-file="$env_file" \
      -v "${CACHE_BASE}-${slot}:/cache" \
      "$IMAGE"
    local rc=$?
    rm -f "$env_file"
    log "slot $slot: runner '${name}' exited rc=$rc; respawning in 5s"
    sleep 5
  done
}

log "starting: repo=${REPO} concurrency=${CONCURRENCY} image=${IMAGE}"
cleanup_offline

for ((i=0; i<CONCURRENCY; i++)); do
  run_slot "$i" &
done

# Each slot loops forever; this blocks until all exit (only on shutdown).
wait
log "all slots exited; supervisor shutting down"
