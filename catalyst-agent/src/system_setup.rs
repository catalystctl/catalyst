use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use tokio::io::AsyncWriteExt;
use tracing::{error, info, warn};

use sha2::{Digest, Sha256};

use crate::config::CniNetworkConfig;
use crate::{AgentConfig, AgentError};

// ---------------------------------------------------------------------------
// Sudo helper – prompts for password once, then reuses it for all install
// commands that need elevated privileges.
// ---------------------------------------------------------------------------

static SUDO_PASSWORD: Mutex<Option<String>> = Mutex::new(None);

/// Check whether the current process is running as root (effective UID 0).
fn is_root() -> bool {
    // SAFETY: geteuid() is a simple syscall that always succeeds.
    unsafe { libc::geteuid() == 0 }
}

/// Prompt the user for their sudo password via `/dev/tty` (so it works even
/// when stdin is redirected).  The password is stored in a global mutex so
/// subsequent calls reuse it.
fn ensure_sudo_password() -> Result<(), AgentError> {
    if is_root() {
        return Ok(());
    }

    // Fast path – already cached.
    {
        let guard = SUDO_PASSWORD.lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
    }

    // Open /dev/tty directly so we can prompt even if stdin is a pipe.
    let mut tty = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/tty")
        .map_err(|e| {
            AgentError::PermissionDenied(format!(
                "Cannot open /dev/tty for sudo prompt: {}. \
                 Please either run the agent as root or ensure a TTY is available.",
                e
            ))
        })?;

    // First, probe whether the user has passwordless sudo.
    let probe = Command::new("sudo").args(["-n", "true"]).status();
    if let Ok(status) = probe {
        if status.success() {
            // Passwordless sudo works – cache an empty marker.
            let mut guard = SUDO_PASSWORD.lock().unwrap();
            *guard = Some(String::new());
            return Ok(());
        }
    }

    let _ = tty.write_all(b"[catalyst-agent] sudo password: ");
    let _ = tty.flush();

    let mut password = String::new();
    let mut reader = BufReader::new(&tty);
    if reader.read_line(&mut password).is_err() {
        return Err(AgentError::PermissionDenied(
            "Failed to read sudo password".to_string(),
        ));
    }
    // Trim trailing newline/CR but keep everything else.
    let password = password
        .trim_end_matches('\n')
        .trim_end_matches('\r')
        .to_string();

    // Verify the password actually works.
    let mut verify = Command::new("sudo")
        .args(["-S", "-p", "", "true"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AgentError::PermissionDenied(format!("Failed to invoke sudo: {}", e)))?;
    if let Some(mut stdin) = verify.stdin.take() {
        let _ = writeln!(stdin, "{}", password);
    }
    match verify.wait() {
        Ok(status) if status.success() => {
            let mut guard = SUDO_PASSWORD.lock().unwrap();
            *guard = Some(password);
            Ok(())
        }
        _ => Err(AgentError::PermissionDenied(
            "sudo authentication failed – wrong password or insufficient privileges".to_string(),
        )),
    }
}

/// Return the cached sudo password, calling `ensure_sudo_password` first if
/// needed.  Returns `None` when running as root (no sudo required).
fn get_sudo_password() -> Result<Option<String>, AgentError> {
    if is_root() {
        return Ok(None);
    }
    ensure_sudo_password()?;
    let guard = SUDO_PASSWORD.lock().unwrap();
    Ok(guard.clone())
}

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

        // 6. Ensure iptables is available (port forwarding / NAT)
        Self::ensure_iptables(&pkg_manager).await?;

        // 7. Ensure CNI plugin binaries are installed
        Self::ensure_cni_plugins(&pkg_manager).await?;

        // 8. Setup CNI networking only (static host-local IPAM)
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
            "apk" => {
                Self::run_command_allow_failure("apk", &["add", "--no-cache", "containerd"]).await
            }
            "apt" => {
                let _ = Self::run_command_allow_failure("apt-get", &["update", "-qq"]).await;
                Self::run_command_allow_failure("apt-get", &["install", "-y", "-qq", "containerd"])
                    .await
                    || Self::run_command_allow_failure(
                        "apt-get",
                        &["install", "-y", "-qq", "containerd.io"],
                    )
                    .await
            }
            "yum" | "dnf" => {
                Self::run_command_allow_failure(pkg_manager, &["install", "-y", "containerd"]).await
            }
            "pacman" => {
                Self::run_command_allow_failure("pacman", &["-S", "--noconfirm", "containerd"])
                    .await
            }
            "zypper" => {
                Self::run_command_allow_failure(
                    "zypper",
                    &["--non-interactive", "install", "containerd"],
                )
                .await
            }
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
            "apk" => Self::run_command_allow_failure("apk", &["add", "--no-cache", "runc"]).await,
            "apt" => {
                let _ = Self::run_command_allow_failure("apt-get", &["update", "-qq"]).await;
                Self::run_command_allow_failure("apt-get", &["install", "-y", "-qq", "runc"]).await
            }
            "yum" | "dnf" => {
                Self::run_command_allow_failure(pkg_manager, &["install", "-y", "runc"]).await
            }
            "pacman" => {
                Self::run_command_allow_failure("pacman", &["-S", "--noconfirm", "runc"]).await
            }
            "zypper" => {
                Self::run_command_allow_failure("zypper", &["--non-interactive", "install", "runc"])
                    .await
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

    /// Ensure containerd is started and socket exists, and the current user
    /// can access the socket.
    async fn ensure_containerd_running() -> Result<(), AgentError> {
        let has_systemctl = Command::new("which")
            .arg("systemctl")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check systemctl: {}", e)))?
            .status
            .success();

        // Ensure the socket is group-accessible.
        // containerd defaults to root:root 0600 which blocks non-root users.
        if let Err(e) = Self::configure_containerd_socket_access(has_systemctl).await {
            warn!("Containerd socket access configuration failed: {}", e);
        }

        // If the socket already exists, skip the restart — it was likely
        // started by the deploy script or a previous boot.  Restarting
        // containerd while the agent itself is starting can cause race
        // conditions and rapid crash-loops.
        if Path::new("/run/containerd/containerd.sock").exists() {
            info!("✓ containerd socket already present");
        } else if has_systemctl {
            Self::run_command("systemctl", &["daemon-reload"], None).await?;
            Self::run_command("systemctl", &["restart", "containerd"], None).await?;
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

        // Verify the current user can actually connect.
        if !is_root() {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            let meta = fs::metadata("/run/containerd/containerd.sock").map_err(|e| {
                AgentError::InternalError(format!("Cannot stat containerd socket: {}", e))
            })?;
            let mode = meta.permissions().mode();
            let uid = meta.uid();
            if uid == 0 && (mode & 0o006) == 0 {
                return Err(AgentError::PermissionDenied(
                    "containerd socket is owned by root with no group/other access. \
                     Please add the agent user to the 'containerd' group and restart the agent, \
                     or run the agent as root."
                        .to_string(),
                ));
            }
        }

        info!("✓ containerd service/socket ready");
        Ok(())
    }

    /// Configure containerd so the socket is accessible by the current user.
    /// On Debian/Ubuntu the default install is root:root 0600.
    /// We create a "containerd" system group, add the user to it, and drop a
    /// systemd override so the socket is created with that group.
    /// Returns `Ok(())` on success, logs warnings on failure but does not
    /// hard-fail so that the chmod fallback in `ensure_containerd_running`
    /// can still run.
    async fn configure_containerd_socket_access(has_systemctl: bool) -> Result<(), AgentError> {
        if is_root() {
            return Ok(());
        }

        let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());

        // 1. Create the containerd system group if it doesn't exist.
        //    Note: Alpine's busybox groupadd does not support --system;
        //    we try with the flag first, then retry without it.
        let has_group = Command::new("getent")
            .args(["group", "containerd"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !has_group {
            // getent may not exist on Alpine (busybox); double-check by
            // reading /etc/group directly.
            let group_exists = fs::read_to_string("/etc/group")
                .map(|contents| contents.lines().any(|line| line.starts_with("containerd:")))
                .unwrap_or(false);
            if !group_exists {
                let created =
                    Self::run_command_allow_failure("groupadd", &["--system", "containerd"]).await;
                if !created {
                    // Retry without --system (Alpine busybox compat).
                    let created_plain =
                        Self::run_command_allow_failure("groupadd", &["containerd"]).await;
                    if !created_plain {
                        warn!("Could not create containerd group (non-fatal)");
                    }
                }
            }
        }

        // 2. Add the current user to the group.
        if let Err(e) = Self::run_command("usermod", &["-aG", "containerd", &username], None).await
        {
            warn!("Could not add user to containerd group (non-fatal): {}", e);
        }

        // 3. Create a systemd override so containerd creates the socket with
        //    group "containerd" and mode 0660.
        //    Skip entirely on non-systemd systems (e.g. Alpine with OpenRC).
        if has_systemctl && std::path::Path::new("/run/systemd/system").exists() {
            let override_dir = "/etc/systemd/system/containerd.service.d";
            let override_file = format!("{}/override.conf", override_dir);

            // Only write if the override doesn't already exist.
            let exists = Path::new(&override_file).exists();
            if !exists {
                // Create the directory via sudo (needs elevated privileges).
                if let Err(e) = Self::run_command("mkdir", &["-p", override_dir], None).await {
                    warn!(
                        "Could not create containerd override dir (non-fatal): {}",
                        e
                    );
                    return Ok(());
                }

                let content = "[Service]\n\
                    ExecStartPre=-/bin/chown root:containerd /run/containerd\n\
                    ExecStartPost=-/bin/chmod 660 /run/containerd/containerd.sock\n";

                // Write to a user-writable temp location, then sudo-copy to
                // the protected systemd directory.
                let tmp = "/tmp/catalyst-containerd-override.tmp";
                if let Err(e) = fs::write(tmp, content).map_err(|e| {
                    AgentError::IoError(format!("Failed to write containerd override: {}", e))
                }) {
                    warn!(
                        "Could not write containerd override temp file (non-fatal): {}",
                        e
                    );
                    return Ok(());
                }

                if let Err(e) = Self::run_command("cp", &[tmp, &override_file], None).await {
                    warn!("Could not install containerd override (non-fatal): {}", e);
                    let _ = fs::remove_file(tmp);
                    return Ok(());
                }
                let _ = fs::remove_file(tmp);
            }
        }

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
                Self::run_command("apk", &["add", "--no-cache", "iproute2"], None).await?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None).await?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "iproute2"], None).await?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "iproute"], None).await?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "iproute2"], None).await?;
            }
            "zypper" => {
                Self::run_command(
                    "zypper",
                    &["--non-interactive", "install", "iproute2"],
                    None,
                )
                .await?;
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

    /// Ensure `iptables` is available (needed for port forwarding / NAT).
    async fn ensure_iptables(pkg_manager: &str) -> Result<(), AgentError> {
        if Command::new("which")
            .arg("iptables")
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to check iptables: {}", e)))?
            .status
            .success()
        {
            info!("✓ iptables already installed");
            return Ok(());
        }

        warn!("iptables not found, installing...");
        match pkg_manager {
            "apk" => {
                Self::run_command("apk", &["add", "--no-cache", "iptables"], None).await?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None).await?;
                Self::run_command("apt-get", &["install", "-y", "-qq", "iptables"], None).await?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "iptables"], None).await?;
            }
            "pacman" => {
                Self::run_command("pacman", &["-S", "--noconfirm", "iptables"], None).await?;
            }
            "zypper" => {
                Self::run_command(
                    "zypper",
                    &["--non-interactive", "install", "iptables"],
                    None,
                )
                .await?;
            }
            _ => {
                warn!("Automatic installation not supported for {}", pkg_manager);
                return Err(AgentError::InternalError(format!(
                    "Please install iptables manually for {}",
                    pkg_manager
                )));
            }
        }
        info!("✓ iptables installed");
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
                Self::run_command("apk", &["add", "--no-cache", "curl", "tar", "gzip"], None)
                    .await?;
            }
            "apt" => {
                Self::run_command("apt-get", &["update", "-qq"], None).await?;
                Self::run_command(
                    "apt-get",
                    &["install", "-y", "-qq", "curl", "tar", "gzip"],
                    None,
                )
                .await?;
            }
            "yum" | "dnf" => {
                Self::run_command(pkg_manager, &["install", "-y", "curl", "tar", "gzip"], None)
                    .await?;
            }
            "pacman" => {
                Self::run_command(
                    "pacman",
                    &["-S", "--noconfirm", "curl", "tar", "gzip"],
                    None,
                )
                .await?;
            }
            "zypper" => {
                Self::run_command(
                    "zypper",
                    &["--non-interactive", "install", "curl", "tar", "gzip"],
                    None,
                )
                .await?;
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
        let result = hasher.finalize();
        let mut hex = String::with_capacity(result.len() * 2);
        for b in result.iter() {
            use std::fmt::Write;
            let _ = write!(&mut hex, "{:02x}", b);
        }
        Ok(hex)
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
                let _ = Self::run_command_allow_failure("apt-get", &["update", "-qq"]).await;
                Self::run_command_allow_failure(
                    "apt-get",
                    &["install", "-y", "-qq", "containernetworking-plugins"],
                )
                .await
            }
            "apk" => {
                Self::run_command_allow_failure("apk", &["add", "--no-cache", "cni-plugins"]).await
            }
            "yum" | "dnf" => {
                Self::run_command_allow_failure(
                    pkg_manager,
                    &["install", "-y", "containernetworking-plugins"],
                )
                .await
            }
            "pacman" => {
                Self::run_command_allow_failure("pacman", &["-S", "--noconfirm", "cni-plugins"])
                    .await
            }
            "zypper" => {
                Self::run_command_allow_failure(
                    "zypper",
                    &["--non-interactive", "install", "cni-plugins"],
                )
                .await
            }
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
        Self::run_command("curl", &["-fsSL", "-o", &archive_path, &url], None).await?;

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
                )
                .await?;
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
        )
        .await?;
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
        // Check every CNI plugin directory used across distros:
        //   /opt/cni/bin           — upstream tarball / Debian packages
        //   /usr/libexec/cni       — Fedora / RHEL packages
        //   /usr/lib/cni           — Arch / Alpine / openSUSE packages
        const CNI_BIN_DIRS: [&str; 3] = ["/opt/cni/bin", "/usr/libexec/cni", "/usr/lib/cni"];

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
                    "CNI static network configuration exists for {}, updating if changed",
                    network.name
                );
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

            let config = serde_json::to_string_pretty(&serde_json::json!({
                "cniVersion": "1.0.0",
                "name": network.name,
                "plugins": [{
                    "type": "macvlan",
                    "master": interface,
                    "mode": "bridge",
                    "ipam": {
                        "type": "host-local",
                        "ranges": [[{
                            "subnet": cidr,
                            "rangeStart": range_start,
                            "rangeEnd": range_end,
                            "gateway": gateway
                        }]],
                        "routes": [{"dst": "0.0.0.0/0"}]
                    }
                }]
            }))?;

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
    /// Run a command that may need elevated privileges.
    /// Automatically prefixes with `sudo -S` when not root.
    async fn run_command(cmd: &str, args: &[&str], _stdin: Option<&str>) -> Result<(), AgentError> {
        let sudo_pw = get_sudo_password()?;

        let mut command = if sudo_pw.is_some() {
            let mut c = tokio::process::Command::new("sudo");
            c.args(["-S", "-p", ""]);
            c.arg(cmd);
            c.args(args);
            c
        } else {
            let mut c = tokio::process::Command::new(cmd);
            c.args(args);
            c
        };

        command.stdin(std::process::Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to run {}: {}", cmd, e)))?;

        // Feed the sudo password via stdin before waiting.
        if let Some(ref pw) = sudo_pw {
            if let Some(mut handle) = child.stdin.take() {
                let _ = handle.write_all(format!("{}\n", pw).as_bytes()).await;
            }
        }

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(300),
            child.wait_with_output(),
        )
        .await
        .map_err(|_| AgentError::IoError(format!("Command {} timed out after 5 minutes", cmd)))?
        .map_err(|e| AgentError::IoError(format!("Failed to run {}: {}", cmd, e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!("Command failed: {} {}\n{}", cmd, args.join(" "), stderr);
            return Err(AgentError::IoError(format!("Command failed: {}", stderr)));
        }

        Ok(())
    }

    async fn run_command_allow_failure(cmd: &str, args: &[&str]) -> bool {
        let sudo_pw = get_sudo_password().ok().flatten();

        let mut command = if sudo_pw.is_some() {
            let mut c = tokio::process::Command::new("sudo");
            c.args(["-S", "-p", ""]);
            c.arg(cmd);
            c.args(args);
            c
        } else {
            let mut c = tokio::process::Command::new(cmd);
            c.args(args);
            c
        };

        command.stdin(std::process::Stdio::piped());

        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(_) => return false,
        };

        if let Some(ref pw) = sudo_pw {
            if let Some(mut handle) = child.stdin.take() {
                let _ = handle.write_all(format!("{}\n", pw).as_bytes()).await;
            }
        }

        match tokio::time::timeout(
            std::time::Duration::from_secs(300),
            child.wait_with_output(),
        )
        .await
        {
            Ok(Ok(output)) => output.status.success(),
            _ => false,
        }
    }
}
