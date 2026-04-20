#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Catalyst — Docker Install Script
#
# Downloads the catalyst-docker folder from GitHub and starts the stack.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh | bash
#
# Or download and inspect first:
#   curl -fsSL https://raw.githubusercontent.com/catalystctl/catalyst/main/install.sh -o install.sh
#   less install.sh
#   bash install.sh
# =============================================================================

REPO="catalystctl/catalyst"
BRANCH="main"
TARGET_DIR="catalyst-docker"

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── 1. Check Docker ───────────────────────────────────────────────────────────
info "Checking for Docker..."

if command -v docker &>/dev/null; then
    DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || docker -v | grep -oP '(?<=version )[^,]+')
    ok "Docker found (version ${DOCKER_VERSION})"

    # Make sure the daemon is reachable
    if ! docker info &>/dev/null; then
        error "Docker daemon is not running. Please start it:"
        echo -e "  ${BOLD}sudo systemctl start docker${NC}"
        exit 1
    fi
else
    error "Docker is not installed on this system."
    echo ""
    echo -e "${BOLD}Please install Docker before continuing:${NC}"
    echo ""
    echo -e "  ${CYAN}Linux (Ubuntu/Debian):${NC}   https://docs.docker.com/engine/install/ubuntu/"
    echo -e "  ${CYAN}Linux (CentOS/RHEL):${NC}    https://docs.docker.com/engine/install/centos/"
    echo ""
    echo "After installing Docker, re-run this script."
    exit 1
fi

# ── 2. Check Docker Compose ──────────────────────────────────────────────────
info "Checking for Docker Compose..."

if docker compose version &>/dev/null; then
    COMPOSE_VERSION=$(docker compose version --short 2>/dev/null)
    ok "Docker Compose found (version ${COMPOSE_VERSION})"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_VERSION=$(docker-compose --version | grep -oP '(?<=version )[^,]+')
    warn "Found standalone docker-compose (v${COMPOSE_VERSION}). Docker Compose V2 (plugin) is recommended."
else
    error "Docker Compose is not available."
    echo -e "  Install it: ${BOLD}https://docs.docker.com/compose/install/${NC}"
    exit 1
fi

# ── 3. Check for required tools ──────────────────────────────────────────────
for cmd in curl tar; do
    if ! command -v "$cmd" &>/dev/null; then
        error "'$cmd' is required but not found. Please install it and re-run."
        exit 1
    fi
done

# ── 4. Download catalyst-docker ──────────────────────────────────────────────
info "Downloading ${TARGET_DIR} from ${REPO} (${BRANCH})..."

ARCHIVE_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"

# Create a temporary directory for extraction
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

if ! curl -fsSL "$ARCHIVE_URL" -o "${TMPDIR}/catalyst.tar.gz"; then
    error "Failed to download from GitHub. Check your internet connection and try again."
    exit 1
fi

ok "Download complete. Extracting..."

tar -xzf "${TMPDIR}/catalyst.tar.gz" -C "$TMPDIR" --strip-components=1 "${REPO#*/}-${BRANCH}/${TARGET_DIR}/" 2>/dev/null

if [[ ! -d "${TMPDIR}/${TARGET_DIR}" ]]; then
    error "Extraction failed — the '${TARGET_DIR}' folder was not found in the archive."
    exit 1
fi

# Move into place — avoid overwriting an existing .env
DEST="${PWD}/${TARGET_DIR}"
if [[ -d "$DEST" ]]; then
    warn "'${TARGET_DIR}' already exists in ${PWD}."
    if [[ -f "${DEST}/.env" ]]; then
        # Preserve existing .env
        cp "${TMPDIR}/${TARGET_DIR}/"* "$DEST/" 2>/dev/null || true
        cp -r "${TMPDIR}/${TARGET_DIR}/nginx" "$DEST/nginx" 2>/dev/null || true
        ok "Updated files (kept your existing .env)."
    else
        cp -r "${TMPDIR}/${TARGET_DIR}/." "$DEST/"
        ok "Updated '${TARGET_DIR}' in ${PWD}."
    fi
else
    mv "${TMPDIR}/${TARGET_DIR}" "$DEST"
    ok "Created '${TARGET_DIR}' in ${PWD}."
fi

# ── 5. Configure .env ────────────────────────────────────────────────────────
if [[ -f "${DEST}/.env" ]]; then
    warn ".env already exists — skipping configuration."
    info "Make sure these values are set in ${DEST}/.env:"
else
    cp "${DEST}/.env.example" "${DEST}/.env"
    ok "Created .env from .env.example"

    # Generate a strong Postgres password and auth secret
    NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
    NEW_AUTH_SECRET=$(openssl rand -base64 32)

    # Patch .env with generated secrets
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASS}|" "${DEST}/.env"
    sed -i "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${NEW_AUTH_SECRET}|" "${DEST}/.env"

    ok "Generated secure POSTGRES_PASSWORD and BETTER_AUTH_SECRET."
fi

echo ""
echo -e "${BOLD}Required settings in ${DEST}/.env:${NC}"
echo -e "  ${CYAN}PUBLIC_URL${NC}         — The URL users will access the panel from"
echo -e "  ${CYAN}POSTGRES_PASSWORD${NC}  — Database password"
echo -e "  ${CYAN}BETTER_AUTH_SECRET${NC} — Auth secret"
echo ""
echo -e "${BOLD}Optional — if exposing on your LAN, also update:${NC}"
echo -e "  ${CYAN}PASSKEY_RP_ID${NC}      — Set to your LAN IP or hostname"
echo -e "  ${CYAN}FRONTEND_PORT${NC}      — e.g. 0.0.0.0:8080"
echo -e "  ${CYAN}BACKEND_PORT${NC}       — e.g. 0.0.0.0:3000"
echo -e "  ${CYAN}SFTP_PORT${NC}          — e.g. 0.0.0.0:2022"
echo ""

# ── 6. Summary & next steps ──────────────────────────────────────────────────
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Catalyst Docker setup is ready!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""
echo -e "  1. Edit your configuration:"
echo -e "     ${CYAN}nano ${DEST}/.env${NC}"
echo ""
echo -e "  2. Start the stack:"
echo -e "     ${CYAN}cd ${DEST} && docker compose up -d${NC}"
echo ""
echo -e "  3. Check container status:"
echo -e "     ${CYAN}docker ps${NC}"
echo ""
echo -e "  4. (Optional) Seed the database with a default admin:"
echo -e "     ${CYAN}docker exec -e NODE_ENV=development catalyst-backend bun run db:seed${NC}"
echo ""
echo -e "  5. Open your browser to the PUBLIC_URL you set in .env"
echo ""
echo -e "  ${YELLOW}Tip:${NC} If this is your first time, the first registered user becomes admin."
echo ""
