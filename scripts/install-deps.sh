#!/usr/bin/env bash
# install-deps.sh - Install containerd, nerdctl, buildctl and common dependencies
# Supports: apt (Debian/Ubuntu), apk (Alpine), dnf/yum (Fedora/RHEL/CentOS), pacman (Arch), zypper (openSUSE)
# Will try to install packaged containerd where possible, and fall back to GitHub binary releases
# Run as root or with sudo

set -euo pipefail
export PATH="/usr/local/bin:$PATH"

CONTAINERD_VERSION="${CONTAINERD_VERSION:-1.7.24}"
NERDCTL_VERSION="${NERDCTL_VERSION:-1.8.1}"
BUILDKIT_VERSION="${BUILDKIT_VERSION:-v0.17.2}"
CNI_PLUGINS_VERSION="${CNI_PLUGINS_VERSION:-v1.4.1}"

# Tools we will attempt to install via packages
COMMON_PKGS=(curl ca-certificates tar gzip jq)

# Check for root
if [ "$EUID" -ne 0 ]; then
  SUDO=sudo
else
  SUDO=""
fi

log() { printf "[install-deps] %s\n" "$*"; }
error() { printf "[install-deps] ERROR: %s\n" "$*" >&2; exit 1; }

detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID=$ID
    OS_ID_LIKE=${ID_LIKE:-}
  else
    OS_ID=$(uname -s)
    OS_ID_LIKE=""
  fi

  case "${OS_ID,,}" in
    alpine) PM=apk ;;
    ubuntu|debian) PM=apt ;;
    fedora) PM=dnf ;;
    centos|rhel) PM=yum ;;
    arch) PM=pacman ;;
    opensuse*|suse) PM=zypper ;;
    *)
      # try detect by ID_LIKE
      case "${OS_ID_LIKE,,}" in
        *debian*) PM=apt ;;
        *rhel*|*fedora*) PM=dnf ;;
        *alpine*) PM=apk ;;
        *arch*) PM=pacman ;;
        *) PM=unknown ;;
      esac
      ;;
  esac
}

run_update_and_install() {
  case "$PM" in
    apt)
      $SUDO apt-get update -y
      $SUDO apt-get install -y "${COMMON_PKGS[@]}" gnupg lsb-release software-properties-common ca-certificates
      ;;
    apk)
      $SUDO apk update
      $SUDO apk add --no-cache "${COMMON_PKGS[@]}" gnupg
      ;;
    dnf)
      $SUDO dnf -y install "${COMMON_PKGS[@]}" gnupg2
      ;;
    yum)
      $SUDO yum -y install "${COMMON_PKGS[@]}" gnupg2
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm "${COMMON_PKGS[@]}" gnupg
      ;;
    zypper)
      $SUDO zypper refresh
      $SUDO zypper install -y "${COMMON_PKGS[@]}" gpg2
      ;;
    *)
      error "Unsupported package manager or OS. Please install prerequisites manually: ${COMMON_PKGS[*]}"
      ;;
  esac
}

apt_add_docker_repo() {
  # Add Docker repo to get a recent containerd package (for Debian/Ubuntu)
  if command -v apt-get >/dev/null 2>&1; then
    local repo_id
    repo_id="${OS_ID,,}"
    if [ "$repo_id" != "ubuntu" ] && [ "$repo_id" != "debian" ]; then
      repo_id="ubuntu"
    fi
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${repo_id}/gpg" | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    ARCH=$(dpkg --print-architecture 2>/dev/null || true)
    if [ -z "$ARCH" ]; then ARCH=amd64; fi
    echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${repo_id} $(lsb_release -cs) stable" | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
    $SUDO apt-get update -y
  fi
}

install_containerd_package() {
  log "Attempting to install containerd via package manager ($PM)"
  case "$PM" in
    apt)
      apt_add_docker_repo
      if $SUDO apt-get install -y containerd; then return 0; fi
      if $SUDO apt-get install -y containerd.io; then return 0; fi
      ;;
    apk)
      if $SUDO apk add --no-cache containerd; then return 0; fi
      ;;
    dnf)
      if $SUDO dnf -y install containerd; then return 0; fi
      ;;
    yum)
      if $SUDO yum -y install containerd; then return 0; fi
      ;;
    pacman)
      if $SUDO pacman -Sy --noconfirm containerd; then return 0; fi
      ;;
    zypper)
      if $SUDO zypper install -y containerd; then return 0; fi
      ;;
  esac
  return 1
}

install_runtime_tools() {
  log "Installing runtime utilities required by the agent"
  case "$PM" in
    apt)
      $SUDO apt-get install -y iproute2 iptables rsync util-linux e2fsprogs musl-tools musl-dev
      ;;
    apk)
      $SUDO apk add --no-cache iproute2 iptables rsync util-linux e2fsprogs
      ;;
    dnf|yum)
      $SUDO $PM -y install iproute iptables rsync util-linux e2fsprogs openssl-devel musl-gcc
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm iproute2 iptables rsync util-linux e2fsprogs
      ;;
    zypper)
      $SUDO zypper install -y iproute2 iptables rsync util-linux e2fsprogs
      ;;
  esac
}

map_arch() {
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64) echo "amd64" ;;
    aarch64) echo "arm64" ;;
    armv7l) echo "armv7" ;;
    *) echo "amd64" ;;
  esac
}

download_github_release_asset() {
  # usage: download_github_release_asset owner/repo tag match_regex dest
  repo=$1
  tag=$2
  match=$3
  dest=$4

  api_url="https://api.github.com/repos/${repo}/releases"
  if [ "$tag" = "latest" ]; then
    url="${api_url}/latest"
  else
    url="${api_url}/tags/${tag}"
  fi

  log "Fetching release metadata from $url"
  assets=$(curl -fsSL "$url" | jq -r '.assets[] | .browser_download_url')
  if [ -z "$assets" ]; then
    error "No release assets found for ${repo} ${tag}"
  fi

  for a in $assets; do
    if echo "$a" | grep -Eq "$match"; then
      log "Found asset: $a"
      curl -fsSL "$a" -o "$dest"
      return 0
    fi
  done

  return 1
}

install_containerd_binary() {
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) ARCH=amd64 ;;
    aarch64) ARCH=arm64 ;;
    armv7l) ARCH=armhf ;;
    *) ARCH=amd64 ;;
  esac

  if [ "$CONTAINERD_VERSION" = "latest" ]; then
    tag="latest"
  else
    tag="v${CONTAINERD_VERSION#v}"
  fi

  tgt="/tmp/containerd-${tag}-${ARCH}.tar.gz"
  if download_github_release_asset "containerd/containerd" "$tag" "linux.*${ARCH}.*\.tar\.gz|containerd-.*linux-${ARCH}.*\.tar\.gz" "$tgt"; then
    log "Extracting containerd"
    $SUDO tar -C / -xzf "$tgt"
    rm -f "$tgt"
    # systemd unit: if packaged not installed, try to set up a basic unit
    if [ ! -f /lib/systemd/system/containerd.service ] && [ -f /etc/systemd/system ]; then
      log "Installing minimal containerd systemd service"
      cat <<'EOF' | $SUDO tee /etc/systemd/system/containerd.service >/dev/null
[Unit]
Description=containerd container runtime
Documentation=https://containerd.io
After=network.target

[Service]
ExecStart=/usr/local/bin/containerd
Restart=always
Delegate=yes
KillMode=process

[Install]
WantedBy=multi-user.target
EOF
      $SUDO systemctl daemon-reload || true
    fi
    return 0
  else
    error "Failed to download containerd binary release"
  fi
}

install_nerdctl() {
  log "Installing nerdctl"
  ARCH="$(map_arch)"
  tag="v${NERDCTL_VERSION#v}"
  tmp="/tmp/nerdctl-${tag}-${ARCH}.tar.gz"
  if download_github_release_asset "containerd/nerdctl" "$tag" "linux.*${ARCH}.*\.tar\.gz|nerdctl-.*linux-${ARCH}.*\.tar\.gz" "$tmp"; then
    $SUDO tar -C /usr/local -xzf "$tmp"
    rm -f "$tmp"
    log "nerdctl installed to /usr/local/bin"
  else
    error "Failed to download nerdctl"
  fi
}

install_buildctl() {
  log "Installing buildctl (BuildKit)"
  ARCH="$(map_arch)"
  tag="${BUILDKIT_VERSION#v}"
  tmp="/tmp/buildkit-${tag}-${ARCH}.tar.gz"
  # The repo is moby/buildkit
  # Asset names vary; match linux and arch and include buildctl
  if download_github_release_asset "moby/buildkit" "$tag" "linux.*${ARCH}.*buildctl.*\.tar\.gz|linux.*${ARCH}.*\.tar\.gz|buildkit-.*linux-${ARCH}.*\.tar\.gz" "$tmp"; then
    mkdir -p /tmp/buildkit-extract
    tar -C /tmp/buildkit-extract -xzf "$tmp"
    # find buildctl
    buildctl_path=$(find /tmp/buildkit-extract -type f -name buildctl -print -quit || true)
    if [ -n "$buildctl_path" ]; then
      $SUDO install -m 0755 "$buildctl_path" /usr/local/bin/buildctl
      log "buildctl installed to /usr/local/bin/buildctl"
    else
      error "buildctl binary not found in release archive"
    fi
    rm -rf /tmp/buildkit-extract "$tmp"
  else
    error "Failed to download buildkit release"
  fi
}

has_required_cni_plugins() {
  local required=(bridge host-local portmap macvlan)
  local plugin
  # Check multiple CNI plugin directories (Fedora uses /usr/libexec/cni)
  local cni_dirs=("/opt/cni/bin" "/usr/libexec/cni")

  for cni_dir in "${cni_dirs[@]}"; do
    local found=true
    for plugin in "${required[@]}"; do
      if [ ! -x "${cni_dir}/${plugin}" ]; then
        found=false
        break
      fi
    done
    if [ "$found" = true ]; then
      return 0
    fi
  done
  return 1
}

install_cni_plugins() {
  if has_required_cni_plugins; then
    log "CNI plugins already installed"
    return 0
  fi

  log "Installing CNI plugins"
  case "$PM" in
    apt)
      $SUDO apt-get install -y containernetworking-plugins || true
      ;;
    apk)
      $SUDO apk add --no-cache cni-plugins || true
      ;;
    dnf|yum)
      $SUDO $PM -y install containernetworking-plugins || true
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm containernetworking-plugins || true
      ;;
    zypper)
      $SUDO zypper install -y cni-plugins || true
      ;;
  esac

  if has_required_cni_plugins; then
    log "CNI plugins installed via package manager"
    return 0
  fi

  ARCH="$(map_arch)"
  if [ "$ARCH" = "armv7" ]; then
    error "CNI plugin release install is only supported for amd64/arm64 in this script"
  fi
  version_tag="${CNI_PLUGINS_VERSION#v}"
  cni_archive="/tmp/cni-plugins-${version_tag}-${ARCH}.tgz"
  cni_url="https://github.com/containernetworking/plugins/releases/download/${CNI_PLUGINS_VERSION}/cni-plugins-linux-${ARCH}-${CNI_PLUGINS_VERSION}.tgz"

  $SUDO mkdir -p /opt/cni/bin
  curl -fsSL "$cni_url" -o "$cni_archive"
  $SUDO tar -xzf "$cni_archive" -C /opt/cni/bin
  rm -f "$cni_archive"

  has_required_cni_plugins || error "CNI plugin installation finished but required binaries are missing"
}

ensure_containerd_config() {
  log "Ensuring /etc/containerd/config.toml is present and compatible"
  $SUDO mkdir -p /etc/containerd /etc/cni/net.d /var/lib/cni/networks
  if [ ! -s /etc/containerd/config.toml ]; then
    containerd config default | $SUDO tee /etc/containerd/config.toml >/dev/null
  fi

  if grep -q 'SystemdCgroup = false' /etc/containerd/config.toml; then
    $SUDO sed -i 's/SystemdCgroup = false/SystemdCgroup = true/g' /etc/containerd/config.toml
  elif ! grep -q 'SystemdCgroup = true' /etc/containerd/config.toml; then
    cat <<'EOF' | $SUDO tee -a /etc/containerd/config.toml >/dev/null

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
  SystemdCgroup = true
EOF
  fi
}

enable_and_start_containerd() {
  if command -v systemctl >/dev/null 2>&1; then
    log "Enabling and starting containerd.service"
    $SUDO systemctl enable --now containerd || true
  else
    log "systemctl not found - please start containerd manually if needed"
  fi
}

install_runc_or_crun() {
  log "Installing a runtime (runc/crun) if available in packages"
  case "$PM" in
    apt)
      $SUDO apt-get install -y runc || true
      ;;
    apk)
      $SUDO apk add --no-cache runc || true
      ;;
    dnf|yum)
      $SUDO $PM -y install runc || true
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm runc || true
      ;;
    zypper)
      $SUDO zypper install -y runc || true
      ;;
  esac
}

post_install_checks() {
  log "Verifying installations"
  command -v containerd >/dev/null 2>&1 && log "containerd: $(containerd --version 2>/dev/null || true)" || log "containerd not found in PATH"
  command -v nerdctl >/dev/null 2>&1 && log "nerdctl: $(nerdctl --version 2>/dev/null || true)" || log "nerdctl not found in PATH"
  command -v buildctl >/dev/null 2>&1 && log "buildctl: $(buildctl --version 2>/dev/null || true)" || log "buildctl not found in PATH"
  if has_required_cni_plugins; then
    log "CNI plugins: bridge, host-local, portmap, macvlan present"
  else
    log "CNI plugins missing required binaries"
  fi
}

main() {
  detect_os
  log "Detected OS/package manager: $PM"

  run_update_and_install
  install_runtime_tools

  if ! install_containerd_package; then
    log "Package install failed or unavailable, falling back to binary release"
    install_containerd_binary
  fi

  install_nerdctl
  install_buildctl
  install_runc_or_crun
  install_cni_plugins
  ensure_containerd_config
  enable_and_start_containerd
  post_install_checks

  log "Done — containerd, nerdctl, buildctl and CNI plugins should be installed."
  log "You may need to logout/login or add your user to the 'docker' or 'wheel' group for non-root usage." 
  log "If you use cgroup v2, ensure your system is configured accordingly and that containerd/runc/crun support it."
}

main "$@"
