//! Container CRUD operations, lifecycle management, and event subscriptions.

use super::*;

impl ContainerdRuntime {
    pub async fn create_container(&self, config: ContainerConfig<'_>) -> AgentResult<String> {
        let qualified_image = Self::qualify_image_ref(config.image);
        info!(
            "Creating container: {} from image: {}",
            config.container_id, qualified_image
        );

        self.ensure_image(config.image).await?;

        // Read image's default environment variables (PATH, JAVA_HOME, etc.)
        let image_env = self.get_image_env(&qualified_image).await;
        let (image_entrypoint, image_cmd) = self.get_image_entrypoint(&qualified_image).await;

        // Prepare I/O paths
        let io_dir = self.console_log_dir.join(config.container_id);
        fs::create_dir_all(&io_dir).map_err(|e| {
            AgentError::ContainerError(format!("Failed to create I/O directory: {}", e))
        })?;
        // Restrict I/O directory to root-only to prevent cross-container reading
        set_dir_perms(&io_dir, 0o700);

        let stdin_path = io_dir.join("stdin");
        let stdout_path = io_dir.join("stdout");
        let stderr_path = io_dir.join("stderr");
        if stdin_path.exists() {
            fs::remove_file(&stdin_path).ok();
        }
        create_fifo(&stdin_path).map_err(|e| {
            AgentError::ContainerError(format!("Failed to create stdin FIFO: {}", e))
        })?;
        File::create(&stdout_path)
            .map_err(|e| AgentError::ContainerError(format!("stdout: {}", e)))?;
        File::create(&stderr_path)
            .map_err(|e| AgentError::ContainerError(format!("stderr: {}", e)))?;

        let stdin_writer = open_fifo_rdwr(&stdin_path)?;
        {
            let mut io_map = self.container_io.lock().await;
            io_map.insert(
                config.container_id.to_string(),
                ContainerIo {
                    _stdin_fifo: stdin_path.clone(),
                    _stdout_file: stdout_path.clone(),
                    _stderr_file: stderr_path.clone(),
                    stdin_writer: Some(stdin_writer),
                },
            );
        }

        // Build OCI spec
        let use_host_network = config.network_mode == Some("host");
        let spec = self.build_oci_spec(
            &config,
            &io_dir,
            use_host_network,
            &image_env,
            image_entrypoint.as_deref(),
            image_cmd.as_deref(),
        )?;
        let spec_any = Any {
            type_url: SPEC_TYPE_URL.to_string(),
            value: spec.to_string().into_bytes(),
        };

        // Prepare rootfs snapshot
        let snap_key = format!("{}-snap", config.container_id);
        self.prepare_snapshot(&qualified_image, &snap_key).await?;

        // Create container
        let container = Container {
            id: config.container_id.to_string(),
            image: qualified_image,
            labels: HashMap::from([("catalyst.managed".to_string(), "true".to_string())]),
            runtime: Some(Runtime {
                name: RUNTIME_NAME.to_string(),
                options: None,
            }),
            spec: Some(spec_any),
            snapshot_key: snap_key.clone(),
            snapshotter: "overlayfs".to_string(),
            ..Default::default()
        };
        let mut client = ContainersClient::new(self.channel.clone());
        let req = CreateContainerRequest {
            container: Some(container),
        };
        let req = with_namespace!(req, &self.namespace);
        client.create(req).await.map_err(grpc_err)?;

        // Cache cgroup path for fast stats lookups
        let cached_cg = format!("/sys/fs/cgroup/{}/{}", self.namespace, config.container_id);
        {
            let mut cg_map = self.cgroup_paths.write().await;
            cg_map.insert(config.container_id.to_string(), cached_cg);
        }

        // Get rootfs mounts and create task
        let mounts = self.get_snapshot_mounts(&snap_key).await?;
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = CreateTaskRequest {
            container_id: config.container_id.to_string(),
            stdin: stdin_path.to_string_lossy().to_string(),
            stdout: stdout_path.to_string_lossy().to_string(),
            stderr: stderr_path.to_string_lossy().to_string(),
            rootfs: mounts,
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tasks.create(req).await.map_err(|e| {
            self.cleanup_io(config.container_id);
            grpc_err(e)
        })?;
        let pid = resp.into_inner().pid;

        // Set up CNI networking before starting
        if !use_host_network {
            if let Err(e) = self
                .setup_cni_network(
                    config.container_id,
                    pid,
                    config.network_mode,
                    config.network_ip,
                    config.port,
                    config.port_bindings,
                )
                .await
            {
                warn!("CNI network setup failed: {}", e);
                let _ = self.remove_container(config.container_id).await;
                return Err(AgentError::ContainerError(format!(
                    "CNI network setup failed for {}: {}",
                    config.container_id, e
                )));
            }

            // CNI plugins may overwrite /etc/resolv.conf in the container's namespace.
            // Write our configured DNS directly into the container's /etc/resolv.conf.
            //
            // Security: Validate each DNS entry as a valid IP address before
            // interpolation to prevent shell injection via malicious DNS values.
            // Then use a heredoc with single-quoted delimiter to prevent ALL shell
            // interpretation even if validation is somehow bypassed.
            let mut validated_lines = Vec::new();
            for dns in &self.dns_servers {
                if dns.parse::<std::net::IpAddr>().is_err() {
                    warn!("Skipping invalid DNS server (not a valid IP): {}", dns);
                    continue;
                }
                validated_lines.push(format!("nameserver {}", dns));
            }
            validated_lines.push("options attempts:3 timeout:2".to_string());
            let resolv_content = validated_lines.join("\n");

            // Use heredoc with single-quoted delimiter to prevent shell interpretation.
            // The single quotes around CATALYST_RESOLV_EOF tell the shell to treat
            // the heredoc body as literal text — no variable expansion, command
            // substitution, or escape processing.
            let resolv_dest = "/etc/resolv.conf";
            let nsenter_output = Command::new("nsenter")
                .args(["-t", &pid.to_string(), "-m", "--", "sh", "-c"])
                .arg(format!(
                    "cat > {} << 'CATALYST_RESOLV_EOF'\n{}\nCATALYST_RESOLV_EOF",
                    resolv_dest, resolv_content
                ))
                .output()
                .await;

            match nsenter_output {
                Ok(output) if output.status.success() => {
                    info!(
                        "Updated resolv.conf in container {} with DNS: {:?}",
                        config.container_id, self.dns_servers
                    );
                }
                Ok(output) => {
                    warn!(
                        "Failed to update resolv.conf in container {}: {}",
                        config.container_id,
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
                Err(e) => {
                    warn!(
                        "Failed to run nsenter for resolv.conf update in {}: {}",
                        config.container_id, e
                    );
                }
            }
        }

        // Start task
        let req = StartRequest {
            container_id: config.container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(|e| {
            self.cleanup_io(config.container_id);
            grpc_err(e)
        })?;

        info!(
            "Container created and started: {} (pid {})",
            config.container_id, pid
        );

        // Configure firewall
        if let Ok(ip) = self.get_container_ip(config.container_id).await {
            if !ip.is_empty() {
                let ports: Vec<u16> = if config.port_bindings.is_empty() {
                    vec![config.port]
                } else {
                    config.port_bindings.values().copied().collect()
                };
                for p in ports {
                    if let Err(e) =
                        FirewallManager::allow_port(p, "tcp", &ip, config.server_id).await
                    {
                        error!("Firewall config failed for port {}: {}", p, e);
                        // Non-fatal but security-relevant: the container is running while
                        // its port rule could not be applied. Surface on the panel.
                        self.report_runtime_error(
                            crate::error_reporter::ErrorLevel::Warn,
                            "agent:firewall",
                            format!(
                                "Firewall config failed for port {} on server {}: {}",
                                p, config.server_id, e
                            ),
                            Some(serde_json::json!({ "serverId": config.server_id, "port": p })),
                        );
                    }
                }
            }
        }

        Ok(config.container_id.to_string())
    }

    pub async fn spawn_installer_container(
        &self,
        image: &str,
        script: &str,
        env: &HashMap<String, String>,
        data_dir: &str,
    ) -> AgentResult<InstallerHandle> {
        let container_id = format!("catalyst-installer-{}", uuid::Uuid::new_v4());
        let qualified_image = Self::qualify_image_ref(image);
        info!(
            "Spawning installer {} with image: {}",
            container_id, qualified_image
        );
        self.ensure_image(image).await?;

        let io_dir = self.console_log_dir.join(&container_id);
        fs::create_dir_all(&io_dir)
            .map_err(|e| AgentError::ContainerError(format!("mkdir: {}", e)))?;
        // Restrict I/O directory to root-only
        set_dir_perms(&io_dir, 0o700);
        let stdin_path = io_dir.join("stdin");
        let stdout_path = io_dir.join("stdout");
        let stderr_path = io_dir.join("stderr");
        if stdin_path.exists() {
            fs::remove_file(&stdin_path).ok();
        }
        create_fifo(&stdin_path).map_err(|e| AgentError::ContainerError(format!("fifo: {}", e)))?;
        File::create(&stdout_path)
            .map_err(|e| AgentError::ContainerError(format!("stdout: {}", e)))?;
        File::create(&stderr_path)
            .map_err(|e| AgentError::ContainerError(format!("stderr: {}", e)))?;

        // Create /etc/resolv.conf for DNS resolution using configured DNS servers
        let resolv_path = io_dir.join("resolv.conf");
        let mut resolv_content = String::new();
        for dns in &self.dns_servers {
            resolv_content.push_str(&format!("nameserver {}\n", dns));
        }
        resolv_content.push_str("options attempts:3 timeout:2\n");
        info!(
            "Installer {} resolv.conf:\n{}",
            container_id, resolv_content
        );
        fs::write(&resolv_path, &resolv_content)
            .map_err(|e| AgentError::ContainerError(format!("resolv.conf: {}", e)))?;

        let mut env_list = vec![
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
            "TERM=xterm".to_string(),
        ];
        for (k, v) in env {
            env_list.push(format!("{}={}", k, v));
        }
        // Install containers need broader capabilities than runtime containers because
        // install scripts commonly fix file ownership/permissions for the runtime user.
        let caps = [
            "CAP_CHOWN",
            "CAP_FOWNER",
            "CAP_DAC_OVERRIDE",
            "CAP_SETUID",
            "CAP_SETGID",
            "CAP_NET_BIND_SERVICE",
        ];

        // Build mounts including DNS resolv.conf and a writable /tmp tmpfs.
        // NOTE: noexec is intentionally NOT added here. Many Pterodactyl install
        // scripts download and execute binaries from /tmp. Adding noexec would
        // break these scripts. If future hardening requires noexec, an alternative
        // executable tmpfs mount at /opt/install-tmp must be provided.
        // Also mount /home/container for install containers: some eggs and tools
        // hardcode that Pterodactyl path even during install (not only runtime).
        let mut mounts = base_mounts(data_dir);
        mounts.push(serde_json::json!({
            "destination": "/home/container",
            "type": "bind",
            "source": data_dir,
            "options": ["rbind", "rw"]
        }));
        mounts.push(serde_json::json!({
            "destination": "/etc/resolv.conf",
            "type": "bind",
            "source": resolv_path.to_string_lossy().to_string(),
            "options": ["rbind", "rw"]
        }));
        mounts.push(serde_json::json!({
            "destination": "/tmp",
            "type": "tmpfs",
            "source": "tmpfs",
            "options": ["nosuid", "nodev", "mode=1777"]
        }));

        // Detect the correct shell interpreter for the install script.
        //
        // Pterodactyl install scripts use #!/bin/bash or #!/bin/ash shebangs but the
        // OCI spec uses `args` directly, so the shebang is ignored.
        //
        // Problem: On Debian-based images, /bin/sh is dash (POSIX), not bash.
        // Many Pterodactyl scripts use bash-isms like [[ ]] that fail under dash.
        // On Alpine-based images, /bin/sh is busybox ash which supports [[ ]].
        //
        // Solution: Use bash on Debian images (where dash lacks [[ ]]),
        // use sh on Alpine images (where busybox ash supports [[ ]]),
        // and fall back to sh otherwise (POSIX compatibility).
        let (interp, interp_arg) = detect_install_interpreter(image, script);
        info!(
            "Install script interpreter: {} {} (image: {})",
            interp, interp_arg, image
        );

        // Wrap the install script with Catalyst compatibility shims.
        //
        // IMPORTANT: Do NOT inject `set -e` for the user's install script.
        // Pterodactyl does not run install scripts with `set -e`, and many scripts
        // rely on commands that return non-zero being handled gracefully (e.g.,
        // `grep -m1 true` in backtick substitution, conditional `curl` pipelines).
        // Injecting `set -e` causes these scripts to exit silently with code 1
        // and no output, making debugging impossible.
        //
        // We use `set -e` only for the wrapper preamble (symlink setup), then
        // disable it before the user's script runs. After the script finishes,
        // we capture its exit code and re-enable `set -e` for the chown step,
        // then exit with the script's exit code so the agent can detect failure.
        //
        // This matches Pterodactyl's behavior: install scripts run without
        // `set -e`, and the final exit code determines success/failure.
        let wrapped_script = format!(
            "__catalyst_on_exit() {{ __e=$?; chown -R 1000:1000 /data 2>/dev/null; exit $__e; }}\ntrap '__catalyst_on_exit' EXIT\necho '[Catalyst] Install wrapper started (container: {})'\nset -e\nrm -rf /mnt/server && ln -s /data /mnt/server\n# Some eggs also write to /home/container during install\nif [ ! -e /home/container ]; then ln -s /data /home/container; fi\nexport HOME=/data\nexport USER=container\necho '[Catalyst] Wrapper setup complete, running install script...'\nset +e\n\n{}",
            container_id, script
        );

        // Debug: log the wrapped script for install troubleshooting
        // Using debug! (not info!) because the wrapped script body contains
        // substituted secrets (passwords, API keys) that should never appear
        // in logs at the default info level.
        debug!(
            "[DEBUG] Installer {} wrapped script (first 2000 chars):\n---BEGIN SCRIPT---\n{}---END SCRIPT---",
            container_id,
            if wrapped_script.len() > 2000 {
                format!("{}... [truncated, total {} bytes]", &wrapped_script[..2000], wrapped_script.len())
            } else {
                wrapped_script.clone()
            }
        );
        info!(
            "[DEBUG] Installer {} OCI args: [\"{}\", \"{}\", \"<script>\"]",
            container_id, interp, interp_arg
        );
        info!(
            "[DEBUG] Installer {} data_dir mount: {} -> /data",
            container_id, data_dir
        );

        let spec = serde_json::json!({
            "ociVersion": "1.1.0",
            "process": {
                "terminal": false, "user": {"uid":0,"gid":0},
                "args": [interp, interp_arg, &wrapped_script], "env": env_list,
                "cwd": "/data",
                "capabilities":{"bounding":caps,"effective":caps,"permitted":caps,"ambient":caps},
                "noNewPrivileges": true
            },
            "root": {"path":"rootfs","readonly":false},
            "hostname": &container_id,
            "mounts": mounts,
            "linux": {
                "namespaces": [{"type":"pid"},{"type":"ipc"},{"type":"uts"},{"type":"mount"}],
                "maskedPaths": masked_paths(), "readonlyPaths": readonly_paths(),
                "seccomp": default_seccomp_profile(),
                // SECURITY: installers parse the most attacker-influenced
                // input (egg install scripts) but historically ran with NO
                // cgroup path and NO resource limits — a fork bomb or malloc
                // loop in an installer OOMs the whole node for every tenant.
                // Apply the same resource discipline as runtime containers.
                "cgroupsPath": format!("/catalyst/{}", container_id),
                "resources": {
                    "memory": {"limit": 2147483648i64, "swap": 2147483648i64},
                    "cpu": {"shares": 1024i64, "quota": 200000i64, "period": 100000i64, "burst": 200000u64, "weight": 200u64},
                    "pids": {"limit": 512i64},
                    "devices": [
                        {"allow": false, "access": "rwm"},
                        {"allow": true, "type": "c", "major": 1, "minor": 3, "access": "rwm"},
                        {"allow": true, "type": "c", "major": 1, "minor": 5, "access": "rwm"},
                        {"allow": true, "type": "c", "major": 1, "minor": 7, "access": "rwm"},
                        {"allow": true, "type": "c", "major": 1, "minor": 8, "access": "rwm"},
                        {"allow": true, "type": "c", "major": 1, "minor": 9, "access": "rwm"},
                        {"allow": true, "type": "c", "major": 5, "minor": 0, "access": "rwm"},
                        {"allow": true, "type": "c", "major": 5, "minor": 1, "access": "rwm"}
                    ]
                }
            }
        });
        let spec_any = Any {
            type_url: SPEC_TYPE_URL.to_string(),
            value: spec.to_string().into_bytes(),
        };

        let snap_key = format!("{}-snap", container_id);
        self.prepare_snapshot(&qualified_image, &snap_key).await?;

        let container = Container {
            id: container_id.clone(),
            image: qualified_image,
            runtime: Some(Runtime {
                name: RUNTIME_NAME.to_string(),
                options: None,
            }),
            spec: Some(spec_any),
            snapshot_key: snap_key.clone(),
            snapshotter: "overlayfs".to_string(),
            ..Default::default()
        };
        let mut client = ContainersClient::new(self.channel.clone());
        let req = CreateContainerRequest {
            container: Some(container),
        };
        let req = with_namespace!(req, &self.namespace);
        client.create(req).await.map_err(grpc_err)?;

        info!(
            "[DEBUG] Installer {} container created in containerd",
            container_id
        );

        let mounts = self.get_snapshot_mounts(&snap_key).await?;
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = CreateTaskRequest {
            container_id: container_id.clone(),
            stdin: stdin_path.to_string_lossy().to_string(),
            stdout: stdout_path.to_string_lossy().to_string(),
            stderr: stderr_path.to_string_lossy().to_string(),
            rootfs: mounts,
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.create(req).await.map_err(grpc_err)?;

        info!(
            "[DEBUG] Installer {} task created, stdout={} stderr={}",
            container_id,
            stdout_path.display(),
            stderr_path.display()
        );

        let req = StartRequest {
            container_id: container_id.clone(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let start_result = tasks.start(req).await;
        match &start_result {
            Ok(resp) => {
                let inner = resp.get_ref();
                info!(
                    "[DEBUG] Installer {} task started, pid={}",
                    container_id, inner.pid
                );
            }
            Err(e) => {
                error!(
                    "[DEBUG] Installer {} task START FAILED: {:?}",
                    container_id, e
                );
            }
        }
        start_result.map_err(grpc_err)?;

        Ok(InstallerHandle {
            container_id,
            namespace: self.namespace.clone(),
            channel: self.channel.clone(),
            stdout_path,
            stderr_path,
            console_log_dir: self.console_log_dir.clone(),
        })
    }

    pub async fn start_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Starting container: {}", container_id);

        // Check if a task already exists for this container
        let mut tasks = TasksClient::new(self.channel.clone());
        let get_req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let get_req = with_namespace!(get_req, &self.namespace);
        match tasks.get(get_req).await {
            Ok(resp) => {
                if let Some(process) = resp.into_inner().process {
                    if process.status == 2 {
                        // Task is already running
                        info!(
                            "Container {} already has a running task, nothing to do",
                            container_id
                        );
                        let _ = self.ensure_container_io(container_id).await;
                        return Ok(());
                    }
                    // Task exists but is not running (stopped/created) - delete it first
                    info!(
                        "Container {} has a stale task (status={}), deleting before restart",
                        container_id, process.status
                    );
                    let del_req = DeleteTaskRequest {
                        container_id: container_id.to_string(),
                    };
                    let del_req = with_namespace!(del_req, &self.namespace);
                    let _ = tasks.delete(del_req).await;
                }
            }
            Err(e) if e.code() == tonic::Code::NotFound => {
                // No task exists, proceed normally
            }
            Err(e) => {
                warn!("Failed to check task status for {}: {}", container_id, e);
            }
        }

        let _ = self.ensure_container_io(container_id).await;
        let snap_key = format!("{}-snap", container_id);
        let mounts = self
            .get_snapshot_mounts(&snap_key)
            .await
            .unwrap_or_default();
        let io_dir = self.console_log_dir.join(container_id);

        let req = CreateTaskRequest {
            container_id: container_id.to_string(),
            stdin: io_dir.join("stdin").to_string_lossy().to_string(),
            stdout: io_dir.join("stdout").to_string_lossy().to_string(),
            stderr: io_dir.join("stderr").to_string_lossy().to_string(),
            rootfs: mounts,
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let create_resp = tasks.create(req).await.map_err(grpc_err)?;
        let pid = create_resp.into_inner().pid;

        // Re-attach CNI / port-forward / firewall to the new task netns when
        // prior network state is available (critical for stop→start paths that
        // do not go through create_container).
        if let Err(e) = self
            .reattach_network_on_start(container_id, pid, container_id)
            .await
        {
            warn!(
                "Network reattach failed for {} (pid {}): {}",
                container_id, pid, e
            );
            // Do not fail start solely on network reattach — create path is the
            // primary networking path. Log loudly so operators can investigate.
        }

        let req = StartRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(grpc_err)?;
        Ok(())
    }

    pub async fn stop_container(&self, container_id: &str, timeout_secs: u64) -> AgentResult<()> {
        self.stop_container_with_signal(container_id, "SIGTERM", timeout_secs)
            .await
    }

    pub async fn stop_container_with_signal(
        &self,
        container_id: &str,
        signal: &str,
        timeout_secs: u64,
    ) -> AgentResult<()> {
        info!(
            "Stopping container: {} with signal {}",
            container_id, signal
        );
        let mut tasks = TasksClient::new(self.channel.clone());
        let sig = parse_signal(signal);
        let req = TaskKillRequest {
            container_id: container_id.to_string(),
            signal: sig,
            all: true,
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        if let Err(e) = tasks.kill(req).await {
            if is_not_found(&e) {
                return Ok(());
            }
            return Err(grpc_err(e));
        }
        match tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            self.wait_for_exit(container_id),
        )
        .await
        {
            Ok(Ok(_)) | Ok(Err(_)) => {}
            Err(_) => {
                warn!(
                    "Container {} did not stop in {}s after {}, sending SIGSTOP to freeze, then SIGKILL",
                    container_id, timeout_secs, signal
                );
                // Send SIGSTOP (signal 19) to freeze the process before SIGKILL.
                // This prevents the process from spawning children or writing data
                // during the final kill phase.
                let stop_req = TaskKillRequest {
                    container_id: container_id.to_string(),
                    signal: 19, // SIGSTOP
                    all: true,
                    ..Default::default()
                };
                let stop_req = with_namespace!(stop_req, &self.namespace);
                let _ = tasks.kill(stop_req).await;
                // Brief pause to let SIGSTOP take effect
                tokio::time::sleep(Duration::from_secs(5)).await;
                // Now send SIGKILL to terminate the frozen process
                let req = TaskKillRequest {
                    container_id: container_id.to_string(),
                    signal: 9,
                    all: true,
                    ..Default::default()
                };
                let req = with_namespace!(req, &self.namespace);
                let _ = tasks.kill(req).await;
                let _ = self.wait_for_exit(container_id).await;
            }
        }
        let req = DeleteTaskRequest {
            container_id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;
        Ok(())
    }

    pub async fn kill_container(&self, container_id: &str, signal: &str) -> AgentResult<()> {
        info!("Killing container: {} with signal {}", container_id, signal);
        let sig = parse_signal(signal);
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = TaskKillRequest {
            container_id: container_id.to_string(),
            signal: sig,
            all: true,
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        if let Err(e) = tasks.kill(req).await {
            if is_not_found(&e) {
                return Ok(());
            }
            return Err(grpc_err(e));
        }
        let _ =
            tokio::time::timeout(Duration::from_secs(5), self.wait_for_exit(container_id)).await;
        let req = DeleteTaskRequest {
            container_id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;
        Ok(())
    }

    pub async fn force_kill_container(&self, container_id: &str) -> AgentResult<()> {
        info!(
            "Force killing container: {} with SIGKILL (signal 9)",
            container_id
        );
        let mut tasks = TasksClient::new(self.channel.clone());

        // Send SIGKILL (signal 9) directly - no parsing, always use numeric value
        let kill_req = TaskKillRequest {
            container_id: container_id.to_string(),
            signal: 9, // SIGKILL - cannot be caught, blocked, or ignored
            all: true, // Kill all processes in the container
            ..Default::default()
        };
        let kill_req = with_namespace!(kill_req, &self.namespace);

        // Attempt the kill - ignore errors since we want to proceed with cleanup anyway
        match tasks.kill(kill_req).await {
            Ok(_) => {
                info!("SIGKILL sent to container {}", container_id);
            }
            Err(e) => {
                if is_not_found(&e) {
                    info!("Container {} not found, already gone", container_id);
                    return Ok(());
                }
                warn!(
                    "SIGKILL request failed for {}: {}, proceeding with cleanup",
                    container_id, e
                );
            }
        }

        // Wait briefly for exit, but don't block forever
        // SIGKILL should terminate immediately, but we give it 3 seconds max
        let exit_result =
            tokio::time::timeout(Duration::from_secs(3), self.wait_for_exit(container_id)).await;

        match exit_result {
            Ok(_) => info!("Container {} exited after SIGKILL", container_id),
            Err(_) => warn!(
                "Container {} did not exit within 3s after SIGKILL, forcing cleanup",
                container_id
            ),
        }

        // Always attempt to delete the task regardless of what happened above
        let delete_req = DeleteTaskRequest {
            container_id: container_id.to_string(),
        };
        let delete_req = with_namespace!(delete_req, &self.namespace);
        if let Err(e) = tasks.delete(delete_req).await {
            if !is_not_found(&e) {
                warn!("Failed to delete task for {}: {}", container_id, e);
            }
        } else {
            info!("Task deleted for container {}", container_id);
        }

        Ok(())
    }

    pub async fn remove_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Removing container: {}", container_id);
        // Clean up firewall rules for this server.
        // The server_id may not be available in all call paths, but the
        // container_id is typically the server_id or starts with it.
        FirewallManager::remove_server_ports(container_id).await;
        let _ = self.teardown_cni_network(container_id).await;
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = TaskKillRequest {
            container_id: container_id.to_string(),
            signal: 9,
            all: true,
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.kill(req).await;
        let _ =
            tokio::time::timeout(Duration::from_secs(3), self.wait_for_exit(container_id)).await;
        let req = DeleteTaskRequest {
            container_id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;

        let mut client = ContainersClient::new(self.channel.clone());
        let req = DeleteContainerRequest {
            id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = client.delete(req).await;

        let snap_key = format!("{}-snap", container_id);
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let req = RemoveSnapshotRequest {
            snapshotter: "overlayfs".to_string(),
            key: snap_key,
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = snaps.remove(req).await;

        {
            self.container_io.lock().await.remove(container_id);
        }
        {
            let mut cg_map = self.cgroup_paths.write().await;
            cg_map.remove(container_id);
        }
        let _ = fs::remove_dir_all(self.console_log_dir.join(container_id));
        Ok(())
    }

    pub async fn send_input(&self, container_id: &str, input: &str) -> AgentResult<()> {
        debug!("Sending input to container: {}", container_id);
        if !self
            .is_container_running(container_id)
            .await
            .unwrap_or(false)
        {
            return Err(AgentError::ContainerError(format!(
                "Cannot send input: container {} is not running",
                container_id
            )));
        }

        let has_io = self.ensure_container_io(container_id).await?;
        let handle = {
            let mut m = self.container_io.lock().await;
            m.get_mut(container_id)
                .and_then(|io| io.stdin_writer.as_ref().and_then(|w| w.try_clone().ok()))
        };
        if let Some(h) = handle {
            let input = input.to_string();
            spawn_blocking(move || {
                let mut w = h;
                w.write_all(input.as_bytes())
                    .map_err(|e| AgentError::ContainerError(format!("stdin: {}", e)))?;
                let _ = w.flush();
                Ok::<(), AgentError>(())
            })
            .await
            .map_err(|e| AgentError::ContainerError(e.to_string()))??;
            return Ok(());
        }

        if !has_io {
            warn!(
                "No stdin FIFO found for {}, falling back to exec-based stdin injection",
                container_id
            );
        }

        // Fallback: exec
        let exec_id = format!("stdin-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let io_dir = self.console_log_dir.join(container_id);
        let ep = io_dir.join(format!("e-{}-in", exec_id));
        let eo = io_dir.join(format!("e-{}-out", exec_id));
        if ep.exists() {
            fs::remove_file(&ep).ok();
        }
        create_fifo(&ep).ok();
        File::create(&eo).ok();
        let spec = serde_json::json!({"args":["sh","-c","cat > /proc/1/fd/0"],"env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],"cwd":"/"});
        let spec_any = Any {
            type_url: "types.containerd.io/opencontainers/runtime-spec/1/Process".to_string(),
            value: spec.to_string().into_bytes(),
        };
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = ExecProcessRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
            stdin: ep.to_string_lossy().to_string(),
            stdout: eo.to_string_lossy().to_string(),
            stderr: "".to_string(),
            terminal: false,
            spec: Some(spec_any),
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.exec(req).await.map_err(grpc_err)?;
        let req = StartRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(grpc_err)?;
        let epc = ep.clone();
        let input_owned = input.to_string();
        spawn_blocking(move || -> AgentResult<()> {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .open(&epc)
                .map_err(|e| AgentError::ContainerError(format!("stdin fallback open: {}", e)))?;
            f.write_all(input_owned.as_bytes())
                .map_err(|e| AgentError::ContainerError(format!("stdin fallback write: {}", e)))?;
            Ok(())
        })
        .await
        .map_err(|e| AgentError::ContainerError(e.to_string()))??;
        let _ = fs::remove_file(&ep);
        let _ = fs::remove_file(&eo);
        Ok(())
    }

    pub async fn restore_console_writers(&self) -> AgentResult<()> {
        info!("Restoring console writers for running containers");
        let containers = self.list_containers().await?;
        let mut restored = 0;
        for c in containers {
            if !c.status.contains("Up") {
                continue;
            }
            if self.ensure_container_io(&c.id).await.is_ok() {
                restored += 1;
            }
        }
        info!("Console writer restoration: {} restored", restored);
        Ok(())
    }

    pub async fn get_logs(&self, container_id: &str, lines: Option<u32>) -> AgentResult<String> {
        let base = self.console_log_dir.join(container_id);
        let mut output = String::new();
        for name in ["stdout", "stderr"] {
            if let Ok(content) = tokio::fs::read_to_string(base.join(name)).await {
                if let Some(n) = lines {
                    let all: Vec<&str> = content.lines().collect();
                    let start = all.len().saturating_sub(n as usize);
                    for l in &all[start..] {
                        output.push_str(l);
                        output.push('\n');
                    }
                } else {
                    output.push_str(&content);
                }
            }
        }
        Ok(output)
    }

    pub async fn stream_logs<F>(&self, container_id: &str, mut callback: F) -> AgentResult<()>
    where
        F: FnMut(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()>>>,
    {
        use tokio::io::{AsyncBufReadExt, AsyncSeekExt, SeekFrom};

        let base = self.console_log_dir.join(container_id);
        let stdout_path = base.join("stdout");
        let stderr_path = base.join("stderr");

        let mut stdout_file = tokio::fs::File::open(&stdout_path).await.ok();
        let mut stderr_file = tokio::fs::File::open(&stderr_path).await.ok();
        let mut stdout_pos = 0u64;
        let mut stderr_pos = 0u64;
        let mut stdout_buf = stdout_file.take().map(tokio::io::BufReader::new);
        let mut stderr_buf = stderr_file.take().map(tokio::io::BufReader::new);
        let mut line = String::new();

        loop {
            let running = self
                .is_container_running(container_id)
                .await
                .unwrap_or(false);

            if let Some(ref mut buf) = stdout_buf {
                line.clear();
                match tokio::time::timeout(Duration::from_millis(100), buf.read_line(&mut line))
                    .await
                {
                    Ok(Ok(0)) => {
                        // EOF — file may have been rotated; reopen and seek
                        drop(stdout_buf);
                        stdout_file = tokio::fs::File::open(&stdout_path).await.ok();
                        if let Some(ref mut f) = stdout_file {
                            if let Ok(meta) = f.metadata().await {
                                if meta.len() < stdout_pos {
                                    stdout_pos = 0;
                                }
                                let _ = f.seek(SeekFrom::Start(stdout_pos)).await;
                            }
                        }
                        stdout_buf = stdout_file.take().map(tokio::io::BufReader::new);
                    }
                    Ok(Ok(_)) => {
                        stdout_pos += line.len() as u64;
                        callback(line.clone()).await;
                    }
                    Ok(Err(_)) => {}
                    Err(_) => {}
                }
            }

            if let Some(ref mut buf) = stderr_buf {
                line.clear();
                match tokio::time::timeout(Duration::from_millis(100), buf.read_line(&mut line))
                    .await
                {
                    Ok(Ok(0)) => {
                        drop(stderr_buf);
                        stderr_file = tokio::fs::File::open(&stderr_path).await.ok();
                        if let Some(ref mut f) = stderr_file {
                            if let Ok(meta) = f.metadata().await {
                                if meta.len() < stderr_pos {
                                    stderr_pos = 0;
                                }
                                let _ = f.seek(SeekFrom::Start(stderr_pos)).await;
                            }
                        }
                        stderr_buf = stderr_file.take().map(tokio::io::BufReader::new);
                    }
                    Ok(Ok(_)) => {
                        stderr_pos += line.len() as u64;
                        callback(line.clone()).await;
                    }
                    Ok(Err(_)) => {}
                    Err(_) => {}
                }
            }

            if !running {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }

    pub async fn spawn_log_stream(&self, container_id: &str) -> AgentResult<LogStream> {
        info!("Starting log stream for container: {}", container_id);
        let base = self.console_log_dir.join(container_id);
        let stdout = if base.join("stdout").exists() {
            Some(tokio::fs::File::open(base.join("stdout")).await?)
        } else {
            None
        };
        let stderr = if base.join("stderr").exists() {
            Some(tokio::fs::File::open(base.join("stderr")).await?)
        } else {
            None
        };
        Ok(LogStream {
            stdout,
            stderr,
            container_id: container_id.to_string(),
        })
    }

    pub async fn list_containers(&self) -> AgentResult<Vec<ContainerInfo>> {
        // Return cached result if still fresh (2 seconds)
        {
            let cache = self.container_list_cache.read().await;
            if cache.1.elapsed() < Duration::from_secs(2) {
                return Ok(cache.0.clone());
            }
        }

        let mut client = ContainersClient::new(self.channel.clone());
        let req = ListContainersRequest {
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tokio::time::timeout(Duration::from_secs(10), client.list(req))
            .await
            .map_err(|_| AgentError::ContainerError("list_containers timed out".to_string()))?
            .map_err(grpc_err)?;
        let mut result = Vec::new();
        for c in resp.into_inner().containers {
            let running = self.is_container_running(&c.id).await.unwrap_or(false);
            result.push(ContainerInfo {
                id: c.id.clone(),
                names: c.id.clone(),
                managed: c.labels.contains_key("catalyst.managed"),
                status: if running {
                    "Up".to_string()
                } else {
                    "Exited".to_string()
                },
                image: c.image.clone(),
                command: String::new(),
                labels: c.labels.clone(),
            });
        }

        {
            let mut cache = self.container_list_cache.write().await;
            *cache = (result.clone(), Instant::now());
        }
        Ok(result)
    }

    pub async fn container_exists(&self, container_id: &str) -> bool {
        let mut client = ContainersClient::new(self.channel.clone());
        let req = GetContainerRequest {
            id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        matches!(
            tokio::time::timeout(Duration::from_secs(5), client.get(req)).await,
            Ok(Ok(_))
        )
    }

    pub async fn inspect_container(
        &self,
        container_id: &str,
    ) -> AgentResult<Option<ContainerInspectInfo>> {
        let mut client = ContainersClient::new(self.channel.clone());
        let req = GetContainerRequest {
            id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tokio::time::timeout(Duration::from_secs(5), client.get(req))
            .await
            .map_err(|_| AgentError::ContainerError("inspect_container timed out".to_string()))?
            .map_err(grpc_err)?;

        let container = resp.into_inner().container;
        let Some(container) = container else {
            return Ok(None);
        };

        let mut info = ContainerInspectInfo::default();

        // Parse OCI spec to extract network mode and resource limits
        if let Some(spec_any) = container.spec {
            if spec_any.type_url == SPEC_TYPE_URL {
                if let Ok(spec_value) = serde_json::from_slice::<serde_json::Value>(&spec_any.value)
                {
                    // Network mode: absence of "network" namespace = host networking
                    if let Some(namespaces) = spec_value
                        .get("linux")
                        .and_then(|l| l.get("namespaces"))
                        .and_then(|n| n.as_array())
                    {
                        let has_network_ns = namespaces
                            .iter()
                            .any(|ns| ns.get("type").and_then(|t| t.as_str()) == Some("network"));
                        info.network_mode =
                            if has_network_ns { "bridge" } else { "host" }.to_string();
                    }

                    // Memory limit (bytes)
                    if let Some(limit) = spec_value
                        .get("linux")
                        .and_then(|l| l.get("resources"))
                        .and_then(|r| r.get("memory"))
                        .and_then(|m| m.get("limit"))
                        .and_then(|l| l.as_i64())
                    {
                        info.memory_limit_bytes = limit;
                    }

                    // CPU quota and period
                    if let Some(quota) = spec_value
                        .get("linux")
                        .and_then(|l| l.get("resources"))
                        .and_then(|r| r.get("cpu"))
                        .and_then(|c| c.get("quota"))
                        .and_then(|q| q.as_i64())
                    {
                        info.cpu_quota = quota;
                    }
                    if let Some(period) = spec_value
                        .get("linux")
                        .and_then(|l| l.get("resources"))
                        .and_then(|r| r.get("cpu"))
                        .and_then(|c| c.get("period"))
                        .and_then(|p| p.as_i64())
                    {
                        info.cpu_period = period;
                    }

                    // Startup command (process.args)
                    if let Some(args) = spec_value
                        .get("process")
                        .and_then(|p| p.get("args"))
                        .and_then(|a| a.as_array())
                    {
                        let arg_strings: Vec<String> = args
                            .iter()
                            .filter_map(|a| a.as_str().map(String::from))
                            .collect();
                        info.startup_command = arg_strings.join(" ");
                    }

                    // Environment variable NAMES only (not values — may contain secrets)
                    if let Some(env_list) = spec_value
                        .get("process")
                        .and_then(|p| p.get("env"))
                        .and_then(|e| e.as_array())
                    {
                        info.env_var_names = env_list
                            .iter()
                            .filter_map(|e| e.as_str())
                            .filter_map(|entry| entry.split_once('=').map(|(k, _)| k.to_string()))
                            .collect();
                    }
                }
            }
        }

        Ok(Some(info))
    }

    pub async fn is_container_running(&self, container_id: &str) -> AgentResult<bool> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        match tasks.get(req).await {
            Ok(resp) => Ok(resp
                .into_inner()
                .process
                .map(|p| p.status == 2)
                .unwrap_or(false)),
            Err(e) if e.code() == tonic::Code::NotFound => Ok(false),
            Err(e) => Err(grpc_err(e)),
        }
    }

    /// PID of the container task's init process, or `None` if the container
    /// has no live task (never started, or already exited and reaped).
    ///
    /// Used by the lifecycle monitor to distinguish the current task from
    /// stale events replayed by containerd's event backlog (see
    /// `match_task_exit_event`).
    pub async fn get_container_task_pid(&self, container_id: &str) -> AgentResult<Option<u32>> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        match tasks.get(req).await {
            Ok(resp) => Ok(resp.into_inner().process.map(|p| p.pid)),
            Err(e) if e.code() == tonic::Code::NotFound => Ok(None),
            Err(e) => Err(grpc_err(e)),
        }
    }

    pub async fn get_container_exit_code(&self, container_id: &str) -> AgentResult<Option<i32>> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        match tasks.get(req).await {
            Ok(resp) => Ok(resp.into_inner().process.and_then(|p| {
                if p.status == 3 {
                    Some(p.exit_status as i32)
                } else {
                    None
                }
            })),
            Err(_) => Ok(None),
        }
    }

    pub async fn get_container_ip(&self, container_id: &str) -> AgentResult<String> {
        // Check CNI result file
        let cni_state = self
            .cni_results_dir
            .join(format!("catalyst-{}", container_id));
        if let Ok(content) = tokio::fs::read_to_string(&cni_state).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(ips) = v.get("ips").and_then(|v| v.as_array()) {
                    for ip in ips {
                        if let Some(addr) = ip.get("address").and_then(|v| v.as_str()) {
                            let a = addr.split('/').next().unwrap_or("");
                            if !a.is_empty() {
                                return Ok(a.to_string());
                            }
                        }
                    }
                }
            }
        }
        // Fallback: scan CNI networks dir
        if let Ok(mut entries) = tokio::fs::read_dir(&self.cni_data_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let d = entry.path();
                if let Ok(md) = tokio::fs::metadata(&d).await {
                    if !md.is_dir() {
                        continue;
                    }
                } else {
                    continue;
                }
                if let Ok(mut files) = tokio::fs::read_dir(&d).await {
                    while let Ok(Some(f)) = files.next_entry().await {
                        let n = f.file_name().to_string_lossy().to_string();
                        if n.parse::<Ipv4Addr>().is_ok() {
                            if let Ok(c) = tokio::fs::read_to_string(f.path()).await {
                                if c.trim().contains(container_id) {
                                    return Ok(n);
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(String::new())
    }

    pub async fn get_stats(&self, container_id: &str) -> AgentResult<ContainerStats> {
        tokio::time::timeout(Duration::from_secs(10), self.get_stats_inner(container_id))
            .await
            .map_err(|_| {
                AgentError::ContainerError(format!("get_stats timed out for {}", container_id))
            })?
    }

    pub(crate) async fn get_stats_inner(&self, container_id: &str) -> AgentResult<ContainerStats> {
        let cg = {
            let cache = self.cgroup_paths.read().await;
            cache.get(container_id).cloned()
        };
        let cg = match cg {
            Some(path) => path,
            None => {
                if let Some(path) = find_container_cgroup(container_id).await {
                    let mut cache = self.cgroup_paths.write().await;
                    cache.insert(container_id.to_string(), path.clone());
                    path
                } else {
                    String::new()
                }
            }
        };
        let cpu = if !cg.is_empty() {
            self.cpu_tracker.get_percent(container_id, &cg).await
        } else {
            0.0
        };
        let (mem, mem_limit) = if !cg.is_empty() {
            let current = read_cgroup_memory(&cg).await.unwrap_or(0);
            let limit = read_cgroup_memory_limit(&cg).await.unwrap_or(0);
            (current, limit)
        } else {
            (0, 0)
        };
        let memory_display = if mem_limit > 0 {
            format!(
                "{}MiB / {}MiB",
                mem / (1024 * 1024),
                mem_limit / (1024 * 1024)
            )
        } else {
            format!("{}MiB / 0MiB", mem / (1024 * 1024))
        };
        let (net_rx, net_tx, net_io) = if !cg.is_empty() {
            read_network_io(&cg)
                .await
                .unwrap_or_else(|| (0, 0, "0B / 0B".to_string()))
        } else {
            (0, 0, "0B / 0B".to_string())
        };
        let (blk_read, blk_write, block_io) = if !cg.is_empty() {
            read_block_io(&cg)
                .await
                .unwrap_or_else(|| (0, 0, "0B / 0B".to_string()))
        } else {
            (0, 0, "0B / 0B".to_string())
        };
        Ok(ContainerStats {
            container_id: container_id.to_string(),
            container_name: container_id.to_string(),
            cpu_percent: format!("{:.2}%", cpu),
            memory_usage: memory_display,
            net_io,
            block_io,
            network_rx_bytes: net_rx,
            network_tx_bytes: net_tx,
            block_read_bytes: blk_read,
            block_write_bytes: blk_write,
        })
    }

    pub async fn exec(&self, container_id: &str, command: Vec<&str>) -> AgentResult<String> {
        let exec_id = format!("exec-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let io_dir = self.console_log_dir.join(container_id);
        fs::create_dir_all(&io_dir).ok();
        let op = io_dir.join(format!("{}-out", exec_id));
        let ep = io_dir.join(format!("{}-err", exec_id));
        File::create(&op).ok();
        File::create(&ep).ok();

        let spec = serde_json::json!({"args":command,"env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],"cwd":"/data"});
        let spec_any = Any {
            type_url: "types.containerd.io/opencontainers/runtime-spec/1/Process".to_string(),
            value: spec.to_string().into_bytes(),
        };
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = ExecProcessRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
            stdin: "".to_string(),
            stdout: op.to_string_lossy().to_string(),
            stderr: ep.to_string_lossy().to_string(),
            terminal: false,
            spec: Some(spec_any),
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.exec(req).await.map_err(grpc_err)?;

        let req = StartRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(grpc_err)?;

        let req = WaitRequest {
            container_id: container_id.to_string(),
            exec_id,
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tokio::time::timeout(Duration::from_secs(30), tasks.wait(req)).await;

        let out = tokio::fs::read_to_string(&op).await.unwrap_or_default();
        let err = tokio::fs::read_to_string(&ep).await.unwrap_or_default();
        let _ = fs::remove_file(&op);
        let _ = fs::remove_file(&ep);
        if !err.is_empty() && out.is_empty() {
            return Err(AgentError::ContainerError(format!("Exec failed: {}", err)));
        }
        Ok(out)
    }

    pub async fn subscribe_to_container_events(
        &self,
        container_id: &str,
    ) -> AgentResult<EventStream> {
        debug!(
            "subscribe_to_container_events: using main channel for container {}",
            container_id
        );

        // Reuse the main gRPC channel instead of creating a new connection.
        // containerd 1.7+ can exhibit a race condition where a fresh Subscribe
        // on a newly-created channel hangs indefinitely, while the existing
        // channel that already carries other RPCs works fine.  gRPC multiplexes
        // concurrent streams over a single HTTP/2 connection, so sharing the
        // channel is both safe and the intended usage pattern.
        let mut client = EventsClient::new(self.channel.clone());
        let req = SubscribeRequest { filters: vec![] };
        debug!(
            "subscribe_to_container_events: calling subscribe with empty filters for container {}",
            container_id
        );

        let resp = tokio::time::timeout(Duration::from_secs(10), client.subscribe(req))
            .await
            .map_err(|_| {
                error!("subscribe_to_container_events: subscribe RPC timed out after 10s");
                AgentError::ContainerError("subscribe_to_container_events timed out".to_string())
            })?
            .map_err(|e| {
                error!(
                    "subscribe_to_container_events: subscribe RPC returned error: {:?}",
                    e
                );
                grpc_err(e)
            })?;
        info!(
            "subscribe_to_container_events: subscription established for {}",
            container_id
        );
        Ok(EventStream {
            receiver: resp.into_inner(),
        })
    }

    pub async fn diagnose_events_service(&self) -> AgentResult<String> {
        let mut version_client = VersionClient::new(self.channel.clone());
        let version_resp = tokio::time::timeout(
            Duration::from_secs(5),
            version_client.version(Request::new(())),
        )
        .await
        .map_err(|_| AgentError::ContainerError("version query timed out".to_string()))?
        .map_err(grpc_err)?;
        let version = version_resp.into_inner();
        info!(
            "containerd version: {} (revision: {})",
            version.version, version.revision
        );

        debug!("diagnose_events_service: testing Subscribe with official-example pattern");
        // Use the main channel for the diagnostic Subscribe test as well,
        // for the same reason as subscribe_to_all_events / subscribe_to_container_events:
        // containerd 1.7+ may hang a fresh Subscribe on a brand-new connection.
        let mut test_client = EventsClient::new(self.channel.clone());
        let test_req = SubscribeRequest::default();
        let test_result =
            tokio::time::timeout(Duration::from_secs(10), test_client.subscribe(test_req)).await;

        let diag = match test_result {
            Ok(Ok(resp)) => {
                info!("diagnose_events_service: Subscribe succeeded");
                let mut stream = resp.into_inner();
                match tokio::time::timeout(Duration::from_secs(2), stream.message()).await {
                    Ok(Ok(Some(_))) => "events service OK (received event)".to_string(),
                    Ok(Ok(None)) => "events service OK (stream open, no events yet)".to_string(),
                    Ok(Err(e)) => format!("events service OK but message error: {:?}", e),
                    Err(_) => "events service OK (stream open, no events within 2s)".to_string(),
                }
            }
            Ok(Err(status)) => {
                error!(
                    "diagnose_events_service: Subscribe returned gRPC error: {:?}",
                    status
                );
                format!("events service returned error: {:?}", status)
            }
            Err(_) => {
                error!("diagnose_events_service: Subscribe timed out after 10s");
                "events service UNRESPONSIVE (Subscribe timed out)".to_string()
            }
        };

        Ok(format!(
            "containerd {} (rev {}) — {}",
            version.version, version.revision, diag
        ))
    }

    pub async fn subscribe_to_all_events(&self) -> AgentResult<EventStream> {
        debug!("subscribe_to_all_events: using main channel");

        let mut client = EventsClient::new(self.channel.clone());
        let req = SubscribeRequest { filters: vec![] };
        debug!("subscribe_to_all_events: calling subscribe RPC with empty filters");

        let resp = tokio::time::timeout(Duration::from_secs(10), client.subscribe(req))
            .await
            .map_err(|_| {
                error!("subscribe_to_all_events: subscribe RPC timed out after 10s");
                AgentError::ContainerError("subscribe_to_all_events timed out".to_string())
            })?
            .map_err(|e| {
                error!(
                    "subscribe_to_all_events: subscribe RPC returned error: {:?}",
                    e
                );
                grpc_err(e)
            })?;
        info!("subscribe_to_all_events: subscription established successfully");
        Ok(EventStream {
            receiver: resp.into_inner(),
        })
    }

    pub(crate) async fn wait_for_exit(&self, container_id: &str) -> AgentResult<u32> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = WaitRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tokio::time::timeout(Duration::from_secs(30), tasks.wait(req))
            .await
            .map_err(|_| {
                AgentError::ContainerError(format!("wait_for_exit timed out for {}", container_id))
            })?
            .map_err(grpc_err)?;
        Ok(resp.into_inner().exit_status)
    }

    pub(crate) async fn ensure_container_io(&self, container_id: &str) -> AgentResult<bool> {
        if self.container_io.lock().await.contains_key(container_id) {
            return Ok(true);
        }
        let io_dir = self.console_log_dir.join(container_id);
        let stdin_path = io_dir.join("stdin");
        if !stdin_path.exists() {
            return Ok(false);
        }
        let writer = open_fifo_rdwr(&stdin_path)?;
        self.container_io.lock().await.insert(
            container_id.to_string(),
            ContainerIo {
                _stdin_fifo: stdin_path,
                _stdout_file: io_dir.join("stdout"),
                _stderr_file: io_dir.join("stderr"),
                stdin_writer: Some(writer),
            },
        );
        Ok(true)
    }

    pub(crate) fn cleanup_io(&self, container_id: &str) {
        let _ = fs::remove_dir_all(self.console_log_dir.join(container_id));
    }
}

/// A decoded containerd task event relevant to lifecycle monitoring.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskExitEvent {
    pub container_id: String,
    /// PID of the process whose exit this event describes (the task's init
    /// process for the events the lifecycle monitor cares about).
    pub pid: u32,
    pub exit_status: u32,
}

/// Decode a containerd `Envelope` and return the task event it carries if
/// (and only if) it describes the exit of the task we are monitoring.
///
/// The lifecycle monitor subscribes to the node-wide containerd event stream
/// (server-side filters are unreliable across containerd versions), so it
/// MUST validate events before reacting:
///
/// 1. **Container ID** — every exit-topic payload (`TaskExit`, `TaskDelete`)
///    carries `container_id`; foreign containers' events are ignored.
/// 2. **Task PID** — containerd's event service replays its event backlog to
///    every new subscriber, so after a start/auto-restart/agent-reconnect the
///    monitor immediately receives the *previous* task's exit event for this
///    same container (ID matches, PID differs). Matching the live task's PID
///    (see `get_container_task_pid`) discards that replay and only a genuine
///    exit of the current task passes.
///
/// Pure function — no I/O, trivially unit-testable.
pub fn match_task_exit_event(
    envelope: &containerd_client::types::Envelope,
    container_id: &str,
    expected_pid: Option<u32>,
) -> Option<TaskExitEvent> {
    use prost::Message;

    let event = envelope.event.as_ref()?;
    let task_event = match envelope.topic.as_str() {
        // tasks/exit fires when the task's init process exits; the payload is
        // containerd.events.TaskExit (protobuf full name below).
        "/tasks/exit" => containerd_client::events::TaskExit::decode(event.value.as_slice())
            .ok()
            .map(|e| TaskExitEvent {
                container_id: e.container_id,
                pid: e.pid,
                exit_status: e.exit_status,
            }),
        // tasks/delete fires when the task is reaped/removed (e.g. after a
        // deferred delete); the payload is containerd.events.TaskDelete.
        "/tasks/delete" => containerd_client::events::TaskDelete::decode(event.value.as_slice())
            .ok()
            .map(|e| TaskExitEvent {
                container_id: e.container_id,
                pid: e.pid,
                exit_status: e.exit_status,
            }),
        _ => None,
    }?;

    // Guard 1: only report events that are actually about the container we
    // are monitoring.
    if task_event.container_id != container_id {
        debug!(
            "Ignoring task event for unrelated container {} (monitoring {})",
            task_event.container_id, container_id
        );
        return None;
    }

    // Guard 2: only report events for the live task's PID. Containerd replays
    // its event backlog to new subscribers — without this check, the monitor
    // attached after a restart would immediately see the PREVIOUS task's exit
    // event and falsely report another exit (restart loop).
    if let Some(expected) = expected_pid {
        if task_event.pid != expected {
            debug!(
                "Ignoring stale/replayed task event for container {} (event pid {}, live task pid {})",
                container_id, task_event.pid, expected
            );
            return None;
        }
    }

    Some(task_event)
}

#[cfg(test)]
mod event_match_tests {
    use super::match_task_exit_event;
    use containerd_client::events::{TaskDelete, TaskExit};
    use containerd_client::types::Envelope;
    use prost::Message;

    fn envelope(topic: &str, payload: Vec<u8>) -> Envelope {
        Envelope {
            timestamp: None,
            namespace: "catalyst".to_string(),
            topic: topic.to_string(),
            event: Some(::prost_types::Any {
                type_url: format!(
                    "type.googleapis.com/containerd.events.{}",
                    topic_short(topic)
                ),
                value: payload,
            }),
        }
    }

    fn topic_short(topic: &str) -> String {
        topic.trim_start_matches('/').replace('/', ".")
    }

    /// Exit event for container `container_id` with init PID 42 (helpers all
    /// use 42; tests pass `Some(42)` as the live PID to match).
    fn exit_event(container_id: &str, status: u32) -> Envelope {
        let payload = TaskExit {
            container_id: container_id.to_string(),
            id: String::new(),
            pid: 42,
            exit_status: status,
            exited_at: None,
        }
        .encode_to_vec();
        envelope("/tasks/exit", payload)
    }

    #[test]
    fn matches_own_exit_event() {
        let env = exit_event("srv-123", 0);
        let matched =
            match_task_exit_event(&env, "srv-123", Some(42)).expect("should match own exit");
        assert_eq!(matched.container_id, "srv-123");
        assert_eq!(matched.pid, 42);
        assert_eq!(matched.exit_status, 0);
    }

    #[test]
    fn matches_when_pid_filter_disabled() {
        // PID query failed at monitor startup — behave like the first fix:
        // container-ID match only, never crash on None live pid.
        let env = exit_event("srv-123", 1);
        let matched = match_task_exit_event(&env, "srv-123", None)
            .expect("should match when pid filter is disabled");
        assert_eq!(matched.exit_status, 1);
    }

    #[test]
    fn ignores_stale_replayed_exit_from_previous_task() {
        // The restart-loop bug: containerd replays its event backlog to new
        // subscribers, so after an auto-restart the monitor immediately sees
        // the PREVIOUS task's exit event (same container, different PID) and
        // must not treat it as a fresh exit.
        let env = exit_event("srv-123", 0); // pid 42
        assert!(match_task_exit_event(&env, "srv-123", Some(777)).is_none());
    }

    #[test]
    fn ignores_other_containers_exit_events() {
        // The false-exit bug: another container on the node exited.
        let env = exit_event("other-server", 1); // pid 42
        assert!(match_task_exit_event(&env, "srv-123", Some(42)).is_none());
    }

    #[test]
    fn matches_own_delete_event_with_status() {
        let payload = TaskDelete {
            container_id: "srv-123".to_string(),
            pid: 42,
            exit_status: 137,
            exited_at: None,
            id: String::new(),
        }
        .encode_to_vec();
        let env = envelope("/tasks/delete", payload);
        let matched =
            match_task_exit_event(&env, "srv-123", Some(42)).expect("should match own delete");
        assert_eq!(matched.exit_status, 137);
    }

    #[test]
    fn ignores_stale_replayed_delete_from_previous_task() {
        let payload = TaskDelete {
            container_id: "srv-123".to_string(),
            pid: 9, // previous generation
            exit_status: 0,
            exited_at: None,
            id: String::new(),
        }
        .encode_to_vec();
        let env = envelope("/tasks/delete", payload);
        assert!(match_task_exit_event(&env, "srv-123", Some(42)).is_none());
    }

    #[test]
    fn ignores_other_containers_delete_events() {
        let payload = TaskDelete {
            container_id: "installer-abc".to_string(),
            pid: 7,
            exit_status: 0,
            exited_at: None,
            id: String::new(),
        }
        .encode_to_vec();
        let env = envelope("/tasks/delete", payload);
        assert!(match_task_exit_event(&env, "srv-123", Some(42)).is_none());
    }

    #[test]
    fn ignores_unrelated_topics() {
        // e.g. container create/delete events, snapshots, etc.
        let env = exit_event("srv-123", 0);
        let mut env = env;
        env.topic = "/containers/create".to_string();
        assert!(match_task_exit_event(&env, "srv-123", Some(42)).is_none());
    }

    #[test]
    fn ignores_garbage_payload() {
        let env = envelope("/tasks/exit", vec![0xff, 0xff, 0xff]);
        assert!(match_task_exit_event(&env, "srv-123", Some(42)).is_none());
    }

    #[test]
    fn ignores_missing_event() {
        let env = Envelope {
            timestamp: None,
            namespace: "catalyst".to_string(),
            topic: "/tasks/exit".to_string(),
            event: None,
        };
        assert!(match_task_exit_event(&env, "srv-123", Some(42)).is_none());
    }
}
