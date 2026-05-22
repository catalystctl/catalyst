//! Shared command execution and URL helper utilities.
//!
//! Consolidates synchronous/asynchronous command runners and URL conversion
//! helpers that were previously duplicated between `storage_manager.rs`,
//! `system_setup.rs`, and `updater.rs`.

use crate::{AgentError, AgentResult};

// ---------------------------------------------------------------------------
// Synchronous command execution (from storage_manager.rs)
// ---------------------------------------------------------------------------

/// Run a command synchronously with a default 600s timeout.
/// Returns an error if the command fails or times out.
pub fn run_command_sync(command: &str, args: &[&str]) -> AgentResult<()> {
    run_command_sync_with_timeout(command, args, 600)
}

/// Run a command synchronously with a custom timeout.
/// Returns an error if the command fails or times out.
pub fn run_command_sync_with_timeout(
    command: &str,
    args: &[&str],
    timeout_secs: u64,
) -> AgentResult<()> {
    let mut child = std::process::Command::new(command)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AgentError::FileSystemError(format!("Failed to run {}: {}", command, e)))?;

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                return Err(AgentError::FileSystemError(format!(
                    "{} failed with status {}",
                    command, status
                )));
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(AgentError::FileSystemError(format!(
                        "{} timed out after {}s",
                        command, timeout_secs
                    )));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                return Err(AgentError::FileSystemError(format!(
                    "Failed to wait for {}: {}",
                    command, e
                )));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/// Derive an HTTP(S) base URL from a WebSocket backend_url.
/// Converts wss://host/ws -> https://host and ws://host/ws -> http://host.
pub fn ws_url_to_http_base(ws_url: &str) -> String {
    let mut base = ws_url
        .replace("wss://", "https://")
        .replace("ws://", "http://");
    // Strip the trailing "/ws" path segment (substring match, not character-set).
    if base.ends_with("/ws") {
        base = base[..base.len() - 3].to_string();
    }
    if base.ends_with('/') {
        base = base[..base.len() - 1].to_string();
    }
    base
}
