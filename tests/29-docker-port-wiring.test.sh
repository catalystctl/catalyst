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
# The image template resolves the backend at request time through the
# $backend_upstream variable (runtime DNS); the compose template keeps a static
# proxy_pass, which libc resolves at startup. Neither may hardcode a port.
for cfg in "$NGINX_IMAGE" "$NGINX_COMPOSE"; do
    name="${cfg#"$REPO_ROOT"/}"
    if grep -qF 'http://backend:3000' "$cfg"; then
        fail "$name hardcodes http://backend:3000"
    else
        pass "$name has no hardcoded backend port"
    fi
    expect "$cfg" 'listen ${PORT};' "$name: nginx listen port templated"
done

# Image template: resolver and upstream both come from the container's own DNS.
proxies=$(grep -cF 'proxy_pass' "$NGINX_IMAGE" || true)
via_var=$(grep -cF 'proxy_pass http://$backend_upstream;' "$NGINX_IMAGE" || true)
if [ "$proxies" -gt 0 ] && [ "$proxies" -eq "$via_var" ]; then
    pass "catalyst-frontend/nginx.conf: $via_var/$proxies proxy_pass targets use the upstream variable"
else
    fail "catalyst-frontend/nginx.conf: only $via_var/$proxies proxy_pass targets use the upstream variable"
fi
expect "$NGINX_IMAGE" 'resolver ${NGINX_LOCAL_RESOLVERS} valid=10s;' \
    "image nginx.conf: resolver comes from the container's resolv.conf"
expect "$NGINX_IMAGE" 'set $backend_upstream "${BACKEND_HOST}:${BACKEND_UPSTREAM_PORT}";' \
    "image nginx.conf: backend host is templated"
# 127.0.0.11 only answers inside a Docker user-defined network (issue #294).
expect_absent "$NGINX_IMAGE" 'resolver 127\.0\.0\.11' \
    "image nginx.conf: no hardcoded Docker DNS resolver"

# Compose template: every upstream is the templated static target.
proxies=$(grep -cF 'proxy_pass' "$NGINX_COMPOSE" || true)
templated=$(grep -cF 'proxy_pass http://backend:${BACKEND_UPSTREAM_PORT};' "$NGINX_COMPOSE" || true)
if [ "$proxies" -gt 0 ] && [ "$proxies" -eq "$templated" ]; then
    pass "catalyst-docker/nginx/default.conf.template: $templated/$proxies proxy_pass targets templated"
else
    fail "catalyst-docker/nginx/default.conf.template: only $templated/$proxies proxy_pass targets templated"
fi

# --- rendered config is fully substituted -----------------------------------
# Mirrors the nginx image entrypoint: envsubst with a SHELL-FORMAT listing the
# vars it knows about. envsubst has no ${VAR:-default} support, so a reference
# whose variable is undefined stays literal and nginx refuses to start — hence
# the residual check below, which ignores comments.
RENDER_VARS='${PORT} ${BACKEND_UPSTREAM_PORT} ${BACKEND_HOST} ${NGINX_LOCAL_RESOLVERS}'
render() { # render <template>
    PORT=8080 BACKEND_UPSTREAM_PORT=3001 BACKEND_HOST=backend.example \
        NGINX_LOCAL_RESOLVERS=10.0.0.53 envsubst "$RENDER_VARS" < "$1"
}
if command -v envsubst >/dev/null 2>&1; then
    for cfg in "$NGINX_IMAGE" "$NGINX_COMPOSE"; do
        name="${cfg#"$REPO_ROOT"/}"
        rendered="$(render "$cfg")"
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
    done

    # Image template: host, port and resolver land in the rendered directives.
    rendered="$(render "$NGINX_IMAGE")"
    if grep -qF 'set $backend_upstream "backend.example:3001";' <<< "$rendered" \
        && grep -qF 'resolver 10.0.0.53 valid=10s;' <<< "$rendered"; then
        pass "catalyst-frontend/nginx.conf: upstream host/port and resolver render"
    else
        fail "catalyst-frontend/nginx.conf: upstream host/port or resolver did not render"
    fi

    # Compose template: the upstream port lands in every proxy_pass.
    rendered="$(render "$NGINX_COMPOSE")"
    rendered_upstreams=$(grep -cF 'proxy_pass http://backend:3001;' <<< "$rendered" || true)
    expected_upstreams=$(grep -cF 'proxy_pass' <<< "$rendered" || true)
    if [ "$expected_upstreams" -gt 0 ] && [ "$rendered_upstreams" -eq "$expected_upstreams" ]; then
        pass "catalyst-docker/nginx/default.conf.template: BACKEND_UPSTREAM_PORT renders into every upstream"
    else
        fail "catalyst-docker/nginx/default.conf.template: only $rendered_upstreams/$expected_upstreams upstreams rendered"
    fi
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
expect "$FE_DOCKERFILE" 'ENV BACKEND_HOST=backend' "frontend image sets a backend host default"
expect "$FE_DOCKERFILE" 'ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1' "frontend image derives its resolver from resolv.conf"
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

# --- entrypoint: backend host + resolver wiring ----------------------------
FE_ENVSH="$REPO_ROOT/catalyst-frontend/docker-entrypoint.d/16-backend-host.envsh"
if [ -f "$FE_ENVSH" ]; then
    pass "backend-host entrypoint script exists"
else
    fail "backend-host entrypoint script missing"
fi
if [ -x "$FE_ENVSH" ]; then
    pass "backend-host entrypoint script is executable"
else
    # The nginx image only sources executable *.envsh files.
    fail "backend-host entrypoint script is not executable"
fi
expect "$FE_DOCKERFILE" 'COPY catalyst-frontend/docker-entrypoint.d/16-backend-host.envsh /docker-entrypoint.d/16-backend-host.envsh' \
    "frontend image ships the backend-host entrypoint script"
# The image must not pick a resolver address of its own: 127.0.0.11 only answers
# on a Docker user-defined network (issue #294).
expect_absent "$FE_ENVSH" '127\.0\.0\.11' \
    "backend-host entrypoint ships no hardcoded Docker DNS resolver"
if command -v shellcheck >/dev/null 2>&1; then
    if shellcheck -S warning "$FE_ENVSH" >/dev/null 2>&1; then
        pass "shellcheck clean (backend-host entrypoint)"
    else
        fail "shellcheck reported warnings in the backend-host entrypoint"
    fi
fi

# Offline unit test of the search-domain qualification: a stub getent resolves
# only the fully-qualified name, and RESOLV_CONF points at a fixture.
if [ -x "$FE_ENVSH" ]; then
    tmp="$(mktemp -d)"
    mkdir -p "$tmp/bin"
    cat > "$tmp/bin/getent" <<'STUB'
#!/bin/sh
[ "$1" = hosts ] || exit 2
[ "$2" = "backend.default.svc.cluster.local" ] && exit 0
exit 2
STUB
    chmod +x "$tmp/bin/getent"
    printf 'search default.svc.cluster.local svc.cluster.local\nnameserver 10.96.0.10\n' > "$tmp/resolv.k8s"
    printf 'nameserver 127.0.0.11\n' > "$tmp/resolv.docker"

    run_envsh() { # run_envsh <resolv_conf> <nginx_local_resolvers> <var>
        env -i PATH="$tmp/bin:$PATH" RESOLV_CONF="$1" NGINX_LOCAL_RESOLVERS="$2" \
            sh -c '. "$1"; printenv "$2"' _ "$FE_ENVSH" "$3"
    }

    got="$(run_envsh "$tmp/resolv.k8s" 10.96.0.10 BACKEND_HOST)"
    if [ "$got" = "backend.default.svc.cluster.local" ]; then
        pass "entrypoint qualifies a search-only backend name"
    else
        fail "entrypoint search-domain qualification (got '${got:-<empty>}')"
    fi

    got="$(run_envsh "$tmp/resolv.docker" 127.0.0.11 BACKEND_HOST)"
    if [ "$got" = "backend" ]; then
        pass "entrypoint keeps the short name when no search domain matches"
    else
        fail "entrypoint short-name passthrough (got '${got:-<empty>}')"
    fi

    got="$(run_envsh "$tmp/resolv.docker" "" NGINX_LOCAL_RESOLVERS)"
    if [ -z "$got" ]; then
        pass "entrypoint invents no resolver when resolv.conf has no nameserver"
    else
        fail "entrypoint invented a resolver (got '${got:-<empty>}')"
    fi
    rm -rf "$tmp"
fi

echo ""
echo "docker port wiring: $PASS passed, $FAIL failed"
exit "$FAIL"
