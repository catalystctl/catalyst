#!/usr/bin/env bash
# Docker port-wiring regression tests.
#
# The backend's container-internal port must stay consistent across the compose
# services that set/forward it, the backend healthcheck, and both nginx configs
# that render the upstream. Drift between them is what produced GitHub issue
# #250: nginx proxying to :3000 while the backend listened elsewhere, i.e. 502
# on every proxied /api/ request.
#
# Offline-safe: reads and renders config files only; no containers required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE="$REPO_ROOT/catalyst-docker/docker-compose.yml"
COMPOSE_TEST="$REPO_ROOT/catalyst-docker/docker-compose.test.yml"
ENV_EXAMPLE="$REPO_ROOT/catalyst-docker/.env.example"
NGINX_IMAGE="$REPO_ROOT/catalyst-frontend/nginx.conf"
NGINX_COMPOSE="$REPO_ROOT/catalyst-docker/nginx/default.conf.template"
FE_DOCKERFILE="$REPO_ROOT/catalyst-frontend/Dockerfile"
BE_DOCKERFILE="$REPO_ROOT/catalyst-backend/Dockerfile"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  PASS: $*"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $*" >&2; }

expect() { # expect <file> <fixed-string> <description>
    if grep -qF -- "$2" "$1"; then
        pass "$3"
    else
        fail "$3"
    fi
}

expect_absent() { # expect_absent <file> <pattern> <description>
    if grep -qE -- "$2" "$1"; then
        fail "$3"
    else
        pass "$3"
    fi
}

# --- shellcheck -------------------------------------------------------------
if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck -S warning "$0" "$REPO_ROOT/catalyst-docker/diagnose.sh" >/dev/null 2>&1; then
        pass "shellcheck clean (this test, diagnose.sh)"
    else
        fail "shellcheck reported warnings"
    fi
else
    echo "  SKIP: shellcheck not installed"
fi

# --- nginx configs: every upstream is templated -----------------------------
for cfg in "$NGINX_IMAGE" "$NGINX_COMPOSE"; do
    name="${cfg#"$REPO_ROOT"/}"
    if grep -qF 'http://backend:3000' "$cfg"; then
        fail "$name hardcodes http://backend:3000"
    else
        pass "$name has no hardcoded backend port"
    fi
    proxies=$(grep -cF 'proxy_pass' "$cfg" || true)
    templated=$(grep -cF 'proxy_pass http://backend:${BACKEND_UPSTREAM_PORT};' "$cfg" || true)
    if [ "$proxies" -gt 0 ] && [ "$proxies" -eq "$templated" ]; then
        pass "$name: $templated/$proxies proxy_pass targets templated"
    else
        fail "$name: only $templated/$proxies proxy_pass targets templated"
    fi
    expect "$cfg" 'listen ${PORT};' "$name: nginx listen port templated"
done

# --- rendered config is fully substituted -----------------------------------
# Mirrors the nginx image entrypoint: envsubst with a SHELL-FORMAT listing the
# vars it knows about. envsubst has no ${VAR:-default} support, so a reference
# whose variable is undefined stays literal and nginx refuses to start — hence
# the residual check below, which ignores comments.
if command -v envsubst >/dev/null 2>&1; then
    for cfg in "$NGINX_IMAGE" "$NGINX_COMPOSE"; do
        name="${cfg#"$REPO_ROOT"/}"
        rendered="$(PORT=8080 BACKEND_UPSTREAM_PORT=3001 envsubst '${PORT} ${BACKEND_UPSTREAM_PORT}' < "$cfg")"
        uncommented="$(grep -v '^[[:space:]]*#' <<< "$rendered" || true)"
        if grep -qF '${' <<< "$uncommented"; then
            fail "$name: unsubstituted \${...} left in rendered config"
        else
            pass "$name: renders with no unsubstituted \${...}"
        fi
        if grep -qF 'listen 8080;' <<< "$rendered"; then
            pass "$name: PORT renders into the listen directive"
        else
            fail "$name: listen directive not rendered from PORT"
        fi
        rendered_upstreams=$(grep -cF 'proxy_pass http://backend:3001;' <<< "$rendered" || true)
        expected_upstreams=$(grep -cF 'proxy_pass' <<< "$rendered" || true)
        if [ "$expected_upstreams" -gt 0 ] && [ "$rendered_upstreams" -eq "$expected_upstreams" ]; then
            pass "$name: BACKEND_UPSTREAM_PORT renders into every upstream"
        else
            fail "$name: only $rendered_upstreams/$expected_upstreams upstreams rendered"
        fi
    done
else
    echo "  SKIP: envsubst not installed"
fi

# --- compose wiring ---------------------------------------------------------
expect "$COMPOSE" 'PORT: ${BACKEND_INTERNAL_PORT:-3000}' "base compose: backend PORT follows BACKEND_INTERNAL_PORT"
expect "$COMPOSE" '${BACKEND_PORT:-127.0.0.1:3000}:${BACKEND_INTERNAL_PORT:-3000}' "base compose: published mapping follows BACKEND_INTERNAL_PORT"
expect "$COMPOSE" 'curl -sf http://localhost:$${PORT:-3000}/health' "base compose: healthcheck follows the backend's own PORT"
expect "$COMPOSE" 'BACKEND_UPSTREAM_PORT: ${BACKEND_INTERNAL_PORT:-3000}' "base compose: frontend receives the upstream port"
expect_absent "$COMPOSE" '^[[:space:]]+BACKEND_UPSTREAM_PORT:[[:space:]]*\$\{BACKEND_UPSTREAM_PORT' "base compose: upstream entry is not self-referencing"

expect "$COMPOSE_TEST" 'PORT: ${BACKEND_INTERNAL_PORT:-3000}' "test compose: backend PORT follows BACKEND_INTERNAL_PORT"
expect "$COMPOSE_TEST" ':${BACKEND_INTERNAL_PORT:-3000}"' "test compose: published mapping follows BACKEND_INTERNAL_PORT"
expect "$COMPOSE_TEST" 'curl -sf http://localhost:$${PORT:-3000}/health' "test compose: healthcheck follows the backend's own PORT"
expect "$COMPOSE_TEST" 'BACKEND_UPSTREAM_PORT: ${BACKEND_INTERNAL_PORT:-3000}' "test compose: frontend receives the upstream port"
expect_absent "$COMPOSE_TEST" '^[[:space:]]+BACKEND_UPSTREAM_PORT:[[:space:]]*\$\{BACKEND_UPSTREAM_PORT' "test compose: upstream entry is not self-referencing"

# --- image defaults keep standalone `docker run` working --------------------
expect "$FE_DOCKERFILE" 'ENV BACKEND_UPSTREAM_PORT=3000' "frontend image sets an upstream default"
expect "$FE_DOCKERFILE" 'ENV PORT=80' "frontend image sets a listen-port default"
expect "$BE_DOCKERFILE" 'ENV PORT=3000' "backend image sets a listen-port default"

# --- defaults agree across files --------------------------------------------
compose_default="$(grep -m1 -oE '\$\{BACKEND_INTERNAL_PORT:-[0-9]+\}' "$COMPOSE" | sed -E 's/.*:-([0-9]+)\}$/\1/' || true)"
image_default="$(grep -oE '^ENV BACKEND_UPSTREAM_PORT=[0-9]+' "$FE_DOCKERFILE" | head -1 | cut -d= -f2 || true)"
env_default="$(grep -E '^BACKEND_INTERNAL_PORT=' "$ENV_EXAMPLE" | head -1 | cut -d= -f2 || true)"
if [ -n "$compose_default" ] && [ "$compose_default" = "$image_default" ] && [ "$compose_default" = "$env_default" ]; then
    pass "default backend internal port agrees (compose/image/.env.example = $compose_default)"
else
    fail "backend internal port default drift (compose=${compose_default:-<none>} image=${image_default:-<none>} .env.example=${env_default:-<none>})"
fi

echo ""
echo "docker port wiring: $PASS passed, $FAIL failed"
exit "$FAIL"
