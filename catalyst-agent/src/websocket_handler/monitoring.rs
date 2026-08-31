//! Health reporting, resource stats, reconciliation, and event monitoring.

use super::*;

impl WebSocketHandler {
    pub async fn send_health_report(&self) -> AgentResult<()> {
        debug!("Sending health report");
        let containers = self.runtime.list_containers().await?;
        // First sample after System::new() is unreliable (no prior baseline).
        // Double-refresh with a short sleep so CPU % is meaningful.
        let mut system = System::new();
        system.refresh_cpu_all();
        tokio::time::sleep(Duration::from_millis(200)).await;
        system.refresh_cpu_all();
        system.refresh_memory();
        let cpu_percent = sanitize_cpu_percent(system.global_cpu_usage());
        // sysinfo reports memory in bytes; convert to MiB.
        let memory_usage_mb = system.used_memory() / (1024 * 1024);
        let memory_total_mb = system.total_memory() / (1024 * 1024);

        // Disk usage is measured on the filesystem that actually holds the
        // server data dir. Summing every mount double/triple-counts loop
        // images, bind mounts, tmpfs, and overlayfs stacked on the same
        // underlying device.
        let (disk_usage_mb, disk_total_mb) = data_dir_disk_usage_mb(&self.config.server.data_dir);

        // Aggregate host network totals across physical interfaces only.
        // Virtual interfaces (lo, veth, bridges) mirror container traffic and
        // would inflate the counters several times over.
        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh(true);
        let mut total_network_rx_bytes: u64 = 0;
        let mut total_network_tx_bytes: u64 = 0;
        for (name, data) in networks.list() {
            if !is_physical_interface(name) {
                continue;
            }
            total_network_rx_bytes += data.total_received();
            total_network_tx_bytes += data.total_transmitted();
        }

        let health = HealthReport {
            ty: "health_report",
            nodeId: &self.config.server.node_id,
            timestamp: chrono::Utc::now().timestamp_millis(),
            agentVersion: env!("CARGO_PKG_VERSION"),
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
        for container in &containers {
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

            debug!(
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

        // Send discovered containers info for auto-import feature
        let mut discovered = Vec::new();
        for c in containers.iter().filter(|c| c.managed) {
            let inspect = self.runtime.inspect_container(&c.id).await.ok().flatten();
            discovered.push(DiscoveredServer {
                containerId: &c.id,
                image: &c.image,
                status: &c.status,
                labels: &c.labels,
                networkMode: inspect.as_ref().map(|i| i.network_mode.clone()),
                memoryLimitMb: inspect.as_ref().and_then(|i| {
                    if i.memory_limit_bytes > 0 {
                        Some((i.memory_limit_bytes as u64) / (1024 * 1024))
                    } else {
                        None
                    }
                }),
                cpuCores: inspect.as_ref().and_then(|i| {
                    if i.cpu_quota > 0 && i.cpu_period > 0 {
                        Some((i.cpu_quota as u64) / (i.cpu_period as u64))
                    } else {
                        None
                    }
                }),
                startupCommand: inspect
                    .as_ref()
                    .map(|i| i.startup_command.clone())
                    .filter(|s| !s.is_empty()),
                envVarNames: inspect
                    .as_ref()
                    .map(|i| i.env_var_names.clone())
                    .unwrap_or_default(),
            });
        }

        if !discovered.is_empty() {
            let discovered_msg = DiscoveredServers {
                ty: "discovered_servers",
                nodeId: &self.config.server.node_id,
                containers: discovered,
                timestamp: chrono::Utc::now().timestamp_millis(),
            };
            let discovered_text = serde_json::to_string(&discovered_msg).unwrap_or_default();

            if let Err(err) = w.send(Message::Text(discovered_text.into())).await {
                warn!("Failed to send discovered servers: {}", err);
            }
        }

        info!(
            "Server state reconciliation complete: {} containers checked",
            container_count
        );
        Ok(())
    }

    pub(crate) async fn monitor_global_events(&self) -> AgentResult<()> {
        info!("Starting global container event monitor for instant state syncing");

        let mut retry_delay = Duration::from_secs(5);
        let mut attempt = 0u32;
        let mut consecutive_failures = 0u32;
        let mut diagnosed = false;
        let mut events_service_broken = false;
        let mut ctr_fallback_active = false;
        let mut ctr_fallback_failures = 0u32;
        loop {
            attempt += 1;
            debug!(
                "monitor_global_events: attempt {} starting (retry_delay={:?})",
                attempt, retry_delay
            );

            if events_service_broken {
                warn!(
                    "Event monitor DISABLED: all event sources exhausted. \
                     Falling back to periodic reconciliation (30-sec interval)."
                );
                self.report_error(
                    ErrorLevel::Critical,
                    "agent:event_monitor_disabled",
                    "Event monitor disabled — all event sources exhausted. \
                     Check that ctr is installed and containerd is healthy.",
                    None,
                    None,
                )
                .await;
                return Ok(());
            }

            // ── ctr subprocess monitor ──
            // Once activated, skip gRPC entirely; stay in the ctr path.
            if ctr_fallback_active {
                debug!("monitor_global_events: using ctr events subprocess");
                match self.runtime.start_ctr_events().await {
                    Ok((ctr_guard, ctr_lines)) => {
                        ctr_fallback_failures = 0;
                        // Store PID for explicit cleanup on agent shutdown.
                        *self.ctr_event_pid.lock().await = ctr_guard.pid();
                        info!("ctr events subprocess started — real-time event monitoring");
                        let mut lines = ctr_lines;
                        loop {
                            match lines.next_line().await {
                                Ok(Some(line)) => {
                                    if let Some(ce) = parse_ctr_event_line(&line) {
                                        if !ce.container_id.starts_with("cm")
                                            && !ce.container_id.starts_with("catalyst-")
                                        {
                                            continue;
                                        }
                                        match ce.topic.as_str() {
                                            "/tasks/start" | "/tasks/exit" | "/tasks/paused" => {
                                                tokio::time::sleep(Duration::from_millis(100))
                                                    .await;
                                                if let Err(e) = self
                                                    .sync_container_state(&ce.container_id)
                                                    .await
                                                {
                                                    warn!(
                                                        "ctr events: sync for {} failed: {}",
                                                        ce.container_id, e
                                                    );
                                                }
                                            }
                                            "/containers/delete" => {
                                                if let Err(e) = self
                                                    .sync_removed_container_state(&ce.container_id)
                                                    .await
                                                {
                                                    warn!("ctr events: sync-removed for {} failed: {}", ce.container_id, e);
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                Ok(None) => break,
                                Err(e) => {
                                    warn!("ctr events: line read error: {}", e);
                                    break;
                                }
                            }
                        }
                        // ctr exited — drop the guard (fires SIGKILL if still alive),
                        // then restart immediately.
                        drop(ctr_guard);
                        warn!("ctr events subprocess exited, restarting in 5s...");
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                    Err(ctr_err) => {
                        ctr_fallback_failures += 1;
                        error!(
                            "ctr events: spawn failed (failure {}/{}): {}. \
                             Retrying in {:?}...",
                            ctr_fallback_failures,
                            MAX_EVENT_SUBSCRIBE_FAILURES,
                            ctr_err,
                            retry_delay
                        );
                        if ctr_fallback_failures >= MAX_EVENT_SUBSCRIBE_FAILURES {
                            events_service_broken = true;
                            continue;
                        }
                        tokio::time::sleep(retry_delay).await;
                        retry_delay = (retry_delay * 2).min(Duration::from_secs(60));
                        continue;
                    }
                }
            }

            if consecutive_failures >= MAX_EVENT_SUBSCRIBE_FAILURES {
                warn!(
                    "gRPC Subscribe failed {} consecutive times — switching to ctr events fallback.",
                    consecutive_failures
                );
                self.report_error(
                    ErrorLevel::Warn,
                    "agent:event_monitor",
                    &format!(
                        "containerd gRPC event subscription failed {} consecutive times — degraded to ctr events subprocess fallback. State syncing continues, but check containerd health on this node.",
                        consecutive_failures
                    ),
                    None,
                    None,
                )
                .await;
                ctr_fallback_active = true;
                consecutive_failures = 0;
                continue;
            }

            // Pre-subscription health check: verify containerd is responsive
            // before attempting a long-lived event stream subscription.
            debug!("monitor_global_events: health check - calling list_containers()");
            match tokio::time::timeout(Duration::from_secs(5), self.runtime.list_containers()).await
            {
                Ok(Ok(containers)) => {
                    debug!(
                        "monitor_global_events: health check OK ({} containers)",
                        containers.len()
                    );
                }
                Ok(Err(e)) => {
                    error!(
                        "monitor_global_events: health check failed: {}. Retrying in {:?}...",
                        e, retry_delay
                    );
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(60));
                    continue;
                }
                Err(_) => {
                    error!(
                        "monitor_global_events: health check timed out after 5s. Retrying in {:?}...",
                        retry_delay
                    );
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(60));
                    continue;
                }
            }

            // Subscribe to all events
            debug!(
                "monitor_global_events: attempt {} - calling subscribe_to_all_events()",
                attempt
            );
            let event_stream = match self.runtime.subscribe_to_all_events().await {
                Ok(stream) => {
                    info!(
                        "monitor_global_events: subscription established on attempt {}",
                        attempt
                    );
                    stream
                }
                Err(e) => {
                    consecutive_failures += 1;
                    error!(
                        "monitor_global_events: subscribe failed on attempt {} (failure {}/{}): {}. Retrying in {:?}...",
                        attempt, consecutive_failures, MAX_EVENT_SUBSCRIBE_FAILURES, e, retry_delay
                    );
                    // Run diagnostic once on first failure to capture containerd version & events status
                    if !diagnosed {
                        diagnosed = true;
                        let diag_result = self.runtime.diagnose_events_service().await;
                        let report = match &diag_result {
                            Ok(r) => {
                                warn!("Event monitor diagnostic: {}", r);
                                r.clone()
                            }
                            Err(e) => {
                                warn!("Event monitor diagnostic failed: {}", e);
                                e.to_string()
                            }
                        };
                        if report.contains("UNRESPONSIVE") {
                            info!("gRPC events unresponsive — switching to ctr events subprocess fallback");
                            ctr_fallback_active = true;
                            consecutive_failures = 0; // reset so we don't trip the >= MAX guard
                            continue; // short-circuit: next iteration jumps into ctr path
                        }
                    }
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(60));
                    continue;
                }
            };

            // Reset backoff and failure counter after successful subscription
            attempt = 0;
            consecutive_failures = 0;
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
                let disk_read_mb = stats.block_read_bytes / (1024 * 1024);
                let disk_write_mb = stats.block_write_bytes / (1024 * 1024);

                // For immediate requests use a very short df timeout — stale data is fine.
                // On failure report zeros: block-IO counters measure throughput,
                // not capacity, and must never stand in for disk usage.
                let (disk_usage_mb, disk_total_mb) = match tokio::time::timeout(
                    Duration::from_secs(1),
                    self.runtime.exec(target, vec!["df", "-m", "/data"]),
                )
                .await
                {
                    Ok(Ok(output)) => parse_df_output_mb(&output).unwrap_or((0, 0)),
                    _ => (0, 0),
                };

                let payload = ResourceStats {
                    ty: "resource_stats",
                    serverUuid: target,
                    cpuPercent: cpu_percent,
                    memoryUsageMb: memory_usage_mb,
                    networkRxBytes: network_rx_bytes,
                    networkTxBytes: network_tx_bytes,
                    diskIoMb: disk_io_mb,
                    diskReadMb: Some(disk_read_mb),
                    diskWriteMb: Some(disk_write_mb),
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
                let disk_read_mb = stats.block_read_bytes / (1024 * 1024);
                let disk_write_mb = stats.block_write_bytes / (1024 * 1024);

                // Prefer real df-based filesystem usage (same as immediate stats path).
                // Fall back to block IO only if df fails/times out; total stays 0 then.
                let (disk_usage_mb, disk_total_mb) = match tokio::time::timeout(
                    Duration::from_secs(2),
                    runtime.exec(&container.id, vec!["df", "-m", "/data"]),
                )
                .await
                {
                    Ok(Ok(output)) => parse_df_output_mb(&output).unwrap_or((disk_io_mb, 0)),
                    _ => (disk_io_mb, 0),
                };

                Some(ResourceStatsEntry {
                    serverUuid: server_uuid,
                    cpuPercent: cpu_percent,
                    memoryUsageMb: memory_usage_mb,
                    networkRxBytes: network_rx_bytes,
                    networkTxBytes: network_tx_bytes,
                    diskIoMb: disk_io_mb,
                    diskReadMb: Some(disk_read_mb),
                    diskWriteMb: Some(disk_write_mb),
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
