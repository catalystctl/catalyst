#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  run-workflow.sh — Local GitHub Actions CI/CD Emulator for Catalyst           ║
# ║  Mirrors .github/workflows/ci.yml so engineers can test before pushing.      ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#
# ┌──────────────────────────────────────────────────────────────────────────────┐
# │  USAGE                                                                       │
# │                                                                              │
# │  Basic (native — uses host bun/cargo):                                       │
# │    EVENT=push ./run-workflow.sh                                              │
# │    EVENT=pull_request ./run-workflow.sh                                      │
# │    EVENT=push DRY_RUN=1 ./run-workflow.sh           # dry-run, no side fx   │
# │    EVENT=push FAIL_FAST=0 ./run-workflow.sh         # continue on error     │
# │                                                                              │
# │  Docker (emulates ubuntu-latest container):                                  │
# │    EVENT=push USE_DOCKER=1 ./run-workflow.sh                                 │
# │    EVENT=pull_request USE_DOCKER=1 ./run-workflow.sh                         │
# │    EVENT=push USE_DOCKER=1 DRY_RUN=1 ./run-workflow.sh                       │
# │                                                                              │
# │  Target a single component:                                                  │
# │    EVENT=push TARGET=backend ./run-workflow.sh                               │
# │    EVENT=push TARGET=frontend ./run-workflow.sh                              │
# │    EVENT=push TARGET=agent ./run-workflow.sh                                 │
# │    EVENT=push TARGET=all ./run-workflow.sh            # default              │
# │                                                                              │
# │  Release / deploy steps (push to main/develop + tags):                      │
# │    These require GITHUB_TOKEN / registry creds and are MOCKED locally.      │
# │    On push events the script will show what would run.                      │
# │    On pull_request events these steps are skipped entirely.                 │
# │    - Agent Release Build (cargo build --release, upload binary)              │
# │    - Docker Publish (build + push images to GHCR)                           │
# │    Override:                                                                │
# │      EVENT=push RELEASE_CMD="echo mock-release" ./run-workflow.sh            │
# │      EVENT=push DOCKER_CMD="echo mock-publish" ./run-workflow.sh             │
# │                                                                              │
# │  Override individual step commands (CI gates):                              │
# │    EVENT=push LINT_CMD="eslint ." TEST_CMD="vitest run" ./run-workflow.sh    │
# │                                                                              │
# │  Full combination:                                                           │
# │    EVENT=push USE_DOCKER=1 TARGET=backend FAIL_FAST=0 DRY_RUN=1 \           │
# │      ./run-workflow.sh                                                       │
# │                                                                              │
# │  Show this help:                                                             │
# │    ./run-workflow.sh --help                                                  │
# └──────────────────────────────────────────────────────────────────────────────┘
#/
# ┌──────────────────────────────────────────────────────────────────────────────┐
# │  PREREQUISITES                                                               │
# │                                                                              │
# │  Native mode:                                                                │
# │    - bun >= 1.0   (https://bun.sh)                                           │
# │    - cargo >= 1.70 (https://rustup.rs) — only if TARGET includes agent       │
# │    - Node.js >= 20 (for some eslint configs that need it)                    │
# │    - Docker or Podman — only for docker publish step or USE_DOCKER=1         │
# │                                                                              │
# │  Docker mode:                                                                │
# │    - Docker (docker) OR Podman (podman)                                      │
# │    - Internet access on first run to pull oven/bun:1.3-debian               │
# │      and rust:1.93-bookworm images                                           │
# │                                                                              │
# │  Both modes:                                                                 │
# │    - Run from the repository root (where package.json lives)                 │
# │    - No GitHub token or network access required (dry-run skips network)      │
# └──────────────────────────────────────────────────────────────────────────────┘
#/
# ┌──────────────────────────────────────────────────────────────────────────────┐
# │  HOW TRIGGERS DIFFER                                                         │
# │                                                                              │
# │  EVENT=push:                                                                 │
# │    - Simulates merge to main/develop or a tag push.                          │
# │    - Runs CI gates + build + agent release + docker publish.                 │
# │    - Maps to: on.push in .github/workflows/ci.yml                           │
# │    - Agent release only runs when current git HEAD is a v* tag.              │
# │    - Docker publish only runs when relevant paths changed.                   │
# │                                                                              │
# │  EVENT=pull_request:                                                         │
# │    - Simulates a PR check.                                                   │
# │    - Runs lint + test only (no build/deploy).                                │
# │    - Maps to: on.pull_request in .github/workflows/ci.yml                   │
# │                                                                              │
# │  The actual GitHub workflow uses path filters to skip CI on irrelevant      │
# │  changes. Locally we always run everything unless TARGET narrows the scope.  │
# └──────────────────────────────────────────────────────────────────────────────┘
#/
# ┌──────────────────────────────────────────────────────────────────────────────┐
# │  HOW TO ADD NEW STEPS                                                        │
# │                                                                              │
# │  1. Define a new function: step_my_step() { ... }                            │
# │     — Follow the pattern of existing step_* functions below.                 │
# │     — Use run_step "My Step Name" <command> to get logging + timing.         │
# │     — Check DRY_RUN before executing real commands.                          │
# │                                                                              │
# │  2. Register it in register_steps():                                        │
# │     — Add to the STEPS array: STEPS+=("my_step:My New Step")                │
# │     — Order matters — steps execute sequentially.                            │
# │                                                                              │
# │  3. Update .github/workflows/ci.yml to match:                               │
# │     — Add a matching job or step in the corresponding section.              │
# │     — Keep the local script and YAML in sync.                               │
# │                                                                              │
# │  4. (Optional) Make the step conditional on EVENT or TARGET:                │
# │     — See should_run_step() for filtering logic.                            │
# └──────────────────────────────────────────────────────────────────────────────┘
#/
set -euo pipefail

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  CONFIGURATION                                                               ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# --- CLI args take precedence over env vars ---
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,/^$/p' "$0" | sed 's/^# //' || true
  exit 0
fi

# Trigger event: push | pull_request
# Maps to: on: [push, pull_request] in .github/workflows/ci.yml
EVENT="${EVENT:-push}"

# Dry-run: print what would run without side effects
# No equivalent in GHA — this is a local-only safety flag
DRY_RUN="${DRY_RUN:-0}"

# Fail-fast: exit on first step failure (default: on, matching GHA default)
# Maps to: jobs.<job>.strategy.fail-fast (though we're single-job here)
FAIL_FAST="${FAIL_FAST:-1}"

# Target component: backend | frontend | agent | all
# Maps to: paths: filters in on.push.paths / on.pull_request.paths
TARGET="${TARGET:-all}"

# Docker mode: run inside a container approximating ubuntu-latest
# Maps to: runs-on: ubuntu-latest / container: in GHA
USE_DOCKER="${USE_DOCKER:-0}"

# Override commands (empty = auto-detect from package.json / Cargo.toml)
INSTALL_CMD="${INSTALL_CMD:-}"
LINT_CMD="${LINT_CMD:-}"
TEST_CMD="${TEST_CMD:-}"
RELEASE_CMD="${RELEASE_CMD:-}"
DOCKER_CMD="${DOCKER_CMD:-}"

# Color codes (disabled if not a terminal)
if [[ -t 1 ]]; then
  C_RED='\033[0;31m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'
  C_CYAN='\033[0;36m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
else
  C_RED='' C_GREEN='' C_YELLOW='' C_CYAN='' C_BOLD='' C_RESET=''
fi

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  STEP REGISTRY                                                               ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# Each entry: "function_name:Display Name"
# Order here = execution order.
STEPS=()
register_steps() {
  STEPS=(
    "checkout_env:Checkout & Environment Setup"
    "install_deps:Dependency Install"
    "lint:Lint & Static Analysis"
    "test:Unit & Integration Tests"
  )

  # push event adds build-verification, agent-release, and docker-publish steps
  # Maps to: build:, agent-release:, and publish-*: jobs in ci.yml
  if [[ "$EVENT" == "push" ]]; then
    STEPS+=("build_verify:Build Verification")

    # Agent release only when on a v* tag
    # Maps to: if: startsWith(github.ref, 'refs/tags/v') in ci.yml
    local current_tag
    current_tag=$(git tag --points-at HEAD 2>/dev/null | grep -E '^v' | head -1 || true)
    if [[ -n "$current_tag" ]]; then
      STEPS+=("agent_release:Agent Release Build")
    fi

    # Docker publish (always registered — the step itself detects changes)
    # Maps to: detect-changes + publish-backend/publish-frontend jobs in ci.yml
    STEPS+=("docker_publish:Docker Publish")
  fi
}

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  UTILITY FUNCTIONS                                                           ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# Timer helpers — emulate GHA's automatic step timing
declare -A STEP_STARTS
declare -A STEP_DURATIONS
declare -A STEP_STATUSES
declare -A STEP_EXIT_CODES

now_ms() { date +%s%3N; }

# Check whether a step should run based on TARGET and EVENT
# Maps to: paths: filters + if: conditionals in GHA
should_run_step() {
  local step_fn="$1"
  case "$step_fn" in
    checkout_env|install_deps)
      # Always run — maps to: steps that have no if: conditional
      return 0
      ;;
    lint|test)
      # Run for all targets — these are universal CI gates
      return 0
      ;;
    build_verify)
      # Only on push event — registered conditionally above
      # Maps to: if: github.event_name == 'push' in GHA
      return 0
      ;;
    agent_release)
      # Only on push + v* tag — registered conditionally above
      # Maps to: if: startsWith(github.ref, 'refs/tags/v') in GHA
      return 0
      ;;
    docker_publish)
      # Only on push — registered conditionally above
      # Maps to: if: github.event_name == 'push' in GHA
      return 0
      ;;
    *)
      return 0
      ;;
  esac
}

# Detect which package managers are present
# Maps to: the container: image selection in GHA (oven/bun vs rust)
detect_tools() {
  HAS_BUN=0
  HAS_CARGO=0
  HAS_PROTOC=0
  command -v bun &>/dev/null && HAS_BUN=1
  command -v cargo &>/dev/null && HAS_CARGO=1
  command -v protoc &>/dev/null && HAS_PROTOC=1

  if [[ "$TARGET" != "all" ]]; then
    # Narrow detection to requested target
    case "$TARGET" in
      backend|frontend) HAS_CARGO=0; HAS_PROTOC=0 ;;
      agent) HAS_BUN=0 ;;
    esac
  fi

  # Detect Docker/Podman for docker publish step
  HAS_DOCKER=0
  command -v docker &>/dev/null && HAS_DOCKER=1
  if [[ "$HAS_DOCKER" -eq 0 ]]; then
    command -v podman &>/dev/null && HAS_DOCKER=1
  fi
}

# Print a step header — emulates the ::group:: annotation in GHA logs
step_header() {
  local name="$1"
  echo ""
  echo -e "${C_CYAN}${C_BOLD}=== STEP: ${name} ===${C_RESET}"
  echo -e "${C_CYAN}$(printf '=%.0s' {1..60})${C_RESET}"
}

# Run a single command with timing and exit-code capture
# Maps to: each `run:` key under steps: in GHA
# Args: step_name  command [arg...]
run_step() {
  local step_name="$1"; shift
  local cmd=("$@")

  STEP_STARTS["$step_name"]=$(now_ms)

  if [[ "$DRY_RUN" == "1" ]]; then
    echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET} Would run: ${cmd[*]}"
    STEP_STATUSES["$step_name"]="SKIPPED"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="0ms"
    echo -e "  ${C_YELLOW}Status: SKIPPED (dry-run) | Exit: 0 | Duration: 0ms${C_RESET}"
    return 0
  fi

  local exit_code=0
  # Run the command; capture exit code without set -e killing us here
  # Maps to: continue-on-error: false (default) in GHA
  if "${cmd[@]}" 2>&1; then
    exit_code=$?
  else
    exit_code=$?
  fi

  local end_ms; end_ms=$(now_ms)
  local delta_ms=$(( end_ms - STEP_STARTS["$step_name"] ))
  local duration="${delta_ms}ms"
  if (( delta_ms >= 1000 )); then
    duration="$(( delta_ms / 1000 )).$(( (delta_ms % 1000) / 100 ))s"
  fi

  STEP_DURATIONS["$step_name"]="$duration"
  STEP_EXIT_CODES["$step_name"]="$exit_code"

  if [[ "$exit_code" -eq 0 ]]; then
    STEP_STATUSES["$step_name"]="PASS"
    echo -e "  ${C_GREEN}Status: PASS | Exit: ${exit_code} | Duration: ${duration}${C_RESET}"
  else
    STEP_STATUSES["$step_name"]="FAIL"
    echo -e "  ${C_RED}Status: FAIL | Exit: ${exit_code} | Duration: ${duration}${C_RESET}"
  fi

  return "$exit_code"
}

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  STEP IMPLEMENTATIONS                                                        ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# ── Step 1: Checkout & Environment Setup ──────────────────────────────────────
# Maps to:
#   - uses: actions/checkout@v6
#   - env: block at job level
#   - Cache restore steps
step_checkout_env() {
  step_header "Checkout & Environment Setup"
  local step_name="checkout_env"

  if ! should_run_step "$step_name"; then
    echo -e "  ${C_YELLOW}Skipped (does not match TARGET=${TARGET})${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  # --- Verify we're in the repo root ---
  # GHA actions/checkout puts you at $GITHUB_WORKSPACE (repo root)
  if [[ ! -f "package.json" ]]; then
    echo -e "  ${C_RED}ERROR: Not in repository root (no package.json found).${C_RESET}"
    echo -e "  ${C_RED}Run this script from the catalyst root directory.${C_RESET}"
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]=1
    STEP_DURATIONS["$step_name"]="-"
    return 1
  fi

  # --- Detect available tools ---
  detect_tools

  # --- Print environment info (like $GITHUB_ENV + runner diagnostics) ---
  local env_ok=1
  echo -e "  ${C_BOLD}Event:${C_RESET}        ${EVENT}"
  echo -e "  ${C_BOLD}Target:${C_RESET}       ${TARGET}"
  echo -e "  ${C_BOLD}Dry-run:${C_RESET}      ${DRY_RUN}"
  echo -e "  ${C_BOLD}Fail-fast:${C_RESET}    ${FAIL_FAST}"
  echo -e "  ${C_BOLD}Docker:${C_RESET}       ${USE_DOCKER}"
  echo ""
  echo -e "  ${C_BOLD}Detected tools:${C_RESET}"

  if [[ "$HAS_BUN" -eq 1 ]]; then
    echo -e "    bun:      $(bun --version)"
  else
    echo -e "    bun:      ${C_RED}NOT FOUND${C_RESET}"
    [[ "$TARGET" != "agent" ]] && env_ok=0
  fi

  if [[ "$HAS_CARGO" -eq 1 ]]; then
    echo -e "    cargo:    $(cargo --version)"
  else
    echo -e "    cargo:    ${C_RED}NOT FOUND${C_RESET}"
    [[ "$TARGET" == "agent" || "$TARGET" == "all" ]] && env_ok=0
  fi

  if [[ "$HAS_PROTOC" -eq 1 ]]; then
    echo -e "    protoc:   $(protoc --version 2>/dev/null || echo 'unknown')"
  else
    echo -e "    protoc:   ${C_YELLOW}NOT FOUND${C_RESET}"
    echo -e "              ${C_YELLOW}(cargo clippy/test/build may fail for agent)${C_RESET}"
  fi

  echo -e "    git:      $(git --version 2>/dev/null || echo 'NOT FOUND')"

  if [[ "$HAS_DOCKER" -eq 1 ]]; then
    local docker_runtime
    docker_runtime="docker"
    command -v podman &>/dev/null && docker_runtime="podman"
    echo -e "    docker:   ${docker_runtime}"
  else
    echo -e "    docker:   ${C_YELLOW}NOT FOUND (docker publish will be mocked)${C_RESET}"
  fi

  echo ""

  # --- Git context (like $GITHUB_SHA, $GITHUB_REF) ---
  local current_tag
  current_tag=$(git tag --points-at HEAD 2>/dev/null | grep -E '^v' | head -1 || true)
  echo -e "  ${C_BOLD}Git context:${C_RESET}"
  echo -e "    SHA:      $(git rev-parse HEAD 2>/dev/null || echo 'N/A')"
  echo -e "    Branch:   $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'N/A')"
  echo -e "    Tag:      ${current_tag:-none}"
  echo -e "    Status:   $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') modified files"
  echo ""

  if [[ -n "$current_tag" ]]; then
    echo -e "  ${C_GREEN}${C_BOLD}Release detected: ${current_tag} — agent-release step will run${C_RESET}"
  fi

  # --- Fail if required tools are missing ---
  if [[ "$env_ok" -eq 0 ]]; then
    echo -e "  ${C_RED}Required tools missing — cannot continue.${C_RESET}"
    echo -e "  ${C_RED}Install missing tools or set TARGET to skip them.${C_RESET}"
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]=1
    STEP_DURATIONS["$step_name"]="-"
    return 1
  fi

  STEP_STARTS["$step_name"]=$(now_ms) # reset so duration is tiny
  local end_ms; end_ms=$(now_ms)
  STEP_DURATIONS["$step_name"]="$(( end_ms - STEP_STARTS["$step_name"] ))ms"
  STEP_STATUSES["$step_name"]="PASS"
  STEP_EXIT_CODES["$step_name"]=0
  echo -e "  ${C_GREEN}Status: PASS | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  return 0
}

# ── Step 2: Dependency Install ────────────────────────────────────────────────
# Maps to:
#   - bun install --frozen-lockfile         (ci.yml lint/test/build jobs)
#   - cargo fetch                           (ci.yml lint/test/build jobs)
#   - Cache: actions/cache@v5 for node_modules and cargo registry
step_install_deps() {
  step_header "Dependency Install"
  local step_name="install_deps"

  if ! should_run_step "$step_name"; then
    echo -e "  ${C_YELLOW}Skipped (does not match TARGET=${TARGET})${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  STEP_STARTS["$step_name"]=$(now_ms)
  local overall_exit=0

  # --- Bun workspace install ---
  # Maps to: bun install --frozen-lockfile in ci.yml
  if [[ "$HAS_BUN" -eq 1 ]]; then
    echo -e "  ${C_BOLD}[bun] Installing workspace dependencies...${C_RESET}"
    local bun_cmd="${INSTALL_CMD:-bun install --frozen-lockfile}"
    if ! run_step "${step_name}_bun" bash -c "$bun_cmd"; then
      overall_exit=1
    fi

    # Generate Prisma client (backend only)
    # Maps to: bunx prisma generate in ci.yml
    if [[ "$overall_exit" -eq 0 && ("$TARGET" == "backend" || "$TARGET" == "all") ]]; then
      echo -e "  ${C_BOLD}[prisma] Generating client...${C_RESET}"
      if ! run_step "${step_name}_prisma" bash -c "cd catalyst-backend && bunx prisma generate"; then
        overall_exit=1
      fi
    fi
  fi

  # --- Cargo fetch (agent) ---
  # Maps to: cargo fetch in ci.yml
  if [[ "$HAS_CARGO" -eq 1 && "$overall_exit" -eq 0 ]]; then
    echo -e "  ${C_BOLD}[cargo] Fetching dependencies...${C_RESET}"
    if ! run_step "${step_name}_cargo" cargo fetch --manifest-path catalyst-agent/Cargo.toml; then
      overall_exit=1
    fi
  fi

  # Aggregate sub-step results into the parent step
  local end_ms; end_ms=$(now_ms)
  local delta_ms=$(( end_ms - STEP_STARTS["$step_name"] ))
  STEP_DURATIONS["$step_name"]="$(( delta_ms / 1000 )).$(( (delta_ms % 1000) / 100 ))s"

  if [[ "$overall_exit" -eq 0 ]]; then
    STEP_STATUSES["$step_name"]="PASS"
    STEP_EXIT_CODES["$step_name"]=0
    echo -e "  ${C_GREEN}Overall: PASS | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  else
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]="$overall_exit"
    echo -e "  ${C_RED}Overall: FAIL | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  fi

  return "$overall_exit"
}

# ── Step 3: Lint & Static Analysis ────────────────────────────────────────────
# Maps to:
#   - bun run --filter=catalyst-backend lint   (ci.yml lint: job)
#   - cargo fmt --check + cargo clippy      (ci.yml lint: job)
#   - bun pm scan (security audit)           (ci.yml lint: job)
step_lint() {
  step_header "Lint & Static Analysis"
  local step_name="lint"

  if ! should_run_step "$step_name"; then
    echo -e "  ${C_YELLOW}Skipped (does not match TARGET=${TARGET})${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  STEP_STARTS["$step_name"]=$(now_ms)
  local overall_exit=0

  # --- Bun lint (eslint) ---
  # Maps to: bun run --filter=catalyst-backend lint in ci.yml lint: job
  # Runs across all workspace packages that have a lint script
  if [[ "$HAS_BUN" -eq 1 ]]; then
    echo -e "  ${C_BOLD}[bun] Running ESLint...${C_RESET}"
    local lint_cmd="${LINT_CMD:-bun run --filter=catalyst-backend lint}"
    if ! run_step "${step_name}_eslint" bash -c "$lint_cmd"; then
      overall_exit=1
    fi

    # Security audit (non-blocking — maps to: continue-on-error: true in ci.yml)
    if [[ "$overall_exit" -eq 0 ]]; then
      echo -e "  ${C_BOLD}[bun] Security audit...${C_RESET}"
      if ! run_step "${step_name}_audit" bash -c "bun pm scan 2>/dev/null || true"; then
        # Non-blocking — continue even on audit findings
        echo -e "  ${C_YELLOW}  (security audit warnings — non-blocking)${C_RESET}"
      fi
    fi
  fi

  # --- Cargo lint (fmt + clippy) ---
  # Maps to: cargo fmt --check + cargo clippy -- -D warnings in ci.yml lint: job
  if [[ "$HAS_CARGO" -eq 1 && ("$TARGET" == "agent" || "$TARGET" == "all") ]]; then
    echo -e "  ${C_BOLD}[cargo] Checking formatting...${C_RESET}"
    if ! run_step "${step_name}_fmt" cargo fmt --manifest-path catalyst-agent/Cargo.toml -- --check; then
      overall_exit=1
    fi

    if [[ "$overall_exit" -eq 0 ]]; then
      echo -e "  ${C_BOLD}[cargo] Running Clippy...${C_RESET}"
      if ! run_step "${step_name}_clippy" cargo clippy --manifest-path catalyst-agent/Cargo.toml -- -D warnings; then
        overall_exit=1
      fi
    fi
  fi

  # Aggregate
  local end_ms; end_ms=$(now_ms)
  local delta_ms=$(( end_ms - STEP_STARTS["$step_name"] ))
  STEP_DURATIONS["$step_name"]="$(( delta_ms / 1000 )).$(( (delta_ms % 1000) / 100 ))s"

  if [[ "$overall_exit" -eq 0 ]]; then
    STEP_STATUSES["$step_name"]="PASS"
    STEP_EXIT_CODES["$step_name"]=0
    echo -e "  ${C_GREEN}Overall: PASS | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  else
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]="$overall_exit"
    echo -e "  ${C_RED}Overall: FAIL | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  fi

  return "$overall_exit"
}

# ── Step 4: Unit & Integration Tests ──────────────────────────────────────────
# Maps to:
#   - bun run --filter=catalyst-backend test  (ci.yml test: job)
#   - cargo test                            (ci.yml test: job)
step_test() {
  step_header "Unit & Integration Tests"
  local step_name="test"

  if ! should_run_step "$step_name"; then
    echo -e "  ${C_YELLOW}Skipped (does not match TARGET=${TARGET})${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  STEP_STARTS["$step_name"]=$(now_ms)
  local overall_exit=0

  # --- Bun tests (vitest) ---
  # Maps to: bun run --filter=catalyst-backend test in ci.yml test: job
  if [[ "$HAS_BUN" -eq 1 ]]; then
    echo -e "  ${C_BOLD}[bun] Running Vitest across workspace...${C_RESET}"
    local test_cmd="${TEST_CMD:-bun run --filter=catalyst-backend test}"
    if ! run_step "${step_name}_vitest" bash -c "$test_cmd"; then
      overall_exit=1
    fi
  fi

  # --- Cargo tests ---
  # Maps to: cargo test in ci.yml test: job
  if [[ "$HAS_CARGO" -eq 1 && ("$TARGET" == "agent" || "$TARGET" == "all") && "$overall_exit" -eq 0 ]]; then
    echo -e "  ${C_BOLD}[cargo] Running tests...${C_RESET}"
    if ! run_step "${step_name}_cargo" cargo test --manifest-path catalyst-agent/Cargo.toml; then
      overall_exit=1
    fi
  fi

  # Aggregate
  local end_ms; end_ms=$(now_ms)
  local delta_ms=$(( end_ms - STEP_STARTS["$step_name"] ))
  STEP_DURATIONS["$step_name"]="$(( delta_ms / 1000 )).$(( (delta_ms % 1000) / 100 ))s"

  if [[ "$overall_exit" -eq 0 ]]; then
    STEP_STATUSES["$step_name"]="PASS"
    STEP_EXIT_CODES["$step_name"]=0
    echo -e "  ${C_GREEN}Overall: PASS | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  else
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]="$overall_exit"
    echo -e "  ${C_RED}Overall: FAIL | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  fi

  return "$overall_exit"
}

# ── Step 5: Build Verification (push only) ────────────────────────────────────
# Maps to:
#   - bun run build (backend + frontend)    (ci.yml build: job)
#   - cargo build                           (ci.yml build: job)
step_build_verify() {
  step_header "Build Verification"
  local step_name="build_verify"

  if ! should_run_step "$step_name"; then
    echo -e "  ${C_YELLOW}Skipped (does not match TARGET=${TARGET})${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  # This step only runs on push events — maps to:
  #   if: github.event_name == 'push' in ci.yml build: job
  if [[ "$EVENT" != "push" ]]; then
    echo -e "  ${C_YELLOW}Skipped (build verification only runs on push events)${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  STEP_STARTS["$step_name"]=$(now_ms)
  local overall_exit=0

  # --- Bun build ---
  # Maps to: bun run build:backend + build:frontend in ci.yml build: job
  if [[ "$HAS_BUN" -eq 1 ]]; then
    echo -e "  ${C_BOLD}[bun] Building workspace...${C_RESET}"
    if ! run_step "${step_name}_bun" bash -c "bun run build:shared && bun run build:backend && bun run build:frontend"; then
      overall_exit=1
    fi
  fi

  # --- Cargo build (debug for speed locally; release in GHA) ---
  # Maps to: cargo build in ci.yml build: job
  if [[ "$HAS_CARGO" -eq 1 && ("$TARGET" == "agent" || "$TARGET" == "all") && "$overall_exit" -eq 0 ]]; then
    echo -e "  ${C_BOLD}[cargo] Building agent (debug mode for speed)...${C_RESET}"
    if ! run_step "${step_name}_cargo" cargo build --manifest-path catalyst-agent/Cargo.toml; then
      overall_exit=1
    fi
  fi

  # Aggregate
  local end_ms; end_ms=$(now_ms)
  local delta_ms=$(( end_ms - STEP_STARTS["$step_name"] ))
  STEP_DURATIONS["$step_name"]="$(( delta_ms / 1000 )).$(( (delta_ms % 1000) / 100 ))s"

  if [[ "$overall_exit" -eq 0 ]]; then
    STEP_STATUSES["$step_name"]="PASS"
    STEP_EXIT_CODES["$step_name"]=0
    echo -e "  ${C_GREEN}Overall: PASS | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  else
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]="$overall_exit"
    echo -e "  ${C_RED}Overall: FAIL | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  fi

  return "$overall_exit"
}

# ── Step 6: Agent Release Build (push + v* tag only) ───────────────────────────
# Maps to:
#   - agent-release: job in ci.yml
#   - cargo build --release (gnu + musl targets)
#   - softprops/action-gh-release@v2 (upload binary + checksum)
# Merged from: agent-release.yml
#
# NOTE: This step is always mocked locally because:
#   - It needs GITHUB_TOKEN to upload release assets
#   - musl cross-compilation requires musl-tools not typically on dev machines
#   - The real workflow runs this in a rust:1.93-bookworm container
step_agent_release() {
  step_header "Agent Release Build"
  local step_name="agent_release"

  if ! should_run_step "$step_name"; then
    echo -e "  ${C_YELLOW}Skipped (does not match TARGET=${TARGET})${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  # This step only runs on push + v* tag events
  # Maps to: if: startsWith(github.ref, 'refs/tags/v') in ci.yml
  local current_tag
  current_tag=$(git tag --points-at HEAD 2>/dev/null | grep -E '^v' | head -1 || true)
  if [[ -z "$current_tag" ]]; then
    echo -e "  ${C_YELLOW}Skipped (agent release only runs on v* tag pushes)${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  STEP_STARTS["$step_name"]=$(now_ms)
  local overall_exit=0

  echo -e "  ${C_GREEN}${C_BOLD}Release tag detected: ${current_tag}${C_RESET}"
  echo ""

  # --- Build release binary (gnu target) ---
  # Maps to: cargo build --release --target x86_64-unknown-linux-gnu in ci.yml
  # In GHA this runs in a rust:1.93-bookworm container; locally we do a
  # native release build instead (no cross-compilation).
  if [[ "$HAS_CARGO" -eq 1 ]]; then
    if [[ -n "$RELEASE_CMD" ]]; then
      echo -e "  ${C_BOLD}[cargo] Running custom release command...${C_RESET}"
      if ! run_step "${step_name}_build" bash -c "$RELEASE_CMD"; then
        overall_exit=1
      fi
    elif [[ "$DRY_RUN" == "1" ]]; then
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET} Would run: cargo build --release --manifest-path catalyst-agent/Cargo.toml"
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET} Would generate SHA256 checksum"
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET} Would upload to GitHub Release (needs GITHUB_TOKEN)"
    else
      echo -e "  ${C_BOLD}[cargo] Building agent (release)...${C_RESET}"
      if ! run_step "${step_name}_build" cargo build --release --manifest-path catalyst-agent/Cargo.toml; then
        overall_exit=1
      fi

      # --- Generate SHA256 checksum ---
      # Maps to: sha256sum step in ci.yml agent-release: job
      if [[ "$overall_exit" -eq 0 ]]; then
        local binary_path="catalyst-agent/target/release/catalyst-agent"
        if [[ -f "$binary_path" ]]; then
          echo -e "  ${C_BOLD}[checksum] Generating SHA256...${C_RESET}"
          if ! run_step "${step_name}_sha256" bash -c "sha256sum ${binary_path} > ${binary_path}.sha256 && cat ${binary_path}.sha256"; then
            overall_exit=1
          fi
        fi
      fi

      # --- Upload to GitHub Release ---
      # Maps to: softprops/action-gh-release@v2 in ci.yml agent-release: job
      # Locally this is always a no-op unless GITHUB_TOKEN is set
      if [[ "$overall_exit" -eq 0 ]]; then
        if [[ -n "${GITHUB_TOKEN:-}" ]]; then
          echo -e "  ${C_BOLD}[upload] Uploading to GitHub Release...${C_RESET}"
          # The actual upload is done by the GHA action; locally we just
          # confirm the binary exists and skip the upload
          echo -e "  ${C_YELLOW}  (upload requires GitHub Actions runtime — binary built locally at ${binary_path})${C_RESET}"
        else
          echo -e "  ${C_YELLOW}[upload] Skipped — no GITHUB_TOKEN (binary available at ${binary_path:-target/release/})${C_RESET}"
        fi
      fi
    fi
  else
    echo -e "  ${C_YELLOW}Skipped (cargo not found, TARGET=${TARGET})${C_RESET}"
  fi

  # Aggregate
  local end_ms; end_ms=$(now_ms)
  local delta_ms=$(( end_ms - STEP_STARTS["$step_name"] ))
  STEP_DURATIONS["$step_name"]="$(( delta_ms / 1000 )).$(( (delta_ms % 1000) / 100 ))s"

  if [[ "$overall_exit" -eq 0 ]]; then
    STEP_STATUSES["$step_name"]="PASS"
    STEP_EXIT_CODES["$step_name"]=0
    echo -e "  ${C_GREEN}Overall: PASS | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  else
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]="$overall_exit"
    echo -e "  ${C_RED}Overall: FAIL | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  fi

  return "$overall_exit"
}

# ── Step 7: Docker Publish (push only) ─────────────────────────────────────────
# Maps to:
#   - detect-changes + publish-backend + publish-frontend jobs in ci.yml
#   - docker/build-push-action (build + push to GHCR)
# Merged from: docker-publish.yml
#
# NOTE: This step is mocked locally because:
#   - It needs GITHUB_TOKEN for GHCR authentication
#   - It needs useblacksmith/setup-docker-builder (Blacksmith-specific)
#   - The real workflow only publishes when relevant paths changed
# Locally we simulate the change-detection and show what would be pushed.
step_docker_publish() {
  step_header "Docker Publish"
  local step_name="docker_publish"

  if ! should_run_step "$step_name"; then
    echo -e "  ${C_YELLOW}Skipped (does not match TARGET=${TARGET})${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  # This step only runs on push events
  # Maps to: if: github.event_name == 'push' in ci.yml
  if [[ "$EVENT" != "push" ]]; then
    echo -e "  ${C_YELLOW}Skipped (docker publish only runs on push events)${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    STEP_DURATIONS["$step_name"]="-"
    return 0
  fi

  STEP_STARTS["$step_name"]=$(now_ms)
  local overall_exit=0

  # --- Detect changes (simulate dorny/paths-filter) ---
  # Maps to: detect-changes: job in ci.yml
  # Locally we check if the relevant directories have uncommitted changes
  # or if we can't determine, we assume "all changed" to be safe.
  local backend_changed=1
  local frontend_changed=1

  if git diff --quiet HEAD~1 -- catalyst-backend/ catalyst-shared/ bun.lock bun.lockb package.json 2>/dev/null; then
    backend_changed=0
  fi
  if git diff --quiet HEAD~1 -- catalyst-frontend/ catalyst-shared/ bun.lock bun.lockb package.json 2>/dev/null; then
    frontend_changed=0
  fi

  echo -e "  ${C_BOLD}Change detection (maps to: dorny/paths-filter in ci.yml):${C_RESET}"
  echo -e "    backend:  $([ "$backend_changed" -eq 1 ] && echo 'CHANGED' || echo 'unchanged')"
  echo -e "    frontend: $([ "$frontend_changed" -eq 1 ] && echo 'CHANGED' || echo 'unchanged')"
  echo ""

  if [[ "$backend_changed" -eq 0 && "$frontend_changed" -eq 0 ]]; then
    echo -e "  ${C_YELLOW}No relevant changes detected — skipping publish.${C_RESET}"
    STEP_STATUSES["$step_name"]="SKIP"
    STEP_EXIT_CODES["$step_name"]=0
    local end_ms; end_ms=$(now_ms)
    STEP_DURATIONS["$step_name"]="$(( end_ms - STEP_STARTS["$step_name"] ))ms"
    echo -e "  ${C_YELLOW}Status: SKIP | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
    return 0
  fi

  # --- Build & Push Docker Images ---
  # Maps to: publish-backend / publish-frontend jobs in ci.yml

  if [[ -n "$DOCKER_CMD" ]]; then
    echo -e "  ${C_BOLD}Running custom docker command...${C_RESET}"
    if ! run_step "${step_name}_custom" bash -c "$DOCKER_CMD"; then
      overall_exit=1
    fi
  elif [[ "$DRY_RUN" == "1" ]]; then
    # Dry-run: just show what would be built
    if [[ "$backend_changed" -eq 1 && ("$TARGET" == "backend" || "$TARGET" == "all") ]]; then
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET} Would build+push: ghcr.io/<owner>/catalyst-backend"
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET}   Dockerfile: catalyst-backend/Dockerfile"
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET}   Tags: sha-<short>, branch, latest (if main), semver (if tag)"
    fi
    if [[ "$frontend_changed" -eq 1 && ("$TARGET" == "frontend" || "$TARGET" == "all") ]]; then
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET} Would build+push: ghcr.io/<owner>/catalyst-frontend"
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET}   Dockerfile: catalyst-frontend/Dockerfile"
      echo -e "  ${C_YELLOW}[DRY-RUN]${C_RESET}   Tags: sha-<short>, branch, latest (if main), semver (if tag)"
    fi
  else
    # Real run — attempt local docker build (no push without GHCR credentials)
    # This is a limited approximation: GHA uses Blacksmith builder + GHCR push.
    # Locally we just verify the Dockerfile builds.

    if [[ "$HAS_DOCKER" -eq 0 ]]; then
      echo -e "  ${C_YELLOW}Docker/Podman not found — mocking build verification.${C_RESET}"
      echo -e "  ${C_YELLOW}In GHA this step builds and pushes to GHCR.${C_RESET}"
    fi

    if [[ "$backend_changed" -eq 1 && ("$TARGET" == "backend" || "$TARGET" == "all") ]]; then
      if [[ "$HAS_DOCKER" -eq 1 && -f "catalyst-backend/Dockerfile" ]]; then
        echo -e "  ${C_BOLD}[docker] Building backend image (no push)...${C_RESET}"
        local runtime="docker"
        command -v podman &>/dev/null && runtime="podman"
        if ! run_step "${step_name}_backend" $runtime build -f catalyst-backend/Dockerfile -t catalyst-backend:local .; then
          overall_exit=1
        fi
      else
        echo -e "  ${C_YELLOW}[backend] Skipped — no Dockerfile or docker runtime${C_RESET}"
        echo -e "  ${C_YELLOW}  In GHA: useblacksmith/build-push-action pushes to ghcr.io/<owner>/catalyst-backend${C_RESET}"
      fi
    fi

    if [[ "$frontend_changed" -eq 1 && ("$TARGET" == "frontend" || "$TARGET" == "all") && "$overall_exit" -eq 0 ]]; then
      if [[ "$HAS_DOCKER" -eq 1 && -f "catalyst-frontend/Dockerfile" ]]; then
        echo -e "  ${C_BOLD}[docker] Building frontend image (no push)...${C_RESET}"
        local runtime="docker"
        command -v podman &>/dev/null && runtime="podman"
        if ! run_step "${step_name}_frontend" $runtime build -f catalyst-frontend/Dockerfile -t catalyst-frontend:local .; then
          overall_exit=1
        fi
      else
        echo -e "  ${C_YELLOW}[frontend] Skipped — no Dockerfile or docker runtime${C_RESET}"
        echo -e "  ${C_YELLOW}  In GHA: useblacksmith/build-push-action pushes to ghcr.io/<owner>/catalyst-frontend${C_RESET}"
      fi
    fi
  fi

  # Aggregate
  local end_ms; end_ms=$(now_ms)
  local delta_ms=$(( end_ms - STEP_STARTS["$step_name"] ))
  STEP_DURATIONS["$step_name"]="$(( delta_ms / 1000 )).$(( (delta_ms % 1000) / 100 ))s"

  if [[ "$overall_exit" -eq 0 ]]; then
    STEP_STATUSES["$step_name"]="PASS"
    STEP_EXIT_CODES["$step_name"]=0
    echo -e "  ${C_GREEN}Overall: PASS | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  else
    STEP_STATUSES["$step_name"]="FAIL"
    STEP_EXIT_CODES["$step_name"]="$overall_exit"
    echo -e "  ${C_RED}Overall: FAIL | Duration: ${STEP_DURATIONS[$step_name]}${C_RESET}"
  fi

  return "$overall_exit"
}

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  DOCKER MODE                                                                 ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# Run the entire pipeline inside a Docker container that approximates ubuntu-latest
# Maps to: runs-on: ubuntu-latest + container: oven/bun:1.3-debian in GHA

run_in_docker() {
  # Choose container runtime — prefer docker, fall back to podman
  local runtime
  if command -v docker &>/dev/null; then
    runtime="docker"
  elif command -v podman &>/dev/null; then
    runtime="podman"
  else
    echo -e "${C_RED}ERROR: USE_DOCKER=1 but neither docker nor podman found.${C_RESET}"
    exit 1
  fi

  # Build a Dockerfile that approximates ubuntu-latest with bun + cargo
  # Maps to: the container: and runs-on: directives in GHA
  local dockerfile_dir; dockerfile_dir=$(mktemp -d)
  cat > "${dockerfile_dir}/Dockerfile" <<'DOCKERFILE'
# Emulates ubuntu-latest runner with Bun + Cargo
# Maps to: runs-on: ubuntu-latest + container: in GHA
FROM oven/bun:1.3-debian

# Install build essentials and Rust (approximates ubuntu-latest + rust toolchain)
# Maps to: dtolnay/rust-toolchain@stable action
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libssl-dev curl git ca-certificates \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

WORKDIR /workspace
DOCKERFILE

  local image_tag="catalyst-ci-local:latest"

  echo -e "${C_CYAN}${C_BOLD}Building Docker image: ${image_tag}...${C_RESET}"
  echo -e "  (This is slow on first run; subsequent runs use the cache.)"
  $runtime build -t "$image_tag" "${dockerfile_dir}"

  echo -e "${C_CYAN}${C_BOLD}Running pipeline in container...${C_RESET}"

  # Pass through all config env vars and mount the repo
  # Maps to: GHA's workspace mount + env: passthrough
  $runtime run --rm \
    -e EVENT="${EVENT}" \
    -e DRY_RUN="${DRY_RUN}" \
    -e FAIL_FAST="${FAIL_FAST}" \
    -e TARGET="${TARGET}" \
    -e USE_DOCKER=0 \
    -e INSTALL_CMD="${INSTALL_CMD}" \
    -e LINT_CMD="${LINT_CMD}" \
    -e TEST_CMD="${TEST_CMD}" \
    -e RELEASE_CMD="${RELEASE_CMD}" \
    -e DOCKER_CMD="${DOCKER_CMD}" \
    -v "$(pwd):/workspace:Z" \
    -w /workspace \
    "$image_tag" \
    bash /workspace/run-workflow.sh

  local exit_code=$?
  rm -rf "${dockerfile_dir}"
  exit "$exit_code"
}

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  SUMMARY TABLE                                                               ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

print_summary() {
  echo ""
  echo -e "${C_CYAN}${C_BOLD}══════════════════════════════════════════════════════════════════════${C_RESET}"
  echo -e "${C_CYAN}${C_BOLD}  CI/CD SUMMARY${C_RESET}"
  echo -e "${C_CYAN}${C_BOLD}══════════════════════════════════════════════════════════════════════${C_RESET}"
  echo -e "${C_BOLD}  Event: ${EVENT}  |  Target: ${TARGET}  |  Dry-run: ${DRY_RUN}${C_RESET}"
  echo ""
  echo -e "  ${C_BOLD}$(printf '%-40s' 'Step')  $(printf '%-10s' 'Status')  $(printf '%-10s' 'Exit')  Duration${C_RESET}"
  echo -e "  $(printf '%-.40s' "$(printf '%0.s─' {1..40})")  $(printf '%-.10s' "$(printf '%0.s─' {1..10})")  $(printf '%-.10s' "$(printf '%0.s─' {1..10})")  $(printf '%-.12s' "$(printf '%0.s─' {1..12})")"

  local any_fail=0
  for entry in "${STEPS[@]}"; do
    local fn="${entry%%:*}"
    local display="${entry##*:}"
    local status="${STEP_STATUSES[$fn]:-???}"
    local exit_code="${STEP_EXIT_CODES[$fn]:--}"
    local duration="${STEP_DURATIONS[$fn]:--}"

    local color="$C_RESET"
    case "$status" in
      PASS)   color="$C_GREEN" ;;
      FAIL)   color="$C_RED"; any_fail=1 ;;
      SKIP)   color="$C_YELLOW" ;;
      SKIPPED) color="$C_YELLOW"; status="SKIP" ;;
    esac

    echo -e "  $(printf '%-40s' "$display")  ${color}$(printf '%-10s' "$status")${C_RESET}  $(printf '%-10s' "$exit_code")  ${duration}"
  done

  echo -e "  $(printf '%-.40s' "$(printf '%0.s─' {1..40})")  $(printf '%-.10s' "$(printf '%0.s─' {1..10})")  $(printf '%-.10s' "$(printf '%0.s─' {1..10})")  $(printf '%-.12s' "$(printf '%0.s─' {1..12})")"
  echo ""

  if [[ "$any_fail" -eq 1 ]]; then
    echo -e "  ${C_RED}${C_BOLD}RESULT: FAILURE — one or more steps failed${C_RESET}"
  else
    echo -e "  ${C_GREEN}${C_BOLD}RESULT: SUCCESS — all steps passed${C_RESET}"
  fi

  echo -e "${C_CYAN}${C_BOLD}══════════════════════════════════════════════════════════════════════${C_RESET}"
  echo ""
}

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  MAIN ORCHESTRATOR                                                           ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

main() {
  # --- Validate EVENT ---
  # Maps to: on: [push, pull_request] — only these two triggers are emulated
  case "$EVENT" in
    push|pull_request) ;;
    *)
      echo -e "${C_RED}ERROR: EVENT must be 'push' or 'pull_request', got '${EVENT}'${C_RESET}"
      echo -e "  Usage: EVENT=push ./run-workflow.sh"
      exit 1
      ;;
  esac

  # --- Docker delegation ---
  # If USE_DOCKER=1, build an ubuntu-latest-like container and re-invoke
  # Maps to: runs-on: ubuntu-latest in GHA
  if [[ "$USE_DOCKER" == "1" ]]; then
    run_in_docker
    return $?
  fi

  # --- Register steps based on EVENT ---
  register_steps

  # --- Print banner ---
  echo -e "${C_CYAN}${C_BOLD}"
  echo "  ╔═══════════════════════════════════════════════════════════════╗"
  echo "  ║  Catalyst CI/CD — Local GitHub Actions Emulator              ║"
  echo "  ║  Event: ${EVENT}                                           "
  echo "  ║  Target: ${TARGET}                                          "
  echo "  ╚═══════════════════════════════════════════════════════════════╝"
  echo -e "${C_RESET}"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo -e "${C_YELLOW}  ⚠  DRY-RUN MODE — no commands will execute${C_RESET}"
    echo ""
  fi

  # --- Execute steps sequentially ---
  # Maps to: GHA runs steps in order within a job; fail-fast = set -e behavior
  local pipeline_exit=0
  for entry in "${STEPS[@]}"; do
    local fn="${entry%%:*}"
    local display="${entry##*:}"

    # Call the step function
    # Each step manages its own isolation — a failure sets status but
    # we decide here whether to continue based on FAIL_FAST
    if ! "step_${fn}"; then
      pipeline_exit=1
      if [[ "$FAIL_FAST" == "1" ]]; then
        echo -e "\n${C_RED}${C_BOLD}FAIL-FAST: Stopping pipeline on first failure${C_RESET}"
        echo -e "${C_RED}  Failed step: ${display}${C_RESET}"
        # Mark remaining steps as skipped
        local found_fail=0
        for later in "${STEPS[@]}"; do
          local later_fn="${later%%:*}"
          if [[ "$found_fail" -eq 1 ]]; then
            STEP_STATUSES["$later_fn"]="SKIP"
            STEP_EXIT_CODES["$later_fn"]="-"
            STEP_DURATIONS["$later_fn"]="-"
          fi
          [[ "$later_fn" == "$fn" ]] && found_fail=1
        done
        break
      fi
    fi
  done

  # --- Print summary ---
  print_summary

  exit "$pipeline_exit"
}

main "$@"
