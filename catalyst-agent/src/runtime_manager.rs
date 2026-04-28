use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::net::Ipv4Addr;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use containerd_client::services::v1::container::Runtime;
use containerd_client::services::v1::containers_client::ContainersClient;
use containerd_client::services::v1::content_client::ContentClient;
use containerd_client::services::v1::events_client::EventsClient;
use containerd_client::services::v1::images_client::ImagesClient;
use containerd_client::services::v1::snapshots::snapshots_client::SnapshotsClient;
use containerd_client::services::v1::snapshots::{
    MountsRequest, PrepareSnapshotRequest, RemoveSnapshotRequest,
};
use containerd_client::services::v1::tasks_client::TasksClient;
use containerd_client::services::v1::GetImageRequest;
use containerd_client::services::v1::SubscribeRequest;
use containerd_client::services::v1::{
    Container, CreateContainerRequest, DeleteContainerRequest, GetContainerRequest, InfoRequest,
    ListContainersRequest, ReadContentRequest,
};
use containerd_client::services::v1::{
    CreateTaskRequest, DeleteTaskRequest, ExecProcessRequest, KillRequest as TaskKillRequest,
    StartRequest, WaitRequest,
};
use containerd_client::with_namespace;
use prost_types::Any;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;
use tonic::Request;
use tracing::{debug, error, info, warn};

use nix::errno::Errno;
use nix::fcntl::{fcntl, FcntlArg, OFlag};
use nix::sys::stat::Mode;
use nix::unistd::mkfifo;

use crate::errors::{AgentError, AgentResult};
use crate::firewall_manager::FirewallManager;

const RUNTIME_NAME: &str = "io.containerd.runc.v2";
const SPEC_TYPE_URL: &str = "types.containerd.io/opencontainers/runtime-spec/1/Spec";
const CONSOLE_BASE_DIR: &str = "/tmp/catalyst-console";
const PORT_FWD_STATE_DIR: &str = "/var/lib/cni/results";
const MAX_LOG_SIZE: u64 = 50 * 1024 * 1024; // 50MB per file
const LOG_BACKUP_COUNT: usize = 3;

/// Tracks CPU usage samples per container to compute real percentage over time
pub struct CpuTracker {
    samples: Mutex<HashMap<String, (u64, Instant)>>,
}

impl CpuTracker {
    pub fn new() -> Self {
        Self {
            samples: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_percent(&self, container_id: &str, cgroup_path: &str) -> f64 {
        let usage_usec = match read_cgroup_cpu_usage(cgroup_path).await {
            Some(u) => u,
            None => return 0.0,
        };
        let now = Instant::now();
        let mut samples = self.samples.lock().await;
        let percent = match samples.get(container_id) {
            Some((prev_usage, prev_time)) => {
                let elapsed = now.duration_since(*prev_time).as_micros() as f64;
                let delta = (usage_usec.saturating_sub(*prev_usage)) as f64;
                if elapsed > 0.0 {
                    (delta / elapsed) * 100.0
                } else {
                    0.0
                }
            }
            None => 0.0,
        };
        samples.insert(container_id.to_string(), (usage_usec, now));
        let max_cpus = num_cpus::get() as f64;
        percent.clamp(0.0, 100.0 * max_cpus)
    }
}

/// Format bytes into a human-readable string
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    match bytes {
        0..=KB => format!("{}B", bytes),
        b @ 1..=MB => format!("{:.1}KB", b as f64 / KB as f64),
        b @ 1..=GB => format!("{:.1}MB", b as f64 / MB as f64),
        b => format!("{:.1}GB", b as f64 / GB as f64),
    }
}

/// Read PIDs from a cgroup's cgroup.procs
async fn get_container_pids(cgroup_path: &str) -> Option<Vec<u32>> {
    let content = tokio::fs::read_to_string(format!("{}/cgroup.procs", cgroup_path))
        .await
        .ok()?;
    let pids: Vec<u32> = content
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect();
    if pids.is_empty() {
        None
    } else {
        Some(pids)
    }
}

/// Read network I/O stats for a container via /proc/{pid}/net/dev.
/// Returns (rx_bytes, tx_bytes, display_string).
async fn read_network_io(cgroup_path: &str) -> Option<(u64, u64, String)> {
    let pids = get_container_pids(cgroup_path).await?;
    let content = tokio::fs::read_to_string(format!("/proc/{}/net/dev", pids[0]))
        .await
        .ok()?;
    let mut total_rx: u64 = 0;
    let mut total_tx: u64 = 0;
    for line in content.lines().skip(2) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 10 {
            if let Ok(rx) = parts[1].parse::<u64>() {
                total_rx += rx;
            }
            if let Ok(tx) = parts[9].parse::<u64>() {
                total_tx += tx;
            }
        }
    }
    Some((
        total_rx,
        total_tx,
        format!(
            "↓ {} / ↑ {}",
            format_bytes(total_rx),
            format_bytes(total_tx)
        ),
    ))
}

/// Read block I/O stats from cgroup v2 io.stat.
/// Returns (read_bytes, write_bytes, display_string).
async fn read_block_io(cgroup_path: &str) -> Option<(u64, u64, String)> {
    let content = tokio::fs::read_to_string(format!("{}/io.stat", cgroup_path))
        .await
        .ok()?;
    let mut read_bytes: u64 = 0;
    let mut write_bytes: u64 = 0;
    for line in content.lines() {
        if line.starts_with("8:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            for part in &parts {
                if let Some(val) = part.strip_prefix("rbytes=") {
                    read_bytes += val.parse::<u64>().unwrap_or(0);
                }
                if let Some(val) = part.strip_prefix("wbytes=") {
                    write_bytes += val.parse::<u64>().unwrap_or(0);
                }
            }
        }
    }
    Some((
        read_bytes,
        write_bytes,
        format!(
            "↓ {} / ↑ {}",
            format_bytes(read_bytes),
            format_bytes(write_bytes)
        ),
    ))
}

/// Rotate log files if they exceed MAX_LOG_SIZE
pub async fn rotate_logs(container_id: &str) {
    let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
    for log_name in &["stdout", "stderr"] {
        let log_path = io_dir.join(log_name);
        if let Ok(metadata) = tokio::fs::metadata(&log_path).await {
            if metadata.len() > MAX_LOG_SIZE {
                // Rotate: stdout -> stdout.1 -> stdout.2 -> stdout.3 (drop oldest)
                for i in (1..=LOG_BACKUP_COUNT).rev() {
                    let src = if i == 1 {
                        log_path.clone()
                    } else {
                        io_dir.join(format!("{}.{}", log_name, i - 1))
                    };
                    let dst = io_dir.join(format!("{}.{}", log_name, i));
                    let _ = tokio::fs::rename(&src, &dst).await;
                }
                // Create new empty log file
                let _ = tokio::fs::File::create(&log_path).await;
                info!(
                    "Rotated log for container {}: {} (was {} bytes)",
                    container_id,
                    log_name,
                    metadata.len()
                );
            }
        }
    }
}

/// Device access profiles for container security
/// Each profile defines which devices the container can access
#[derive(Debug, Clone)]
pub struct DeviceProfile {
    pub devices: Vec<serde_json::Value>,
}

impl DeviceProfile {
    /// Minimal profile - only null device
    #[allow(dead_code)]
    pub fn minimal() -> Self {
        Self {
            devices: vec![
                serde_json::json!({"allow": false, "access": "rwm"}),
                serde_json::json!({"allow": true, "type": "c", "major": 1, "minor": 3, "access": "r"}),
            ],
        }
    }

    /// Standard profile - common devices for most game servers
    pub fn standard() -> Self {
        Self {
            devices: vec![
                serde_json::json!({"allow": false, "access": "rwm"}),
                serde_json::json!({"allow": true, "type": "c", "major": 1, "minor": 3, "access": "rwm"}),
                serde_json::json!({"allow": true, "type": "c", "major": 1, "minor": 5, "access": "rwm"}),
                serde_json::json!({"allow": true, "type": "c", "major": 1, "minor": 8, "access": "rwm"}),
                serde_json::json!({"allow": true, "type": "c", "major": 1, "minor": 9, "access": "rwm"}),
                serde_json::json!({"allow": true, "type": "c", "major": 5, "minor": 0, "access": "rwm"}),
                serde_json::json!({"allow": true, "type": "c", "major": 5, "minor": 1, "access": "rwm"}),
            ],
        }
    }

    /// GPU profile - includes GPU device access
    #[allow(dead_code)]
    pub fn gpu() -> Self {
        let mut standard = Self::standard();
        // Add NVIDIA GPU devices (typically /dev/nvidia*)
        standard
            .devices
            .push(serde_json::json!({"allow": true, "type": "c", "major": 195, "access": "rwm"}));
        standard
            .devices
            .push(serde_json::json!({"allow": true, "type": "c", "major": 506, "access": "rwm"}));
        standard
    }

    /// Extended profile - for servers that need more device access
    #[allow(dead_code)]
    pub fn extended() -> Self {
        let mut standard = Self::standard();
        // Add additional common devices
        standard.devices.push(serde_json::json!({"allow": true, "type": "c", "major": 10, "minor": 200, "access": "rwm"})); // NVIDIA control device
        standard.devices.push(serde_json::json!({"allow": true, "type": "c", "major": 10, "minor": 222, "access": "rwm"})); // NVIDIA device
        standard
    }

    /// Get device profile by name
    #[allow(dead_code)]
    pub fn from_name(name: &str) -> Self {
        match name.to_lowercase().as_str() {
            "minimal" => Self::minimal(),
            "gpu" => Self::gpu(),
            "extended" => Self::extended(),
            _ => Self::standard(), // Default to standard
        }
    }
}

// CNI plugin directories to search, in order of preference
// Fedora/RHEL install to /usr/libexec/cni, others typically use /opt/cni/bin
const CNI_BIN_DIRS: &[&str] = &["/opt/cni/bin", "/usr/libexec/cni"];

/// Discover the CNI plugin directory by checking which one has required plugins
fn discover_cni_bin_dir() -> &'static str {
    const REQUIRED_PLUGINS: &[&str] = &["bridge", "host-local", "macvlan"];

    for dir in CNI_BIN_DIRS {
        let has_all = REQUIRED_PLUGINS
            .iter()
            .all(|plugin| Path::new(&format!("{}/{}", dir, plugin)).exists());
        if has_all {
            return dir;
        }
    }

    // Default to /opt/cni/bin if no directory has all plugins
    // (error will be raised later when plugin is not found)
    CNI_BIN_DIRS[0]
}
const PORT_FWD_STATE_PREFIX: &str = "catalyst-";
const MAX_CONTENT_BLOB_SIZE: usize = 100 * 1024 * 1024; // 100MB

#[derive(serde::Serialize, serde::Deserialize)]
struct PortForwardState {
    container_ip: String,
    forwards: Vec<PortForward>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PortForward {
    host_port: u16,
    container_port: u16,
}

/// Parameters for creating a container
pub struct ContainerConfig<'a> {
    pub container_id: &'a str,
    pub server_id: &'a str,
    pub image: &'a str,
    pub startup_command: &'a str,
    pub env: &'a HashMap<String, String>,
    pub memory_mb: u64,
    pub swap_mb: u64,
    pub cpu_cores: u64,
    pub io_weight: u64,
    pub data_dir: &'a str,
    pub port: u16,
    pub port_bindings: &'a HashMap<u16, u16>,
    pub network_mode: Option<&'a str>,
    pub network_ip: Option<&'a str>,
}

struct ContainerIo {
    _stdin_fifo: PathBuf,
    _stdout_file: PathBuf,
    _stderr_file: PathBuf,
    stdin_writer: Option<File>,
}

#[derive(Debug)]
pub struct ContainerInfo {
    pub id: String,
    pub names: String,
    pub managed: bool,
    pub status: String,
    pub command: String,
    pub image: String,
}

#[derive(Debug)]
pub struct ContainerStats {
    pub container_id: String,
    pub container_name: String,
    pub cpu_percent: String,
    pub memory_usage: String,
    pub net_io: String,
    pub block_io: String,
    /// Raw network bytes (rx, tx) — cumulative counters.
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
    /// Raw block I/O bytes (read, write) — cumulative counters.
    pub block_read_bytes: u64,
    pub block_write_bytes: u64,
}

/// Log stream providing async file handles for stdout/stderr
pub struct LogStream {
    pub stdout: Option<tokio::fs::File>,
    pub stderr: Option<tokio::fs::File>,
    container_id: String,
}

impl LogStream {
    pub fn container_id(&self) -> &str {
        &self.container_id
    }
}

/// Streaming event receiver from containerd events API
pub struct EventStream {
    pub receiver: tonic::Streaming<containerd_client::types::Envelope>,
}

/// Installer container handle for interactive install scripts
pub struct InstallerHandle {
    container_id: String,
    namespace: String,
    channel: tonic::transport::Channel,
    pub stdout_path: PathBuf,
    pub stderr_path: PathBuf,
}

impl InstallerHandle {
    pub async fn wait(&self) -> AgentResult<i32> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = WaitRequest {
            container_id: self.container_id.clone(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tasks.wait(req).await.map_err(grpc_err)?;
        Ok(resp.into_inner().exit_status as i32)
    }

    pub async fn cleanup(&self) -> AgentResult<()> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = DeleteTaskRequest {
            container_id: self.container_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;

        let mut containers = ContainersClient::new(self.channel.clone());
        let req = DeleteContainerRequest {
            id: self.container_id.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = containers.delete(req).await;

        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let req = RemoveSnapshotRequest {
            snapshotter: "overlayfs".to_string(),
            key: format!("{}-snap", self.container_id),
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = snaps.remove(req).await;

        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(&self.container_id);
        let _ = fs::remove_dir_all(&io_dir);
        Ok(())
    }
}

#[derive(Clone)]
pub struct ContainerdRuntime {
    _socket_path: String,
    namespace: String,
    channel: tonic::transport::Channel,
    container_io: Arc<Mutex<HashMap<String, ContainerIo>>>,
    dns_servers: Vec<String>,
    cpu_tracker: Arc<CpuTracker>,
}

impl ContainerdRuntime {
    /// Connect to containerd socket and create runtime
    pub async fn new(
        socket_path: PathBuf,
        namespace: String,
        dns_servers: Vec<String>,
    ) -> AgentResult<Self> {
        let channel = containerd_client::connect(&socket_path)
            .await
            .map_err(|e| {
                AgentError::ContainerError(format!(
                    "Failed to connect to containerd at {}: {}",
                    socket_path.display(),
                    e
                ))
            })?;
        info!("Connected to containerd at {}", socket_path.display());
        info!("DNS servers configured for containers: {:?}", dns_servers);
        Ok(Self {
            _socket_path: socket_path.to_string_lossy().to_string(),
            namespace,
            channel,
            container_io: Arc::new(Mutex::new(HashMap::new())),
            dns_servers,
            cpu_tracker: Arc::new(CpuTracker::new()),
        })
    }

    /// Create and start a container via containerd gRPC
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
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(config.container_id);
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
            let mut resolv_content = String::new();
            for dns in &self.dns_servers {
                resolv_content.push_str(&format!("nameserver {}\n", dns));
            }
            resolv_content.push_str("options attempts:3 timeout:2\n");

            // Use nsenter to write into the container's mount namespace
            let resolv_dest = "/etc/resolv.conf";
            let nsenter_output = Command::new("nsenter")
                .args(["-t", &pid.to_string(), "-m", "--", "sh", "-c"])
                .arg(format!(
                    "echo '{}' > {}",
                    resolv_content.trim(),
                    resolv_dest
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
                    }
                }
            }
        }

        Ok(config.container_id.to_string())
    }

    /// Spawn an ephemeral installer container via containerd gRPC
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

        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(&container_id);
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
        // Many install scripts download and execute binaries in /tmp; a dedicated
        // tmpfs without noexec ensures extracted executables can run.
        let mut mounts = base_mounts(data_dir);
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

        // Wrap the install script so all files are chowned to the runtime user (1000:1000)
        // after the user-provided script completes. The installer runs as root but the
        // runtime container runs as 1000:1000, so files must be accessible.
        //
        // Pterodactyl mounts server data at /mnt/server, but Catalyst mounts at /data.
        // Create a symlink so install scripts that hardcode /mnt/server still work.
        // Also set HOME=/data for compatibility with scripts that use $HOME.
        let wrapped_script = format!(
            "set -e\nrm -rf /mnt/server && ln -s /data /mnt/server\nexport HOME=/data\n\n{}\n\necho '[Catalyst] Fixing file ownership for runtime user...'\nchown -R 1000:1000 /data",
            script
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
                "seccomp": default_seccomp_profile()
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

        let req = StartRequest {
            container_id: container_id.clone(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(grpc_err)?;

        Ok(InstallerHandle {
            container_id,
            namespace: self.namespace.clone(),
            channel: self.channel.clone(),
            stdout_path,
            stderr_path,
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
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);

        let req = CreateTaskRequest {
            container_id: container_id.to_string(),
            stdin: io_dir.join("stdin").to_string_lossy().to_string(),
            stdout: io_dir.join("stdout").to_string_lossy().to_string(),
            stderr: io_dir.join("stderr").to_string_lossy().to_string(),
            rootfs: mounts,
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.create(req).await.map_err(grpc_err)?;

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

    /// Force kill a container with SIGKILL (signal 9).
    /// This method is designed to NEVER fail - it will always attempt cleanup
    /// and is meant for stuck/unresponsive containers.
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
        let _ = fs::remove_dir_all(PathBuf::from(CONSOLE_BASE_DIR).join(container_id));
        Ok(())
    }

    // -- Console I/O --

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
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
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

    // -- Logs --

    pub async fn get_logs(&self, container_id: &str, lines: Option<u32>) -> AgentResult<String> {
        let base = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
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
        let base = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
        let mut positions = [0u64; 2];
        let paths = [base.join("stdout"), base.join("stderr")];
        loop {
            let running = self
                .is_container_running(container_id)
                .await
                .unwrap_or(false);
            for i in 0..2 {
                if let Ok(content) = tokio::fs::read_to_string(&paths[i]).await {
                    if (positions[i] as usize) < content.len() {
                        for line in content[positions[i] as usize..].lines() {
                            callback(line.to_string()).await;
                        }
                        positions[i] = content.len() as u64;
                    }
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
        let base = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
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

    // -- Info & status --

    pub async fn list_containers(&self) -> AgentResult<Vec<ContainerInfo>> {
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
            });
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
        let cni_state = format!("/var/lib/cni/results/catalyst-{}", container_id);
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
        if let Ok(mut entries) = tokio::fs::read_dir("/var/lib/cni/networks").await {
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

    // -- Stats (cgroup v2) --

    pub async fn get_stats(&self, container_id: &str) -> AgentResult<ContainerStats> {
        tokio::time::timeout(Duration::from_secs(10), self.get_stats_inner(container_id))
            .await
            .map_err(|_| {
                AgentError::ContainerError(format!("get_stats timed out for {}", container_id))
            })?
    }

    async fn get_stats_inner(&self, container_id: &str) -> AgentResult<ContainerStats> {
        let cg = find_container_cgroup(container_id)
            .await
            .unwrap_or_default();
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
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
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

    // -- Events --

    pub async fn subscribe_to_container_events(
        &self,
        container_id: &str,
    ) -> AgentResult<EventStream> {
        let mut client = EventsClient::new(self.channel.clone());
        // Containerd's filter parser requires quoting values that contain
        // special characters like '/'.  Without quotes the '/' in topic
        // paths (e.g. /tasks/exit) is misinterpreted as a filter delimiter
        // and causes a parse error.
        let req = SubscribeRequest {
            filters: vec![
                format!("topic==\"/tasks/exit\",container=={}", container_id),
                format!("topic==\"/tasks/start\",container=={}", container_id),
                format!("topic==\"/tasks/delete\",container=={}", container_id),
            ],
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tokio::time::timeout(Duration::from_secs(10), client.subscribe(req))
            .await
            .map_err(|_| {
                AgentError::ContainerError("subscribe_to_container_events timed out".to_string())
            })?
            .map_err(grpc_err)?;
        Ok(EventStream {
            receiver: resp.into_inner(),
        })
    }

    pub async fn subscribe_to_all_events(&self) -> AgentResult<EventStream> {
        let mut client = EventsClient::new(self.channel.clone());
        let req = SubscribeRequest {
            filters: vec![
                "topic~=\"/tasks/\"".to_string(),
                "topic~=\"/containers/\"".to_string(),
            ],
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = tokio::time::timeout(Duration::from_secs(10), client.subscribe(req))
            .await
            .map_err(|_| {
                AgentError::ContainerError("subscribe_to_all_events timed out".to_string())
            })?
            .map_err(grpc_err)?;
        Ok(EventStream {
            receiver: resp.into_inner(),
        })
    }

    // -- IP allocation --

    pub async fn clean_stale_ip_allocations(&self, network: &str) -> AgentResult<usize> {
        let dir = format!("/var/lib/cni/networks/{}", network);
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(AgentError::IoError(e.to_string())),
        };
        let containers = self.list_containers().await?;
        let mut active_ips = HashSet::new();
        let mut running = 0;
        for c in containers {
            if !c.status.contains("Up") {
                continue;
            }
            running += 1;
            if let Ok(ip) = self.get_container_ip(&c.id).await {
                if !ip.is_empty() {
                    active_ips.insert(ip);
                }
            }
        }
        if running > 0 && active_ips.is_empty() {
            return Ok(0);
        }
        let mut removed = 0;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let name = match entry.file_name().into_string() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if name == "lock" || name.starts_with("last_reserved_ip") {
                continue;
            }
            if name.parse::<Ipv4Addr>().is_err() {
                continue;
            }
            if !active_ips.contains(&name) {
                if let Ok(md) = tokio::fs::metadata(&path).await {
                    if let Ok(m) = md.modified() {
                        if let Ok(age) = SystemTime::now().duration_since(m) {
                            if age < Duration::from_secs(60) {
                                continue;
                            }
                        }
                    }
                }
                if tokio::fs::remove_file(&path).await.is_ok() {
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }

    pub fn release_static_ip(network: &str, ip: &str) -> std::io::Result<()> {
        fs::remove_file(format!("/var/lib/cni/networks/{}/{}", network, ip))
    }

    // -- Internal helpers --

    async fn wait_for_exit(&self, container_id: &str) -> AgentResult<u32> {
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

    async fn ensure_container_io(&self, container_id: &str) -> AgentResult<bool> {
        if self.container_io.lock().await.contains_key(container_id) {
            return Ok(true);
        }
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
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

    async fn ensure_image(&self, image: &str) -> AgentResult<()> {
        let qualified = Self::qualify_image_ref(image);
        let mut client = ImagesClient::new(self.channel.clone());
        let req = GetImageRequest {
            name: qualified.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        match client.get(req).await {
            Ok(_) => return Ok(()),
            Err(e) if e.code() == tonic::Code::NotFound => {
                info!("Image {} not found, pulling...", qualified)
            }
            Err(e) => return Err(grpc_err(e)),
        }
        let output = Command::new("ctr")
            .arg("-n")
            .arg(&self.namespace)
            .arg("images")
            .arg("pull")
            .arg(&qualified)
            .output()
            .await
            .map_err(|e| AgentError::ContainerError(format!("pull: {}", e)))?;
        if !output.status.success() {
            return Err(AgentError::ContainerError(format!(
                "Image pull failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        info!("Image {} pulled", qualified);
        Ok(())
    }

    /// Normalize a Docker-style short image reference to a fully-qualified containerd reference.
    /// e.g. "eclipse-temurin:21-jre" -> "docker.io/library/eclipse-temurin:21-jre"
    ///      "ghcr.io/org/image:tag"  -> "ghcr.io/org/image:tag" (unchanged)
    fn qualify_image_ref(image: &str) -> String {
        let name = image.split(':').next().unwrap_or(image);
        if name.contains('/') {
            // Already has a registry or org prefix (e.g. ghcr.io/org/img, user/img)
            image.to_string()
        } else {
            // Bare image name like "alpine:3.19" -> "docker.io/library/alpine:3.19"
            format!("docker.io/library/{}", image)
        }
    }

    /// Read the OCI image config to extract default environment variables.
    /// Falls back to empty vec on any error (best-effort).
    async fn get_image_env(&self, image: &str) -> Vec<String> {
        match self.get_image_env_inner(image).await {
            Ok(env) => env,
            Err(e) => {
                warn!("Failed to read image env for {}: {}", image, e);
                vec![]
            }
        }
    }

    async fn get_image_env_inner(&self, image: &str) -> AgentResult<Vec<String>> {
        let config_digest = self.resolve_image_config_digest(image).await?;

        let config_bytes = self.read_content_blob(&config_digest).await?;
        let config: serde_json::Value = serde_json::from_slice(&config_bytes)
            .map_err(|e| AgentError::ContainerError(format!("Bad config JSON: {}", e)))?;

        Ok(config
            .get("config")
            .and_then(|c| c.get("Env"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Read the OCI image config to extract Entrypoint and Cmd.
    /// Falls back to (None, None) on any error (best-effort).
    async fn get_image_entrypoint(
        &self,
        image: &str,
    ) -> (Option<Vec<String>>, Option<Vec<String>>) {
        match self.get_image_entrypoint_inner(image).await {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to read image entrypoint for {}: {}", image, e);
                (None, None)
            }
        }
    }

    async fn get_image_entrypoint_inner(
        &self,
        image: &str,
    ) -> AgentResult<(Option<Vec<String>>, Option<Vec<String>>)> {
        let config_digest = self.resolve_image_config_digest(image).await?;
        let config_bytes = self.read_content_blob(&config_digest).await?;
        let config: serde_json::Value = serde_json::from_slice(&config_bytes)
            .map_err(|e| AgentError::ContainerError(format!("Bad config JSON: {}", e)))?;

        let entrypoint = config
            .get("config")
            .and_then(|c| c.get("Entrypoint"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });

        let cmd = config
            .get("config")
            .and_then(|c| c.get("Cmd"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });

        Ok((entrypoint, cmd))
    }

    async fn resolve_image_config_digest(&self, image: &str) -> AgentResult<String> {
        let mut images = ImagesClient::new(self.channel.clone());
        let req = GetImageRequest {
            name: image.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = images.get(req).await.map_err(grpc_err)?;
        let img = resp
            .into_inner()
            .image
            .ok_or_else(|| AgentError::ContainerError("No image returned".into()))?;
        let target = img
            .target
            .ok_or_else(|| AgentError::ContainerError("Image has no target descriptor".into()))?;

        let manifest_bytes = self.read_content_blob(&target.digest).await?;
        let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
            .map_err(|e| AgentError::ContainerError(format!("Bad manifest JSON: {}", e)))?;

        if let Some(manifests) = manifest.get("manifests").and_then(|v| v.as_array()) {
            let manifest_digest = manifests
                .iter()
                .find(|m| {
                    let p = m.get("platform");
                    p.and_then(|p| p.get("architecture"))
                        .and_then(|v| v.as_str())
                        == Some("amd64")
                        && p.and_then(|p| p.get("os")).and_then(|v| v.as_str()) == Some("linux")
                })
                .or_else(|| manifests.first())
                .and_then(|m| m.get("digest"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| AgentError::ContainerError("No manifest in index".into()))?;
            let inner_bytes = self.read_content_blob(manifest_digest).await?;
            let inner: serde_json::Value = serde_json::from_slice(&inner_bytes)
                .map_err(|e| AgentError::ContainerError(format!("Bad inner manifest: {}", e)))?;
            return inner
                .get("config")
                .and_then(|c| c.get("digest"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string())
                .ok_or_else(|| AgentError::ContainerError("No config in manifest".into()));
        }

        manifest
            .get("config")
            .and_then(|c| c.get("digest"))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string())
            .ok_or_else(|| AgentError::ContainerError("No config in manifest".into()))
    }

    async fn resolve_snapshot_parent_key(&self, image: &str) -> AgentResult<Option<String>> {
        let config_digest = self.resolve_image_config_digest(image).await?;
        let mut content = ContentClient::new(self.channel.clone());
        let req = InfoRequest {
            digest: config_digest,
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = content.info(req).await.map_err(grpc_err)?;
        let labels = resp
            .into_inner()
            .info
            .map(|info| info.labels)
            .unwrap_or_default();
        Ok(labels
            .get("containerd.io/gc.ref.snapshot.overlayfs")
            .cloned())
    }

    async fn read_content_blob(&self, digest: &str) -> AgentResult<Vec<u8>> {
        let mut content = ContentClient::new(self.channel.clone());
        let req = ReadContentRequest {
            digest: digest.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let mut stream = content.read(req).await.map_err(grpc_err)?.into_inner();
        let mut data = Vec::new();
        while let Some(chunk) = stream.message().await.map_err(grpc_err)? {
            data.extend_from_slice(&chunk.data);
            if data.len() > MAX_CONTENT_BLOB_SIZE {
                return Err(AgentError::InvalidRequest(
                    "Content blob exceeds maximum size".to_string(),
                ));
            }
        }
        Ok(data)
    }

    async fn prepare_snapshot(&self, image: &str, key: &str) -> AgentResult<()> {
        let _ = Command::new("ctr")
            .arg("-n")
            .arg(&self.namespace)
            .arg("images")
            .arg("unpack")
            .arg("--snapshotter")
            .arg("overlayfs")
            .arg(image)
            .output()
            .await;

        let mut snaps = SnapshotsClient::new(self.channel.clone());
        // Try using image ref as parent first (works on some containerd setups).
        let req = PrepareSnapshotRequest {
            snapshotter: "overlayfs".to_string(),
            key: key.to_string(),
            parent: image.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        if let Ok(Ok(_)) = tokio::time::timeout(Duration::from_secs(10), snaps.prepare(req)).await {
            return Ok(());
        }

        // Resolve the exact unpacked snapshot parent for this image from content labels.
        if let Some(parent) = self.resolve_snapshot_parent_key(image).await? {
            let req = PrepareSnapshotRequest {
                snapshotter: "overlayfs".to_string(),
                key: key.to_string(),
                parent: parent.clone(),
                ..Default::default()
            };
            let req = with_namespace!(req, &self.namespace);
            match tokio::time::timeout(Duration::from_secs(10), snaps.prepare(req)).await {
                Ok(Ok(_)) => return Ok(()),
                _ => {
                    warn!(
                        "prepare snapshot with resolved parent {} failed for image {}",
                        parent, image
                    );
                }
            }
        } else {
            warn!(
                "No overlayfs snapshot parent label found for image {}",
                image
            );
        }

        Err(AgentError::ContainerError(format!(
            "Failed to prepare snapshot for {}",
            image
        )))
    }

    async fn get_snapshot_mounts(
        &self,
        key: &str,
    ) -> AgentResult<Vec<containerd_client::types::Mount>> {
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let req = MountsRequest {
            snapshotter: "overlayfs".to_string(),
            key: key.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        Ok(snaps
            .mounts(req)
            .await
            .map_err(grpc_err)?
            .into_inner()
            .mounts)
    }

    fn build_oci_spec(
        &self,
        config: &ContainerConfig<'_>,
        io_dir: &Path,
        use_host_network: bool,
        image_env: &[String],
        image_entrypoint: Option<&[String]>,
        image_cmd: Option<&[String]>,
    ) -> AgentResult<serde_json::Value> {
        // Start with image env as base, then overlay our defaults and config env.
        // This preserves image-specific PATH, JAVA_HOME, etc.
        let mut env_map: HashMap<String, String> = HashMap::new();
        for entry in image_env {
            if let Some((k, v)) = entry.split_once('=') {
                env_map.insert(k.to_string(), v.to_string());
            }
        }
        // Template/config env takes highest priority
        for (k, v) in config.env {
            env_map.insert(k.to_string(), v.to_string());
        }
        // Ensure PATH is usable for JVM-based images even if image env probing fails
        // or template/server env accidentally overrides PATH.
        // The Pterodactyl Hytale image provides java at /opt/java/openjdk/bin/java.
        const DEFAULT_PATH: &str =
            "/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
        let path_value = env_map.get("PATH").map(|v| v.trim()).unwrap_or("");
        if path_value.is_empty() {
            env_map.insert("PATH".to_string(), DEFAULT_PATH.to_string());
        } else if !path_value
            .split(':')
            .any(|segment| segment == "/opt/java/openjdk/bin")
        {
            env_map.insert(
                "PATH".to_string(),
                format!("/opt/java/openjdk/bin:{}", path_value),
            );
        }
        env_map.insert("TERM".to_string(), "xterm".to_string());
        // Runtime container runs as 1000:1000; set HOME to the data dir
        env_map.insert("HOME".to_string(), "/data".to_string());
        if !config.startup_command.is_empty() {
            env_map.insert("STARTUP".to_string(), config.startup_command.to_string());
        }
        let env_list: Vec<String> = env_map
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();

        let args = if let Some(entrypoint) = image_entrypoint {
            let mut args = entrypoint.to_vec();
            if !config.startup_command.is_empty() {
                // Startup commands from templates often contain shell syntax
                // (arithmetic expansion, command substitution, etc.) that must be
                // parsed by a shell.  Passing them as a single argument to an
                // image entrypoint that does `exec "$@"` causes the entire string
                // to be treated as one binary name.  Wrap in `sh -c` so the
                // entrypoint's exec/eval passes it to a shell.
                let needs_shell = config.startup_command.contains("$(")
                    || config.startup_command.contains("[[")
                    || config.startup_command.contains("$((")
                    || config.startup_command.contains('`')
                    || config.startup_command.contains(';')
                    || config.startup_command.contains("&&")
                    || config.startup_command.contains("||");
                if needs_shell {
                    args.push("/bin/sh".to_string());
                    args.push("-c".to_string());
                }
                args.push(config.startup_command.to_string());
            } else if let Some(cmd) = image_cmd {
                args.extend(cmd.iter().cloned());
            }
            args
        } else if !config.startup_command.is_empty() {
            let escaped_startup = shell_escape_value(config.startup_command);
            // Some templates (e.g. Hytale) use bash-specific process substitution or
            // other features that dash/sh cannot handle.  Detect those and use bash
            // instead of /bin/sh so the command works on all distros.
            let shell = if crate::websocket_handler::requires_bash(config.startup_command) {
                "/bin/bash"
            } else {
                "/bin/sh"
            };
            let wrapped_command = format!(
                "export PATH=\"/opt/java/openjdk/bin:${{PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}}\"; exec {} -c {}",
                shell, escaped_startup
            );
            vec![shell.to_string(), "-c".to_string(), wrapped_command]
        } else {
            vec!["/bin/sh".to_string()]
        };

        let mem_limit = (config.memory_mb as i64) * 1024 * 1024;
        // Swap: memory + swap (0 means no swap limit). OCI spec uses
        // memory.swap as the total (memory + swap), not swap alone.
        let mem_swap = if config.swap_mb > 0 {
            Some(((config.memory_mb + config.swap_mb) as i64) * 1024 * 1024)
        } else {
            None
        };
        let cpu_quota = (config.cpu_cores as i64) * 100_000;
        let cgroup_path = format!("/{}/{}", self.namespace, config.container_id);
        // Runtime containers run as non-root (1000:1000) and need minimal capabilities.
        let caps = ["CAP_NET_BIND_SERVICE"];
        let mut mounts = base_mounts(config.data_dir);
        // Pterodactyl images expect server data at /home/container; bind it to the same host dir as /data
        mounts.push(serde_json::json!({"destination":"/home/container","type":"bind","source":config.data_dir,"options":["rbind","rw"]}));
        // Mount only stdin as rw; stdout/stderr are log sinks that the container
        // process should not write to directly.  This reduces the blast radius of
        // an RCE inside the game server.
        mounts.push(serde_json::json!({"destination":io_dir.join("stdin").to_string_lossy(),"type":"bind","source":io_dir.join("stdin").to_string_lossy(),"options":["rbind","rw"]}));
        mounts.push(serde_json::json!({"destination":io_dir.join("stdout").to_string_lossy(),"type":"bind","source":io_dir.join("stdout").to_string_lossy(),"options":["rbind","ro"]}));
        mounts.push(serde_json::json!({"destination":io_dir.join("stderr").to_string_lossy(),"type":"bind","source":io_dir.join("stderr").to_string_lossy(),"options":["rbind","ro"]}));

        // Generate /etc/hosts so the container hostname resolves (Java getLocalHost() etc.)
        let hosts_path = io_dir.join("hosts");
        let hosts_content = format!(
            "127.0.0.1\tlocalhost\n::1\tlocalhost\n127.0.0.1\t{}\n",
            config.container_id
        );
        fs::write(&hosts_path, &hosts_content).ok();
        mounts.push(serde_json::json!({"destination":"/etc/hosts","type":"bind","source":hosts_path.to_string_lossy().to_string(),"options":["rbind","rw"]}));

        // Provide /etc/resolv.conf for DNS resolution inside the container
        // Use configured DNS servers (defaults to 1.1.1.1, 8.8.8.8)
        let resolv_path = io_dir.join("resolv.conf");
        {
            let mut resolv = String::new();
            for dns in &self.dns_servers {
                resolv.push_str(&format!("nameserver {}\n", dns));
            }
            // Add options for better DNS behavior
            resolv.push_str("options attempts:3 timeout:2\n");
            info!("Container {} resolv.conf:\n{}", config.container_id, resolv);
            fs::write(&resolv_path, &resolv).ok();
        }
        mounts.push(serde_json::json!({"destination":"/etc/resolv.conf","type":"bind","source":resolv_path.to_string_lossy().to_string(),"options":["rbind","rw"]}));

        // Generate a per-container /etc/machine-id so that containers cannot
        // fingerprint the host or correlate with other servers on the same node.
        // Java's SecureRandom and other tools may use this for seeding.
        let machine_id_path = io_dir.join("machine-id");
        if !machine_id_path.exists() {
            let unique_id = format!("{:032x}", uuid::Uuid::new_v4().as_u128());
            fs::write(&machine_id_path, &unique_id).ok();
        }
        mounts.push(serde_json::json!({"destination":"/etc/machine-id","type":"bind","source":machine_id_path.to_string_lossy(),"options":["rbind","ro"]}));
        mounts.push(serde_json::json!({"destination":"/var/lib/dbus/machine-id","type":"bind","source":machine_id_path.to_string_lossy(),"options":["rbind","ro"]}));
        let mut ns = vec![
            serde_json::json!({"type":"pid"}),
            serde_json::json!({"type":"ipc"}),
            serde_json::json!({"type":"uts"}),
            serde_json::json!({"type":"mount"}),
        ];
        if !use_host_network {
            ns.push(serde_json::json!({"type":"network"}));
        }

        let devices = DeviceProfile::standard().devices;

        Ok(serde_json::json!({
            "ociVersion":"1.1.0",
            "process":{"terminal":false,"user":{"uid":1000,"gid":1000},"args":args,"env":env_list,"cwd":"/data",
                "capabilities":{"bounding":caps,"effective":caps,"permitted":caps,"ambient":caps},
                "noNewPrivileges":true,"rlimits":[{"type":"RLIMIT_NOFILE","hard":65536u64,"soft":65536u64}]},
            "root":{"path":"rootfs","readonly":false},"hostname":config.container_id,"mounts":mounts,
            "linux":{"cgroupsPath":cgroup_path,"resources":{"memory":{"limit":mem_limit,
                "swap":mem_swap},"cpu":{"quota":cpu_quota,"period":100000u64},
                "blockIO":{"weight":config.io_weight},
                "devices":devices},
                "namespaces":ns,"maskedPaths":masked_paths(),"readonlyPaths":readonly_paths(),
                "seccomp": default_seccomp_profile()}
        }))
    }

    async fn setup_cni_network(
        &self,
        container_id: &str,
        pid: u32,
        network_mode: Option<&str>,
        network_ip: Option<&str>,
        primary_port: u16,
        port_bindings: &HashMap<u16, u16>,
    ) -> AgentResult<()> {
        let network = network_mode.unwrap_or("bridge");
        if network == "host" {
            return Ok(());
        }
        let netns = self.resolve_task_netns(container_id, pid).await?;

        // Build DNS configuration from configured DNS servers
        let dns_config = if !self.dns_servers.is_empty() {
            serde_json::json!({
                "nameservers": self.dns_servers,
                "options": ["attempts:3", "timeout:2"]
            })
        } else {
            serde_json::json!({
                "nameservers": ["1.1.1.1", "8.8.8.8"],
                "options": ["attempts:3", "timeout:2"]
            })
        };

        let mut cfg = if network == "bridge" || network == "default" {
            // Bridge network uses NAT with private subnet 10.42.0.0/16
            // This matches the macvlan config structure with rangeStart/rangeEnd/gateway
            serde_json::json!({
                "cniVersion": "1.0.0",
                "name": "catalyst",
                "type": "bridge",
                "bridge": "catalyst0",
                "isGateway": true,
                "ipMasq": true,
                "dns": dns_config,
                "ipam": {
                    "type": "host-local",
                    "ranges": [[{
                        "subnet": "10.42.0.0/16",
                        "rangeStart": "10.42.0.10",
                        "rangeEnd": "10.42.255.250",
                        "gateway": "10.42.0.1"
                    }]],
                    "routes": [{"dst": "0.0.0.0/0"}],
                    "dataDir": "/var/lib/cni/networks"
                }
            })
        } else {
            // For custom networks, prefer explicit CNI config written by NetworkManager.
            if let Some(mut cfg) = load_named_cni_plugin_config(network) {
                // Add DNS config if not present
                if cfg.get("dns").is_none() {
                    cfg["dns"] = dns_config.clone();
                }
                cfg
            } else {
                // Fallback: synthesize a macvlan config from detected host network.
                // This matches the structure used by NetworkManager with rangeStart/rangeEnd
                let (iface, subnet, gateway) = detect_host_network().await.unwrap_or_else(|| {
                    warn!("Could not detect host network, falling back to eth0/10.0.0.0");
                    (
                        "eth0".to_string(),
                        "10.0.0.0/24".to_string(),
                        "10.0.0.1".to_string(),
                    )
                });
                // Calculate rangeStart/rangeEnd from subnet (same logic as NetworkManager)
                let (range_start, range_end) = calculate_ip_range_from_subnet(&subnet);
                info!(
                    "macvlan network '{}': master={}, subnet={}, gateway={}, range={}-{}",
                    network, iface, subnet, gateway, range_start, range_end
                );
                serde_json::json!({
                    "cniVersion": "1.0.0",
                    "name": network,
                    "type": "macvlan",
                    "master": iface,
                    "mode": "bridge",
                    "dns": dns_config,
                    "ipam": {
                        "type": "host-local",
                        "ranges": [[{
                            "subnet": subnet,
                            "rangeStart": range_start,
                            "rangeEnd": range_end,
                            "gateway": gateway
                        }]],
                        "routes": [{"dst": "0.0.0.0/0"}],
                        "dataDir": "/var/lib/cni/networks"
                    }
                })
            }
        };
        if let Some(ip) = network_ip {
            if let Some(ipam) = cfg.get_mut("ipam") {
                // Determine prefix length from the subnet in config
                let prefix = ipam
                    .get("ranges")
                    .and_then(|r| r.get(0))
                    .and_then(|r| r.get(0))
                    .and_then(|r| r.get("subnet"))
                    .and_then(|s| s.as_str())
                    .or_else(|| ipam.get("subnet").and_then(|s| s.as_str()))
                    .and_then(|s| s.split('/').nth(1))
                    .unwrap_or("24");
                ipam["addresses"] = serde_json::json!([{"address":format!("{}/{}", ip, prefix)}]);
            } else {
                warn!(
                    "Ignoring requested static IP {} for network {} because ipam config is missing",
                    ip, network
                );
            }
        }
        // Store CNI config for proper teardown
        let cfg_path = format!("/var/lib/cni/results/catalyst-{}-config", container_id);
        if let Ok(j) = serde_json::to_string(&cfg) {
            let _ = fs::write(&cfg_path, &j);
        }
        let result = self
            .exec_cni_plugin(&cfg, "ADD", container_id, &netns, "eth0")
            .await?;
        let rp = format!("/var/lib/cni/results/catalyst-{}", container_id);
        if let Ok(j) = serde_json::to_string_pretty(&result) {
            let _ = fs::write(&rp, &j);
        }
        let cip = result
            .get("ips")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|ip| ip.get("address"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .split('/')
            .next()
            .unwrap_or("");
        if !cip.is_empty() {
            let mut forwards: Vec<PortForward> = Vec::new();
            if !port_bindings.is_empty() {
                for (cp, hp) in port_bindings {
                    self.setup_port_forward(*hp, *cp, cip).await?;
                    forwards.push(PortForward {
                        host_port: *hp,
                        container_port: *cp,
                    });
                }
            } else if primary_port > 0 {
                self.setup_port_forward(primary_port, primary_port, cip)
                    .await?;
                forwards.push(PortForward {
                    host_port: primary_port,
                    container_port: primary_port,
                });
            }

            if !forwards.is_empty() {
                let state = PortForwardState {
                    container_ip: cip.to_string(),
                    forwards,
                };
                let state_path = format!(
                    "{}/{}{}-ports.json",
                    PORT_FWD_STATE_DIR, PORT_FWD_STATE_PREFIX, container_id
                );
                if let Ok(j) = serde_json::to_string_pretty(&state) {
                    let _ = fs::write(&state_path, &j);
                }
            }
        }

        // For bridge network, ensure FORWARD rules allow traffic to external
        if network == "bridge" || network == "default" {
            self.ensure_bridge_forward_rules().await;
        }

        Ok(())
    }

    /// Ensure iptables FORWARD rules allow traffic from bridge to external.
    /// Detects the default route interface dynamically instead of hardcoding it.
    async fn ensure_bridge_forward_rules(&self) {
        // Detect the host's default route interface
        let external_iface = detect_default_route_interface().await.unwrap_or_else(|| {
            warn!("Could not detect default route interface; bridge FORWARD rules may not work");
            String::new()
        });
        if external_iface.is_empty() {
            return;
        }
        let iface = external_iface.as_str();

        // Check if rules already exist to avoid duplicates
        let check_output = Command::new("iptables")
            .args([
                "-C",
                "FORWARD",
                "-i",
                "catalyst0",
                "-o",
                iface,
                "-j",
                "ACCEPT",
            ])
            .output()
            .await;

        if let Ok(output) = check_output {
            if !output.status.success() {
                // Rule doesn't exist, add it
                let result = Command::new("iptables")
                    .args([
                        "-I",
                        "FORWARD",
                        "1",
                        "-i",
                        "catalyst0",
                        "-o",
                        iface,
                        "-j",
                        "ACCEPT",
                    ])
                    .output()
                    .await;
                match result {
                    Ok(o) if o.status.success() => {
                        info!("Added FORWARD rule: catalyst0 -> {}", iface)
                    }
                    Ok(o) => warn!(
                        "Failed to add FORWARD rule: {}",
                        String::from_utf8_lossy(&o.stderr)
                    ),
                    Err(e) => warn!("Failed to execute iptables: {}", e),
                }

                let result = Command::new("iptables")
                    .args([
                        "-I",
                        "FORWARD",
                        "2",
                        "-i",
                        iface,
                        "-o",
                        "catalyst0",
                        "-j",
                        "ACCEPT",
                    ])
                    .output()
                    .await;
                match result {
                    Ok(o) if o.status.success() => {
                        info!(
                            "Added FORWARD rule: {} -> catalyst0 (allow new connections)",
                            iface
                        )
                    }
                    Ok(o) => warn!(
                        "Failed to add FORWARD rule: {}",
                        String::from_utf8_lossy(&o.stderr)
                    ),
                    Err(e) => warn!("Failed to execute iptables: {}", e),
                }
            }
        }
    }

    async fn resolve_task_netns(
        &self,
        container_id: &str,
        initial_pid: u32,
    ) -> AgentResult<String> {
        let mut pid = initial_pid;
        let mut last_get_err: Option<String> = None;

        for _ in 0..20 {
            if pid > 0 {
                let netns = format!("/proc/{}/ns/net", pid);
                if Path::new(&netns).exists() {
                    return Ok(netns);
                }
            }

            let mut tasks = TasksClient::new(self.channel.clone());
            let req = containerd_client::services::v1::GetRequest {
                container_id: container_id.to_string(),
                ..Default::default()
            };
            let req = with_namespace!(req, &self.namespace);
            match tasks.get(req).await {
                Ok(resp) => {
                    pid = resp.into_inner().process.map(|p| p.pid).unwrap_or(0);
                }
                Err(err) => {
                    last_get_err = Some(format!("{}: {}", err.code(), err.message()));
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        let detail = last_get_err
            .map(|value| format!(", last task.get error: {}", value))
            .unwrap_or_default();
        Err(AgentError::ContainerError(format!(
            "Unable to resolve task network namespace for {} (initial pid {}, last pid {}){}",
            container_id, initial_pid, pid, detail
        )))
    }

    async fn exec_cni_plugin(
        &self,
        config: &serde_json::Value,
        command: &str,
        cid: &str,
        netns: &str,
        ifname: &str,
    ) -> AgentResult<serde_json::Value> {
        let ptype = config["type"].as_str().unwrap_or("bridge");
        let cni_bin_dir = discover_cni_bin_dir();
        let ppath = format!("{}/{}", cni_bin_dir, ptype);
        if !Path::new(&ppath).exists() {
            return Err(AgentError::ContainerError(format!(
                "CNI plugin not found: {} (searched directories: {:?})",
                ppath, CNI_BIN_DIRS
            )));
        }
        let cfg =
            serde_json::to_string(config).map_err(|e| AgentError::ContainerError(e.to_string()))?;
        let mut child = Command::new(&ppath)
            .env("CNI_COMMAND", command)
            .env("CNI_CONTAINERID", cid)
            .env("CNI_NETNS", netns)
            .env("CNI_IFNAME", ifname)
            .env("CNI_PATH", cni_bin_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AgentError::ContainerError(format!("CNI: {}", e)))?;
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            stdin.write_all(cfg.as_bytes()).await?;
            drop(stdin);
        }
        let out = child.wait_with_output().await?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let plugin_msg = serde_json::from_slice::<serde_json::Value>(&out.stdout)
                .ok()
                .and_then(|v| v.get("msg").and_then(|m| m.as_str()).map(|s| s.to_string()))
                .unwrap_or_default();
            return Err(AgentError::ContainerError(format!(
                "CNI {} failed (plugin={}, netns={}, status={}): msg='{}' stderr='{}' stdout='{}'",
                command, ptype, netns, out.status, plugin_msg, stderr, stdout
            )));
        }
        Ok(serde_json::from_slice(&out.stdout).unwrap_or(serde_json::json!({})))
    }

    async fn setup_port_forward(&self, hp: u16, cp: u16, cip: &str) -> AgentResult<()> {
        let dest = format!("{}:{}", cip, cp);
        let hps = hp.to_string();
        let cps = cp.to_string();
        // Set up forwarding for both TCP and UDP (many game servers use UDP)
        for proto in ["tcp", "udp"] {
            for args in [
                vec![
                    "-t",
                    "nat",
                    "-A",
                    "PREROUTING",
                    "-p",
                    proto,
                    "--dport",
                    &hps,
                    "-j",
                    "DNAT",
                    "--to-destination",
                    &dest,
                ],
                vec![
                    "-t",
                    "nat",
                    "-A",
                    "OUTPUT",
                    "-p",
                    proto,
                    "--dport",
                    &hps,
                    "-j",
                    "DNAT",
                    "--to-destination",
                    &dest,
                ],
            ] {
                let o = Command::new("iptables").args(&args).output().await?;
                if !o.status.success() {
                    warn!("iptables: {}", String::from_utf8_lossy(&o.stderr));
                }
            }
        }
        // MASQUERADE rule for outgoing traffic (needed for NAT)
        for args in [
            vec![
                "-t",
                "nat",
                "-A",
                "POSTROUTING",
                "-p",
                "tcp",
                "-d",
                cip,
                "--dport",
                &cps,
                "-j",
                "MASQUERADE",
            ],
            vec![
                "-t",
                "nat",
                "-A",
                "POSTROUTING",
                "-p",
                "udp",
                "-d",
                cip,
                "--dport",
                &cps,
                "-j",
                "MASQUERADE",
            ],
        ] {
            let o = Command::new("iptables").args(&args).output().await?;
            if !o.status.success() {
                warn!("iptables: {}", String::from_utf8_lossy(&o.stderr));
            }
        }
        Ok(())
    }

    async fn teardown_port_forward(&self, container_id: &str) -> AgentResult<()> {
        let state_path = format!(
            "{}/{}{}-ports.json",
            PORT_FWD_STATE_DIR, PORT_FWD_STATE_PREFIX, container_id
        );
        if !Path::new(&state_path).exists() {
            return Ok(());
        }

        let raw = match fs::read_to_string(&state_path) {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to read port-forward state {}: {}", state_path, e);
                let _ = fs::remove_file(&state_path);
                return Ok(());
            }
        };
        let state: PortForwardState = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to parse port-forward state {}: {}", state_path, e);
                let _ = fs::remove_file(&state_path);
                return Ok(());
            }
        };

        for fwd in &state.forwards {
            let _ = self
                .teardown_port_forward_rules(fwd.host_port, fwd.container_port, &state.container_ip)
                .await;
        }
        let _ = fs::remove_file(&state_path);
        Ok(())
    }

    async fn teardown_port_forward_rules(&self, hp: u16, cp: u16, cip: &str) -> AgentResult<()> {
        if cip.is_empty() {
            return Ok(());
        }
        let dest = format!("{}:{}", cip, cp);
        let hps = hp.to_string();
        let cps = cp.to_string();
        // Teardown both TCP and UDP rules
        for proto in ["tcp", "udp"] {
            for args in [
                vec![
                    "-t",
                    "nat",
                    "-D",
                    "PREROUTING",
                    "-p",
                    proto,
                    "--dport",
                    &hps,
                    "-j",
                    "DNAT",
                    "--to-destination",
                    &dest,
                ],
                vec![
                    "-t",
                    "nat",
                    "-D",
                    "OUTPUT",
                    "-p",
                    proto,
                    "--dport",
                    &hps,
                    "-j",
                    "DNAT",
                    "--to-destination",
                    &dest,
                ],
            ] {
                let o = Command::new("iptables").args(&args).output().await?;
                if !o.status.success() {
                    warn!("iptables: {}", String::from_utf8_lossy(&o.stderr));
                }
            }
        }
        for args in [
            vec![
                "-t",
                "nat",
                "-D",
                "POSTROUTING",
                "-p",
                "tcp",
                "-d",
                cip,
                "--dport",
                &cps,
                "-j",
                "MASQUERADE",
            ],
            vec![
                "-t",
                "nat",
                "-D",
                "POSTROUTING",
                "-p",
                "udp",
                "-d",
                cip,
                "--dport",
                &cps,
                "-j",
                "MASQUERADE",
            ],
        ] {
            let o = Command::new("iptables").args(&args).output().await?;
            if !o.status.success() {
                warn!("iptables: {}", String::from_utf8_lossy(&o.stderr));
            }
        }
        Ok(())
    }

    async fn teardown_cni_network(&self, container_id: &str) -> AgentResult<()> {
        let _ = self.teardown_port_forward(container_id).await;
        let rp = format!("/var/lib/cni/results/catalyst-{}", container_id);
        if !Path::new(&rp).exists() {
            return Ok(());
        }
        // Load stored CNI config for proper teardown (bridge vs macvlan)
        let cfg_path = format!("/var/lib/cni/results/catalyst-{}-config", container_id);
        let cfg = fs::read_to_string(&cfg_path).ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(|| serde_json::json!({"cniVersion":"1.0.0","name":"catalyst","type":"bridge","bridge":"catalyst0","ipam":{"type":"host-local","dataDir":"/var/lib/cni/networks"}}));
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let netns = match tasks.get(req).await {
            Ok(r) => r
                .into_inner()
                .process
                .map(|p| format!("/proc/{}/ns/net", p.pid))
                .unwrap_or_default(),
            Err(_) => String::new(),
        };
        if !netns.is_empty() {
            let _ = self
                .exec_cni_plugin(&cfg, "DEL", container_id, &netns, "eth0")
                .await;
        } else {
            // Container is already gone (e.g. agent restart).  Try to release
            // the IPAM lease directly so the address is not permanently stuck.
            // The host-local IPAM plugin reads the result file to know which
            // address to free; if that also fails, fall back to removing the
            // lease file from the data directory.
            let ipam_data_dir = cfg["ipam"]["dataDir"]
                .as_str()
                .unwrap_or("/var/lib/cni/networks");
            let ipam_dir = PathBuf::from(ipam_data_dir).join("catalyst");
            let result_json = tokio::fs::read_to_string(&rp)
                .await
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
            if let Some(ref result) = result_json {
                if let Some(ips) = result.get("ips").and_then(|v| v.as_array()) {
                    for ip_entry in ips {
                        if let Some(addr) = ip_entry.get("address").and_then(|v| v.as_str()) {
                            // Strip CIDR prefix to get bare IP for the lease filename
                            let bare_ip = addr.split('/').next().unwrap_or(addr);
                            let lease = ipam_dir.join(bare_ip);
                            if lease.exists() {
                                info!(
                                    "Releasing stale CNI IPAM lease {} for container {}",
                                    bare_ip, container_id
                                );
                                let _ = fs::remove_file(&lease);
                            }
                        }
                    }
                }
            }
        }
        let _ = tokio::fs::remove_file(&rp).await;
        let _ = tokio::fs::remove_file(&cfg_path).await;
        Ok(())
    }

    fn cleanup_io(&self, container_id: &str) {
        let _ = fs::remove_dir_all(PathBuf::from(CONSOLE_BASE_DIR).join(container_id));
    }

    /// Scan stored CNI result files and release IPAM leases for containers
    /// that no longer exist in containerd.  Must be called on agent startup
    /// to prevent stale allocations from blocking new containers.
    pub async fn cleanup_stale_cni_leases(&self) {
        // --- Phase 1: Release leases via CNI result files ---
        let results_dir = Path::new("/var/lib/cni/results");
        if tokio::fs::try_exists(results_dir).await.unwrap_or(false) {
            if let Ok(mut entries) = tokio::fs::read_dir(results_dir).await {
                let mut stale_results: Vec<(String, String)> = Vec::new();
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if let Some(cid) = fname.strip_prefix("catalyst-") {
                        if fname.contains("-config") {
                            continue;
                        }
                        stale_results.push((cid.to_string(), path.to_string_lossy().to_string()));
                    }
                }

                for (container_id, result_path) in &stale_results {
                    if self.container_exists(container_id).await {
                        continue;
                    }
                    info!(
                        "Container {} no longer exists, releasing stale CNI lease",
                        container_id
                    );
                    if let Err(e) = self.teardown_cni_network(container_id).await {
                        warn!(
                            "CNI teardown failed for stale container {}: {}",
                            container_id, e
                        );
                    }
                    let cfg_path = format!("/var/lib/cni/results/catalyst-{}-config", container_id);
                    let _ = tokio::fs::remove_file(result_path).await;
                    let _ = tokio::fs::remove_file(&cfg_path).await;
                }
            }
        }

        // --- Phase 2: Scan IPAM data dir for orphaned leases ---
        // Even if result files are gone (e.g. agent was force-killed), the
        // host-local IPAM plugin may still hold lease files.  Cross-reference
        // each lease file's container ID against containerd.
        let ipam_base = Path::new("/var/lib/cni/networks/catalyst");
        if !tokio::fs::try_exists(ipam_base).await.unwrap_or(false) {
            return;
        }
        if let Ok(mut entries) = tokio::fs::read_dir(ipam_base).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if let Ok(md) = tokio::fs::metadata(&path).await {
                    if !md.is_file() {
                        continue;
                    }
                } else {
                    continue;
                }
                // Lease files are named by IP address (e.g. 10.42.0.15)
                // and their contents hold the container ID.
                let container_id = tokio::fs::read_to_string(&path)
                    .await
                    .ok()
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                if container_id.is_empty() {
                    continue;
                }
                if self.container_exists(container_id.trim()).await {
                    continue;
                }
                info!(
                    "Removing orphaned CNI IPAM lease {} (container {})",
                    path.display(),
                    container_id
                );
                let _ = tokio::fs::remove_file(&path).await;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn load_named_cni_plugin_config(network: &str) -> Option<serde_json::Value> {
    let candidates = [
        format!("/etc/cni/net.d/{}.conflist", network),
        format!("/etc/cni/net.d/{}.conf", network),
    ];

    for path in candidates {
        let raw = match fs::read_to_string(&path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let parsed = match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "Invalid CNI config JSON at {} for network {}: {}",
                    path, network, e
                );
                continue;
            }
        };

        // Handle .conflist files by selecting the first plugin entry.
        if let Some(plugins) = parsed.get("plugins").and_then(|v| v.as_array()) {
            if let Some(first) = plugins.first() {
                let mut cfg = first.clone();
                if cfg.get("name").is_none() {
                    cfg["name"] = parsed
                        .get("name")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!(network));
                }
                if cfg.get("cniVersion").is_none() {
                    cfg["cniVersion"] = parsed
                        .get("cniVersion")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!("0.4.0"));
                }
                info!("Loaded CNI network '{}' from {}", network, path);
                return Some(cfg);
            }
        }

        // Handle single-plugin .conf files.
        if parsed.get("type").is_some() {
            let mut cfg = parsed;
            if cfg.get("name").is_none() {
                cfg["name"] = serde_json::json!(network);
            }
            if cfg.get("cniVersion").is_none() {
                cfg["cniVersion"] = serde_json::json!("0.4.0");
            }
            info!("Loaded CNI network '{}' from {}", network, path);
            return Some(cfg);
        }
    }

    None
}

/// Auto-detect the host's default network interface, subnet, and gateway.
/// Detect the host's default route interface (e.g. "eth0", "ens192").
/// Returns None if no default route can be found.
async fn detect_default_route_interface() -> Option<String> {
    let output = tokio::process::Command::new("ip")
        .args(["-4", "route", "show", "default"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let route = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = route.split_whitespace().collect();
    let idx = parts.iter().position(|&p| p == "dev")?;
    let iface = parts.get(idx + 1)?.to_string();
    if iface.is_empty() || iface == "lo" {
        return None;
    }
    Some(iface)
}

async fn detect_host_network() -> Option<(String, String, String)> {
    static CACHED: tokio::sync::OnceCell<Option<(String, String, String)>> =
        tokio::sync::OnceCell::const_new();
    CACHED
        .get_or_init(|| async {
            // Parse `ip -4 route show default` → "default via <gw> dev <iface> ..."
            let output = tokio::process::Command::new("ip")
                .args(["-4", "route", "show", "default"])
                .output()
                .await
                .ok()?;
            let route = String::from_utf8_lossy(&output.stdout);
            let mut parts = route.split_whitespace();
            let mut gateway = None;
            let mut iface = None;
            while let Some(part) = parts.next() {
                if part == "via" {
                    gateway = parts.next().map(|s| s.to_string());
                } else if part == "dev" {
                    iface = parts.next().map(|s| s.to_string());
                }
            }
            let gateway = gateway?;
            let iface = iface?;

            // Parse interface address → "inet <ip>/<prefix> ..."
            let output = tokio::process::Command::new("ip")
                .args(["-4", "-o", "addr", "show", &iface])
                .output()
                .await
                .ok()?;
            let addr_line = String::from_utf8_lossy(&output.stdout);
            let cidr = addr_line
                .split_whitespace()
                .find(|s| {
                    s.contains('/')
                        && s.chars()
                            .next()
                            .map(|c| c.is_ascii_digit())
                            .unwrap_or(false)
                })?
                .to_string();
            let (ip_str, prefix_str) = cidr.split_once('/')?;
            let ip: Ipv4Addr = ip_str.parse().ok()?;
            let prefix: u32 = prefix_str.parse().ok()?;
            let mask = if prefix == 0 {
                0u32
            } else {
                !0u32 << (32 - prefix)
            };
            let net_addr = Ipv4Addr::from(u32::from(ip) & mask);
            let subnet = format!("{}/{}", net_addr, prefix);

            Some((iface, subnet, gateway))
        })
        .await
        .clone()
}

/// Calculate usable IP range from a subnet CIDR (e.g., "192.168.1.0/24" -> ("192.168.1.10", "192.168.1.250"))
/// This matches the logic used by NetworkManager's cidr_usable_range function.
fn calculate_ip_range_from_subnet(cidr: &str) -> (String, String) {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        // Fallback to a reasonable default
        warn!("Invalid CIDR format '{}', using default range", cidr);
        return ("10.0.0.10".to_string(), "10.0.0.250".to_string());
    }

    let base_ip = parts[0];
    let ip_parts: Vec<&str> = base_ip.split('.').collect();

    if ip_parts.len() != 4 {
        warn!(
            "Invalid IP address format '{}', using default range",
            base_ip
        );
        return ("10.0.0.10".to_string(), "10.0.0.250".to_string());
    }

    // Use .10 to .250 as the usable range (matching NetworkManager's cidr_usable_range)
    (
        format!("{}.{}.{}.10", ip_parts[0], ip_parts[1], ip_parts[2]),
        format!("{}.{}.{}.250", ip_parts[0], ip_parts[1], ip_parts[2]),
    )
}

fn create_fifo(path: &Path) -> std::io::Result<()> {
    match mkfifo(path, Mode::from_bits_truncate(0o600)) {
        Ok(()) => Ok(()),
        Err(Errno::EEXIST) => Ok(()),
        Err(err) => Err(std::io::Error::other(err)),
    }
}

fn open_fifo_rdwr(path: &Path) -> AgentResult<File> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| AgentError::ContainerError(format!("open FIFO: {}", e)))?;
    if let Ok(flags) = fcntl(&file, FcntlArg::F_GETFL) {
        let mut of = OFlag::from_bits_truncate(flags);
        of.remove(OFlag::O_NONBLOCK);
        let _ = fcntl(&file, FcntlArg::F_SETFL(of));
    }
    Ok(file)
}

fn set_dir_perms(path: &Path, mode: u32) {
    if let Ok(md) = fs::metadata(path) {
        let mut p = md.permissions();
        p.set_mode(mode);
        fs::set_permissions(path, p).ok();
    }
}

fn shell_escape_value(value: &str) -> String {
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

fn parse_signal(signal: &str) -> u32 {
    match signal.to_ascii_uppercase().as_str() {
        "SIGTERM" | "15" => 15,
        "SIGINT" | "2" => 2,
        "SIGKILL" | "9" => 9,
        _ => 9,
    }
}

fn grpc_err(e: tonic::Status) -> AgentError {
    AgentError::ContainerError(format!(
        "containerd gRPC error ({}): {}",
        e.code(),
        e.message()
    ))
}

fn is_not_found(e: &tonic::Status) -> bool {
    e.message().contains("not found")
        || e.message().contains("process already finished")
        || e.code() == tonic::Code::NotFound
}

/// Detect the correct shell interpreter for an install script.
///
/// Pterodactyl install scripts use `#!/bin/bash` or `#!/bin/ash` shebangs but the
/// OCI spec uses `args` directly, so the shebang line is ignored.
///
/// On Debian-based images, `/bin/sh` is `dash` (POSIX) which does NOT support
/// bash-isms like `[[ ]]`, `=~`, arrays, etc. Many Pterodactyl scripts use these.
/// On Alpine-based images, `/bin/sh` is busybox `ash` which DOES support `[[ ]]`.
///
/// Strategy:
/// - Debian/Ubuntu images → use `bash` (pre-installed, handles bash-isms)
/// - Alpine images → use `sh` (busybox ash, supports [[ ]], bash not guaranteed)
/// - Explicit `#!/bin/bash` shebang on any image → use `bash`
/// - Other images → use `bash` as safe default for Pterodactyl compatibility
///
/// Returns (interpreter, argument) — typically ("bash", "-c") or ("sh", "-c").
fn detect_install_interpreter(image: &str, script: &str) -> (&'static str, &'static str) {
    let image_lower = image.to_lowercase();
    let is_alpine = image_lower.contains("alpine");

    // Check explicit shebang
    let first_line = script.lines().next().unwrap_or("").trim();
    if first_line.starts_with("#!") {
        let shebang = first_line.trim_start_matches("#!").trim();
        let interpreter = shebang.split_whitespace().next().unwrap_or("");
        let basename = interpreter.rsplit('/').next().unwrap_or(interpreter);
        match basename {
            "bash" => {
                if is_alpine {
                    // Alpine has no bash; busybox ash supports [[ ]] and most bash-isms
                    return ("sh", "-c");
                } else {
                    return ("bash", "-c");
                }
            }
            "ash" => {
                // ash scripts on Alpine → use sh (busybox ash)
                // ash scripts on non-Alpine → use bash (superset, ash unavailable)
                if is_alpine {
                    return ("sh", "-c");
                } else {
                    return ("bash", "-c");
                }
            }
            _ => (),
        }
    }

    // No shebang or unknown interpreter — choose based on image
    if is_alpine {
        // On Alpine, /bin/sh = busybox ash which supports [[ ]]
        ("sh", "-c")
    } else {
        // On Debian/Ubuntu and other images, use bash for Pterodactyl compatibility
        // Most scripts have bash-isms even without an explicit shebang
        ("bash", "-c")
    }
}

fn base_mounts(data_dir: &str) -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({"destination":"/data","type":"bind","source":data_dir,"options":["rbind","rw"]}),
        serde_json::json!({"destination":"/proc","type":"proc","source":"proc"}),
        serde_json::json!({"destination":"/dev","type":"tmpfs","source":"tmpfs","options":["nosuid","strictatime","mode=755","size=65536k"]}),
        serde_json::json!({"destination":"/dev/pts","type":"devpts","source":"devpts","options":["nosuid","noexec","newinstance","ptmxmode=0666","mode=0620","gid=5"]}),
        serde_json::json!({"destination":"/dev/shm","type":"tmpfs","source":"shm","options":["nosuid","noexec","nodev","mode=1777","size=65536k"]}),
        serde_json::json!({"destination":"/dev/mqueue","type":"mqueue","source":"mqueue","options":["nosuid","noexec","nodev"]}),
        serde_json::json!({"destination":"/sys","type":"sysfs","source":"sysfs","options":["nosuid","noexec","nodev","ro"]}),
        serde_json::json!({"destination":"/sys/fs/cgroup","type":"cgroup","source":"cgroup","options":["nosuid","noexec","nodev","relatime","ro"]}),
    ]
}

fn masked_paths() -> Vec<&'static str> {
    vec![
        // Original masked paths
        "/proc/kcore",
        "/proc/latency_stats",
        "/proc/timer_list",
        "/proc/timer_stats",
        "/proc/sched_debug",
        "/sys/firmware",
        // Additional security-sensitive paths
        "/proc/kallsyms", // Kernel symbols - useful for exploit development
        "/proc/self/mem", // Memory manipulation vector
        "/sys/kernel",    // Kernel parameters and addresses
        "/sys/class",     // Hardware enumeration for fingerprinting
        "/proc/slabinfo", // Kernel slab allocator info
        "/proc/modules",  // Loaded kernel modules
    ]
}
fn readonly_paths() -> Vec<&'static str> {
    vec![
        "/proc/asound",
        "/proc/bus",
        "/proc/fs",
        "/proc/irq",
        "/proc/sys",
        "/proc/sysrq-trigger",
    ]
}

fn seccomp_arches() -> Vec<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => vec!["SCMP_ARCH_X86_64", "SCMP_ARCH_X86", "SCMP_ARCH_X32"],
        "aarch64" => vec!["SCMP_ARCH_AARCH64", "SCMP_ARCH_ARM"],
        "arm" => vec!["SCMP_ARCH_ARM"],
        _ => Vec::new(),
    }
}

fn default_seccomp_profile() -> serde_json::Value {
    // Deny-list a small set of high-risk syscalls while keeping broad compatibility.
    // This is intentionally conservative; consumers can harden further via host policy.
    serde_json::json!({
        "defaultAction": "SCMP_ACT_ALLOW",
        "architectures": seccomp_arches(),
        "syscalls": [
            {
                "names": [
                    "acct",
                    "add_key",
                    "bpf",
                    "delete_module",
                    "finit_module",
                    "init_module",
                    "iopl",
                    "ioperm",
                    "kexec_file_load",
                    "kexec_load",
                    "keyctl",
                    "mount",
                    "open_by_handle_at",
                    "perf_event_open",
                    "pivot_root",
                    "process_vm_readv",
                    "process_vm_writev",
                    "ptrace",
                    "quotactl",
                    "reboot",
                    "request_key",
                    "setns",
                    "swapoff",
                    "swapon",
                    "syslog",
                    "umount2",
                    "unshare"
                ],
                "action": "SCMP_ACT_ERRNO",
                "errnoRet": 1
            }
        ]
    })
}

async fn find_container_cgroup(container_id: &str) -> Option<String> {
    find_cgroup_recursive("/sys/fs/cgroup", container_id).await
}
async fn find_cgroup_recursive(dir: &str, cid: &str) -> Option<String> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let p = entry.path();
        let n = entry.file_name().to_string_lossy().to_string();
        if n.contains(cid) {
            if let Ok(md) = tokio::fs::metadata(&p).await {
                if md.is_dir() {
                    return Some(p.to_string_lossy().to_string());
                }
            }
        }
        if !n.starts_with('.') {
            if let Ok(md) = tokio::fs::metadata(&p).await {
                if md.is_dir() {
                    if let Some(f) =
                        Box::pin(find_cgroup_recursive(&p.to_string_lossy(), cid)).await
                    {
                        return Some(f);
                    }
                }
            }
        }
    }
    None
}

async fn read_cgroup_cpu_usage(path: &str) -> Option<u64> {
    let content = tokio::fs::read_to_string(format!("{}/cpu.stat", path))
        .await
        .ok()?;
    for line in content.lines() {
        if line.starts_with("usage_usec") {
            return line.split_whitespace().nth(1)?.parse::<u64>().ok();
        }
    }
    Some(0)
}

async fn read_cgroup_memory(path: &str) -> Option<u64> {
    tokio::fs::read_to_string(format!("{}/memory.current", path))
        .await
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Read the memory limit for a cgroup v2 hierarchy.
/// Returns the value from memory.max (in bytes).  The special value "max"
/// means unlimited and is reported as 0.
async fn read_cgroup_memory_limit(path: &str) -> Option<u64> {
    let content = tokio::fs::read_to_string(format!("{}/memory.max", path))
        .await
        .ok()?;
    let trimmed = content.trim();
    if trimmed == "max" || trimmed.is_empty() {
        return Some(0);
    }
    trimmed.parse().ok()
}
