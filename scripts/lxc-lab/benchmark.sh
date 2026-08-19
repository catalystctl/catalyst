#!/usr/bin/env bash
# Benchmark stage for lab.sh — Catalyst vs Pterodactyl
# Delegates to scripts/benchmark/run.sh so `lab.sh benchmark` is one-command repeatable.
# Requires: state.env with AUTH_TOKEN / PTERO_* after bootstrap/ptero-seed. Tolerates missing fixtures (skips ptero suites).

# shellcheck shell=bash

stage_benchmark() {
  load_state || true
  local bench_args=("$@")
  local run_sh="$REPO_ROOT/scripts/benchmark/run.sh"

  if [[ ! -x "$run_sh" ]]; then
    chmod +x "$run_sh" 2>/dev/null || true
  fi
  if [[ ! -f "$run_sh" ]]; then
    fail "benchmark runner missing: $run_sh"
  fi

  log "Benchmark: Catalyst ${BACKEND_PUBLIC:-$API_BASE} vs Pterodactyl ${PTERO_URL:-http://10.0.3.30} (out: benchmarks/results/<ts>)"
  if [[ -z "${AUTH_TOKEN:-}" ]]; then
    warn "AUTH_TOKEN missing — run lab.sh bootstrap first or pass AUTH_TOKEN env; catalyst HTTP suites will be skipped"
  fi
  if [[ -z "${PTERO_APP_KEY:-}" ]]; then
    warn "PTERO_APP_KEY missing — run lab.sh ptero-seed first; pterodactyl suites will be skipped"
  fi
  if [[ -z "${PAPER_SERVER_ID:-}" ]]; then
    warn "PAPER_SERVER_ID missing — some suites will be skipped (run lab.sh servers)"
  fi

  # Forward args to run.sh (e.g. --duration 10 --connections 20 --only catalyst)
  bash "$run_sh" "${bench_args[@]}"
  log "Benchmark complete. See benchmarks/results/<ts>/report.md"
}

stage_benchmark_quick() {
  # 30s smoke (5s per suite) for CI sanity
  stage_benchmark --duration 5 --connections 10 "$@"
}
