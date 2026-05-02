use aes_gcm::aead::Aead;
use aes_gcm::{AeadCore, Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use futures::stream::SplitSink;
use futures::{SinkExt, StreamExt};
use regex::Regex;
use reqwest::Url;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, System};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{RwLock, Semaphore};
use tokio_tungstenite::connect_async_with_config;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::config::CniNetworkConfig;
use crate::{
    runtime_manager::rotate_logs, AgentConfig, AgentError, AgentResult, ContainerdRuntime,
    FileManager, FirewallManager, NetworkManager, StorageManager,
};

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;
const CONTAINER_SERVER_DIR: &str = "/data";
const CONTAINER_UID: u32 = 1000;
const CONTAINER_GID: u32 = 1000;
const MAX_BACKUP_UPLOAD_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10GB
const BACKUP_UPLOAD_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes
const MAX_CONSOLE_BATCH_BYTES: usize = 32768; // Max bytes to batch into a single console_output message

// ---------------------------------------------------------------------------
// Typed message structs for hot-path serialization (avoids json! allocation)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct ConsoleOutput<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    serverId: &'a str,
    stream: &'a str,
    data: &'a str,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct ServerStateUpdate<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    serverId: &'a str,
    state: &'a str,
    timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    portBindings: Option<HashMap<u16, u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exitCode: Option<i32>,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct EulaRequired<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    serverId: &'a str,
    serverUuid: &'a str,
    eulaText: &'a str,
    serverDir: &'a str,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct HealthReport<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    nodeId: &'a str,
    timestamp: i64,
    cpuPercent: f32,
    memoryUsageMb: u64,
    memoryTotalMb: u64,
    diskUsageMb: u64,
    diskTotalMb: u64,
    containerCount: usize,
    uptimeSeconds: u64,
    networkRxBytes: u64,
    networkTxBytes: u64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct ResourceStats<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    serverUuid: &'a str,
    cpuPercent: f64,
    memoryUsageMb: u64,
    networkRxBytes: u64,
    networkTxBytes: u64,
    diskIoMb: u64,
    diskUsageMb: u64,
    diskTotalMb: u64,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct ResourceStatsEntry {
    serverUuid: String,
    cpuPercent: f64,
    memoryUsageMb: u64,
    networkRxBytes: u64,
    networkTxBytes: u64,
    diskIoMb: u64,
    diskUsageMb: u64,
    diskTotalMb: u64,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct ResourceStatsBatch {
    #[serde(rename = "type")]
    ty: &'static str,
    metrics: Vec<ResourceStatsEntry>,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
struct ServerStateSync<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    serverUuid: &'a str,
    containerId: &'a str,
    state: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    exitCode: Option<i32>,
    timestamp: i64,
}

/// Shell-escape a value for safe interpolation into a bash script.
/// Wraps the value in single quotes and escapes any embedded single quotes.
fn shell_escape_value(value: &str) -> String {
    // Single-quoting in bash prevents all interpretation except for single quotes themselves.
    // To include a literal single quote: end the single-quoted string, add an escaped quote, restart.
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

/// Detect whether a startup command requires bash rather than plain /bin/sh.
/// Returns true when the command uses bash-specific features that dash/sh cannot handle.
pub fn requires_bash(command: &str) -> bool {
    // Process substitution: $( <(...) )
    if command.contains("<(") || command.contains(">(") {
        return true;
    }
    // [[ double-bracket test ]]
    if command.contains("[[") {
        return true;
    }
    // Array syntax: var=( ... ) or ${arr[@]}
    static ARRAY_RE: OnceLock<Regex> = OnceLock::new();
    let re =
        ARRAY_RE.get_or_init(|| Regex::new(r"\w+=\(|\$\{\w+\[@]\}").expect("valid array regex"));
    if re.is_match(command) {
        return true;
    }
    false
}

/// Normalize common bash arithmetic condition syntax so startup commands run under /bin/sh.
/// Example: `((1))` -> `[ $((1)) -ne 0 ]`
fn normalize_startup_for_sh(command: &str) -> String {
    static ARITH_COND_RE: OnceLock<Regex> = OnceLock::new();
    let re = ARITH_COND_RE.get_or_init(|| {
        Regex::new(r"\(\(\s*([^()]*)\s*\)\)").expect("valid arithmetic condition regex")
    });
    re.replace_all(command, |caps: &regex::Captures<'_>| {
        let expr = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        if expr.is_empty() {
            "[ 0 -ne 0 ]".to_string()
        } else {
            format!("[ $(( {} )) -ne 0 ]", expr)
        }
    })
    .into_owned()
}

/// Split terminal output into complete lines and a trailing partial fragment.
///
/// Handles three line-termination styles:
/// - `\n`         → normal newline
/// - `\r\n`       → Windows-style newline
/// - `\r`         → carriage return (Paper/Minecraft overwrites current line)
///
/// For `\r` we emulate terminal behaviour: everything since the previous
/// terminator (or start of slice) up to the `\r` is one line, and the next
/// line starts fresh after it.  This prevents Paper's startup progress lines
/// from being concatenated together.
///
/// Returns `(Vec<line_text>, trailing_fragment)`.
/// `trailing_fragment` is the text after the *last* terminator; the caller
/// should keep it for the next read cycle so partial lines are not split.
fn split_terminal_lines(text: &str) -> (Vec<String>, &str) {
    let mut lines = Vec::new();
    let mut current_start = 0;

    for (i, ch) in text.char_indices() {
        // If we already advanced current_start past this character (e.g. after
        // a \r\n pair where \r set current_start = i + 2), skip it.
        if i < current_start {
            continue;
        }
        if ch == '\n' {
            let line = &text[current_start..i];
            lines.push(line.to_string());
            current_start = i + 1;
        } else if ch == '\r' {
            let line = &text[current_start..i];
            lines.push(line.to_string());
            // Also skip a following \n if present (\r\n)
            if text.as_bytes().get(i + 1) == Some(&b'\n') {
                current_start = i + 2;
            } else {
                current_start = i + 1;
            }
        }
    }

    let trailing = &text[current_start..];
    (lines, trailing)
}

fn validate_safe_path_segment(value: &str, label: &str) -> AgentResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(AgentError::InvalidRequest(format!(
            "Invalid {}: must be 1-128 characters",
            label
        )));
    }
    if trimmed.contains('\\') {
        return Err(AgentError::InvalidRequest(format!(
            "Invalid {}: contains \\\\",
            label
        )));
    }
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(AgentError::InvalidRequest(format!(
            "Invalid {}: must be a single path segment",
            label
        ))),
    }
}

#[derive(Clone, Debug)]
struct StopPolicy {
    stop_command: Option<String>,
    stop_signal: String,
}

impl Default for StopPolicy {
    fn default() -> Self {
        Self {
            stop_command: None,
            stop_signal: "SIGTERM".to_string(),
        }
    }
}

fn parse_stop_policy(msg: &Value) -> StopPolicy {
    let mut policy = StopPolicy::default();
    let Some(template) = msg.get("template").and_then(Value::as_object) else {
        return policy;
    };

    if let Some(command) = template
        .get("stopCommand")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        policy.stop_command = Some(command.to_string());
    }

    if let Some(raw_signal) = template
        .get("sendSignalTo")
        .and_then(Value::as_str)
        .map(str::trim)
    {
        let normalized = raw_signal.to_ascii_uppercase();
        if matches!(normalized.as_str(), "SIGTERM" | "SIGINT") {
            policy.stop_signal = normalized;
        }
    }

    policy
}

struct BackupUploadSession {
    file: tokio::fs::File,
    path: PathBuf,
    bytes_written: u64,
    last_activity: tokio::time::Instant,
}

/// Configuration for automatic container restart on crash.
#[derive(Clone, Debug)]
struct AutoRestartConfig {
    enabled: bool,
    delay_secs: u64,
    max_restarts: u32,
    window_secs: u64,
}

impl Default for AutoRestartConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            delay_secs: 10,
            max_restarts: 5,
            window_secs: 60,
        }
    }
}

/// Tracks restart attempts within a time window to prevent infinite loops.
#[derive(Default)]
struct RestartTracker {
    timestamps: VecDeque<Instant>,
}

impl RestartTracker {
    fn record_and_check(&mut self, max: u32, window: Duration) -> bool {
        let now = Instant::now();
        // Evict timestamps outside the window
        while let Some(front) = self.timestamps.front() {
            if now.duration_since(*front) > window {
                self.timestamps.pop_front();
            } else {
                break;
            }
        }
        if self.timestamps.len() as u32 >= max {
            return false; // Rate-limited
        }
        self.timestamps.push_back(now);
        true
    }
}

const BACKUP_ENCRYPTION_MAGIC: &[u8] = b"CATALYST_ENC_V1:";

fn parse_auto_restart_config(msg: &Value) -> AutoRestartConfig {
    let mut config = AutoRestartConfig::default();
    let Some(ar) = msg.get("autoRestart").and_then(Value::as_object) else {
        return config;
    };
    config.enabled = ar.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    config.delay_secs = ar
        .get("delay")
        .and_then(Value::as_u64)
        .unwrap_or(config.delay_secs);
    config.max_restarts = ar
        .get("maxRestarts")
        .and_then(Value::as_u64)
        .unwrap_or(config.max_restarts as u64) as u32;
    config.window_secs = ar
        .get("windowSecs")
        .and_then(Value::as_u64)
        .unwrap_or(config.window_secs);
    config
}

/// Set ownership of a directory to the container user (uid 1000:gid 1000)
/// so the game server process can read/write its data.
async fn chown_to_container_user(dir: &std::path::Path) -> std::io::Result<()> {
    use tokio::process::Command;
    let status = Command::new("chown")
        .arg("-R")
        .arg(format!("{}:{}", CONTAINER_UID, CONTAINER_GID))
        .arg(dir)
        .status()
        .await?;
    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("chown failed with exit code {:?}", status.code()),
        ));
    }
    Ok(())
}

fn encrypt_backup(data: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err("Encryption key must be 32 bytes for AES-256".to_string());
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;
    let nonce = Aes256Gcm::generate_nonce(&mut rand_08::thread_rng()); // 96-bit
    let ciphertext = cipher
        .encrypt(&nonce, data)
        .map_err(|e| format!("Encryption failed: {}", e))?;
    // Prepend magic header + nonce
    let mut result = BACKUP_ENCRYPTION_MAGIC.to_vec();
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

fn decrypt_backup(data: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err("Encryption key must be 32 bytes for AES-256".to_string());
    }
    if !data.starts_with(BACKUP_ENCRYPTION_MAGIC) {
        return Err("Not an encrypted backup".to_string());
    }
    let payload = &data[BACKUP_ENCRYPTION_MAGIC.len()..];
    if payload.len() < 12 {
        return Err("Invalid encrypted backup: too short".to_string());
    }
    let nonce = Nonce::from_slice(&payload[..12]);
    let ciphertext = &payload[12..];
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}

pub struct WebSocketHandler {
    config: Arc<AgentConfig>,
    runtime: Arc<ContainerdRuntime>,
    file_manager: Arc<FileManager>,
    storage_manager: Arc<StorageManager>,
    backend_connected: Arc<RwLock<bool>>,
    write: Arc<RwLock<Option<Arc<tokio::sync::Mutex<WsWrite>>>>>,
    active_log_streams: Arc<RwLock<HashSet<String>>>,
    monitor_tasks: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
    active_uploads: Arc<RwLock<HashMap<String, BackupUploadSession>>>,
    /// Auto-restart config per server_id, stored when start_server_with_details is called.
    auto_restart_configs: Arc<RwLock<HashMap<String, AutoRestartConfig>>>,
    /// Tracks restart attempt timestamps per server_id.
    restart_trackers: Arc<RwLock<HashMap<String, RestartTracker>>>,
    /// Stores the original start_server message JSON per server_id for auto-restart.
    start_server_messages: Arc<RwLock<HashMap<String, Value>>>,
    /// Maps server_id -> (container_id, primary_port) for health checking.
    server_ports: Arc<RwLock<HashMap<String, (String, u16)>>>,
    /// Tracks per-server health state to avoid duplicate unhealthy/healthy emissions.
    server_health_state: Arc<RwLock<HashMap<String, bool>>>,
    /// Active restore stream child processes keyed by requestId (for pipe relay transfer).
    active_restore_streams: Arc<RwLock<HashMap<String, tokio::process::Child>>>,
    /// The requestId of the currently active restore stream (at most one at a time).
    active_restore_request_id: Arc<RwLock<Option<String>>>,
    /// When set by the backend after an auth failure, the agent should wait this many
    /// seconds before reconnecting (progressive lockout).
    retry_after_seconds: Arc<RwLock<Option<u64>>>,
}

impl Clone for WebSocketHandler {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            file_manager: self.file_manager.clone(),
            storage_manager: self.storage_manager.clone(),
            backend_connected: self.backend_connected.clone(),
            write: self.write.clone(),
            active_log_streams: self.active_log_streams.clone(),
            monitor_tasks: self.monitor_tasks.clone(),
            active_uploads: self.active_uploads.clone(),
            auto_restart_configs: self.auto_restart_configs.clone(),
            restart_trackers: self.restart_trackers.clone(),
            start_server_messages: self.start_server_messages.clone(),
            server_ports: self.server_ports.clone(),
            server_health_state: self.server_health_state.clone(),
            active_restore_streams: self.active_restore_streams.clone(),
            active_restore_request_id: self.active_restore_request_id.clone(),
            retry_after_seconds: self.retry_after_seconds.clone(),
        }
    }
}

impl WebSocketHandler {
    fn select_agent_auth_token(&self) -> AgentResult<(&str, &'static str)> {
        let api_key = self.config.server.api_key.trim();
        if api_key.is_empty() {
            return Err(AgentError::ConfigError(
                "server.api_key is required for node authentication".to_string(),
            ));
        }
        Ok((api_key, "api_key"))
    }

    pub fn new(
        config: Arc<AgentConfig>,
        runtime: Arc<ContainerdRuntime>,
        file_manager: Arc<FileManager>,
        storage_manager: Arc<StorageManager>,
        backend_connected: Arc<RwLock<bool>>,
    ) -> Self {
        Self {
            config,
            runtime,
            file_manager,
            storage_manager,
            backend_connected,
            write: Arc::new(RwLock::new(None)),
            active_log_streams: Arc::new(RwLock::new(HashSet::new())),
            monitor_tasks: Arc::new(RwLock::new(HashMap::new())),
            active_uploads: Arc::new(RwLock::new(HashMap::new())),
            auto_restart_configs: Arc::new(RwLock::new(HashMap::new())),
            restart_trackers: Arc::new(RwLock::new(HashMap::new())),
            start_server_messages: Arc::new(RwLock::new(HashMap::new())),
            server_ports: Arc::new(RwLock::new(HashMap::new())),
            server_health_state: Arc::new(RwLock::new(HashMap::new())),
            active_restore_streams: Arc::new(RwLock::new(HashMap::new())),
            active_restore_request_id: Arc::new(RwLock::new(None)),
            retry_after_seconds: Arc::new(RwLock::new(None)),
        }
    }

    async fn set_backend_connected(&self, connected: bool) {
        let mut status = self.backend_connected.write().await;
        *status = connected;
    }

    async fn flush_buffered_metrics(
        &self,
        write: Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let buffered = match self.storage_manager.read_buffered_metrics().await {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to read buffered metrics: {}", e);
                return Ok(());
            }
        };

        if buffered.is_empty() {
            return Ok(());
        }

        info!("Flushing {} buffered metrics", buffered.len());

        let batch_size = 500usize;
        for chunk in buffered.chunks(batch_size) {
            // If the chunk is a single pre-batched message, send it directly
            let payload_text = if chunk.len() == 1
                && chunk[0].get("type").and_then(|t| t.as_str()) == Some("resource_stats_batch")
            {
                serde_json::to_string(&chunk[0]).unwrap_or_default()
            } else {
                let metrics_value = serde_json::Value::Array(chunk.to_vec());
                let payload = json!({ "type": "resource_stats_batch", "metrics": metrics_value });
                payload.to_string()
            };
            let mut w = write.lock().await;
            if let Err(e) = w.send(Message::Text(payload_text.into())).await {
                warn!("Failed to send buffered metrics batch: {}", e);
                // leave buffer intact - will retry on next connect
                return Ok(());
            }
        }

        // All batches sent successfully - clear buffer
        if let Err(e) = self.storage_manager.clear_buffered_metrics().await {
            warn!("Failed to clear buffered metrics: {}", e);
        }

        Ok(())
    }

    pub async fn connect_and_listen(&self) -> AgentResult<()> {
        // Spawn periodic log rotation task (every 5 minutes)
        {
            let runtime = self.runtime.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(300)).await;
                    // Rotate logs for all running containers
                    if let Ok(containers) = runtime.list_containers().await {
                        for c in &containers {
                            rotate_logs(&c.id).await;
                        }
                    }
                }
            });
        }

        loop {
            match self.establish_connection().await {
                Ok(()) => {
                    info!("WebSocket connection closed");
                }
                Err(e) => {
                    error!("Connection error: {}", e);
                }
            }

            self.set_backend_connected(false).await;
            let retry_secs = {
                let mut ra = self.retry_after_seconds.write().await;
                ra.take().unwrap_or(5)
            };
            if retry_secs > 5 {
                info!("Auth lockout: waiting {}s before reconnecting", retry_secs);
            }
            tokio::time::sleep(Duration::from_secs(retry_secs)).await;
        }
    }

    async fn establish_connection(&self) -> AgentResult<()> {
        self.set_backend_connected(false).await;

        let (auth_token, token_type) = self.select_agent_auth_token()?;

        // Enforce secure transport for non-local backends.
        let mut parsed_url = Url::parse(&self.config.server.backend_url)
            .map_err(|e| AgentError::ConfigError(format!("Invalid server.backend_url: {}", e)))?;
        match parsed_url.scheme() {
            "wss" => {}
            "ws" => {}
            other => {
                return Err(AgentError::ConfigError(format!(
                    "Invalid backend_url scheme '{}': expected ws:// or wss://",
                    other
                )));
            }
        }

        // Put non-sensitive identity data in the URL; send secrets in the handshake message.
        parsed_url
            .query_pairs_mut()
            .append_pair("nodeId", &self.config.server.node_id);
        let ws_url = parsed_url;

        info!(
            "Connecting to backend: {}?nodeId={}",
            self.config.server.backend_url, self.config.server.node_id
        );
        info!("Using {} auth token for agent connection", token_type);

        let ws_config = WebSocketConfig::default()
            .max_frame_size(Some(4 * 1024 * 1024))
            .max_message_size(Some(8 * 1024 * 1024));
        let (ws_stream, _) = connect_async_with_config(ws_url.as_str(), Some(ws_config), false)
            .await
            .map_err(|e| AgentError::NetworkError(format!("Failed to connect: {}", e)))?;

        info!("WebSocket connected to backend");

        let (write, mut read) = ws_stream.split();
        let write = Arc::new(tokio::sync::Mutex::new(write));
        {
            let mut guard = self.write.write().await;
            *guard = Some(write.clone());
        }

        // Send handshake
        let handshake = json!({
            "type": "node_handshake",
            "token": auth_token,
            "nodeId": self.config.server.node_id,
            "tokenType": token_type,
            "protocolVersion": "1.0",
        });

        {
            let mut w = write.lock().await;
            w.send(Message::Text(handshake.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        }

        info!("Handshake sent");

        // Restore console writers for any running containers
        // This is critical after reconnection to prevent console soft-lock
        if let Err(e) = self.runtime.restore_console_writers().await {
            warn!("Failed to restore console writers: {}", e);
        }

        // Restart console log streams for running containers.
        // After an agent reboot, the previous log streaming tasks are gone but
        // containers may still be running and writing to stdout/stderr files.
        self.restart_console_streams().await;

        // Reconcile server states to prevent drift after reconnection
        if let Err(e) = self.reconcile_server_states().await {
            warn!("Failed to reconcile server states: {}", e);
        }

        // Flush any buffered metrics now that we're connected
        if let Err(e) = self.flush_buffered_metrics(write.clone()).await {
            warn!("Failed to flush buffered metrics: {}", e);
        }

        // Connection-scoped background tasks. Abort on disconnect to avoid accumulation.
        let mut connection_tasks: Vec<tokio::task::JoinHandle<()>> = Vec::new();

        // Start heartbeat task
        let write_clone = write.clone();
        connection_tasks.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                debug!("Sending heartbeat");
                let heartbeat = json!({
                    "type": "heartbeat"
                });
                let mut w = write_clone.lock().await;
                let _ = w.send(Message::Text(heartbeat.to_string().into())).await;
            }
        }));

        // Start periodic state reconciliation task (every 5 minutes)
        // This catches any status drift that may occur
        let handler_clone = self.clone();
        connection_tasks.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                debug!("Running periodic state reconciliation");
                if let Err(e) = handler_clone.reconcile_server_states().await {
                    warn!("Periodic reconciliation failed: {}", e);
                }
            }
        }));

        // Start global event monitor for instant state syncing
        // This provides real-time state updates with zero polling
        let handler_clone = self.clone();
        connection_tasks.push(tokio::spawn(async move {
            if let Err(e) = handler_clone.monitor_global_events().await {
                error!("Global event monitor failed: {}", e);
            }
        }));

        // Garbage-collect stale backup upload sessions to avoid disk/fd leaks on partial uploads.
        let handler_clone = self.clone();
        connection_tasks.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                handler_clone.cleanup_stale_uploads().await;
            }
        }));

        // Start TCP health checker for running game servers
        let handler_clone = self.clone();
        connection_tasks.push(tokio::spawn(async move {
            handler_clone.spawn_health_checker().await;
        }));

        // Listen for messages
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Err(e) = self.handle_message(&text, &write).await {
                        error!("Error handling message: {}", e);
                    }
                }
                Ok(Message::Binary(data)) => {
                    // Binary frames are used for two purposes:
                    // 1. Pipe relay: raw tar data when active_restore_request_id is set
                    // 2. Upload backup chunks: first 16 bytes = requestId header
                    let restore_id = { self.active_restore_request_id.read().await.clone() };
                    let mut routed = false;
                    if let Some(restore_id) = restore_id {
                        match self.write_restore_stream_chunk(&restore_id, &data).await {
                            Ok(()) => routed = true,
                            Err(AgentError::InvalidRequest(ref msg))
                                if msg == "No active restore stream" =>
                            {
                                // Stream was closed between check and write; fall through to upload
                            }
                            Err(e) => {
                                error!("Error writing restore stream chunk: {}", e);
                                routed = true;
                            }
                        }
                    }
                    if !routed && data.len() > 16 {
                        let request_id = String::from_utf8_lossy(&data[..16])
                            .trim_end_matches('\0')
                            .to_string();
                        if let Err(e) = self
                            .handle_upload_backup_chunk_binary(&request_id, &data[16..])
                            .await
                        {
                            error!("Error handling binary backup chunk: {}", e);
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("Backend closed connection");
                    break;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
                _ => {}
            }
        }

        for task in connection_tasks {
            task.abort();
        }

        // Drop any in-progress uploads on disconnect to avoid stale sessions accumulating across
        // reconnects and to release file descriptors.
        self.cleanup_all_uploads().await;

        // Kill any active restore streams on disconnect
        {
            let mut streams = self.active_restore_streams.write().await;
            for (rid, mut child) in streams.drain() {
                child.stdin.take(); // close stdin
                child.kill().await.ok();
                warn!("Killed orphaned restore stream {} on disconnect", rid);
            }
        }

        {
            let mut guard = self.write.write().await;
            *guard = None;
        }

        Ok(())
    }

    async fn cleanup_all_uploads(&self) {
        let sessions: Vec<BackupUploadSession> = {
            let mut uploads = self.active_uploads.write().await;
            uploads.drain().map(|(_, session)| session).collect()
        };

        for session in sessions {
            let path = session.path.clone();
            drop(session.file);
            let _ = tokio::fs::remove_file(&path).await;
        }
    }

    async fn cleanup_stale_uploads(&self) {
        let now = tokio::time::Instant::now();
        let sessions: Vec<BackupUploadSession> = {
            let mut uploads = self.active_uploads.write().await;
            let stale_keys: Vec<String> = uploads
                .iter()
                .filter(|(_, session)| {
                    now.duration_since(session.last_activity) > BACKUP_UPLOAD_INACTIVITY_TIMEOUT
                })
                .map(|(key, _)| key.clone())
                .collect();

            stale_keys
                .into_iter()
                .filter_map(|key| uploads.remove(&key))
                .collect()
        };

        for session in sessions {
            let path = session.path.clone();
            drop(session.file);
            let _ = tokio::fs::remove_file(&path).await;
        }
    }

    async fn handle_message(
        &self,
        text: &str,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let msg: Value = serde_json::from_str(text)?;

        match msg["type"].as_str() {
            Some("server_control") => self.handle_server_control(&msg).await?,
            Some("install_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.install_server(&msg).await {
                        error!("Error in install_server handler: {}", e);
                    }
                });
            }
            Some("reinstall_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.reinstall_server(&msg).await {
                        error!("Error in reinstall_server handler: {}", e);
                    }
                });
            }
            Some("rebuild_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.rebuild_server(&msg).await {
                        error!("Error in rebuild_server handler: {}", e);
                    }
                });
            }
            Some("start_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.start_server_with_details(&msg).await {
                        error!("Error in start_server handler: {}", e);
                    }
                });
            }
            Some("stop_server") => {
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                let stop_policy = parse_stop_policy(&msg);
                self.stop_server(server_id, container_id, &stop_policy)
                    .await?;
            }
            Some("kill_server") => {
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                self.kill_server(server_id, container_id).await?;
            }
            Some("restart_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    let Some(server_uuid) = msg["serverUuid"].as_str() else {
                        error!("Error in restart_server handler: Missing serverUuid");
                        return;
                    };
                    let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                    let container_id = handler.resolve_container_id(server_id, server_uuid).await;
                    let stop_policy = parse_stop_policy(&msg);
                    let container_id_clone = container_id.clone();
                    if let Err(e) = handler
                        .stop_server(server_id, container_id_clone.clone(), &stop_policy)
                        .await
                    {
                        error!("Error in restart_server (stop) handler: {}", e);
                        return;
                    }
                    // Wait for container to actually stop (up to 30s) instead of hardcoded 2s
                    let wait_start = Instant::now();
                    loop {
                        if container_id_clone.is_empty() {
                            tokio::time::sleep(Duration::from_secs(1)).await;
                            break;
                        }
                        match handler
                            .runtime
                            .is_container_running(&container_id_clone)
                            .await
                        {
                            Ok(false) => break,
                            Ok(true) if wait_start.elapsed() > Duration::from_secs(30) => {
                                warn!(
                                    "Container {} did not stop within 30s, forcing kill",
                                    container_id_clone
                                );
                                if let Err(e) = handler
                                    .kill_server(server_id, container_id_clone.clone())
                                    .await
                                {
                                    error!("Force kill failed during restart: {}", e);
                                }
                                break;
                            }
                            _ => {}
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    if let Err(e) = handler.start_server_with_details(&msg).await {
                        error!("Error in restart_server (start) handler: {}", e);
                    }
                });
            }
            Some("delete_server") => {
                let server_uuid = msg["serverUuid"].as_str().unwrap_or("");
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                self.delete_server(server_id, server_uuid).await?;
            }
            Some("console_input") => self.handle_console_input(&msg).await?,
            Some("file_operation") => self.handle_file_operation(&msg).await?,
            Some("create_backup") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_create_backup(&msg, &write).await {
                        error!("Error in handle_create_backup handler: {}", e);
                    }
                });
            }
            Some("restore_backup") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_restore_backup(&msg, &write).await {
                        error!("Error in handle_restore_backup handler: {}", e);
                    }
                });
            }
            Some("delete_backup") => self.handle_delete_backup(&msg, write).await?,
            Some("download_backup_start") => self.handle_download_backup_start(&msg, write).await?,
            Some("download_backup") => self.handle_download_backup(&msg, write).await?,
            Some("upload_backup_start") => self.handle_upload_backup_start(&msg, write).await?,
            Some("upload_backup_chunk") => self.handle_upload_backup_chunk(&msg, write).await?,
            Some("upload_backup_complete") => {
                self.handle_upload_backup_complete(&msg, write).await?
            }
            Some("start_backup_stream") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_start_backup_stream(&msg, &write).await {
                        error!("Error in handle_start_backup_stream handler: {}", e);
                    }
                });
            }
            Some("prepare_restore_stream") => {
                self.handle_prepare_restore_stream(&msg, write).await?
            }
            Some("finish_restore_stream") => self.handle_finish_restore_stream(&msg, write).await?,
            Some("resize_storage") => self.handle_resize_storage(&msg, write).await?,
            Some("resume_console") => self.resume_console(&msg).await?,
            Some("request_immediate_stats") => {
                let target = msg["serverId"].as_str();
                info!(
                    target = target.unwrap_or("all"),
                    "Received immediate stats request from backend"
                );
                if let Err(e) = self.send_resource_stats(target).await {
                    warn!("Failed to send immediate stats: {}", e);
                }
            }
            Some("create_network") => self.handle_create_network(&msg, write).await?,
            Some("update_network") => self.handle_update_network(&msg, write).await?,
            Some("delete_network") => self.handle_delete_network(&msg, write).await?,
            Some("accept_eula") => self.handle_eula_response(&msg, true).await?,
            Some("decline_eula") => self.handle_eula_response(&msg, false).await?,
            Some("node_handshake_response") => {
                info!("Handshake accepted by backend");
                self.set_backend_connected(true).await;
            }
            Some("error") => {
                let error_type = msg["error"].as_str().unwrap_or("unknown");
                let retry_after = msg["retryAfterSeconds"].as_u64();
                match error_type {
                    "auth_lockout" => {
                        let secs = retry_after.unwrap_or(60);
                        warn!(
                            "Backend auth lockout active — must wait {}s before reconnecting",
                            secs
                        );
                        *self.retry_after_seconds.write().await = Some(secs);
                    }
                    "auth_failed" => {
                        let secs = retry_after.unwrap_or(5);
                        warn!("Backend rejected auth credentials — retrying in {}s", secs);
                        *self.retry_after_seconds.write().await = Some(secs);
                    }
                    _ => {
                        warn!("Backend error: {}", error_type);
                    }
                }
            }
            _ => {
                warn!("Unknown message type: {}", msg["type"]);
            }
        }

        Ok(())
    }

    async fn handle_server_control(&self, msg: &Value) -> AgentResult<()> {
        let action = msg["action"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing action".to_string()))?;

        if msg["suspended"].as_bool().unwrap_or(false) {
            return Err(AgentError::InvalidRequest(
                "Server is suspended".to_string(),
            ));
        }

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        let stop_policy = parse_stop_policy(msg);

        match action {
            "install" => self.install_server(msg).await?,
            "start" => {
                if container_id.is_empty() {
                    return Err(AgentError::ContainerError(format!(
                        "Container not found for server {}",
                        server_id
                    )));
                }
                self.start_server(server_id, container_id).await?
            }
            "stop" => {
                self.stop_server(server_id, container_id, &stop_policy)
                    .await?
            }
            "kill" => self.kill_server(server_id, container_id).await?,
            "restart" => {
                self.stop_server(server_id, container_id, &stop_policy)
                    .await?;
                tokio::time::sleep(Duration::from_secs(2)).await;
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                self.start_server(server_id, container_id).await?;
            }
            _ => {
                return Err(AgentError::InvalidRequest(format!(
                    "Unknown action: {}",
                    action
                )))
            }
        }

        Ok(())
    }

    async fn resume_console(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if container_id.is_empty() {
            debug!(
                "Resume console skipped; container not found for {} ({})",
                server_id, server_uuid
            );
            return Ok(());
        }

        if !self
            .runtime
            .is_container_running(&container_id)
            .await
            .unwrap_or(false)
        {
            debug!(
                "Resume console skipped; container not running: {}",
                container_id
            );
            return Ok(());
        }

        self.spawn_log_stream(server_id, &container_id);

        Ok(())
    }

    async fn resolve_console_container_id(
        &self,
        server_id: &str,
        server_uuid: &str,
    ) -> Option<String> {
        let server_id_exists = self.runtime.container_exists(server_id).await;
        let server_uuid_exists = if server_uuid != server_id {
            self.runtime.container_exists(server_uuid).await
        } else {
            false
        };

        if !server_id_exists && !server_uuid_exists {
            return None;
        }

        let server_id_running = if server_id_exists {
            self.runtime
                .is_container_running(server_id)
                .await
                .unwrap_or(false)
        } else {
            false
        };
        let server_uuid_running = if server_uuid_exists {
            self.runtime
                .is_container_running(server_uuid)
                .await
                .unwrap_or(false)
        } else {
            false
        };

        if server_id_running && !server_uuid_running {
            debug!(
                "Console container resolved to serverId {} (uuid {})",
                server_id, server_uuid
            );
            return Some(server_id.to_string());
        }

        if server_uuid_running && !server_id_running {
            warn!(
                "Console container resolved to uuid {} because serverId {} is not running",
                server_uuid, server_id
            );
            return Some(server_uuid.to_string());
        }

        if server_id_running && server_uuid_running {
            warn!(
                "Both serverId {} and uuid {} containers are running; using serverId",
                server_id, server_uuid
            );
            return Some(server_id.to_string());
        }

        if server_id_exists {
            debug!(
                "Console container resolved to serverId {} (uuid {}), container is stopped",
                server_id, server_uuid
            );
            return Some(server_id.to_string());
        }

        if server_uuid_exists {
            debug!(
                "Console container resolved to uuid {} (serverId {}), container is stopped",
                server_uuid, server_id
            );
            return Some(server_uuid.to_string());
        }

        None
    }

    async fn resolve_container_id(&self, server_id: &str, server_uuid: &str) -> String {
        self.resolve_console_container_id(server_id, server_uuid)
            .await
            .unwrap_or_default()
    }

    async fn cleanup_all_server_containers(
        &self,
        server_id: &str,
        server_uuid: &str,
    ) -> AgentResult<()> {
        let mut cleaned = 0;

        for container_name in &[server_id, server_uuid] {
            if self.runtime.container_exists(container_name).await {
                info!(
                    "Found container {} for server {}, removing during cleanup",
                    container_name, server_id
                );
                self.stop_monitor_task(server_id).await;
                if self
                    .runtime
                    .is_container_running(container_name)
                    .await
                    .unwrap_or(false)
                {
                    if let Err(e) = self.runtime.stop_container(container_name, 10).await {
                        warn!(
                            "Failed to stop container {}: {}, attempting kill",
                            container_name, e
                        );
                        let _ = self.runtime.kill_container(container_name, "SIGKILL").await;
                    }
                }
                if self.runtime.container_exists(container_name).await {
                    if let Err(e) = self.runtime.remove_container(container_name).await {
                        warn!("Failed to remove container {}: {}", container_name, e);
                    } else {
                        cleaned += 1;
                    }
                }
            }
        }

        if cleaned > 0 {
            info!("Cleaned up {} containers for server {}", cleaned, server_id);
            self.emit_console_output(
                server_id,
                "system",
                &format!(
                    "[Catalyst] Cleaned up {} container(s) during error state cleanup.\n",
                    cleaned
                ),
            )
            .await?;
        }

        Ok(())
    }

    async fn stop_monitor_task(&self, server_id: &str) {
        let mut tasks = self.monitor_tasks.write().await;
        if let Some(handle) = tasks.remove(server_id) {
            handle.abort();
        }
    }

    /// Stop all log streams for a server
    /// This is important when switching from installer container to game server container
    async fn stop_log_streams_for_server(&self, server_id: &str) {
        let mut streams = self.active_log_streams.write().await;
        // Remove all stream keys that start with server_id:
        streams.retain(|key| !key.starts_with(&format!("{}:", server_id)));
    }

    /// Restart console log streams for all running containers.
    /// This is critical after agent reboot/reconnect because the log streaming
    /// tasks are not persisted across process restarts, yet containers may still
    /// be running (managed by containerd) and writing to their stdout/stderr files.
    async fn restart_console_streams(&self) {
        let containers = match self.runtime.list_containers().await {
            Ok(c) => c,
            Err(e) => {
                warn!(
                    "Failed to list containers for console stream restart: {}",
                    e
                );
                return;
            }
        };
        let mut restarted = 0;
        for container in containers {
            if !container.status.contains("Up") || !container.managed {
                continue;
            }
            let server_id = normalize_container_name(&container.names);
            if server_id.is_empty() {
                continue;
            }
            // spawn_log_stream deduplicates internally, so this is safe to call
            // even if streams are already active (e.g. after a transient disconnect).
            self.spawn_log_stream(&server_id, &container.id);
            // Emit a system message so the frontend has a chance to re-associate
            // the console subscription with this new agent session.
            let _ = self
                .emit_console_output(
                    &server_id,
                    "system",
                    "[Catalyst] Agent reconnected. Console stream resumed.\n",
                )
                .await;
            restarted += 1;
        }
        if restarted > 0 {
            info!(
                "Restarted console streams for {} running container(s)",
                restarted
            );
        }
    }

    fn spawn_exit_monitor(&self, server_id: &str, container_id: &str) {
        let handler = self.clone();
        let server_id = server_id.to_string();
        let container_id = container_id.to_string();
        tokio::spawn(async move {
            // Atomically replace the monitor task while holding the lock to prevent race conditions
            let mut tasks = handler.monitor_tasks.write().await;
            if let Some(existing) = tasks.remove(&server_id) {
                existing.abort();
            }
            // Clone for the inner task to avoid borrow checker issues
            let monitor_handler = handler.clone();
            let monitor_server_id = server_id.clone();
            let monitor_container_id = container_id.clone();
            // Use containerd's event stream API for immediate exit notifications
            // This replaces polling and provides instant notification when containers exit
            let monitor = tokio::spawn(async move {
                // Subscribe to container events
                let event_stream = match monitor_handler
                    .runtime
                    .subscribe_to_container_events(&monitor_container_id)
                    .await
                {
                    Ok(stream) => stream,
                    Err(e) => {
                        error!(
                            "Failed to subscribe to events for {}: {}. Falling back to polling.",
                            monitor_container_id, e
                        );
                        // Fallback to polling if event stream fails
                        loop {
                            let running = monitor_handler
                                .runtime
                                .is_container_running(&monitor_container_id)
                                .await
                                .unwrap_or(false);
                            if !running {
                                let exit_code = monitor_handler
                                    .runtime
                                    .get_container_exit_code(&monitor_container_id)
                                    .await
                                    .unwrap_or(None);
                                let reason = match exit_code {
                                    Some(code) => format!("Container exited with code {}", code),
                                    None => "Container exited".to_string(),
                                };
                                monitor_handler
                                    .handle_container_exit(
                                        &monitor_server_id,
                                        &monitor_container_id,
                                        &reason,
                                        exit_code,
                                    )
                                    .await;
                                break;
                            }
                            tokio::time::sleep(Duration::from_secs(2)).await;
                        }
                        return;
                    }
                };

                // Take the event receiver from the containerd stream
                let mut receiver = event_stream.receiver;

                // Read events from containerd gRPC streaming
                while let Ok(Some(envelope)) = receiver.message().await {
                    let topic = &envelope.topic;
                    debug!("Container {} event topic: {}", monitor_container_id, topic);

                    // Check for exit-related events
                    if topic.contains("/tasks/exit") || topic.contains("/tasks/delete") {
                        // Container has stopped, get exit code
                        let exit_code = monitor_handler
                            .runtime
                            .get_container_exit_code(&monitor_container_id)
                            .await
                            .unwrap_or(None);
                        let reason = match exit_code {
                            Some(code) => format!("Container exited with code {}", code),
                            None => "Container exited".to_string(),
                        };
                        monitor_handler
                            .handle_container_exit(
                                &monitor_server_id,
                                &monitor_container_id,
                                &reason,
                                exit_code,
                            )
                            .await;
                        break;
                    }
                }

                // Clean up
                drop(receiver);
            });
            tasks.insert(server_id, monitor);
            // Lock is held until end of scope, ensuring atomic operation
        });
    }

    /// Handle a container exit: emit crash state and optionally auto-restart.
    /// If the server exited because the Minecraft EULA was not accepted, pause
    /// and wait for the user to respond via the frontend modal instead of
    /// marking the server as crashed or auto-restarting.
    async fn handle_container_exit(
        &self,
        server_id: &str,
        _container_id: &str,
        reason: &str,
        exit_code: Option<i32>,
    ) {
        // Clean up port tracking for this server
        self.server_ports.write().await.remove(server_id);
        self.server_health_state.write().await.remove(server_id);

        // Check for EULA requirement before considering auto-restart or crash.
        // If eula.txt exists but is not accepted, pause and prompt the user.
        let server_uuid = {
            let msgs = self.start_server_messages.read().await;
            msgs.get(server_id)
                .and_then(|m| m.get("serverUuid"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };

        if let Some(ref uuid) = server_uuid {
            let eula_path = self.config.server.data_dir.join(uuid).join("eula.txt");
            if eula_path.exists() {
                if let Ok(content) = tokio::fs::read_to_string(&eula_path).await {
                    if !content.to_lowercase().contains("eula=true") {
                        info!(
                            "EULA not accepted for server {} (exit {:?}), pausing",
                            server_id, exit_code
                        );
                        let _ = self
                            .emit_console_output(
                                server_id,
                                "system",
                                "[Catalyst] Server stopped: Minecraft EULA must be accepted before starting.\n",
                            )
                            .await;
                        let _ = self
                            .emit_eula_required(
                                server_id,
                                uuid,
                                &content,
                                &self.config.server.data_dir.join(uuid).to_string_lossy(),
                            )
                            .await;
                        return;
                    }
                }
            }
        }

        // Check if auto-restart is configured and allowed
        let should_restart = {
            let configs = self.auto_restart_configs.read().await;
            if let Some(config) = configs.get(server_id) {
                if !config.enabled {
                    false
                } else {
                    let mut trackers = self.restart_trackers.write().await;
                    let tracker = trackers.entry(server_id.to_string()).or_default();
                    tracker.record_and_check(
                        config.max_restarts,
                        Duration::from_secs(config.window_secs),
                    )
                }
            } else {
                false
            }
        };

        if should_restart {
            let config = {
                self.auto_restart_configs
                    .read()
                    .await
                    .get(server_id)
                    .cloned()
                    .unwrap_or_default()
            };
            let _ = self
                .emit_console_output(
                    server_id,
                    "system",
                    &format!(
                        "[Catalyst] Container exited ({}) — auto-restarting in {}s...\n",
                        reason, config.delay_secs
                    ),
                )
                .await;
            tokio::time::sleep(Duration::from_secs(config.delay_secs)).await;

            // Retrieve the stored start message and re-invoke start_server_with_details
            let start_msg = {
                self.start_server_messages
                    .read()
                    .await
                    .get(server_id)
                    .cloned()
            };

            if let Some(msg) = start_msg {
                info!(
                    "Auto-restarting server {} after crash (exit {:?})",
                    server_id, exit_code
                );
                if let Err(e) = self.start_server_with_details(&msg).await {
                    warn!("Auto-restart failed for {}: {}", server_id, e);
                    let _ = self
                        .emit_console_output(
                            server_id,
                            "system",
                            &format!("[Catalyst] Auto-restart failed: {}\n", e),
                        )
                        .await;
                    // Still emit crashed since auto-restart failed
                    let _ = self
                        .emit_server_state_update(
                            server_id,
                            "crashed",
                            Some(reason.to_string()),
                            None,
                            exit_code,
                        )
                        .await;
                }
            } else {
                // No stored start message — fall back to normal crash reporting
                let _ = self
                    .emit_server_state_update(
                        server_id,
                        "crashed",
                        Some(reason.to_string()),
                        None,
                        exit_code,
                    )
                    .await;
            }
        } else {
            // Check if we were rate-limited
            let rate_limited = {
                let configs = self.auto_restart_configs.read().await;
                if let Some(config) = configs.get(server_id) {
                    if config.enabled {
                        let trackers = self.restart_trackers.read().await;
                        if let Some(tracker) = trackers.get(server_id) {
                            tracker.timestamps.len() as u32 >= config.max_restarts
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                }
            };

            if rate_limited {
                let _ = self
                    .emit_console_output(
                        server_id,
                        "system",
                        "[Catalyst] Auto-restart skipped: rate limit reached (too many crashes in window).\n",
                    )
                    .await;
            }

            let _ = self
                .emit_server_state_update(
                    server_id,
                    "crashed",
                    Some(reason.to_string()),
                    None,
                    exit_code,
                )
                .await;
        }
    }

    /// Periodically TCP-probe running game servers and report healthy/unhealthy status.
    async fn spawn_health_checker(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;

            // Snapshot the current server ports map
            let entries: Vec<(String, String, u16)> = {
                self.server_ports
                    .read()
                    .await
                    .iter()
                    .map(|(sid, (cid, port))| (sid.clone(), cid.clone(), *port))
                    .collect()
            };

            for (server_id, container_id, port) in &entries {
                // Verify the container is still running before probing
                let is_running = self
                    .runtime
                    .is_container_running(container_id)
                    .await
                    .unwrap_or(false);
                if !is_running {
                    continue;
                }

                let ip = match self.runtime.get_container_ip(container_id).await {
                    Ok(ip) if !ip.is_empty() => ip,
                    _ => continue,
                };

                let addr = format!("{}:{}", ip, port);
                let parsed: std::net::SocketAddr = match addr.parse() {
                    Ok(a) => a,
                    Err(_) => continue,
                };
                let healthy = tokio::task::spawn_blocking(move || {
                    std::net::TcpStream::connect_timeout(&parsed, Duration::from_secs(3))
                })
                .await
                .unwrap_or(Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "health check timed out",
                )))
                .is_ok();

                // Only emit when state actually changes to avoid noise
                let mut health_states = self.server_health_state.write().await;
                let prev = health_states.get(server_id).copied();
                if prev != Some(healthy) {
                    health_states.insert(server_id.clone(), healthy);
                    drop(health_states); // Release lock before sending
                    let status = "running";
                    let reason = if healthy {
                        Some("Health check passed".to_string())
                    } else {
                        Some("Health check failed".to_string())
                    };
                    info!(
                        "Health check for {}: {} (port {})",
                        server_id,
                        if healthy { "healthy" } else { "unhealthy" },
                        port
                    );
                    let _ = self
                        .emit_server_state_update(server_id, status, reason, None, None)
                        .await;
                }
            }
        }
    }

    /// Detect whether installer output indicates a SteamCMD self-update restart.
    fn is_steamcmd_restart(stdout: &str, stderr: &str) -> bool {
        let combined = format!("{} {}", stdout, stderr);
        combined.contains("Restarting steamcmd")
            || combined.contains("Restarting SteamCMD")
            || (combined.contains("steamcmd.sh") && combined.contains("Restarting"))
    }

    /// Run a single install attempt and return (exit_code, stdout_buffer, stderr_buffer).
    async fn run_installer_attempt(
        &self,
        server_id: &str,
        install_image: &str,
        final_script: &str,
        env_map: &HashMap<String, String>,
        host_server_dir: &str,
    ) -> AgentResult<(i32, String, String)> {
        let installer = self
            .runtime
            .spawn_installer_container(install_image, final_script, env_map, host_server_dir)
            .await
            .map_err(|e| {
                AgentError::IoError(format!("Failed to spawn installer container: {}", e))
            })?;

        let mut stdout_pos = 0u64;
        let mut stderr_pos = 0u64;
        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();

        loop {
            if let Ok(content) = tokio::fs::read_to_string(&installer.stdout_path).await {
                if (stdout_pos as usize) < content.len() {
                    let new_text = &content[stdout_pos as usize..];
                    let (lines, trailing) = split_terminal_lines(new_text);
                    let processed_len = new_text.len() - trailing.len();
                    let mut batch = String::new();
                    for line in lines {
                        let payload = format!("{}\n", line);
                        stdout_buffer.push_str(&payload);
                        batch.push_str(&payload);
                        if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                            self.emit_console_output(server_id, "stdout", &batch)
                                .await?;
                            batch.clear();
                        }
                    }
                    if !batch.is_empty() {
                        self.emit_console_output(server_id, "stdout", &batch)
                            .await?;
                    }
                    stdout_pos += processed_len as u64;
                }
            }

            if let Ok(content) = tokio::fs::read_to_string(&installer.stderr_path).await {
                if (stderr_pos as usize) < content.len() {
                    let new_text = &content[stderr_pos as usize..];
                    let (lines, trailing) = split_terminal_lines(new_text);
                    let processed_len = new_text.len() - trailing.len();
                    let mut batch = String::new();
                    for line in lines {
                        let payload = format!("{}\n", line);
                        stderr_buffer.push_str(&payload);
                        batch.push_str(&payload);
                        if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                            self.emit_console_output(server_id, "stderr", &batch)
                                .await?;
                            batch.clear();
                        }
                    }
                    if !batch.is_empty() {
                        self.emit_console_output(server_id, "stderr", &batch)
                            .await?;
                    }
                    stderr_pos += processed_len as u64;
                }
            }

            match tokio::time::timeout(Duration::from_millis(200), installer.wait()).await {
                Ok(Ok(exit_code)) => {
                    if let Ok(content) = tokio::fs::read_to_string(&installer.stdout_path).await {
                        if (stdout_pos as usize) < content.len() {
                            let new_text = &content[stdout_pos as usize..];
                            let (lines, trailing) = split_terminal_lines(new_text);
                            let mut batch = String::new();
                            for line in lines {
                                let payload = format!("{}\n", line);
                                stdout_buffer.push_str(&payload);
                                batch.push_str(&payload);
                                if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                                    self.emit_console_output(server_id, "stdout", &batch)
                                        .await?;
                                    batch.clear();
                                }
                            }
                            if !trailing.is_empty() {
                                let payload = format!("{}\n", trailing);
                                stdout_buffer.push_str(&payload);
                                batch.push_str(&payload);
                            }
                            if !batch.is_empty() {
                                self.emit_console_output(server_id, "stdout", &batch)
                                    .await?;
                            }
                        }
                    }
                    if let Ok(content) = tokio::fs::read_to_string(&installer.stderr_path).await {
                        if (stderr_pos as usize) < content.len() {
                            let new_text = &content[stderr_pos as usize..];
                            let (lines, trailing) = split_terminal_lines(new_text);
                            let mut batch = String::new();
                            for line in lines {
                                let payload = format!("{}\n", line);
                                stderr_buffer.push_str(&payload);
                                batch.push_str(&payload);
                                if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                                    self.emit_console_output(server_id, "stderr", &batch)
                                        .await?;
                                    batch.clear();
                                }
                            }
                            if !trailing.is_empty() {
                                let payload = format!("{}\n", trailing);
                                stderr_buffer.push_str(&payload);
                                batch.push_str(&payload);
                            }
                            if !batch.is_empty() {
                                self.emit_console_output(server_id, "stderr", &batch)
                                    .await?;
                            }
                        }
                    }
                    let _ = installer.cleanup().await;
                    return Ok((exit_code, stdout_buffer, stderr_buffer));
                }
                Ok(Err(e)) => {
                    let _ = installer.cleanup().await;
                    return Err(AgentError::IoError(format!("Installer wait failed: {}", e)));
                }
                Err(_) => continue,
            }
        }
    }

    async fn install_server(&self, msg: &Value) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let template = msg["template"]
            .as_object()
            .ok_or_else(|| AgentError::InvalidRequest("Missing template".to_string()))?;

        let install_script = template
            .get("installScript")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing installScript in template".to_string())
            })?;

        let environment = msg
            .get("environment")
            .and_then(|v| v.as_object())
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing or invalid environment".to_string())
            })?;

        info!("Installing server: {} (UUID: {})", server_id, server_uuid);

        self.cleanup_all_server_containers(server_id, server_uuid)
            .await?;

        // Derive host mount path on-agent (defense in depth). Do not trust control-plane host paths.
        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let derived_server_dir = self.config.server.data_dir.join(server_uuid);
        let host_server_dir = derived_server_dir.to_string_lossy().to_string();
        if let Some(provided) = environment.get("SERVER_DIR").and_then(|v| v.as_str()) {
            if provided != host_server_dir {
                warn!(
                    "Ignoring backend-provided SERVER_DIR for {}: '{}' (using '{}')",
                    server_uuid, provided, host_server_dir
                );
            }
        }

        let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240);
        let server_dir_path = PathBuf::from(&host_server_dir);
        self.storage_manager
            .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
            .await?;

        let server_dir_path = std::path::PathBuf::from(&host_server_dir);

        tokio::fs::create_dir_all(&server_dir_path)
            .await
            .map_err(|e| {
                AgentError::IoError(format!("Failed to create server directory: {}", e))
            })?;

        info!("Created server directory: {}", server_dir_path.display());

        // Container runs as uid 1000:1000 — ensure it can write to its data dir
        if let Err(e) = chown_to_container_user(&server_dir_path).await {
            warn!("Failed to chown server directory: {}", e);
        }

        // Replace variables in install script
        let mut final_script = install_script.to_string();
        // Strip carriage returns to avoid $'\r': command not found errors
        final_script = final_script.replace("\r\n", "\n").replace('\r', "\n");
        for (key, value) in environment {
            let placeholder = format!("{{{{{}}}}}", key);
            let replacement = if key == "SERVER_DIR" {
                CONTAINER_SERVER_DIR
            } else {
                value.as_str().unwrap_or("")
            };
            // Shell-escape the value to prevent command injection via user-controlled env vars
            let escaped = shell_escape_value(replacement);
            final_script = final_script.replace(&placeholder, &escaped);
        }

        // Get the install image from template (fallback to Alpine if not specified)
        let install_image = template
            .get("installImage")
            .and_then(|v| v.as_str())
            .unwrap_or("alpine:3.19");

        // Convert environment from Map<String, Value> to HashMap<String, String>
        let mut env_map = HashMap::new();
        for (key, value) in environment {
            if let Some(s) = value.as_str() {
                env_map.insert(key.clone(), s.to_string());
            }
        }
        env_map.insert("HOST_SERVER_DIR".to_string(), host_server_dir.clone());
        env_map.insert("SERVER_DIR".to_string(), CONTAINER_SERVER_DIR.to_string());

        info!(
            "Executing installation script in containerized environment using image: {}",
            install_image
        );
        self.emit_console_output(server_id, "system", "[Catalyst] Starting installation...\n")
            .await?;

        // Execute the install script with SteamCMD self-update retry support.
        // SteamCMD frequently self-updates and restarts on first run, causing
        // non-zero exit codes. We detect this pattern and retry once.
        let mut attempt = 0;
        let (exit_code, stdout_buffer, stderr_buffer) = loop {
            attempt += 1;
            match self
                .run_installer_attempt(
                    server_id,
                    install_image,
                    &final_script,
                    &env_map,
                    &host_server_dir,
                )
                .await
            {
                Ok((0, out, err)) => break (0, out, err),
                Ok((_code, out, err)) if attempt < 2 && Self::is_steamcmd_restart(&out, &err) => {
                    self.emit_console_output(
                        server_id,
                        "system",
                        "[Catalyst] SteamCMD self-updated and restarted. Retrying installation...\n",
                    )
                    .await?;
                    continue;
                }
                Ok((code, out, err)) => break (code, out, err),
                Err(e) => return Err(e),
            }
        };

        if exit_code != 0 {
            let stderr_trimmed = stderr_buffer.trim();
            let stdout_trimmed = stdout_buffer.trim();
            let reason = if !stderr_trimmed.is_empty() {
                stderr_trimmed.to_string()
            } else if !stdout_trimmed.is_empty() {
                stdout_trimmed.to_string()
            } else {
                "Install script failed".to_string()
            };
            self.emit_console_output(server_id, "stderr", &format!("{}\n", reason))
                .await?;
            self.emit_server_state_update(server_id, "error", Some(reason.clone()), None, None)
                .await?;
            return Err(AgentError::InstallationError(format!(
                "Install script failed: {}",
                reason
            )));
        }

        if stdout_buffer.trim().is_empty() && stderr_buffer.trim().is_empty() {
            self.emit_console_output(server_id, "system", "[Catalyst] Installation complete.\n")
                .await?;
        }

        // Check for EULA files that require acceptance before marking install as done.
        // If a known EULA file exists but is not accepted, pause here and wait for
        // the user to accept/decline via the frontend modal.
        let eula_file = std::path::PathBuf::from(&host_server_dir).join("eula.txt");
        if eula_file.exists() {
            let eula_content = tokio::fs::read_to_string(&eula_file)
                .await
                .unwrap_or_default();
            if !eula_content.to_lowercase().contains("eula=true") {
                info!(
                    "EULA not accepted for server {}, pausing install",
                    server_uuid
                );
                self.emit_console_output(
                    server_id,
                    "system",
                    "[Catalyst] Minecraft EULA must be accepted before the server can start.\n",
                )
                .await?;
                self.emit_eula_required(server_id, server_uuid, &eula_content, &host_server_dir)
                    .await?;
                return Ok(());
            }
        }

        // Stop any existing log streams for this server before marking as stopped
        // This ensures clean state when transitioning to game server container
        self.stop_log_streams_for_server(server_id).await;

        // Emit state update
        self.emit_server_state_update(server_id, "stopped", None, None, None)
            .await?;

        info!("Server installed successfully: {}", server_uuid);
        Ok(())
    }

    async fn reinstall_server(&self, msg: &Value) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        info!("Reinstalling server: {} (UUID: {})", server_id, server_uuid);
        self.emit_console_output(server_id, "system", "[Catalyst] Reinstalling server...\n")
            .await?;

        // Stop server if running
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if !container_id.is_empty()
            && self
                .runtime
                .is_container_running(&container_id)
                .await
                .unwrap_or(false)
        {
            let stop_policy = StopPolicy::default();
            let _ = self
                .stop_server(server_id, container_id.clone(), &stop_policy)
                .await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        // Cleanup all containers
        self.cleanup_all_server_containers(server_id, server_uuid)
            .await?;

        // Wipe server data directory contents (keep the directory itself)
        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        if server_dir.exists() {
            let mut entries = tokio::fs::read_dir(&server_dir).await.map_err(|e| {
                AgentError::IoError(format!("Failed to read server directory: {}", e))
            })?;
            while let Some(entry) = entries.next_entry().await.map_err(|e| {
                AgentError::IoError(format!("Failed to read directory entry: {}", e))
            })? {
                tokio::fs::remove_dir_all(entry.path()).await?;
            }
            self.emit_console_output(server_id, "system", "[Catalyst] Server data wiped.\n")
                .await?;
        }

        // Run the install script (same as install_server)
        self.install_server(msg).await
    }

    async fn rebuild_server(&self, msg: &Value) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        info!("Rebuilding server: {} (UUID: {})", server_id, server_uuid);
        self.emit_console_output(
            server_id,
            "system",
            "[Catalyst] Rebuilding server container...\n",
        )
        .await?;

        // Stop server if running
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if !container_id.is_empty()
            && self
                .runtime
                .is_container_running(&container_id)
                .await
                .unwrap_or(false)
        {
            let stop_policy = StopPolicy::default();
            let _ = self
                .stop_server(server_id, container_id.clone(), &stop_policy)
                .await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        // Cleanup containers only (NOT data)
        self.cleanup_all_server_containers(server_id, server_uuid)
            .await?;

        self.emit_console_output(
            server_id,
            "system",
            "[Catalyst] Container removed. Recreating from image...\n",
        )
        .await?;

        // Start the server (creates a fresh container, data on disk is preserved)
        self.start_server_with_details(msg).await?;

        self.emit_console_output(
            server_id,
            "system",
            "[Catalyst] Server rebuilt successfully.\n",
        )
        .await?;
        Ok(())
    }

    fn spawn_log_stream(&self, server_id: &str, container_id: &str) {
        let handler = self.clone();
        let server_id = server_id.to_string();
        let container_id = container_id.to_string();
        tokio::spawn(async move {
            // Rotate logs if they exceed the size limit
            rotate_logs(&container_id).await;

            // First, clean up any stale streams for this server
            // This prevents issues when switching from installer to game server container
            {
                let mut streams = handler.active_log_streams.write().await;
                streams.retain(|key| {
                    // Keep only streams that don't belong to this server
                    // or keep the exact stream we're about to create (prevents duplicates)
                    !key.starts_with(&format!("{}:", server_id))
                        || *key == format!("{}:{}", server_id, container_id)
                });
            }

            let stream_key = format!("{}:{}", server_id, container_id);
            {
                let mut guard = handler.active_log_streams.write().await;
                if guard.contains(&stream_key) {
                    return;
                }
                guard.insert(stream_key.clone());
            }
            if let Err(err) = handler
                .stream_container_logs(&server_id, &container_id)
                .await
            {
                error!(
                    "Failed to stream logs for server {} (container {}): {}",
                    server_id, container_id, err
                );
                let _ = handler
                    .emit_console_output(
                        &server_id,
                        "system",
                        &format!("[Catalyst] Log stream error: {}\n", err),
                    )
                    .await;
            }
            handler.active_log_streams.write().await.remove(&stream_key);
        });
    }

    async fn stream_container_logs(&self, server_id: &str, container_id: &str) -> AgentResult<()> {
        let _log_stream = self.runtime.spawn_log_stream(container_id).await?;
        let base = std::path::PathBuf::from("/tmp/catalyst-console").join(container_id);
        let stdout_path = base.join("stdout");
        let stderr_path = base.join("stderr");

        let mut stdout_pos = 0u64;
        let mut stderr_pos = 0u64;

        info!(
            "Console log stream started for server {} (container {})",
            server_id, container_id
        );

        // Tail the stdout/stderr files
        loop {
            let running = self
                .runtime
                .is_container_running(container_id)
                .await
                .unwrap_or(false);
            let mut had_data = false;

            if let Ok(content) = tokio::fs::read_to_string(&stdout_path).await {
                if (stdout_pos as usize) < content.len() {
                    let new_text = &content[stdout_pos as usize..];
                    let (lines, trailing) = split_terminal_lines(new_text);
                    let processed_len = new_text.len() - trailing.len();
                    let mut batch = String::new();
                    for line in lines {
                        batch.push_str(&line);
                        batch.push('\n');
                        if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                            self.emit_console_output(server_id, "stdout", &batch)
                                .await?;
                            batch.clear();
                        }
                    }
                    if !batch.is_empty() {
                        self.emit_console_output(server_id, "stdout", &batch)
                            .await?;
                    }
                    stdout_pos += processed_len as u64;
                    had_data = !new_text.is_empty();
                    debug!(
                        "server {} stdout: read {} bytes, emitted {} bytes, pos now {}",
                        server_id,
                        new_text.len(),
                        processed_len,
                        stdout_pos
                    );
                }
            }
            if let Ok(content) = tokio::fs::read_to_string(&stderr_path).await {
                if (stderr_pos as usize) < content.len() {
                    let new_text = &content[stderr_pos as usize..];
                    let (lines, trailing) = split_terminal_lines(new_text);
                    let processed_len = new_text.len() - trailing.len();
                    let mut batch = String::new();
                    for line in lines {
                        batch.push_str(&line);
                        batch.push('\n');
                        if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                            self.emit_console_output(server_id, "stderr", &batch)
                                .await?;
                            batch.clear();
                        }
                    }
                    if !batch.is_empty() {
                        self.emit_console_output(server_id, "stderr", &batch)
                            .await?;
                    }
                    stderr_pos += processed_len as u64;
                    had_data = had_data || !new_text.is_empty();
                    debug!(
                        "server {} stderr: read {} bytes, emitted {} bytes, pos now {}",
                        server_id,
                        new_text.len(),
                        processed_len,
                        stderr_pos
                    );
                }
            }

            if !running {
                // Container stopped — flush any trailing partial lines too
                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Ok(content) = tokio::fs::read_to_string(&stdout_path).await {
                    if (stdout_pos as usize) < content.len() {
                        let new_text = &content[stdout_pos as usize..];
                        let (lines, trailing) = split_terminal_lines(new_text);
                        let mut batch = String::new();
                        for line in lines {
                            batch.push_str(&line);
                            batch.push('\n');
                            if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                                self.emit_console_output(server_id, "stdout", &batch)
                                    .await?;
                                batch.clear();
                            }
                        }
                        if !trailing.is_empty() {
                            batch.push_str(trailing);
                            batch.push('\n');
                        }
                        if !batch.is_empty() {
                            self.emit_console_output(server_id, "stdout", &batch)
                                .await?;
                        }
                    }
                }
                if let Ok(content) = tokio::fs::read_to_string(&stderr_path).await {
                    if (stderr_pos as usize) < content.len() {
                        let new_text = &content[stderr_pos as usize..];
                        let (lines, trailing) = split_terminal_lines(new_text);
                        let mut batch = String::new();
                        for line in lines {
                            batch.push_str(&line);
                            batch.push('\n');
                            if batch.len() >= MAX_CONSOLE_BATCH_BYTES {
                                self.emit_console_output(server_id, "stderr", &batch)
                                    .await?;
                                batch.clear();
                            }
                        }
                        if !trailing.is_empty() {
                            batch.push_str(trailing);
                            batch.push('\n');
                        }
                        if !batch.is_empty() {
                            self.emit_console_output(server_id, "stderr", &batch)
                                .await?;
                        }
                    }
                }
                break;
            }

            tokio::time::sleep(Duration::from_millis(if had_data { 50 } else { 200 })).await;
        }

        Ok(())
    }

    async fn start_server_with_details(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let result: AgentResult<()> = async {
            let server_uuid = msg["serverUuid"]
                .as_str()
                .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

            // Enforce max servers per node
            let current_servers = self.runtime.list_containers().await?.len();
            if current_servers >= self.config.server.max_connections {
                return Err(AgentError::InvalidRequest(format!(
                    "Node at capacity: {}/{} servers",
                    current_servers, self.config.server.max_connections
                )));
            }

            let template = msg["template"]
                .as_object()
                .ok_or_else(|| AgentError::InvalidRequest("Missing template".to_string()))?;

            let docker_image = msg
                .get("environment")
                .and_then(|v| v.get("TEMPLATE_IMAGE"))
                .and_then(|v| v.as_str())
                .or_else(|| template.get("image").and_then(|v| v.as_str()))
                .ok_or_else(|| {
                    AgentError::InvalidRequest("Missing image in template".to_string())
                })?;

            let startup_command = template
                .get("startup")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AgentError::InvalidRequest("Missing startup in template".to_string())
                })?;

            let memory_mb = msg["allocatedMemoryMb"].as_u64().ok_or_else(|| {
                AgentError::InvalidRequest("Missing allocatedMemoryMb".to_string())
            })?;

            let cpu_cores = msg["allocatedCpuCores"].as_u64().ok_or_else(|| {
                AgentError::InvalidRequest("Missing allocatedCpuCores".to_string())
            })?;

            let swap_mb = msg["allocatedSwapMb"].as_u64().unwrap_or(0);
            let io_weight = msg["ioWeight"].as_u64().unwrap_or(500);
            let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240);

            let primary_port = msg["primaryPort"]
                .as_u64()
                .ok_or_else(|| AgentError::InvalidRequest("Missing primaryPort".to_string()))?
                as u16;
            if primary_port == 0 {
                return Err(AgentError::InvalidRequest(
                    "Invalid primaryPort".to_string(),
                ));
            }
            if primary_port == 0 {
                return Err(AgentError::InvalidRequest(
                    "Invalid primaryPort".to_string(),
                ));
            }

            let network_mode = msg.get("networkMode").and_then(|v| v.as_str());
            let port_bindings_value = msg.get("portBindings");

            let environment = msg
                .get("environment")
                .and_then(|v| v.as_object())
                .ok_or_else(|| {
                    AgentError::InvalidRequest("Missing or invalid environment".to_string())
                })?;

            // Convert environment to HashMap
            let mut env_map = std::collections::HashMap::new();
            for (key, value) in environment {
                if let Some(val_str) = value.as_str() {
                    env_map.insert(key.clone(), val_str.to_string());
                }
            }

            // Derive host mount path on-agent (defense in depth). Do not trust control-plane host paths.
            validate_safe_path_segment(server_uuid, "serverUuid")?;
            let derived_server_dir = self.config.server.data_dir.join(server_uuid);
            let host_server_dir = derived_server_dir.to_string_lossy().to_string();
            if let Some(provided) = environment.get("SERVER_DIR").and_then(|v| v.as_str()) {
                if provided != host_server_dir {
                    warn!(
                        "Ignoring backend-provided SERVER_DIR for {}: '{}' (using '{}')",
                        server_uuid, provided, host_server_dir
                    );
                }
            }

            let server_dir_path = PathBuf::from(&host_server_dir);
            self.storage_manager
                .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
                .await?;
            // Container runs as uid 1000:1000 — ensure it can write to its data dir
            if let Err(e) = chown_to_container_user(&server_dir_path).await {
                warn!("Failed to chown server directory: {}", e);
            }
            env_map.insert("HOST_SERVER_DIR".to_string(), host_server_dir.clone());
            env_map.insert("SERVER_DIR".to_string(), CONTAINER_SERVER_DIR.to_string());

            // Proton/SteamCMD containers need STEAM_COMPAT_DATA_PATH and
            // STEAM_COMPAT_CLIENT_INSTALL_PATH so Wine prefixes and compat data
            // are written to the server's data directory instead of crashing.
            let lower_image = docker_image.to_lowercase();
            if lower_image.contains("proton") || lower_image.contains("steamcmd") {
                let appid = env_map.get("SRCDS_APPID").cloned().unwrap_or_default();
                let compat_path = if !appid.is_empty() {
                    format!("/data/.steam/steam/steamapps/compatdata/{}", appid)
                } else {
                    "/data/.proton".to_string()
                };
                env_map.insert("STEAM_COMPAT_DATA_PATH".to_string(), compat_path.clone());
                env_map.insert(
                    "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(),
                    "/data/Steam".to_string(),
                );
                info!(
                    "Proton/SteamCMD image detected; set STEAM_COMPAT_DATA_PATH={} STEAM_COMPAT_CLIENT_INSTALL_PATH=/data/Steam",
                    &compat_path
                );
                // Pre-create the compatdata directory on the host so Proton can
                // write its lock file and prefix without crashing on first start.
                let host_compat = server_dir_path.join(compat_path.strip_prefix("/data/").unwrap_or(".proton"));
                if let Err(e) = tokio::fs::create_dir_all(&host_compat).await {
                    warn!("Failed to create compatdata dir {}: {}", host_compat.display(), e);
                } else if let Err(e) = chown_to_container_user(&host_compat).await {
                    warn!("Failed to chown compatdata dir {}: {}", host_compat.display(), e);
                }
                // Also pre-create the Steam client install directory.
                let host_steam = server_dir_path.join("Steam");
                if let Err(e) = tokio::fs::create_dir_all(&host_steam).await {
                    warn!("Failed to create Steam dir {}: {}", host_steam.display(), e);
                } else if let Err(e) = chown_to_container_user(&host_steam).await {
                    warn!("Failed to chown Steam dir {}: {}", host_steam.display(), e);
                }
            }

            info!("Starting server: {} (UUID: {})", server_id, server_uuid);
            info!(
                "Image: {}, Port: {}, Memory: {}MB, CPU: {}",
                docker_image, primary_port, memory_mb, cpu_cores
            );
            self.emit_console_output(server_id, "system", "[Catalyst] Starting server...\n")
                .await?;

            // Replace template variables in startup command
            let mut final_startup_command = startup_command.to_string();

            // Add MEMORY to environment for variable replacement
            env_map.insert("MEMORY".to_string(), memory_mb.to_string());
            env_map.insert("PORT".to_string(), primary_port.to_string());

            // Sync port-related environment variables with primary_port
            // This ensures the server listens on the same port used for port forwarding
            if env_map.contains_key("SERVER_PORT") {
                env_map.insert("SERVER_PORT".to_string(), primary_port.to_string());
            }
            if env_map.contains_key("GAME_PORT") {
                env_map.insert("GAME_PORT".to_string(), primary_port.to_string());
            }

            if !env_map.contains_key("MEMORY_XMS") {
                let memory_value = env_map
                    .get("MEMORY")
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(memory_mb);
                let xms_percent = env_map
                    .get("MEMORY_XMS_PERCENT")
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(50);
                let memory_xms = std::cmp::max(1, (memory_value * xms_percent) / 100);
                env_map.insert("MEMORY_XMS".to_string(), memory_xms.to_string());
            }

            // Replace all {{VARIABLE}} placeholders
            for (key, value) in &env_map {
                let placeholder = format!("{{{{{}}}}}", key);
                final_startup_command = final_startup_command.replace(&placeholder, value);
            }

            // Some templates use bash-style arithmetic tests like ((1)); convert for /bin/sh.
            final_startup_command = normalize_startup_for_sh(&final_startup_command);

            info!("Final startup command: {}", final_startup_command);

            let network_ip = env_map
                .get("CATALYST_NETWORK_IP")
                .or_else(|| env_map.get("AERO_NETWORK_IP"))
                .map(|value| value.as_str());

            let mut port_bindings = HashMap::new();
            if let Some(map) = port_bindings_value.and_then(|value| value.as_object()) {
                for (container_port, host_port) in map {
                    let container_port = container_port.parse::<u16>().map_err(|_| {
                        AgentError::InvalidRequest(
                            "Invalid portBindings container port".to_string(),
                        )
                    })?;
                    let host_port = host_port.as_u64().ok_or_else(|| {
                        AgentError::InvalidRequest("Invalid portBindings host port".to_string())
                    })?;
                    if host_port == 0 || host_port > u16::MAX as u64 {
                        return Err(AgentError::InvalidRequest(
                            "Invalid portBindings host port".to_string(),
                        ));
                    }
                    port_bindings.insert(container_port, host_port as u16);
                }
            }

            self.cleanup_all_server_containers(server_id, server_uuid)
                .await?;

            // Create and start container
            self.runtime
                .create_container(crate::runtime_manager::ContainerConfig {
                    container_id: server_id,
                    server_id,
                    image: docker_image,
                    startup_command: &final_startup_command,
                    env: &env_map,
                    memory_mb,
                    cpu_cores,
                    swap_mb,
                    io_weight,
                    data_dir: &host_server_dir,
                    port: primary_port,
                    port_bindings: &port_bindings,
                    network_mode,
                    network_ip,
                })
                .await?;

            let is_running = match self.runtime.is_container_running(server_id).await {
                Ok(value) => value,
                Err(err) => {
                    error!("Failed to check container state for {}: {}", server_id, err);
                    false
                }
            };
            if !is_running {
                let exit_code = self
                    .runtime
                    .get_container_exit_code(server_id)
                    .await
                    .unwrap_or(None);
                let reason = match exit_code {
                    Some(code) => format!("Container exited immediately with code {}", code),
                    None => "Container exited immediately after start".to_string(),
                };
                if let Ok(logs) = self.runtime.get_logs(server_id, Some(100)).await {
                    if !logs.trim().is_empty() {
                        self.emit_console_output(server_id, "stderr", &logs).await?;
                    }
                }
                return Err(AgentError::ContainerError(reason));
            }

            let container_id = self.resolve_container_id(server_id, server_uuid).await;
            if !container_id.is_empty() {
                // Stop any existing log streams for this server before starting new one
                // This is critical when transitioning from installer to game server container
                self.stop_log_streams_for_server(server_id).await;
                self.spawn_log_stream(server_id, &container_id);
                self.spawn_exit_monitor(server_id, &container_id);

                // Store auto-restart config, start message, and port for this server
                let ar_config = parse_auto_restart_config(msg);
                self.auto_restart_configs
                    .write()
                    .await
                    .insert(server_id.to_string(), ar_config);
                self.start_server_messages
                    .write()
                    .await
                    .insert(server_id.to_string(), msg.clone());
                self.server_ports
                    .write()
                    .await
                    .insert(server_id.to_string(), (container_id.clone(), primary_port));
            }

            // Emit state update
            self.emit_server_state_update(
                server_id,
                "running",
                None,
                Some(port_bindings.clone()),
                None,
            )
            .await?;

            info!("Server started successfully: {}", server_id);
            Ok(())
        }
        .await;

        if let Err(err) = &result {
            let reason = format!("Start failed: {}", err);
            let _ = self
                .emit_console_output(server_id, "stderr", &format!("[Catalyst] {}\n", reason))
                .await;
            let _ = self
                .emit_server_state_update(server_id, "error", Some(reason), None, None)
                .await;
        }

        result
    }

    async fn start_server(&self, server_id: &str, container_id: String) -> AgentResult<()> {
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }
        info!(
            "Starting server: {} (container {})",
            server_id, container_id
        );

        // In production, fetch server config from database or local cache
        match self.runtime.start_container(&container_id).await {
            Ok(()) => {
                self.spawn_log_stream(server_id, &container_id);
                self.spawn_exit_monitor(server_id, &container_id);
                self.emit_server_state_update(server_id, "running", None, None, None)
                    .await?;
                Ok(())
            }
            Err(err) => {
                let reason = format!("Start failed: {}", err);
                let _ = self
                    .emit_console_output(server_id, "stderr", &format!("[Catalyst] {}\n", reason))
                    .await;
                let _ = self
                    .emit_server_state_update(server_id, "error", Some(reason), None, None)
                    .await;
                Err(err)
            }
        }
    }

    async fn wait_for_container_shutdown(&self, container_id: &str, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if !self
                .runtime
                .is_container_running(container_id)
                .await
                .unwrap_or(false)
            {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    async fn stop_server(
        &self,
        server_id: &str,
        container_id: String,
        stop_policy: &StopPolicy,
    ) -> AgentResult<()> {
        if container_id.is_empty() {
            info!(
                "No container found for server {}, marking as stopped",
                server_id
            );
            self.stop_monitor_task(server_id).await;
            self.auto_restart_configs.write().await.remove(server_id);
            self.restart_trackers.write().await.remove(server_id);
            self.start_server_messages.write().await.remove(server_id);
            self.server_ports.write().await.remove(server_id);
            self.server_health_state.write().await.remove(server_id);
            self.emit_server_state_update(server_id, "stopped", None, None, None)
                .await?;
            return Ok(());
        }
        info!(
            "Stopping server: {} (container {})",
            server_id, container_id
        );

        self.stop_monitor_task(server_id).await;
        // Clean up auto-restart state since the stop is intentional
        self.auto_restart_configs.write().await.remove(server_id);
        self.restart_trackers.write().await.remove(server_id);
        self.start_server_messages.write().await.remove(server_id);
        self.server_ports.write().await.remove(server_id);
        self.server_health_state.write().await.remove(server_id);

        if self
            .runtime
            .is_container_running(&container_id)
            .await
            .unwrap_or(false)
        {
            let mut stopped_gracefully = false;
            if let Some(command) = stop_policy.stop_command.as_deref() {
                let payload = if command.ends_with('\n') {
                    command.to_string()
                } else {
                    format!("{}\n", command)
                };
                let _ = self
                    .emit_console_output(
                        server_id,
                        "system",
                        "[Catalyst] Sending graceful stop command to server process...\n",
                    )
                    .await;

                match self.runtime.send_input(&container_id, &payload).await {
                    Ok(()) => {
                        if self
                            .wait_for_container_shutdown(&container_id, Duration::from_secs(20))
                            .await
                        {
                            stopped_gracefully = true;
                        } else {
                            let _ = self
                                .emit_console_output(
                                    server_id,
                                    "system",
                                    &format!(
                                        "[Catalyst] Stop command timed out, sending {}...\n",
                                        stop_policy.stop_signal
                                    ),
                                )
                                .await;
                        }
                    }
                    Err(err) => {
                        warn!(
                            "Graceful stop command failed for server {} (container {}): {}",
                            server_id, container_id, err
                        );
                        let _ = self
                            .emit_console_output(
                                server_id,
                                "system",
                                &format!(
                                    "[Catalyst] Stop command failed ({}), sending {}...\n",
                                    err, stop_policy.stop_signal
                                ),
                            )
                            .await;
                    }
                }
            }

            if !stopped_gracefully {
                let _ = self
                    .emit_console_output(
                        server_id,
                        "system",
                        &format!(
                            "[Catalyst] Requesting graceful shutdown with {}...\n",
                            stop_policy.stop_signal
                        ),
                    )
                    .await;
                self.runtime
                    .stop_container_with_signal(&container_id, &stop_policy.stop_signal, 30)
                    .await?;
            }
        }

        if self.runtime.container_exists(&container_id).await {
            self.runtime.remove_container(&container_id).await?;
        }

        self.emit_server_state_update(server_id, "stopped", None, None, None)
            .await?;

        Ok(())
    }

    async fn kill_server(&self, server_id: &str, container_id: String) -> AgentResult<()> {
        if container_id.is_empty() {
            info!(
                "No container found for server {}, marking as killed",
                server_id
            );
            self.stop_monitor_task(server_id).await;
            self.emit_server_state_update(
                server_id,
                "crashed",
                Some("Killed by agent".to_string()),
                None,
                Some(137),
            )
            .await?;
            return Ok(());
        }
        info!(
            "Force killing server: {} (container {})",
            server_id, container_id
        );

        // Stop monitoring first - we don't want monitor interfering
        self.stop_monitor_task(server_id).await;

        let _ = self
            .emit_console_output(
                server_id,
                "system",
                "[Catalyst] Force killing server with SIGKILL...\n",
            )
            .await;

        // Force kill the container - this method never fails and always attempts cleanup
        if let Err(e) = self.runtime.force_kill_container(&container_id).await {
            warn!(
                "Force kill had issues for {}: {}, continuing with cleanup",
                container_id, e
            );
        }

        // Always attempt to remove the container regardless of what happened above
        // remove_container also sends SIGKILL, so this is a safety net
        if self.runtime.container_exists(&container_id).await {
            if let Err(e) = self.runtime.remove_container(&container_id).await {
                warn!(
                    "Failed to remove container {}: {}, server state still updated",
                    container_id, e
                );
            }
        }

        // Always update state to crashed - this must happen no matter what
        self.emit_server_state_update(
            server_id,
            "crashed",
            Some("Killed by agent".to_string()),
            None,
            Some(137), // 128 + 9 (SIGKILL exit code)
        )
        .await?;

        Ok(())
    }

    /// Handle server deletion — clean up container and firewall rules.
    async fn delete_server(&self, server_id: &str, server_uuid: &str) -> AgentResult<()> {
        info!("Deleting server: {} (uuid: {})", server_id, server_uuid);

        // Stop monitoring
        self.stop_monitor_task(server_id).await;

        // Try both possible container names (server_id and server_uuid)
        for container_name in &[server_id, server_uuid] {
            if self.runtime.container_exists(container_name).await {
                if self
                    .runtime
                    .is_container_running(container_name)
                    .await
                    .unwrap_or(false)
                {
                    if let Err(e) = self.runtime.stop_container(container_name, 5).await {
                        warn!(
                            "Failed to stop container {} during delete: {}",
                            container_name, e
                        );
                        let _ = self.runtime.kill_container(container_name, "SIGKILL").await;
                    }
                }
                if let Err(e) = self.runtime.remove_container(container_name).await {
                    warn!(
                        "Failed to remove container {} during delete: {}",
                        container_name, e
                    );
                }
            }
        }

        // Clean up firewall rules for this server (by both identifiers)
        FirewallManager::remove_server_ports(server_id).await;
        if !server_uuid.is_empty() && server_uuid != server_id {
            FirewallManager::remove_server_ports(server_uuid).await;
        }

        // Clean up server data directory (container data, logs, console)
        let data_dir = self.config.server.data_dir.clone();
        for id in &[server_id, server_uuid] {
            if !id.is_empty() {
                let server_dir = std::path::Path::new(&data_dir).join(id);
                if server_dir.exists() {
                    if let Err(e) = tokio::fs::remove_dir_all(&server_dir).await {
                        warn!(
                            "Failed to remove server data dir {}: {}",
                            server_dir.display(),
                            e
                        );
                    } else {
                        info!("Removed server data directory: {}", server_dir.display());
                    }
                }
            }
        }

        info!("Server {} deleted successfully", server_id);
        Ok(())
    }

    async fn handle_console_input(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let data = msg["data"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing data".to_string()))?;

        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);
        info!(
            "Received console input for server {} (uuid {}), bytes={}",
            server_id,
            server_uuid,
            data.len()
        );
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if container_id.is_empty() {
            let err =
                AgentError::ContainerError(format!("Container not found for server {}", server_id));
            let _ = self
                .emit_console_output(
                    server_id,
                    "stderr",
                    &format!("[Catalyst] Console input failed: {}\n", err),
                )
                .await;
            return Err(err);
        }

        debug!(
            "Console input for {} (container {}): {}",
            server_id, container_id, data
        );

        self.spawn_log_stream(server_id, &container_id);

        // Send to container stdin
        if let Err(err) = self.runtime.send_input(&container_id, data).await {
            let _ = self
                .emit_console_output(
                    server_id,
                    "stderr",
                    &format!("[Catalyst] Console input failed: {}\n", err),
                )
                .await;
            return Err(err);
        }

        info!(
            "Console input delivered for server {} to container {}",
            server_id, container_id
        );

        Ok(())
    }

    async fn handle_file_operation(&self, msg: &Value) -> AgentResult<()> {
        let op_type = msg
            .get("operation")
            .and_then(|value| value.as_str())
            .or_else(|| msg["type"].as_str())
            .ok_or_else(|| AgentError::InvalidRequest("Missing operation".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        // Use server_uuid for storage path (same as backup/restore operations)
        // Fall back to server_id if serverUuid is not provided
        let server_uuid = msg["serverUuid"].as_str().unwrap_or(server_id);

        let path = msg["path"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing path".to_string()))?;

        let request_id = msg["requestId"].as_str().map(|value| value.to_string());
        let result = match op_type {
            "read" => self
                .file_manager
                .read_file(server_uuid, path)
                .await
                .map(|data| {
                    Some(json!({ "data": base64::engine::general_purpose::STANDARD.encode(data) }))
                }),
            "write" => {
                let data = msg["data"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing data".to_string()))?;
                self.file_manager
                    .write_file(server_uuid, path, data)
                    .await
                    .map(|_| None)
            }
            "delete" => self
                .file_manager
                .delete_file(server_uuid, path)
                .await
                .map(|_| None),
            "rename" => {
                let to = msg["to"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing 'to' path".to_string()))?;
                self.file_manager
                    .rename_file(server_uuid, path, to)
                    .await
                    .map(|_| None)
            }
            "list" => self
                .file_manager
                .list_dir(server_uuid, path)
                .await
                .map(|entries| Some(json!({ "entries": entries }))),
            "mkdir" => self
                .file_manager
                .mkdir(server_uuid, path)
                .await
                .map(|_| None),
            _ => {
                return Err(AgentError::InvalidRequest(format!(
                    "Unknown file operation: {}",
                    op_type
                )))
            }
        };

        if let Some(request_id) = request_id.as_deref() {
            let payload = match &result {
                Ok(data) => json!({
                    "type": "file_operation_response",
                    "requestId": request_id,
                    "serverId": server_id,
                    "operation": op_type,
                    "path": path,
                    "success": true,
                    "data": data,
                }),
                Err(err) => json!({
                    "type": "file_operation_response",
                    "requestId": request_id,
                    "serverId": server_id,
                    "operation": op_type,
                    "path": path,
                    "success": false,
                    "error": err.to_string(),
                }),
            };
            let writer = { self.write.read().await.clone() };
            if let Some(ws) = writer {
                let mut w = ws.lock().await;
                let _ = w.send(Message::Text(payload.to_string().into())).await;
            }
        }

        result.map(|_| ())
    }

    async fn handle_create_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
        let backup_name = msg["backupName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupName".to_string()))?;
        let backup_path_override = msg["backupPath"].as_str();
        let backup_id = msg["backupId"].as_str();

        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        if let Some(provided) = msg["serverDir"].as_str() {
            let derived = server_dir.to_string_lossy();
            if provided != derived {
                warn!(
                    "Ignoring backend-provided serverDir for {}: '{}' (using '{}')",
                    server_uuid, provided, derived
                );
            }
        }
        let backup_path = match backup_path_override {
            Some(path) => self.resolve_backup_path(server_uuid, path, true).await?,
            None => {
                let filename = format!("{}.tar.gz", backup_name);
                self.resolve_backup_path(server_uuid, &filename, true)
                    .await?
            }
        };
        let backup_dir = backup_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.backup_base_dir(server_uuid));

        if !server_dir.exists() {
            return Err(AgentError::NotFound(format!(
                "Server directory not found: {}",
                server_dir.display()
            )));
        }

        tokio::fs::create_dir_all(&backup_dir).await?;

        info!(
            "Creating backup {} for server {} at {}",
            backup_name,
            server_id,
            backup_path.display()
        );

        let archive_result = tokio::process::Command::new("tar")
            .arg("-czf")
            .arg(&backup_path)
            .arg("-C")
            .arg(&server_dir)
            .arg(".")
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run tar: {}", e)))?;

        if !archive_result.status.success() {
            let stderr = String::from_utf8_lossy(&archive_result.stderr);
            return Err(AgentError::IoError(format!(
                "Backup archive failed: {}",
                stderr
            )));
        }

        let metadata = tokio::fs::metadata(&backup_path)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to read backup metadata: {}", e)))?;
        let _size_mb = metadata.len() as f64 / (1024.0 * 1024.0);

        let mut file = tokio::fs::File::open(&backup_path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        loop {
            let read = file.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        let checksum = hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>();

        // Optionally encrypt the backup if an encryption key is provided
        let encrypted = if let Some(enc_key_b64) = msg.get("encryptionKey").and_then(|v| v.as_str())
        {
            let key = base64::engine::general_purpose::STANDARD
                .decode(enc_key_b64)
                .map_err(|e| {
                    AgentError::InvalidRequest(format!("Invalid encryption key: {}", e))
                })?;
            let raw = tokio::fs::read(&backup_path).await?;
            match encrypt_backup(&raw, &key) {
                Ok(encrypted_data) => {
                    tokio::fs::write(&backup_path, &encrypted_data).await?;
                    info!("Backup {} encrypted successfully", backup_name);
                    true
                }
                Err(e) => {
                    // Encryption failure should not destroy the unencrypted backup
                    warn!("Backup encryption failed for {}: {}", backup_name, e);
                    false
                }
            }
        } else {
            false
        };

        // Re-read metadata after possible encryption
        let final_metadata = tokio::fs::metadata(&backup_path).await?;
        let final_size_mb = final_metadata.len() as f64 / (1024.0 * 1024.0);

        let event = json!({
            "type": "backup_complete",
            "serverId": server_id,
            "backupName": backup_name,
            "backupPath": backup_path.to_string_lossy(),
            "sizeMb": final_size_mb,
            "checksum": checksum,
            "backupId": backup_id,
            "encrypted": encrypted,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    async fn handle_restore_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        if let Some(provided) = msg["serverDir"].as_str() {
            let derived = server_dir.to_string_lossy();
            if provided != derived {
                warn!(
                    "Ignoring backend-provided serverDir for {}: '{}' (using '{}')",
                    server_uuid, provided, derived
                );
            }
        }
        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;

        if !backup_file.exists() {
            return Err(AgentError::NotFound(format!(
                "Backup file not found: {}",
                backup_file.display()
            )));
        }

        tokio::fs::create_dir_all(&server_dir).await?;

        // Ensure restored data is owned by container user
        if let Err(e) = chown_to_container_user(&server_dir).await {
            warn!("Failed to chown restored server directory: {}", e);
        }

        info!(
            "Restoring backup {} for server {} into {}",
            backup_file.display(),
            server_id,
            server_dir.display()
        );

        // Determine the actual file to extract from (may be decrypted to a temp file)
        let actual_backup_file;
        let cleanup_temp;
        if let Some(enc_key_b64) = msg.get("encryptionKey").and_then(|v| v.as_str()) {
            let key = base64::engine::general_purpose::STANDARD
                .decode(enc_key_b64)
                .map_err(|e| {
                    AgentError::InvalidRequest(format!("Invalid encryption key: {}", e))
                })?;
            let raw = tokio::fs::read(&backup_file).await?;
            let decrypted = decrypt_backup(&raw, &key).map_err(|e| {
                AgentError::InvalidRequest(format!("Backup decryption failed: {}", e))
            })?;
            let tmp_path = backup_file.with_extension("tar.gz.decrypting");
            tokio::fs::write(&tmp_path, &decrypted).await?;
            info!("Backup decrypted successfully for restore");
            actual_backup_file = tmp_path.clone();
            cleanup_temp = Some(tmp_path);
        } else {
            actual_backup_file = backup_file.clone();
            cleanup_temp = None;
        }

        let restore_result = tokio::process::Command::new("tar")
            .arg("-xzf")
            .arg(&actual_backup_file)
            .arg("-C")
            .arg(&server_dir)
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run tar: {}", e)))?;

        if !restore_result.status.success() {
            let stderr = String::from_utf8_lossy(&restore_result.stderr);
            // Clean up partial extraction on failure
            let _ = tokio::fs::remove_dir_all(&server_dir).await;
            // Clean up temp decrypted file
            if let Some(ref tmp) = cleanup_temp {
                let _ = tokio::fs::remove_file(tmp).await;
            }
            return Err(AgentError::IoError(format!(
                "Backup restore failed: {}",
                stderr
            )));
        }

        // Clean up temp decrypted file after successful extraction
        if let Some(ref tmp) = cleanup_temp {
            let _ = tokio::fs::remove_file(tmp).await;
        }

        // Security: validate that no symlinks in the restored archive escape the
        // server directory.  This prevents a malicious backup from planting symlinks
        // that point to host paths like /etc/shadow or /var/lib/catalyst.
        let canonical_base = std::fs::canonicalize(&server_dir).map_err(|e| {
            AgentError::FileSystemError(format!("Cannot resolve server dir: {}", e))
        })?;
        let mut dangerous_symlinks = Vec::new();
        self.check_restore_symlinks(&server_dir, &canonical_base, &mut dangerous_symlinks)
            .await?;
        if !dangerous_symlinks.is_empty() {
            for symlink in &dangerous_symlinks {
                warn!("Dangerous symlink in restored backup: {}", symlink);
            }
            let _ = tokio::fs::remove_dir_all(&server_dir).await;
            return Err(AgentError::SecurityViolation(format!(
                "Backup contains {} symlink(s) that escape the server directory. \
                 Restore aborted and directory cleaned up for security.",
                dangerous_symlinks.len()
            )));
        }

        let event = json!({
            "type": "backup_restore_complete",
            "serverId": server_id,
            "backupPath": backup_path,
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    /// Recursively check restored files for symlinks that escape the server directory.
    async fn check_restore_symlinks(
        &self,
        dir: &std::path::Path,
        canonical_base: &std::path::Path,
        dangerous: &mut Vec<String>,
    ) -> AgentResult<()> {
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            let mut entries = tokio::fs::read_dir(&current)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Cannot read dir: {}", e)))?;
            while let Some(entry) = entries
                .next_entry()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Error reading entry: {}", e)))?
            {
                let path = entry.path();
                match entry.file_type().await {
                    Ok(ft) if ft.is_symlink() => {
                        if let Ok(target) = tokio::fs::read_link(&path).await {
                            let parent = path.parent().unwrap_or(&current);
                            let resolved = parent.join(&target);
                            let is_dangerous =
                                if let Ok(canon) = tokio::fs::canonicalize(&resolved).await {
                                    !canon.starts_with(canonical_base)
                                } else if resolved.is_absolute() {
                                    !resolved.starts_with(canonical_base)
                                } else {
                                    false
                                };
                            if is_dangerous {
                                dangerous.push(format!(
                                    "{} -> {}",
                                    path.display(),
                                    target.display()
                                ));
                            }
                        }
                    }
                    Ok(ft) if ft.is_dir() => {
                        stack.push(path);
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    async fn handle_delete_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;
        if backup_file.exists() {
            tokio::fs::remove_file(&backup_file).await?;
        }

        let event = json!({
            "type": "backup_delete_complete",
            "serverId": server_id,
            "backupPath": backup_path,
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    async fn handle_download_backup_start(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;
        if !backup_file.exists() {
            let event = json!({
                "type": "backup_download_response",
                "requestId": request_id,
                "serverId": server_id,
                "success": false,
                "error": "Backup file not found",
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let event = json!({
            "type": "backup_download_response",
            "requestId": request_id,
            "serverId": server_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    async fn handle_download_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;
        if !backup_file.exists() {
            let event = json!({
                "type": "backup_download_chunk",
                "requestId": request_id,
                "serverId": server_id,
                "error": "Backup file not found",
                "done": true,
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let mut file = match tokio::fs::File::open(&backup_file).await {
            Ok(file) => file,
            Err(err) => {
                let event = json!({
                    "type": "backup_download_chunk",
                    "requestId": request_id,
                    "serverId": server_id,
                    "error": format!("Failed to open backup file: {}", err),
                    "done": true,
                });
                let mut w = write.lock().await;
                w.send(Message::Text(event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                return Ok(());
            }
        };
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let read = match file.read(&mut buffer).await {
                Ok(read) => read,
                Err(err) => {
                    let event = json!({
                        "type": "backup_download_chunk",
                        "requestId": request_id,
                        "serverId": server_id,
                        "error": format!("Failed to read backup file: {}", err),
                        "done": true,
                    });
                    let mut w = write.lock().await;
                    w.send(Message::Text(event.to_string().into()))
                        .await
                        .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                    break;
                }
            };
            if read == 0 {
                let done_event = json!({
                    "type": "backup_download_chunk",
                    "requestId": request_id,
                    "serverId": server_id,
                    "done": true,
                });
                let mut w = write.lock().await;
                w.send(Message::Text(done_event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                break;
            }

            let chunk = base64::engine::general_purpose::STANDARD.encode(&buffer[..read]);
            let event = json!({
                "type": "backup_download_chunk",
                "requestId": request_id,
                "serverId": server_id,
                "data": chunk,
                "done": false,
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        }

        Ok(())
    }

    async fn handle_upload_backup_start(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| msg["serverId"].as_str().unwrap_or("unknown"));
        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, true)
            .await?;
        let file = match tokio::fs::File::create(&backup_file).await {
            Ok(f) => f,
            Err(e) => {
                let event = json!({
                    "type": "backup_upload_response",
                    "requestId": request_id,
                    "success": false,
                    "error": format!("Failed to create upload file: {}", e),
                });
                let mut w = write.lock().await;
                w.send(Message::Text(event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                return Ok(());
            }
        };

        let session = BackupUploadSession {
            file,
            path: backup_file.clone(),
            bytes_written: 0,
            last_activity: tokio::time::Instant::now(),
        };

        let old_session = {
            let mut uploads = self.active_uploads.write().await;
            let old = uploads.remove(request_id);
            uploads.insert(request_id.to_string(), session);
            old
        };
        if let Some(old) = old_session {
            let path = old.path.clone();
            drop(old.file);
            let _ = tokio::fs::remove_file(&path).await;
        }

        let event = json!({
            "type": "backup_upload_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    async fn handle_upload_backup_chunk(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let data = msg["data"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing data".to_string()))?;
        let chunk = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| AgentError::InvalidRequest("Invalid chunk data".to_string()))?;

        let mut session = {
            let mut uploads = self.active_uploads.write().await;
            match uploads.remove(request_id) {
                Some(s) => s,
                None => {
                    let event = json!({
                        "type": "backup_upload_chunk_response",
                        "requestId": request_id,
                        "success": false,
                        "error": "Unknown upload request",
                    });
                    let mut w = write.lock().await;
                    w.send(Message::Text(event.to_string().into()))
                        .await
                        .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                    return Ok(());
                }
            }
        };

        let next_total = session.bytes_written.saturating_add(chunk.len() as u64);
        if next_total > MAX_BACKUP_UPLOAD_BYTES {
            let path = session.path.clone();
            drop(session.file);
            let _ = tokio::fs::remove_file(&path).await;
            let event = json!({
                "type": "backup_upload_chunk_response",
                "requestId": request_id,
                "success": false,
                "error": format!("Upload too large (max {} bytes)", MAX_BACKUP_UPLOAD_BYTES),
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        if let Err(e) = session.file.write_all(&chunk).await {
            let path = session.path.clone();
            drop(session.file);
            let _ = tokio::fs::remove_file(&path).await;
            let event = json!({
                "type": "backup_upload_chunk_response",
                "requestId": request_id,
                "success": false,
                "error": format!("Write failed: {}", e),
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        session.bytes_written = next_total;
        session.last_activity = tokio::time::Instant::now();

        // Reinsert the session now that the write has completed.
        self.active_uploads
            .write()
            .await
            .insert(request_id.to_string(), session);

        let event = json!({
            "type": "backup_upload_chunk_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    /// Handle a binary backup chunk (from the optimized streaming protocol).
    /// Writes directly to the file without JSON parsing or per-chunk ack responses.
    async fn handle_upload_backup_chunk_binary(
        &self,
        request_id: &str,
        data: &[u8],
    ) -> AgentResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        // Take the session out of the map, write, then put it back.
        // This avoids holding the write lock across the async I/O.
        let mut session = {
            let mut uploads = self.active_uploads.write().await;
            match uploads.remove(request_id) {
                Some(mut s) => {
                    let next_total = s.bytes_written.saturating_add(data.len() as u64);
                    if next_total > MAX_BACKUP_UPLOAD_BYTES {
                        let path = s.path.clone();
                        let _ = tokio::fs::remove_file(&path).await;
                        return Err(AgentError::InvalidRequest(format!(
                            "Upload too large (max {} bytes)",
                            MAX_BACKUP_UPLOAD_BYTES
                        )));
                    }
                    s.bytes_written = next_total;
                    s.last_activity = tokio::time::Instant::now();
                    s
                }
                None => {
                    return Err(AgentError::InvalidRequest(
                        "Unknown upload request".to_string(),
                    ));
                }
            }
        };

        session
            .file
            .write_all(data)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to write backup chunk: {}", e)))?;

        self.active_uploads
            .write()
            .await
            .insert(request_id.to_string(), session);

        Ok(())
    }

    async fn handle_upload_backup_complete(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let session = {
            let mut uploads = self.active_uploads.write().await;
            uploads.remove(request_id)
        };

        if let Some(mut s) = session {
            if let Err(e) = s.file.flush().await {
                let path = s.path.clone();
                drop(s);
                let _ = tokio::fs::remove_file(&path).await;
                let event = json!({
                    "type": "backup_upload_response",
                    "requestId": request_id,
                    "success": false,
                    "error": format!("Flush failed: {}", e),
                });
                let mut w = write.lock().await;
                w.send(Message::Text(event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                return Ok(());
            }
        } else {
            let event = json!({
                "type": "backup_upload_response",
                "requestId": request_id,
                "success": false,
                "error": "Unknown upload request",
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let event = json!({
            "type": "backup_upload_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    fn backup_base_dir(&self, server_uuid: &str) -> PathBuf {
        self.config
            .server
            .data_dir
            .join("backups")
            .join(server_uuid)
    }

    async fn resolve_backup_path(
        &self,
        server_uuid: &str,
        requested_path: &str,
        allow_create: bool,
    ) -> AgentResult<PathBuf> {
        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let base_dir = self.backup_base_dir(server_uuid);
        if allow_create {
            tokio::fs::create_dir_all(&base_dir).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to create backup directory: {}", e))
            })?;
        }

        let requested = PathBuf::from(requested_path);
        if requested
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(AgentError::InvalidRequest(
                "Invalid backup path".to_string(),
            ));
        }

        let normalized = if requested.is_absolute() {
            // Backend sends absolute paths (e.g. /var/lib/catalyst/backups/<uuid>/file.tar.gz)
            // but we store backups under data_dir/backups/<uuid>/. Extract just the filename.
            let filename = requested
                .file_name()
                .ok_or_else(|| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
            base_dir.join(filename)
        } else {
            base_dir.join(&requested)
        };

        let parent = normalized
            .parent()
            .ok_or_else(|| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
        if allow_create {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to create backup directory: {}", e))
            })?;
        }

        let base_canon = tokio::fs::canonicalize(&base_dir)
            .await
            .map_err(|_| AgentError::FileSystemError("Backup directory missing".to_string()))?;
        let parent_canon = tokio::fs::canonicalize(&parent)
            .await
            .map_err(|_| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
        if !parent_canon.starts_with(&base_canon) {
            return Err(AgentError::PermissionDenied(
                "Access denied: path outside backup directory".to_string(),
            ));
        }

        let file_name = normalized
            .file_name()
            .ok_or_else(|| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
        let candidate = parent_canon.join(file_name);
        if candidate.exists() {
            let canonical = candidate
                .canonicalize()
                .map_err(|_| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
            if !canonical.starts_with(&base_canon) {
                return Err(AgentError::PermissionDenied(
                    "Access denied: path outside backup directory".to_string(),
                ));
            }
            return Ok(canonical);
        }

        Ok(candidate)
    }

    async fn handle_resize_storage(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
        let allocated_disk_mb = msg["allocatedDiskMb"]
            .as_u64()
            .ok_or_else(|| AgentError::InvalidRequest("Missing allocatedDiskMb".to_string()))?;

        let server_dir = PathBuf::from(self.config.server.data_dir.as_path()).join(server_uuid);
        let allow_online_grow = true;

        let result = self
            .storage_manager
            .resize(
                server_uuid,
                &server_dir,
                allocated_disk_mb,
                allow_online_grow,
            )
            .await;

        let event = match &result {
            Ok(_) => json!({
                "type": "storage_resize_complete",
                "serverId": server_id,
                "serverUuid": server_uuid,
                "allocatedDiskMb": allocated_disk_mb,
                "success": true,
            }),
            Err(err) => json!({
                "type": "storage_resize_complete",
                "serverId": server_id,
                "serverUuid": server_uuid,
                "allocatedDiskMb": allocated_disk_mb,
                "success": false,
                "error": err.to_string(),
            }),
        };

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        result?;

        Ok(())
    }

    /// Start streaming a tar backup as binary WebSocket frames.
    /// Used during node transfer: the source agent tars the server data dir
    /// and sends raw bytes. The backend relays them to the target agent.
    async fn handle_start_backup_stream(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);

        if !server_dir.exists() {
            return Err(AgentError::NotFound(format!(
                "Server directory not found: {}",
                server_dir.display()
            )));
        }

        info!(
            "Starting backup stream for {} from {}",
            server_uuid,
            server_dir.display()
        );

        let mut child = tokio::process::Command::new("tar")
            .arg("-cf")
            .arg("-")
            .arg("-C")
            .arg(&server_dir)
            .arg(".")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to spawn tar: {}", e)))?;

        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::IoError("Failed to capture tar stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AgentError::IoError("Failed to capture tar stderr".to_string()))?;

        // Read stderr in background to avoid deadlock
        let stderr_task = tokio::spawn(async move {
            let mut stderr = stderr;
            let mut buf = Vec::new();
            use tokio::io::AsyncReadExt;
            let _ = stderr.read_to_end(&mut buf).await;
            buf
        });

        let mut write_guard = write.lock().await;
        let mut buf = vec![0u8; 64 * 1024]; // 64 KB read buffer

        loop {
            use tokio::io::AsyncReadExt;
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if write_guard
                        .send(Message::Binary(buf[..n].to_vec().into()))
                        .await
                        .is_err()
                    {
                        child.kill().await.ok();
                        return Err(AgentError::NetworkError(
                            "Failed to send backup chunk".to_string(),
                        ));
                    }
                }
                Err(e) => {
                    child.kill().await.ok();
                    return Err(AgentError::IoError(format!(
                        "Failed to read tar output: {}",
                        e
                    )));
                }
            }
        }

        drop(write_guard);

        let status = child
            .wait()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to wait for tar: {}", e)))?;

        let stderr_bytes = stderr_task.await.unwrap_or_default();

        if !status.success() {
            let code = status.code().unwrap_or(-1);
            return Err(AgentError::IoError(format!(
                "tar exited with code {}: {}",
                code,
                String::from_utf8_lossy(&stderr_bytes)
            )));
        }

        info!("Backup stream complete for {}", server_uuid);

        // Send completion signal as text frame
        let event = json!({
            "type": "backup_stream_complete",
            "requestId": request_id,
            "serverId": msg["serverId"],
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    /// Prepare to receive a streamed backup by spawning `tar -xf -`.
    /// The agent stores the child process; binary frames will be written to its stdin.
    async fn handle_prepare_restore_stream(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);

        if let Some(provided) = msg["serverDir"].as_str() {
            let derived = server_dir.to_string_lossy();
            if provided != derived {
                warn!(
                    "Ignoring backend-provided serverDir for {}: '{}' (using '{}')",
                    server_uuid, provided, derived
                );
            }
        }

        tokio::fs::create_dir_all(&server_dir).await.map_err(|e| {
            AgentError::IoError(format!("Failed to create server directory: {}", e))
        })?;

        info!(
            "Preparing restore stream for {} into {}",
            server_uuid,
            server_dir.display()
        );

        // Spawn tar with stdin piped. stdin stays in the Child so
        // write_restore_stream_chunk can access it via child.stdin.as_mut().
        let child = tokio::process::Command::new("tar")
            .arg("-xf")
            .arg("-")
            .arg("-C")
            .arg(&server_dir)
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to spawn tar: {}", e)))?;

        self.active_restore_streams
            .write()
            .await
            .insert(request_id.to_string(), child);

        *self.active_restore_request_id.write().await = Some(request_id.to_string());

        let event = json!({
            "type": "prepare_restore_stream_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    /// Write a binary data chunk to the restore stream's stdin.
    pub async fn write_restore_stream_chunk(
        &self,
        request_id: &str,
        data: &[u8],
    ) -> AgentResult<()> {
        let mut streams = self.active_restore_streams.write().await;
        if let Some(child) = streams.get_mut(request_id) {
            if let Some(stdin) = child.stdin.as_mut() {
                use tokio::io::AsyncWriteExt;
                stdin.write_all(data).await.map_err(|e| {
                    AgentError::IoError(format!("Failed to write to restore stdin: {}", e))
                })?;
            }
            Ok(())
        } else {
            Err(AgentError::InvalidRequest(
                "No active restore stream".to_string(),
            ))
        }
    }

    /// Close stdin and wait for tar to finish, then chown the restored data.
    async fn handle_finish_restore_stream(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let mut child = self
            .active_restore_streams
            .write()
            .await
            .remove(request_id)
            .ok_or_else(|| AgentError::InvalidRequest("No active restore stream".to_string()))?;

        *self.active_restore_request_id.write().await = None;

        // Close stdin (drop sends EOF)
        child.stdin.take();

        let stderr = child.stderr.take();
        let stderr_task = tokio::spawn(async move {
            if let Some(mut stderr) = stderr {
                let mut buf = Vec::new();
                use tokio::io::AsyncReadExt;
                let _ = stderr.read_to_end(&mut buf).await;
                String::from_utf8_lossy(&buf).to_string()
            } else {
                String::new()
            }
        });

        let status = child
            .wait()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to wait for restore tar: {}", e)))?;

        if !status.success() {
            let stderr_output = stderr_task.await.unwrap_or_default();
            return Err(AgentError::IoError(format!(
                "Restore tar failed: {}",
                stderr_output
            )));
        }

        let server_dir = self.config.server.data_dir.join(server_uuid);
        if let Err(e) = chown_to_container_user(&server_dir).await {
            warn!("Failed to chown restored directory: {}", e);
        }

        info!("Restore stream complete for {}", server_uuid);

        let event = json!({
            "type": "finish_restore_stream_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    /// Handle create_network message
    async fn handle_create_network(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let network = self.parse_network_config(msg)?;

        let result = NetworkManager::create_network(&network).await;

        let event = match &result {
            Ok(_) => json!({
                "type": "network_created",
                "networkName": network.name,
                "success": true,
            }),
            Err(err) => json!({
                "type": "network_created",
                "networkName": network.name,
                "success": false,
                "error": err.to_string(),
            }),
        };

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        result?;

        Ok(())
    }

    /// Handle update_network message
    async fn handle_update_network(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let old_name = msg["oldName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing oldName".to_string()))?;

        let network = self.parse_network_config(msg)?;

        let result = NetworkManager::update_network(old_name, &network).await;

        let event = match &result {
            Ok(_) => json!({
                "type": "network_updated",
                "oldName": old_name,
                "networkName": network.name,
                "success": true,
            }),
            Err(err) => json!({
                "type": "network_updated",
                "oldName": old_name,
                "networkName": network.name,
                "success": false,
                "error": err.to_string(),
            }),
        };

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        result?;

        Ok(())
    }

    /// Handle delete_network message
    async fn handle_delete_network(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let network_name = msg["networkName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing networkName".to_string()))?;

        let result = NetworkManager::delete_network(network_name).await;

        let event = match &result {
            Ok(_) => json!({
                "type": "network_deleted",
                "networkName": network_name,
                "success": true,
            }),
            Err(err) => json!({
                "type": "network_deleted",
                "networkName": network_name,
                "success": false,
                "error": err.to_string(),
            }),
        };

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        result?;

        Ok(())
    }

    /// Parse network configuration from message
    fn parse_network_config(&self, msg: &Value) -> AgentResult<CniNetworkConfig> {
        Ok(CniNetworkConfig {
            name: msg["networkName"]
                .as_str()
                .ok_or_else(|| AgentError::InvalidRequest("Missing networkName".to_string()))?
                .to_string(),
            interface: msg["interface"].as_str().map(|s| s.to_string()),
            cidr: msg["cidr"].as_str().map(|s| s.to_string()),
            gateway: msg["gateway"].as_str().map(|s| s.to_string()),
            range_start: msg["rangeStart"].as_str().map(|s| s.to_string()),
            range_end: msg["rangeEnd"].as_str().map(|s| s.to_string()),
        })
    }

    async fn emit_server_state_update(
        &self,
        server_id: &str,
        state: &str,
        reason: Option<String>,
        port_bindings: Option<HashMap<u16, u16>>,
        exit_code: Option<i32>,
    ) -> AgentResult<()> {
        let msg = ServerStateUpdate {
            ty: "server_state_update",
            serverId: server_id,
            state,
            timestamp: chrono::Utc::now().timestamp_millis(),
            reason,
            portBindings: port_bindings,
            exitCode: exit_code,
        };
        let text = serde_json::to_string(&msg).unwrap_or_default();

        debug!("Emitting state update: {}", text);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(text.into())).await {
                return Err(AgentError::NetworkError(format!(
                    "Failed to send state update: {}",
                    err
                )));
            }
        }

        Ok(())
    }

    async fn emit_console_output(
        &self,
        server_id: &str,
        stream: &str,
        data: &str,
    ) -> AgentResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        let msg = ConsoleOutput {
            ty: "console_output",
            serverId: server_id,
            stream,
            data,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let text = serde_json::to_string(&msg).unwrap_or_default();

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(text.into())).await {
                return Err(AgentError::NetworkError(format!(
                    "Failed to send console output: {}",
                    err
                )));
            }
            debug!(
                "console_output sent for server {} ({} bytes)",
                server_id,
                data.len()
            );
        } else {
            debug!(
                "console_output dropped for server {} — no active WebSocket",
                server_id
            );
        }

        Ok(())
    }

    /// Emit an eula_required message to the backend so the frontend can
    /// display an EULA acceptance modal.  The install is paused until the user
    /// responds via `accept_eula` or `decline_eula`.
    async fn emit_eula_required(
        &self,
        server_id: &str,
        server_uuid: &str,
        eula_text: &str,
        server_dir: &str,
    ) -> AgentResult<()> {
        let msg = EulaRequired {
            ty: "eula_required",
            serverId: server_id,
            serverUuid: server_uuid,
            eulaText: eula_text,
            serverDir: server_dir,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let text = serde_json::to_string(&msg).unwrap_or_default();

        info!("Emitting eula_required for server {}", server_id);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(text.into())).await {
                return Err(AgentError::NetworkError(format!(
                    "Failed to send eula_required: {}",
                    err
                )));
            }
        }

        Ok(())
    }

    /// Handle the user's response to the EULA prompt.
    /// - accepted: writes `eula=true` to eula.txt and marks the server as stopped.
    /// - declined: marks the server as errored so the user must reinstall.
    async fn handle_eula_response(&self, msg: &Value, accepted: bool) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);

        validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        let eula_file = server_dir.join("eula.txt");

        if accepted {
            tokio::fs::write(
                &eula_file,
                "eula=true
",
            )
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to write eula.txt: {}", e)))?;

            info!("EULA accepted for server {}", server_uuid);
            self.emit_console_output(
                server_id,
                "system",
                "[Catalyst] EULA accepted. Server is ready to start.\n",
            )
            .await?;

            self.stop_log_streams_for_server(server_id).await;
            self.emit_server_state_update(server_id, "stopped", None, None, None)
                .await?;
        } else {
            info!("EULA declined for server {}", server_uuid);
            self.emit_console_output(
                server_id,
                "system",
                "[Catalyst] EULA declined. Server installation cancelled.\n",
            )
            .await?;

            self.emit_server_state_update(
                server_id,
                "error",
                Some("EULA declined by user".to_string()),
                None,
                None,
            )
            .await?;
        }

        Ok(())
    }

    pub async fn send_health_report(&self) -> AgentResult<()> {
        debug!("Sending health report");
        let containers = self.runtime.list_containers().await?;
        let mut system = System::new();
        system.refresh_cpu_all();
        system.refresh_memory();
        let cpu_percent = system.global_cpu_usage();
        let memory_usage_mb = system.used_memory() / 1024;
        let memory_total_mb = system.total_memory() / 1024;
        let mut disks = Disks::new_with_refreshed_list();
        disks.refresh(true);
        let mut disk_usage_mb = 0u64;
        let mut disk_total_mb = 0u64;
        for disk in disks.list() {
            disk_total_mb += disk.total_space() / (1024 * 1024);
            disk_usage_mb +=
                disk.total_space().saturating_sub(disk.available_space()) / (1024 * 1024);
        }

        // Collect aggregate network stats across all interfaces
        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(true);
        let mut total_network_rx_bytes: u64 = 0;
        let mut total_network_tx_bytes: u64 = 0;
        for data in networks.list().values() {
            total_network_rx_bytes += data.total_received();
            total_network_tx_bytes += data.total_transmitted();
        }

        let health = HealthReport {
            ty: "health_report",
            nodeId: &self.config.server.node_id,
            timestamp: chrono::Utc::now().timestamp_millis(),
            cpuPercent: cpu_percent,
            memoryUsageMb: memory_usage_mb,
            memoryTotalMb: memory_total_mb,
            diskUsageMb: disk_usage_mb,
            diskTotalMb: disk_total_mb,
            containerCount: containers.iter().filter(|c| c.managed).count(),
            uptimeSeconds: get_uptime().await,
            networkRxBytes: total_network_rx_bytes,
            networkTxBytes: total_network_tx_bytes,
        };
        let health_text = serde_json::to_string(&health).unwrap_or_default();

        debug!("Health report: {}", health_text);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            w.send(Message::Text(health_text.into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        }

        Ok(())
    }

    /// Reconcile server states by checking actual container status and updating backend
    /// This prevents status drift when containers exit unexpectedly or agent reconnects
    pub async fn reconcile_server_states(&self) -> AgentResult<()> {
        debug!("Starting server state reconciliation");

        let containers = self.runtime.list_containers().await?;
        let writer = { self.write.read().await.clone() };
        let Some(ws) = writer else {
            debug!("No WebSocket connection, skipping reconciliation");
            return Ok(());
        };

        let container_count = containers.iter().filter(|c| c.managed).count();

        // Build map of running containers by name/ID
        let mut running_containers = HashSet::new();
        let mut found_uuids = Vec::new();
        for container in &containers {
            if !container.managed {
                continue;
            }
            let container_name = normalize_container_name(&container.names);
            if container_name.is_empty() {
                continue;
            }
            found_uuids.push(container_name.clone());
            if container.status.contains("Up") {
                running_containers.insert(container_name);
            }
        }

        // Report state for all known containers
        for container in containers {
            if !container.managed {
                continue;
            }
            let server_uuid = normalize_container_name(&container.names);
            if server_uuid.is_empty() {
                continue;
            }

            let is_running = container.status.contains("Up");

            // If container is stopped, try to get exit code to distinguish crashed vs stopped
            let exit_code = if !is_running {
                self.runtime
                    .get_container_exit_code(&container.id)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };

            // A non-zero exit code means the container crashed, not a clean stop
            let state = if is_running {
                "running"
            } else if exit_code.is_some_and(|code| code != 0) {
                "crashed"
            } else {
                "stopped"
            };

            info!(
                "Reconciling container: name='{}', uuid='{}', status='{}', state='{}'",
                container.names, server_uuid, container.status, state
            );

            let msg = ServerStateSync {
                ty: "server_state_sync",
                serverUuid: &server_uuid,
                containerId: &server_uuid,
                state,
                exitCode: exit_code,
                timestamp: chrono::Utc::now().timestamp_millis(),
            };
            let text = serde_json::to_string(&msg).unwrap_or_default();

            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(text.into())).await {
                warn!("Failed to send state sync: {}", err);
                break;
            }
        }

        // Send reconciliation complete message so backend knows which servers are missing
        #[derive(serde::Serialize)]
        #[allow(non_snake_case)]
        struct ServerStateSyncComplete<'a> {
            #[serde(rename = "type")]
            ty: &'static str,
            nodeId: &'a str,
            foundContainers: &'a [String],
            timestamp: i64,
        }
        let complete_msg = ServerStateSyncComplete {
            ty: "server_state_sync_complete",
            nodeId: &self.config.server.node_id,
            foundContainers: &found_uuids,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let complete_text = serde_json::to_string(&complete_msg).unwrap_or_default();

        let mut w = ws.lock().await;
        if let Err(err) = w.send(Message::Text(complete_text.into())).await {
            warn!("Failed to send reconciliation complete: {}", err);
        }

        info!(
            "Server state reconciliation complete: {} containers checked",
            container_count
        );
        Ok(())
    }

    /// Monitor all container events and sync state changes instantly
    /// This eliminates the need for periodic polling by using event-driven updates
    async fn monitor_global_events(&self) -> AgentResult<()> {
        info!("Starting global container event monitor for instant state syncing");

        let mut retry_delay = Duration::from_secs(5);
        loop {
            // Pre-subscription health check: verify containerd is responsive
            // before attempting a long-lived event stream subscription.
            match tokio::time::timeout(Duration::from_secs(5), self.runtime.list_containers()).await
            {
                Ok(Ok(_)) => {}
                Ok(Err(e)) => {
                    error!(
                        "containerd health check failed: {}. Retrying in {:?}...",
                        e, retry_delay
                    );
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(60));
                    continue;
                }
                Err(_) => {
                    error!(
                        "containerd health check timed out. Retrying in {:?}...",
                        retry_delay
                    );
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(60));
                    continue;
                }
            }

            // Subscribe to all events
            let event_stream = match self.runtime.subscribe_to_all_events().await {
                Ok(stream) => stream,
                Err(e) => {
                    error!(
                        "Failed to subscribe to global events: {}. Retrying in {:?}...",
                        e, retry_delay
                    );
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(60));
                    continue;
                }
            };

            // Reset backoff after successful subscription
            retry_delay = Duration::from_secs(5);

            let mut receiver = event_stream.receiver;

            // Read events from containerd gRPC streaming
            while let Ok(Some(envelope)) = receiver.message().await {
                let topic = &envelope.topic;

                if topic.is_empty() {
                    continue;
                }

                // Extract container ID from the event envelope
                // containerd events include the container ID in the event payload
                let container_name = if let Some(ref event) = envelope.event {
                    // Try to parse the container_id from the protobuf Any
                    extract_container_id_from_event(event).unwrap_or_default()
                } else {
                    String::new()
                };

                if container_name.is_empty() {
                    continue;
                }

                // Skip non-Catalyst containers (Catalyst uses CUID IDs starting with 'c' or 'catalyst-installer-')
                if !container_name.starts_with("cm") && !container_name.starts_with("catalyst-") {
                    continue;
                }

                // Map containerd event topics to state-changing events
                match topic.as_str() {
                    "/tasks/start" | "/tasks/exit" | "/tasks/paused" => {
                        debug!("Container {} event: {}", container_name, topic);

                        // Give the container a moment to stabilize state
                        tokio::time::sleep(Duration::from_millis(100)).await;

                        // Sync this specific container's state
                        if let Err(e) = self.sync_container_state(&container_name).await {
                            warn!("Failed to sync state for {}: {}", container_name, e);
                        }
                    }
                    "/containers/delete" => {
                        // Container has been removed - report as stopped immediately
                        debug!("Container {} removed", container_name);
                        if let Err(e) = self.sync_removed_container_state(&container_name).await {
                            warn!("Failed to sync removed state for {}: {}", container_name, e);
                        }
                    }
                    _ => {
                        // Ignore other events
                    }
                }
            }

            // Stream ended, restart
            warn!("Global event stream ended, restarting in 5s...");
            drop(receiver);
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }

    /// Sync a specific container's state to the backend
    async fn sync_container_state(&self, container_name: &str) -> AgentResult<()> {
        let writer = { self.write.read().await.clone() };
        let Some(ws) = writer else {
            return Ok(()); // No connection, skip
        };

        // Check if container exists first
        if !self.runtime.container_exists(container_name).await {
            // Container doesn't exist - treat as stopped/removed
            return self.sync_removed_container_state(container_name).await;
        }

        // Check if container is running and get its state
        let is_running = self
            .runtime
            .is_container_running(container_name)
            .await
            .unwrap_or(false);

        let exit_code = if !is_running {
            self.runtime
                .get_container_exit_code(container_name)
                .await
                .ok()
                .flatten()
        } else {
            None
        };

        // A non-zero exit code means the container crashed, not a clean stop
        let state = if is_running {
            "running"
        } else if exit_code.is_some_and(|code| code != 0) {
            "crashed"
        } else {
            "stopped"
        };

        let msg = ServerStateSync {
            ty: "server_state_sync",
            serverUuid: container_name,
            containerId: container_name,
            state,
            exitCode: exit_code,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let text = serde_json::to_string(&msg).unwrap_or_default();

        let mut w = ws.lock().await;
        w.send(Message::Text(text.into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        debug!("Synced state for {}: {}", container_name, state);
        Ok(())
    }

    /// Sync state for a removed/destroyed container (report as stopped)
    async fn sync_removed_container_state(&self, container_name: &str) -> AgentResult<()> {
        let writer = { self.write.read().await.clone() };
        let Some(ws) = writer else {
            return Ok(()); // No connection, skip
        };

        let msg = ServerStateSync {
            ty: "server_state_sync",
            serverUuid: container_name,
            containerId: container_name,
            state: "stopped",
            exitCode: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let text = serde_json::to_string(&msg).unwrap_or_default();

        let mut w = ws.lock().await;
        w.send(Message::Text(text.into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        debug!("Synced removed container {} as stopped", container_name);
        Ok(())
    }

    pub async fn send_resource_stats(&self, target_server: Option<&str>) -> AgentResult<()> {
        let writer_opt = { self.write.read().await.clone() };

        // Fast path for targeted immediate requests — avoid listing all containers
        if let Some(target) = target_server {
            let is_running = match tokio::time::timeout(
                Duration::from_secs(2),
                self.runtime.is_container_running(target),
            )
            .await
            {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    warn!(
                        "Fast-path is_container_running failed for {}: {}",
                        target, e
                    );
                    false
                }
                Err(_) => {
                    warn!("Fast-path is_container_running timed out for {}", target);
                    false
                }
            };

            if is_running {
                let stats = match tokio::time::timeout(
                    Duration::from_secs(3),
                    self.runtime.get_stats(target),
                )
                .await
                {
                    Ok(Ok(s)) => s,
                    Ok(Err(err)) => {
                        warn!("Fast-path get_stats failed for {}: {}", target, err);
                        return Ok(());
                    }
                    Err(_) => {
                        warn!("Fast-path get_stats timed out for {}", target);
                        return Ok(());
                    }
                };

                let cpu_percent = parse_percent(&stats.cpu_percent).unwrap_or(0.0);
                let memory_usage_mb = parse_memory_usage_mb(&stats.memory_usage).unwrap_or(0);
                let network_rx_bytes = stats.network_rx_bytes;
                let network_tx_bytes = stats.network_tx_bytes;
                let disk_io_mb = (stats.block_read_bytes + stats.block_write_bytes) / (1024 * 1024);

                // For immediate requests use a very short df timeout — stale data is fine
                let (disk_usage_mb, disk_total_mb) = match tokio::time::timeout(
                    Duration::from_secs(1),
                    self.runtime.exec(target, vec!["df", "-m", "/data"]),
                )
                .await
                {
                    Ok(Ok(output)) => parse_df_output_mb(&output).unwrap_or((disk_io_mb, 0)),
                    _ => (disk_io_mb, 0),
                };

                let payload = ResourceStats {
                    ty: "resource_stats",
                    serverUuid: target,
                    cpuPercent: cpu_percent,
                    memoryUsageMb: memory_usage_mb,
                    networkRxBytes: network_rx_bytes,
                    networkTxBytes: network_tx_bytes,
                    diskIoMb: disk_io_mb,
                    diskUsageMb: disk_usage_mb,
                    diskTotalMb: disk_total_mb,
                    timestamp: chrono::Utc::now().timestamp_millis(),
                };
                let payload_text = serde_json::to_string(&payload).unwrap_or_default();

                match &writer_opt {
                    Some(ws) => {
                        let mut w = ws.lock().await;
                        match w.send(Message::Text(payload_text.clone().into())).await {
                            Ok(_) => {}
                            Err(err) => {
                                warn!("Failed to send resource stats: {}. Buffering to disk.", err);
                                if let Err(e) = self
                                    .storage_manager
                                    .append_buffered_metric(&payload_text)
                                    .await
                                {
                                    warn!("Failed to buffer metric to disk: {}", e);
                                }
                            }
                        }
                    }
                    None => {
                        if let Err(e) = self
                            .storage_manager
                            .append_buffered_metric(&payload_text)
                            .await
                        {
                            warn!("Failed to buffer metric to disk: {}", e);
                        }
                    }
                }
                return Ok(());
            }

            // Not running — nothing to report
            return Ok(());
        }

        // Slow path — periodic health check: list all containers
        let containers =
            match tokio::time::timeout(Duration::from_secs(10), self.runtime.list_containers())
                .await
            {
                Ok(Ok(c)) => c,
                Ok(Err(e)) => {
                    warn!("Failed to list containers for resource stats: {}", e);
                    return Err(e);
                }
                Err(_) => {
                    warn!("list_containers timed out after 10s");
                    return Err(AgentError::NetworkError(
                        "list_containers timed out".to_string(),
                    ));
                }
            };

        if containers.is_empty() {
            return Ok(());
        }

        let sem = Arc::new(Semaphore::new(10));
        let mut handles = Vec::new();

        for container in containers {
            if !container.status.contains("Up") || !container.managed {
                continue;
            }

            let server_uuid = normalize_container_name(&container.names);
            if server_uuid.is_empty() {
                continue;
            }

            let runtime = self.runtime.clone();
            let sem = sem.clone();
            let handle = tokio::spawn(async move {
                let _permit = match sem.acquire().await {
                    Ok(p) => p,
                    Err(_) => return None,
                };
                let stats = match tokio::time::timeout(
                    Duration::from_secs(5),
                    runtime.get_stats(&container.id),
                )
                .await
                {
                    Ok(Ok(s)) => s,
                    Ok(Err(err)) => {
                        warn!(
                            "Failed to fetch stats for container {}: {}",
                            container.id, err
                        );
                        return None;
                    }
                    Err(_) => {
                        warn!("get_stats timed out for container {}", container.id);
                        return None;
                    }
                };

                let cpu_percent = parse_percent(&stats.cpu_percent).unwrap_or(0.0);
                let memory_usage_mb = parse_memory_usage_mb(&stats.memory_usage).unwrap_or(0);
                let network_rx_bytes = stats.network_rx_bytes;
                let network_tx_bytes = stats.network_tx_bytes;
                let disk_io_mb = (stats.block_read_bytes + stats.block_write_bytes) / (1024 * 1024);

                // Skip df exec in hot path; use block IO as a proxy for disk usage
                let disk_usage_mb = disk_io_mb;
                let disk_total_mb = 0u64;

                Some(ResourceStatsEntry {
                    serverUuid: server_uuid,
                    cpuPercent: cpu_percent,
                    memoryUsageMb: memory_usage_mb,
                    networkRxBytes: network_rx_bytes,
                    networkTxBytes: network_tx_bytes,
                    diskIoMb: disk_io_mb,
                    diskUsageMb: disk_usage_mb,
                    diskTotalMb: disk_total_mb,
                    timestamp: chrono::Utc::now().timestamp_millis(),
                })
            });
            handles.push(handle);
        }

        let mut metrics: Vec<ResourceStatsEntry> = Vec::new();
        for handle in handles {
            if let Ok(Some(entry)) = handle.await {
                metrics.push(entry);
            }
        }

        if metrics.is_empty() {
            return Ok(());
        }

        let batch = ResourceStatsBatch {
            ty: "resource_stats_batch",
            metrics,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        let payload_text = serde_json::to_string(&batch).unwrap_or_default();

        match &writer_opt {
            Some(ws) => {
                let mut w = ws.lock().await;
                match w.send(Message::Text(payload_text.clone().into())).await {
                    Ok(_) => {}
                    Err(err) => {
                        warn!(
                            "Failed to send resource stats batch: {}. Buffering to disk.",
                            err
                        );
                        if let Err(e) = self
                            .storage_manager
                            .append_buffered_metric(&payload_text)
                            .await
                        {
                            warn!("Failed to buffer metric to disk: {}", e);
                        }
                    }
                }
            }
            None => {
                // No connection - persist metric locally for later flush
                if let Err(e) = self
                    .storage_manager
                    .append_buffered_metric(&payload_text)
                    .await
                {
                    warn!("Failed to buffer metric to disk: {}", e);
                }
            }
        }

        Ok(())
    }
}

async fn get_uptime() -> u64 {
    tokio::fs::read_to_string("/proc/uptime")
        .await
        .ok()
        .and_then(|s| {
            s.split_whitespace()
                .next()
                .map(|first| first.parse::<f64>().ok())
        })
        .flatten()
        .map(|u| u as u64)
        .unwrap_or(0)
}

fn normalize_container_name(name: &str) -> String {
    name.split(|c: char| c == ',' || c.is_whitespace())
        .find(|part| !part.trim().is_empty())
        .unwrap_or("")
        .trim()
        .trim_start_matches('/')
        .to_string()
}

/// Extract container_id from a containerd event's protobuf Any payload
fn extract_container_id_from_event(event: &prost_types::Any) -> Option<String> {
    // containerd task events encode container_id as a field in the protobuf message
    // The value bytes contain the serialized protobuf; container_id is typically field 1 (tag 0x0a)
    let data = &event.value;
    let mut i = 0;
    while i < data.len() {
        let tag_byte = data[i];
        let field_number = tag_byte >> 3;
        let wire_type = tag_byte & 0x07;
        i += 1;
        if wire_type == 2 {
            // Length-delimited field
            if i >= data.len() {
                break;
            }
            let len = data[i] as usize;
            i += 1;
            if field_number == 1 && i + len <= data.len() {
                if let Ok(s) = std::str::from_utf8(&data[i..i + len]) {
                    return Some(s.to_string());
                }
            }
            i += len;
        } else if wire_type == 0 {
            // Varint
            while i < data.len() && data[i] & 0x80 != 0 {
                i += 1;
            }
            i += 1;
        } else {
            break;
        }
    }
    None
}

fn parse_percent(value: &str) -> Option<f64> {
    let trimmed = value.trim().trim_end_matches('%').trim();
    trimmed.parse::<f64>().ok()
}

fn parse_memory_usage_mb(value: &str) -> Option<u64> {
    let first = value.split('/').next()?.trim();
    parse_size_to_bytes(first).map(|bytes| bytes / (1024 * 1024))
}

fn parse_size_to_bytes(value: &str) -> Option<u64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    static SIZE_RE: OnceLock<Regex> = OnceLock::new();
    let re = SIZE_RE.get_or_init(|| {
        Regex::new(r"(?i)^\s*([0-9]+(?:\.[0-9]+)?)\s*([kmgtp]?i?b?)?\s*$")
            .expect("valid size regex")
    });
    let caps = re.captures(trimmed)?;
    let number = caps.get(1)?.as_str().parse::<f64>().ok()?;
    let unit = caps
        .get(2)
        .map(|m| m.as_str().to_lowercase())
        .unwrap_or_default();
    let multiplier = match unit.as_str() {
        "" | "b" => 1f64,
        "k" | "kb" => 1_000f64,
        "ki" | "kib" => 1_024f64,
        "m" | "mb" => 1_000_000f64,
        "mi" | "mib" => 1_048_576f64,
        "g" | "gb" => 1_000_000_000f64,
        "gi" | "gib" => 1_073_741_824f64,
        "t" | "tb" => 1_000_000_000_000f64,
        "ti" | "tib" => 1_099_511_627_776f64,
        _ => return None,
    };
    Some((number * multiplier).round() as u64)
}

fn parse_df_output_mb(output: &str) -> Option<(u64, u64)> {
    let mut lines = output.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next()?;
    if !header.to_lowercase().contains("filesystem") {
        return None;
    }
    let data = lines.next()?;
    let parts: Vec<&str> = data.split_whitespace().collect();
    if parts.len() < 6 {
        return None;
    }
    let total_mb = parts[1].parse::<u64>().ok()?;
    let used_mb = parts[2].parse::<u64>().ok()?;
    Some((used_mb, total_mb))
}
