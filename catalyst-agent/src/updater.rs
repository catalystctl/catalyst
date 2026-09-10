use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::{error, info, warn};

use crate::command_utils;
use crate::{AgentConfig, AgentError, AgentResult};

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Validate that a version string looks like semver (e.g. "1.12.2").
/// Prevents URL injection via malicious config or backend-sent version.
fn is_valid_version(v: &str) -> bool {
    v.chars().all(|c| c.is_ascii_digit() || c == '.')
        && v.split('.').count() >= 2
        && v.split('.')
            .all(|p| !p.is_empty() && p.parse::<u32>().is_ok())
}

/// GitHub repository that hosts agent release binaries.
/// Set from config.agent.release_repo (default: "catalystctl/catalyst").
pub struct AgentUpdater {
    backend_url: String,
    current_binary_path: PathBuf,
    release_repo: String,
}

/// Options for controlling the update behavior.
#[derive(Debug, Clone, Default)]
pub struct UpdateOptions {
    /// Specific version to download (e.g. "1.12.2"). If None, downloads latest.
    pub target_version: Option<String>,
    /// Allow installing a version older than the running agent. Audited.
    pub allow_downgrade: bool,
}

/// SEC-H-11: streaming download cap (256 MiB) + per-download timeout.
pub const MAX_UPDATE_BYTES: u64 = 256 * 1024 * 1024;
pub const UPDATE_DOWNLOAD_TIMEOUT_SECS: u64 = 300;

fn parse_semver(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    let patch = parts.next()?.parse::<u32>().ok()?;
    Some((major, minor, patch))
}

/// SEC-H-11: refuse downgrades (target < current) unless allow_downgrade,
/// which the caller must audit.
pub fn check_update_direction(
    current: &str,
    target: Option<&str>,
    allow_downgrade: bool,
) -> AgentResult<()> {
    let Some(t) = target else { return Ok(()) };
    let (Some(cur), Some(tgt)) = (parse_semver(current), parse_semver(t)) else {
        return Ok(());
    };
    if tgt < cur && !allow_downgrade {
        return Err(AgentError::SecurityViolation(format!(
            "Refusing downgrade {} -> {} without --allow-downgrade (audited)",
            current, t
        )));
    }
    Ok(())
}

/// SEC-H-11: reject http:// unless loopback; hard-fail invalid release_repo.
pub fn validate_release_repo(repo: &str) -> AgentResult<()> {
    let ok = repo
        .chars()
        .all(|c| c.is_alphanumeric() || c == '/' || c == '-' || c == '_' || c == '.')
        && repo.split('/').count() == 2
        && {
            let mut parts = repo.split('/');
            let (o, r) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
            !o.is_empty() && !r.is_empty() && o != "." && o != ".." && r != "." && r != ".."
        };
    if !ok {
        return Err(AgentError::SecurityViolation(format!(
            "Invalid release_repo '{}': expected 'owner/repo'",
            repo
        )));
    }
    Ok(())
}

pub fn backend_download_url_is_safe(backend_url: &str) -> bool {
    let lower = backend_url.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("wss://") {
        return true;
    }
    // http/ws only safe for loopback targets.
    if lower.starts_with("http://") || lower.starts_with("ws://") {
        let host = lower
            .split("://")
            .nth(1)
            .unwrap_or("")
            .split(['/', '?', ':'])
            .next()
            .unwrap_or("");
        return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]";
    }
    false
}

fn unpredictable_temp_path(anchor: &Path) -> PathBuf {
    // rand 0.10: rand::random() is the stable entry point.
    let v: u128 = rand::random();
    let suffix = format!("{:032x}", v);
    anchor.with_extension(format!("update-{}.tmp", suffix))
}

impl AgentUpdater {
    pub fn new(config: &AgentConfig) -> Self {
        let backend_url = config.server.backend_url.clone();
        let current_binary_path =
            std::env::current_exe().unwrap_or_else(|_| PathBuf::from("./catalyst-agent"));
        let release_repo = config.agent.release_repo.clone();

        // SEC-H-11: hard-fail invalid release_repo (was warn-only).
        if let Err(e) = validate_release_repo(&release_repo) {
            warn!("{} — update downloads will fail closed", e);
        }

        Self {
            backend_url,
            current_binary_path,
            release_repo,
        }
    }

    fn asset_arch() -> &'static str {
        #[cfg(target_arch = "x86_64")]
        {
            "x86_64"
        }
        #[cfg(target_arch = "aarch64")]
        {
            "aarch64"
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            "unknown"
        }
    }

    /// Detect the release asset name for the current architecture.
    fn asset_name() -> &'static str {
        #[cfg(target_arch = "x86_64")]
        {
            "catalyst-agent-x86_64-linux-musl"
        }
        #[cfg(target_arch = "aarch64")]
        {
            "catalyst-agent-aarch64-linux-musl"
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            "catalyst-agent-unknown-linux-musl"
        }
    }

    /// SEC-H-11: stream the body to disk with a byte cap + timeout instead
    /// of buffering the whole binary in RAM. Uses O_EXCL unpredictable temp.
    async fn stream_response_to_temp(
        response: reqwest::Response,
        temp_path: &PathBuf,
    ) -> AgentResult<()> {
        use futures::StreamExt;
        use tokio::io::AsyncWriteExt;
        // O_EXCL unpredictable temp: fail if the path already exists.
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(temp_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("create update temp: {}", e)))?;
        let mut out = tokio::io::BufWriter::new(file);
        let mut stream = response.bytes_stream();
        let mut total: u64 = 0;
        let deadline = tokio::time::Instant::now()
            + std::time::Duration::from_secs(UPDATE_DOWNLOAD_TIMEOUT_SECS);
        loop {
            if tokio::time::Instant::now() > deadline {
                let _ = tokio::fs::remove_file(temp_path).await;
                return Err(AgentError::NetworkError(
                    "Update download timed out".to_string(),
                ));
            }
            let chunk = tokio::time::timeout(std::time::Duration::from_secs(60), stream.next())
                .await
                .map_err(|_| AgentError::NetworkError("Update chunk timed out".to_string()))?;
            let Some(chunk) = chunk else { break };
            let bytes = chunk
                .map_err(|e| AgentError::NetworkError(format!("Update stream failed: {}", e)))?;
            total = total.saturating_add(bytes.len() as u64);
            if total > MAX_UPDATE_BYTES {
                drop(out);
                let _ = tokio::fs::remove_file(temp_path).await;
                return Err(AgentError::SecurityViolation(format!(
                    "Update exceeds {}MiB cap",
                    MAX_UPDATE_BYTES / 1024 / 1024
                )));
            }
            out.write_all(&bytes).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to write update file: {}", e))
            })?;
        }
        out.flush().await.map_err(|e| {
            AgentError::FileSystemError(format!("Failed to write update file: {}", e))
        })?;
        drop(out);
        if total < 1024 {
            let _ = tokio::fs::remove_file(temp_path).await;
            return Err(AgentError::NetworkError(
                "Update response too small — likely not a valid binary".to_string(),
            ));
        }
        Ok(())
    }

    /// Try downloading the agent binary from GitHub Releases.
    /// If target_version is set, downloads that specific tag; otherwise downloads latest.
    async fn download_from_github(
        &self,
        temp_path: &PathBuf,
        target_version: Option<&str>,
    ) -> AgentResult<()> {
        validate_release_repo(&self.release_repo)?;
        if let Some(ver) = target_version {
            if !is_valid_version(ver) {
                return Err(AgentError::SecurityViolation(format!(
                    "Invalid target version '{}': must be semver (e.g. 1.12.2)",
                    ver
                )));
            }
        }
        let asset_name = Self::asset_name();
        let download_url = match target_version {
            Some(ver) => format!(
                "https://github.com/{}/releases/download/v{}/{}",
                self.release_repo, ver, asset_name
            ),
            None => format!(
                "https://github.com/{}/releases/latest/download/{}",
                self.release_repo, asset_name
            ),
        };

        info!(
            "Downloading agent update from GitHub Releases (version={}): {}",
            target_version.unwrap_or("latest"),
            download_url
        );

        let client = reqwest::Client::new();
        let response = client
            .get(&download_url)
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| AgentError::NetworkError(format!("GitHub download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(AgentError::NetworkError(format!(
                "GitHub download failed with status: {}",
                response.status()
            )));
        }

        Self::stream_response_to_temp(response, temp_path).await?;

        self.make_executable(temp_path).await?;

        info!(
            "Agent update downloaded from GitHub Releases to {:?}",
            temp_path
        );
        Ok(())
    }

    /// Try downloading the agent binary from the Catalyst backend (fallback).
    async fn download_from_backend(
        &self,
        temp_path: &PathBuf,
        target_version: Option<&str>,
    ) -> AgentResult<()> {
        // SEC-H-11: reject http:// unless loopback.
        if !backend_download_url_is_safe(&self.backend_url) {
            return Err(AgentError::SecurityViolation(
                "Refusing backend update over cleartext http:// for non-loopback host".to_string(),
            ));
        }
        if let Some(ver) = target_version {
            if !is_valid_version(ver) {
                return Err(AgentError::SecurityViolation(format!(
                    "Invalid target version '{}': must be semver (e.g. 1.12.2)",
                    ver
                )));
            }
        }
        let mut download_url = format!(
            "{}/api/agent/download?arch={}",
            command_utils::ws_url_to_http_base(&self.backend_url),
            Self::asset_arch(),
        );
        if let Some(ver) = target_version {
            download_url = format!("{}&version={}", download_url, ver);
        }

        info!(
            "Downloading agent update from backend fallback (version={}): {}",
            target_version.unwrap_or("latest"),
            download_url
        );

        let client = reqwest::Client::new();
        let response = client
            .get(&download_url)
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| AgentError::NetworkError(format!("Backend download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(AgentError::NetworkError(format!(
                "Backend download failed with status: {}",
                response.status()
            )));
        }

        Self::stream_response_to_temp(response, temp_path).await?;

        self.make_executable(temp_path).await?;

        info!("Agent update downloaded from backend to {:?}", temp_path);
        Ok(())
    }

    /// Download the .sha256 checksum from the backend's sidecar endpoint.
    async fn download_checksum_from_backend(
        &self,
        target_version: Option<&str>,
    ) -> AgentResult<String> {
        let mut checksum_url = format!(
            "{}/api/agent/download-checksum?arch={}",
            command_utils::ws_url_to_http_base(&self.backend_url),
            Self::asset_arch(),
        );
        if let Some(ver) = target_version {
            checksum_url = format!("{}&version={}", checksum_url, ver);
        }

        let client = reqwest::Client::new();
        let response = client
            .get(&checksum_url)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| {
                AgentError::NetworkError(format!("Backend checksum download failed: {}", e))
            })?;

        if !response.status().is_success() {
            return Err(AgentError::NetworkError(format!(
                "Backend checksum download failed with status: {}",
                response.status()
            )));
        }

        let text = response.text().await.map_err(|e| {
            AgentError::NetworkError(format!("Failed to read backend checksum response: {}", e))
        })?;

        let hash = text.split_whitespace().next().unwrap_or("").to_string();
        if hash.len() != 64 {
            return Err(AgentError::SecurityViolation(
                "Backend checksum has invalid length (expected 64 hex chars)".to_string(),
            ));
        }
        Ok(hash)
    }

    /// Set executable permissions on a file (Unix only).
    async fn make_executable(&self, path: &PathBuf) -> AgentResult<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(path)
                .await
                .map_err(|e| AgentError::IoError(e.to_string()))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(path, perms)
                .await
                .map_err(|e| AgentError::IoError(e.to_string()))?;
        }
        Ok(())
    }

    /// Download the .sha256 checksum sidecar file from GitHub Releases.
    /// The release pipeline already generates these files alongside the binary.
    async fn download_checksum_from_github(
        &self,
        target_version: Option<&str>,
    ) -> AgentResult<String> {
        if let Some(ver) = target_version {
            if !is_valid_version(ver) {
                return Err(AgentError::SecurityViolation(format!(
                    "Invalid target version '{}': must be semver (e.g. 1.12.2)",
                    ver
                )));
            }
        }
        let asset_name = Self::asset_name();
        let checksum_url = match target_version {
            Some(ver) => format!(
                "https://github.com/{}/releases/download/v{}/{}.sha256",
                self.release_repo, ver, asset_name
            ),
            None => format!(
                "https://github.com/{}/releases/latest/download/{}.sha256",
                self.release_repo, asset_name
            ),
        };

        let client = reqwest::Client::new();
        let response = client
            .get(&checksum_url)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| AgentError::NetworkError(format!("Checksum download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(AgentError::NetworkError(format!(
                "Checksum download failed with status: {}",
                response.status()
            )));
        }

        let text = response.text().await.map_err(|e| {
            AgentError::NetworkError(format!("Failed to read checksum response: {}", e))
        })?;

        // SHA-256 checksum files are typically "hash  filename" or just "hash"
        let hash = text.split_whitespace().next().unwrap_or("").to_string();
        if hash.len() != 64 {
            return Err(AgentError::SecurityViolation(
                "Downloaded checksum has invalid length (expected 64 hex chars)".to_string(),
            ));
        }
        Ok(hash)
    }

    /// Verify the SHA-256 checksum of a downloaded binary.
    /// Uses simple string comparison — the hash of a public release binary
    /// is not a secret, so constant-time comparison is unnecessary here.
    async fn verify_checksum(path: &PathBuf, expected_hex: &str) -> AgentResult<()> {
        use sha2::{Digest, Sha256};
        let data = fs::read(path).await.map_err(|e| {
            AgentError::FileSystemError(format!("Failed to read binary for checksum: {}", e))
        })?;
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let result = hasher.finalize();
        let actual_hex: String = result.iter().map(|b| format!("{:02x}", b)).collect();
        if actual_hex != expected_hex {
            return Err(AgentError::SecurityViolation(format!(
                "Binary checksum mismatch: expected {}, got {}",
                expected_hex, actual_hex
            )));
        }
        Ok(())
    }

    /// Download the agent binary, trying GitHub Releases first, then the backend.
    /// Verifies SHA-256 checksum when a sidecar .sha256 file is available.
    pub async fn download_update(&self, options: &UpdateOptions) -> AgentResult<PathBuf> {
        // SEC-H-11: enforce target>=current unless --allow-downgrade (audited).
        check_update_direction(
            CURRENT_VERSION,
            options.target_version.as_deref(),
            options.allow_downgrade,
        )?;
        if options.allow_downgrade {
            warn!(
                "Agent update with --allow-downgrade to {:?} (audit)",
                options.target_version
            );
        }
        // Place the temporary file next to the current binary so that
        // `rename` is guaranteed to be atomic (same filesystem).
        // SEC-H-11: O_EXCL unpredictable temp (no fixed "update" sibling).
        let temp_path = unpredictable_temp_path(&self.current_binary_path);

        // Priority 1: GitHub Releases (pre-built, versioned binaries)
        match self
            .download_from_github(&temp_path, options.target_version.as_deref())
            .await
        {
            Ok(()) => {
                // Verify checksum from GitHub .sha256 sidecar file.
                // The release pipeline already generates these files.
                match self
                    .download_checksum_from_github(options.target_version.as_deref())
                    .await
                {
                    Ok(expected) => {
                        if let Err(e) = Self::verify_checksum(&temp_path, &expected).await {
                            let _ = fs::remove_file(&temp_path).await;
                            warn!("GitHub binary checksum verification failed: {}", e);
                            // Fall through to backend fallback — do NOT use unverified binary
                        } else {
                            info!("GitHub update checksum verified successfully");
                            return Ok(temp_path);
                        }
                    }
                    Err(e) => {
                        // Checksums are now mandatory. A blocked checksum endpoint
                        // must not let a MITM serve a malicious agent binary.
                        // (May require sidecar .sha256 files in air-gapped setups — intended.)
                        let _ = fs::remove_file(&temp_path).await;
                        return Err(AgentError::SecurityViolation(format!(
                            "GitHub checksum download failed — refusing to use unverified binary: {}",
                            e
                        )));
                    }
                }
            }
            Err(e) => {
                warn!(
                    "GitHub Releases download failed, trying backend fallback: {}",
                    e
                );
            }
        }

        // Priority 2: Backend download (for self-hosted / air-gapped deployments)
        match self
            .download_from_backend(&temp_path, options.target_version.as_deref())
            .await
        {
            Ok(()) => {
                // Attempt checksum verification from the backend sidecar.
                match self
                    .download_checksum_from_backend(options.target_version.as_deref())
                    .await
                {
                    Ok(expected) => {
                        if let Err(e) = Self::verify_checksum(&temp_path, &expected).await {
                            let _ = fs::remove_file(&temp_path).await;
                            warn!("Backend binary checksum verification failed: {}", e);
                            return Err(e);
                        }
                        info!("Backend update checksum verified successfully");
                    }
                    Err(e) => {
                        // Checksums are now mandatory — reject the unverified binary.
                        // (May require sidecar checksum files in air-gapped setups — intended.)
                        let _ = fs::remove_file(&temp_path).await;
                        return Err(AgentError::SecurityViolation(format!(
                            "Backend checksum download failed — refusing to use unverified binary: {}",
                            e
                        )));
                    }
                }
                Ok(temp_path)
            }
            Err(e) => {
                error!("Backend download also failed: {}", e);
                Err(e)
            }
        }
    }

    /// Apply the update by replacing the current binary and restarting the process.
    pub async fn apply_update(&self, new_binary: PathBuf) -> AgentResult<()> {
        let backup_path = self.current_binary_path.with_extension("backup");

        info!(
            "Applying agent update: {:?} -> {:?}",
            new_binary, self.current_binary_path
        );

        // Backup current binary by hard-linking it. A hardlink is
        // instant (same filesystem) and preserves the inode so that
        // the running process can keep reading its own binary from
        // the original path even after we rename the hardlink away.
        if self.current_binary_path.exists() {
            // Remove stale backup if present.
            let _ = fs::remove_file(&backup_path).await;
            fs::hard_link(&self.current_binary_path, &backup_path)
                .await
                .map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to backup current binary: {}", e))
                })?;
        }

        // Move new binary into place. This is a single atomic
        // rename on the same filesystem — if the process crashes
        // before this point the old binary is still in place; if it
        // crashes after, the new binary is ready. The hardlink
        // backup at `backup_path` still points at the old inode so
        // we can recover manually if needed.
        fs::rename(&new_binary, &self.current_binary_path)
            .await
            .map_err(|e| {
                AgentError::FileSystemError(format!("Failed to install new binary: {}", e))
            })?;

        // If rename failed, attempt to restore from backup.
        // (This branch is unreachable because the outer ? already returned,
        //  but the hardlink backup remains for manual recovery.)

        // Clean up backup — the old binary is no longer needed.
        let _ = fs::remove_file(&backup_path).await;

        info!("Agent binary updated successfully. Restarting...");

        // Collect arguments to forward to the new process.
        let args: Vec<String> = std::env::args().skip(1).collect();

        // On Unix, use exec to replace the current process cleanly.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let mut cmd = std::process::Command::new(&self.current_binary_path);
            cmd.args(&args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            let err = cmd.exec();
            error!("Failed to exec new process: {}", err);
            Err(AgentError::InternalError(format!(
                "Failed to restart: {}",
                err
            )))
        }

        // On non-Unix, spawn a new process and exit the current one.
        #[cfg(not(unix))]
        {
            let mut cmd = tokio::process::Command::new(&self.current_binary_path);
            cmd.args(&args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            let _child = cmd.spawn().map_err(|e| {
                AgentError::InternalError(format!("Failed to spawn new process: {}", e))
            })?;
            std::process::exit(0);
        }
    }

    /// Full update flow: download and apply. Uses target version if specified.
    pub async fn update(&self, options: &UpdateOptions) -> AgentResult<()> {
        // Skip update if we're already at the target version.
        if let Some(ref target) = options.target_version {
            if CURRENT_VERSION == target {
                info!(
                    "Agent is already at target version {}, skipping update",
                    target
                );
                return Ok(());
            }
            check_update_direction(CURRENT_VERSION, Some(target), options.allow_downgrade)?;
        }
        let new_binary = self.download_update(options).await?;
        self.apply_update(new_binary).await
    }

    /// Returns the current agent version.
    #[allow(dead_code)]
    pub fn current_version() -> &'static str {
        CURRENT_VERSION
    }
}

#[cfg(test)]
mod security_hardening_tests {
    use super::*;

    #[test]
    fn downgrade_refused_without_flag() {
        assert!(check_update_direction("1.44.0", Some("1.43.0"), false).is_err());
        assert!(check_update_direction("1.44.0", Some("1.43.0"), true).is_ok());
        assert!(check_update_direction("1.44.0", Some("1.45.0"), false).is_ok());
        assert!(check_update_direction("1.44.0", None, false).is_ok());
    }

    #[test]
    fn release_repo_hard_fail() {
        assert!(validate_release_repo("catalystctl/catalyst").is_ok());
        assert!(validate_release_repo("../../etc").is_err());
        assert!(validate_release_repo("no-slash").is_err());
        assert!(validate_release_repo("a/b/c").is_err());
        assert!(validate_release_repo("").is_err());
    }

    #[test]
    fn backend_cleartext_refused_unless_loopback() {
        assert!(backend_download_url_is_safe("https://panel.example/api"));
        assert!(backend_download_url_is_safe("http://127.0.0.1:3000/api"));
        assert!(backend_download_url_is_safe("http://localhost:3000/api"));
        assert!(!backend_download_url_is_safe("http://panel.example/api"));
    }

    #[test]
    fn update_temp_paths_unpredictable() {
        let anchor = PathBuf::from("/tmp/catalyst-agent");
        let a = unpredictable_temp_path(&anchor);
        let b = unpredictable_temp_path(&anchor);
        assert_ne!(a, b);
        assert!(a.parent() == anchor.parent());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_manager::ContainerdRuntime;

    #[test]
    fn valid_version_accepted() {
        assert!(is_valid_version("1.12.2"));
        assert!(is_valid_version("1.0"));
        assert!(is_valid_version("0.0.0"));
        assert!(is_valid_version("100.200.300"));
    }

    #[test]
    fn empty_version_rejected() {
        assert!(!is_valid_version(""));
        assert!(!is_valid_version("."));
        assert!(!is_valid_version(".."));
    }

    #[test]
    fn injection_attempts_rejected() {
        assert!(!is_valid_version("../etc/passwd"));
        assert!(!is_valid_version("1.2; rm -rf /"));
        assert!(!is_valid_version("1.2 "));
        assert!(!is_valid_version(" 1.2"));
        assert!(!is_valid_version("1.2\n"));
        assert!(!is_valid_version("1.2/"));
        assert!(!is_valid_version("v1.2.3"));
        assert!(!is_valid_version("1.2-rc1"));
    }

    #[test]
    fn qualify_image_ref_tests() {
        assert_eq!(
            ContainerdRuntime::qualify_image_ref("alpine:3.19"),
            "docker.io/library/alpine:3.19"
        );
        assert_eq!(
            ContainerdRuntime::qualify_image_ref("alpine"),
            "docker.io/library/alpine"
        );
        assert_eq!(
            ContainerdRuntime::qualify_image_ref("ghcr.io/org/img:tag"),
            "ghcr.io/org/img:tag"
        );
        assert_eq!(
            ContainerdRuntime::qualify_image_ref("user/repo:latest"),
            "user/repo:latest"
        );
    }
}
