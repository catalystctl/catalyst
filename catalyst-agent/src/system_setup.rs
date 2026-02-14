use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use tracing::{error, info, warn};

use sha2::{Digest, Sha256};

use crate::config::CniNetworkConfig;
use crate::{AgentConfig, AgentError};

pub struct SystemSetup;

impl SystemSetup {
    /// Initialize the system with all required dependencies
    pub async fn initialize(config: &AgentConfig) -> Result<(), AgentError> {
        info!("🚀 Starting system initialization...");

        // 1. Detect package manager
        let pkg_manager = Self::detect_package_manager()?;
        info!("✓ Detected package manager: {}", pkg_manager);

        // 2. Check and install containerd
        Self::ensure_container_runtime(&pkg_manager).await?;

        // 3. Ensure low-level OCI runtime is available
        Self::ensure_oci_runtime(&pkg_manager).await?;

        // 4. Ensure containerd service/socket is ready
        Self::ensure_containerd_running().await?;

        // 5. Ensure IP tooling is available (iproute2)
        Self::ensure_iproute(&pkg_manager).await?;

        // 6. Ensure CNI plugin binaries are installed
        Self::ensure_cni_plugins(&pkg_manager).await?;

        // 7. Setup CNI networking only (static host-local IPAM)
        Self::setup_cni_static_networking(config).await?;

        info!("✅ System initialization complete!");
        Ok(())
    }

    /// Detect the system's package manager
    fn detect_package_manager() -> Result<String, AgentError> {
        let managers = vec![
            ("apk", "apk"),
            ("apt-get", "apt"),
            ("yum", "yum"),
            ("dnf", "dnf"),
            ("pacman", "pacman"),
            ("zypper", "zypper"),
        ];

        for (cmd, name) in managers {
            if Command::new("which")
                .arg(cmd)
                .output()
                .map_err(|e| {
                    AgentError::IoError(format!("Failed to detect package manager: {}", e))
                })?
                .status
                .success()
            {
                return Ok(name.to_string());
            }
        }

        Err(AgentError::InternalError(
            "No supported package manager found".to_string(),
        ))
    }

    /// Ensure container runtime is installed
    async fn ensure_container_runtime(pkg_manager: &str) -> Result<(), AgentError> {
        let has_containerd = Command::new("which")
            .arg("containerd")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check containerd: {}", e)))?
            .status
            .success();

        if has_containerd {
            info!("✓ containerd already installed");
            return Ok(());
        }

        warn!("Container runtime not found, installing...");

        let containerd_installed = match pkg_manager {
            "apk" => Self::run_command_allow_failure("apk", &["add", "--no-cache", "containerd"]),
            "apt" => {
                let _ = Self::run_command_allow_failure("apt-get", &["update", "-qq"]);
                Self::run_command_allow_failure("apt-get", &["install", "-y", "-qq", "containerd"])
                    || Self::run_command_allow_failure(
                        "apt-get",
                        &["install", "-y", "-qq", "containerd.io"],
                    )
            }
            "yum" | "dnf" => {
                Self::run_command_allow_failure(pkg_manager, &["install", "-y", "containerd"])
            }
            "pacman" => {
                Self::run_command_allow_failure("pacman", &["-S", "--noconfirm", "containerd"])
            }
            "zypper" => Self::run_command_allow_failure(
                "zypper",
                &["--non-interactive", "install", "containerd"],
            ),
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(AgentError::InternalError(format!(
                    "Please install containerd manually for {}",
                    pkg_manager
                )));
            }
        };

        if !containerd_installed {
            return Err(AgentError::InternalError(
                "Failed to install containerd package".to_string(),
            ));
        }

        info!("✓ Container runtime installed");
        Ok(())
    }

    /// Ensure runc/crun runtime binary is available
    async fn ensure_oci_runtime(pkg_manager: &str) -> Result<(), AgentError> {
        let has_runc = Command::new("which")
            .arg("runc")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check runc: {}", e)))?
            .status
            .success();
        let has_crun = Command::new("which")
            .arg("crun")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check crun: {}", e)))?
            .status
            .success();

        if has_runc || has_crun {
            info!("✓ OCI runtime already installed");
            return Ok(());
        }

        warn!("OCI runtime not found, installing runc...");
        let installed = match pkg_manager {
            "apk" => Self::run_command_allow_failure("apk", &["add", "--no-cache", "runc"]),
            "apt" => {
                let _ = Self::run_command_allow_failure("apt-get", &["update", "-qq"]);
                Self::run_command_allow_failure("apt-get", &["install", "-y", "-qq", "runc"])
            }
            "yum" | "dnf" => {
                Self::run_command_allow_failure(pkg_manager, &["install", "-y", "runc"])
            }
            "pacman" => Self::run_command_allow_failure("pacman", &["-S", "--noconfirm", "runc"]),
            "zypper" => {
                Self::run_command_allow_failure("zypper", &["--non-interactive", "install", "runc"])
            }
            _ => false,
        };

        if !installed {
            return Err(AgentError::InternalError(
                "Failed to install OCI runtime (runc/crun)".to_string(),
            ));
        }

        info!("✓ OCI runtime installed");
        Ok(())
    }

    /// Ensure containerd is started and socket exists
    async fn ensure_containerd_running() -> Result<(), AgentError> {
        let has_systemctl = Command::new("which")
            .arg("systemctl")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check systemctl: {}", e)))?
            .status
            .success();

        if has_systemctl {
            Self::run_command("systemctl", &["daemon-reload"], None)?;
            Self::run_command("systemctl", &["enable", "--now", "containerd"], None)?;
            let status = Command::new("systemctl")
                .args(["is-active", "--quiet", "containerd"])
                .status()
                .map_err(|e| AgentError::IoError(format!("Failed to check containerd: {}", e)))?;
            if !status.success() {
                Self::run_command("systemctl", &["start", "containerd"], None)?;
            }
        } else {
            warn!("systemctl not available; containerd must be managed manually");
        }

        let mut attempts = 10;
        while attempts > 0 && !Path::new("/run/containerd/containerd.sock").exists() {
            attempts -= 1;
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        if !Path::new("/run/containerd/containerd.sock").exists() {
            return Err(AgentError::InternalError(
                "containerd socket is not available at /run/containerd/containerd.sock".to_string(),
            ));
        }

        info!("✓ containerd service/socket ready");
        Ok(())
    }

    /// Ensure `ip` command is available
    async fn ensure_iproute(pkg_manager: &str) -> Result<(), AgentError> {
        if Command::new("which")
            .arg("ip")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check ip: {}", e)))?
            .status
            .success()
        {
            info!("✓ ip already installed");
            return Ok(());
        }

        warn!("ip command not found, installing iproute package...");

        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "iproute2"], None)?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None)?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "iproute2"], None)?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "iproute"], None)?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "iproute2"], None)?;
            }
            "zypper" => {
                Self::run_command(
                    "zypper",
                    &["--non-interactive", "install", "iproute2"],
                    None,
                )?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(AgentError::InternalError(format!(
                    "Please install iproute2 manually for {}",
                    pkg_manager
                )));
            }
        }

        info!("✓ ip installed");
        Ok(())
    }

    /// Ensure download/extract tools are available
    async fn ensure_download_tools(pkg_manager: &str) -> Result<(), AgentError> {
        let has_curl = Command::new("which")
            .arg("curl")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check curl: {}", e)))?
            .status
            .success();
        let has_tar = Command::new("which")
            .arg("tar")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check tar: {}", e)))?
            .status
            .success();
        let has_gzip = Command::new("which")
            .arg("gzip")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check gzip: {}", e)))?
            .status
            .success();

        if has_curl && has_tar && has_gzip {
            info!("✓ Download tools already installed");
            return Ok(());
        }

        warn!("Download tools missing, installing...");

        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "curl", "tar", "gzip"], None)?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None)?;
                Self::run_command(
                    "apt-get",
                    &["install", "-y", "-qq", "curl", "tar", "gzip"],
                    None,
                )?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "curl", "tar", "gzip"], None)?;
            }
            "pacman" => {
                Self::run_command(
                    "pacman",
                    &["-S", "--noconfirm", "curl", "tar", "gzip"],
                    None,
                )?;
            }
            "zypper" => {
                Self::run_command(
                    "zypper",
                    &["--non-interactive", "install", "curl", "tar", "gzip"],
                    None,
                )?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(AgentError::InternalError(format!(
                    "Please install curl, tar, and gzip manually for {}",
                    pkg_manager
                )));
            }
        }

        info!("✓ Download tools installed");
        Ok(())
    }

    fn sha256_file(path: &str) -> Result<String, AgentError> {
        let mut file = fs::File::open(path)
            .map_err(|e| AgentError::IoError(format!("Open {}: {}", path, e)))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|e| AgentError::IoError(format!("Read {}: {}", path, e)))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    fn extract_sha256_hex(text: &str) -> Option<String> {
        for raw in text.split_whitespace() {
            let token = raw.trim_matches(|c: char| c == '=' || c == '(' || c == ')');
            if token.len() == 64 && token.chars().all(|c| c.is_ascii_hexdigit()) {
                return Some(token.to_ascii_lowercase());
            }
        }
        None
    }

    fn expected_cni_plugins_sha256(version: &str, arch: &str) -> Option<&'static str> {
        // Pinned checksums for the CNI plugins tarball. Keep in sync with the version in
        // ensure_cni_plugins().
        match (version, arch) {
            // Values are from the upstream GitHub release artifacts.
            ("v1.9.0", "amd64") => {
                Some("58c037b23b0792b91c1a464f3c5d6d2d124ea74df761911c2c5ec8c714e5432d")
            }
            ("v1.9.0", "arm64") => {
                Some("259604308a06b35957f5203771358fbb9e89d09579b65b3e50551ffefc536d63")
            }
            _ => None,
        }
    }

    /// Ensure required CNI plugin binaries are installed
    async fn ensure_cni_plugins(pkg_manager: &str) -> Result<(), AgentError> {
        if Self::has_required_cni_plugins() {
            info!("✓ Required CNI plugins already installed");
            return Ok(());
        }

        warn!("CNI plugins missing, installing...");
        Self::ensure_download_tools(pkg_manager).await?;

        let packaged_install = match pkg_manager {
            "apt" => {
                let _ = Self::run_command_allow_failure("apt-get", &["update", "-qq"]);
                Self::run_command_allow_failure(
                    "apt-get",
                    &["install", "-y", "-qq", "containernetworking-plugins"],
                )
            }
            "apk" => Self::run_command_allow_failure("apk", &["add", "--no-cache", "cni-plugins"]),
            "yum" | "dnf" => Self::run_command_allow_failure(
                pkg_manager,
                &["install", "-y", "containernetworking-plugins"],
            ),
            "pacman" => Self::run_command_allow_failure(
                "pacman",
                &["-S", "--noconfirm", "containernetworking-plugins"],
            ),
            "zypper" => Self::run_command_allow_failure(
                "zypper",
                &["--non-interactive", "install", "cni-plugins"],
            ),
            _ => false,
        };

        if packaged_install && Self::has_required_cni_plugins() {
            info!("✓ Required CNI plugins installed via package manager");
            return Ok(());
        }

        let arch = match std::env::consts::ARCH {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            other => {
                return Err(AgentError::InternalError(format!(
                    "Unsupported architecture for CNI plugin install: {}",
                    other
                )));
            }
        };
        let version = "v1.9.0";
        let url = format!(
            "https://github.com/containernetworking/plugins/releases/download/{}/cni-plugins-linux-{}-{}.tgz",
            version, arch, version
        );

        fs::create_dir_all("/opt/cni/bin")
            .map_err(|e| AgentError::IoError(format!("Failed to create /opt/cni/bin: {}", e)))?;
        let archive_path = format!("/tmp/cni-plugins-{}-{}.tgz", version, arch);
        Self::run_command("curl", &["-fsSL", "-o", &archive_path, &url], None)?;

        // Verify download integrity before extracting as root.
        let expected_sha256 = match Self::expected_cni_plugins_sha256(version, arch) {
            Some(v) => v.to_string(),
            None => {
                // Fallback: download the release-provided checksum file. This is weaker than
                // a pinned checksum, but still prevents silent corruption.
                let checksum_url = format!("{}.sha256", url);
                let checksum_path = format!("/tmp/cni-plugins-{}-{}.tgz.sha256", version, arch);
                Self::run_command(
                    "curl",
                    &["-fsSL", "-o", &checksum_path, &checksum_url],
                    None,
                )?;
                let raw = fs::read_to_string(&checksum_path).map_err(|e| {
                    AgentError::IoError(format!("Failed to read checksum file: {}", e))
                })?;
                let _ = fs::remove_file(&checksum_path);
                Self::extract_sha256_hex(&raw).ok_or_else(|| {
                    AgentError::InstallationError(
                        "Failed to parse downloaded checksum file".to_string(),
                    )
                })?
            }
        };

        let actual_sha256 = Self::sha256_file(&archive_path)?;
        if actual_sha256 != expected_sha256.to_ascii_lowercase() {
            let _ = fs::remove_file(&archive_path);
            return Err(AgentError::InstallationError(format!(
                "CNI plugins checksum mismatch: expected {}, got {}",
                expected_sha256, actual_sha256
            )));
        }

        Self::run_command(
            "tar",
            &["-xz", "-C", "/opt/cni/bin", "-f", &archive_path],
            None,
        )?;
        let _ = fs::remove_file(&archive_path);

        if !Self::has_required_cni_plugins() {
            return Err(AgentError::InternalError(
                "CNI plugins installation completed but required binaries are still missing"
                    .to_string(),
            ));
        }

        info!("✓ Required CNI plugins installed");
        Ok(())
    }

    fn has_required_cni_plugins() -> bool {
        const REQUIRED: [&str; 4] = ["bridge", "host-local", "portmap", "macvlan"];
        // Check multiple CNI plugin directories (Fedora uses /usr/libexec/cni)
        const CNI_BIN_DIRS: [&str; 2] = ["/opt/cni/bin", "/usr/libexec/cni"];

        for dir in CNI_BIN_DIRS {
            let has_all = REQUIRED
                .iter()
                .all(|name| Path::new(&format!("{}/{}", dir, name)).exists());
            if has_all {
                return true;
            }
        }
        false
    }

    /// Setup CNI networking with macvlan and host-local IPAM (static IPs)
    async fn setup_cni_static_networking(config: &AgentConfig) -> Result<(), AgentError> {
        let cni_dir = "/etc/cni/net.d";

        // Create CNI directory if it doesn't exist
        fs::create_dir_all(cni_dir)
            .map_err(|e| AgentError::IoError(format!("Failed to create CNI dir: {}", e)))?;

        let networks = if config.networking.networks.is_empty() {
            vec![CniNetworkConfig {
                name: "mc-lan-static".to_string(),
                interface: None,
                cidr: None,
                gateway: None,
                range_start: None,
                range_end: None,
            }]
        } else {
            config.networking.networks.clone()
        };

        for network in networks {
            let cni_config = format!("{}/{}.conflist", cni_dir, network.name);
            if Path::new(&cni_config).exists() {
                info!(
                    "✓ CNI static network configuration already exists for {}",
                    network.name
                );
                continue;
            }

            let interface = if let Some(value) = network.interface {
                value
            } else {
                let detected = Self::detect_network_interface()?;
                info!("Detected network interface: {}", detected);
                detected
            };

            let cidr = match network.cidr.as_ref() {
                Some(value) => Self::normalize_cidr(value)?,
                None => Self::detect_interface_cidr(&interface)?,
            };
            let (default_start, default_end) = Self::cidr_usable_range(&cidr)?;
            let range_start = network.range_start.clone().unwrap_or(default_start);
            let range_end = network.range_end.clone().unwrap_or(default_end);
            let gateway = match network.gateway.as_ref() {
                Some(value) => value.clone(),
                None => Self::detect_default_gateway()?,
            };

            let config = format!(
                r#"{{
  "cniVersion": "1.0.0",
  "name": "{}",
  "plugins": [
    {{
      "type": "macvlan",
      "master": "{}",
      "mode": "bridge",
      "ipam": {{
        "type": "host-local",
        "ranges": [[
          {{
            "subnet": "{}",
            "rangeStart": "{}",
            "rangeEnd": "{}",
            "gateway": "{}"
          }}
        ]],
        "routes": [
          {{ "dst": "0.0.0.0/0" }}
        ]
      }}
    }}
  ]
}}"#,
                network.name, interface, cidr, range_start, range_end, gateway
            );

            fs::write(&cni_config, config)
                .map_err(|e| AgentError::IoError(format!("Failed to write CNI config: {}", e)))?;
            info!(
                "✓ Created CNI static network configuration at {}",
                cni_config
            );
        }

        Ok(())
    }

    /// Detect the primary network interface
    fn detect_network_interface() -> Result<String, AgentError> {
        // Try to get default route interface
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect default route: {}", e)))?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    while let Some(part) = parts.next() {
                        if part == "dev" {
                            return parts.next().map(|name| name.to_string());
                        }
                    }
                    None
                })
                .unwrap_or_default();
            if !interface.is_empty() {
                return Ok(interface);
            }
        }

        // Fallback: find first non-loopback interface
        let output = Command::new("ip")
            .args(["-o", "link", "show"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect interfaces: {}", e)))?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split(':');
                    let _idx = parts.next()?;
                    let name = parts.next()?.trim().to_string();
                    if name == "lo" {
                        None
                    } else {
                        Some(name)
                    }
                })
                .unwrap_or_default();
            if !interface.is_empty() {
                return Ok(interface);
            }
        }

        Err(AgentError::InternalError(
            "Could not detect network interface".to_string(),
        ))
    }

    fn detect_default_gateway() -> Result<String, AgentError> {
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect default gateway: {}", e)))?;

        if output.status.success() {
            let gateway = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    while let Some(part) = parts.next() {
                        if part == "via" {
                            return parts.next().map(|value| value.to_string());
                        }
                    }
                    None
                })
                .unwrap_or_default();
            if !gateway.is_empty() {
                return Ok(gateway);
            }
        }

        Err(AgentError::InternalError(
            "Could not detect default gateway".to_string(),
        ))
    }

    fn detect_interface_cidr(interface: &str) -> Result<String, AgentError> {
        let output = Command::new("ip")
            .args(["-4", "addr", "show", "dev", interface])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect interface CIDR: {}", e)))?;

        if output.status.success() {
            let cidr = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    while let Some(part) = parts.next() {
                        if part == "inet" {
                            return parts.next().map(|value| value.to_string());
                        }
                    }
                    None
                })
                .unwrap_or_default();
            if !cidr.is_empty() {
                return Self::normalize_cidr(&cidr);
            }
        }

        Err(AgentError::InternalError(
            "Could not detect interface CIDR".to_string(),
        ))
    }

    fn normalize_cidr(cidr: &str) -> Result<String, AgentError> {
        let (addr_str, prefix_str) = cidr
            .split_once('/')
            .ok_or_else(|| AgentError::InvalidRequest("Invalid CIDR format".to_string()))?;
        let prefix: u32 = prefix_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR prefix".to_string()))?;
        if prefix > 32 {
            return Err(AgentError::InvalidRequest(
                "Invalid CIDR prefix".to_string(),
            ));
        }

        let addr: std::net::Ipv4Addr = addr_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR address".to_string()))?;
        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        Ok(format!("{}/{}", std::net::Ipv4Addr::from(network), prefix))
    }

    fn cidr_usable_range(cidr: &str) -> Result<(String, String), AgentError> {
        let (addr_str, prefix_str) = cidr
            .split_once('/')
            .ok_or_else(|| AgentError::InvalidRequest("Invalid CIDR format".to_string()))?;
        let prefix: u32 = prefix_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR prefix".to_string()))?;
        if prefix > 32 {
            return Err(AgentError::InvalidRequest(
                "Invalid CIDR prefix".to_string(),
            ));
        }

        let addr: std::net::Ipv4Addr = addr_str
            .parse()
            .map_err(|_| AgentError::InvalidRequest("Invalid CIDR address".to_string()))?;
        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        let broadcast = network | (!mask);

        if broadcast <= network + 1 {
            return Err(AgentError::InvalidRequest(
                "CIDR has no usable addresses".to_string(),
            ));
        }

        let start = network + 1;
        let end = broadcast - 1;
        Ok((
            std::net::Ipv4Addr::from(start).to_string(),
            std::net::Ipv4Addr::from(end).to_string(),
        ))
    }

    /// Helper to run a command and check for errors
    fn run_command(cmd: &str, args: &[&str], stdin: Option<&str>) -> Result<(), AgentError> {
        let mut command = Command::new(cmd);
        command.args(args);
        if stdin.is_some() {
            command.stdin(std::process::Stdio::piped());
        }
        let mut child = command
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to run {}: {}", cmd, e)))?;
        if let Some(input) = stdin {
            if let Some(mut handle) = child.stdin.take() {
                use std::io::Write;
                handle.write_all(input.as_bytes()).map_err(|e| {
                    AgentError::IoError(format!("Failed to write to {}: {}", cmd, e))
                })?;
            }
        }
        let output = child
            .wait_with_output()
            .map_err(|e| AgentError::IoError(format!("Failed to run {}: {}", cmd, e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Command failed: {} {}\n{}", cmd, args.join(" "), stderr);
            return Err(AgentError::IoError(format!("Command failed: {}", stderr)));
        }

        Ok(())
    }

    fn run_command_allow_failure(cmd: &str, args: &[&str]) -> bool {
        match Command::new(cmd).args(args).status() {
            Ok(status) => status.success(),
            Err(_) => false,
        }
    }
}
