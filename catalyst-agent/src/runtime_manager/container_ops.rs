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

        // Resolve env, command configuration, selected platform and config identity
        // together instead of traversing the same image multiple times.
        let image_metadata = self.get_image_metadata(&qualified_image).await?;

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

        let stdin_writer = match open_fifo_rdwr(&stdin_path) {
            Ok(w) => w,
            Err(e) => {
                let _ = fs::remove_dir_all(&io_dir);
                return Err(e);
            }
        };
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
        // Host network mode shares the node's network namespace (no
        // isolation) and is denied only when the operator explicitly opted
        // out via containerd.allow_host_network / CATALYST_ALLOW_HOST_NETWORK.
        let use_host_network = config.network_mode == Some("host");
        if use_host_network && !self.allow_host_network() {
            warn!(
                "Rejecting networkMode=host for {}: host networking is disabled (set containerd.allow_host_network=true to permit)",
                config.container_id
            );
            self.report_runtime_error(
                crate::error_reporter::ErrorLevel::Warn,
                "agent:network",
                format!(
                    "Rejected networkMode=host for server {}: host networking is disabled",
                    config.server_id
                ),
                Some(serde_json::json!({ "serverId": config.server_id })),
            );
            // Unwind the I/O state created above (io_dir, FIFO, map entry).
            self.remove_io_state(config.container_id).await;
            return Err(AgentError::InvalidRequest(
                "networkMode \"host\" is disabled on this node".to_string(),
            ));
        }
        let spec = match self.build_oci_spec(
            &config,
            &io_dir,
            use_host_network,
            &image_metadata.env,
            image_metadata.entrypoint.as_deref(),
            image_metadata.cmd.as_deref(),
        ) {
            Ok(spec) => spec,
            Err(e) => {
                self.remove_io_state(config.container_id).await;
                return Err(e);
            }
        };
        let spec_any = Any {
            type_url: SPEC_TYPE_URL.to_string(),
            value: spec.to_string().into_bytes(),
        };

        // Prepare rootfs snapshot
        let snap_key = format!("{}-snap", config.container_id);
        if let Err(e) = self
            .prepare_snapshot_with_config_digest(
                &qualified_image,
                &snap_key,
                Some(&image_metadata.config_digest),
            )
            .await
        {
            // Nothing was created in containerd yet; drop local I/O state and
            // best-effort remove a possibly stale snapshot under our key.
            self.remove_io_state(config.container_id).await;
            self.remove_snapshot(&snap_key).await;
            return Err(e);
        }

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
        if let Err(e) = client.create(req).await {
            // Snapshot is prepared but the record was not created: remove the
            // snapshot and local I/O state so retries don't hit AlreadyExists.
            self.remove_snapshot(&snap_key).await;
            self.remove_io_state(config.container_id).await;
            return Err(grpc_err(e));
        }

        // Cache cgroup path for fast stats lookups
        let cached_cg = format!("/sys/fs/cgroup/{}/{}", self.namespace, config.container_id);
        {
            let mut cg_map = self.cgroup_paths.write().await;
            cg_map.insert(config.container_id.to_string(), cached_cg);
        }

        // Get rootfs mounts and create task
        let mounts = match self.get_snapshot_mounts(&snap_key).await {
            Ok(mounts) => mounts,
            Err(e) => {
                // Container record exists but its snapshot is unusable: tear
                // down the whole stack so the next attempt starts clean.
                return Err(self.unwind_created_container(config.container_id, e).await);
            }
        };
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
        let resp = match tasks.create(req).await {
            Ok(resp) => resp,
            Err(e) => {
                // Task creation failed after the container record, snapshot,
                // and maps were set up: destroy the whole stack (task +
                // container + snapshot + CNI + maps + io_dir), not just stdio.
                return Err(self
                    .unwind_created_container(config.container_id, grpc_err(e))
                    .await);
            }
        };
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
                let primary = AgentError::ContainerError(format!(
                    "CNI network setup failed for {}: {}",
                    config.container_id, e
                ));
                return Err(self
                    .unwind_created_container(config.container_id, primary)
                    .await);
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
            let mut nsenter_command = Command::new("nsenter");
            nsenter_command.kill_on_drop(true);
            // This shell inherits the agent's environment rather than the OCI
            // process.env filtered above. Remove only shell startup controls;
            // locale, proxy and other valid inherited settings remain intact.
            super::image_and_spec::sanitize_shell_startup_command(&mut nsenter_command);
            let nsenter_output = tokio::time::timeout(
                Duration::from_secs(10),
                nsenter_command
                    .args(["-t", &pid.to_string(), "-m", "--", "sh", "-c"])
                    .arg(format!(
                        "cat > {} << 'CATALYST_RESOLV_EOF'\n{}\nCATALYST_RESOLV_EOF\nchmod 644 {}",
                        resolv_dest, resolv_content, resolv_dest
                    ))
                    .output(),
            )
            .await;

            match nsenter_output {
                Ok(Ok(output)) if output.status.success() => {
                    info!(
                        "Updated resolv.conf in container {} with DNS: {:?}",
                        config.container_id, self.dns_servers
                    );
                }
                Ok(Ok(output)) => {
                    warn!(
                        "Failed to update resolv.conf in container {}: {}",
                        config.container_id,
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
                Ok(Err(e)) => {
                    warn!(
                        "Failed to run nsenter for resolv.conf update in {}: {}",
                        config.container_id, e
                    );
                }
                Err(_) => {
                    warn!(
                        "nsenter resolv.conf update timed out for {} after 10s",
                        config.container_id
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
        let start_result =
            match tokio::time::timeout(Duration::from_secs(5), tasks.start(req)).await {
                Ok(Ok(_)) => Ok(()),
                Ok(Err(status)) => Err(grpc_err(status)),
                Err(_) => Err(AgentError::ContainerError(format!(
                    "Task start timed out for {}",
                    config.container_id
                ))),
            };
        if let Err(primary) = start_result {
            // The task, container, snapshot, and full CNI attachment (iface,
            // lease, DNAT rules, state files) may all exist here, including when
            // Start timed out after committing: destroy the whole stack so
            // nothing leaks and append any incomplete cleanup diagnostics.
            return Err(self
                .unwind_created_container(config.container_id, primary)
                .await);
        }

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
        self.spawn_installer_container_with_entrypoint(image, script, env, data_dir, None)
            .await
    }

    /// Spawn an installer while honoring the egg's declared shell entrypoint.
    /// The legacy method above delegates with `None`; lifecycle callers that
    /// have `template.installEntrypoint` should pass it here. New lifecycle code
    /// should use prepare/register/start below so cancellation knows the exact
    /// container before Tasks.Start becomes possible.
    pub async fn spawn_installer_container_with_entrypoint(
        &self,
        image: &str,
        script: &str,
        env: &HashMap<String, String>,
        data_dir: &str,
        install_entrypoint: Option<&str>,
    ) -> AgentResult<InstallerHandle> {
        let prepared = self
            .prepare_installer_container_with_entrypoint(
                image,
                script,
                env,
                data_dir,
                install_entrypoint,
            )
            .await?;
        prepared.start().await
    }

    /// Prepare every installer resource without starting the untrusted script.
    /// The returned exact ID can be registered before `start` is invoked. Any
    /// post-registration abandonment must call `PreparedInstallerHandle::cleanup`.
    pub async fn prepare_installer_container_with_entrypoint(
        &self,
        image: &str,
        script: &str,
        env: &HashMap<String, String>,
        data_dir: &str,
        install_entrypoint: Option<&str>,
    ) -> AgentResult<PreparedInstallerHandle> {
        let container_id = format!("catalyst-installer-{}", uuid::Uuid::new_v4());
        let qualified_image = Self::qualify_image_ref(image);
        info!(
            "Spawning installer {} with image: {}",
            container_id, qualified_image
        );
        self.ensure_image(image).await?;
        // Read image configuration before allocating local I/O state. The
        // metadata refactor keeps this bounded; even an interrupted lookup must
        // not leave a dangling installer directory behind.
        let image_metadata = self.get_image_metadata(&qualified_image).await?;

        let io_dir = self.console_log_dir.join(&container_id);
        fs::create_dir_all(&io_dir)
            .map_err(|e| AgentError::ContainerError(format!("mkdir: {}", e)))?;
        // Restrict I/O directory to root-only. A pre-container error or
        // cancelled startup removes this installer-only directory in Drop.
        set_dir_perms(&io_dir, 0o700);
        let mut io_cleanup = InstallerIoDirectoryCleanup {
            path: io_dir.clone(),
            armed: true,
        };
        let stdin_path = io_dir.join("stdin");
        let stdout_path = io_dir.join("stdout");
        let stderr_path = io_dir.join("stderr");
        if stdin_path.exists() {
            fs::remove_file(&stdin_path).ok();
        }
        create_fifo(&stdin_path).map_err(|e| AgentError::ContainerError(format!("fifo: {}", e)))?;
        let stdin_handle = open_fifo_rdwr(&stdin_path)?;
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
        // Installer io_dir is 0700; the bind-mounted file itself must stay
        // world-readable or non-root install steps (steamcmd) lose DNS.
        set_dir_perms(&resolv_path, 0o644);

        let process_args = build_installer_process_args(
            image_metadata.entrypoint.as_deref(),
            install_entrypoint,
            image,
            script,
        )?;
        info!(
            "Installer script entrypoint {:?} and image Entrypoint are preserved (image: {})",
            install_entrypoint, image
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
        // We use `set -e` only for the wrapper preamble, then disable it before
        // the user's script runs. The EXIT trap captures the script's final
        // status, performs best-effort chown, and exits with that saved status.
        // Running the script without `set -e` matches Wings. Unlike Wings,
        // whose wait loop does not inspect the container status code, Catalyst
        // deliberately treats that propagated nonzero status as install failure.
        let wrapped_script = format!(
            "__catalyst_on_exit() {{ __e=$?; /bin/chown -R 1000:1000 /data 2>/dev/null; exit $__e; }}\ntrap '__catalyst_on_exit' EXIT\nset -e\n/bin/rm -rf /mnt/server && /bin/ln -s /data /mnt/server\n# Some eggs also write to /home/container during install\nif [ ! -e /home/container ]; then /bin/ln -s /data /home/container; fi\nexport HOME=/data\nexport USER=container\nset +e\n{}",
            script
        );

        // The substituted script is persisted only inside installer-owned
        // root-exclusive I/O state; don't echo its secrets into agent logs.
        debug!(
            "Installer {} wrapped script prepared ({} bytes)",
            container_id,
            wrapped_script.len()
        );
        let script_path = io_dir.join("install.sh");
        fs::write(&script_path, &wrapped_script)
            .map_err(|e| AgentError::ContainerError(format!("installer script: {}", e)))?;
        set_dir_perms(&script_path, 0o700);
        info!(
            "[DEBUG] Installer {} data_dir mount: {} -> /data",
            container_id, data_dir
        );

        let spec = build_installer_oci_spec(InstallerOciSpecConfig {
            container_id: &container_id,
            data_dir,
            resolv_path: &resolv_path,
            script_path: &script_path,
            process_args,
            image_env: &image_metadata.env,
            working_dir: image_metadata.working_dir.as_deref().unwrap_or("/"),
            overrides: env,
            namespace: &self.namespace,
            cpu_burst_supported: crate::runtime_manager::helpers::kernel_supports_cpu_burst(),
        });
        let spec_any = Any {
            type_url: SPEC_TYPE_URL.to_string(),
            value: spec.to_string().into_bytes(),
        };

        let snap_key = format!("{}-snap", container_id);
        if let Err(e) = self
            .prepare_snapshot_with_config_digest(
                &qualified_image,
                &snap_key,
                Some(&image_metadata.config_digest),
            )
            .await
        {
            // Preparing a snapshot can fail after containerd committed it. The
            // I/O guard still owns the local directory; explicitly release only
            // this install's snapshot so a retry cannot collide with stale state.
            self.remove_snapshot(&snap_key).await;
            let _ = fs::remove_dir_all(&io_dir);
            return Err(e);
        }

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
        if let Err(e) = client.create(req).await {
            self.remove_snapshot(&snap_key).await;
            let _ = fs::remove_dir_all(&io_dir);
            return Err(grpc_err(e));
        }

        info!("Installer {} container created in containerd", container_id);
        io_cleanup.armed = false;

        let mounts = match self.get_snapshot_mounts(&snap_key).await {
            Ok(mounts) => mounts,
            Err(e) => {
                return Err(self.unwind_created_container(&container_id, e).await);
            }
        };
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
        let task = match tasks.create(req).await {
            Ok(task) => task.into_inner(),
            Err(e) => {
                return Err(self
                    .unwind_created_container(&container_id, grpc_err(e))
                    .await);
            }
        };
        let installer_pid = task.pid;
        info!(
            "Installer {} task created, stdout={} stderr={}",
            container_id,
            stdout_path.display(),
            stderr_path.display()
        );

        // Establish CNI while the runc-created task still owns its network
        // namespace, before the untrusted script can perform its first network
        // operation. No arbitrary route-wait timeout is involved.
        if !bypass_cni_for_isolated_test() {
            if let Err(e) = self
                .setup_cni_network(
                    &container_id,
                    installer_pid,
                    Some("bridge"),
                    None,
                    0,
                    &HashMap::new(),
                )
                .await
            {
                warn!("Installer CNI network setup failed: {}", e);
                let primary = AgentError::ContainerError(format!(
                    "Installer CNI network setup failed for {}: {}",
                    container_id, e
                ));
                return Err(self.unwind_created_container(&container_id, primary).await);
            }
        }

        Ok(PreparedInstallerHandle {
            runtime: self.clone(),
            handle: InstallerHandle {
                container_id,
                namespace: self.namespace.clone(),
                channel: self.channel.clone(),
                stdout_path,
                stderr_path,
                console_log_dir: self.console_log_dir.clone(),
                _stdin: stdin_handle,
            },
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
        match tokio::time::timeout(Duration::from_secs(5), tasks.get(get_req)).await {
            Err(_) => {
                return Err(AgentError::ContainerError(format!(
                "Task existence probe timed out for {}; refusing to start over indeterminate state",
                container_id
            )))
            }
            Ok(Ok(resp)) => {
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
                    match tokio::time::timeout(Duration::from_secs(5), tasks.delete(del_req)).await
                    {
                        Ok(Ok(_)) => {}
                        Ok(Err(e)) if e.code() == tonic::Code::NotFound => {}
                        Ok(Err(e)) => return Err(grpc_err(e)),
                        Err(_) => {
                            return Err(AgentError::ContainerError(format!(
                                "Timed out deleting stale task for {}",
                                container_id
                            )))
                        }
                    }
                }
            }
            Ok(Err(e)) if e.code() == tonic::Code::NotFound => {
                // No task exists, proceed normally
            }
            Ok(Err(e)) => {
                return Err(AgentError::ContainerError(format!(
                    "Failed to check task status for {}; refusing to start over indeterminate state: {}",
                    container_id, e
                )));
            }
        }

        let io_ready = self.ensure_container_io(container_id).await?;
        if !io_ready {
            // I/O paths are missing (e.g. a prior failed create cleaned the
            // dir while the container record survived): recreate them instead
            // of handing task create dangling stdio paths.
            let io_dir = self.console_log_dir.join(container_id);
            fs::create_dir_all(&io_dir).map_err(|e| {
                AgentError::ContainerError(format!("Failed to recreate I/O directory: {}", e))
            })?;
            set_dir_perms(&io_dir, 0o700);
            let stdin_path = io_dir.join("stdin");
            if stdin_path.exists() {
                fs::remove_file(&stdin_path).ok();
            }
            create_fifo(&stdin_path).map_err(|e| {
                AgentError::ContainerError(format!("Failed to recreate stdin FIFO: {}", e))
            })?;
            File::create(io_dir.join("stdout"))
                .map_err(|e| AgentError::ContainerError(format!("stdout: {}", e)))?;
            File::create(io_dir.join("stderr"))
                .map_err(|e| AgentError::ContainerError(format!("stderr: {}", e)))?;
            if !self.ensure_container_io(container_id).await? {
                return Err(AgentError::ContainerError(format!(
                    "stdio paths for {} are unavailable and could not be recreated",
                    container_id
                )));
            }
        }
        let snap_key = format!("{}-snap", container_id);
        let mounts = self.get_snapshot_mounts(&snap_key).await.map_err(|e| {
            AgentError::ContainerError(format!(
                "snapshot mounts for {} unavailable (snapshot was GC'd or partially removed; recreate the container): {}",
                snap_key, e
            ))
        })?;
        if mounts.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "snapshot mounts for {} are empty; refusing to start without a rootfs (recreate the container)",
                snap_key
            )));
        }
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
        let create_resp =
            match tokio::time::timeout(Duration::from_secs(5), tasks.create(req)).await {
                Ok(Ok(response)) => response,
                Ok(Err(status)) => {
                    return Err(self
                        .unwind_created_task(container_id, grpc_err(status))
                        .await)
                }
                Err(_) => {
                    // A timed-out create may still have committed the task. Probe
                    // through the same bounded kill/delete unwind rather than
                    // assuming that a transient RPC outcome means absence.
                    let primary = AgentError::ContainerError(format!(
                        "Task creation timed out for {}",
                        container_id
                    ));
                    return Err(self.unwind_created_task(container_id, primary).await);
                }
            };
        let pid = create_resp.into_inner().pid;

        // Re-attach CNI / port-forward / firewall to the new task netns. A
        // failed or incomplete reattach is a failed start: continuing would run
        // an isolated server with missing mappings and no reliable later retry.
        let network_rollback = match self
            .reattach_network_on_start(container_id, pid, container_id)
            .await
        {
            Ok(rollback) => rollback,
            Err(error) => {
                warn!(
                    "Network reattach failed for {} (pid {}): {}",
                    container_id, pid, error
                );
                return Err(self.unwind_created_task(container_id, error).await);
            }
        };

        let req = StartRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let start_result =
            match tokio::time::timeout(Duration::from_secs(5), tasks.start(req)).await {
                Ok(Ok(_)) => Ok(()),
                Ok(Err(status)) => Err(grpc_err(status)),
                Err(_) => Err(AgentError::ContainerError(format!(
                    "Task start timed out for {}",
                    container_id
                ))),
            };
        if let Err(error) = start_result {
            // Preserve this existing container/snapshot/I/O and its desired
            // CNI state. Compensate the successful ADD before deleting only the
            // newly created task; all primary and cleanup errors are retained.
            let primary = match network_rollback {
                Some(rollback) => rollback.rollback(self, error).await,
                None => error,
            };
            return Err(self.unwind_created_task(container_id, primary).await);
        }
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
                // Bounded second wait: never rely on wait_for_exit's 90s
                // backstop here or every wedged stop stalls for over a minute.
                let _ =
                    tokio::time::timeout(Duration::from_secs(10), self.wait_for_exit(container_id))
                        .await;
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

    /// Kill/wait/delete one task without converting transport errors into an
    /// already-absent result. Every operation has its own bound and every
    /// remaining operation is attempted after an earlier failure.
    async fn cleanup_created_task(&self, container_id: &str) -> AgentResult<()> {
        const RPC_TIMEOUT: Duration = Duration::from_secs(3);
        let mut errors = Vec::new();
        let mut tasks = TasksClient::new(self.channel.clone());

        let kill = TaskKillRequest {
            container_id: container_id.to_string(),
            signal: 9,
            all: true,
            ..Default::default()
        };
        let kill = with_namespace!(kill, &self.namespace);
        match tokio::time::timeout(RPC_TIMEOUT, tasks.kill(kill)).await {
            Ok(Ok(_)) => {}
            Ok(Err(status))
                if installer_cleanup_status_is_complete(
                    InstallerCleanupOperation::TaskKill,
                    &status,
                ) => {}
            Ok(Err(status)) => errors.push(format!(
                "task kill: containerd {:?}: {}",
                status.code(),
                status.message()
            )),
            Err(_) => errors.push("task kill: timed out after 3s".to_string()),
        }

        let wait = WaitRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let wait = with_namespace!(wait, &self.namespace);
        match tokio::time::timeout(RPC_TIMEOUT, tasks.wait(wait)).await {
            Ok(Ok(_)) => {}
            Ok(Err(status))
                if installer_cleanup_status_is_complete(
                    InstallerCleanupOperation::TaskWait,
                    &status,
                ) => {}
            Ok(Err(status)) => errors.push(format!(
                "task wait: containerd {:?}: {}",
                status.code(),
                status.message()
            )),
            Err(_) => errors.push("task wait: timed out after 3s".to_string()),
        }

        let delete = DeleteTaskRequest {
            container_id: container_id.to_string(),
        };
        let delete = with_namespace!(delete, &self.namespace);
        let task_deleted = match tokio::time::timeout(RPC_TIMEOUT, tasks.delete(delete)).await {
            Ok(Ok(_)) => true,
            Ok(Err(status))
                if installer_cleanup_status_is_complete(
                    InstallerCleanupOperation::TaskDelete,
                    &status,
                ) =>
            {
                true
            }
            Ok(Err(status)) => {
                errors.push(format!(
                    "task delete: containerd {:?}: {}",
                    status.code(),
                    status.message()
                ));
                false
            }
            Err(_) => {
                errors.push("task delete: timed out after 3s".to_string());
                false
            }
        };

        if task_deleted || errors.is_empty() {
            // A confirmed successful delete supersedes earlier kill/wait transport
            // errors; otherwise those indeterminate outcomes stay in the error.
            Ok(())
        } else {
            Err(AgentError::ContainerError(format!(
                "task cleanup incomplete for {}: {}",
                container_id,
                errors.join("; ")
            )))
        }
    }

    async fn unwind_created_container(
        &self,
        container_id: &str,
        primary: AgentError,
    ) -> AgentError {
        let cleanup = match tokio::time::timeout(
            Duration::from_secs(90),
            self.remove_container(container_id),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AgentError::ContainerError(format!(
                "full-stack cleanup for {} timed out after 90s",
                container_id
            ))),
        };
        combine_primary_cleanup(primary, cleanup)
    }

    async fn unwind_created_task(&self, container_id: &str, primary: AgentError) -> AgentError {
        let cleanup = match tokio::time::timeout(
            Duration::from_secs(15),
            self.cleanup_created_task(container_id),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AgentError::ContainerError(format!(
                "created-task cleanup for {} timed out after 15s",
                container_id
            ))),
        };
        combine_primary_cleanup(primary, cleanup)
    }

    pub async fn remove_container(&self, container_id: &str) -> AgentResult<()> {
        const RPC_TIMEOUT: Duration = Duration::from_secs(3);
        info!("Removing container: {}", container_id);
        let mut errors = Vec::new();

        // CNI DEL needs the current task netns, so network cleanup precedes
        // task deletion. Its error is retained and all later stages still run.
        FirewallManager::remove_server_ports(container_id).await;
        if let Err(error) = self.teardown_cni_network(container_id).await {
            errors.push(format!("CNI teardown: {}", error));
        }
        if let Err(error) = self.cleanup_created_task(container_id).await {
            errors.push(error.to_string());
        }

        let mut client = ContainersClient::new(self.channel.clone());
        let delete = DeleteContainerRequest {
            id: container_id.to_string(),
        };
        let delete = with_namespace!(delete, &self.namespace);
        match tokio::time::timeout(RPC_TIMEOUT, client.delete(delete)).await {
            Ok(Ok(_)) => {}
            Ok(Err(status))
                if installer_cleanup_status_is_complete(
                    InstallerCleanupOperation::ContainerDelete,
                    &status,
                ) => {}
            Ok(Err(status)) => errors.push(format!(
                "container delete: containerd {:?}: {}",
                status.code(),
                status.message()
            )),
            Err(_) => errors.push("container delete: timed out after 3s".to_string()),
        }

        let snap_key = format!("{}-snap", container_id);
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let remove = RemoveSnapshotRequest {
            snapshotter: "overlayfs".to_string(),
            key: snap_key,
        };
        let remove = with_namespace!(remove, &self.namespace);
        match tokio::time::timeout(RPC_TIMEOUT, snaps.remove(remove)).await {
            Ok(Ok(_)) => {}
            Ok(Err(status))
                if installer_cleanup_status_is_complete(
                    InstallerCleanupOperation::SnapshotRemove,
                    &status,
                ) => {}
            Ok(Err(status)) => errors.push(format!(
                "snapshot remove: containerd {:?}: {}",
                status.code(),
                status.message()
            )),
            Err(_) => errors.push("snapshot remove: timed out after 3s".to_string()),
        }

        self.container_io.lock().await.remove(container_id);
        self.cgroup_paths.write().await.remove(container_id);
        self.cpu_tracker.remove(container_id).await;
        match tokio::time::timeout(
            RPC_TIMEOUT,
            tokio::fs::remove_dir_all(self.console_log_dir.join(container_id)),
        )
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(Err(error)) => errors.push(format!("I/O directory remove: {}", error)),
            Err(_) => errors.push("I/O directory remove: timed out after 3s".to_string()),
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(AgentError::ContainerError(format!(
                "container cleanup incomplete for {}: {}",
                container_id,
                errors.join("; ")
            )))
        }
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
            // Non-blocking bounded write: the stdin FIFO is opened O_RDWR so
            // the pipe always has a "reader" (ourselves) — a blocking
            // write_all on a full 64K pipe would park this pool thread
            // forever with no EPIPE, leaking one blocking-pool thread per
            // large/pasted input to a non-reading container. Instead the
            // clone is switched to O_NONBLOCK and EAGAIN is retried within a
            // 5s budget, so the worker thread always terminates.
            // (O_NONBLOCK lives on the shared open file description; every
            // writer goes through this path, so the mode is consistent.)
            let deadline = Instant::now() + Duration::from_secs(5);
            let write_fut = spawn_blocking(move || {
                helpers::write_fifo_until(&h, input.as_bytes(), deadline)
                    .map_err(|e| AgentError::ContainerError(format!("stdin: {}", e)))
            });
            match tokio::time::timeout(Duration::from_secs(6), write_fut).await {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(e))) => return Err(e),
                Ok(Err(join_err)) => {
                    return Err(AgentError::ContainerError(format!(
                        "stdin write task failed: {}",
                        join_err
                    )));
                }
                Err(_) => {
                    return Err(AgentError::ContainerError(
                        "stdin write timed out: container is not reading input".to_string(),
                    ));
                }
            }
            return Ok(());
        }

        if !has_io {
            warn!(
                "No stdin FIFO found for {}, falling back to exec-based stdin injection",
                container_id
            );
        }

        // Fallback: exec `cat > /proc/1/fd/0` as uid 1000 (mirrors the
        // runtime posture; see exec()).
        let exec_id = format!("stdin-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let io_dir = self.console_log_dir.join(container_id);
        let ep = io_dir.join(format!("e-{}-in", exec_id));
        let eo = io_dir.join(format!("e-{}-out", exec_id));
        if ep.exists() {
            fs::remove_file(&ep).ok();
        }
        create_fifo(&ep).ok();
        File::create(&eo).ok();
        let spec = serde_json::json!({"args":["sh","-c","exec cat > /proc/1/fd/0"],"user":{"uid":1000,"gid":1000},"env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],"cwd":"/"});
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
        if let Err(e) = tasks.exec(req).await {
            self.delete_exec_process(container_id, &exec_id).await;
            let _ = fs::remove_file(&ep);
            let _ = fs::remove_file(&eo);
            return Err(grpc_err(e));
        }
        let req = StartRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        if let Err(e) = tasks.start(req).await {
            self.delete_exec_process(container_id, &exec_id).await;
            let _ = fs::remove_file(&ep);
            let _ = fs::remove_file(&eo);
            return Err(grpc_err(e));
        }
        let epc = ep.clone();
        let input_owned = input.to_string();
        // The worker itself must finish: a timeout on its join handle alone
        // cannot cancel a blocking open when the exec'd reader has exited.
        let deadline = Instant::now() + Duration::from_secs(5);
        let write_result = spawn_blocking(move || {
            helpers::write_fifo_path_until(&epc, input_owned.as_bytes(), deadline)
                .map_err(|e| AgentError::ContainerError(format!("stdin fallback: {}", e)))
        })
        .await
        .map_err(|e| AgentError::ContainerError(format!("stdin fallback worker failed: {}", e)))
        .and_then(|result| result);
        let req = WaitRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        // Closing the writer sends EOF to cat. Give it time to deliver the
        // bytes before reaping; on failure or a stuck cat, kill this exec only.
        let exited = write_result.is_ok()
            && matches!(
                tokio::time::timeout(Duration::from_secs(3), tasks.wait(req)).await,
                Ok(Ok(_))
            );
        if exited {
            self.delete_exec_process(container_id, &exec_id).await;
        } else {
            self.terminate_exec_process(container_id, &exec_id).await;
        }
        let _ = fs::remove_file(&ep);
        let _ = fs::remove_file(&eo);
        write_result
    }

    /// Reap installer containers orphaned by a previous agent process (kill or
    /// restart mid-install). Installers carry no labels and the in-memory
    /// `active_installs` map does not survive restarts, so match by the
    /// `catalyst-installer-` ID prefix (UUID-suffixed; never collides with
    /// server IDs). Without this, a detached installer holds its 2 GiB
    /// cgroup, /data bind, IPAM lease, and io_dir with no waiter and no
    /// exit monitor. Returns the number of installers reaped.
    pub async fn cleanup_stale_installers(&self) -> usize {
        let containers = match self.list_containers().await {
            Ok(c) => c,
            Err(e) => {
                warn!("installer sweep: cannot list containers: {}", e);
                return 0;
            }
        };
        let mut reaped = 0;
        for c in containers {
            if !c.id.starts_with("catalyst-installer-") {
                continue;
            }
            info!("Reaping stale installer container {}", c.id);
            match self.remove_container(&c.id).await {
                Ok(()) => reaped += 1,
                Err(error) => warn!(
                    "Failed to reap stale installer {}; it is not counted as cleaned: {}",
                    c.id, error
                ),
            }
        }
        reaped
    }

    pub async fn restore_console_writers(&self) -> AgentResult<()> {
        info!("Restoring console writers for running containers");
        let containers = self.list_containers().await?;
        let mut restored = 0;
        let mut missing_fifo = 0;
        for c in containers {
            if !c.status.contains("Up") {
                continue;
            }
            match self.ensure_container_io(&c.id).await {
                Ok(true) => restored += 1,
                Ok(false) => {
                    missing_fifo += 1;
                    warn!(
                        "No stdin FIFO for running container {}: console input degraded to exec fallback",
                        c.id
                    );
                }
                Err(e) => {
                    warn!("Failed to restore console writer for {}: {}", c.id, e);
                }
            }
        }
        info!(
            "Console writer restoration: {} restored, {} missing FIFO",
            restored, missing_fifo
        );
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
        // Status checks run concurrently (bounded) with per-item timeouts: a
        // sequential N+1 of unbounded task.get RPCs lets one wedged task
        // stall the whole listing (and every 5s-tick consumer of it).
        let semaphore = Arc::new(tokio::sync::Semaphore::new(16));
        let mut set = tokio::task::JoinSet::new();
        for c in resp.into_inner().containers {
            let permit_owner = semaphore.clone();
            let channel = self.channel.clone();
            let namespace = self.namespace.clone();
            set.spawn(async move {
                let _permit = permit_owner.acquire_owned().await;
                let mut tasks = TasksClient::new(channel);
                let req = containerd_client::services::v1::GetRequest {
                    container_id: c.id.clone(),
                    ..Default::default()
                };
                let req = with_namespace!(req, &namespace);
                let running = tokio::time::timeout(Duration::from_secs(5), tasks.get(req))
                    .await
                    .ok()
                    .and_then(|r| r.ok())
                    .and_then(|resp| resp.into_inner().process)
                    .map(|p| p.status == 2)
                    .unwrap_or(false);
                (c, running)
            });
        }
        let mut result = Vec::new();
        while let Some(joined) = set.join_next().await {
            let Ok((c, running)) = joined else {
                continue;
            };
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
        // Keep listing order deterministic for consumers and tests.
        result.sort_by(|a, b| a.id.cmp(&b.id));

        {
            let mut cache = self.container_list_cache.write().await;
            *cache = (result.clone(), Instant::now());
        }
        Ok(result)
    }

    /// Strict liveness primitive for destructive reconciliation. Only an
    /// explicit containerd NotFound proves absence; transport failures,
    /// deadlines and malformed successful replies remain indeterminate errors.
    pub(crate) async fn container_existence(&self, container_id: &str) -> AgentResult<bool> {
        let mut client = ContainersClient::new(self.channel.clone());
        let req = GetContainerRequest {
            id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        match tokio::time::timeout(Duration::from_secs(5), client.get(req)).await {
            Ok(Ok(response)) => {
                if response.into_inner().container.is_some() {
                    Ok(true)
                } else {
                    Err(AgentError::ContainerError(format!(
                        "container existence probe for {} returned no container record",
                        container_id
                    )))
                }
            }
            Ok(Err(status)) if status.code() == tonic::Code::NotFound => Ok(false),
            Ok(Err(status)) => Err(grpc_err(status)),
            Err(_) => Err(AgentError::ContainerError(format!(
                "container existence probe timed out for {}",
                container_id
            ))),
        }
    }

    /// Compatibility predicate for non-reconciliation UI/status callers.
    /// Destructive startup cleanup MUST use `container_existence`: folding an
    /// indeterminate Get failure into `false` would classify live state as an
    /// orphan. Keep this conservative by returning true on such failures.
    pub async fn container_exists(&self, container_id: &str) -> bool {
        match self.container_existence(container_id).await {
            Ok(exists) => exists,
            Err(error) => {
                warn!(
                    "Cannot determine whether container {} exists; preserving it: {}",
                    container_id, error
                );
                true
            }
        }
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

    /// Host-side source of the container's `/data` bind mount, read from the
    /// stored OCI spec.
    ///
    /// Disk-usage reporting resolves the data dir through the in-memory
    /// `start_server_messages` map (server.id → server.uuid). That map is empty
    /// after an agent restart, so a server that was already running reported 0
    /// used until it was restarted and the map repopulated. The spec is written
    /// at container creation and survives restarts, so it is the durable
    /// fallback.
    pub async fn container_data_dir(&self, container_id: &str) -> AgentResult<Option<String>> {
        let mut client = ContainersClient::new(self.channel.clone());
        let req = GetContainerRequest {
            id: container_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tokio::time::timeout(Duration::from_secs(5), client.get(req))
            .await
            .map_err(|_| AgentError::ContainerError("container_data_dir timed out".to_string()))?
            .map_err(grpc_err)?;

        let Some(container) = resp.into_inner().container else {
            return Ok(None);
        };
        let Some(spec_any) = container.spec else {
            return Ok(None);
        };
        if spec_any.type_url != SPEC_TYPE_URL {
            return Ok(None);
        }
        let Ok(spec_value) = serde_json::from_slice::<serde_json::Value>(&spec_any.value) else {
            return Ok(None);
        };
        Ok(data_dir_from_spec(&spec_value))
    }

    pub async fn is_container_running(&self, container_id: &str) -> AgentResult<bool> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        // Bounded: a wedged containerd must not park status polls forever.
        // Callers on hot paths (health ticks, log tails) run this frequently.
        match tokio::time::timeout(Duration::from_secs(5), tasks.get(req)).await {
            Ok(Ok(resp)) => Ok(resp
                .into_inner()
                .process
                .map(|p| p.status == 2)
                .unwrap_or(false)),
            Ok(Err(e)) if e.code() == tonic::Code::NotFound => Ok(false),
            Ok(Err(e)) => Err(grpc_err(e)),
            Err(_) => Err(AgentError::ContainerError(format!(
                "is_container_running timed out for {}",
                container_id
            ))),
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
        match tokio::time::timeout(Duration::from_secs(5), tasks.get(req)).await {
            Ok(Ok(resp)) => Ok(resp.into_inner().process.map(|p| p.pid)),
            Ok(Err(e)) if e.code() == tonic::Code::NotFound => Ok(None),
            Ok(Err(e)) => Err(grpc_err(e)),
            Err(_) => Err(AgentError::ContainerError(format!(
                "get_container_task_pid timed out for {}",
                container_id
            ))),
        }
    }

    pub async fn get_container_exit_code(&self, container_id: &str) -> AgentResult<Option<i32>> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        match tokio::time::timeout(Duration::from_secs(5), tasks.get(req)).await {
            Ok(Ok(resp)) => Ok(resp.into_inner().process.and_then(|p| {
                if p.status == 3 {
                    Some(p.exit_status as i32)
                } else {
                    None
                }
            })),
            Ok(_) => Ok(None),
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
                                // host-local lease files start with the owning
                                // container ID (`<id>\r\n<ifname>`); a substring
                                // test could match a different container.
                                if cni_network::lease_belongs_to(&c, container_id) {
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
            cpu_throttling: if cg.is_empty() {
                None
            } else {
                read_cgroup_cpu_throttling(&cg).await
            },
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

        // Exec processes inherit the runtime container posture (uid 1000,
        // minimal caps, noNewPrivileges). An exec spec without `user`
        // defaults to uid 0 — a root shell in a uid-1000 container.
        let caps = ["CAP_NET_BIND_SERVICE"];
        let spec = serde_json::json!({"args":command,
            "user":{"uid":1000,"gid":1000},
            "capabilities":{"bounding":caps,"effective":caps,"permitted":caps,"ambient":caps},
            "noNewPrivileges":true,
            "env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],"cwd":"/data"});
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
        if let Err(e) = tasks.exec(req).await {
            self.delete_exec_process(container_id, &exec_id).await;
            let _ = fs::remove_file(&op);
            let _ = fs::remove_file(&ep);
            return Err(grpc_err(e));
        }

        let req = StartRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        if let Err(e) = tasks.start(req).await {
            self.delete_exec_process(container_id, &exec_id).await;
            let _ = fs::remove_file(&op);
            let _ = fs::remove_file(&ep);
            return Err(grpc_err(e));
        }

        let req = WaitRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        let wait_error = match tokio::time::timeout(Duration::from_secs(30), tasks.wait(req)).await
        {
            Ok(Ok(_)) => None,
            Ok(Err(error)) => Some(grpc_err(error)),
            Err(_) => Some(AgentError::ContainerError(
                "Exec timed out after 30s".to_string(),
            )),
        };
        if let Some(error) = wait_error {
            self.terminate_exec_process(container_id, &exec_id).await;
            let _ = fs::remove_file(&op);
            let _ = fs::remove_file(&ep);
            return Err(error);
        }
        self.delete_exec_process(container_id, &exec_id).await;

        let out = tokio::fs::read_to_string(&op).await.unwrap_or_default();
        let err = tokio::fs::read_to_string(&ep).await.unwrap_or_default();
        let _ = fs::remove_file(&op);
        let _ = fs::remove_file(&ep);
        if !err.is_empty() && out.is_empty() {
            return Err(AgentError::ContainerError(format!("Exec failed: {}", err)));
        }
        Ok(out)
    }

    /// Kill only the requested exec, not the game container's init process.
    /// Bound cleanup RPCs as well, so a wedged shim cannot pin a worker task.
    async fn terminate_exec_process(&self, container_id: &str, exec_id: &str) {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = TaskKillRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.to_string(),
            signal: Signal::SIGKILL as u32,
            all: false,
        };
        let req = with_namespace!(req, &self.namespace);
        match tokio::time::timeout(Duration::from_secs(3), tasks.kill(req)).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) if is_not_found(&error) => {}
            result => warn!(
                "Exec cleanup kill failed for {} in {}: {:?}",
                exec_id, container_id, result
            ),
        }
        let req = WaitRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tokio::time::timeout(Duration::from_secs(3), tasks.wait(req)).await;
        self.delete_exec_process(container_id, exec_id).await;
    }

    /// Best-effort reap of an exec'd process entry (DeleteProcess).
    pub(crate) async fn delete_exec_process(&self, container_id: &str, exec_id: &str) {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::DeleteProcessRequest {
            container_id: container_id.to_string(),
            exec_id: exec_id.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        match tokio::time::timeout(Duration::from_secs(3), tasks.delete_process(req)).await {
            Ok(Ok(_)) => {}
            result => debug!(
                "delete exec {} in {} failed (may already be gone): {:?}",
                exec_id, container_id, result
            ),
        }
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
        // Backstop only: every caller enforces its own (shorter) deadline, so
        // this must stay strictly above all of them. A shorter inner timeout
        // would fire first and its Err is indistinguishable from a real exit
        // at some call sites (silent early-kill of graceful stops).
        let resp = tokio::time::timeout(Duration::from_secs(90), tasks.wait(req))
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

    /// Best-effort removal of a prepared snapshot under `snap_key`.
    /// Used to unwind failed creates before any container record exists.
    pub(crate) async fn remove_snapshot(&self, snap_key: &str) {
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let req = RemoveSnapshotRequest {
            snapshotter: "overlayfs".to_string(),
            key: snap_key.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        if let Err(e) = snaps.remove(req).await {
            debug!(
                "snapshot remove {} failed (may already be gone): {}",
                snap_key, e
            );
        }
    }

    /// Drop in-memory I/O + cgroup state and the io_dir for a container that
    /// never reached a running task (create-path unwind). Unlike the old
    /// `cleanup_io`, this also removes the `container_io`/`cgroup_paths` map
    /// entries so later `send_input`/`get_stats` don't use stale handles.
    pub(crate) async fn remove_io_state(&self, container_id: &str) {
        self.container_io.lock().await.remove(container_id);
        self.cgroup_paths.write().await.remove(container_id);
        let _ = fs::remove_dir_all(self.console_log_dir.join(container_id));
    }
}

/// An installer whose record, task, snapshot, I/O and CNI exist, but whose
/// process has not been started. Consuming `start` prevents a second Start;
/// consuming `cleanup` explicitly releases a prepared-but-cancelled attempt.
pub struct PreparedInstallerHandle {
    runtime: ContainerdRuntime,
    handle: InstallerHandle,
}

impl PreparedInstallerHandle {
    pub fn container_id(&self) -> &str {
        &self.handle.container_id
    }

    pub async fn start(self) -> AgentResult<InstallerHandle> {
        let Self { runtime, handle } = self;
        let container_id = handle.container_id.clone();
        let mut tasks = TasksClient::new(handle.channel.clone());
        let req = StartRequest {
            container_id: container_id.clone(),
            ..Default::default()
        };
        let req = with_namespace!(req, &handle.namespace);
        let result = match tokio::time::timeout(Duration::from_secs(5), tasks.start(req)).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(status)) => Err(grpc_err(status)),
            Err(_) => Err(AgentError::ContainerError(format!(
                "Installer task start timed out for {}",
                container_id
            ))),
        };
        if let Err(primary) = result {
            // Start may have committed before an error/deadline. Full-stack
            // unwind kills/deletes that task and only its own CNI/container/
            // snapshot/I/O, retaining primary and cleanup diagnostics.
            return Err(runtime
                .unwind_created_container(&container_id, primary)
                .await);
        }
        info!(
            "Installer {} task started after pre-registration",
            container_id
        );
        Ok(handle)
    }

    pub async fn cleanup(self) -> AgentResult<()> {
        match tokio::time::timeout(
            Duration::from_secs(90),
            self.runtime.remove_container(self.container_id()),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AgentError::ContainerError(format!(
                "Prepared installer cleanup for {} timed out after 90s",
                self.container_id()
            ))),
        }
    }
}

/// Keep the start/create failure primary while making an incomplete unwind
/// visible to the caller instead of silently returning a best-effort success.
fn combine_primary_cleanup(primary: AgentError, cleanup: AgentResult<()>) -> AgentError {
    match cleanup {
        Ok(()) => primary,
        Err(cleanup) => {
            AgentError::ContainerError(format!("{}; cleanup also failed: {}", primary, cleanup))
        }
    }
}

struct InstallerIoDirectoryCleanup {
    path: PathBuf,
    armed: bool,
}

impl Drop for InstallerIoDirectoryCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

/// Offline OCI execution is allowed only in explicitly requested test builds:
/// this harness does not have CAP_NET_ADMIN for creating CNI state. Production
/// binaries always execute the real CNI setup path above.
fn bypass_cni_for_isolated_test() -> bool {
    #[cfg(test)]
    {
        std::env::var_os("CATALYST_TEST_SKIP_CNI").is_some_and(|value| value == "1")
    }
    #[cfg(not(test))]
    {
        false
    }
}

const INSTALLER_SCRIPT_DESTINATION: &str = "/mnt/install/install.sh";

/// Wings gives the egg's selected entrypoint a real script file. The image
/// Entrypoint remains in front, while the image Cmd is replaced by this command.
fn build_installer_process_args(
    image_entrypoint: Option<&[String]>,
    install_entrypoint: Option<&str>,
    image: &str,
    script: &str,
) -> AgentResult<Vec<String>> {
    if let Some(entrypoint) = install_entrypoint {
        if entrypoint.is_empty() || entrypoint.trim() != entrypoint || entrypoint.contains('\0') {
            return Err(AgentError::InvalidRequest(
                "installEntrypoint must be one non-empty, untrimmed executable argument"
                    .to_string(),
            ));
        }
    }
    let interpreter = match install_entrypoint {
        // The database's standard shell entrypoint is a compatibility request,
        // not a promise that the selected image contains that exact binary.
        // Keep the historical Alpine/non-Alpine mapping for those two values;
        // genuinely custom executables must reach process.args unchanged.
        Some("bash" | "ash") | None => detect_install_interpreter(image, script).0.to_string(),
        Some(entrypoint) => entrypoint.to_string(),
    };
    let mut args = image_entrypoint
        .map(|entrypoint| entrypoint.to_vec())
        .unwrap_or_default();
    args.push(interpreter);
    args.push(INSTALLER_SCRIPT_DESTINATION.to_string());
    Ok(args)
}

/// Inputs for the pure installer OCI builder.
pub(crate) struct InstallerOciSpecConfig<'a> {
    pub container_id: &'a str,
    pub data_dir: &'a str,
    pub resolv_path: &'a Path,
    pub script_path: &'a Path,
    pub process_args: Vec<String>,
    pub image_env: &'a [String],
    pub working_dir: &'a str,
    pub overrides: &'a HashMap<String, String>,
    pub namespace: &'a str,
    pub cpu_burst_supported: bool,
}

/// Construct the complete installer OCI spec without I/O. Keeping the image
/// environment and panel overrides as inputs makes this the testable boundary
/// for image retrieval, environment merging, and `process.env` wiring.
/// `process_args` includes the compatibility-wrapped script.
pub(crate) fn build_installer_oci_spec(config: InstallerOciSpecConfig<'_>) -> serde_json::Value {
    let InstallerOciSpecConfig {
        container_id,
        data_dir,
        resolv_path,
        script_path,
        process_args,
        image_env,
        working_dir,
        overrides,
        namespace,
        cpu_burst_supported,
    } = config;
    let process_env = build_installer_env(image_env, overrides);
    let caps = installer_capabilities();

    // Keep /tmp executable for stock eggs that run downloaded helpers. Its
    // size is bounded because tmpfs pages count against installer memory.
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
        "destination": INSTALLER_SCRIPT_DESTINATION,
        "type": "bind",
        "source": script_path.to_string_lossy().to_string(),
        "options": ["rbind", "ro", "nosuid", "nodev"]
    }));
    mounts.push(serde_json::json!({
        "destination": "/tmp",
        "type": "tmpfs",
        "source": "tmpfs",
        "options": ["nosuid", "nodev", "mode=1777", "size=1073741824"]
    }));

    let mut spec = serde_json::json!({
        "ociVersion": "1.1.0",
        "process": {
            "terminal": false,
            "user": {"uid": 0, "gid": 0},
            "args": process_args,
            "env": process_env,
            "cwd": working_dir,
            "capabilities": {
                "bounding": caps,
                "effective": caps,
                "permitted": caps,
                "ambient": caps
            },
            "noNewPrivileges": true
        },
        "root": {"path": "rootfs", "readonly": false},
        "hostname": container_id,
        "mounts": mounts,
        "linux": {
            "namespaces": installer_namespaces(),
            "maskedPaths": masked_paths(),
            "readonlyPaths": readonly_paths(),
            "seccomp": default_seccomp_profile(),
            // Install scripts are attacker-influenced and need the same
            // resource discipline as runtime containers.
            "cgroupsPath": format!("/{}/{}", namespace, container_id),
            "resources": {
                "memory": {"limit": 2147483648i64, "swap": 2147483648i64},
                "cpu": {
                    "shares": 1024i64,
                    "quota": 200000i64,
                    "period": 100000i64,
                    "weight": 200u64,
                },
                "pids": {"limit": 2048i64},
                "unified": {"cpu.weight": "200"},
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
    if cpu_burst_supported {
        spec["linux"]["resources"]["cpu"]["burst"] = serde_json::json!(200000u64);
    }
    spec
}

#[cfg(test)]
mod installer_spec_tests {
    use super::{
        build_installer_oci_spec, build_installer_process_args, InstallerIoDirectoryCleanup,
        InstallerOciSpecConfig, INSTALLER_SCRIPT_DESTINATION,
    };
    use crate::runtime_manager::{ContainerdRuntime, ContainerdRuntimeConfig};
    use serde_json::Value;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn spec_with_env(image_env: &[String], overrides: &HashMap<String, String>) -> Value {
        build_installer_oci_spec(InstallerOciSpecConfig {
            container_id: "catalyst-installer-test",
            data_dir: "/host/server-data",
            resolv_path: Path::new("/private-test-io/resolv.conf"),
            script_path: Path::new("/private-test-io/install.sh"),
            working_dir: "/",
            process_args: strings(&["bash", "-c", "echo installer args"]),
            image_env,
            overrides,
            namespace: "catalyst-test-isolated",
            cpu_burst_supported: false,
        })
    }

    fn process_env(spec: &Value) -> HashMap<String, String> {
        let entries = spec
            .pointer("/process/env")
            .and_then(Value::as_array)
            .expect("installer process.env must be an array");
        let map: HashMap<String, String> = entries
            .iter()
            .map(|entry| {
                let entry = entry.as_str().expect("environment entry string");
                let (key, value) = entry.split_once('=').expect("KEY=VALUE");
                (key.to_string(), value.to_string())
            })
            .collect();
        assert_eq!(map.len(), entries.len(), "duplicate keys in process.env");
        map
    }

    #[test]
    fn installer_spec_wires_image_env_panel_values_and_java_fallback() {
        let spec = spec_with_env(
            &strings(&[
                "PATH=/opt/custom-image-jdk/bin:/usr/local/bin:/usr/bin:/bin",
                "JAVA_HOME=/opt/custom-image-jdk",
                "LANG=en_US.UTF-8",
            ]),
            &HashMap::from([
                ("FABRIC_VERSION".to_string(), "1.2.3".to_string()),
                ("SERVER_JARFILE".to_string(), "server.jar".to_string()),
            ]),
        );

        let env = process_env(&spec);
        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some("/opt/custom-image-jdk/bin:/usr/local/bin:/usr/bin:/bin:/opt/java/openjdk/bin"),
            "the exact image PATH must reach process.env before a literal Temurin fallback"
        );
        assert_eq!(
            env.get("JAVA_HOME").map(String::as_str),
            Some("/opt/custom-image-jdk")
        );
        assert_eq!(env.get("LANG").map(String::as_str), Some("en_US.UTF-8"));
        assert_eq!(env.get("FABRIC_VERSION").map(String::as_str), Some("1.2.3"));
        assert_eq!(
            env.get("SERVER_JARFILE").map(String::as_str),
            Some("server.jar")
        );
        assert_eq!(env.get("TERM").map(String::as_str), Some("xterm"));
        assert_eq!(
            spec.pointer("/process/args"),
            Some(&serde_json::json!(["bash", "-c", "echo installer args"]))
        );
    }

    #[test]
    fn installer_spec_panel_collisions_and_path_bytes_reach_process_env() {
        let original_path = " /opt/eclipse-adoptium/bin::/usr/bin:\t";
        let spec = spec_with_env(
            &strings(&[
                "PATH=/image/bin:/usr/bin",
                "JAVA_HOME=/image-jdk",
                "COLLIDES=image",
                "TERM=vt100",
            ]),
            &HashMap::from([
                ("PATH".to_string(), original_path.to_string()),
                ("JAVA_HOME".to_string(), "/panel-jdk".to_string()),
                ("COLLIDES".to_string(), "panel".to_string()),
                ("TERM".to_string(), String::new()),
            ]),
        );

        let env = process_env(&spec);
        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some(" /opt/eclipse-adoptium/bin::/usr/bin:\t:/opt/java/openjdk/bin"),
            "panel PATH bytes and JDK priority must survive into process.env"
        );
        assert_eq!(env.get("JAVA_HOME").map(String::as_str), Some("/panel-jdk"));
        assert_eq!(env.get("COLLIDES").map(String::as_str), Some("panel"));
        assert_eq!(env.get("TERM").map(String::as_str), Some(""));
    }

    #[test]
    fn installer_spec_filters_only_shell_startup_controls() {
        let spec = spec_with_env(
            &strings(&[
                "SHELLOPTS=xtrace:verbose",
                "BASHOPTS=extdebug",
                "BASH_ENV=/image/startup",
                "LANG=C.UTF-8",
                "HTTPS_PROXY=http://proxy.example:8443",
            ]),
            &HashMap::from([
                ("ENV".to_string(), "/panel/startup".to_string()),
                ("POSIXLY_CORRECT".to_string(), "1".to_string()),
                ("LC_ALL".to_string(), "en_US.UTF-8".to_string()),
                ("NO_PROXY".to_string(), "localhost".to_string()),
            ]),
        );

        let env = process_env(&spec);
        for key in [
            "SHELLOPTS",
            "BASHOPTS",
            "BASH_ENV",
            "ENV",
            "POSIXLY_CORRECT",
        ] {
            assert!(!env.contains_key(key), "{} leaked into process.env", key);
        }
        assert_eq!(env.get("LANG").map(String::as_str), Some("C.UTF-8"));
        assert_eq!(env.get("LC_ALL").map(String::as_str), Some("en_US.UTF-8"));
        assert_eq!(
            env.get("HTTPS_PROXY").map(String::as_str),
            Some("http://proxy.example:8443")
        );
        assert_eq!(env.get("NO_PROXY").map(String::as_str), Some("localhost"));
    }

    #[test]
    fn installer_spec_retains_mount_resource_and_burst_semantics() {
        let without_burst = spec_with_env(&[], &HashMap::new());
        assert_eq!(
            without_burst.pointer("/linux/cgroupsPath"),
            Some(&serde_json::json!(
                "/catalyst-test-isolated/catalyst-installer-test"
            ))
        );
        assert_eq!(without_burst.pointer("/linux/resources/cpu/burst"), None);
        assert_eq!(
            without_burst.pointer("/linux/resources/memory/limit"),
            Some(&serde_json::json!(2147483648i64))
        );
        assert_eq!(
            without_burst.pointer("/process/cwd"),
            Some(&serde_json::json!("/"))
        );
        assert!(without_burst["mounts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|mount| {
                mount["destination"] == "/etc/resolv.conf"
                    && mount["source"] == "/private-test-io/resolv.conf"
            }));

        let with_burst = build_installer_oci_spec(InstallerOciSpecConfig {
            container_id: "catalyst-installer-test",
            data_dir: "/host/server-data",
            resolv_path: Path::new("/private-test-io/resolv.conf"),
            script_path: Path::new("/private-test-io/install.sh"),
            working_dir: "/",
            process_args: strings(&["bash", "-c", "true"]),
            image_env: &[],
            overrides: &HashMap::new(),
            namespace: "catalyst-test-isolated",
            cpu_burst_supported: true,
        });
        assert_eq!(
            with_burst.pointer("/linux/resources/cpu/burst"),
            Some(&serde_json::json!(200000u64))
        );
    }

    #[test]
    fn installer_arguments_preserve_image_wrapper_and_use_a_real_script_path() {
        let image_wrapper = strings(&["/usr/bin/tini", "-g", "--"]);
        let args = build_installer_process_args(
            Some(&image_wrapper),
            Some("/opt/custom-engine"),
            "eclipse-temurin:21-jdk-jammy",
            "#!/bin/bash\nexit 0",
        )
        .expect("custom interpreter");
        assert_eq!(
            args,
            strings(&[
                "/usr/bin/tini",
                "-g",
                "--",
                "/opt/custom-engine",
                INSTALLER_SCRIPT_DESTINATION,
            ])
        );
        for invalid in ["", " bash", "bash ", "bash\0bad"] {
            assert!(build_installer_process_args(None, Some(invalid), "alpine", "").is_err());
        }
        assert_eq!(
            build_installer_process_args(None, None, "alpine:3.19", "#!/bin/bash\n")
                .expect("legacy selection")[0],
            "sh"
        );
    }

    #[test]
    fn standard_installer_entrypoints_use_production_image_shell_selection() {
        // Exercise the helper used by spawn_installer_container_with_entrypoint,
        // not just detect_install_interpreter in isolation. The persisted egg
        // default is commonly "bash", which must not break Alpine installers.
        assert_eq!(
            build_installer_process_args(None, Some("bash"), "alpine:3.19", "echo ok")
                .expect("standard bash entrypoint")[0],
            "sh"
        );
        assert_eq!(
            build_installer_process_args(
                None,
                Some("ash"),
                "ghcr.io/ptero-eggs/yolks:debian",
                "echo ok",
            )
            .expect("standard ash entrypoint")[0],
            "bash"
        );
        for custom in ["python3", "/usr/bin/bash", "busybox"] {
            let args = build_installer_process_args(None, Some(custom), "alpine:3.19", "echo ok")
                .expect("custom executable remains intact");
            assert_eq!(args[0], custom);
            assert_eq!(args[1], INSTALLER_SCRIPT_DESTINATION);
        }
    }

    #[test]
    fn failed_start_error_retains_primary_and_incomplete_cleanup_details() {
        use crate::errors::AgentError;

        let primary = AgentError::ContainerError("injected task start failure".to_string());
        let unchanged = super::combine_primary_cleanup(primary, Ok(())).to_string();
        assert!(unchanged.contains("injected task start failure"));
        assert!(!unchanged.contains("cleanup also failed"));

        let primary = AgentError::ContainerError("injected task start failure".to_string());
        let combined = super::combine_primary_cleanup(
            primary,
            Err(AgentError::ContainerError(
                "task delete: containerd Unavailable".to_string(),
            )),
        )
        .to_string();
        assert!(combined.contains("injected task start failure"));
        assert!(combined.contains("cleanup also failed"));
        assert!(combined.contains("containerd Unavailable"));
    }

    #[test]
    fn installer_spec_mounts_script_read_only_and_honors_working_dir() {
        let spec = build_installer_oci_spec(InstallerOciSpecConfig {
            container_id: "catalyst-installer-test",
            data_dir: "/host/server-data",
            resolv_path: Path::new("/private-test-io/resolv.conf"),
            script_path: Path::new("/private-test-io/install.sh"),
            process_args: strings(&["python3", INSTALLER_SCRIPT_DESTINATION]),
            image_env: &[],
            overrides: &HashMap::new(),
            working_dir: "/opt/image-tool",
            namespace: "catalyst-test-isolated",
            cpu_burst_supported: false,
        });
        assert_eq!(spec["process"]["cwd"], "/opt/image-tool");
        assert!(spec["mounts"].as_array().unwrap().iter().any(|mount| {
            mount["destination"] == INSTALLER_SCRIPT_DESTINATION
                && mount["source"] == "/private-test-io/install.sh"
                && mount["options"]
                    .as_array()
                    .is_some_and(|options| options.contains(&serde_json::json!("ro")))
        }));
    }

    #[test]
    fn pre_spawn_io_guard_removes_only_its_own_directory() {
        let state = tempfile::tempdir().expect("test state");
        let io_dir = state.path().join("catalyst-installer-test");
        let sibling = state.path().join("other-installer");
        std::fs::create_dir_all(&io_dir).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(io_dir.join("stdout"), b"test output").unwrap();
        std::fs::write(sibling.join("stdout"), b"unrelated output").unwrap();
        drop(InstallerIoDirectoryCleanup {
            path: io_dir.clone(),
            armed: true,
        });
        assert!(!io_dir.exists());
        assert!(sibling.join("stdout").exists());
    }

    /// Opt-in proof of real metadata, OCI and shell execution. Use an isolated
    /// namespace; CATALYST_TEST_SKIP_CNI=1 supports offline runs without
    /// CAP_NET_ADMIN. This variable is honored only in the test binary.
    #[tokio::test]
    #[ignore = "real containerd/runc and isolated namespace required"]
    async fn real_installer_metadata_environment_and_portability() {
        fn required(name: &str) -> String {
            std::env::var(name).unwrap_or_else(|_| {
                panic!("{} must be set when running the ignored Temurin test", name)
            })
        }

        let socket_path = PathBuf::from(required("CATALYST_TEST_CONTAINERD_SOCKET"));
        let namespace = required("CATALYST_TEST_NAMESPACE");
        let cni_bin_dir = PathBuf::from(required("CATALYST_TEST_CNI_BIN_DIR"));
        let bridge_name = required("CATALYST_TEST_CNI_BRIDGE_NAME");
        let bridge_subnet = required("CATALYST_TEST_CNI_BRIDGE_SUBNET");
        assert!(
            namespace.starts_with("catalyst-test-") && namespace != "catalyst",
            "the live Catalyst namespace is forbidden for this test"
        );
        assert!(
            bridge_name.starts_with("ctst") && bridge_name.len() <= 15,
            "use a unique short ctst* bridge name"
        );

        // This directory is a bind-mount source and must be visible through the
        // containerd daemon's mount namespace (not merely its socket).
        let state_root = PathBuf::from(required("CATALYST_TEST_STATE_ROOT"));
        let state = tempfile::tempdir_in(&state_root).expect("isolated installer test state");
        let data = state.path().join("server-data");
        std::fs::create_dir(&data).unwrap();
        let startup_probe = data.join("shell-startup.sh");
        std::fs::write(
            &startup_probe,
            "echo CATALYST_UNSAFE_STARTUP_RAN\ntouch /data/unsafe-startup-ran\n",
        )
        .unwrap();
        let runtime = ContainerdRuntime::new(ContainerdRuntimeConfig {
            socket_path,
            namespace,
            dns_servers: vec!["1.1.1.1".to_string()],
            console_log_dir: state.path().join("console"),
            cni_results_dir: state.path().join("cni-results"),
            cni_data_dir: state.path().join("cni-data"),
            cni_dir: state.path().join("cni-net.d"),
            cni_bin_dir,
            cni_bridge_name: bridge_name,
            cni_bridge_subnet: bridge_subnet,
            allow_host_network: false,
        })
        .await
        .expect("connect isolated test runtime");

        let image = std::env::var("CATALYST_TEST_INSTALL_IMAGE")
            .or_else(|_| std::env::var("CATALYST_TEST_TEMURIN_IMAGE"))
            .unwrap_or_else(|_| "eclipse-temurin:21-jdk-jammy".to_string());
        let is_alpine = image.to_ascii_lowercase().contains("alpine");
        let overrides = HashMap::from([
            (
                "PATH".to_string(),
                "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
            ),
            ("TERM".to_string(), "dumb".to_string()),
            ("CATALYST_PANEL_VALUE".to_string(), "live-ok".to_string()),
            ("BASH_ENV".to_string(), "/data/shell-startup.sh".to_string()),
            ("ENV".to_string(), "/data/shell-startup.sh".to_string()),
            ("SHELLOPTS".to_string(), "xtrace:verbose".to_string()),
            ("POSIXLY_CORRECT".to_string(), "1".to_string()),
        ]);
        let script = if is_alpine {
            "#!/bin/bash\nprintf 'CATALYST_SCRIPT=%s\\n' \"$0\"\nprintf 'CATALYST_WORKING_DIR=%s\\n' \"$PWD\"\nprintf 'CATALYST_ALPINE_PATH=%s\\n' \"$PATH\"\nprintf ok > /data/alpine-ok\n"
        } else {
            "#!/bin/bash\nprintf 'CATALYST_JAVA_HOME=%s\\n' \"$JAVA_HOME\"\nprintf 'CATALYST_PANEL_VALUE=%s\\n' \"$CATALYST_PANEL_VALUE\"\nprintf 'CATALYST_PATH=%s\\n' \"$PATH\"\nprintf 'CATALYST_TERM=%s\\n' \"$TERM\"\nprintf 'CATALYST_SCRIPT=%s\\n' \"$0\"\nprintf 'CATALYST_WORKING_DIR=%s\\n' \"$PWD\"\ncommand -v java\njava -version && printf ok > /data/java-ok\n"
        };
        // Non-cooperative cancellation seam: prepare reaches the exact task/CNI
        // state without Tasks.Start, so lifecycle can register this ID and then
        // abandon it before running any installer command.
        let cancelled_marker = data.join("prepared-installer-started");
        let prepared = runtime
            .prepare_installer_container_with_entrypoint(
                &image,
                "#!/bin/bash\nprintf started > /data/prepared-installer-started\n",
                &overrides,
                data.to_str().expect("UTF-8 temp path"),
                Some("bash"),
            )
            .await
            .expect("prepare cancellable installer without starting it");
        let prepared_id = prepared.container_id().to_string();
        assert!(prepared_id.starts_with("catalyst-installer-"));
        assert!(
            !cancelled_marker.exists(),
            "prepare must not execute the script"
        );
        prepared
            .cleanup()
            .await
            .expect("cleanup registered but unstarted installer");
        assert!(
            !runtime
                .container_existence(&prepared_id)
                .await
                .expect("explicit post-cleanup existence probe"),
            "prepared installer record remains after cancellation"
        );
        assert!(!cancelled_marker.exists());

        let installer = runtime
            .spawn_installer_container_with_entrypoint(
                &image,
                script,
                &overrides,
                data.to_str().expect("UTF-8 temp path"),
                Some("bash"),
            )
            .await
            .expect("spawn real Temurin installer");

        let wait_result = tokio::time::timeout(Duration::from_secs(120), installer.wait()).await;
        let stdout = std::fs::read_to_string(&installer.stdout_path).unwrap_or_default();
        let stderr = std::fs::read_to_string(&installer.stderr_path).unwrap_or_default();
        let teardown_result = runtime.teardown_cni_network(&installer.container_id).await;
        let cleanup_result = installer.cleanup().await;

        teardown_result.expect("teardown isolated CNI attachment");
        cleanup_result.expect("cleanup isolated installer");
        let exit_code = wait_result
            .expect("Temurin installer timed out")
            .expect("wait for Temurin installer");
        assert_eq!(
            exit_code, 0,
            "installer stderr: {}\nstdout: {}",
            stderr, stdout
        );
        if is_alpine {
            assert!(data.join("alpine-ok").exists());
            assert!(stdout.contains("CATALYST_ALPINE_PATH="), "{stdout}");
        } else {
            assert!(
                stdout.contains("CATALYST_JAVA_HOME=/opt/java/openjdk"),
                "{stdout}"
            );
            assert!(stdout.contains("CATALYST_PANEL_VALUE=live-ok"), "{stdout}");
            assert!(stdout.contains("CATALYST_TERM=dumb"), "{stdout}");
            assert!(data.join("java-ok").exists());
            assert!(stderr.contains("openjdk version"), "{stderr}");
        }
        assert!(
            stdout.contains("CATALYST_SCRIPT=/mnt/install/install.sh"),
            "{stdout}"
        );
        assert!(stdout.contains("CATALYST_WORKING_DIR=/\n"), "{stdout}");
        if !is_alpine {
            assert!(stdout.contains(":/opt/java/openjdk/bin"), "{stdout}");
        }
        assert!(!stdout.contains("CATALYST_UNSAFE_STARTUP_RAN"), "{stdout}");
        assert!(!data.join("unsafe-startup-ran").exists());

        let failing = runtime
            .spawn_installer_container_with_entrypoint(
                &image,
                "#!/bin/bash\nexit 42\n",
                &HashMap::new(),
                data.to_str().expect("UTF-8 temp path"),
                Some("bash"),
            )
            .await
            .expect("spawn deliberate failure probe");
        let wait_result = tokio::time::timeout(Duration::from_secs(30), failing.wait()).await;
        let teardown_result = runtime.teardown_cni_network(&failing.container_id).await;
        let cleanup_result = failing.cleanup().await;
        teardown_result.expect("teardown failed-probe state");
        cleanup_result.expect("cleanup failed-probe installer");
        assert_eq!(
            wait_result
                .expect("failure-probe wait bounded")
                .expect("read deliberate exit status"),
            42
        );
    }
}

/// Host bind source for the container's `/data` mount, read from a parsed OCI
/// spec (see `base_mounts`, image_and_spec.rs). Pure function so the
/// restart-recovery path is unit-testable without a live containerd.
fn data_dir_from_spec(spec: &serde_json::Value) -> Option<String> {
    let mounts = spec.get("mounts")?.as_array()?;
    for mount in mounts {
        if mount.get("destination").and_then(|d| d.as_str()) != Some("/data") {
            continue;
        }
        if let Some(source) = mount.get("source").and_then(|s| s.as_str()) {
            if !source.is_empty() {
                return Some(source.to_string());
            }
        }
    }
    None
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

#[cfg(test)]
mod data_dir_spec_tests {
    use super::data_dir_from_spec;
    use serde_json::json;

    #[test]
    fn returns_data_bind_source() {
        let spec = json!({
            "mounts": [
                {"destination": "/proc", "type": "proc", "source": "proc"},
                {"destination": "/data", "type": "bind", "source": "/var/lib/catalyst/servers/uuid-1", "options": ["rbind", "rw"]}
            ]
        });
        assert_eq!(
            data_dir_from_spec(&spec).as_deref(),
            Some("/var/lib/catalyst/servers/uuid-1")
        );
    }

    #[test]
    fn ignores_non_data_binds() {
        // /home/container binds the same source but must not be mistaken for
        // the /data mount.
        let spec = json!({
            "mounts": [
                {"destination": "/home/container", "type": "bind", "source": "/srv/uuid-2"}
            ]
        });
        assert!(data_dir_from_spec(&spec).is_none());
    }

    #[test]
    fn missing_or_empty_mounts_yield_none() {
        assert!(data_dir_from_spec(&json!({})).is_none());
        assert!(data_dir_from_spec(&json!({"mounts": []})).is_none());
        assert!(
            data_dir_from_spec(&json!({"mounts": [{"destination": "/data", "source": ""}]}))
                .is_none()
        );
    }
}
