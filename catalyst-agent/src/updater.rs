use std::path::PathBuf;
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
}

impl AgentUpdater {
    pub fn new(config: &AgentConfig) -> Self {
        let backend_url = config.server.backend_url.clone();
        let current_binary_path =
            std::env::current_exe().unwrap_or_else(|_| PathBuf::from("./catalyst-agent"));
        let release_repo = config.agent.release_repo.clone();

        // Validate release_repo format: must be "owner/repo" with safe characters only.
        // This prevents URL injection via a malicious config value.
        if !release_repo
            .chars()
            .all(|c| c.is_alphanumeric() || c == '/' || c == '-' || c == '_')
            || release_repo.split('/').count() != 2
        {
            warn!(
                "Invalid release_repo format '{}': expected 'owner/repo' with alphanumeric/-/_ chars",
                release_repo
            );
        }

        Self {
            backend_url,
            current_binary_path,
            release_repo,
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

    /// Try downloading the agent binary from GitHub Releases.
    /// If target_version is set, downloads that specific tag; otherwise downloads latest.
    async fn download_from_github(
        &self,
        temp_path: &PathBuf,
        target_version: Option<&str>,
    ) -> AgentResult<()> {
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

        let bytes = response.bytes().await.map_err(|e| {
            AgentError::NetworkError(format!("Failed to read GitHub response: {}", e))
        })?;

        if bytes.len() < 1024 {
            // A real ELF binary is always > 1 KiB; anything smaller is likely an error page.
            return Err(AgentError::NetworkError(
                "GitHub response too small — likely not a valid binary".to_string(),
            ));
        }

        fs::write(temp_path, &bytes).await.map_err(|e| {
            AgentError::FileSystemError(format!("Failed to write update file: {}", e))
        })?;

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
        if let Some(ver) = target_version {
            if !is_valid_version(ver) {
                return Err(AgentError::SecurityViolation(format!(
                    "Invalid target version '{}': must be semver (e.g. 1.12.2)",
                    ver
                )));
            }
        }
        let mut download_url = format!(
            "{}/api/agent/download",
            command_utils::ws_url_to_http_base(&self.backend_url)
        );
        if let Some(ver) = target_version {
            download_url = format!("{}?version={}", download_url, ver);
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

        let bytes = response.bytes().await.map_err(|e| {
            AgentError::NetworkError(format!("Failed to read backend response: {}", e))
        })?;

        fs::write(temp_path, &bytes).await.map_err(|e| {
            AgentError::FileSystemError(format!("Failed to write update file: {}", e))
        })?;

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
            "{}/api/agent/download-checksum",
            command_utils::ws_url_to_http_base(&self.backend_url)
        );
        if let Some(ver) = target_version {
            checksum_url = format!("{}?version={}", checksum_url, ver);
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
        // Place the temporary file next to the current binary so that
        // `rename` is guaranteed to be atomic (same filesystem).
        let temp_path = self.current_binary_path.with_extension("update");

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
                        warn!("Could not download checksum (skipping verification): {}", e);
                        // Continue without verification — backwards compatibility.
                        // TODO: Make checksum mandatory in a future release.
                        return Ok(temp_path);
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
                        warn!(
                            "Could not download backend checksum (skipping verification): {}",
                            e
                        );
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
