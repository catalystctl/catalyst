use base64::Engine;
use futures::stream::SplitSink;
use futures::{SinkExt, StreamExt};
use regex::Regex;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Duration;
use sysinfo::{Disks, System};
use tokio::io::AsyncWriteExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt};
use tokio::sync::RwLock;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, warn};

use crate::{AgentConfig, AgentError, AgentResult, ContainerdRuntime, FileManager, StorageManager};

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsWrite = SplitSink<WsStream, Message>;

/// Shell-escape a value for safe interpolation into a bash script.
/// Wraps the value in single quotes and escapes any embedded single quotes.
fn shell_escape_value(value: &str) -> String {
    // Single-quoting in bash prevents all interpretation except for single quotes themselves.
    // To include a literal single quote: end the single-quoted string, add an escaped quote, restart.
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

pub struct WebSocketHandler {
    config: Arc<AgentConfig>,
    runtime: Arc<ContainerdRuntime>,
    file_manager: Arc<FileManager>,
    storage_manager: Arc<StorageManager>,
    write: Arc<RwLock<Option<Arc<tokio::sync::Mutex<WsWrite>>>>>,
    active_log_streams: Arc<RwLock<HashSet<String>>>,
    monitor_tasks: Arc<RwLock<HashMap<String, tokio::task::JoinHandle<()>>>>,
    active_uploads: Arc<RwLock<HashMap<String, tokio::fs::File>>>,
}

impl Clone for WebSocketHandler {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            file_manager: self.file_manager.clone(),
            storage_manager: self.storage_manager.clone(),
            write: self.write.clone(),
            active_log_streams: self.active_log_streams.clone(),
            monitor_tasks: self.monitor_tasks.clone(),
            active_uploads: self.active_uploads.clone(),
        }
    }
}

impl WebSocketHandler {
    fn is_hytale_template(template: &serde_json::Map<String, Value>) -> bool {
        let name = template
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let image = template
            .get("image")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let startup = template
            .get("startup")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let install_script = template
            .get("installScript")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        name.to_lowercase().contains("hytale")
            || image.to_lowercase().contains("hytale")
            || startup.contains("HytaleServer.jar")
            || install_script.contains("hytale-downloader")
    }

    async fn ensure_hytale_runtime_permissions(
        &self,
        server_id: &str,
        template: &serde_json::Map<String, Value>,
        server_dir: &str,
    ) -> AgentResult<()> {
        if !Self::is_hytale_template(template) {
            return Ok(());
        }

        if let Ok(metadata) = tokio::fs::metadata(server_dir).await {
            if metadata.uid() == 1001 {
                return Ok(());
            }
        }

        self.emit_console_output(
            server_id,
            "system",
            "[Catalyst] Repairing Hytale file permissions for runtime user...\n",
        )
        .await?;

        let ownership_status = tokio::process::Command::new("chown")
            .arg("-R")
            .arg("1001:1001")
            .arg(server_dir)
            .status()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run chown: {}", e)))?;
        if !ownership_status.success() {
            warn!(
                "Failed to chown Hytale server directory {} for server {}",
                server_dir, server_id
            );
            self.emit_console_output(
                server_id,
                "system",
                "[Catalyst] Warning: failed to set ownership to uid/gid 1001.\n",
            )
            .await?;
        }

        let chmod_status = tokio::process::Command::new("chmod")
            .arg("-R")
            .arg("u+rwX")
            .arg(server_dir)
            .status()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run chmod: {}", e)))?;
        if !chmod_status.success() {
            warn!(
                "Failed to chmod Hytale server directory {} for server {}",
                server_dir, server_id
            );
            self.emit_console_output(
                server_id,
                "system",
                "[Catalyst] Warning: failed to apply chmod u+rwX on server files.\n",
            )
            .await?;
        }

        Ok(())
    }

    pub fn new(
        config: Arc<AgentConfig>,
        runtime: Arc<ContainerdRuntime>,
        file_manager: Arc<FileManager>,
        storage_manager: Arc<StorageManager>,
    ) -> Self {
        Self {
            config,
            runtime,
            file_manager,
            storage_manager,
            write: Arc::new(RwLock::new(None)),
            active_log_streams: Arc::new(RwLock::new(HashSet::new())),
            monitor_tasks: Arc::new(RwLock::new(HashMap::new())),
            active_uploads: Arc::new(RwLock::new(HashMap::new())),
        }
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
            if let Err(e) = w.send(Message::Text(payload.to_string())).await {
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
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    }

    async fn establish_connection(&self) -> AgentResult<()> {
        let ws_url = format!(
            "{}?nodeId={}",
            self.config.server.backend_url, self.config.server.node_id
        );

        info!(
            "Connecting to backend: {}?nodeId={}",
            self.config.server.backend_url, self.config.server.node_id
        );

        let (ws_stream, _) = connect_async(&ws_url)
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
        let (auth_token, token_type) = if let Some(api_key) =
            self.config.server.api_key.as_ref().and_then(|value| {
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            }) {
            (api_key.as_str(), "api_key")
        } else {
            (self.config.server.secret.as_str(), "secret")
        };
        let handshake = json!({
            "type": "node_handshake",
            "token": auth_token,
            "nodeId": self.config.server.node_id,
            "tokenType": token_type,
        });

        {
            let mut w = write.lock().await;
            w.send(Message::Text(handshake.to_string()))
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

        // Start heartbeat task
        let write_clone = write.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(15));
            loop {
                interval.tick().await;
                debug!("Sending heartbeat");
                let heartbeat = json!({
                    "type": "heartbeat"
                });
                let mut w = write_clone.lock().await;
                let _ = w.send(Message::Text(heartbeat.to_string())).await;
            }
        });

        // Start periodic state reconciliation task (every 5 minutes)
        // This catches any status drift that may occur
        let handler_clone = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                debug!("Running periodic state reconciliation");
                if let Err(e) = handler_clone.reconcile_server_states().await {
                    warn!("Periodic reconciliation failed: {}", e);
                }
            }
        });

        // Start global event monitor for instant state syncing
        // This provides real-time state updates with zero polling
        let handler_clone = self.clone();
        tokio::spawn(async move {
            if let Err(e) = handler_clone.monitor_global_events().await {
                error!("Global event monitor failed: {}", e);
            }
        });

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
                self.stop_server(server_id, container_id).await?;
            }
            Some("restart_server") => {
                let server_uuid = msg["serverUuid"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
                let server_id = msg["serverId"].as_str().unwrap_or(server_uuid);
                let container_id = self.resolve_container_id(server_id, server_uuid).await;
                self.stop_server(server_id, container_id).await?;
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
            Some("node_handshake_response") => {
                info!("Handshake accepted by backend");
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
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }

        match action {
            "install" => self.install_server(msg).await?,
            "start" => self.start_server(server_id, container_id).await?,
            "stop" => self.stop_server(server_id, container_id).await?,
            "kill" => self.kill_server(server_id, container_id).await?,
            "restart" => {
                self.stop_server(server_id, container_id).await?;
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
        if self.runtime.container_exists(server_id).await {
            warn!(
                "Console container lookup using serverId {} (uuid {})",
                server_id, server_uuid
            );
            return Some(server_id.to_string());
        }
        if self.runtime.container_exists(server_uuid).await {
            return Some(server_uuid.to_string());
        }
        None
    }

    async fn resolve_container_id(&self, server_id: &str, server_uuid: &str) -> String {
        self.resolve_console_container_id(server_id, server_uuid)
            .await
            .unwrap_or_default()
    }

    async fn stop_monitor_task(&self, server_id: &str) {
        let mut tasks = self.monitor_tasks.write().await;
        if let Some(handle) = tasks.remove(server_id) {
            handle.abort();
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
                let mut event_stream = match monitor_handler
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

                // Take stdout from the event stream
                let stdout = match event_stream.stdout.take() {
                    Some(out) => out,
                    None => {
                        error!(
                            "Failed to capture event stream stdout for {}",
                            monitor_container_id
                        );
                        return;
                    }
                };

                let mut reader = tokio::io::BufReader::new(stdout).lines();

                // Read events line by line
                while let Ok(Some(event)) = reader.next_line().await {
                    let event = event.trim();
                    debug!("Container {} event: {}", monitor_container_id, event);

                    // Check for exit-related events
                    if event == "die" || event == "stop" || event == "kill" {
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

                // Clean up the event stream process
                let _ = event_stream.wait().await;
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

        // Destroy any existing container for this server before reinstalling
        let existing_container_id = self.resolve_container_id(server_id, server_uuid).await;
        if !existing_container_id.is_empty() {
            info!(
                "Found existing container {} for server {}, destroying before reinstall",
                existing_container_id, server_id
            );
            self.stop_monitor_task(server_id).await;
            if self
                .runtime
                .is_container_running(&existing_container_id)
                .await
                .unwrap_or(false)
            {
                if let Err(e) = self
                    .runtime
                    .stop_container(&existing_container_id, 10)
                    .await
                {
                    warn!(
                        "Failed to stop existing container {}: {}, attempting kill",
                        existing_container_id, e
                    );
                    let _ = self
                        .runtime
                        .kill_container(&existing_container_id, "SIGKILL")
                        .await;
                }
            }
            if self.runtime.container_exists(&existing_container_id).await {
                self.runtime
                    .remove_container(&existing_container_id)
                    .await?;
            }
            self.emit_console_output(
                server_id,
                "system",
                "[Catalyst] Removed existing container.\n",
            )
            .await?;
        }

        // Backend should provide SERVER_DIR automatically
        let server_dir = environment
            .get("SERVER_DIR")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                // Fallback: create based on UUID
                format!("/tmp/catalyst-servers/{}", server_uuid)
            });

        let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240);
        let server_dir_path = PathBuf::from(&server_dir);
        self.storage_manager
            .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
            .await?;

        let server_dir_path = std::path::PathBuf::from(&server_dir);

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
            let replacement = value.as_str().unwrap_or("");
            // Shell-escape the value to prevent command injection via user-controlled env vars
            let escaped = shell_escape_value(replacement);
            final_script = final_script.replace(&placeholder, &escaped);
        }

        info!("Executing installation script");
        self.emit_console_output(server_id, "system", "[Catalyst] Starting installation...\n")
            .await?;

        // Pterodactyl eggs use /mnt/server as the install target directory.
        // Create a symlink so those scripts write into our actual server dir.
        let mnt_server = std::path::Path::new("/mnt/server");
        let created_mnt_symlink = if final_script.contains("/mnt/server") {
            if let Err(e) = tokio::fs::create_dir_all("/mnt").await {
                warn!("Failed to create /mnt: {}", e);
            }
            // Remove existing /mnt/server if present (stale symlink or dir)
            // remove_file handles symlinks; remove_dir_all handles real directories
            let _ = tokio::fs::remove_file(mnt_server).await;
            let _ = tokio::fs::remove_dir_all(mnt_server).await;
            match tokio::fs::symlink(&server_dir, mnt_server).await {
                Ok(_) => {
                    info!(
                        "Created /mnt/server -> {} symlink for Pterodactyl compatibility",
                        server_dir
                    );
                    true
                }
                Err(e) => {
                    warn!("Failed to create /mnt/server symlink: {}", e);
                    false
                }
            }
        } else {
            false
        };

        // Execute the install script on the host
        // NOTE: Script handles its own directory with cd {{SERVER_DIR}}
        let mut command = tokio::process::Command::new("bash");
        command
            .arg("-c")
            .arg(&final_script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to execute install script: {}", e)))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::InternalError("Failed to capture stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AgentError::InternalError("Failed to capture stderr".to_string()))?;

        let mut stdout_reader = tokio::io::BufReader::new(stdout).lines();
        let mut stderr_reader = tokio::io::BufReader::new(stderr).lines();
        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();
        let mut stdout_done = false;
        let mut stderr_done = false;

        while !stdout_done || !stderr_done {
            tokio::select! {
                line = stdout_reader.next_line(), if !stdout_done => {
                    match line {
                        Ok(Some(entry)) => {
                            let payload = format!("{}\n", entry);
                            stdout_buffer.push_str(&payload);
                            self.emit_console_output(server_id, "stdout", &payload).await?;
                        }
                        Ok(None) => stdout_done = true,
                        Err(err) => {
                            stdout_done = true;
                            error!("Failed to read install stdout: {}", err);
                        }
                    }
                }
                line = stderr_reader.next_line(), if !stderr_done => {
                    match line {
                        Ok(Some(entry)) => {
                            let payload = format!("{}\n", entry);
                            stderr_buffer.push_str(&payload);
                            self.emit_console_output(server_id, "stderr", &payload).await?;
                        }
                        Ok(None) => stderr_done = true,
                        Err(err) => {
                            stderr_done = true;
                            error!("Failed to read install stderr: {}", err);
                        }
                    }
                }
            }
        }

        let status = child.wait().await.map_err(|e| {
            AgentError::IoError(format!("Failed to wait for install script: {}", e))
        })?;

        if !status.success() {
            // Clean up /mnt/server symlink on failure too
            if created_mnt_symlink {
                let _ = tokio::fs::remove_file(mnt_server).await;
            }
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
            // The fourth argument is an optional metadata/progress payload for the state update;
            // we pass None here because the install failed and there is no additional data to attach.
            self.emit_server_state_update(server_id, "error", Some(reason.clone()), None, None)
                .await?;
            return Err(AgentError::InstallationError(format!(
                "Install script failed: {}",
                reason
            )));
        }

        // Clean up /mnt/server symlink
        if created_mnt_symlink {
            let _ = tokio::fs::remove_file(mnt_server).await;
            info!("Removed /mnt/server symlink");
        }

        if stdout_buffer.trim().is_empty() && stderr_buffer.trim().is_empty() {
            self.emit_console_output(server_id, "system", "[Catalyst] Installation complete.\n")
                .await?;
        }

        self.ensure_hytale_runtime_permissions(server_id, template, &server_dir)
            .await?;

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
        let mut child = self.runtime.spawn_log_stream(container_id).await?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::InternalError("Failed to capture stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AgentError::InternalError("Failed to capture stderr".to_string()))?;

        let mut stdout_reader = tokio::io::BufReader::new(stdout).lines();
        let mut stderr_reader = tokio::io::BufReader::new(stderr).lines();
        let mut stdout_done = false;
        let mut stderr_done = false;

        while !stdout_done || !stderr_done {
            tokio::select! {
                line = stdout_reader.next_line(), if !stdout_done => {
                    match line? {
                        Some(entry) => {
                            let payload = format!("{}\n", entry);
                            self.emit_console_output(server_id, "stdout", &payload).await?;
                        }
                        None => stdout_done = true,
                    }
                }
                line = stderr_reader.next_line(), if !stderr_done => {
                    match line? {
                        Some(entry) => {
                            let payload = format!("{}\n", entry);
                            self.emit_console_output(server_id, "stderr", &payload).await?;
                        }
                        None => stderr_done = true,
                    }
                }
            }
        }

        let status = child.wait().await?;
        if !status.success() {
            warn!(
                "Log stream exited for server {} (container {}) with status {:?}",
                server_id,
                container_id,
                status.code()
            );
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

            // Get SERVER_DIR from environment
            let server_dir = environment
                .get("SERVER_DIR")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("/tmp/catalyst-servers/{}", server_uuid));

            let server_dir_path = PathBuf::from(&server_dir);
            self.storage_manager
                .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
                .await?;
            self.ensure_hytale_runtime_permissions(server_id, template, &server_dir)
                .await?;

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

            // Clean up any existing container with this name before creating a new one
            if self.runtime.container_exists(server_id).await {
                info!("Removing existing container {} before starting", server_id);
                let _ = self.runtime.remove_container(server_id).await;
            }

            // Create and start container
            self.runtime
                .create_container(crate::runtime_manager::ContainerConfig {
                    container_id: server_id,
                    image: docker_image,
                    startup_command: &final_startup_command,
                    env: &env_map,
                    memory_mb,
                    cpu_cores,
                    data_dir: &server_dir,
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

    async fn stop_server(&self, server_id: &str, container_id: String) -> AgentResult<()> {
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
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
            self.runtime.stop_container(&container_id, 30).await?;
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
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }
        info!("Killing server: {} (container {})", server_id, container_id);

        self.stop_monitor_task(server_id).await;

        self.runtime
            .kill_container(&container_id, "SIGKILL")
            .await?;

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

        let path = msg["path"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing path".to_string()))?;

        let request_id = msg["requestId"].as_str().map(|value| value.to_string());
        let result = match op_type {
            "read" => self
                .file_manager
                .read_file(server_id, path)
                .await
                .map(|data| {
                    Some(json!({ "data": base64::engine::general_purpose::STANDARD.encode(data) }))
                }),
            "write" => {
                let data = msg["data"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing data".to_string()))?;
                self.file_manager
                    .write_file(server_id, path, data)
                    .await
                    .map(|_| None)
            }
            "delete" => self
                .file_manager
                .delete_file(server_id, path)
                .await
                .map(|_| None),
            "rename" => {
                let to = msg["to"]
                    .as_str()
                    .ok_or_else(|| AgentError::InvalidRequest("Missing 'to' path".to_string()))?;
                self.file_manager
                    .rename_file(server_id, path, to)
                    .await
                    .map(|_| None)
            }
            "list" => self
                .file_manager
                .list_dir(server_id, path)
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
                let _ = w.send(Message::Text(payload.to_string())).await;
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

        let server_dir = msg["serverDir"]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(self.config.server.data_dir.as_path()).join(server_uuid)
            });
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
        w.send(Message::Text(event.to_string()))
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

        let server_dir = msg["serverDir"]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(self.config.server.data_dir.as_path()).join(server_uuid)
            });
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
        w.send(Message::Text(event.to_string()))
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
        w.send(Message::Text(event.to_string()))
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
            w.send(Message::Text(event.to_string()))
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
        w.send(Message::Text(event.to_string()))
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
            w.send(Message::Text(event.to_string()))
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
                w.send(Message::Text(event.to_string()))
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
                    w.send(Message::Text(event.to_string()))
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
                w.send(Message::Text(done_event.to_string()))
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
            w.send(Message::Text(event.to_string()))
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
        let file = tokio::fs::File::create(&backup_file).await?;
        self.active_uploads
            .write()
            .await
            .insert(request_id.to_string(), file);

        let event = json!({
            "type": "backup_upload_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string()))
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

        let mut uploads = self.active_uploads.write().await;
        let file = uploads
            .get_mut(request_id)
            .ok_or_else(|| AgentError::InvalidRequest("Unknown upload request".to_string()))?;
        file.write_all(&chunk).await?;

        let event = json!({
            "type": "backup_upload_chunk_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string()))
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
        let mut uploads = self.active_uploads.write().await;
        if let Some(mut file) = uploads.remove(request_id) {
            file.flush().await?;
        }

        let event = json!({
            "type": "backup_upload_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string()))
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
        w.send(Message::Text(event.to_string()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        result?;

        Ok(())
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
            if let Err(err) = w.send(Message::Text(msg.to_string())).await {
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
            if let Err(err) = w.send(Message::Text(msg.to_string())).await {
                error!("Failed to send console output: {}", err);
            }
        }

        Ok(())
    }

    pub async fn send_health_report(&self) -> AgentResult<()> {
        debug!("Sending health report");
        let containers = self.runtime.list_containers().await?;
        let mut system = System::new();
        system.refresh_cpu();
        system.refresh_memory();
        let cpu_percent = system.global_cpu_info().cpu_usage();
        let memory_usage_mb = system.used_memory() / 1024;
        let memory_total_mb = system.total_memory() / 1024;
        let mut disks = Disks::new_with_refreshed_list();
        disks.refresh();
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
            "containerCount": containers.len(),
            "uptimeSeconds": get_uptime(),
        });

        debug!("Health report: {}", health);

        let writer = { self.write.read().await.clone() };
        if let Some(ws) = writer {
            let mut w = ws.lock().await;
            w.send(Message::Text(health.to_string()))
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

        let container_count = containers.len();

        // Build map of running containers by name/ID
        let mut running_containers = HashSet::new();
        let mut found_uuids = Vec::new();
        for container in &containers {
            let container_name = normalize_container_name(&container.names);
            if !container_name.is_empty() {
                found_uuids.push(container_name.clone());
                if container.status.contains("Up") {
                    running_containers.insert(container_name);
                }
            }
        }

        // Report state for all known containers
        for container in containers {
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
            if let Err(err) = w.send(Message::Text(msg.to_string())).await {
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
        if let Err(err) = w.send(Message::Text(complete_msg.to_string())).await {
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
            let mut event_stream = match self.runtime.subscribe_to_all_events().await {
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

            let stdout = match event_stream.stdout.take() {
                Some(out) => out,
                None => {
                    error!("Failed to capture event stream stdout. Retrying in 10s...");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
            };

            let stderr = event_stream.stderr.take();

            // Spawn task to log stderr
            if let Some(stderr) = stderr {
                tokio::spawn(async move {
                    let mut reader = tokio::io::BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = reader.next_line().await {
                        if !line.trim().is_empty() {
                            error!("nerdctl events stderr: {}", line);
                        }
                    }
                });
            }

            let mut reader = tokio::io::BufReader::new(stdout).lines();

            // Read events line by line (JSON format)
            while let Ok(Some(line)) = reader.next_line().await {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                // Parse JSON event
                let event: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("Failed to parse event JSON: {}", e);
                        continue;
                    }
                };

                // Extract container name and event type
                let container_name = event
                    .get("Actor")
                    .and_then(|a| a.get("Attributes"))
                    .and_then(|attrs| attrs.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("");

                let event_type = event.get("status").and_then(|s| s.as_str()).unwrap_or("");

                if container_name.is_empty() || event_type.is_empty() {
                    continue;
                }

                // Only sync on state-changing events
                match event_type {
                    "start" | "die" | "stop" | "kill" | "pause" | "unpause" => {
                        debug!("Container {} event: {}", container_name, event_type);

                        // Give the container a moment to stabilize state
                        tokio::time::sleep(Duration::from_millis(100)).await;

                        // Sync this specific container's state
                        if let Err(e) = self.sync_container_state(container_name).await {
                            warn!("Failed to sync state for {}: {}", container_name, e);
                        }
                    }
                    "remove" | "destroy" => {
                        // Container has been removed - report as stopped immediately
                        debug!("Container {} removed/destroyed", container_name);
                        if let Err(e) = self.sync_removed_container_state(container_name).await {
                            warn!("Failed to sync removed state for {}: {}", container_name, e);
                        }
                    }
                    _ => {
                        // Ignore other events like "create", "exec_create", etc.
                    }
                }
            }

            // Stream ended, restart
            warn!("Global event stream ended, restarting in 5s...");
            let _ = event_stream.wait().await;
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
        w.send(Message::Text(msg.to_string()))
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
        w.send(Message::Text(msg.to_string()))
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
            if !container.status.contains("Up") {
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
                    match w.send(Message::Text(payload.to_string())).await {
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
