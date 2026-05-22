use base64::Engine;
use futures::stream::SplitSink;
use futures::{SinkExt, StreamExt};
use regex::Regex;
use reqwest::Url;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, System};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{RwLock, Semaphore};
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use tokio_tungstenite::connect_async_with_config;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::backup_crypto;
use crate::config::CniNetworkConfig;
use crate::shell_utils;
use crate::{
    runtime_manager::{rotate_logs, parse_ctr_event_line}, AgentConfig, AgentError, AgentResult, ContainerdRuntime,
    FileManager, FirewallManager, NetworkManager, StorageManager,
};
use crate::error_reporter::{ErrorLevel, DEDUP_WINDOW_SECS};

pub(crate) type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
pub(crate) type WsWrite = SplitSink<WsStream, Message>;
pub(crate) const CONTAINER_SERVER_DIR: &str = "/data";
pub(crate) const CONTAINER_UID: u32 = 1000;
pub(crate) const CONTAINER_GID: u32 = 1000;
pub(crate) const MAX_BACKUP_UPLOAD_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10GB
pub(crate) const MAX_RESTORE_STREAM_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10 GB, matches MAX_BACKUP_UPLOAD_BYTES
pub(crate) const BACKUP_UPLOAD_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes
pub(crate) const MAX_CONSOLE_BATCH_BYTES: usize = 32768; // Max bytes to batch into a single console_output message
pub(crate) const MAX_EVENT_SUBSCRIBE_FAILURES: u32 = 10; // Give up on event monitor after this many consecutive failures

// ---------------------------------------------------------------------------
// Typed message structs for hot-path serialization (avoids json! allocation)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
pub(crate) struct ConsoleOutput<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    serverId: &'a str,
    stream: &'a str,
    data: &'a str,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
pub(crate) struct ServerStateUpdate<'a> {
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
pub(crate) struct EulaRequired<'a> {
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
pub(crate) struct HealthReport<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    nodeId: &'a str,
    timestamp: i64,
    agentVersion: &'a str,
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
pub(crate) struct ResourceStats<'a> {
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
pub(crate) struct ResourceStatsEntry {
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
pub(crate) struct ResourceStatsBatch {
    #[serde(rename = "type")]
    ty: &'static str,
    metrics: Vec<ResourceStatsEntry>,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
pub(crate) struct ServerStateSync<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    serverUuid: &'a str,
    containerId: &'a str,
    state: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    exitCode: Option<i32>,
    timestamp: i64,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
pub(crate) struct DiscoveredServer<'a> {
    containerId: &'a str,
    image: &'a str,
    status: &'a str,
    labels: &'a HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    networkMode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memoryLimitMb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpuCores: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    startupCommand: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    envVarNames: Vec<String>,
}

#[derive(serde::Serialize)]
#[allow(non_snake_case)]
pub(crate) struct DiscoveredServers<'a> {
    #[serde(rename = "type")]
    ty: &'static str,
    nodeId: &'a str,
    containers: Vec<DiscoveredServer<'a>>,
    timestamp: i64,
}





#[derive(Clone, Debug)]
pub(crate) struct StopPolicy {
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

pub(crate) fn parse_stop_policy(msg: &Value) -> StopPolicy {
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

pub(crate) struct BackupUploadSession {
    file: tokio::fs::File,
    path: PathBuf,
    bytes_written: u64,
    last_activity: tokio::time::Instant,
}

/// Configuration for automatic container restart on crash.
#[derive(Clone, Debug)]
pub(crate) struct AutoRestartConfig {
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
pub(crate) struct RestartTracker {
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


pub(crate) fn parse_auto_restart_config(msg: &Value) -> AutoRestartConfig {
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
pub(crate) async fn chown_to_container_user(dir: &std::path::Path) -> std::io::Result<()> {
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



pub struct WebSocketHandler {
    pub(crate) config: Arc<AgentConfig>,
    pub(crate) runtime: Arc<ContainerdRuntime>,
    pub(crate) file_manager: Arc<FileManager>,
    pub(crate) storage_manager: Arc<StorageManager>,
    pub(crate) network_manager: NetworkManager,
    pub(crate) backend_connected: Arc<RwLock<bool>>,
    pub(crate) write: Arc<RwLock<Option<Arc<tokio::sync::Mutex<WsWrite>>>>>,
    pub(crate) active_log_streams: Arc<RwLock<HashSet<String>>>,
    pub(crate) monitor_tasks: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
    pub(crate) active_uploads: Arc<RwLock<HashMap<String, BackupUploadSession>>>,
    /// Auto-restart config per server_id, stored when start_server_with_details is called.
    pub(crate) auto_restart_configs: Arc<RwLock<HashMap<String, AutoRestartConfig>>>,
    /// Tracks restart attempt timestamps per server_id.
    pub(crate) restart_trackers: Arc<RwLock<HashMap<String, RestartTracker>>>,
    /// Stores the original start_server message JSON per server_id for auto-restart.
    /// Sensitive fields (installScript, environment values) are stripped before storage.
    pub(crate) start_server_messages: Arc<RwLock<HashMap<String, Value>>>,
    /// Maps server_id -> (container_id, primary_port) for health checking.
    pub(crate) server_ports: Arc<RwLock<HashMap<String, (String, u16)>>>,
    /// Tracks per-server health state to avoid duplicate unhealthy/healthy emissions.
    pub(crate) server_health_state: Arc<RwLock<HashMap<String, bool>>>,
    /// Active restore stream child processes keyed by requestId (for pipe relay transfer).
    pub(crate) active_restore_streams: Arc<RwLock<HashMap<String, tokio::process::Child>>>,
    /// Tracks bytes written to each active restore stream to prevent decompression bombs.
    pub(crate) active_restore_bytes_written: Arc<RwLock<HashMap<String, u64>>>,
    /// The requestId of the currently active restore stream (at most one at a time).
    pub(crate) active_restore_request_id: Arc<RwLock<Option<String>>>,
    /// When set by the backend after an auth failure, the agent should wait this many
    /// seconds before reconnecting (progressive lockout).
    pub(crate) retry_after_seconds: Arc<RwLock<Option<u64>>>,
    /// Deduplication map for error reporting: (component|message_prefix) -> last_sent.
    pub(crate) error_dedup: Arc<tokio::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>>,
    /// PID of the ctr events subprocess, for explicit cleanup during shutdown.
    pub(crate) ctr_event_pid: Arc<tokio::sync::Mutex<Option<u32>>>,
}

// LOCK ORDERING (must be respected to prevent deadlocks):
// When acquiring multiple locks simultaneously, always acquire in this order:
//   1. write (WsWrite mutex — outermost, held during message send)
//   2. active_restore_streams
//   3. active_restore_bytes_written  (must be after active_restore_streams)
//   4. active_restore_request_id
//   5. active_uploads
//   6. active_log_streams
//   7. monitor_tasks
//   8. auto_restart_configs
//   9. restart_trackers
//  10. start_server_messages
//  11. server_ports
//  12. server_health_state
//  13. retry_after_seconds
//  14. backend_connected (rarely contended, almost always read)
//
// Rule: never hold lock N while attempting to acquire lock M where M < N.

impl Clone for WebSocketHandler {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            file_manager: self.file_manager.clone(),
            storage_manager: self.storage_manager.clone(),
            network_manager: self.network_manager.clone(),
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
            active_restore_bytes_written: self.active_restore_bytes_written.clone(),
            active_restore_request_id: self.active_restore_request_id.clone(),
            retry_after_seconds: self.retry_after_seconds.clone(),
            error_dedup: self.error_dedup.clone(),
            ctr_event_pid: self.ctr_event_pid.clone(),
        }
    }
}


mod backup;
mod server_lifecycle;
mod console;
mod monitoring;

impl WebSocketHandler {
    pub(crate) fn select_agent_auth_token(&self) -> AgentResult<(&str, &'static str)> {
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
        let network_manager = NetworkManager::new(
            config.containerd.cni_dir.clone(),
            config.agent.config_path.clone(),
        );
        Self {
            config,
            runtime,
            file_manager,
            storage_manager,
            network_manager,
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
            active_restore_bytes_written: Arc::new(RwLock::new(HashMap::new())),
            active_restore_request_id: Arc::new(RwLock::new(None)),
            retry_after_seconds: Arc::new(RwLock::new(None)),
            error_dedup: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            ctr_event_pid: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    pub(crate) async fn set_backend_connected(&self, connected: bool) {
        let mut status = self.backend_connected.write().await;
        *status = connected;
    }

    pub async fn report_error(
        &self,
        level: ErrorLevel,
        component: &str,
        message: &str,
        stack: Option<&str>,
        metadata: Option<serde_json::Value>,
    ) {
        // Dedup: suppress duplicate reports within the window
        {
            let mut dedup = self.error_dedup.lock().await;
            let key = format!(
                "{}|{}",
                component,
                &message[..message.len().min(200)]
            );
            let now = std::time::Instant::now();
            if let Some(last) = dedup.get(&key) {
                if now.duration_since(*last)
                    < std::time::Duration::from_secs(DEDUP_WINDOW_SECS)
                {
                    return; // Duplicate suppressed
                }
            }
            dedup.insert(key, now);
        }

        // Build the message payload
        let payload = serde_json::json!({
            "type": "agent_error_report",
            "nodeId": self.config.server.node_id,
            "level": level.as_str(),
            "component": component,
            "message": message,
            "stack": stack,
            "metadata": metadata,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        // Send via WebSocket (best effort)
        let guard = self.write.read().await;
        if let Some(write_arc) = guard.as_ref() {
            let mut w = write_arc.lock().await;
            let msg = payload.to_string();
            if let Err(e) = w
                .send(tokio_tungstenite::tungstenite::Message::Text(msg.into()))
                .await
            {
                warn!("Failed to send error report via WS: {}", e);
            }
        }
    }

    pub(crate) async fn flush_buffered_metrics(
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
                match serde_json::to_string(&chunk[0]) {
                    Ok(s) => s,
                    Err(e) => {
                        warn!("Failed to serialize metrics: {}", e);
                        continue;
                    }
                }
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
            let console_log_dir = self.config.server.console_log_dir.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(300)).await;
                    // Rotate logs for all running containers
                    if let Ok(containers) = runtime.list_containers().await {
                        for c in &containers {
                            rotate_logs(&console_log_dir, &c.id).await;
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
                    // Report connection errors to the backend (best effort, will send when reconnected)
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:connection",
                        &format!("{}", e),
                        None,
                        None,
                    ).await;
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
            "ws" => {
                // Check if ws:// is explicitly allowed via opt-in env var.
                // Fix for UF-10: ws:// should be blocked for non-loopback
                // unless the operator explicitly sets CATALYST_ALLOW_INSECURE_WS=1.
                let allow_insecure = std::env::var("CATALYST_ALLOW_INSECURE_WS")
                    .map(|s| s == "1")
                    .unwrap_or(false);
                if !allow_insecure {
                    // Block ws:// for non-loopback addresses
                    let host = parsed_url.host_str().unwrap_or("");
                    let is_loopback = host == "localhost"
                        || host == "127.0.0.1"
                        || host == "::1"
                        || host.starts_with("127.");
                    if !is_loopback {
                        return Err(AgentError::ConfigError(
                            "Insecure ws:// is not allowed for non-loopback addresses. \
                             Use wss:// or set CATALYST_ALLOW_INSECURE_WS=1 to override."
                                .to_string(),
                        ));
                    }
                    warn!(
                        "Using insecure WebSocket connection (ws://) — only allowed for loopback"
                    );
                } else {
                    warn!("Using insecure WebSocket connection (ws://) — CATALYST_ALLOW_INSECURE_WS=1 is set");
                }
            }
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
            "agentVersion": env!("CARGO_PKG_VERSION"),
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

        // Start periodic state reconciliation task (every 30 seconds)
        // This catches any status drift that may occur.  When the event monitor
        // is working, reconciliation is a safety net.  When events are broken,
        // this becomes the primary state-sync mechanism.
        let handler_clone = self.clone();
        connection_tasks.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
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
                handler_clone.report_error(
                    ErrorLevel::Error,
                    "agent:event_monitor",
                    &format!("{}", e),
                    None,
                    None,
                ).await;
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
                        self.report_error(
                            ErrorLevel::Error,
                            "agent:message_handler",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
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
                                self.report_error(
                                    ErrorLevel::Error,
                                    "agent:restore_stream",
                                    &format!("{}", e),
                                    None,
                                    None,
                                ).await;
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
                            self.report_error(
                                ErrorLevel::Error,
                                "agent:backup_upload",
                                &format!("{}", e),
                                None,
                                None,
                            ).await;
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("Backend closed connection");
                    break;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:websocket",
                        &format!("{}", e),
                        None,
                        None,
                    ).await;
                    break;
                }
                _ => {}
            }
        }

        for task in connection_tasks {
            task.abort();
        }

        // Kill ctr events subprocess explicitly — task abort may not drop
        // the CtrChildGuard before the process exits.
        if let Some(ctr_pid) = *self.ctr_event_pid.lock().await {
            let _ = kill(Pid::from_raw(ctr_pid as i32), Signal::SIGKILL);
            *self.ctr_event_pid.lock().await = None;
        }

        // Drop any in-progress uploads on disconnect to avoid stale sessions accumulating across
        // reconnects and to release file descriptors.
        self.cleanup_all_uploads().await;

        // Kill any active restore streams on disconnect, and reap zombie processes.
        // Lock ordering: active_restore_streams before active_restore_bytes_written.
        {
            let mut streams = self.active_restore_streams.write().await;
            for (rid, mut child) in streams.drain() {
                child.stdin.take(); // close stdin
                let _ = child.kill().await;
                // Always reap the zombie process, even if kill() failed
                // (e.g., process already exited — ESRCH on Unix).
                match child.wait().await {
                    Ok(status) => {
                        debug!("Orphaned restore stream {} exited with: {}", rid, status);
                    }
                    Err(e) => {
                        warn!("Failed to wait for orphaned restore stream {}: {}", rid, e);
                    }
                }
                warn!("Cleaned up orphaned restore stream {}", rid);
            }
        }
        // Clean up restore byte counters
        self.active_restore_bytes_written.write().await.clear();

        {
            let mut guard = self.write.write().await;
            *guard = None;
        }

        Ok(())
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
                        let server_id = msg["serverId"].as_str().unwrap_or("unknown");
                        handler.report_error(
                            ErrorLevel::Error,
                            &format!("agent:install_server:{}", server_id),
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
                    }
                });
            }
            Some("reinstall_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.reinstall_server(&msg).await {
                        error!("Error in reinstall_server handler: {}", e);
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:reinstall_server",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
                    }
                });
            }
            Some("rebuild_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.rebuild_server(&msg).await {
                        error!("Error in rebuild_server handler: {}", e);
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:rebuild_server",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
                    }
                });
            }
            Some("start_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.start_server_with_details(&msg).await {
                        error!("Error in start_server handler: {}", e);
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:start_server",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
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
                                    handler.report_error(
                                        ErrorLevel::Error,
                                        "agent:restart_server:force_kill",
                                        &format!("{}", e),
                                        None,
                                        None,
                                    ).await;
                                }
                                break;
                            }
                            _ => {}
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    if let Err(e) = handler.start_server_with_details(&msg).await {
                        error!("Error in restart_server (start) handler: {}", e);
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:restart_server:start",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
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
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:create_backup",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
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
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:restore_backup",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
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
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:backup_stream",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
                    }
                });
            }
            Some("prepare_restore_stream") => {
                self.handle_prepare_restore_stream(&msg, write).await?
            }
            Some("finish_restore_stream") => self.handle_finish_restore_stream(&msg, write).await?,
            Some("clone_server_files") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_clone_server_files(&msg, &write).await {
                        error!("Error in handle_clone_server_files handler: {}", e);
                        handler.report_error(
                            ErrorLevel::Error,
                            "agent:clone_server_files",
                            &format!("{}", e),
                            None,
                            None,
                        ).await;
                    }
                });
            }
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
            Some("update_agent") => {
                let target_version = msg
                    .get("targetVersion")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let target_version_display = target_version.as_deref().unwrap_or("latest").to_string();
                info!(
                    "Received update_agent command from backend (target={})",
                    target_version_display
                );
                let handler = self.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    let updater = crate::updater::AgentUpdater::new(&handler.config);
                    let options = crate::updater::UpdateOptions { target_version };
                    match updater.update(&options).await {
                        Ok(_) => {
                            info!("Agent update succeeded, restarting via exec()");
                            // Notify backend that update is being applied (before exec replaces us).
                            // After exec() the new process will reconnect with
                            // the updated version, but this message lets the
                            // panel know the update is in progress.
                            let payload = json!({
                                "type": "agent_update_started",
                                "targetVersion": options.target_version,
                            });
                            let mut w = write.lock().await;
                            let _ = w.send(Message::Text(payload.to_string().into())).await;
                            // drop the write lock before exec replaces this process
                            drop(w);
                        }
                        Err(e) => {
                            error!("Agent update failed: {}", e);
                            handler.report_error(
                                ErrorLevel::Error,
                                "agent:update",
                                &format!("{}", e),
                                None,
                                None,
                            ).await;
                            let payload = json!({
                                "type": "agent_update_failed",
                                "error": e.to_string(),
                            });
                            let mut w = write.lock().await;
                            let _ = w.send(Message::Text(payload.to_string().into())).await;
                        }
                    }
                });
            }
            Some("create_network") => self.handle_create_network(&msg, write).await?,
            Some("update_network") => self.handle_update_network(&msg, write).await?,
            Some("delete_network") => self.handle_delete_network(&msg, write).await?,
            Some("allocation_added") => self.handle_allocation_added(&msg).await?,
            Some("allocation_removed") => self.handle_allocation_removed(&msg).await?,
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

    async fn handle_clone_server_files(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let source_uuid = msg["sourceServerUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing sourceServerUuid".to_string()))?;
        let target_uuid = msg["targetServerUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing targetServerUuid".to_string()))?;
        let server_id = msg["serverId"].as_str().unwrap_or(target_uuid);

        shell_utils::validate_safe_path_segment(source_uuid, "sourceServerUuid")?;
        shell_utils::validate_safe_path_segment(target_uuid, "targetServerUuid")?;

        let source_dir = self.config.server.data_dir.join(source_uuid);
        let target_dir = self.config.server.data_dir.join(target_uuid);

        if !source_dir.exists() {
            let event = json!({
                "type": "clone_files_complete",
                "serverId": server_id,
                "success": false,
                "error": format!("Source server directory not found: {}", source_dir.display()),
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        // Create target directory if it doesn't exist
        if !target_dir.exists() {
            tokio::fs::create_dir_all(&target_dir).await.map_err(|e| {
                AgentError::IoError(format!("Failed to create target directory: {}", e))
            })?;
        }

        info!(
            "Cloning files from {} to {}",
            source_dir.display(),
            target_dir.display()
        );

        // Use cp -a to copy all files preserving permissions, ownership, symlinks
        let status = tokio::process::Command::new("cp")
            .arg("-a")
            .arg(format!("{}/.", source_dir.display()))
            .arg(&target_dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .status()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to spawn cp: {}", e)))?;

        if !status.success() {
            let event = json!({
                "type": "clone_files_complete",
                "serverId": server_id,
                "success": false,
                "error": format!("cp -a exited with code {}", status.code().unwrap_or(-1)),
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        // Security: validate symlinks in cloned files — cp -a preserves symlinks,
        // and a malicious source server could contain symlinks that escape the
        // server directory (UF-08).
        let canonical_base = tokio::fs::canonicalize(&target_dir)
            .await
            .unwrap_or_else(|_| target_dir.clone());
        let mut dangerous = Vec::new();
        if let Err(e) = self
            .check_restore_symlinks(&target_dir, &canonical_base, &mut dangerous)
            .await
        {
            warn!("Symlink scan failed after clone: {}", e);
        }
        if !dangerous.is_empty() {
            warn!(
                "Removing {} dangerous symlinks from cloned server {}",
                dangerous.len(),
                target_uuid
            );
            for link in &dangerous {
                if let Some(link_path) = link.split(" -> ").next() {
                    let _ = tokio::fs::remove_file(link_path).await;
                }
            }
        }

        // Chown the target directory to the container user
        if let Err(e) = chown_to_container_user(&target_dir).await {
            warn!("Failed to chown cloned files: {}", e);
        }

        info!("File clone complete for {} -> {}", source_uuid, target_uuid);

        let event = json!({
            "type": "clone_files_complete",
            "serverId": server_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
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

    async fn handle_create_network(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let network = self.parse_network_config(msg)?;

        let result = self.network_manager.create_network(&network).await;

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

    async fn handle_update_network(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let old_name = msg["oldName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing oldName".to_string()))?;

        let network = self.parse_network_config(msg)?;

        let result = self
            .network_manager
            .update_network(old_name, &network)
            .await;

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

    async fn handle_delete_network(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let network_name = msg["networkName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing networkName".to_string()))?;

        let result = self.network_manager.delete_network(network_name).await;

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

    pub(crate) fn parse_network_config(&self, msg: &Value) -> AgentResult<CniNetworkConfig> {
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

    pub(crate) async fn emit_server_state_update(
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

    pub(crate) async fn emit_console_output(
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

    pub(crate) async fn emit_eula_required(
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

    async fn handle_allocation_added(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"].as_str().unwrap_or(server_id);
        let host_port = msg["hostPort"]
            .as_u64()
            .ok_or_else(|| AgentError::InvalidRequest("Missing hostPort".to_string()))?;
        if host_port == 0 || host_port > u16::MAX as u64 {
            return Err(AgentError::InvalidRequest(
                "Invalid hostPort: out of valid range".to_string(),
            ));
        }
        let host_port = host_port as u16;
        let container_ip = msg["containerIp"].as_str().unwrap_or("");
        let protocol = msg["protocol"].as_str().unwrap_or("tcp");

        info!(
            "Hot-add allocation: server={} port={}/{} ip={}",
            server_id, host_port, protocol, container_ip
        );

        // Open firewall rule for the new host port.
        // For host-networking or no IP, use "0.0.0.0" as fallback — same
        // pattern as start_server so rules are consistently tracked.
        let effective_ip = if container_ip.is_empty() {
            "0.0.0.0"
        } else {
            container_ip
        };
        FirewallManager::allow_port(host_port, protocol, effective_ip, server_id).await?;

        // Emit console notification so the user sees the change in real time
        self.emit_console_output(
            server_id,
            "system",
            &format!(
                "[Catalyst] Allocation added: host port {} → container (hot-add)\n",
                host_port
            ),
        )
        .await?;

        // Also try server_uuid as key for tracked rules, matching start_server convention
        if server_uuid != server_id {
            FirewallManager::allow_port(host_port, protocol, effective_ip, server_uuid).await?;
        }

        Ok(())
    }

    async fn handle_allocation_removed(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"].as_str().unwrap_or(server_id);
        let host_port = msg["hostPort"]
            .as_u64()
            .ok_or_else(|| AgentError::InvalidRequest("Missing hostPort".to_string()))?;
        if host_port == 0 || host_port > u16::MAX as u64 {
            return Err(AgentError::InvalidRequest(
                "Invalid hostPort: out of valid range".to_string(),
            ));
        }
        let host_port = host_port as u16;
        let protocol = msg["protocol"].as_str().unwrap_or("tcp");

        info!(
            "Hot-remove allocation: server={} port={}/{}",
            server_id, host_port, protocol
        );

        // Remove firewall rules for this server.  We remove ALL rules for
        // the server, then re-add the remaining ones, because remove_server_ports
        // is the only reliable API (it deduplicates by port/proto).
        //
        // However, for a single-port removal we can be smarter: remove the
        // specific tracked rule and re-add the rest.  But the tracked_rules
        // system already handles this correctly via remove_server_ports +
        // re-add of surviving ports.  For simplicity and correctness, we
        // use the remove + re-add pattern.

        // Step 1: Remove all firewall rules for this server
        FirewallManager::remove_server_ports(server_id).await;
        if server_uuid != server_id {
            FirewallManager::remove_server_ports(server_uuid).await;
        }

        // Step 2: Re-add rules for the remaining ports (from the message's portBindings
        // if provided, or we just leave them removed — the next start_server call will
        // re-add all ports). For hot-remove, the backend has already updated the DB,
        // so the next reconciliation cycle will re-add remaining ports.
        //
        // For immediate correctness, we re-add the remaining ports from the message:
        if let Some(bindings) = msg.get("remainingPortBindings").and_then(|v| v.as_object()) {
            let container_ip = msg["containerIp"].as_str().unwrap_or("");
            // Use "0.0.0.0" fallback for host-networking, matching handle_allocation_added
            let effective_ip = if container_ip.is_empty() {
                "0.0.0.0"
            } else {
                container_ip
            };
            for (_container_port, host_port_val) in bindings {
                let hp_raw = host_port_val.as_u64().unwrap_or(0);
                if hp_raw == 0 || hp_raw > u16::MAX as u64 {
                    continue;
                }
                let hp = hp_raw as u16;
                if hp != host_port {
                    FirewallManager::allow_port(hp, protocol, effective_ip, server_id).await?;
                    if server_uuid != server_id {
                        FirewallManager::allow_port(hp, protocol, effective_ip, server_uuid)
                            .await?;
                    }
                }
            }
        }

        // Emit console notification
        self.emit_console_output(
            server_id,
            "system",
            &format!(
                "[Catalyst] Allocation removed: host port {} (hot-remove)\n",
                host_port
            ),
        )
        .await?;

        Ok(())
    }

    async fn handle_eula_response(&self, msg: &Value, accepted: bool) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);

        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
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
