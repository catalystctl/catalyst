//! Console I/O, log streaming, container exit handling, and EULA management.

use super::*;

impl WebSocketHandler {
    pub(crate) async fn resume_console(&self, msg: &Value) -> AgentResult<()> {
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

    pub(crate) async fn resolve_container_id(&self, server_id: &str, server_uuid: &str) -> String {
        self.resolve_console_container_id(server_id, server_uuid)
            .await
            .unwrap_or_default()
    }

    pub(crate) async fn cleanup_all_server_containers(
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
                        self.report_error(
                            ErrorLevel::Warn,
                            "agent:delete_server",
                            &format!("Failed to remove container {}: {}", container_name, e),
                            None,
                            None,
                        ).await;
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

    pub(crate) async fn stop_monitor_task(&self, server_id: &str) {
        let mut tasks = self.monitor_tasks.write().await;
        if let Some(handle) = tasks.remove(server_id) {
            handle.abort();
        }
    }

    pub(crate) async fn stop_log_streams_for_server(&self, server_id: &str) {
        let mut streams = self.active_log_streams.write().await;
        // Remove all stream keys that start with server_id:
        streams.retain(|key| !key.starts_with(&format!("{}:", server_id)));
    }

    pub(crate) async fn restart_console_streams(&self) {
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

    pub(crate) fn spawn_exit_monitor(&self, server_id: &str, container_id: &str) {
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
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:auto_restart",
                        &format!("Auto-restart failed for {}: {}", server_id, e),
                        None,
                        None,
                    ).await;
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

    pub(crate) fn spawn_log_stream(&self, server_id: &str, container_id: &str) {
        let handler = self.clone();
        let server_id = server_id.to_string();
        let container_id = container_id.to_string();
        tokio::spawn(async move {
            // Rotate logs if they exceed the size limit
            rotate_logs(&handler.config.server.console_log_dir, &container_id).await;

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
        let base = self.config.server.console_log_dir.join(container_id);
        let stdout_path = base.join("stdout");
        let stderr_path = base.join("stderr");

        // Log initial file state for diagnostics
        let stdout_exists = stdout_path.exists();
        let stderr_exists = stderr_path.exists();
        let stdout_meta = tokio::fs::metadata(&stdout_path).await.ok();
        let stderr_meta = tokio::fs::metadata(&stderr_path).await.ok();
        info!(
            "Console log stream started for server {} (container {}) — stdout: exists={} size={:?}, stderr: exists={} size={:?}",
            server_id,
            container_id,
            stdout_exists,
            stdout_meta.as_ref().map(|m| m.len()),
            stderr_exists,
            stderr_meta.as_ref().map(|m| m.len()),
        );

        let mut stdout_pos = 0u64;
        let mut stderr_pos = 0u64;
        let mut loop_count = 0u32;

        // Tail the stdout/stderr files
        loop {
            loop_count += 1;
            let running = self
                .runtime
                .is_container_running(container_id)
                .await
                .unwrap_or(false);
            let mut had_data = false;

            match tokio::fs::read_to_string(&stdout_path).await {
                Ok(content) => {
                    if (stdout_pos as usize) < content.len() {
                        let new_text = &content[stdout_pos as usize..];
                        let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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
                Err(e) => {
                    if loop_count <= 5 {
                        warn!("server {} stdout read error: {}", server_id, e);
                    }
                }
            }

            match tokio::fs::read_to_string(&stderr_path).await {
                Ok(content) => {
                    if (stderr_pos as usize) < content.len() {
                        let new_text = &content[stderr_pos as usize..];
                        let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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
                Err(e) => {
                    if loop_count <= 5 {
                        warn!("server {} stderr read error: {}", server_id, e);
                    }
                }
            }

            // Periodic status log every 50 iterations (~10 seconds) when no data
            if loop_count.is_multiple_of(50) && !had_data {
                let stdout_size = tokio::fs::metadata(&stdout_path)
                    .await
                    .ok()
                    .map(|m| m.len());
                let stderr_size = tokio::fs::metadata(&stderr_path)
                    .await
                    .ok()
                    .map(|m| m.len());
                debug!(
                    "server {} console stream alive (loop {}): running={}, stdout_size={:?}, stderr_size={:?}, stdout_pos={}, stderr_pos={}",
                    server_id, loop_count, running, stdout_size, stderr_size, stdout_pos, stderr_pos
                );
            }

            if !running {
                info!(
                    "server {} container stopped — flushing trailing console data",
                    server_id
                );
                // Container stopped — flush any trailing partial lines too
                tokio::time::sleep(Duration::from_millis(100)).await;
                if let Ok(content) = tokio::fs::read_to_string(&stdout_path).await {
                    if (stdout_pos as usize) < content.len() {
                        let new_text = &content[stdout_pos as usize..];
                        let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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
                        let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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
                info!(
                    "Console log stream ended for server {} (container {}) after {} loops",
                    server_id, container_id, loop_count
                );
                break;
            }

            tokio::time::sleep(Duration::from_millis(if had_data { 50 } else { 200 })).await;
        }

        Ok(())
    }

    pub(crate) async fn handle_console_input(&self, msg: &Value) -> AgentResult<()> {
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

}
