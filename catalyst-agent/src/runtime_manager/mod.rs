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
use containerd_client::services::v1::version_client::VersionClient;
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
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, RwLock};
use tokio::task::spawn_blocking;
use tonic::Request;
use tracing::{debug, error, info, warn};

use nix::errno::Errno;
use nix::fcntl::{fcntl, FcntlArg, OFlag};
use nix::sys::signal::{kill, Signal};
use nix::sys::stat::Mode;
use nix::unistd::mkfifo;
use nix::unistd::Pid;

/// Guard that reliably kills a `ctr events` child process on Drop.
/// Uses raw SIGKILL via libc so cleanup works even when the tokio
/// reactor is already shut down (e.g. during agent termination).
pub struct CtrChildGuard {
    child: tokio::process::Child,
}

impl CtrChildGuard {
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    pub fn into_lines(
        mut self,
    ) -> (
        Self,
        tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    ) {
        let stdout = self
            .child
            .stdout
            .take()
            .expect("ctr events stdout should be available at guard creation");
        let reader = BufReader::new(stdout);
        (self, reader.lines())
    }

    /// Explicitly kill the child and wait for it to exit.
    pub async fn kill_and_wait(&mut self) {
        if let Some(pid) = self.child.id() {
            let _ = kill(Pid::from_raw(pid as i32), Signal::SIGKILL);
        }
        let _ = self.child.wait().await;
    }
}

impl Drop for CtrChildGuard {
    fn drop(&mut self) {
        if let Some(pid) = self.child.id() {
            let _ = kill(Pid::from_raw(pid as i32), Signal::SIGKILL);
        }
    }
}

use crate::errors::{AgentError, AgentResult};
use crate::firewall_manager::FirewallManager;

const RUNTIME_NAME: &str = "io.containerd.runc.v2";
const SPEC_TYPE_URL: &str = "types.containerd.io/opencontainers/runtime-spec/1/Spec";
const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024; // 10MB per file
const LOG_BACKUP_COUNT: usize = 2;

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

// CNI plugin directories to search as fallback, in order of preference
// Fedora/RHEL install to /usr/libexec/cni, others typically use /opt/cni/bin
const CNI_FALLBACK_BIN_DIRS: &[&str] = &["/usr/libexec/cni", "/usr/lib/cni"];

const PORT_FWD_STATE_PREFIX: &str = "catalyst-";
const MAX_CONTENT_BLOB_SIZE: usize = 100 * 1024 * 1024; // 100MB

#[derive(serde::Serialize, serde::Deserialize)]
struct PortForwardState {
    container_ip: String,
    forwards: Vec<PortForward>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone)]
pub struct ContainerInfo {
    pub id: String,
    pub names: String,
    pub managed: bool,
    pub status: String,
    pub command: String,
    pub image: String,
    pub labels: HashMap<String, String>,
}

/// Inspected OCI-derived configuration from an existing container.
#[derive(Debug, Clone, Default)]
pub struct ContainerInspectInfo {
    pub network_mode: String, // "host" or "bridge"
    pub memory_limit_bytes: i64,
    pub cpu_quota: i64,
    pub cpu_period: i64,
    pub startup_command: String,    // process.args joined as string
    pub env_var_names: Vec<String>, // env var NAMES only (not values, for security)
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
    console_log_dir: PathBuf,
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

        let io_dir = self.console_log_dir.join(&self.container_id);
        let _ = fs::remove_dir_all(&io_dir);
        Ok(())
    }
}

/// Configuration for constructing a [`ContainerdRuntime`].
pub struct ContainerdRuntimeConfig {
    /// Path to the containerd gRPC socket.
    pub socket_path: PathBuf,
    /// Containerd namespace used for all operations.
    pub namespace: String,
    /// DNS servers injected into container `/etc/resolv.conf`.
    pub dns_servers: Vec<String>,
    /// Directory for container console I/O (stdout/stderr FIFOs and log files).
    pub console_log_dir: PathBuf,
    /// Directory for CNI result/state files and port-forward state.
    pub cni_results_dir: PathBuf,
    /// Directory used by the host-local IPAM plugin for lease storage.
    pub cni_data_dir: PathBuf,
    /// Directory where CNI network configuration files are stored.
    pub cni_dir: PathBuf,
    /// Directory where CNI plugin binaries are installed.
    pub cni_bin_dir: PathBuf,
    /// Bridge interface name for the default NAT network.
    pub cni_bridge_name: String,
    /// Subnet for the default bridge NAT network.
    pub cni_bridge_subnet: String,
}

#[derive(Clone)]
pub struct ContainerdRuntime {
    namespace: String,
    channel: tonic::transport::Channel,
    container_io: Arc<Mutex<HashMap<String, ContainerIo>>>,
    dns_servers: Vec<String>,
    cpu_tracker: Arc<CpuTracker>,
    cgroup_paths: Arc<RwLock<HashMap<String, String>>>,
    container_list_cache: Arc<RwLock<(Vec<ContainerInfo>, Instant)>>,
    /// Directory for container console I/O (stdout/stderr FIFOs and log files).
    console_log_dir: PathBuf,
    /// Directory for CNI result/state files and port-forward state.
    cni_results_dir: PathBuf,
    /// Directory used by the host-local IPAM plugin for lease storage.
    cni_data_dir: PathBuf,
    /// Directory where CNI network configuration files are stored.
    cni_dir: PathBuf,
    /// Directory where CNI plugin binaries are installed.
    cni_bin_dir: PathBuf,
    /// Bridge interface name for the default NAT network.
    cni_bridge_name: String,
    /// Subnet for the default bridge NAT network.
    cni_bridge_subnet: String,
}

pub mod cni_network;
pub mod container_ops;
pub mod helpers;

pub use helpers::{
    calculate_ip_range_from_subnet, create_fifo, detect_default_route_interface,
    detect_host_network, discover_cni_bin_dir, find_container_cgroup, grpc_err, is_not_found,
    load_named_cni_plugin_config, open_fifo_rdwr, parse_ctr_event_line, parse_signal,
    read_block_io, read_cgroup_cpu_usage, read_cgroup_memory, read_cgroup_memory_limit,
    read_network_io, rotate_logs, set_dir_perms,
};

pub use image_and_spec::{
    base_mounts, default_seccomp_profile, detect_install_interpreter, masked_paths, readonly_paths,
};
pub mod image_and_spec;

impl ContainerdRuntime {
    pub async fn new(config: ContainerdRuntimeConfig) -> AgentResult<Self> {
        // Ensure console log directory exists
        fs::create_dir_all(&config.console_log_dir).map_err(|e| {
            AgentError::ContainerError(format!(
                "Failed to create console log dir {}: {}",
                config.console_log_dir.display(),
                e
            ))
        })?;

        let channel = containerd_client::connect(&config.socket_path)
            .await
            .map_err(|e| {
                AgentError::ContainerError(format!(
                    "Failed to connect to containerd at {}: {}",
                    config.socket_path.display(),
                    e
                ))
            })?;
        info!(
            "Connected to containerd at {}",
            config.socket_path.display()
        );
        info!(
            "DNS servers configured for containers: {:?}",
            config.dns_servers
        );
        info!("Console log dir: {}", config.console_log_dir.display());
        info!("CNI results dir: {}", config.cni_results_dir.display());
        info!("CNI data dir: {}", config.cni_data_dir.display());
        info!("CNI config dir: {}", config.cni_dir.display());
        info!(
            "CNI bridge: {} ({})",
            config.cni_bridge_name, config.cni_bridge_subnet
        );
        Ok(Self {
            namespace: config.namespace,
            channel,
            container_io: Arc::new(Mutex::new(HashMap::new())),
            dns_servers: config.dns_servers,
            cpu_tracker: Arc::new(CpuTracker::new()),
            cgroup_paths: Arc::new(RwLock::new(HashMap::new())),
            container_list_cache: Arc::new(RwLock::new((
                Vec::new(),
                Instant::now() - Duration::from_secs(10),
            ))),
            console_log_dir: config.console_log_dir,
            cni_results_dir: config.cni_results_dir,
            cni_data_dir: config.cni_data_dir,
            cni_dir: config.cni_dir,
            cni_bin_dir: config.cni_bin_dir,
            cni_bridge_name: config.cni_bridge_name,
            cni_bridge_subnet: config.cni_bridge_subnet,
        })
    }
}

/// Parsed container event from one line of `ctr events` output.
#[derive(Debug, Clone)]
pub struct CtrEvent {
    pub topic: String,
    pub container_id: String,
}
