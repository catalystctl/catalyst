#!/usr/bin/env bash
# =============================================================================
# Catalyst — catalyst-docker updater
#
# Brings the local compose stack files up to date with the upstream repo:
#   - Downloads the latest catalyst-docker/ tree (same source as install.sh)
#   - Backs up the current directory before touching anything
#   - Replaces stack files (compose, nginx, caddy, traefik, diagnose.sh, ...)
#   - Preserves .env and docker-compose.override.yml untouched
#   - Appends new .env variables from .env.example (existing values kept)
#   - Applies known file renames (e.g. nginx/default.conf → .template)
#
# Images are NOT updated here — run `docker compose pull && docker compose up -d`
# afterwards (this script prints the exact command).
#
# Usage:
#   bash update.sh                              # update from the default branch
#   bash update.sh --dry-run                    # show what would change
#   bash update.sh --branch develop             # update from another branch
#   bash update.sh --from /path/to/repo         # update from a local tree
#   bash update.sh --compose-dir ~/catalyst-docker  # target another install
#   bash update.sh --restore BACKUP_DIR         # restore a previous backup
#
# Exit codes: 0 ok, 1 failure, 130 interrupted.
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
REPO="catalystctl/catalyst"
BRANCH="main"
TARGET_DIR="catalyst-docker"

# Old path → new path. Applied after the update: if the old file still exists
# (install predates the rename) it is removed and the fact is reported.
RENAMES=(
    "nginx/default.conf|nginx/default.conf.template"
)

# Files that are never overwritten (user configuration).
PRESERVE=(
    ".env"
    "docker-compose.override.yml"
)

# ── UI helpers (match install.sh style) ──────────────────────────────────────
if [[ -t 1 ]]; then
    BLD=$'\e[1m'; DIM=$'\e[2m'; GRN=$'\e[32m'; YLW=$'\e[33m'; CYN=$'\e[36m'; RED=$'\e[31m'; RST=$'\e[0m'
else
    BLD=""; DIM=""; GRN=""; YLW=""; CYN=""; RED=""; RST=""
fi
step() { echo -e "\n${CYN}▸ $*${RST}"; }
ok()   { echo -e "  ${GRN}✓${RST} $*"; }
warn() { echo -e "  ${YLW}⚠${RST} $*"; }
err()  { echo -e "  ${RED}✗${RST} $*" >&2; }

usage() {
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

# ── Args ─────────────────────────────────────────────────────────────────────
MODE="update"
FROM_DIR=""
DRY_RUN=false
RESTORE_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)     usage ;;
        --dry-run)     DRY_RUN=true; shift ;;
        --from)        FROM_DIR="${2:?--from needs a directory}"; shift 2 ;;
        --branch)      BRANCH="${2:?--branch needs a value}"; shift 2 ;;
        --compose-dir) UPDATE_COMPOSE_DIR="${2:?--compose-dir needs a directory}"; shift 2 ;;
        --restore)     MODE="restore"; RESTORE_DIR="${2:?--restore needs a backup directory}"; shift 2 ;;
        *)             err "Unknown option: $1"; usage ;;
    esac
done

# Target directory: --compose-dir flag > UPDATE_COMPOSE_DIR env > the script's
# own directory (the normal case — update.sh is deployed inside catalyst-docker/).
# --compose-dir matches diagnose.sh's convention for remote/old installs.
COMPOSE_DIR="${UPDATE_COMPOSE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$COMPOSE_DIR"

# ── Restore mode: copy a backup back over the live directory ─────────────────
if [[ "$MODE" == "restore" ]]; then
    if [[ ! -d "$RESTORE_DIR" ]]; then
        err "Backup directory not found: $RESTORE_DIR"
        exit 1
    fi
    step "Restoring from $RESTORE_DIR"
    if $DRY_RUN; then
        diff -rq "$RESTORE_DIR" . 2>/dev/null | head -30 || true
        ok "Dry run — nothing changed"
        exit 0
    fi
    # Copy everything back, including .env and override files. Restore
    # overlays the backup (files added after the backup stay on disk; they
    # are inert unless the restored configs reference them).
    cp -a "$RESTORE_DIR/." "$COMPOSE_DIR/"
    ok "Restored. Review changes, then: docker compose up -d"
    exit 0
fi

# ── Update mode ───────────────────────────────────────────────────────────────
step "Catalyst stack updater ($COMPOSE_DIR)"

# Dependencies
for cmd in curl tar diff; do
    command -v "$cmd" &>/dev/null || { err "$cmd is required but not installed"; exit 1; }
done

WORK_DIR="$(mktemp -d /tmp/catalyst-update.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ── Get the new tree (GitHub tarball or local --from directory) ──────────────
if [[ -n "$FROM_DIR" ]]; then
    step "Using local tree: $FROM_DIR"
    if [[ -d "$FROM_DIR/$TARGET_DIR" ]]; then
        NEW_TREE="$FROM_DIR/$TARGET_DIR"
    elif [[ -f "$FROM_DIR/docker-compose.yml" ]]; then
        NEW_TREE="$FROM_DIR"
    else
        err "No $TARGET_DIR tree found under $FROM_DIR"
        exit 1
    fi
    cp -a "$NEW_TREE" "$WORK_DIR/new"
    ok "Loaded"
else
    step "Fetching latest stack files from ${REPO} (${BRANCH})"
    ARCHIVE_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
    if ! curl -fsSL --max-time 120 "$ARCHIVE_URL" -o "$WORK_DIR/src.tar.gz"; then
        err "Download failed — check your internet connection"
        exit 1
    fi
    ok "Downloaded"
    # Strip the top-level "catalyst-<branch>/" path component; keep only catalyst-docker/
    tar -xzf "$WORK_DIR/src.tar.gz" -C "$WORK_DIR" --strip-components=1 \
        "${REPO#*/}-${BRANCH}/${TARGET_DIR}/"
    [[ -d "$WORK_DIR/$TARGET_DIR" ]] || { err "Extraction failed — $TARGET_DIR not in archive"; exit 1; }
    mv "$WORK_DIR/$TARGET_DIR" "$WORK_DIR/new"
    ok "Extracted"

    UPSTREAM_REV="$(curl -fsSL --max-time 10 "https://api.github.com/repos/${REPO}/commits/${BRANCH}" 2>/dev/null \
        | grep -m1 '"sha"' | cut -d'"' -f4 | cut -c1-7 || true)"
    [[ -n "$UPSTREAM_REV" ]] && ok "Upstream revision: ${UPSTREAM_REV}" || true
fi

# ── Compute the change list (new tree vs current, excluding preserved files) ─
step "Checking for changes"
CHANGES="$(diff -rq --no-dereference "$WORK_DIR/new" . 2>/dev/null || true)"
NEW_PREFIX="$WORK_DIR/new"

is_preserved() {
    local p="$1" entry
    for entry in "${PRESERVE[@]}"; do [[ "$p" == "$entry" ]] && return 0; done
    return 1
}

CHANGED_LIST=()
ADDED_LIST=()
REMOVED_LIST=()
while IFS= read -r LINE; do
    [[ -z "$LINE" ]] && continue
    case "$LINE" in
        "Files "*)
            # "Files NEWPATH and ./LOCALPATH differ"
            LOCAL="${LINE##* and }"      # "./docker-compose.yml differ"
            LOCAL="${LOCAL% differ}"     # "./docker-compose.yml"
            LOCAL="${LOCAL#./}"          # "docker-compose.yml"
            is_preserved "$LOCAL" || CHANGED_LIST+=("$LOCAL")
            ;;
        "Only in "*)
            # "Only in DIR: NAME" — DIR is on the new side or the local side
            BODY="${LINE#Only in }"
            DIR="${BODY%%: *}"
            NAME="${BODY#*: }"
            if [[ "$DIR" == "$NEW_PREFIX" || "$DIR" == "$NEW_PREFIX"/* ]]; then
                REL="${DIR#"$NEW_PREFIX"}"; REL="${REL#/}"
                P="${REL:+$REL/}$NAME"
                is_preserved "$P" || ADDED_LIST+=("$P")
            else
                LOCAL="${DIR#./}"
                P="${LOCAL:+$LOCAL/}$NAME"
                is_preserved "$P" || REMOVED_LIST+=("$P")
            fi
            ;;
    esac
done <<< "$CHANGES"

if [[ ${#CHANGED_LIST[@]} -eq 0 && ${#ADDED_LIST[@]} -eq 0 && ${#REMOVED_LIST[@]} -eq 0 ]]; then
    ok "Already up to date — nothing to do"
    exit 0
fi

if [[ ${#CHANGED_LIST[@]} -gt 0 ]]; then
    echo -e "  ${DIM}Changed:${RST}"
    printf '    %s\n' "${CHANGED_LIST[@]}"
fi
if [[ ${#ADDED_LIST[@]} -gt 0 ]]; then
    echo -e "  ${DIM}New files:${RST}"
    printf '    %s\n' "${ADDED_LIST[@]}"
fi
if [[ ${#REMOVED_LIST[@]} -gt 0 ]]; then
    echo -e "  ${DIM}No longer upstream (kept on disk):${RST}"
    printf '    %s\n' "${REMOVED_LIST[@]}"
fi
echo -e "  ${DIM}Never touched: ${PRESERVE[*]}${RST}"

if $DRY_RUN; then
    ok "Dry run — nothing was changed"
    exit 0
fi

# ── Backup the current directory ─────────────────────────────────────────────
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${COMPOSE_DIR}/../catalyst-docker-backup-${TS}"
step "Backing up current files"
mkdir -p "$BACKUP_DIR"
cp -a "$COMPOSE_DIR/." "$BACKUP_DIR/"
# .env holds secrets — never leave the backup copy more permissive than the original
chmod --reference="$COMPOSE_DIR/.env" "$BACKUP_DIR/.env" 2>/dev/null || chmod 600 "$BACKUP_DIR/.env" 2>/dev/null || true
ok "$BACKUP_DIR"

# ── Apply: copy new files over, skipping preserved ones ──────────────────────
step "Updating files"
while IFS= read -r SRC; do
    REL="${SRC#"$WORK_DIR/new"/}"
    [[ -z "$REL" ]] && continue
    is_preserved "$REL" && continue
    mkdir -p "$COMPOSE_DIR/$(dirname "$REL")"
    cp -a "$SRC" "$COMPOSE_DIR/$REL"
done < <(find "$WORK_DIR/new" -mindepth 1 -type f)
ok "Stack files updated"

# ── Known renames: remove stale old-named files ──────────────────────────────
for R in "${RENAMES[@]}"; do
    OLD="${R%%|*}"; NEW="${R##*|}"
    if [[ -f "$COMPOSE_DIR/$OLD" && -f "$COMPOSE_DIR/$NEW" ]]; then
        rm -f "$COMPOSE_DIR/$OLD"
        ok "Migrated: $OLD → $NEW (old file removed; the backup retains it)"
    fi
done

# ── Merge new .env keys into the existing .env ───────────────────────────────
step "Merging .env"
NEW_ENV="$WORK_DIR/new/.env.example"
LOCAL_ENV="$COMPOSE_DIR/.env"
if [[ -f "$NEW_ENV" ]]; then
    touch "$LOCAL_ENV"
    ADDED_KEYS=()
    # Only uncommented keys are merged — commented ones in .env.example are
    # optional, and writing them empty would override compose defaults.
    while IFS= read -r KEY; do
        [[ -z "$KEY" ]] && continue
        if ! grep -qE "^${KEY}=" "$LOCAL_ENV"; then
            {
                echo ""
                echo "# Added by update.sh on $(date +%Y-%m-%d) — new upstream variable"
                grep -E "^${KEY}=" "$NEW_ENV" | head -1 || echo "${KEY}="
            } >> "$LOCAL_ENV"
            ADDED_KEYS+=("$KEY")
        fi
    done < <(grep -oE "^[A-Z_][A-Z0-9_]+" "$NEW_ENV" | sort -u)

    ORPHANS=()
    while IFS= read -r KEY; do
        [[ -z "$KEY" ]] && continue
        # Present upstream either active or as a commented optional var
        grep -qE "^#?\s*${KEY}=" "$NEW_ENV" || ORPHANS+=("$KEY")
    done < <(grep -oE "^[A-Z_][A-Z0-9_]+" "$LOCAL_ENV" | sort -u)

    if [[ ${#ADDED_KEYS[@]} -gt 0 ]]; then
        ok "Added new variables: ${ADDED_KEYS[*]}"
    else
        ok "No new variables to add"
    fi
    if [[ ${#ORPHANS[@]} -gt 0 ]]; then
        warn "Local variables no longer in .env.example (left in place): ${ORPHANS[*]}"
    fi
else
    warn "No .env.example in the new tree — skipping .env merge"
fi

# ── Validate the rendered compose config ─────────────────────────────────────
step "Validating compose config"
COMPOSE_CMD=""
if docker compose version &>/dev/null; then COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then COMPOSE_CMD="docker-compose"
elif podman compose version &>/dev/null 2>&1; then COMPOSE_CMD="podman compose"
fi
if [[ -n "$COMPOSE_CMD" ]]; then
    # `config` (no -q) works across docker compose v2, docker-compose v1, and
    # podman-compose; non-zero exit means the rendered config is invalid.
    if $COMPOSE_CMD config >/dev/null 2>&1; then
        ok "docker-compose.yml is valid"
    else
        warn "docker-compose.yml validation failed — restore with:"
        warn "  bash update.sh --restore $BACKUP_DIR"
    fi
else
    warn "No compose command found — skipped validation"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLD}Update complete.${RST} To apply (pull new images + restart):"
echo -e "  ${CYN}docker compose pull${RST}"
echo -e "  ${CYN}docker compose up -d${RST}"
echo ""
echo -e "${DIM}Backup of your previous files: $BACKUP_DIR${RST}"
echo -e "${DIM}Undo if needed: bash update.sh --restore $BACKUP_DIR${RST}"
