#!/usr/bin/env bash
# migrate-fedora-cni.sh - Migrate CNI plugins for Fedora/RHEL compatibility
#
# Fedora and RHEL install CNI plugins to /usr/libexec/cni/ instead of /opt/cni/bin/
# This script ensures compatibility by:
# 1. Checking both locations for existing plugins
# 2. Creating symlinks if plugins exist in /usr/libexec/cni but not /opt/cni/bin
# 3. Validating the final configuration
#
# Run as root or with sudo

# Some people run scripts like this via `sh ./script.sh`, which ignores the shebang and
# breaks bash-specific options like `pipefail`. Re-exec with bash for safety.
if [ -z "${BASH_VERSION:-}" ]; then
    exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

REQUIRED_PLUGINS=(bridge host-local portmap macvlan)
OPT_CNI_DIR="/opt/cni/bin"
LIBEXEC_CNI_DIR="/usr/libexec/cni"
AUTO_YES=0

log() { printf "[migrate] %s\n" "$*"; }
error() { printf "[migrate] ERROR: %s\n" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
Usage: migrate-fedora-cni.sh [--yes]

Ensures Catalyst can find required CNI plugins on Fedora/RHEL systems where the
packaged plugins are located at /usr/libexec/cni.

Options:
  -y, --yes   Create /opt/cni/bin symlinks without prompting (non-interactive safe)
  -h, --help  Show this help
EOF
}

if [ "$EUID" -ne 0 ]; then
    SUDO=sudo
    command -v sudo >/dev/null 2>&1 || error "sudo not found; re-run as root"
else
    SUDO=""
fi

while [ "${1:-}" != "" ]; do
    case "$1" in
        -y|--yes) AUTO_YES=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) error "Unknown argument: $1 (use --help)" ;;
    esac
done

check_plugins_in_dir() {
    local dir="$1"
    local all_present=true

    if [ ! -d "$dir" ]; then
        echo "missing"
        return
    fi

    for plugin in "${REQUIRED_PLUGINS[@]}"; do
        if [ ! -x "${dir}/${plugin}" ]; then
            all_present=false
            break
        fi
    done

    if [ "$all_present" = true ]; then
        echo "present"
    else
        echo "partial"
    fi
}

create_symlinks() {
    log "Creating symlinks from $LIBEXEC_CNI_DIR to $OPT_CNI_DIR..."

    $SUDO mkdir -p "$OPT_CNI_DIR"

    for plugin in "${REQUIRED_PLUGINS[@]}"; do
        local src="${LIBEXEC_CNI_DIR}/${plugin}"
        local dest="${OPT_CNI_DIR}/${plugin}"

        if [ -x "$src" ]; then
            if [ -e "$dest" ] || [ -L "$dest" ]; then
                log "  $plugin already exists at $dest, skipping"
            else
                $SUDO ln -sf "$src" "$dest"
                log "  Created symlink: $dest -> $src"
            fi
        else
            error "Required plugin not found in $LIBEXEC_CNI_DIR: $plugin"
        fi
    done
}

validate_setup() {
    log "Validating CNI plugin setup..."

    local opt_status=$(check_plugins_in_dir "$OPT_CNI_DIR")
    local libexec_status=$(check_plugins_in_dir "$LIBEXEC_CNI_DIR")

    log "Status:"
    log "  $OPT_CNI_DIR: $opt_status"
    log "  $LIBEXEC_CNI_DIR: $libexec_status"

    if [ "$opt_status" = "present" ] || [ "$libexec_status" = "present" ]; then
        log "✓ CNI plugins are properly configured"
        return 0
    else
        error "CNI plugins not found in either location. Please install containernetworking-plugins package or run install-deps.sh"
    fi
}

main() {
    log "=== Fedora CNI Plugin Migration ==="
    log ""

    # Check current state
    local opt_status=$(check_plugins_in_dir "$OPT_CNI_DIR")
    local libexec_status=$(check_plugins_in_dir "$LIBEXEC_CNI_DIR")

    log "Current CNI plugin status:"
    log "  $OPT_CNI_DIR: $opt_status"
    log "  $LIBEXEC_CNI_DIR: $libexec_status"
    log ""

    if [ "$opt_status" = "present" ]; then
        log "✓ Plugins already present in $OPT_CNI_DIR - no migration needed"
        log ""
        log "Note: The updated Catalyst Agent (v1.0+) will automatically detect"
        log "      plugins in either location, so no action is required."
        validate_setup
        exit 0
    fi

    if [ "$libexec_status" = "present" ]; then
        log "Found plugins in $LIBEXEC_CNI_DIR (Fedora/RHEL default location)"
        log ""
        if [ "$AUTO_YES" -eq 1 ]; then
            create_symlinks
        else
            if [ -t 0 ]; then
                read -r -p "Create symlinks to $OPT_CNI_DIR for compatibility? [y/N] " -n 1
                echo
                if [[ ${REPLY:-} =~ ^[Yy]$ ]]; then
                    create_symlinks
                else
                    log "Skipped symlink creation."
                    log ""
                    log "Note: The updated Catalyst Agent (v1.0+) will automatically detect"
                    log "      plugins in $LIBEXEC_CNI_DIR, so symlinks are optional."
                fi
            else
                error "Non-interactive mode: re-run with --yes to create symlinks automatically"
            fi
        fi
        validate_setup
        exit 0
    fi

    if [ "$libexec_status" = "partial" ]; then
        log "Warning: Only some plugins found in $LIBEXEC_CNI_DIR"
        log "You may need to reinstall the containernetworking-plugins package:"
        log ""
        log "  sudo dnf install containernetworking-plugins"
        log ""
        log "Or run the full dependency installer:"
        log ""
        log "  sudo ./install-deps.sh"
        exit 1
    fi

    # No plugins found anywhere
    log "No CNI plugins found in standard locations."
    log ""
    log "Please install CNI plugins using one of these methods:"
    log ""
    log "1. Package manager (Fedora/RHEL):"
    log "   sudo dnf install containernetworking-plugins"
    log ""
    log "2. Full dependency installer:"
    log "   sudo ./install-deps.sh"
    log ""
    log "3. Manual installation:"
    log "   sudo mkdir -p /opt/cni/bin"
    log "   curl -fsSL https://github.com/containernetworking/plugins/releases/download/v1.4.1/cni-plugins-linux-amd64-v1.4.1.tgz | \\"
    log "     sudo tar -xz -C /opt/cni/bin"
    exit 1
}

main "$@"
