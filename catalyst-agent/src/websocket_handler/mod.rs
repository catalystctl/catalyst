use base64::Engine;
use futures::stream::SplitSink;
use futures::{SinkExt, StreamExt};
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use regex::Regex;
use reqwest::Url;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use sysinfo::{Networks, System};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{broadcast, RwLock, Semaphore};
use tokio_tungstenite::connect_async_with_config;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::atomic_write;
use crate::backup_crypto;
use crate::config::CniNetworkConfig;
use crate::error_reporter::{ErrorLevel, DEDUP_WINDOW_SECS};
use crate::shell_utils;
use crate::{
    runtime_manager::{parse_ctr_event_line, rotate_logs},
    AgentConfig, AgentError, AgentResult, ContainerdRuntime, FileManager, FirewallManager,
    NetworkManager, StorageManager,
};

pub(crate) type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
pub(crate) type WsWrite = SplitSink<WsStream, Message>;
pub(crate) const CONTAINER_SERVER_DIR: &str = "/data";
pub(crate) use crate::ownership::chown_tree as chown_to_container_user;
pub(crate) const MAX_BACKUP_UPLOAD_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10GB
pub(crate) const MAX_RESTORE_STREAM_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10 GB, matches MAX_BACKUP_UPLOAD_BYTES
pub(crate) const BACKUP_UPLOAD_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes
/// Maximum number of buffered control-plane events (error reports, critical
/// state updates) replayed after a reconnect. Oldest overflow is dropped.
pub(crate) const MAX_EVENT_REPLAY: usize = 200;
pub(crate) const MAX_CONSOLE_BATCH_BYTES: usize = 32768; // Max bytes to batch into a single console_output message
pub(crate) const MAX_EVENT_SUBSCRIBE_FAILURES: u32 = 10; // Give up on event monitor after this many consecutive failures
/// TCP connect + TLS + WS handshake. A hung DNS/NAT must not stall the reconnect loop.
pub(crate) const WS_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Individual WS frame send. A half-open TCP write can block until this fires.
pub(crate) const WS_SEND_TIMEOUT: Duration = Duration::from_secs(10);
/// No inbound frame (including pong) for this long → treat the socket as dead
/// and reconnect. Backend heartbeat timeout is 60s; stay under that.
pub(crate) const WS_READ_IDLE_TIMEOUT: Duration = Duration::from_secs(45);
pub(crate) const WS_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
pub(crate) const OOM_KILL_REASON: &str = "Killed by system OOM killer (cgroup memory limit exceeded). JVM off-heap (direct buffers, metaspace, threads) counts toward the limit — increase Memory allocation.";
pub(crate) const OOM_KILL_CONSOLE_HINT: &str = "[Catalyst] Killed by system OOM killer — container exceeded its memory allocation. Increase the server Memory allocation. JVM heap is auto-capped below the allocation so off-heap (direct memory, metaspace, threads) fits.\n";

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
    /// Additive wire fields: split block read/write throughput in MiB.
    /// Older panels ignore unknown JSON keys; absent when None.
    #[serde(skip_serializing_if = "Option::is_none")]
    diskReadMb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diskWriteMb: Option<u64>,
    diskUsageMb: u64,
    diskTotalMb: u64,
    /// Cumulative CFS throttled time (usec) from cpu.stat. Deltas over the
    /// sample window reveal throttle stalls that average CPU% hides: a
    /// fully throttled cgroup still accrues usage_usec at quota rate, so
    /// the CPU graph shows a tidy flat line while ticks freeze.
    #[serde(skip_serializing_if = "Option::is_none")]
    cpuThrottledUsec: Option<u64>,
    /// Cumulative nr_throttled / nr_periods ratio (0.0-1.0), sampled from
    /// cpu.stat at the same moment as cpuThrottledUsec.
    #[serde(skip_serializing_if = "Option::is_none")]
    cpuThrottledRatio: Option<f64>,
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
    /// Additive wire fields: split block read/write throughput in MiB.
    /// Older panels ignore unknown JSON keys; absent when None.
    #[serde(skip_serializing_if = "Option::is_none")]
    diskReadMb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diskWriteMb: Option<u64>,
    diskUsageMb: u64,
    diskTotalMb: u64,
    /// See ResourceStats: cumulative throttled time and throttle ratio
    /// from cpu.stat; None on cgroup v1 (no usage/throttle fields there).
    #[serde(skip_serializing_if = "Option::is_none")]
    cpuThrottledUsec: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpuThrottledRatio: Option<f64>,
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

/// In-memory agent self-update progress, reported via `agent_update_status`.
#[derive(Debug, Clone, Default)]
pub(crate) struct AgentUpdateState {
    pub status: String,
    pub progress: u8,
    pub target_version: Option<String>,
    pub error: Option<String>,
    pub started_at: Option<String>,
}

/// Redact secret values from agent config TOML before returning over the wire.
/// Falls back to line-based redaction if the content is not valid TOML.
pub(crate) fn redact_agent_config_secrets(content: &str) -> String {
    const SECRET_KEYS: &[&str] = &[
        "api_key",
        "apikey",
        "token",
        "secret",
        "password",
        "passwd",
        "private_key",
        "privatekey",
        "auth_token",
        "webhook_secret",
    ];

    fn is_secret_key(key: &str) -> bool {
        let lower = key.to_ascii_lowercase();
        SECRET_KEYS
            .iter()
            .any(|s| lower == *s || lower.ends_with(&format!("_{s}")) || lower.contains(s))
    }

    fn redact_value(value: &mut toml::Value) {
        match value {
            toml::Value::Table(table) => {
                let keys: Vec<String> = table.keys().cloned().collect();
                for key in keys {
                    if is_secret_key(&key) {
                        table.insert(key, toml::Value::String("[REDACTED]".to_string()));
                    } else if let Some(child) = table.get_mut(&key) {
                        redact_value(child);
                    }
                }
            }
            toml::Value::Array(arr) => {
                for item in arr.iter_mut() {
                    redact_value(item);
                }
            }
            _ => {}
        }
    }

    match content.parse::<toml::Value>() {
        Ok(mut value) => {
            redact_value(&mut value);
            // Prefer original formatting style via toml::to_string
            toml::to_string_pretty(&value).unwrap_or_else(|_| content.to_string())
        }
        Err(_) => {
            // Line-based fallback for malformed files
            content
                .lines()
                .map(|line| {
                    let trimmed = line.trim_start();
                    if let Some((key, _rest)) = trimmed.split_once('=') {
                        let key_clean = key.trim().trim_matches('"');
                        if is_secret_key(key_clean) {
                            let indent_len = line.len() - trimmed.len();
                            return format!(
                                "{}{} = \"[REDACTED]\"",
                                &line[..indent_len],
                                key.trim()
                            );
                        }
                    }
                    line.to_string()
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
    }
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

pub struct WebSocketHandler {
    pub(crate) config: Arc<AgentConfig>,
    pub(crate) runtime: Arc<ContainerdRuntime>,
    pub(crate) file_manager: Arc<FileManager>,
    pub(crate) storage_manager: Arc<StorageManager>,
    pub(crate) network_manager: NetworkManager,
    pub(crate) backend_connected: Arc<RwLock<bool>>,
    pub(crate) write: Arc<RwLock<Option<Arc<tokio::sync::Mutex<WsWrite>>>>>,
    /// Active console log tail tasks keyed by "{serverId}:{containerId}".
    /// Storing JoinHandles (not just keys) lets stop_log_streams_for_server abort them.
    /// Uses a std Mutex so spawn_log_stream can register/abort synchronously.
    pub(crate) active_log_streams:
        Arc<std::sync::Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    /// Last emitted byte offsets for container console files: container_id → (stdout, stderr).
    /// Prevents re-broadcasting historical log content when a tail is (re)started — e.g. every
    /// console command used to call spawn_log_stream which reset pos to 0 and re-emitted the
    /// OpenJDK/startup banner into live SSE + ServerLog rows.
    pub(crate) log_stream_offsets: Arc<std::sync::Mutex<HashMap<String, (u64, u64)>>>,
    pub(crate) monitor_tasks: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
    pub(crate) active_uploads: Arc<RwLock<HashMap<String, BackupUploadSession>>>,
    /// Auto-restart config per server_id, stored when start_server_with_details is called.
    pub(crate) auto_restart_configs: Arc<RwLock<HashMap<String, AutoRestartConfig>>>,
    /// Tracks restart attempt timestamps per server_id.
    pub(crate) restart_trackers: Arc<RwLock<HashMap<String, RestartTracker>>>,
    /// Stores the original start_server message JSON per server_id for auto-restart.
    /// `installScript` is stripped; environment values are kept so restart works.
    pub(crate) start_server_messages: Arc<RwLock<HashMap<String, Value>>>,
    /// Tracks in-flight agent self-update progress for `agent_update_status`.
    pub(crate) agent_update_state: Arc<RwLock<Option<AgentUpdateState>>>,
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
    pub(crate) error_dedup:
        Arc<tokio::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>>,
    /// Errors that occurred before the WS connection was up (e.g. system setup
    /// or storage heal failures). Drained and reported on the next connect.
    pub(crate) pending_startup_errors: Arc<tokio::sync::RwLock<Vec<String>>>,
    /// PID of the ctr events subprocess, for explicit cleanup during shutdown.
    pub(crate) ctr_event_pid: Arc<tokio::sync::Mutex<Option<u32>>>,
    /// Active installer containers keyed by server_id. Lets cancel_install_server
    /// kill the exact container for a stuck install.
    pub(crate) active_installs: Arc<RwLock<HashMap<String, String>>>,
    /// Server ids with a pending install cancel. Checked by the install task so
    /// a killed installer does not emit an error state over the panel reset.
    pub(crate) cancelled_installs: Arc<RwLock<HashSet<String>>>,
    /// Shutdown signal sender — used by restart_agent command to trigger graceful shutdown.
    /// Set after construction via set_shutdown_tx(). Uses RwLock for interior mutability.
    pub(crate) shutdown_tx: Arc<RwLock<Option<broadcast::Sender<()>>>>,
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
//  11. agent_update_state
//  12. server_ports
//  13. server_health_state
//  14. retry_after_seconds
//  15. backend_connected (rarely contended, almost always read)
//  16. shutdown_tx (read-only in restart_agent, never held with other locks)
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
            log_stream_offsets: self.log_stream_offsets.clone(),
            monitor_tasks: self.monitor_tasks.clone(),
            active_uploads: self.active_uploads.clone(),
            auto_restart_configs: self.auto_restart_configs.clone(),
            restart_trackers: self.restart_trackers.clone(),
            start_server_messages: self.start_server_messages.clone(),
            agent_update_state: self.agent_update_state.clone(),
            server_ports: self.server_ports.clone(),
            server_health_state: self.server_health_state.clone(),
            active_restore_streams: self.active_restore_streams.clone(),
            active_restore_bytes_written: self.active_restore_bytes_written.clone(),
            active_restore_request_id: self.active_restore_request_id.clone(),
            retry_after_seconds: self.retry_after_seconds.clone(),
            error_dedup: self.error_dedup.clone(),
            pending_startup_errors: self.pending_startup_errors.clone(),
            ctr_event_pid: self.ctr_event_pid.clone(),
            active_installs: self.active_installs.clone(),
            cancelled_installs: self.cancelled_installs.clone(),
            shutdown_tx: self.shutdown_tx.clone(),
        }
    }
}

mod backup;
mod console;
mod monitoring;
mod server_lifecycle;

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
            active_log_streams: Arc::new(std::sync::Mutex::new(HashMap::new())),
            log_stream_offsets: Arc::new(std::sync::Mutex::new(HashMap::new())),
            monitor_tasks: Arc::new(RwLock::new(HashMap::new())),
            active_uploads: Arc::new(RwLock::new(HashMap::new())),
            auto_restart_configs: Arc::new(RwLock::new(HashMap::new())),
            restart_trackers: Arc::new(RwLock::new(HashMap::new())),
            start_server_messages: Arc::new(RwLock::new(HashMap::new())),
            agent_update_state: Arc::new(RwLock::new(None)),
            server_ports: Arc::new(RwLock::new(HashMap::new())),
            server_health_state: Arc::new(RwLock::new(HashMap::new())),
            active_restore_streams: Arc::new(RwLock::new(HashMap::new())),
            active_restore_bytes_written: Arc::new(RwLock::new(HashMap::new())),
            active_restore_request_id: Arc::new(RwLock::new(None)),
            retry_after_seconds: Arc::new(RwLock::new(None)),
            error_dedup: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
            pending_startup_errors: Arc::new(RwLock::new(Vec::new())),
            ctr_event_pid: Arc::new(tokio::sync::Mutex::new(None)),
            active_installs: Arc::new(RwLock::new(HashMap::new())),
            cancelled_installs: Arc::new(RwLock::new(HashSet::new())),
            shutdown_tx: Arc::new(RwLock::new(None)),
        }
    }

    /// Inject the shutdown signal sender from the main agent runtime.
    /// Called after construction so the handler can trigger a graceful
    /// restart via the restart_agent WS command.
    pub async fn set_shutdown_tx(&self, tx: broadcast::Sender<()>) {
        let mut guard = self.shutdown_tx.write().await;
        *guard = Some(tx);
    }

    pub(crate) async fn set_backend_connected(&self, connected: bool) {
        let mut status = self.backend_connected.write().await;
        *status = connected;
    }

    fn apply_panel_upload_limit(&self, msg: &Value) {
        let Some(bytes) = msg.get("maxUploadBytes").and_then(|v| v.as_u64()) else {
            return;
        };
        if bytes == 0 {
            return;
        }
        self.file_manager.set_max_file_size(bytes);
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
            // SECURITY/robustness: slice on CHAR boundaries — byte slicing can
            // land inside a multi-byte UTF-8 sequence (container-controlled
            // error text) and panic the reporting task.
            let truncated: String = message.chars().take(200).collect();
            let key = format!("{}|{}", component, truncated);
            let now = std::time::Instant::now();
            if let Some(last) = dedup.get(&key) {
                if now.duration_since(*last) < std::time::Duration::from_secs(DEDUP_WINDOW_SECS) {
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

        // Send via WebSocket; persist for replay if the socket is down so the
        // panel eventually sees errors that happened mid-disconnect.
        if let Err(e) = self
            .send_or_buffer_event(payload.to_string().as_str())
            .await
        {
            warn!("Failed to deliver or buffer error report: {}", e);
        }
    }

    /// Queue an error that happened before the WS connection existed (startup
    /// phase: system setup, storage heal, ...). Delivered to the panel's System
    /// Errors page on the next successful connect via flush_startup_errors.
    pub async fn queue_startup_error(&self, message: String) {
        self.pending_startup_errors.write().await.push(message);
    }

    /// Drain pending startup errors and report them. Called right after the
    /// handshake succeeds (and buffered-event replay), so pre-connection
    /// failures are visible on the panel's System Errors page.
    async fn flush_startup_errors(&self) {
        let drained: Vec<String> = std::mem::take(&mut *self.pending_startup_errors.write().await);
        for message in drained {
            self.report_error(ErrorLevel::Error, "agent:startup", &message, None, None)
                .await;
        }
    }

    /// Send a control-plane message on the current socket, or — when the socket
    /// is down or the send fails — persist it to disk for replay after the next
    /// reconnect. Used for error reports and critical state updates.
    pub(crate) async fn send_or_buffer_event(&self, payload_text: &str) -> AgentResult<()> {
        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            match send_ws_with_timeout(&ws, Message::Text(payload_text.to_string().into())).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    warn!("WS send failed ({}); buffering event for replay", e);
                }
            }
        }
        if let Err(e) = self
            .storage_manager
            .append_buffered_event(payload_text)
            .await
        {
            warn!("Failed to buffer event for replay: {}", e);
        }
        Ok(())
    }

    /// Replay control-plane events buffered while disconnected, then clear the
    /// buffer. Mirrors flush_buffered_metrics; called right after connecting.
    pub(crate) async fn flush_buffered_events(
        &self,
        write: Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let events = match self.storage_manager.read_buffered_events().await {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to read buffered events: {}", e);
                return Ok(());
            }
        };

        if events.is_empty() {
            return Ok(());
        }

        // Cap the replay: drop the oldest entries beyond MAX_EVENT_REPLAY.
        let skip = events.len().saturating_sub(MAX_EVENT_REPLAY);
        if skip > 0 {
            warn!(
                "Dropping {} stale buffered events beyond replay cap of {}",
                skip, MAX_EVENT_REPLAY
            );
        }
        info!("Flushing {} buffered events", events.len() - skip);

        let unsent: &[Value] = &events[skip..];
        for (idx, event) in unsent.iter().enumerate() {
            let payload_text = match serde_json::to_string(event) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let mut w = write.lock().await;
            let send =
                tokio::time::timeout(WS_SEND_TIMEOUT, w.send(Message::Text(payload_text.into())))
                    .await;
            match send {
                Ok(Ok(())) => {}
                Ok(Err(_)) | Err(_) => {
                    warn!("Failed to send buffered event batch; re-buffering remainder");
                    // Re-append everything from this event onward.
                    for e in &unsent[idx..] {
                        let _ = self
                            .storage_manager
                            .append_buffered_event(&e.to_string())
                            .await;
                    }
                    return Ok(());
                }
            }
        }

        // All events sent successfully - clear buffer
        if let Err(e) = self.storage_manager.clear_buffered_events().await {
            warn!("Failed to clear buffered events: {}", e);
        }

        Ok(())
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
            // Timeout-bounded so a half-open socket can't wedge the flush task,
            // and released between chunks so control traffic can interleave.
            let send_result = {
                let mut w = write.lock().await;
                tokio::time::timeout(WS_SEND_TIMEOUT, w.send(Message::Text(payload_text.into())))
                    .await
            };
            match send_result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    warn!("Failed to send buffered metrics batch: {}", e);
                    // leave buffer intact - will retry on next connect
                    return Ok(());
                }
                Err(_) => {
                    warn!("Timed out sending buffered metrics batch; will retry on next connect");
                    return Ok(());
                }
            }
            tokio::task::yield_now().await;
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

        // Network reconnect backoff: 5s → 10s → 20s → 40s → 60s (capped) + jitter.
        // Auth lockout `retry_after_seconds` always takes precedence when set.
        let mut network_backoff_secs: u64 = 5;
        // Upper bound on how long a connection attempt may take to reach an
        // ESTABLISHED session. Once the session loop is live the attempt is
        // legitimately long-lived, so the abort guard below must never fire
        // again for that task — healthy sessions run for hours. Without this
        // distinction a naive timeout self-disconnects every healthy agent
        // exactly once per window (observed in production testing).
        const SETUP_TIMEOUT: Duration = Duration::from_secs(120);
        let session_established = Arc::new(std::sync::atomic::AtomicBool::new(false));
        loop {
            let this = self.clone();
            let established = session_established.clone();
            established.store(false, std::sync::atomic::Ordering::SeqCst);
            let attempt =
                tokio::spawn(async move { this.establish_connection(&established).await });
            tokio::pin!(attempt);

            let outcome = tokio::time::timeout(SETUP_TIMEOUT, async {
                (&mut attempt)
                    .await
                    .map(|r| r.unwrap_or_else(|e| info!("connection task panicked: {e}")))
            })
            .await;

            match outcome {
                Ok(Ok(())) => {
                    // Session ran and closed cleanly (read loop ended).
                    info!("WebSocket connection closed");
                    // Clean disconnect after a successful session — reset backoff.
                    network_backoff_secs = 5;
                }
                Ok(Err(e)) => {
                    error!("Connection error: {}", e);
                    // Report connection errors to the backend (best effort, will send when reconnected)
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:connection",
                        &format!("{}", e),
                        None,
                        None,
                    )
                    .await;
                }
                Err(_) => {
                    if !session_established.load(std::sync::atomic::Ordering::SeqCst) {
                        // Setup never finished: the future is wedged (hung await in
                        // handshake/restore/flush paths or in teardown of the prior
                        // socket). Aborting the task cancels it at its await point,
                        // releasing any held locks — unlike a plain timeout() which
                        // abandons but keeps the zombie running.
                        error!(
                            "Connection setup exceeded {}s — aborting wedged task and reconnecting",
                            SETUP_TIMEOUT.as_secs()
                        );
                        attempt.abort();
                        let _ = (&mut attempt).await; // observe cancellation
                        let mut guard = self.write.write().await;
                        *guard = None;
                    }
                    // else: session WAS established and simply outlived the
                    // window; `attempt` has already completed via select arm? No —
                    // this branch means timeout fired while task still running.
                    // Healthy long sessions fall into the inner async block only
                    // when the task COMPLETES; timeout(SETUP_TIMEOUT) fires even
                    // mid-session. Guarded here so we just keep waiting instead.
                    else {
                        // Healthy session still running: resume waiting without
                        // re-entering dial/backoff.
                        match attempt.await {
                            Ok(Ok(())) => {
                                info!("WebSocket connection closed");
                                network_backoff_secs = 5;
                            }
                            Ok(Err(e)) => {
                                error!("Connection error: {}", e);
                                self.report_error(
                                    ErrorLevel::Error,
                                    "agent:connection",
                                    &format!("{}", e),
                                    None,
                                    None,
                                )
                                .await;
                            }
                            Err(join_err) => {
                                error!("Connection task join error: {}", join_err);
                            }
                        }
                    }
                }
            }

            self.set_backend_connected(false).await;
            let auth_lockout = {
                let mut ra = self.retry_after_seconds.write().await;
                ra.take()
            };
            let retry_secs = if let Some(lockout) = auth_lockout {
                if lockout > 5 {
                    info!("Auth lockout: waiting {}s before reconnecting", lockout);
                }
                // After lockout, keep network backoff from growing unbounded next time.
                network_backoff_secs = 5;
                lockout
            } else {
                // ±20% jitter so many agents don't reconnect in lockstep.
                let jitter_span = (network_backoff_secs / 5).max(1);
                let raw = rand::random::<u64>() % (jitter_span * 2 + 1);
                let with_jitter = if raw >= jitter_span {
                    network_backoff_secs.saturating_add(raw - jitter_span)
                } else {
                    network_backoff_secs.saturating_sub(jitter_span - raw)
                }
                .max(1);
                info!(
                    "Reconnecting in {}s (backoff base {}s)",
                    with_jitter, network_backoff_secs
                );
                // Double for next failure, cap at 60s.
                network_backoff_secs = (network_backoff_secs.saturating_mul(2)).min(60);
                with_jitter
            };
            tokio::time::sleep(Duration::from_secs(retry_secs)).await;
        }
    }

    /// Best-effort clean WebSocket close before process exit / task abort.
    pub async fn graceful_ws_close(&self) {
        self.set_backend_connected(false).await;
        let writer = {
            let mut guard = self.write.write().await;
            guard.take()
        };
        let Some(ws) = writer else {
            return;
        };
        let close_result = tokio::time::timeout(Duration::from_secs(2), async {
            let mut w = ws.lock().await;
            // Prefer a protocol Close frame; fall back to plain sink close.
            if let Err(e) = w.send(Message::Close(None)).await {
                debug!("WS Close frame failed during shutdown: {}", e);
            }
            if let Err(e) = w.close().await {
                debug!("WS sink close failed during shutdown: {}", e);
            }
        })
        .await;
        if close_result.is_err() {
            warn!("Timed out waiting for WebSocket close during shutdown");
        }
    }

    async fn establish_connection(
        &self,
        session_established: &std::sync::atomic::AtomicBool,
    ) -> AgentResult<()> {
        self.set_backend_connected(false).await;
        // Not yet established: any hang before the session loop begins is
        // abortable by the outer setup guard.
        session_established.store(false, std::sync::atomic::Ordering::SeqCst);

        let (auth_token, token_type) = self.select_agent_auth_token()?;

        // Enforce secure transport for non-local backends.
        let mut parsed_url = Url::parse(&self.config.server.backend_url)
            .map_err(|e| AgentError::ConfigError(format!("Invalid server.backend_url: {}", e)))?;
        match parsed_url.scheme() {
            "wss" => {}
            "ws" => {
                // Check if ws:// is explicitly allowed via opt-in env var.
                // Fix for UF-10: ws:// is blocked for public hosts unless the
                // operator sets CATALYST_ALLOW_INSECURE_WS=1. Loopback and
                // RFC1918 private LAN targets (10/8, 172.16/12, 192.168/16)
                // are allowed so agents can reach a panel on the local network.
                let allow_insecure = std::env::var("CATALYST_ALLOW_INSECURE_WS")
                    .map(|s| s == "1")
                    .unwrap_or(false);
                if !allow_insecure {
                    let host = parsed_url.host_str().unwrap_or("");
                    if !crate::net_utils::is_allowed_insecure_ws_host(host) {
                        return Err(AgentError::ConfigError(
                            "Insecure ws:// is not allowed for public addresses. \
                             Use wss://, a private LAN / loopback IP, or set \
                             CATALYST_ALLOW_INSECURE_WS=1 to override."
                                .to_string(),
                        ));
                    }
                    warn!(
                        "Using insecure WebSocket connection (ws://) — allowed for loopback/private LAN"
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
        let (ws_stream, _) = tokio::time::timeout(
            WS_CONNECT_TIMEOUT,
            connect_async_with_config(ws_url.as_str(), Some(ws_config), false),
        )
        .await
        .map_err(|_| {
            AgentError::NetworkError(format!(
                "WebSocket connect timed out after {}s",
                WS_CONNECT_TIMEOUT.as_secs()
            ))
        })?
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

        send_ws_with_timeout(&write, Message::Text(handshake.to_string().into())).await?;

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

        // Replay error reports / critical state updates buffered while offline
        if let Err(e) = self.flush_buffered_events(write.clone()).await {
            warn!("Failed to flush buffered events: {}", e);
        }

        // Report errors that happened before the connection was up (startup
        // failures, etc.) — now that delivery is possible.
        self.flush_startup_errors().await;

        // Connection-scoped background tasks. Abort on disconnect to avoid accumulation.
        let mut connection_tasks: Vec<tokio::task::JoinHandle<()>> = Vec::new();

        // JSON heartbeat keeps the panel's lastHeartbeat fresh. WS Ping forces a
        // Pong so a half-open TCP (NAT drop, silent panel restart) is detected
        // by the read-idle timeout below — without that, systemd still shows
        // the agent "active" while the node is offline until a manual restart.
        let write_clone = write.clone();
        connection_tasks.push(tokio::spawn(async move {
            let mut interval = tokio::time::interval(WS_HEARTBEAT_INTERVAL);
            loop {
                interval.tick().await;
                debug!("Sending heartbeat");
                let heartbeat = json!({
                    "type": "heartbeat"
                });
                let mut w = write_clone.lock().await;
                let send = tokio::time::timeout(WS_SEND_TIMEOUT, async {
                    w.send(Message::Text(heartbeat.to_string().into())).await?;
                    w.send(Message::Ping(Vec::new().into())).await?;
                    Ok::<(), tokio_tungstenite::tungstenite::Error>(())
                })
                .await;
                match send {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        warn!("Heartbeat send failed ({}); closing socket to reconnect", e);
                        let _ = tokio::time::timeout(WS_SEND_TIMEOUT, w.close()).await;
                        break;
                    }
                    Err(_) => {
                        warn!(
                            "Heartbeat send timed out after {}s; closing socket to reconnect",
                            WS_SEND_TIMEOUT.as_secs()
                        );
                        let _ = tokio::time::timeout(WS_SEND_TIMEOUT, w.close()).await;
                        break;
                    }
                }
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
                handler_clone
                    .report_error(
                        ErrorLevel::Error,
                        "agent:event_monitor",
                        &format!("{}", e),
                        None,
                        None,
                    )
                    .await;
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

        // Setup complete: the session is now long-lived and legitimate. The
        // outer setup guard must never abort this task from here on — it only
        // bounds the dial/handshake/restore phase above.
        session_established.store(true, std::sync::atomic::Ordering::SeqCst);

        // Listen for messages. A half-open TCP never yields here, so bound the
        // wait: no inbound frame (text/binary/pong/ping/close) → reconnect.
        loop {
            let msg = match tokio::time::timeout(WS_READ_IDLE_TIMEOUT, read.next()).await {
                Ok(Some(msg)) => msg,
                Ok(None) => {
                    info!("WebSocket stream ended");
                    break;
                }
                Err(_) => {
                    warn!(
                        "No WebSocket traffic for {}s (half-open socket?); reconnecting",
                        WS_READ_IDLE_TIMEOUT.as_secs()
                    );
                    let _ = send_ws_with_timeout(&write, Message::Close(None)).await;
                    break;
                }
            };
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
                        )
                        .await;
                    }
                }
                Ok(Message::Binary(data)) => {
                    // Binary frames are used for two purposes:
                    // 1. Pipe relay: raw tar data when active_restore_request_id is set
                    // 2. Upload backup chunks:
                    //    - v2 length-prefixed: [u16 BE idLen][id UTF-8][payload]
                    //    - legacy: fixed 16-byte zero-padded requestId prefix + payload
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
                                )
                                .await;
                                routed = true;
                            }
                        }
                    }
                    if !routed {
                        if let Some((header, payload)) = backup::parse_backup_binary_frame(&data) {
                            // Sessions are keyed by full requestId from upload_backup_start.
                            // Length-prefixed frames carry the full id; legacy 16-byte
                            // frames only carry a prefix — resolve either form.
                            let request_id = {
                                let uploads = self.active_uploads.read().await;
                                backup::resolve_backup_upload_request_id(
                                    &header,
                                    uploads.keys().map(|k| k.as_str()),
                                )
                            };
                            if let Err(e) = self
                                .handle_upload_backup_chunk_binary(&request_id, payload)
                                .await
                            {
                                error!("Error handling binary backup chunk: {}", e);
                                self.report_error(
                                    ErrorLevel::Error,
                                    "agent:backup_upload",
                                    &format!("{}", e),
                                    None,
                                    None,
                                )
                                .await;
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("Backend closed connection");
                    break;
                }
                Ok(Message::Ping(payload)) => {
                    if let Err(e) = send_ws_with_timeout(&write, Message::Pong(payload)).await {
                        warn!("Failed to reply to WebSocket ping: {}", e);
                        break;
                    }
                }
                Ok(Message::Pong(_)) => {
                    debug!("WebSocket pong");
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:websocket",
                        &format!("{}", e),
                        None,
                        None,
                    )
                    .await;
                    break;
                }
                _ => {}
            }
        }

        for task in connection_tasks {
            task.abort();
        }

        // Teardown, bounded: every hang we have observed in production testing
        // lives in this section (a lock or child-reap that never resolves). A
        // plain await here can stall the retry loop forever; wrapping the whole
        // phase guarantees the next dial happens.
        const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(20);
        let teardown = async {
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
        };
        if tokio::time::timeout(TEARDOWN_TIMEOUT, teardown)
            .await
            .is_err()
        {
            error!(
                "Connection teardown exceeded {}s — skipping remainder to force reconnect",
                TEARDOWN_TIMEOUT.as_secs()
            );
        }

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
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                &format!("agent:install_server:{}", server_id),
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("reinstall_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.reinstall_server(&msg).await {
                        error!("Error in reinstall_server handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:reinstall_server",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("cancel_install_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.cancel_install_server(&msg).await {
                        error!("Error in cancel_install_server handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:cancel_install_server",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("rebuild_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.rebuild_server(&msg).await {
                        error!("Error in rebuild_server handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:rebuild_server",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("start_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    let request_id = msg["requestId"].as_str().map(|s| s.to_string());
                    let server_id = msg["serverId"]
                        .as_str()
                        .or_else(|| msg["serverUuid"].as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    // Immediate accept-ack: start is long-running; completion is via
                    // server_state_update. requestFromAgent resolves on this ack.
                    handler
                        .emit_power_command_ack(
                            request_id.as_deref(),
                            &server_id,
                            "start",
                            true,
                            None,
                        )
                        .await;
                    if let Err(e) = handler.start_server_with_details(&msg).await {
                        error!("Error in start_server handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:start_server",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("stop_server") => {
                let request_id = msg["requestId"].as_str().map(|s| s.to_string());
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                let stop_policy = parse_stop_policy(&msg);
                match self
                    .stop_server(server_id, container_id, &stop_policy)
                    .await
                {
                    Ok(()) => {
                        self.emit_power_command_ack(
                            request_id.as_deref(),
                            server_id,
                            "stop",
                            true,
                            None,
                        )
                        .await;
                    }
                    Err(e) => {
                        self.emit_power_command_ack(
                            request_id.as_deref(),
                            server_id,
                            "stop",
                            false,
                            Some(&e.to_string()),
                        )
                        .await;
                        return Err(e);
                    }
                }
            }
            Some("kill_server") => {
                let request_id = msg["requestId"].as_str().map(|s| s.to_string());
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                match self.kill_server(server_id, container_id).await {
                    Ok(()) => {
                        self.emit_power_command_ack(
                            request_id.as_deref(),
                            server_id,
                            "kill",
                            true,
                            None,
                        )
                        .await;
                    }
                    Err(e) => {
                        self.emit_power_command_ack(
                            request_id.as_deref(),
                            server_id,
                            "kill",
                            false,
                            Some(&e.to_string()),
                        )
                        .await;
                        return Err(e);
                    }
                }
            }
            Some("restart_server") => {
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    let request_id = msg["requestId"].as_str().map(|s| s.to_string());
                    let Some(server_uuid) = msg["serverUuid"].as_str() else {
                        error!("Error in restart_server handler: Missing serverUuid");
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:restart_server",
                                "restart_server message is missing serverUuid",
                                None,
                                None,
                            )
                            .await;
                        handler
                            .emit_power_command_ack(
                                request_id.as_deref(),
                                "unknown",
                                "restart",
                                false,
                                Some("Missing serverUuid"),
                            )
                            .await;
                        return;
                    };
                    let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                    // Immediate accept-ack: restart is long-running (stop + start).
                    // Completion is via server_state_update.
                    handler
                        .emit_power_command_ack(
                            request_id.as_deref(),
                            server_id,
                            "restart",
                            true,
                            None,
                        )
                        .await;
                    let container_id = handler.resolve_container_id(server_id, server_uuid).await;
                    let stop_policy = parse_stop_policy(&msg);
                    let container_id_clone = container_id.clone();
                    if let Err(e) = handler
                        .stop_server(server_id, container_id_clone.clone(), &stop_policy)
                        .await
                    {
                        error!("Error in restart_server (stop) handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:restart_server:stop",
                                &format!(
                                    "Restart of server {} aborted: stop phase failed: {}",
                                    server_id, e
                                ),
                                None,
                                Some(serde_json::json!({ "serverId": server_id })),
                            )
                            .await;
                        handler
                            .emit_server_state_update(
                                server_id,
                                "error",
                                Some(format!("Restart failed during stop: {}", e)),
                                None,
                                None,
                            )
                            .await
                            .ok();
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
                                    handler
                                        .report_error(
                                            ErrorLevel::Error,
                                            "agent:restart_server:force_kill",
                                            &format!("{}", e),
                                            None,
                                            None,
                                        )
                                        .await;
                                }
                                break;
                            }
                            _ => {}
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    if let Err(e) = handler.start_server_with_details(&msg).await {
                        error!("Error in restart_server (start) handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:restart_server:start",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("delete_server") => {
                // Spawned: delete walks the whole server directory tree
                // (unmount + recursive removal) and can take minutes; inline
                // execution stalled every other server's control traffic.
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    let server_uuid = msg["serverUuid"].as_str().unwrap_or("");
                    let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                    if let Err(e) = handler.delete_server(server_id, server_uuid).await {
                        error!("Error in delete_server handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:delete_server",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("console_input") => {
                // Kept inline (with the 5s-bounded stdin write) because
                // console commands are order-sensitive: spawning would let a
                // blocked command be overtaken by later ones. The bounded
                // write caps the worst-case read-loop delay.
                self.handle_console_input(&msg).await?
            }
            Some("file_operation") => {
                // Spawned: a "read" of a large file (up to 500 MB, base64
                // encoded) must not stall the shared read loop.
                let handler = self.clone();
                let msg = msg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_file_operation(&msg).await {
                        warn!("file_operation handler failed: {}", e);
                    }
                });
            }
            Some("create_backup") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_create_backup(&msg, &write).await {
                        error!("Error in handle_create_backup handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:create_backup",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
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
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:restore_backup",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            // download_backup streams a potentially multi-GB archive chunk by
            // chunk; resize_storage can run an unmount/fsck/resize cycle lasting
            // minutes; finish_restore_stream awaits a full tar extraction.
            // Spawned so none of them stall every other server's control
            // traffic behind one slow storage operation.
            Some("delete_backup") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_delete_backup(&msg, &write).await {
                        warn!("delete_backup handler failed: {}", e);
                    }
                });
            }
            Some("download_backup_start") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_download_backup_start(&msg, &write).await {
                        warn!("download_backup_start handler failed: {}", e);
                    }
                });
            }
            Some("download_backup") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_download_backup(&msg, &write).await {
                        warn!("download_backup handler failed: {}", e);
                    }
                });
            }
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
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:backup_stream",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("prepare_restore_stream") => {
                self.handle_prepare_restore_stream(&msg, write).await?
            }
            Some("finish_restore_stream") => {
                // Spawned: awaits tar extraction of up to MAX_BACKUP_UPLOAD_BYTES.
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_finish_restore_stream(&msg, &write).await {
                        warn!("finish_restore_stream handler failed: {}", e);
                    }
                });
            }
            Some("clone_server_files") => {
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_clone_server_files(&msg, &write).await {
                        error!("Error in handle_clone_server_files handler: {}", e);
                        handler
                            .report_error(
                                ErrorLevel::Error,
                                "agent:clone_server_files",
                                &format!("{}", e),
                                None,
                                None,
                            )
                            .await;
                    }
                });
            }
            Some("resize_storage") => {
                // Spawned: shrink path can run an unmount + e2fsck cycle with a
                // 1-hour timeout; inline execution froze all control traffic.
                let handler = self.clone();
                let msg = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    if let Err(e) = handler.handle_resize_storage(&msg, &write).await {
                        warn!("resize_storage handler failed: {}", e);
                    }
                });
            }
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
                let target_version_display =
                    target_version.as_deref().unwrap_or("latest").to_string();
                info!(
                    "Received update_agent command from backend (target={})",
                    target_version_display
                );
                let msg_clone = msg.clone();
                let handler = self.clone();
                let write = Arc::clone(write);
                // Track in-flight update so agent_update_status can report progress.
                let started_at = chrono::Utc::now().to_rfc3339();
                {
                    let mut st = self.agent_update_state.write().await;
                    *st = Some(AgentUpdateState {
                        status: "downloading".to_string(),
                        progress: 10,
                        target_version: target_version.clone(),
                        error: None,
                        started_at: Some(started_at.clone()),
                    });
                }
                // Push live progress immediately (panel subscribed via admin SSE).
                {
                    let payload = json!({
                        "type": "agent_update_progress",
                        "requestId": msg.get("requestId"),
                        "status": "downloading",
                        "progress": 10,
                        "targetVersion": target_version,
                        "currentVersion": env!("CARGO_PKG_VERSION"),
                    });
                    let mut w = write.lock().await;
                    let _ = w.send(Message::Text(payload.to_string().into())).await;
                }
                tokio::spawn(async move {
                    let updater = crate::updater::AgentUpdater::new(&handler.config);
                    let options = crate::updater::UpdateOptions { target_version };
                    // Mid-flight heartbeat while download/apply runs (best-effort).
                    let progress_write = Arc::clone(&write);
                    let progress_handler = handler.clone();
                    let mid_target = options.target_version.clone();
                    let mid_req = msg_clone.get("requestId").cloned();
                    let mid_task = tokio::spawn(async move {
                        // 35% after a short delay (download likely underway)
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        {
                            let mut st = progress_handler.agent_update_state.write().await;
                            if let Some(s) = st.as_mut() {
                                if s.status == "downloading" && s.progress < 35 {
                                    s.progress = 35;
                                }
                            }
                        }
                        let payload = json!({
                            "type": "agent_update_progress",
                            "requestId": mid_req,
                            "status": "downloading",
                            "progress": 35,
                            "targetVersion": mid_target,
                            "currentVersion": env!("CARGO_PKG_VERSION"),
                        });
                        let mut w = progress_write.lock().await;
                        let _ = w.send(Message::Text(payload.to_string().into())).await;
                        // 60% later
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                        {
                            let mut st = progress_handler.agent_update_state.write().await;
                            if let Some(s) = st.as_mut() {
                                if s.status == "downloading" && s.progress < 60 {
                                    s.progress = 60;
                                }
                            }
                        }
                        let payload = json!({
                            "type": "agent_update_progress",
                            "requestId": mid_req,
                            "status": "downloading",
                            "progress": 60,
                            "targetVersion": mid_target,
                            "currentVersion": env!("CARGO_PKG_VERSION"),
                        });
                        let mut w = progress_write.lock().await;
                        let _ = w.send(Message::Text(payload.to_string().into())).await;
                    });
                    match updater.update(&options).await {
                        Ok(_) => {
                            // Real apply() exec()s and never returns. Ok means
                            // already at target — do not fake an apply/restart.
                            mid_task.abort();
                            info!("Agent already at target version, update skipped");
                            {
                                let mut st = handler.agent_update_state.write().await;
                                *st = Some(AgentUpdateState {
                                    status: "completed".to_string(),
                                    progress: 100,
                                    target_version: options.target_version.clone(),
                                    error: None,
                                    started_at: st.as_ref().and_then(|s| s.started_at.clone()),
                                });
                            }
                            let payload = json!({
                                "type": "agent_update_progress",
                                "requestId": msg_clone.get("requestId"),
                                "status": "completed",
                                "progress": 100,
                                "targetVersion": options.target_version,
                                "currentVersion": env!("CARGO_PKG_VERSION"),
                            });
                            let mut w = write.lock().await;
                            let _ = w.send(Message::Text(payload.to_string().into())).await;
                        }
                        Err(e) => {
                            mid_task.abort();
                            error!("Agent update failed: {}", e);
                            {
                                let mut st = handler.agent_update_state.write().await;
                                *st = Some(AgentUpdateState {
                                    status: "failed".to_string(),
                                    progress: 0,
                                    target_version: options.target_version.clone(),
                                    error: Some(e.to_string()),
                                    started_at: st.as_ref().and_then(|s| s.started_at.clone()),
                                });
                            }
                            handler
                                .report_error(
                                    ErrorLevel::Error,
                                    "agent:update",
                                    &format!("{}", e),
                                    None,
                                    None,
                                )
                                .await;
                            let payload = json!({
                                "type": "agent_update_failed",
                                "requestId": msg_clone.get("requestId"),
                                "error": e.to_string(),
                            });
                            let mut w = write.lock().await;
                            let _ = w.send(Message::Text(payload.to_string().into())).await;
                        }
                    }
                });
            }
            Some("agent_update_status") => {
                let state = self.agent_update_state.read().await.clone();
                let (status, progress, target_version, error, started_at) = match state {
                    Some(s) => (
                        s.status,
                        s.progress,
                        s.target_version,
                        s.error,
                        s.started_at,
                    ),
                    None => ("idle".to_string(), 0, None, None, None),
                };
                let response = json!({
                    "type": "agent_update_status_response",
                    "requestId": msg.get("requestId"),
                    "currentVersion": env!("CARGO_PKG_VERSION"),
                    "targetVersion": target_version,
                    "status": status,
                    "progress": progress,
                    "error": error,
                    "startedAt": started_at,
                });
                let mut w = write.lock().await;
                let _ = w.send(Message::Text(response.to_string().into())).await;
            }
            Some("agent_status") => {
                let config_path = self.config.agent.config_path.clone();
                let sftp_port = self.config.sftp.port;
                // SFTP is enabled unless SFTP_ENABLED=0/false explicitly
                let sftp_enabled = std::env::var("SFTP_ENABLED")
                    .map(|v| v != "false" && v != "0")
                    .unwrap_or(true);
                let msg_clone = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    // OS, kernel, and containerd version never change at runtime —
                    // cache them on first call to avoid repeated syscalls and subprocess spawns.
                    static CACHED_SYSINFO: OnceLock<(String, String, String)> = OnceLock::new();
                    let (os_info, kernel_version, containerd_version) = CACHED_SYSINFO
                        .get_or_init(|| {
                            let os_info = System::long_os_version().unwrap_or_default();
                            let kernel_version = System::kernel_version().unwrap_or_default();
                            // containerd version is queried synchronously here because
                            // OnceLock::get_or_init is sync; it runs once and is fast enough.
                            // Blocking ctr is fine inside OnceLock init (runs once), but keep it off
                            // the main async worker by using a dedicated thread when possible.
                            let containerd_version = std::thread::spawn(|| {
                                std::process::Command::new("ctr")
                                    .arg("version")
                                    .output()
                                    .ok()
                                    .and_then(|o| {
                                        if o.status.success() {
                                            String::from_utf8_lossy(&o.stdout)
                                                .lines()
                                                .find(|l| l.contains("Version:"))
                                                .map(|l| {
                                                    l.split(':')
                                                        .nth(1)
                                                        .unwrap_or("")
                                                        .trim()
                                                        .to_string()
                                                })
                                        } else {
                                            None
                                        }
                                    })
                                    .unwrap_or_default()
                            })
                            .join()
                            .unwrap_or_default();
                            (os_info, kernel_version, containerd_version)
                        })
                        .clone();

                    let uptime = crate::websocket_handler::get_uptime().await;

                    let response = json!({
                        "type": "agent_status_response",
                        "requestId": msg_clone.get("requestId"),
                        "uptime": uptime,
                        "osInfo": os_info,
                        "kernelVersion": kernel_version,
                        "containerRuntime": if containerd_version.is_empty() { Value::Null } else { Value::String(format!("containerd {}", containerd_version)) },
                        "configPath": if config_path.as_os_str().is_empty() { Value::Null } else { Value::String(config_path.display().to_string()) },
                        "sftpEnabled": sftp_enabled,
                        "sftpPort": sftp_port,
                    });
                    let mut w = write.lock().await;
                    let _ = w.send(Message::Text(response.to_string().into())).await;
                });
            }
            Some("create_network") => self.handle_create_network(&msg, write).await?,
            Some("restart_agent") => {
                info!("Received restart_agent command from backend");
                let msg_clone = msg.clone();
                let handler = self.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    // Acknowledge the restart command
                    let ack = json!({
                        "type": "agent_restart_ack",
                        "requestId": msg_clone.get("requestId"),
                    });
                    {
                        let mut w = write.lock().await;
                        let _ = w.send(Message::Text(ack.to_string().into())).await;
                    }
                    // Give the ack time to be sent before we shut down
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    // Trigger graceful shutdown
                    let tx = handler.shutdown_tx.read().await.clone();
                    if let Some(tx) = tx {
                        let _ = tx.send(());
                    } else {
                        std::process::exit(0);
                    }
                });
            }
            Some("ping") => {
                let write = Arc::clone(write);
                let msg_clone = msg.clone();
                tokio::spawn(async move {
                    let pong = json!({
                        "type": "pong",
                        "requestId": msg_clone.get("requestId"),
                        "timestamp": chrono::Utc::now().to_rfc3339(),
                    });
                    let mut w = write.lock().await;
                    let _ = w.send(Message::Text(pong.to_string().into())).await;
                });
            }
            Some("agent_logs") => {
                let lines = msg.get("lines").and_then(|v| v.as_u64()).unwrap_or(200) as usize;
                let msg_clone = msg.clone();
                let write = Arc::clone(write);
                tokio::spawn(async move {
                    // Try journalctl first (systemd-managed agents)
                    let journal_output = tokio::process::Command::new("journalctl")
                        .args([
                            "-u",
                            "catalyst-agent",
                            "-n",
                            &lines.to_string(),
                            "--no-pager",
                            "--output=json",
                        ])
                        .output()
                        .await;

                    let logs: Vec<Value> =
                        match &journal_output {
                            Ok(out) if out.status.success() && !out.stdout.is_empty() => {
                                // Parse journalctl JSON output
                                String::from_utf8_lossy(&out.stdout)
                                .lines()
                                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                                .map(|entry| {
                                    // __REALTIME_TIMESTAMP is microseconds since epoch — convert to ISO 8601
                                    let ts_iso = entry["__REALTIME_TIMESTAMP"]
                                        .as_str()
                                        .and_then(|v| v.parse::<u64>().ok())
                                        .map(|us| chrono::DateTime::from_timestamp_micros(us as i64)
                                            .map(|dt| dt.to_rfc3339())
                                            .unwrap_or_default())
                                        .unwrap_or_default();
                                    json!({
                                        "timestamp": ts_iso,
                                        "level": match entry["PRIORITY"].as_str().unwrap_or("6") {
                                            "0" | "1" | "2" => "error",
                                            "3" => "warn",
                                            "4" => "info",
                                            "5" => "debug",
                                            _ => "trace",
                                        },
                                        "target": entry["CODE_FUNC"].as_str().unwrap_or("agent"),
                                        "message": entry["MESSAGE"].as_str().unwrap_or(""),
                                    })
                                })
                                .collect()
                            }
                            _ => {
                                // Fallback: try reading from /var/log/catalyst-agent/ or agent data dir
                                // Use tail-style reading to avoid loading huge files into memory.
                                let log_paths = vec![
                                    "/var/log/catalyst-agent/agent.log",
                                    "/opt/catalyst-agent/agent.log",
                                ];
                                let mut parsed = vec![];
                                for path in &log_paths {
                                    if let Ok(content) = read_tail(path, lines).await {
                                        // Parse plain-text log lines
                                        // Expected format: YYYY-MM-DDTHH:MM:SS [LEVEL] module::path: message
                                        for line in content.lines() {
                                            let (level, target, message) = parse_log_line(line);
                                            let ts = extract_timestamp(line);
                                            parsed.push(json!({
                                                "timestamp": ts,
                                                "level": level,
                                                "target": target,
                                                "message": message,
                                            }));
                                        }
                                        break;
                                    }
                                }
                                parsed
                            }
                        };

                    let response = json!({
                        "type": "agent_logs_response",
                        "requestId": msg_clone.get("requestId"),
                        "logs": logs,
                    });
                    let mut w = write.lock().await;
                    let _ = w.send(Message::Text(response.to_string().into())).await;
                });
            }
            Some("agent_config") => {
                let config_path = self.config.agent.config_path.clone();
                let write = Arc::clone(write);
                let msg_clone = msg.clone();
                tokio::spawn(async move {
                    let path = if config_path.as_os_str().is_empty() {
                        PathBuf::from("/opt/catalyst-agent/config.toml")
                    } else {
                        config_path
                    };
                    let path_str = path.display().to_string();
                    let raw_content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
                    // Never return secrets (api_key, tokens, passwords) over node.read.
                    let content = redact_agent_config_secrets(&raw_content);
                    let metadata = tokio::fs::metadata(&path).await.ok();
                    let response = json!({
                        "type": "agent_config_response",
                        "requestId": msg_clone.get("requestId"),
                        "path": path_str,
                        "content": content,
                        "lastModified": metadata.and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .and_then(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0))
                            .map(|dt| dt.to_rfc3339()),
                    });
                    let mut w = write.lock().await;
                    let _ = w.send(Message::Text(response.to_string().into())).await;
                });
            }
            Some("agent_config_update") => {
                let config_path = self.config.agent.config_path.clone();
                let content = msg
                    .get("content")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let write = Arc::clone(write);
                let msg_clone = msg.clone();
                tokio::spawn(async move {
                    let path = if config_path.as_os_str().is_empty() {
                        PathBuf::from("/opt/catalyst-agent/config.toml")
                    } else {
                        config_path
                    };
                    let response = match content {
                        Some(c) => {
                            // Validate parseable TOML + required fields, then atomic write + 0600.
                            match c.parse::<toml::Value>() {
                                Ok(parsed) => {
                                    let validation_err = (|| -> Option<String> {
                                        let table = parsed.as_table()?;
                                        let server = table.get("server")?.as_table()?;
                                        for key in [
                                            "backend_url",
                                            "node_id",
                                            "api_key",
                                            "hostname",
                                            "data_dir",
                                        ] {
                                            let val = server
                                                .get(key)
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("")
                                                .trim();
                                            if val.is_empty() {
                                                return Some(format!(
                                                    "Missing required server.{} field",
                                                    key
                                                ));
                                            }
                                        }
                                        None
                                    })();
                                    if let Some(err) = validation_err {
                                        json!({
                                            "type": "agent_config_update_response",
                                            "requestId": msg_clone.get("requestId"),
                                            "saved": false,
                                            "error": err,
                                        })
                                    } else {
                                        match atomic_write::atomic_write(&path, &c).await {
                                            Ok(_) => json!({
                                                "type": "agent_config_update_response",
                                                "requestId": msg_clone.get("requestId"),
                                                "saved": true,
                                            }),
                                            Err(e) => json!({
                                                "type": "agent_config_update_response",
                                                "requestId": msg_clone.get("requestId"),
                                                "saved": false,
                                                "error": e.to_string(),
                                            }),
                                        }
                                    }
                                }
                                Err(e) => json!({
                                    "type": "agent_config_update_response",
                                    "requestId": msg_clone.get("requestId"),
                                    "saved": false,
                                    "error": format!("Invalid TOML: {}", e),
                                }),
                            }
                        }
                        None => json!({
                            "type": "agent_config_update_response",
                            "requestId": msg_clone.get("requestId"),
                            "saved": false,
                            "error": "No content provided",
                        }),
                    };
                    let mut w = write.lock().await;
                    let _ = w.send(Message::Text(response.to_string().into())).await;
                });
            }
            Some("update_network") => self.handle_update_network(&msg, write).await?,
            Some("delete_network") => self.handle_delete_network(&msg, write).await?,
            Some("allocation_added") => self.handle_allocation_added(&msg).await?,
            Some("allocation_removed") => self.handle_allocation_removed(&msg).await?,
            Some("accept_eula") => self.handle_eula_response(&msg, true).await?,
            Some("decline_eula") => self.handle_eula_response(&msg, false).await?,
            Some("node_handshake_response") => {
                info!("Handshake accepted by backend");
                self.apply_panel_upload_limit(&msg);
                self.set_backend_connected(true).await;
            }
            Some("file_upload_limit") => {
                self.apply_panel_upload_limit(&msg);
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
                // Match dedicated restart_server: wait up to 30s for stop, force-kill
                // if needed, then start with full details when available.
                // Capture start details before stop_server clears start_server_messages.
                let stored_start = self
                    .start_server_messages
                    .read()
                    .await
                    .get(server_id)
                    .cloned();
                let container_id_for_wait = container_id.clone();
                self.stop_server(server_id, container_id, &stop_policy)
                    .await?;
                let wait_start = Instant::now();
                loop {
                    if container_id_for_wait.is_empty() {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                        break;
                    }
                    match self
                        .runtime
                        .is_container_running(&container_id_for_wait)
                        .await
                    {
                        Ok(false) => break,
                        Ok(true) if wait_start.elapsed() > Duration::from_secs(30) => {
                            warn!(
                                "Container {} did not stop within 30s during server_control restart, forcing kill",
                                container_id_for_wait
                            );
                            if let Err(e) = self
                                .kill_server(server_id, container_id_for_wait.clone())
                                .await
                            {
                                error!("Force kill failed during server_control restart: {}", e);
                                self.report_error(
                                    ErrorLevel::Error,
                                    "agent:restart_server:force_kill",
                                    &format!(
                                        "Force kill failed for server {} during restart: {}",
                                        server_id, e
                                    ),
                                    None,
                                    Some(serde_json::json!({ "serverId": server_id })),
                                )
                                .await;
                            }
                            break;
                        }
                        _ => {}
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                // Prefer start_server_with_details when the original start message is
                // still available (env, mounts, ports); otherwise fall back to start.
                if let Some(stored) = stored_start {
                    self.start_server_with_details(&stored).await?;
                } else if msg.get("dockerImage").is_some()
                    || msg.get("image").is_some()
                    || msg.get("startupCommand").is_some()
                {
                    self.start_server_with_details(msg).await?;
                } else {
                    let container_id = self.resolve_container_id(server_id, server_uuid).await;
                    self.start_server(server_id, container_id).await?;
                }
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
        let request_id = msg.get("requestId").cloned().unwrap_or(Value::Null);
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
                "requestId": request_id,
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
                "requestId": request_id,
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

        // SECURITY: server_uuid is joined into data_dir/<uuid> and the image
        // path images/<uuid>.img feeding fallocate/resize2fs/e2fsck. Reject
        // traversal/absolute ids so a malformed message cannot target
        // arbitrary host paths.
        crate::shell_utils::validate_safe_path_segment(server_id, "serverId")?;
        crate::shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;

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
        let request_id = msg.get("requestId").cloned().unwrap_or(Value::Null);
        let network = self.parse_network_config(msg)?;

        let result = self.network_manager.create_network(&network).await;

        let event = match &result {
            Ok(_) => json!({
                "type": "network_created",
                "requestId": request_id,
                "networkName": network.name,
                "success": true,
            }),
            Err(err) => json!({
                "type": "network_created",
                "requestId": request_id,
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
        let request_id = msg.get("requestId").cloned().unwrap_or(Value::Null);
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
                "requestId": request_id,
                "oldName": old_name,
                "networkName": network.name,
                "success": true,
            }),
            Err(err) => json!({
                "type": "network_updated",
                "requestId": request_id,
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
        let request_id = msg.get("requestId").cloned().unwrap_or(Value::Null);
        let network_name = msg["networkName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing networkName".to_string()))?;

        let result = self.network_manager.delete_network(network_name).await;

        let event = match &result {
            Ok(_) => json!({
                "type": "network_deleted",
                "requestId": request_id,
                "networkName": network_name,
                "success": true,
            }),
            Err(err) => json!({
                "type": "network_deleted",
                "requestId": request_id,
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

        // Critical state transitions must survive a disconnect: send now, or
        // persist for replay on the next connection.
        self.send_or_buffer_event(&text).await
    }

    /// Echo a power-command acknowledgement so the panel's requestFromAgent
    /// can resolve. Only sent when the inbound message carried a requestId.
    pub(crate) async fn emit_power_command_ack(
        &self,
        request_id: Option<&str>,
        server_id: &str,
        action: &str,
        success: bool,
        error: Option<&str>,
    ) {
        let Some(request_id) = request_id.filter(|id| !id.is_empty()) else {
            return;
        };

        let mut payload = json!({
            "type": "power_command_ack",
            "requestId": request_id,
            "serverId": server_id,
            "action": action,
            "success": success,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });
        if let Some(err) = error {
            payload["error"] = json!(err);
        }

        let text = match serde_json::to_string(&payload) {
            Ok(t) => t,
            Err(_) => return,
        };

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(text.into())).await {
                warn!(
                    "Failed to send power_command_ack for {} ({}): {}",
                    action, server_id, err
                );
            }
        }
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
            // The container process owns eula.txt at runtime — hand it over (#237).
            crate::ownership::ensure_container_owned(&self.config.server.data_dir, &eula_file)
                .await;

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

/// Parse a plain-text log line into (level, target, message).
/// Handles tracing-style output: `YYYY-MM-DDTHH:MM:SS.ZZZZ [LEVEL] module::path: message`
fn parse_log_line(line: &str) -> (&'static str, &str, &str) {
    // Extract level from brackets like [ERROR], [WARN], [INFO], [DEBUG], [TRACE]
    let level = if line.contains("[ERROR]") || line.contains("[error]") {
        "error"
    } else if line.contains("[WARN]") || line.contains("[warn]") {
        "warn"
    } else if line.contains("[INFO]") || line.contains("[info]") {
        "info"
    } else if line.contains("[DEBUG]") || line.contains("[debug]") {
        "debug"
    } else if line.contains("[TRACE]") || line.contains("[trace]") {
        "trace"
    } else {
        "info"
    };

    // Try to extract target and message after the level bracket
    let after_level = line.find(']').map(|i| i + 1).unwrap_or(0);
    let rest = line.get(after_level..).unwrap_or("").trim();

    // tracing format: module::path: message
    let (target, message) = if let Some(colon_pos) = rest.find(": ") {
        (
            rest.get(..colon_pos).unwrap_or("agent"),
            rest.get(colon_pos + 2..).unwrap_or(rest),
        )
    } else {
        ("agent", rest)
    };

    (level, target, message)
}

/// Extract ISO timestamp from the start of a log line.
fn extract_timestamp(line: &str) -> String {
    // tracing format starts with e.g. "2024-01-15T10:30:00.123456Z"
    let end = line.find(' ').unwrap_or(line.len().min(25));
    line.get(..end).unwrap_or("").to_string()
}

/// Read the last `max_lines` lines from a file without loading the entire
/// file into memory. Seeks backwards from the end in 4 KB chunks to find
/// line boundaries. Returns up to `max_lines` lines as a single String.
async fn read_tail(path: &str, max_lines: usize) -> Result<String, std::io::Error> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut file = tokio::fs::File::open(path).await?;
    let file_size = file.metadata().await?.len();

    if file_size == 0 {
        return Ok(String::new());
    }

    // For small files (< 64 KB), just read the whole thing.
    if file_size < 65_536 {
        let content = tokio::fs::read_to_string(path).await?;
        let lines: Vec<&str> = content.lines().collect();
        let start = lines.len().saturating_sub(max_lines);
        return Ok(lines[start..].join("\n"));
    }

    // For large files, seek backwards in chunks to find enough newlines.
    const CHUNK: u64 = 4096;
    let mut buf = Vec::new();
    let mut pos = file_size;
    let mut newline_count: usize = 0;

    while pos > 0 && newline_count < max_lines + 1 {
        let read_start = pos.saturating_sub(CHUNK);
        let read_len = pos - read_start;

        file.seek(std::io::SeekFrom::Start(read_start)).await?;
        let mut chunk = vec![0u8; read_len as usize];
        file.read_exact(&mut chunk).await?;

        // Count newlines in this chunk
        for &byte in chunk.iter().rev() {
            if byte == b'\n' {
                newline_count += 1;
                if newline_count > max_lines {
                    break;
                }
            }
        }

        buf.extend_from_slice(&chunk);
        pos = read_start;
    }

    // Reverse the collected bytes and split into lines
    buf.reverse();
    let content = String::from_utf8_lossy(&buf);
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    Ok(lines[start..].join("\n"))
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

/// Clamp a host CPU percentage into the [0, 100] range with NaN/∞ protection.
/// sysinfo's global_cpu_usage should already be sane, but an out-of-range or
/// non-finite value would otherwise poison the whole health report: serde
/// serializes NaN as `null`, and the backend rejects reports with null fields.
pub(crate) fn sanitize_cpu_percent(value: f32) -> f32 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, 100.0)
}

/// True when an interface carries host-level traffic worth reporting.
/// Loopback counts container↔container on the same host, and veth/bridge/
/// cni/podman links mirror each packet once per hop — summing them all would
/// multiply real throughput by 2-4×.
pub(crate) fn is_physical_interface(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    !(n == "lo"
        || n.starts_with("veth")
        || n.starts_with("br-")
        || n.starts_with("docker")
        || n.starts_with("virbr")
        || n.starts_with("lxcbr")
        || n.starts_with("cni")
        || n.starts_with("podman")
        || n.starts_with("vet"))
}

/// Disk usage of the filesystem containing `dir`, in (used, total) MiB.
/// Reports zeros if the filesystem cannot be queried rather than guessing.
pub(crate) fn data_dir_disk_usage_mb(dir: &std::path::Path) -> (u64, u64) {
    match nix::sys::statvfs::statvfs(dir) {
        Ok(vfs) => {
            let block_bytes = vfs.fragment_size();
            let total_mb = vfs.blocks() * block_bytes / (1024 * 1024);
            // f_bavail = free blocks available to unprivileged users.
            let avail_mb = vfs.blocks_available() * block_bytes / (1024 * 1024);
            (total_mb.saturating_sub(avail_mb), total_mb)
        }
        Err(e) => {
            warn!(
                "statvfs({}) failed: {} — disk metrics unavailable",
                dir.display(),
                e
            );
            (0, 0)
        }
    }
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

/// Parse container memory usage strings like "512MiB / 1GiB" into used MiB.
/// Division uses 1024² so MiB/GiB (and sysinfo byte counts) stay consistent.
pub(crate) fn parse_memory_usage_mb(value: &str) -> Option<u64> {
    let first = value.split('/').next()?.trim();
    parse_size_to_bytes(first).map(|bytes| bytes / (1024 * 1024))
}

pub(crate) fn parse_size_to_bytes(value: &str) -> Option<u64> {
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

async fn send_ws_with_timeout(
    write: &Arc<tokio::sync::Mutex<WsWrite>>,
    msg: Message,
) -> AgentResult<()> {
    // Bound BOTH stages: acquiring the sink lock (a peer task stuck holding it
    // must not wedge unrelated senders forever) and the frame write itself.
    let mut w = tokio::time::timeout(WS_SEND_TIMEOUT, write.lock())
        .await
        .map_err(|_| {
            AgentError::NetworkError(format!(
                "WebSocket sink lock timed out after {}s",
                WS_SEND_TIMEOUT.as_secs()
            ))
        })?;
    tokio::time::timeout(WS_SEND_TIMEOUT, w.send(msg))
        .await
        .map_err(|_| {
            AgentError::NetworkError(format!(
                "WebSocket send timed out after {}s",
                WS_SEND_TIMEOUT.as_secs()
            ))
        })?
        .map_err(|e| AgentError::NetworkError(e.to_string()))
}

#[cfg(test)]
pub(crate) fn parse_df_output_mb(output: &str) -> Option<(u64, u64)> {
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

#[cfg(test)]
mod memory_parse_tests {
    use super::{parse_memory_usage_mb, parse_size_to_bytes};

    #[test]
    fn parses_mib_as_mebibytes() {
        // 512 MiB => 512 MiB (not off-by-1024)
        assert_eq!(parse_memory_usage_mb("512MiB / 1GiB"), Some(512));
        assert_eq!(parse_memory_usage_mb("1024MiB"), Some(1024));
    }

    #[test]
    fn parses_gib_correctly() {
        assert_eq!(parse_memory_usage_mb("1GiB"), Some(1024));
        assert_eq!(parse_memory_usage_mb("2GiB / 4GiB"), Some(2048));
    }

    #[test]
    fn parses_raw_bytes_with_1024_divisor() {
        // 1 GiB in bytes must become 1024 MiB, not ~1 MiB (old /1024-only bug)
        let one_gib = 1024u64 * 1024 * 1024;
        assert_eq!(parse_size_to_bytes(&one_gib.to_string()), Some(one_gib));
        assert_eq!(parse_memory_usage_mb(&one_gib.to_string()), Some(1024));
    }

    #[test]
    fn rejects_empty() {
        assert_eq!(parse_memory_usage_mb(""), None);
        assert_eq!(parse_size_to_bytes("   "), None);
    }

    #[test]
    fn ws_idle_timeout_is_under_panel_heartbeat_timeout() {
        // Panel marks the node offline after 60s without a JSON heartbeat.
        // Detect a dead socket before that so reconnect can land a fresh one.
        assert!(super::WS_READ_IDLE_TIMEOUT.as_secs() < 60);
        assert!(super::WS_HEARTBEAT_INTERVAL < super::WS_READ_IDLE_TIMEOUT);
        assert!(super::WS_CONNECT_TIMEOUT.as_secs() >= 5);
        assert!(super::WS_SEND_TIMEOUT.as_secs() >= 5);
    }

    #[test]
    fn parses_decimal_units() {
        // SI megabytes / kilobytes
        assert_eq!(parse_size_to_bytes("1000kB"), Some(1_000_000));
        assert_eq!(parse_size_to_bytes("1.5MB"), Some(1_500_000));
        // 1.5 MiB => 1_572_864 bytes; integer /1024² floors to 1 MiB
        assert_eq!(parse_memory_usage_mb("1.5MiB"), Some(1));
        assert_eq!(parse_memory_usage_mb("2048KiB"), Some(2));
    }

    #[test]
    fn rejects_garbage_units() {
        assert_eq!(parse_size_to_bytes("12xx"), None);
        assert_eq!(parse_memory_usage_mb("not-a-size"), None);
    }

    #[test]
    fn cpu_sanitizer_clamps_and_degrades_non_finite() {
        use super::sanitize_cpu_percent;
        assert_eq!(sanitize_cpu_percent(0.0), 0.0);
        assert_eq!(sanitize_cpu_percent(37.5), 37.5);
        assert_eq!(sanitize_cpu_percent(100.0), 100.0);
        // Over-range readings (some virtualization layers report >100) clamp.
        assert_eq!(sanitize_cpu_percent(240.0), 100.0);
        assert_eq!(sanitize_cpu_percent(-1.0), 0.0);
        // Non-finite must become 0, never poison serialization.
        assert_eq!(sanitize_cpu_percent(f32::NAN), 0.0);
        assert_eq!(sanitize_cpu_percent(f32::INFINITY), 0.0);
    }

    #[test]
    fn host_interface_filter_excludes_virtual_links() {
        use super::is_physical_interface;
        assert!(is_physical_interface("eth0"));
        assert!(is_physical_interface("enp34s0"));
        assert!(is_physical_interface("wlan0"));
        // Loopback and virtual/container links mirror traffic — excluded.
        assert!(!is_physical_interface("lo"));
        assert!(!is_physical_interface("vethabc123"));
        assert!(!is_physical_interface("br-deadbeef"));
        assert!(!is_physical_interface("docker0"));
        assert!(!is_physical_interface("virbr0"));
        assert!(!is_physical_interface("lxcbr0"));
        assert!(!is_physical_interface("cni0"));
        assert!(!is_physical_interface("podman0"));
    }

    #[test]
    fn data_dir_disk_usage_reports_zero_on_missing_dir() {
        use super::data_dir_disk_usage_mb;
        let (used, total) = data_dir_disk_usage_mb(std::path::Path::new("/nonexistent/xyz"));
        assert_eq!((used, total), (0, 0));
    }

    #[test]
    fn data_dir_disk_usage_is_plausible_for_real_fs() {
        use super::data_dir_disk_usage_mb;
        // The workspace itself lives on a real filesystem.
        let (used, total) = data_dir_disk_usage_mb(std::path::Path::new("."));
        assert!(total > 0, "total should be positive for a real mount");
        assert!(
            used <= total,
            "used ({}) cannot exceed total ({})",
            used,
            total
        );
    }

    #[test]
    fn resource_stats_wire_contract_disk_read_write_mb() {
        use super::{ResourceStats, ResourceStatsEntry};
        // Wire contract: optional integer diskReadMb / diskWriteMb on BOTH the
        // single-server resource_stats payload and the batch entry. Fields must
        // appear as raw integers when Some and be fully ABSENT when None so
        // older panels (which ignore unknown keys) keep parsing cleanly and
        // legacy summed diskIoMb stays untouched.

        // Batch-entry shape (slow path → ResourceStatsBatch.metrics).
        let entry = ResourceStatsEntry {
            serverUuid: "cm0srv123".to_string(),
            cpuPercent: 12.5,
            memoryUsageMb: 256,
            networkRxBytes: 10,
            networkTxBytes: 20,
            diskIoMb: 30,
            diskReadMb: Some(10),
            diskWriteMb: Some(20),
            diskUsageMb: 1024,
            diskTotalMb: 20480,
            cpuThrottledUsec: Some(42_000),
            cpuThrottledRatio: Some(0.25),
            timestamp: 1_700_000_000_000,
        };
        let text = serde_json::to_string(&entry).unwrap();
        assert!(text.contains(r#""diskReadMb":10"#), "got {text}");
        assert!(text.contains(r#""diskWriteMb":20"#), "got {text}");
        assert!(
            text.contains(r#""diskIoMb":30"#),
            "legacy summed field must stay"
        );

        // Round-trip through JSON to confirm the keys survive with integer values.
        let round_tripped: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(round_tripped["diskReadMb"], serde_json::json!(10));
        assert_eq!(round_tripped["diskWriteMb"], serde_json::json!(20));
        assert_eq!(round_tripped["diskIoMb"], serde_json::json!(30));

        // None => both keys omitted from the serialized string entirely.
        let none_entry = ResourceStatsEntry {
            diskReadMb: None,
            diskWriteMb: None,
            ..entry
        };
        let text = serde_json::to_string(&none_entry).unwrap();
        let none_round_tripped: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(none_round_tripped.get("diskReadMb").is_none(), "got {text}");
        assert!(
            none_round_tripped.get("diskWriteMb").is_none(),
            "got {text}"
        );
        assert!(none_round_tripped["diskIoMb"] == serde_json::json!(30));

        // Fast-path single-server shape (resource_stats).
        let fast = ResourceStats {
            ty: "resource_stats",
            serverUuid: "cm0srv123",
            cpuPercent: 12.5,
            memoryUsageMb: 256,
            networkRxBytes: 10,
            networkTxBytes: 20,
            diskIoMb: 30,
            diskReadMb: Some(7),
            diskWriteMb: Some(3),
            diskUsageMb: 1024,
            diskTotalMb: 20480,
            cpuThrottledUsec: Some(42_000),
            cpuThrottledRatio: Some(0.25),
            timestamp: 1_700_000_000_000,
        };
        let text = serde_json::to_string(&fast).unwrap();
        assert!(text.contains(r#""diskReadMb":7"#), "got {text}");
        assert!(text.contains(r#""diskWriteMb":3"#), "got {text}");
        // Throttle fields must round-trip and omit when None.
        let none = ResourceStats {
            ty: "resource_stats",
            serverUuid: "cm0srv123",
            cpuPercent: 12.5,
            memoryUsageMb: 256,
            networkRxBytes: 10,
            networkTxBytes: 20,
            diskIoMb: 30,
            diskReadMb: None,
            diskWriteMb: None,
            diskUsageMb: 1024,
            diskTotalMb: 20480,
            cpuThrottledUsec: None,
            cpuThrottledRatio: None,
            timestamp: 1_700_000_000_000,
        };
        let text = serde_json::to_string(&none).unwrap();
        assert!(!text.contains("cpuThrottled"), "got {text}");
    }
}
