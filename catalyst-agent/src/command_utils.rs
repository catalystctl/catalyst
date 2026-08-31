//! Shared command execution and URL helper utilities.
//!
//! Consolidates synchronous/asynchronous command runners and URL conversion
//! helpers that were previously duplicated between `storage_manager.rs`,
//! `system_setup.rs`, and `updater.rs`.

use std::io::Read;

use crate::{AgentError, AgentResult};

// ---------------------------------------------------------------------------
// Synchronous command execution (from storage_manager.rs)
// ---------------------------------------------------------------------------

/// Run a command synchronously with a default 600s timeout.
/// Returns an error if the command fails or times out.
pub fn run_command_sync(command: &str, args: &[&str]) -> AgentResult<()> {
    run_command_sync_with_timeout(command, args, 600)
}

/// Run a command synchronously, tolerating specific non-zero exit codes.
///
/// Some tools encode meaningful outcomes in their exit status — e2fsck
/// exits 0 when the filesystem is clean, 1 when it *corrected* errors,
/// and 2 when it corrected them and advises a reboot. Any code not in
/// `ok_codes` (including signal deaths, whose `status.code()` is None)
/// is still an error carrying the captured stderr.
pub fn run_command_sync_with_ok_codes(
    command: &str,
    args: &[&str],
    timeout_secs: u64,
    ok_codes: &[i32],
) -> AgentResult<()> {
    run_command_with_timeout(command, args, timeout_secs, false, ok_codes).map(|_| ())
}

/// Run a command synchronously with a custom timeout.
/// Returns an error if the command fails or times out.
pub fn run_command_sync_with_timeout(
    command: &str,
    args: &[&str],
    timeout_secs: u64,
) -> AgentResult<()> {
    run_command_with_timeout(command, args, timeout_secs, false, &[]).map(|_| ())
}

/// Run a command and capture stdout. stderr is included in the error on failure.
pub fn run_command_capture(command: &str, args: &[&str]) -> AgentResult<String> {
    run_command_with_timeout(command, args, 600, true, &[])
}

fn run_command_with_timeout(
    command: &str,
    args: &[&str],
    timeout_secs: u64,
    capture_stdout: bool,
    ok_codes: &[i32],
) -> AgentResult<String> {
    let mut child = std::process::Command::new(command)
        .args(args)
        .stdout(if capture_stdout {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        })
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AgentError::FileSystemError(format!("Failed to run {}: {}", command, e)))?;

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stderr = String::new();
                if let Some(mut err) = child.stderr.take() {
                    let _ = err.read_to_string(&mut stderr);
                }
                let mut stdout = String::new();
                if capture_stdout {
                    if let Some(mut out) = child.stdout.take() {
                        let _ = out.read_to_string(&mut stdout);
                    }
                }
                let code = status.code().unwrap_or(-1);
                if status.success() || ok_codes.contains(&code) {
                    return Ok(stdout);
                }
                let stderr = stderr.trim();
                return Err(AgentError::FileSystemError(if stderr.is_empty() {
                    format!("{} failed with status {}", command, status)
                } else {
                    format!("{} failed with status {}: {}", command, status, stderr)
                }));
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

// ---------------------------------------------------------------------------
// Host mount-namespace helpers
// ---------------------------------------------------------------------------

/// True when this process shares PID 1's mount namespace.
///
/// `ProtectSystem=` / `PrivateMounts=` (the remote-agent systemd unit) give the
/// agent a private mount NS. Loop-mounts created there are invisible to
/// containerd, so install files land on the host directory while the file
/// explorer lists the empty disk image.
pub fn same_mount_namespace_as_init() -> bool {
    match (
        std::fs::read_link("/proc/self/ns/mnt"),
        std::fs::read_link("/proc/1/ns/mnt"),
    ) {
        (Ok(self_ns), Ok(init_ns)) => self_ns == init_ns,
        // If we cannot tell, assume we are in the host NS (dev / non-Linux).
        _ => true,
    }
}

/// Run `command args` in PID 1's mount namespace via `nsenter`.
///
/// When we already share that namespace this is a direct exec. On failure we
/// do **not** fall back to a local `mount` — that is what caused the
/// file-explorer / container split-brain.
pub fn run_in_host_mount_ns(command: &str, args: &[&str]) -> AgentResult<()> {
    if same_mount_namespace_as_init() {
        return run_command_sync(command, args);
    }
    let mut ns_args: Vec<&str> = Vec::with_capacity(4 + args.len());
    ns_args.extend_from_slice(&["-t", "1", "-m", "--", command]);
    ns_args.extend_from_slice(args);
    run_command_sync("nsenter", &ns_args)
}

/// Like [`run_in_host_mount_ns`] but captures stdout.
pub fn run_in_host_mount_ns_capture(command: &str, args: &[&str]) -> AgentResult<String> {
    if same_mount_namespace_as_init() {
        return run_command_capture(command, args);
    }
    let mut ns_args: Vec<&str> = Vec::with_capacity(4 + args.len());
    ns_args.extend_from_slice(&["-t", "1", "-m", "--", command]);
    ns_args.extend_from_slice(args);
    run_command_capture("nsenter", &ns_args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_url_to_http_base_strips_ws_suffix() {
        assert_eq!(
            ws_url_to_http_base("wss://panel.example/ws"),
            "https://panel.example"
        );
        assert_eq!(
            ws_url_to_http_base("ws://localhost:3000/ws"),
            "http://localhost:3000"
        );
    }

    #[test]
    fn same_mount_namespace_as_init_does_not_panic() {
        // In CI / cargo test we share the host NS (or cannot read /proc/1).
        let _ = same_mount_namespace_as_init();
    }

    #[test]
    fn run_command_capture_returns_stdout() {
        let out = run_command_capture("echo", &["loop-ok"]).expect("echo");
        assert_eq!(out.trim(), "loop-ok");
    }

    #[test]
    fn run_command_capture_includes_stderr_on_failure() {
        let err = run_command_capture("sh", &["-c", "echo boom >&2; exit 7"]).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("7"), "{msg}");
        assert!(msg.contains("boom"), "{msg}");
    }
}
