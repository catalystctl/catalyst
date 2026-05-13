use std::path::PathBuf;
use tokio::fs;
use tracing::{error, info, warn};

use crate::{AgentConfig, AgentError, AgentResult};

/// GitHub repository that hosts agent release binaries.
const AGENT_RELEASE_REPO: &str = "catalystctl/catalyst";

pub struct AgentUpdater {
    backend_url: String,
    current_binary_path: PathBuf,
}

impl AgentUpdater {
    pub fn new(config: &AgentConfig) -> Self {
        let backend_url = config.server.backend_url.clone();
        let current_binary_path =
            std::env::current_exe().unwrap_or_else(|_| PathBuf::from("./catalyst-agent"));
        Self {
            backend_url,
            current_binary_path,
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

    /// Try downloading the latest agent binary from GitHub Releases.
    async fn download_from_github(&self, temp_path: &PathBuf) -> AgentResult<()> {
        let asset_name = Self::asset_name();
        let download_url = format!(
            "https://github.com/{}/releases/latest/download/{}",
            AGENT_RELEASE_REPO, asset_name
        );

        info!(
            "Downloading agent update from GitHub Releases: {}",
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
    async fn download_from_backend(&self, temp_path: &PathBuf) -> AgentResult<()> {
        let download_url = format!("{}/api/agent/download", self.backend_url);

        info!(
            "Downloading agent update from backend fallback: {}",
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

    /// Download the latest agent binary, trying GitHub Releases first, then the backend.
    pub async fn download_update(&self) -> AgentResult<PathBuf> {
        // Place the temporary file next to the current binary so that
        // `rename` is guaranteed to be atomic (same filesystem).
        let temp_path = self.current_binary_path.with_extension("update");

        // Priority 1: GitHub Releases (pre-built, versioned binaries)
        match self.download_from_github(&temp_path).await {
            Ok(()) => return Ok(temp_path),
            Err(e) => {
                warn!(
                    "GitHub Releases download failed, trying backend fallback: {}",
                    e
                );
            }
        }

        // Priority 2: Backend download (for self-hosted / air-gapped deployments)
        match self.download_from_backend(&temp_path).await {
            Ok(()) => Ok(temp_path),
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

        // Backup current binary.
        if self.current_binary_path.exists() {
            fs::rename(&self.current_binary_path, &backup_path)
                .await
                .map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to backup current binary: {}", e))
                })?;
        }

        // Move new binary into place.
        fs::rename(&new_binary, &self.current_binary_path)
            .await
            .map_err(|e| {
                AgentError::FileSystemError(format!("Failed to install new binary: {}", e))
            })?;

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

    /// Full update flow: download and apply.
    pub async fn update(&self) -> AgentResult<()> {
        let new_binary = self.download_update().await?;
        self.apply_update(new_binary).await
    }
}
