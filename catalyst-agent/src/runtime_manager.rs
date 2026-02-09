use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::net::Ipv4Addr;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;
use tracing::{debug, error, info, warn};

use nix::errno::Errno;
use nix::fcntl::{fcntl, FcntlArg, OFlag};
use nix::sys::stat::Mode;
use nix::unistd::mkfifo;

// Assuming these modules exist in your project structure
use crate::errors::{AgentError, AgentResult};
use crate::firewall_manager::FirewallManager;

/// Parameters for creating a container
pub struct ContainerConfig<'a> {
    pub container_id: &'a str,
    pub image: &'a str,
    pub startup_command: &'a str,
    pub env: &'a HashMap<String, String>,
    pub memory_mb: u64,
    pub cpu_cores: u64,
    pub data_dir: &'a str,
    pub port: u16,
    pub port_bindings: &'a HashMap<u16, u16>,
    pub network_mode: Option<&'a str>,
    pub network_ip: Option<&'a str>,
}

#[derive(Clone)]
pub struct ContainerdRuntime {
    socket_path: String,
    namespace: String,
    console_writers: Arc<Mutex<HashMap<String, ConsoleWriter>>>,
}

struct ConsoleWriter {
    file: File,
}

struct ConsoleFifo {
    dir: String,
    path: String,
}

impl ContainerdRuntime {
    pub fn new(socket_path: std::path::PathBuf, namespace: String) -> Self {
        Self {
            socket_path: socket_path.to_string_lossy().to_string(),
            namespace,
            console_writers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Create and start a container
    pub async fn create_container(&self, config: ContainerConfig<'_>) -> AgentResult<String> {
        info!(
            "Creating container: {} from image: {}",
            config.container_id, config.image
        );

        // 1. Prepare FIFO for stdin
        let console_fifo = self.prepare_console_fifo(config.container_id).await?;

        // 2. Attach Console Writer
        // CRITICAL FIX: We must attach the writer *before* the container starts to ensure
        // the FIFO exists and handles are ready, but we must use a non-blocking open strategy
        // (O_RDWR) to avoid deadlocking waiting for the container to read.
        self.attach_console_writer(config.container_id, console_fifo.path.clone())
            .await?;

        // Build nerdctl command
        let mut cmd = Command::new("nerdctl");
        cmd.arg("--namespace").arg(&self.namespace).arg("run");

        // Set resource limits
        cmd.arg(format!("--memory={}m", config.memory_mb));
        cmd.arg("--cpus").arg(config.cpu_cores.to_string());

        // Security hardening: prevent privilege escalation and drop unnecessary capabilities
        cmd.arg("--security-opt").arg("no-new-privileges");
        cmd.arg("--cap-drop").arg("ALL");
        cmd.arg("--cap-add").arg("CHOWN");
        cmd.arg("--cap-add").arg("SETUID");
        cmd.arg("--cap-add").arg("SETGID");
        cmd.arg("--cap-add").arg("NET_BIND_SERVICE");

        // Volume mount (host data directory → /data in container)
        cmd.arg("-v").arg(format!("{}:/data", config.data_dir));

        // Provide stable host identifiers for apps that derive encryption keys from hardware UUID.
        add_readonly_mount(&mut cmd, "/etc/machine-id", "/etc/machine-id");
        add_readonly_mount(
            &mut cmd,
            "/var/lib/dbus/machine-id",
            "/var/lib/dbus/machine-id",
        );
        add_readonly_mount(
            &mut cmd,
            "/sys/class/dmi/id/product_uuid",
            "/sys/class/dmi/id/product_uuid",
        );

        // Working directory
        cmd.arg("-w").arg("/data");

        // Network mode
        if let Some(network) = config.network_mode {
            if network == "host" {
                cmd.arg("--network").arg("host");
            } else if network != "bridge" {
                // Assume it's a custom network name (e.g., "mc-lan" for macvlan)
                cmd.arg("--network").arg(network);
                if let Some(ip) = config.network_ip {
                    cmd.arg("--ip").arg(ip);
                }
            }
            // "bridge" or no network specified = default bridge
        }

        // Port mapping (only if not using host network)
        if config.network_mode != Some("host") {
            if config.port_bindings.is_empty() {
                // Backend contract: empty portBindings should still bind the primary port.
                // Use an ephemeral host port while exposing the primary container port.
                cmd.arg("-p").arg(format!("0.0.0.0::{}", config.port));
            } else {
                for (container_port, host_port) in config.port_bindings {
                    cmd.arg("-p")
                        .arg(format!("0.0.0.0:{}:{}", host_port, container_port));
                }
            }
        }

        // Set environment variables
        for (key, value) in config.env {
            cmd.arg("-e").arg(format!("{}={}", key, value));
        }

        // Container name and image
        cmd.arg("--name").arg(config.container_id);
        cmd.arg("-d"); // Detached

        // FIX: Removed "-i" because nerdctl does not support -i and -d together.
        // Since we are piping stdin via a mounted FIFO file inside the shell command below,
        // we do not need the container runtime to allocate an interactive stdin stream.

        cmd.arg("-v")
            .arg(format!("{}:{}", console_fifo.dir, console_fifo.dir));

        cmd.arg("--label")
            .arg(format!("catalyst.agent.socket_path={}", self.socket_path));

        let entrypoint_arg = if !config.startup_command.is_empty() {
            let exec_path = format!("{}/catalyst-entrypoint", console_fifo.dir);
            let entrypoint = format!(
                "#!/bin/bash\nset -e\nFIFO=\"{}\"\nexec 3<> \"$FIFO\"\nexec < \"$FIFO\"\nexec {}\n",
                console_fifo.path, config.startup_command
            );
            self.create_entrypoint_script(&console_fifo.dir, &entrypoint)
                .await?;
            Some(exec_path)
        } else {
            None
        };

        if let Some(exec_path) = entrypoint_arg {
            cmd.arg("--entrypoint").arg(exec_path);
        }
        cmd.arg(config.image);

        let output = cmd.output().await.map_err(|e| {
            AgentError::ContainerError(format!("Failed to create container: {}", e))
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if let (Some(network), Some(ip)) = (config.network_mode, config.network_ip) {
                if network != "bridge" && network != "host" {
                    if let Err(err) = Self::release_static_ip(network, ip) {
                        warn!(
                            "Failed to release static IP {} for {}: {}",
                            ip, network, err
                        );
                    }
                }
            }
            self.cleanup_console_fifo(config.container_id).await;
            return Err(AgentError::ContainerError(format!(
                "Container creation failed: {}",
                stderr
            )));
        }

        let container_full_id = String::from_utf8_lossy(&output.stdout).trim().to_string();

        info!("Container created successfully: {}", container_full_id);

        // Get container IP for firewall configuration
        let container_ip_opt = match self.get_container_ip(config.container_id).await {
            Ok(ip) if !ip.is_empty() => Some(ip),
            Ok(_) => None,
            Err(err) => {
                warn!(
                    "Could not determine container IP for {}: {}. Skipping firewall configuration.",
                    config.container_id, err
                );
                None
            }
        };

        // Configure firewall to allow the ports, if we have a concrete container IP
        if let Some(container_ip) = container_ip_opt {
            let ports_to_open: Vec<u16> = if config.port_bindings.is_empty() {
                self.resolve_host_ports(config.container_id, config.port)
                    .await
                    .unwrap_or_default()
            } else {
                config.port_bindings.values().copied().collect()
            };
            for host_port in ports_to_open {
                info!(
                    "Configuring firewall for port {} (container IP: {})",
                    host_port, container_ip
                );
                if let Err(e) = FirewallManager::allow_port(host_port, &container_ip).await {
                    error!("Failed to configure firewall: {}", e);
                    // Don't fail container creation if firewall config fails
                } else {
                    info!("✓ Firewall configured for port {}", host_port);
                }
            }
        }

        Ok(container_full_id)
    }

    pub async fn spawn_installer_container(
        &self,
        image: &str,
        script: &str,
        env: &HashMap<String, String>,
        data_dir: &str,
    ) -> AgentResult<tokio::process::Child> {
        info!("Spawning installer container with image: {}", image);

        let mut cmd = Command::new("nerdctl");
        cmd.arg("--namespace")
            .arg(&self.namespace)
            .arg("run")
            .arg("--rm")
            .arg("-i");

        cmd.arg("-v").arg(format!("{}:/data", data_dir));
        cmd.arg("-w").arg("/data");

        for (key, value) in env {
            cmd.arg("-e").arg(format!("{}={}", key, value));
        }

        cmd.arg(image).arg("sh").arg("-c").arg(script);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = cmd.spawn().map_err(|e| {
            AgentError::ContainerError(format!("Failed to run installer container: {}", e))
        })?;

        Ok(child)
    }

    async fn prepare_console_fifo(&self, container_id: &str) -> AgentResult<ConsoleFifo> {
        let base_dir = PathBuf::from("/tmp/catalyst-console");
        let dir = base_dir.join(container_id);
        let fifo_path = dir.join("stdin");

        fs::create_dir_all(&dir).map_err(|e| {
            AgentError::ContainerError(format!("Failed to create console directory: {}", e))
        })?;

        let mut perms = fs::metadata(&dir)
            .map_err(|e| AgentError::ContainerError(format!("Failed to stat console dir: {}", e)))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dir, perms).map_err(|e| {
            AgentError::ContainerError(format!(
                "Failed to set console directory permissions: {}",
                e
            ))
        })?;

        if fifo_path.exists() {
            fs::remove_file(&fifo_path).ok();
        }

        create_fifo(&fifo_path).map_err(|e| {
            AgentError::ContainerError(format!("Failed to create console FIFO: {}", e))
        })?;
        let mut fifo_perms = fs::metadata(&fifo_path)
            .map_err(|e| AgentError::ContainerError(format!("Failed to stat console FIFO: {}", e)))?
            .permissions();
        fifo_perms.set_mode(0o660);
        fs::set_permissions(&fifo_path, fifo_perms).map_err(|e| {
            AgentError::ContainerError(format!("Failed to set console FIFO permissions: {}", e))
        })?;

        Ok(ConsoleFifo {
            dir: dir.to_string_lossy().into_owned(),
            path: fifo_path.to_string_lossy().into_owned(),
        })
    }

    async fn attach_console_writer(
        &self,
        container_id: &str,
        fifo_path: String,
    ) -> AgentResult<()> {
        let path_clone = fifo_path.clone();

        // Spawn a blocking task to open the FIFO.
        // CRITICAL FIX: We open with read(true) AND write(true).
        // Opening a FIFO with O_RDWR (read+write) on Linux succeeds immediately without blocking,
        // because the kernel sees that "a reader" (us) is present.
        // If we opened with only write(true) (O_WRONLY), open() would block until the container reads from it.
        // Since the container isn't running yet, we would deadlock.
        let file = spawn_blocking(move || {
            let file = std::fs::OpenOptions::new()
                .read(true) // Helper to ensure O_RDWR flag is set to avoid blocking
                .write(true)
                .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
                .open(&path_clone)
                .map_err(|e| {
                    AgentError::ContainerError(format!("Failed to open console FIFO: {}", e))
                })?;

            // We remove O_NONBLOCK now that we have the handle.
            // We keep the handle open as O_RDWR.
            // SAFETY: fd is valid and owned by this thread; we only adjust flags.
            if let Ok(flags) = fcntl(&file, FcntlArg::F_GETFL) {
                let mut oflags = OFlag::from_bits_truncate(flags);
                oflags.remove(OFlag::O_NONBLOCK);
                let _ = fcntl(&file, FcntlArg::F_SETFL(oflags));
            }
            Ok::<File, AgentError>(file)
        })
        .await
        .map_err(|e| AgentError::ContainerError(format!("Console writer task failed: {}", e)))??;

        let mut writers = self.console_writers.lock().await;
        writers.insert(container_id.to_string(), ConsoleWriter { file });

        Ok(())
    }

    async fn cleanup_console_fifo(&self, container_id: &str) {
        {
            let mut writers = self.console_writers.lock().await;
            writers.remove(container_id);
            // File handle is closed when removed from map
        }
        let dir = PathBuf::from("/tmp/catalyst-console").join(container_id);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Start a container
    pub async fn start_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Starting container: {}", container_id);

        // Ensure console writer is ready if this is a restart
        let _ = self.ensure_console_writer(container_id).await;

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("start")
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to start container: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Stop a container gracefully
    pub async fn stop_container(&self, container_id: &str, timeout_secs: u64) -> AgentResult<()> {
        info!("Stopping container: {}", container_id);

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("stop")
            .arg("-t")
            .arg(timeout_secs.to_string())
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to stop container: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Kill a container immediately
    pub async fn kill_container(&self, container_id: &str, signal: &str) -> AgentResult<()> {
        info!("Killing container: {} with signal {}", container_id, signal);

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("kill")
            .arg("-s")
            .arg(signal)
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to kill container: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Remove a container
    pub async fn remove_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Removing container: {}", container_id);

        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("rm")
            .arg("-f")
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to remove container: {}",
                stderr
            )));
        }

        self.cleanup_console_fifo(container_id).await;

        Ok(())
    }

    /// Get container logs
    pub async fn get_logs(&self, container_id: &str, lines: Option<u32>) -> AgentResult<String> {
        let mut cmd = Command::new("nerdctl");
        cmd.arg("--namespace").arg(&self.namespace).arg("logs");

        if let Some(n) = lines {
            cmd.arg("--tail").arg(n.to_string());
        }

        cmd.arg(container_id);

        let output = cmd.output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to get logs: {}",
                stderr
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Stream container logs in real-time
    pub async fn stream_logs<F>(&self, container_id: &str, mut callback: F) -> AgentResult<()>
    where
        F: FnMut(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()>>>,
    {
        info!("Streaming logs for container: {}", container_id);

        let mut child = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("logs")
            .arg("-f")
            .arg(container_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

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

        loop {
            tokio::select! {
                line = stdout_reader.next_line() => {
                    match line? {
                        Some(l) => callback(l).await,
                        None => break,
                    }
                }
                line = stderr_reader.next_line() => {
                    match line? {
                        Some(l) => callback(l).await,
                        None => break,
                    }
                }
            }
        }

        Ok(())
    }

    /// List all containers
    pub async fn list_containers(&self) -> AgentResult<Vec<ContainerInfo>> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("ps")
            .arg("-a")
            .arg("--format")
            .arg("json")
            .output()
            .await?;

        if !output.status.success() {
            return Err(AgentError::ContainerError(
                "Failed to list containers".to_string(),
            ));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);

        // nerdctl returns newline-delimited JSON, parse each line
        let mut containers = Vec::new();
        for line in json_output.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(container) = serde_json::from_str::<ContainerInfo>(line) {
                containers.push(container);
            }
        }

        Ok(containers)
    }

    pub async fn clean_stale_ip_allocations(&self, network: &str) -> AgentResult<usize> {
        let allocations_dir = format!("/var/lib/cni/networks/{}", network);
        let entries = match fs::read_dir(&allocations_dir) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(err) => return Err(AgentError::IoError(err.to_string())),
        };

        let containers = self.list_containers().await?;
        let mut active_ips = HashSet::new();
        let mut running_containers = 0;
        for container in containers {
            if !container.status.contains("Up") {
                continue;
            }
            running_containers += 1;
            if let Ok(ip) = self.get_container_ip(&container.id).await {
                if !ip.is_empty() {
                    active_ips.insert(ip);
                }
            }
        }

        if running_containers > 0 && active_ips.is_empty() {
            // Avoid deleting allocations if we couldn't resolve any active IPs.
            return Ok(0);
        }

        let mut removed = 0;
        for entry in entries {
            let entry = entry.map_err(|err| AgentError::IoError(err.to_string()))?;
            let path = entry.path();
            let name = match entry.file_name().into_string() {
                Ok(value) => value,
                Err(_) => continue,
            };

            if name == "lock" || name.starts_with("last_reserved_ip") {
                continue;
            }

            if name.parse::<Ipv4Addr>().is_err() {
                continue;
            }

            if !active_ips.contains(&name) {
                // RACE CONDITION FIX:
                // Check if the file is very recent. A CNI plugin might have just allocated it
                // for a container that is currently starting up but not yet fully "Up" or
                // reporting an IP in inspection.
                if let Ok(metadata) = fs::metadata(&path) {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(age) = SystemTime::now().duration_since(modified) {
                            if age < Duration::from_secs(60) {
                                // Allocation is less than 60s old; unsafe to delete.
                                continue;
                            }
                        }
                    }
                }

                if fs::remove_file(&path).is_ok() {
                    removed += 1;
                }
            }
        }

        Ok(removed)
    }

    fn release_static_ip(network: &str, ip: &str) -> std::io::Result<()> {
        let path = format!("/var/lib/cni/networks/{}/{}", network, ip);
        fs::remove_file(path)
    }

    /// Get container stats
    pub async fn get_stats(&self, container_id: &str) -> AgentResult<ContainerStats> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("stats")
            .arg("--no-stream")
            .arg("--format")
            .arg("json")
            .arg(container_id)
            .output()
            .await?;

        if !output.status.success() {
            return Err(AgentError::ContainerError(
                "Failed to get stats".to_string(),
            ));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        // nerdctl returns newline-delimited JSON, parse the first line
        let first_line = json_output
            .lines()
            .next()
            .ok_or_else(|| AgentError::ContainerError("No stats returned".to_string()))?;

        let stats: ContainerStats = serde_json::from_str(first_line)?;
        Ok(stats)
    }

    /// Execute command in running container
    pub async fn exec(&self, container_id: &str, command: Vec<&str>) -> AgentResult<String> {
        let mut cmd = Command::new("nerdctl");
        cmd.arg("--namespace")
            .arg(&self.namespace)
            .arg("exec")
            .arg(container_id);

        for arg in command {
            cmd.arg(arg);
        }

        let output = cmd.output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Exec failed: {}",
                stderr
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Send stdin to container
    pub async fn send_input(&self, container_id: &str, input: &str) -> AgentResult<()> {
        debug!("Sending input to container: {}", container_id);

        // Best-effort: try to ensure the console writer exists before writing.
        let writer_ensured = self.ensure_console_writer(container_id).await?;
        debug!(
            "Console writer ensured for {}: {}",
            container_id, writer_ensured
        );

        if !writer_ensured {
            debug!(
                "Console writer could not be ensured for container {}; proceeding with FIFO/shell fallback",
                container_id
            );
        }

        // Try writing to the FIFO handle
        if let Ok(true) = self.write_to_console_fifo(container_id, input).await {
            debug!("Console input delivered via FIFO for {}", container_id);
            return Ok(());
        }
        debug!("Console input FIFO write failed for {}", container_id);

        // Fallback: exec into container and write to default stdin fd
        let target_path = self
            .resolve_stdin_path(container_id, None)
            .await
            .unwrap_or_else(|| "/proc/1/fd/0".to_string());

        debug!(
            "Console input falling back to exec for {} -> {}",
            container_id, target_path
        );
        let mut child = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("exec")
            .arg("-i")
            .arg(container_id)
            .arg("sh")
            .arg("-c")
            .arg(format!("cat > {}", shell_quote(&target_path)))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            stdin.write_all(input.as_bytes()).await?;
        }
        let output = child.wait_with_output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to send input to container: {}",
                stderr
            )));
        }

        Ok(())
    }

    async fn ensure_console_writer(&self, container_id: &str) -> AgentResult<bool> {
        {
            let writers = self.console_writers.lock().await;
            if writers.contains_key(container_id) {
                return Ok(true);
            }
        }

        let fifo_path = PathBuf::from("/tmp/catalyst-console")
            .join(container_id)
            .join("stdin");
        if !fifo_path.exists() {
            return Ok(false);
        }

        if let Err(err) = self
            .attach_console_writer(container_id, fifo_path.to_string_lossy().into_owned())
            .await
        {
            debug!(
                "Console writer attach failed for {}: {}. Falling back to exec input.",
                container_id, err
            );
            return Ok(false);
        }

        Ok(true)
    }

    /// Restore console writers for all running containers
    /// This should be called after reconnecting to ensure console input works
    pub async fn restore_console_writers(&self) -> AgentResult<()> {
        info!("Restoring console writers for running containers");

        let containers = self.list_containers().await?;
        let mut restored = 0;
        let mut failed = 0;

        for container in containers {
            if !container.status.contains("Up") {
                continue;
            }

            let fifo_path = PathBuf::from("/tmp/catalyst-console")
                .join(&container.id)
                .join("stdin");

            if !fifo_path.exists() {
                debug!(
                    "No FIFO found for container {}, skipping console restoration",
                    container.id
                );
                continue;
            }

            // Remove existing writer if it exists (it may be stale)
            {
                let mut writers = self.console_writers.lock().await;
                writers.remove(&container.id);
            }

            // Reattach the console writer
            match self
                .attach_console_writer(&container.id, fifo_path.to_string_lossy().into_owned())
                .await
            {
                Ok(_) => {
                    info!("Restored console writer for container: {}", container.id);
                    restored += 1;
                }
                Err(e) => {
                    warn!(
                        "Failed to restore console writer for {}: {}",
                        container.id, e
                    );
                    failed += 1;
                }
            }
        }

        info!(
            "Console writer restoration complete: {} restored, {} failed",
            restored, failed
        );

        Ok(())
    }

    async fn write_to_console_fifo(&self, container_id: &str, input: &str) -> AgentResult<bool> {
        let file_handle = {
            let mut writers = self.console_writers.lock().await;
            if let Some(writer) = writers.get_mut(container_id) {
                // Try to clone the file handle
                writer.file.try_clone().map_err(|e| {
                    AgentError::ContainerError(format!("Failed to clone FIFO handle: {}", e))
                })?
            } else {
                return Ok(false);
            }
        };

        let input = input.to_string();
        spawn_blocking(move || {
            let mut writer = file_handle;
            match writer.write_all(input.as_bytes()) {
                Ok(_) => {
                    let _ = writer.flush();
                    Ok(())
                }
                Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => {
                    // Pipe broken means container probably stopped reading
                    Err(std::io::Error::new(
                        std::io::ErrorKind::BrokenPipe,
                        "Container stdin closed",
                    ))
                }
                Err(e) => Err(e),
            }
        })
        .await
        .map_err(|e| AgentError::ContainerError(format!("Console write task failed: {}", e)))?
        .map_err(|e| AgentError::ContainerError(format!("Failed to write console input: {}", e)))?;

        Ok(true)
    }

    async fn resolve_stdin_path(
        &self,
        container_id: &str,
        process_hint: Option<&str>,
    ) -> Option<String> {
        let ps_output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("exec")
            .arg(container_id)
            .arg("sh")
            .arg("-c")
            .arg("ps -eo pid,ppid,comm,args")
            .output()
            .await
            .ok()?;

        if !ps_output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&ps_output.stdout);
        let mut candidates: Vec<(i32, i32, String, String)> = Vec::new();

        for (idx, line) in stdout.lines().enumerate() {
            if idx == 0 {
                continue;
            }
            let mut parts = line.split_whitespace();
            let pid = match parts.next().and_then(|v| v.parse::<i32>().ok()) {
                Some(value) => value,
                None => continue,
            };
            let ppid = match parts.next().and_then(|v| v.parse::<i32>().ok()) {
                Some(value) => value,
                None => continue,
            };
            let comm = parts.next().unwrap_or("").to_string();
            let args = parts.collect::<Vec<_>>().join(" ");
            candidates.push((pid, ppid, comm, args));
        }

        if let Some(hint) = process_hint {
            let hint_lower = hint.to_lowercase();
            let mut matches = candidates
                .iter()
                .filter(|(_, _, comm, args)| {
                    comm.to_lowercase() == hint_lower || args.to_lowercase().contains(&hint_lower)
                })
                .cloned()
                .collect::<Vec<_>>();
            matches.sort_by_key(|(pid, ppid, _, _)| (*ppid, *pid));
            if let Some((pid, _, _, _)) = matches.first() {
                debug!(
                    "Resolved stdin path for {} using hint '{}': /proc/{}/fd/0",
                    container_id, hint, pid
                );
                return Some(format!("/proc/{}/fd/0", pid));
            }
        }

        let mut children_of_init = candidates
            .iter()
            .filter(|(_, ppid, _, _)| *ppid == 1)
            .cloned()
            .collect::<Vec<_>>();
        if children_of_init.len() == 1 {
            if let Some((pid, _, _, _)) = children_of_init.pop() {
                debug!(
                    "Resolved stdin path for {} using PID 1 child: /proc/{}/fd/0",
                    container_id, pid
                );
                return Some(format!("/proc/{}/fd/0", pid));
            }
        }

        None
    }

    /// Get container IP address
    pub async fn get_container_ip(&self, container_id: &str) -> AgentResult<String> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("inspect")
            .arg(container_id)
            .arg("--format")
            // BUG FIX: Add newline separator. Original: {{...}}{{...}} concatenated IPs.
            // New: {{...}}{{.IPAddress}}\n{{end}}
            .arg("{{range .NetworkSettings.Networks}}{{.IPAddress}}\n{{end}}")
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::ContainerError(format!(
                "Failed to get container IP: {}",
                stderr
            )));
        }

        let full_output = String::from_utf8_lossy(&output.stdout);

        // Take the first non-empty line
        let ip = full_output
            .lines()
            .map(|l| l.trim())
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .to_string();

        Ok(ip)
    }

    /// Check if a container exists
    pub async fn container_exists(&self, container_id: &str) -> bool {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("inspect")
            .arg(container_id)
            .output()
            .await;

        match output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }

    /// Check if a container is running
    pub async fn is_container_running(&self, container_id: &str) -> AgentResult<bool> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("inspect")
            .arg(container_id)
            .arg("--format")
            .arg("{{.State.Running}}")
            .output()
            .await?;

        if !output.status.success() {
            return Ok(false);
        }

        let state = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_lowercase();
        Ok(state == "true")
    }

    /// Get container exit code if available
    pub async fn get_container_exit_code(&self, container_id: &str) -> AgentResult<Option<i32>> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("inspect")
            .arg(container_id)
            .arg("--format")
            .arg("{{.State.ExitCode}}")
            .output()
            .await?;

        if !output.status.success() {
            return Ok(None);
        }

        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            return Ok(None);
        }
        match value.parse::<i32>() {
            Ok(code) => Ok(Some(code)),
            Err(_) => Ok(None),
        }
    }

    /// Spawn a process to stream container logs (stdout/stderr)
    /// Returns a handle to the log streaming process
    pub async fn spawn_log_stream(&self, container_id: &str) -> AgentResult<tokio::process::Child> {
        info!("Starting log stream for container: {}", container_id);

        let child = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("logs")
            .arg("--follow")
            .arg("--timestamps")
            .arg(container_id)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        Ok(child)
    }

    /// Subscribe to container events for a specific container
    /// Returns a child process streaming events (one event per line)
    /// Events include: start, die, stop, kill, etc.
    pub async fn subscribe_to_container_events(
        &self,
        container_id: &str,
    ) -> AgentResult<tokio::process::Child> {
        debug!("Subscribing to events for container: {}", container_id);

        let child = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("events")
            .arg("--filter")
            .arg(format!("container={}", container_id))
            .arg("--format")
            .arg("{{.Status}}")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                AgentError::ContainerError(format!("Failed to spawn events stream: {}", e))
            })?;

        Ok(child)
    }

    /// Subscribe to all container events in the namespace
    /// Returns events with format: container_name status (e.g., "server-uuid start")
    pub async fn subscribe_to_all_events(&self) -> AgentResult<tokio::process::Child> {
        debug!(
            "Subscribing to all container events in namespace: {}",
            self.namespace
        );

        // Use JSON format which is more reliable than custom formats
        let child = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("events")
            .arg("--format")
            .arg("json")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                AgentError::ContainerError(format!("Failed to spawn global events stream: {}", e))
            })?;

        Ok(child)
    }
}

fn create_fifo(path: &Path) -> std::io::Result<()> {
    match mkfifo(path, Mode::from_bits_truncate(0o600)) {
        Ok(()) => Ok(()),
        Err(Errno::EEXIST) => Ok(()),
        Err(err) => Err(std::io::Error::other(err)),
    }
}

fn add_readonly_mount(cmd: &mut Command, host_path: &str, container_path: &str) {
    if Path::new(host_path).exists() {
        cmd.arg("-v")
            .arg(format!("{}:{}:ro", host_path, container_path));
    }
}

fn shell_quote(input: &str) -> String {
    if input.is_empty() {
        "''".to_string()
    } else if input.contains('\'') {
        format!("'{}'", input.replace('\'', "'\\''"))
    } else {
        format!("'{}'", input)
    }
}

impl ContainerdRuntime {
    async fn create_entrypoint_script(&self, dir: &str, contents: &str) -> AgentResult<()> {
        let path = PathBuf::from(dir).join("catalyst-entrypoint");
        let mut file = tokio::fs::File::create(&path).await?;
        use tokio::io::AsyncWriteExt;
        file.write_all(contents.as_bytes()).await?;
        let mut perms = tokio::fs::metadata(&path).await?.permissions();
        perms.set_mode(0o755);
        tokio::fs::set_permissions(&path, perms).await?;
        Ok(())
    }

    async fn resolve_host_ports(
        &self,
        container_id: &str,
        container_port: u16,
    ) -> AgentResult<Vec<u16>> {
        let output = Command::new("nerdctl")
            .arg("--namespace")
            .arg(&self.namespace)
            .arg("port")
            .arg(container_id)
            .arg(container_port.to_string())
            .output()
            .await?;
        if !output.status.success() {
            return Ok(Vec::new());
        }
        let mut ports = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((_host, port)) = line.rsplit_once(':') {
                if let Ok(port) = port.trim().parse::<u16>() {
                    ports.push(port);
                }
            }
        }
        Ok(ports)
    }
}

#[derive(serde::Deserialize, Debug)]
pub struct ContainerInfo {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Names")]
    pub names: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Command", default)]
    pub command: String,
    #[serde(rename = "Image", default)]
    pub image: String,
}

#[derive(serde::Deserialize, Debug)]
pub struct ContainerStats {
    #[serde(rename = "ID")]
    pub container_id: String,
    #[serde(rename = "Name")]
    pub container_name: String,
    #[serde(rename = "CPUPerc")]
    pub cpu_percent: String,
    #[serde(rename = "MemUsage")]
    pub memory_usage: String,
    #[serde(rename = "NetIO")]
    pub net_io: String,
    #[serde(rename = "BlockIO")]
    pub block_io: String,
}
