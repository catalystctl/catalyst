use std::path::PathBuf;
use tokio::fs;
use tracing::{error, info};

use crate::{AgentConfig, AgentError, AgentResult};

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

    /// Download the latest agent binary from the backend.
    pub async fn download_update(&self) -> AgentResult<PathBuf> {
        let download_url = format!("{}/api/agent/download", self.backend_url);
        // Place the temporary file next to the current binary so that
        // `rename` is guaranteed to be atomic (same filesystem).
        let temp_path = self.current_binary_path.with_extension("update");

        info!("Downloading agent update from {}", download_url);

        let client = reqwest::Client::new();
        let response = client
            .get(&download_url)
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| AgentError::NetworkError(format!("Failed to download update: {}", e)))?;

        if !response.status().is_success() {
            return Err(AgentError::NetworkError(format!(
                "Download failed with status: {}",
                response.status()
            )));
        }

        let bytes = response.bytes().await.map_err(|e| {
            AgentError::NetworkError(format!("Failed to read download response: {}", e))
        })?;

        fs::write(&temp_path, &bytes).await.map_err(|e| {
            AgentError::FileSystemError(format!("Failed to write update file: {}", e))
        })?;

        // Make executable on Unix.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&temp_path)
                .await
                .map_err(|e| AgentError::IoError(e.to_string()))?
                .permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&temp_path, perms)
                .await
                .map_err(|e| AgentError::IoError(e.to_string()))?;
        }

        info!("Agent update downloaded to {:?}", temp_path);
        Ok(temp_path)
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
