use base64::Engine;
use futures::stream::SplitSink;
use futures::{SinkExt, StreamExt};
use regex::Regex;
use reqwest::Url;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;
use sysinfo::{Disks, System};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::{AgentConfig, AgentError, AgentResult, ContainerdRuntime, FileManager, NetworkManager, StorageManager};
use crate::config::CniNetworkConfig;

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;
const CONTAINER_SERVER_DIR: &str = "/data";
const MAX_BACKUP_UPLOAD_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10GB
const BACKUP_UPLOAD_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes

/// Shell-escape a value for safe interpolation into a bash script.
/// Wraps the value in single quotes and escapes any embedded single quotes.
fn shell_escape_value(value: &str) -> String {
    // Single-quoting in bash prevents all interpretation except for single quotes themselves.
    // To include a literal single quote: end the single-quoted string, add an escaped quote, restart.
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

/// Normalize common bash arithmetic condition syntax so startup commands run under /bin/sh.
/// Example: `((1))` -> `[ $((1)) -ne 0 ]`
fn normalize_startup_for_sh(command: &str) -> String {
    static ARITH_COND_RE: OnceLock<Regex> = OnceLock::new();
    let re = ARITH_COND_RE.get_or_init(|| {
        Regex::new(r"\(\(\s*([^()]*)\s*\)\)").expect("valid arithmetic condition regex")
    });
    re.replace_all(command, |caps: &regex::Captures<'_>| {
        let expr = caps
            .get(1)
            .map(|m| m.as_str().trim())
            .unwrap_or("");
        if expr.is_empty() {
            "[ 0 -ne 0 ]".to_string()
        } else {
            format!("[ $(( {} )) -ne 0 ]", expr)
        }
    })
    .into_owned()
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
        return Err(AgentError::InvalidRequest(format!("Invalid {}: contains \\\\", label)));
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
            let metrics_value = serde_json::Value::Array(chunk.to_vec());
            let payload = json!({ "type": "resource_stats_batch", "metrics": metrics_value });
            let mut w = write.lock().await;
            if let Err(e) = w.send(Message::Text(payload.to_string().into())).await {
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
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }

    async fn establish_connection(&self) -> AgentResult<()> {
        self.set_backend_connected(false).await;

        let (auth_token, token_type) = self.select_agent_auth_token()?;

        // Enforce secure transport for non-local backends.
        let mut parsed_url = Url::parse(&self.config.server.backend_url).map_err(|e| {
            AgentError::ConfigError(format!("Invalid server.backend_url: {}", e))
        })?;
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

        let (ws_stream, _) = connect_async(ws_url.as_str())
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

        // Listen for messages
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    if let Err(e) = self.handle_message(&text, &write).await {
                        error!("Error handling message: {}", e);
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
            Some("install_server") => self.install_server(&msg).await?,
            Some("start_server") => {
                self.start_server_with_details(&msg).await?;
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
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                let stop_policy = parse_stop_policy(&msg);
                self.stop_server(server_id, container_id, &stop_policy)
                    .await?;
                tokio::time::sleep(Duration::from_secs(2)).await;
                self.start_server_with_details(&msg).await?;
            }
            Some("console_input") => self.handle_console_input(&msg).await?,
            Some("file_operation") => self.handle_file_operation(&msg).await?,
            Some("create_backup") => self.handle_create_backup(&msg, write).await?,
            Some("restore_backup") => self.handle_restore_backup(&msg, write).await?,
            Some("delete_backup") => self.handle_delete_backup(&msg, write).await?,
            Some("download_backup_start") => self.handle_download_backup_start(&msg, write).await?,
            Some("download_backup") => self.handle_download_backup(&msg, write).await?,
            Some("upload_backup_start") => self.handle_upload_backup_start(&msg, write).await?,
            Some("upload_backup_chunk") => self.handle_upload_backup_chunk(&msg, write).await?,
            Some("upload_backup_complete") => {
                self.handle_upload_backup_complete(&msg, write).await?
            }
            Some("resize_storage") => self.handle_resize_storage(&msg, write).await?,
            Some("resume_console") => self.resume_console(&msg).await?,
            Some("request_immediate_stats") => {
                info!("Received immediate stats request from backend");
                if let Err(e) = self.send_resource_stats().await {
                    warn!("Failed to send immediate stats: {}", e);
                }
            }
            Some("create_network") => self.handle_create_network(&msg, write).await?,
            Some("update_network") => self.handle_update_network(&msg, write).await?,
            Some("delete_network") => self.handle_delete_network(&msg, write).await?,
            Some("node_handshake_response") => {
                info!("Handshake accepted by backend");
                self.set_backend_connected(true).await;
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
            "stop" => self.stop_server(server_id, container_id, &stop_policy).await?,
            "kill" => self.kill_server(server_id, container_id).await?,
            "restart" => {
                self.stop_server(server_id, container_id, &stop_policy).await?;
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

    async fn cleanup_all_server_containers(&self, server_id: &str, server_uuid: &str) -> AgentResult<()> {
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
                        let _ = self
                            .runtime
                            .kill_container(container_name, "SIGKILL")
                            .await;
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
                &format!("[Catalyst] Cleaned up {} container(s) during error state cleanup.\n", cleaned),
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
                                let _ = monitor_handler
                                    .emit_server_state_update(
                                        &monitor_server_id,
                                        "crashed",
                                        Some(reason),
                                        None,
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
                        let _ = monitor_handler
                            .emit_server_state_update(
                                &monitor_server_id,
                                "crashed",
                                Some(reason),
                                None,
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

        self.cleanup_all_server_containers(server_id, server_uuid).await?;

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

        // Execute the install script in an ephemeral container for complete isolation
        // The container mounts the server directory at /data and runs the script there
        let installer = self
            .runtime
            .spawn_installer_container(install_image, &final_script, &env_map, &host_server_dir)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to spawn installer container: {}", e)))?;

        // Tail stdout/stderr files from the installer container
        let mut stdout_pos = 0u64;
        let mut stderr_pos = 0u64;
        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();

        loop {
            // Read new stdout content
            if let Ok(content) = tokio::fs::read_to_string(&installer.stdout_path).await {
                if (stdout_pos as usize) < content.len() {
                    for line in content[stdout_pos as usize..].lines() {
                        let payload = format!("{}\n", line);
                        stdout_buffer.push_str(&payload);
                        self.emit_console_output(server_id, "stdout", &payload).await?;
                    }
                    stdout_pos = content.len() as u64;
                }
            }
            // Read new stderr content
            if let Ok(content) = tokio::fs::read_to_string(&installer.stderr_path).await {
                if (stderr_pos as usize) < content.len() {
                    for line in content[stderr_pos as usize..].lines() {
                        let payload = format!("{}\n", line);
                        stderr_buffer.push_str(&payload);
                        self.emit_console_output(server_id, "stderr", &payload).await?;
                    }
                    stderr_pos = content.len() as u64;
                }
            }
            // Check if the installer container has exited
            match tokio::time::timeout(Duration::from_millis(200), installer.wait()).await {
                Ok(Ok(exit_code)) => {
                    // Read any remaining output
                    if let Ok(content) = tokio::fs::read_to_string(&installer.stdout_path).await {
                        if (stdout_pos as usize) < content.len() {
                            for line in content[stdout_pos as usize..].lines() {
                                let payload = format!("{}\n", line);
                                stdout_buffer.push_str(&payload);
                                self.emit_console_output(server_id, "stdout", &payload).await?;
                            }
                        }
                    }
                    if let Ok(content) = tokio::fs::read_to_string(&installer.stderr_path).await {
                        if (stderr_pos as usize) < content.len() {
                            for line in content[stderr_pos as usize..].lines() {
                                let payload = format!("{}\n", line);
                                stderr_buffer.push_str(&payload);
                                self.emit_console_output(server_id, "stderr", &payload).await?;
                            }
                        }
                    }
                    let _ = installer.cleanup().await;
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
                    break;
                }
                Ok(Err(e)) => {
                    let _ = installer.cleanup().await;
                    return Err(AgentError::IoError(format!("Installer wait failed: {}", e)));
                }
                Err(_) => {
                    // Timeout: container still running, continue tailing
                    continue;
                }
            }
        }

        if stdout_buffer.trim().is_empty() && stderr_buffer.trim().is_empty() {
            self.emit_console_output(server_id, "system", "[Catalyst] Installation complete.\n")
                .await?;
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

    fn spawn_log_stream(&self, server_id: &str, container_id: &str) {
        let handler = self.clone();
        let server_id = server_id.to_string();
        let container_id = container_id.to_string();
        tokio::spawn(async move {
            // First, clean up any stale streams for this server
            // This prevents issues when switching from installer to game server container
            {
                let mut streams = handler.active_log_streams.write().await;
                streams.retain(|key| {
                    // Keep only streams that don't belong to this server
                    // or keep the exact stream we're about to create (prevents duplicates)
                    !key.starts_with(&format!("{}:", server_id)) || *key == format!("{}:{}", server_id, container_id)
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

        // Tail the stdout/stderr files
        loop {
            let running = self.runtime.is_container_running(container_id).await.unwrap_or(false);
            let mut had_data = false;

            if let Ok(content) = tokio::fs::read_to_string(&stdout_path).await {
                if (stdout_pos as usize) < content.len() {
                    for line in content[stdout_pos as usize..].lines() {
                        let payload = format!("{}\n", line);
                        self.emit_console_output(server_id, "stdout", &payload).await?;
                    }
                    stdout_pos = content.len() as u64;
                    had_data = true;
                }
            }
            if let Ok(content) = tokio::fs::read_to_string(&stderr_path).await {
                if (stderr_pos as usize) < content.len() {
                    for line in content[stderr_pos as usize..].lines() {
                        let payload = format!("{}\n", line);
                        self.emit_console_output(server_id, "stderr", &payload).await?;
                    }
                    stderr_pos = content.len() as u64;
                    had_data = true;
                }
            }

            if !running {
                // Read any final data
                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Ok(content) = tokio::fs::read_to_string(&stdout_path).await {
                    if (stdout_pos as usize) < content.len() {
                        for line in content[stdout_pos as usize..].lines() {
                            self.emit_console_output(server_id, "stdout", &format!("{}\n", line)).await?;
                        }
                    }
                }
                if let Ok(content) = tokio::fs::read_to_string(&stderr_path).await {
                    if (stderr_pos as usize) < content.len() {
                        for line in content[stderr_pos as usize..].lines() {
                            self.emit_console_output(server_id, "stderr", &format!("{}\n", line)).await?;
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
            env_map.insert("HOST_SERVER_DIR".to_string(), host_server_dir.clone());
            env_map.insert("SERVER_DIR".to_string(), CONTAINER_SERVER_DIR.to_string());

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

            self.cleanup_all_server_containers(server_id, server_uuid).await?;

            // Create and start container
            self.runtime
                .create_container(crate::runtime_manager::ContainerConfig {
                    container_id: server_id,
                    image: docker_image,
                    startup_command: &final_startup_command,
                    env: &env_map,
                    memory_mb,
                    cpu_cores,
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
            info!("No container found for server {}, marking as stopped", server_id);
            self.stop_monitor_task(server_id).await;
            self.emit_server_state_update(server_id, "stopped", None, None, None)
                .await?;
            return Ok(());
        }
        info!(
            "Stopping server: {} (container {})",
            server_id, container_id
        );

        self.stop_monitor_task(server_id).await;

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
            info!("No container found for server {}, marking as crashed", server_id);
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
        info!("Killing server: {} (container {})", server_id, container_id);

        self.stop_monitor_task(server_id).await;

        let _ = self
            .emit_console_output(
                server_id,
                "system",
                "[Catalyst] Force killing server with SIGKILL...\n",
            )
            .await;

        self.runtime.force_kill_container(&container_id).await?;

        if self.runtime.container_exists(&container_id).await {
            self.runtime.remove_container(&container_id).await?;
        }

        self.emit_server_state_update(
            server_id,
            "crashed",
            Some("Killed by agent".to_string()),
            None,
            Some(137),
        )
        .await?;

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
        let server_uuid = msg["serverUuid"]
            .as_str()
            .unwrap_or(server_id);

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
        let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);

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
        let checksum = format!("{:x}", hasher.finalize());

        let event = json!({
            "type": "backup_complete",
            "serverId": server_id,
            "backupName": backup_name,
            "backupPath": backup_path.to_string_lossy(),
            "sizeMb": size_mb,
            "checksum": checksum,
            "backupId": backup_id,
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

        info!(
            "Restoring backup {} for server {} into {}",
            backup_file.display(),
            server_id,
            server_dir.display()
        );

        let restore_result = tokio::process::Command::new("tar")
            .arg("-xzf")
            .arg(&backup_file)
            .arg("-C")
            .arg(&server_dir)
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run tar: {}", e)))?;

        if !restore_result.status.success() {
            let stderr = String::from_utf8_lossy(&restore_result.stderr);
            return Err(AgentError::IoError(format!(
                "Backup restore failed: {}",
                stderr
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

        let next_total = session
            .bytes_written
            .saturating_add(chunk.len() as u64);
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
        PathBuf::from("/var/lib/catalyst/backups").join(server_uuid)
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
            base_dir.join(requested_path.trim_start_matches('/'))
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

        let base_canon = base_dir
            .canonicalize()
            .map_err(|_| AgentError::FileSystemError("Backup directory missing".to_string()))?;
        let parent_canon = parent
            .canonicalize()
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

    /// Handle create_network message
    async fn handle_create_network(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let network = self.parse_network_config(msg)?;

        let result = NetworkManager::create_network(&network);

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

        let result = NetworkManager::update_network(old_name, &network);

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

        let result = NetworkManager::delete_network(network_name);

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
        let msg = json!({
            "type": "server_state_update",
            "serverId": server_id,
            "state": state,
            "timestamp": chrono::Utc::now().timestamp_millis(),
            "reason": reason,
            "portBindings": port_bindings,
            "exitCode": exit_code,
        });

        debug!("Emitting state update: {}", msg);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(msg.to_string().into())).await {
                error!("Failed to send state update: {}", err);
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

        let msg = json!({
            "type": "console_output",
            "serverId": server_id,
            "stream": stream,
            "data": data,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(msg.to_string().into())).await {
                error!("Failed to send console output: {}", err);
            }
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

        let health = json!({
            "type": "health_report",
            "nodeId": self.config.server.node_id,
            "timestamp": chrono::Utc::now().timestamp_millis(),
            "cpuPercent": cpu_percent,
            "memoryUsageMb": memory_usage_mb,
            "memoryTotalMb": memory_total_mb,
            "diskUsageMb": disk_usage_mb,
            "diskTotalMb": disk_total_mb,
            "containerCount": containers.iter().filter(|c| c.managed).count(),
            "uptimeSeconds": get_uptime(),
        });

        debug!("Health report: {}", health);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            w.send(Message::Text(health.to_string().into()))
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
            if !container.managed { continue; }
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
            if !container.managed { continue; }
            let server_uuid = normalize_container_name(&container.names);
            if server_uuid.is_empty() {
                continue;
            }

            let is_running = container.status.contains("Up");
            let state = if is_running { "running" } else { "stopped" };

            // If container is stopped, try to get exit code
            let exit_code = if !is_running {
                self.runtime
                    .get_container_exit_code(&container.id)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };

            info!(
                "Reconciling container: name='{}', uuid='{}', status='{}', state='{}'",
                container.names, server_uuid, container.status, state
            );

            let msg = json!({
                "type": "server_state_sync",
                "serverUuid": server_uuid,
                "containerId": server_uuid,  // Use container name (CUID), not internal container ID
                "state": state,
                "exitCode": exit_code,
                "timestamp": chrono::Utc::now().timestamp_millis(),
            });

            let mut w = ws.lock().await;
            if let Err(err) = w.send(Message::Text(msg.to_string().into())).await {
                warn!("Failed to send state sync: {}", err);
                break;
            }
        }

        // Send reconciliation complete message so backend knows which servers are missing
        let complete_msg = json!({
            "type": "server_state_sync_complete",
            "nodeId": self.config.server.node_id,
            "foundContainers": found_uuids,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let mut w = ws.lock().await;
        if let Err(err) = w.send(Message::Text(complete_msg.to_string().into())).await {
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

        loop {
            // Subscribe to all events
            let event_stream = match self.runtime.subscribe_to_all_events().await {
                Ok(stream) => stream,
                Err(e) => {
                    error!(
                        "Failed to subscribe to global events: {}. Retrying in 10s...",
                        e
                    );
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };

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
        let state = if is_running { "running" } else { "stopped" };

        let exit_code = if !is_running {
            self.runtime
                .get_container_exit_code(container_name)
                .await
                .ok()
                .flatten()
        } else {
            None
        };

        let msg = json!({
            "type": "server_state_sync",
            "serverUuid": container_name,
            "containerId": container_name,
            "state": state,
            "exitCode": exit_code,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let mut w = ws.lock().await;
        w.send(Message::Text(msg.to_string().into()))
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

        let msg = json!({
            "type": "server_state_sync",
            "serverUuid": container_name,
            "containerId": container_name,
            "state": "stopped",
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let mut w = ws.lock().await;
        w.send(Message::Text(msg.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        debug!("Synced removed container {} as stopped", container_name);
        Ok(())
    }

    pub async fn send_resource_stats(&self) -> AgentResult<()> {
        let containers = self.runtime.list_containers().await?;
        if containers.is_empty() {
            return Ok(());
        }

        let writer_opt = { self.write.read().await.clone() };
        // writer_opt may be None if we're not connected; we will buffer metrics to disk in that case;

        for container in containers {
            if !container.status.contains("Up") || !container.managed {
                continue;
            }

            let server_uuid = normalize_container_name(&container.names);
            if server_uuid.is_empty() {
                continue;
            }

            let stats = match self.runtime.get_stats(&container.id).await {
                Ok(stats) => stats,
                Err(err) => {
                    warn!(
                        "Failed to fetch stats for container {}: {}",
                        container.id, err
                    );
                    continue;
                }
            };

            let cpu_percent = parse_percent(&stats.cpu_percent).unwrap_or(0.0);
            let memory_usage_mb = parse_memory_usage_mb(&stats.memory_usage).unwrap_or(0);
            let (network_rx_bytes, network_tx_bytes) =
                parse_io_pair_bytes(&stats.net_io).unwrap_or((0, 0));
            let (disk_read_bytes, disk_write_bytes) =
                parse_io_pair_bytes(&stats.block_io).unwrap_or((0, 0));
            let disk_io_mb = (disk_read_bytes + disk_write_bytes) / (1024 * 1024);
            let (disk_usage_mb, disk_total_mb) = match self
                .runtime
                .exec(&container.id, vec!["df", "-m", "/data"])
                .await
                .ok()
                .and_then(|output| parse_df_output_mb(&output))
            {
                Some(value) => value,
                None => {
                    warn!(
                        "Failed to read filesystem usage for container {}. Falling back to block IO stats.",
                        container.id
                    );
                    (disk_io_mb, 0)
                }
            };

            let payload = json!({
                "type": "resource_stats",
                "serverUuid": server_uuid,
                "cpuPercent": cpu_percent,
                "memoryUsageMb": memory_usage_mb,
                "networkRxBytes": network_rx_bytes,
                "networkTxBytes": network_tx_bytes,
                "diskIoMb": disk_io_mb,
                "diskUsageMb": disk_usage_mb,
                "diskTotalMb": disk_total_mb,
                "timestamp": chrono::Utc::now().timestamp_millis(),
            });

            // If we have a live write handle, send; otherwise buffer to disk immediately
            match &writer_opt {
                Some(ws) => {
                    let mut w = ws.lock().await;
                    match w.send(Message::Text(payload.to_string().into())).await {
                        Ok(_) => {}
                        Err(err) => {
                            warn!("Failed to send resource stats: {}. Buffering to disk.", err);
                            if let Err(e) =
                                self.storage_manager.append_buffered_metric(&payload).await
                            {
                                warn!("Failed to buffer metric to disk: {}", e);
                            }
                        }
                    }
                }
                None => {
                    // No connection - persist metric locally for later flush
                    if let Err(e) = self.storage_manager.append_buffered_metric(&payload).await {
                        warn!("Failed to buffer metric to disk: {}", e);
                    }
                }
            }
        }

        Ok(())
    }
}

fn get_uptime() -> u64 {
    // Simplified uptime calculation
    std::fs::read_to_string("/proc/uptime")
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
            if i >= data.len() { break; }
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
            while i < data.len() && data[i] & 0x80 != 0 { i += 1; }
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

fn parse_io_pair_bytes(value: &str) -> Option<(u64, u64)> {
    let mut parts = value.split('/');
    let left = parts.next()?.trim();
    let right = parts.next()?.trim();
    let left_bytes = parse_size_to_bytes(left)?;
    let right_bytes = parse_size_to_bytes(right)?;
    Some((left_bytes, right_bytes))
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
