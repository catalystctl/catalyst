#!/usr/bin/env bash
#
# Universal Bun Installer
# Installs Bun package manager on any Linux distribution
#
# Usage:
#   ./scripts/install-bun.sh          # Install latest Bun
#   ./scripts/install-bun.sh 1.3.9   # Install specific version
#   ./scripts/install-bun.sh --help  # Show help
#
# Supported distributions:
#   - Debian/Ubuntu: apt-based
#   - RHEL/CentOS/Fedora: yum/dnf-based
#   - Arch Linux: pacman-based
#   - Alpine: apk-based
#   - openSUSE: zypper-based
#   - Generic: Any Linux with bash + curl
#

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# Detect Linux distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        DISTRO_VERSION=$VERSION_ID
    elif [ -f /etc/redhat-release ]; then
        DISTRO="rhel"
    elif [ -f /etc/debian_version ]; then
        DISTRO="debian"
    elif [ -f /etc/arch-release ]; then
        DISTRO="arch"
    elif [ -f /etc/alpine-release ]; then
        DISTRO="alpine"
    else
        DISTRO="unknown"
    fi

    echo "$DISTRO"
}

# Install dependencies for the detected distro
install_dependencies() {
    local distro=$1

    log_info "Installing dependencies for $distro..."

    case "$distro" in
        ubuntu|debian|linuxmint|pop|elementary)
            if command -v apt-get >/dev/null 2>&1; then
                sudo apt-get update -qq
                sudo apt-get install -y curl bash xz-utils
            else
                log_error "apt-get not found. Cannot install dependencies."
                exit 1
            fi
            ;;

        rhel|centos|fedora|rocky|almalinux)
            if command -v dnf >/dev/null 2>&1; then
                sudo dnf install -y curl bash xz
            elif command -v yum >/dev/null 2>&1; then
                sudo yum install -y curl bash xz
            else
                log_error "Neither dnf nor yum found. Cannot install dependencies."
                exit 1
            fi
            ;;

        arch|manjaro|endeavouros)
            if command -v pacman >/dev/null 2>&1; then
                sudo pacman -Sy --noconfirm curl bash xz
            else
                log_error "pacman not found. Cannot install dependencies."
                exit 1
            fi
            ;;

        alpine)
            if command -v apk >/dev/null 2>&1; then
                apk add --no-cache curl bash xz
            else
                log_error "apk not found. Cannot install dependencies."
                exit 1
            fi
            ;;

        opensuse-leap|opensuse-tumbleweed|suse)
            if command -v zypper >/dev/null 2>&1; then
                sudo zypper -n install curl bash xz
            else
                log_error "zypper not found. Cannot install dependencies."
                exit 1
            fi
            ;;

        *)
            log_warn "Unknown distribution: $distro"
            log_warn "Attempting to install Bun without package manager..."
            log_warn "Please ensure you have 'curl' and 'bash' installed."
            ;;
    esac

    log_success "Dependencies installed"
}

# Download and install Bun
install_bun() {
    local version=${1:-latest}

    log_info "Installing Bun (version: ${version})..."

    # Create temporary directory for download
    local tmp_dir
    tmp_dir=$(mktemp -d)
    cd "$tmp_dir"

    # Download official Bun install script
    local install_url="https://bun.sh/install"
    local install_script="install-bun.sh"

    log_info "Downloading Bun install script..."
    if ! curl -fsSL "$install_url" -o "$install_script"; then
        log_error "Failed to download Bun install script"
        exit 1
    fi

    # Make script executable
    chmod +x "$install_script"

    # Set BUN_INSTALL directory
    export BUN_INSTALL="$HOME/.bun"

    # Install Bun (with version if specified)
    if [ "$version" = "latest" ]; then
        bash "$install_script"
    else
        bash "$install_script" "$version"
    fi

    # Cleanup
    cd - >/dev/null
    rm -rf "$tmp_dir"

    log_success "Bun installed successfully"
}

# Verify installation
verify_installation() {
    log_info "Verifying Bun installation..."

    # Add Bun to PATH for this session
    export PATH="$BUN_INSTALL/bin:$PATH"

    if ! command -v bun >/dev/null 2>&1; then
        log_error "Bun binary not found in PATH"
        log_error "Please add the following to your ~/.bashrc or ~/.zshrc:"
        log_error "  export BUN_INSTALL=\"\$HOME/.bun\""
        log_error "  export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
        exit 1
    fi

    local bun_version
    bun_version=$(bun --version)

    log_success "Bun $bun_version is installed and working!"
}

# Setup shell integration
setup_shell_integration() {
    local shell_config=""
    local shell_name=""

    # Detect shell
    if [ -n "${ZSH_VERSION:-}" ]; then
        shell_name="zsh"
        shell_config="$HOME/.zshrc"
    elif [ -n "${BASH_VERSION:-}" ]; then
        shell_name="bash"
        shell_config="$HOME/.bashrc"
    else
        shell_name="unknown"
        shell_config="$HOME/.profile"
    fi

    log_info "Setting up shell integration for $shell_name..."

    local bun_export=""
    bun_export=$'# Bun'
    bun_config+=$'\n'
    bun_config+='export BUN_INSTALL="$HOME/.bun"'
    bun_config+=$'\n'
    bun_config+='export PATH="$BUN_INSTALL/bin:$PATH"'

    # Check if already configured
    if grep -q "BUN_INSTALL" "$shell_config" 2>/dev/null; then
        log_warn "Bun already configured in $shell_config"
        return 0
    fi

    # Add to shell config
    echo "" >> "$shell_config"
    echo "$bun_config" >> "$shell_config"

    log_success "Added Bun to PATH in $shell_config"
    log_info "Please run: source $shell_config"
}

# Print usage
show_help() {
    cat << EOF
Universal Bun Installer

Installs Bun package manager on any Linux distribution.

Usage:
  $0 [version] [options]

Arguments:
  version              Optional. Install specific version (e.g., 1.3.9)
                       Default: latest

Options:
  --help, -h          Show this help message
  --no-shell          Skip shell integration
  --deps-only         Only install dependencies, don't install Bun

Examples:
  $0                  # Install latest Bun
  $0 1.3.9            # Install Bun version 1.3.9
  $0 --help           # Show help

After installation:
  1. Reload your shell: source ~/.bashrc (or ~/.zshrc)
  2. Verify: bun --version

For more information: https://bun.sh/docs/installation
EOF
}

# Main installation flow
main() {
    local version=""
    local skip_shell=false
    local deps_only=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help|-h)
                show_help
                exit 0
                ;;
            --no-shell)
                skip_shell=true
                shift
                ;;
            --deps-only)
                deps_only=true
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
            *)
                version="$1"
                shift
                ;;
        esac
    done

    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║           Universal Bun Installer                        ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Detect distribution
    local distro
    distro=$(detect_distro)
    log_info "Detected distribution: $distro"

    # Check if running as root
    if [ "$EUID" -eq 0 ]; then
        log_warn "Running as root. This is not recommended."
        log_warn "The installer will use 'sudo' for package operations."
    fi

    # Install dependencies
    install_dependencies "$distro"

    # If only installing dependencies, exit here
    if [ "$deps_only" = true ]; then
        log_success "Dependencies installed. Exiting (--deps-only flag set)."
        exit 0
    fi

    # Check if Bun is already installed
    if command -v bun >/dev/null 2>&1; then
        local current_version
        current_version=$(bun --version)
        log_warn "Bun is already installed (version: $current_version)"
        read -p "Do you want to reinstall? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Installation cancelled."
            exit 0
        fi
    fi

    # Install Bun
    install_bun "$version"

    # Verify installation
    verify_installation

    # Setup shell integration
    if [ "$skip_shell" = false ]; then
        setup_shell_integration
    fi

    # Print summary
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Installation Complete!                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    log_info "Bun has been installed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Reload your shell:"
    echo "     source ~/.bashrc    # or source ~/.zshrc"
    echo ""
    echo "  2. Verify installation:"
    echo "     bun --version"
    echo ""
    echo "  3. Try it out:"
    echo "     bun create vite my-app"
    echo ""
    echo "For more information: https://bun.sh/docs"
    echo ""
}

# Run main function
main "$@"
