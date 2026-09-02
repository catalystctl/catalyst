//! Server install, start, stop, kill, delete, and auto-restart logic.

use super::*;

impl WebSocketHandler {
    pub(crate) async fn spawn_health_checker(&self) {
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
                                         // Distinguish unhealthy from running so the panel can surface failures.
                    let status = if healthy { "running" } else { "unhealthy" };
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

    fn is_steamcmd_restart(stdout: &str, stderr: &str) -> bool {
        let combined = format!("{} {}", stdout, stderr);
        combined.contains("Restarting steamcmd")
            || combined.contains("Restarting SteamCMD")
            || (combined.contains("steamcmd.sh") && combined.contains("Restarting"))
    }

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
                    let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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
                    let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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
                            let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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
                            let (lines, trailing) = shell_utils::split_terminal_lines(new_text);
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

    pub(crate) async fn install_server(&self, msg: &Value) -> AgentResult<()> {
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
        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
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
        if let Ok(actual_mb) = self.storage_manager.image_quota_mb(server_uuid).await {
            self.emit_console_output(
                server_id,
                "system",
                &format!("[Catalyst] Disk image is {actual_mb} MB (requested {disk_mb} MB).\n"),
            )
            .await?;
        }

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

        // Debug: log raw install script for troubleshooting
        // Using debug! (not info!) because the substituted script body contains
        // secrets (passwords, API keys) that should never be written to disk
        // at the default info log level.
        debug!("[DEBUG] install_server: raw install_script (first 500 chars):\n---BEGIN RAW---\n{}---END RAW---",
            if install_script.len() > 500 { format!("{}... [truncated, total {} bytes]", &install_script[..500], install_script.len()) } else { install_script.to_string() }
        );
        debug!(
            "[DEBUG] install_server: environment keys: {:?}",
            environment.keys().collect::<Vec<_>>()
        );

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
            let escaped = shell_utils::shell_escape_value(replacement);
            final_script = final_script.replace(&placeholder, &escaped);
        }

        // Get the install image from template (fallback to Alpine if not specified)
        let install_image = template
            .get("installImage")
            .and_then(|v| v.as_str())
            .unwrap_or("alpine:3.19");

        info!(
            "[DEBUG] install_server: install_image from template: {:?}",
            template.get("installImage")
        );
        info!(
            "[DEBUG] install_server: resolved install_image: {}",
            install_image
        );
        info!(
            "[DEBUG] install_server: host_server_dir: {}",
            host_server_dir
        );
        // Using debug! (not info!) because the substituted script body contains
        // secrets (passwords, API keys) that should never be written to disk
        // at the default info log level.
        debug!("[DEBUG] install_server: final_script (first 500 chars after var substitution):\n---BEGIN FINAL---\n{}---END FINAL---",
            if final_script.len() > 500 { format!("{}... [truncated, total {} bytes]", &final_script[..500], final_script.len()) } else { final_script.clone() }
        );

        // Convert environment from Map<String, Value> to HashMap<String, String>
        let mut env_map = HashMap::new();
        for (key, value) in environment {
            if let Some(s) = value.as_str() {
                env_map.insert(key.clone(), s.to_string());
            }
        }
        env_map.insert("HOST_SERVER_DIR".to_string(), host_server_dir.clone());
        env_map.insert("SERVER_DIR".to_string(), CONTAINER_SERVER_DIR.to_string());

        // Wings always provides these builtins to install containers. Mirror them
        // from the live allocation so $SERVER_MEMORY / $SERVER_PORT / $SERVER_IP
        // work even when the panel omitted them from the template variable list.
        let memory_mb = msg["allocatedMemoryMb"].as_u64().unwrap_or(1024);
        let primary_port = msg["primaryPort"].as_u64().unwrap_or(0);
        env_map
            .entry("SERVER_MEMORY".to_string())
            .or_insert_with(|| memory_mb.to_string());
        env_map
            .entry("MEMORY".to_string())
            .or_insert_with(|| memory_mb.to_string());
        if primary_port > 0 {
            env_map
                .entry("SERVER_PORT".to_string())
                .or_insert_with(|| primary_port.to_string());
            env_map
                .entry("PORT".to_string())
                .or_insert_with(|| primary_port.to_string());
        }
        env_map
            .entry("SERVER_IP".to_string())
            .or_insert_with(|| "0.0.0.0".to_string());
        env_map
            .entry("SERVER_UUID".to_string())
            .or_insert_with(|| server_uuid.to_string());
        env_map
            .entry("P_SERVER_UUID".to_string())
            .or_insert_with(|| server_uuid.to_string());
        env_map
            .entry("UUID".to_string())
            .or_insert_with(|| server_uuid.to_string());
        env_map
            .entry("P_SERVER_LOCATION".to_string())
            .or_insert_with(|| "catalyst".to_string());
        env_map
            .entry("TZ".to_string())
            .or_insert_with(|| "UTC".to_string());
        env_map
            .entry("HOME".to_string())
            .or_insert_with(|| CONTAINER_SERVER_DIR.to_string());

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
            let combined = format!("{stdout_buffer}\n{stderr_buffer}");
            let mut reason = if !stderr_trimmed.is_empty() {
                stderr_trimmed.to_string()
            } else if !stdout_trimmed.is_empty() {
                stdout_trimmed.to_string()
            } else {
                "Install script failed".to_string()
            };
            if combined.contains("0x202") {
                reason = format!(
                    "SteamCMD 0x202: disk write failed. Catalyst gives each server a loop-mounted quota (default 10 GB). CS2 needs about 40 GB. Resize the server disk and reinstall. ({reason})"
                );
            }
            info!(
                "[DEBUG] install_server FAILED: exit_code={}, stdout_len={}, stderr_len={}, reason='{}'",
                exit_code, stdout_buffer.len(), stderr_buffer.len(), reason
            );
            if !stdout_buffer.is_empty() {
                info!(
                    "[DEBUG] install_server stdout (last 500 chars): {}",
                    if stdout_buffer.len() > 500 {
                        stdout_buffer
                            .chars()
                            .skip(stdout_buffer.len() - 500)
                            .collect::<String>()
                    } else {
                        stdout_buffer.clone()
                    }
                );
            }
            if !stderr_buffer.is_empty() {
                info!(
                    "[DEBUG] install_server stderr (last 500 chars): {}",
                    if stderr_buffer.len() > 500 {
                        stderr_buffer
                            .chars()
                            .skip(stderr_buffer.len() - 500)
                            .collect::<String>()
                    } else {
                        stderr_buffer.clone()
                    }
                );
            }
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

    pub(crate) async fn reinstall_server(&self, msg: &Value) -> AgentResult<()> {
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
        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        if server_dir.exists() {
            let mut entries = tokio::fs::read_dir(&server_dir).await.map_err(|e| {
                AgentError::IoError(format!("Failed to read server directory: {}", e))
            })?;
            while let Some(entry) = entries.next_entry().await.map_err(|e| {
                AgentError::IoError(format!("Failed to read directory entry: {}", e))
            })? {
                let path = entry.path();
                // Use symlink_metadata so we don't follow links into unexpected trees.
                let meta = tokio::fs::symlink_metadata(&path).await.map_err(|e| {
                    AgentError::IoError(format!("Failed to stat {}: {}", path.display(), e))
                })?;
                if meta.is_dir() {
                    tokio::fs::remove_dir_all(&path).await.map_err(|e| {
                        AgentError::IoError(format!(
                            "Failed to remove dir {}: {}",
                            path.display(),
                            e
                        ))
                    })?;
                } else {
                    // Files and symlinks: remove_file, never remove_dir_all.
                    tokio::fs::remove_file(&path).await.map_err(|e| {
                        AgentError::IoError(format!("Failed to remove {}: {}", path.display(), e))
                    })?;
                }
            }
            self.emit_console_output(server_id, "system", "[Catalyst] Server data wiped.\n")
                .await?;
        }

        // Run the install script (same as install_server)
        self.install_server(msg).await
    }

    pub(crate) async fn rebuild_server(&self, msg: &Value) -> AgentResult<()> {
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

    pub(crate) async fn start_server_with_details(&self, msg: &Value) -> AgentResult<()> {
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
            shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
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

            // Wings builtins + Catalyst aliases for startup command substitution.
            env_map.insert("MEMORY".to_string(), memory_mb.to_string());
            env_map.insert("SERVER_MEMORY".to_string(), memory_mb.to_string());
            env_map.insert("PORT".to_string(), primary_port.to_string());
            env_map.insert("SERVER_PORT".to_string(), primary_port.to_string());
            env_map
                .entry("SERVER_IP".to_string())
                .or_insert_with(|| "0.0.0.0".to_string());
            env_map
                .entry("SERVER_UUID".to_string())
                .or_insert_with(|| server_uuid.to_string());
            env_map
                .entry("P_SERVER_UUID".to_string())
                .or_insert_with(|| server_uuid.to_string());
            env_map
                .entry("UUID".to_string())
                .or_insert_with(|| server_uuid.to_string());
            env_map
                .entry("P_SERVER_LOCATION".to_string())
                .or_insert_with(|| "catalyst".to_string());
            env_map
                .entry("TZ".to_string())
                .or_insert_with(|| "UTC".to_string());
            env_map
                .entry("HOME".to_string())
                .or_insert_with(|| CONTAINER_SERVER_DIR.to_string());

            // Keep GAME_PORT in sync when the egg defines it.
            if env_map.contains_key("GAME_PORT") {
                env_map.insert("GAME_PORT".to_string(), primary_port.to_string());
            }

            // `MEMORY_XMS` from the panel is an operator override. Eggs that
            // use {{MEMORY_XMS}} without a value get Paper's 128M default.
            // Do not auto-fill 50% of allocation — that commits a huge heap
            // at boot (unlike Pterodactyl's -Xms128M).
            let xms_from_panel = env_map
                .get("MEMORY_XMS")
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|v| *v > 0);
            let xms_percent = env_map
                .get("MEMORY_XMS_PERCENT")
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|v| *v > 0 && *v <= 100);
            if xms_from_panel.is_none() {
                env_map.insert(
                    "MEMORY_XMS".to_string(),
                    crate::shell_utils::JAVA_DEFAULT_XMS_MB.to_string(),
                );
            }

            // Replace all {{VARIABLE}} placeholders.
            // Values are inserted RAW (not shell-escaped) because eggs commonly
            // embed them inside larger tokens (e.g. -Xmx{{SERVER_MEMORY}}M).
            // Shell-escaping each value would break those tokens ('2048'M).
            // Defense-in-depth against injection is handled by the panel's
            // variable validation + the fact that the full command is passed
            // as a single argv element to sh -c / image entrypoint.
            for (key, value) in &env_map {
                let placeholder = format!("{{{{{}}}}}", key);
                final_startup_command = final_startup_command.replace(&placeholder, value);
            }

            // Some templates use bash-style arithmetic tests like ((1)); convert for /bin/sh.
            final_startup_command = shell_utils::normalize_startup_for_sh(&final_startup_command);

            // ── Java: advertised allocation is the heap; cgroup is larger ──────────
            // Operators who set Memory=2GB expect -Xmx2G, not 1.5G. Off-heap
            // (Direct defaults to Xmx, metaspace, stacks, glibc arenas) is added
            // to the cgroup instead of stolen from the heap. _JAVA_OPTIONS is
            // appended last by HotSpot and overrides CLI / @argfiles.
            let mut container_memory_mb = memory_mb;
            let java_fix_enabled =
                env_map.get("CATALYST_JAVA_MEMORY_FIX").map(|v| v.as_str()) != Some("0");
            let is_java = crate::shell_utils::looks_like_java(&final_startup_command, docker_image);
            if java_fix_enabled && is_java {
                let requested_heap = crate::shell_utils::parse_xmx_mb(&final_startup_command);
                let literal_xms = crate::shell_utils::parse_xms_mb(startup_command);
                let requested_xms = xms_from_panel.or_else(|| {
                    xms_percent.map(|pct| (memory_mb * pct / 100).max(1))
                }).or(literal_xms);
                let plan = crate::shell_utils::plan_java_memory(
                    memory_mb,
                    requested_heap,
                    requested_xms,
                );
                if memory_mb >= 256 && plan.heap_mb >= 128 {
                    let existing = env_map.get("_JAVA_OPTIONS").cloned().unwrap_or_default();
                    let injected = plan.java_options();
                    let merged = if existing.trim().is_empty() {
                        injected
                    } else {
                        format!("{} {}", existing.trim(), injected)
                    };
                    env_map.insert("_JAVA_OPTIONS".to_string(), merged);
                    env_map
                        .entry("MALLOC_ARENA_MAX".to_string())
                        .or_insert_with(|| "2".to_string());
                    final_startup_command = crate::shell_utils::normalize_java_heap_args(
                        &final_startup_command,
                    );
                    container_memory_mb = plan.cgroup_mb;
                    info!(
                        "Java memory plan: heap {}M xms {}M direct {}M metaspace {}M cgroup {}M (allocation {}M, orig startup: {})",
                        plan.heap_mb,
                        plan.xms_mb,
                        plan.direct_mb,
                        plan.metaspace_mb,
                        plan.cgroup_mb,
                        memory_mb,
                        startup_command
                    );
                    let _ = self
                        .emit_console_output(
                            server_id,
                            "system",
                            &format!(
                                "[Catalyst] JVM heap -Xmx{}M (server Memory {}M); container {}M to fit off-heap (direct {}M, metaspace {}M)\n",
                                plan.heap_mb, memory_mb, plan.cgroup_mb, plan.direct_mb, plan.metaspace_mb
                            ),
                        )
                        .await;
                }
            }

            info!("Final startup command: {}", final_startup_command);

            // Apply Pterodactyl egg config.files (properties/json/ini/yaml/xml/file)
            // before the container starts — same timing as Wings UpdateConfigurationFiles.
            {
                let mut specs = crate::config_parser::specs_from_template(template);
                let paper_like = is_java
                    || lower_image.contains("minecraft")
                    || lower_image.contains("purpur")
                    || lower_image.contains("paper")
                    || lower_image.contains("folia")
                    || lower_image.contains("spigot")
                    || lower_image.contains("bukkit");
                if paper_like {
                    specs.extend(crate::config_parser::paper_disk_space_specs());
                    // Paper's getUsableSpace() on a missing world/ can return 0
                    // even when /data has tens of GB. Create it on the loop FS.
                    let world_dir = server_dir_path.join("world");
                    if let Err(e) = tokio::fs::create_dir_all(&world_dir).await {
                        warn!("Failed to create world dir {}: {}", world_dir.display(), e);
                    }
                    let _ = self
                        .emit_console_output(
                            server_id,
                            "system",
                            "[Catalyst] Paper/Purpur disk-space exit disabled (Java often reports 0 bytes free on loop mounts).\n",
                        )
                        .await;
                }
                if !specs.is_empty() {
                    let primary_ip = env_map
                        .get("SERVER_IP")
                        .cloned()
                        .unwrap_or_else(|| "0.0.0.0".to_string());
                    let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240);
                    let cfg_ctx = crate::config_parser::ConfigResolveContext {
                        env: env_map.clone(),
                        primary_port,
                        primary_ip,
                        server_uuid: server_uuid.to_string(),
                        server_memory_mb: memory_mb,
                        server_disk_mb: disk_mb,
                        docker_interface: "0.0.0.0".to_string(),
                    };
                    if let Err(e) = crate::config_parser::apply_configuration_files(
                        &server_dir_path,
                        &specs,
                        &cfg_ctx,
                    )
                    .await
                    {
                        warn!(
                            "Config file application reported error for {}: {}",
                            server_uuid, e
                        );
                    }
                    // Ensure runtime user can still write after config rewrites.
                    if let Err(e) = chown_to_container_user(&server_dir_path).await {
                        warn!(
                            "Failed to chown after config apply for {}: {}",
                            server_uuid, e
                        );
                    }
                }
            }

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
                    memory_mb: container_memory_mb,
                    memory_reservation_mb: if container_memory_mb > memory_mb {
                        memory_mb
                    } else {
                        0
                    },
                    swap_mb,
                    cpu_cores,
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
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:container_health",
                        &format!("Failed to check container state for {}: {}", server_id, err),
                        None,
                        None,
                    ).await;
                    false
                }
            };
            if !is_running {
                let exit_code = self
                    .runtime
                    .get_container_exit_code(server_id)
                    .await
                    .unwrap_or(None);
                let reason = if exit_code == Some(137) {
                    format!("Container exited immediately with code 137 (OOM killed — cgroup {}M limit exceeded; JVM off-heap counts toward the limit — increase Memory allocation)", memory_mb)
                } else {
                    match exit_code {
                        Some(code) => format!("Container exited immediately with code {}", code),
                        None => "Container exited immediately after start".to_string(),
                    }
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
                    .insert(server_id.to_string(), {
                        // Store a restart plan with real environment values so
                        // auto-restart can recreate the container correctly.
                        // Drop installScript (not needed for restart). Do NOT
                        // redact env values here — redaction belongs in logs only.
                        let mut restart_msg = msg.clone();
                        if let Some(obj) = restart_msg.as_object_mut() {
                            obj.remove("installScript");
                        }
                        restart_msg
                    });
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

    pub(crate) async fn start_server(
        &self,
        server_id: &str,
        container_id: String,
    ) -> AgentResult<()> {
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

    pub(crate) async fn stop_server(
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

    pub(crate) async fn kill_server(
        &self,
        server_id: &str,
        container_id: String,
    ) -> AgentResult<()> {
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

    pub(crate) async fn delete_server(
        &self,
        server_id: &str,
        server_uuid: &str,
    ) -> AgentResult<()> {
        // SECURITY: these identifiers are joined into filesystem paths
        // (data_dir/<id>) and used in remove_dir_all below. An absolute or
        // traversal id would escape the data dir and delete arbitrary host
        // directories as root (Path::join replaces the base on "/..." and
        // "../" escapes it). Validate both as single safe segments.
        crate::shell_utils::validate_safe_path_segment(server_id, "serverId")?;
        crate::shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
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

        // Clean up server data directory + disk image (unmount first if needed)
        let data_dir = self.config.server.data_dir.clone();
        for id in &[server_id, server_uuid] {
            if !id.is_empty() {
                let server_dir = std::path::Path::new(&data_dir).join(id);
                if let Err(e) = self
                    .storage_manager
                    .destroy_server_storage(id, &server_dir)
                    .await
                {
                    warn!(
                        "Failed to destroy storage for {}: {}",
                        server_dir.display(),
                        e
                    );
                } else {
                    info!("Removed server storage: {}", server_dir.display());
                }
            }
        }

        info!("Server {} deleted successfully", server_id);
        Ok(())
    }
}
