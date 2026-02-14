use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Write;
use std::net::Ipv4Addr;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use containerd_client::services::v1::containers_client::ContainersClient;
use containerd_client::services::v1::content_client::ContentClient;
use containerd_client::services::v1::images_client::ImagesClient;
use containerd_client::services::v1::snapshots::snapshots_client::SnapshotsClient;
use containerd_client::services::v1::tasks_client::TasksClient;
use containerd_client::services::v1::events_client::EventsClient;
use containerd_client::services::v1::{
    Container, CreateContainerRequest, DeleteContainerRequest, GetContainerRequest,
    InfoRequest, ListContainersRequest, ReadContentRequest,
};
use containerd_client::services::v1::{
    CreateTaskRequest, DeleteTaskRequest, ExecProcessRequest,
    KillRequest as TaskKillRequest, StartRequest, WaitRequest,
};
use containerd_client::services::v1::container::Runtime;
use containerd_client::services::v1::GetImageRequest;
use containerd_client::services::v1::snapshots::{
    PrepareSnapshotRequest, RemoveSnapshotRequest, MountsRequest,
};
use containerd_client::services::v1::SubscribeRequest;
use containerd_client::with_namespace;
use prost_types::Any;
use tonic::Request;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;
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

// CNI plugin directories to search, in order of preference
// Fedora/RHEL install to /usr/libexec/cni, others typically use /opt/cni/bin
const CNI_BIN_DIRS: &[&str] = &["/opt/cni/bin", "/usr/libexec/cni"];

/// Discover the CNI plugin directory by checking which one has required plugins
fn discover_cni_bin_dir() -> &'static str {
    const REQUIRED_PLUGINS: &[&str] = &["bridge", "host-local", "macvlan"];

    for dir in CNI_BIN_DIRS {
        let has_all = REQUIRED_PLUGINS.iter().all(|plugin| {
            Path::new(&format!("{}/{}", dir, plugin)).exists()
        });
        if has_all {
            return dir;
        }
    }

    // Default to /opt/cni/bin if no directory has all plugins
    // (error will be raised later when plugin is not found)
    CNI_BIN_DIRS[0]
}
const PORT_FWD_STATE_PREFIX: &str = "catalyst-";

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
        let req = DeleteTaskRequest { container_id: self.container_id.clone() };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;

        let mut containers = ContainersClient::new(self.channel.clone());
        let req = DeleteContainerRequest { id: self.container_id.clone() };
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
}

impl ContainerdRuntime {
    /// Connect to containerd socket and create runtime
    pub async fn new(socket_path: PathBuf, namespace: String, dns_servers: Vec<String>) -> AgentResult<Self> {
        let channel = containerd_client::connect(&socket_path)
            .await
            .map_err(|e| AgentError::ContainerError(format!(
                "Failed to connect to containerd at {}: {}", socket_path.display(), e
            )))?;
        info!("Connected to containerd at {}", socket_path.display());
        info!("DNS servers configured for containers: {:?}", dns_servers);
        Ok(Self {
            _socket_path: socket_path.to_string_lossy().to_string(),
            namespace,
            channel,
            container_io: Arc::new(Mutex::new(HashMap::new())),
            dns_servers,
        })
    }

    /// Create and start a container via containerd gRPC
    pub async fn create_container(&self, config: ContainerConfig<'_>) -> AgentResult<String> {
        let qualified_image = Self::qualify_image_ref(config.image);
        info!("Creating container: {} from image: {}", config.container_id, qualified_image);

        self.ensure_image(config.image).await?;

        // Read image's default environment variables (PATH, JAVA_HOME, etc.)
        let image_env = self.get_image_env(&qualified_image).await;

        // Prepare I/O paths
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(config.container_id);
        fs::create_dir_all(&io_dir).map_err(|e|
            AgentError::ContainerError(format!("Failed to create I/O directory: {}", e)))?;
        set_dir_perms(&io_dir, 0o755);

        let stdin_path = io_dir.join("stdin");
        let stdout_path = io_dir.join("stdout");
        let stderr_path = io_dir.join("stderr");
        if stdin_path.exists() { fs::remove_file(&stdin_path).ok(); }
        create_fifo(&stdin_path).map_err(|e|
            AgentError::ContainerError(format!("Failed to create stdin FIFO: {}", e)))?;
        File::create(&stdout_path).map_err(|e|
            AgentError::ContainerError(format!("stdout: {}", e)))?;
        File::create(&stderr_path).map_err(|e|
            AgentError::ContainerError(format!("stderr: {}", e)))?;

        let stdin_writer = open_fifo_rdwr(&stdin_path)?;
        {
            let mut io_map = self.container_io.lock().await;
            io_map.insert(config.container_id.to_string(), ContainerIo {
                _stdin_fifo: stdin_path.clone(), _stdout_file: stdout_path.clone(),
                _stderr_file: stderr_path.clone(), stdin_writer: Some(stdin_writer),
            });
        }

        // Build OCI spec
        let use_host_network = config.network_mode == Some("host");
        let spec = self.build_oci_spec(&config, &io_dir, use_host_network, &image_env)?;
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
            runtime: Some(Runtime { name: RUNTIME_NAME.to_string(), options: None }),
            spec: Some(spec_any),
            snapshot_key: snap_key.clone(),
            snapshotter: "overlayfs".to_string(),
            ..Default::default()
        };
        let mut client = ContainersClient::new(self.channel.clone());
        let req = CreateContainerRequest { container: Some(container) };
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
            if let Err(e) = self.setup_cni_network(
                config.container_id, pid, config.network_mode, config.network_ip,
                config.port, config.port_bindings,
            ).await {
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
                .arg(format!("echo '{}' > {}", resolv_content.trim(), resolv_dest))
                .output()
                .await;

            match nsenter_output {
                Ok(output) if output.status.success() => {
                    info!("Updated resolv.conf in container {} with DNS: {:?}", config.container_id, self.dns_servers);
                }
                Ok(output) => {
                    warn!(
                        "Failed to update resolv.conf in container {}: {}",
                        config.container_id,
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
                Err(e) => {
                    warn!("Failed to run nsenter for resolv.conf update in {}: {}", config.container_id, e);
                }
            }
        }

        // Start task
        let req = StartRequest { container_id: config.container_id.to_string(), ..Default::default() };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(|e| {
            self.cleanup_io(config.container_id);
            grpc_err(e)
        })?;

        info!("Container created and started: {} (pid {})", config.container_id, pid);

        // Configure firewall
        if let Ok(ip) = self.get_container_ip(config.container_id).await {
            if !ip.is_empty() {
                let ports: Vec<u16> = if config.port_bindings.is_empty() {
                    vec![config.port]
                } else {
                    config.port_bindings.values().copied().collect()
                };
                for p in ports {
                    if let Err(e) = FirewallManager::allow_port(p, &ip).await {
                        error!("Firewall config failed for port {}: {}", p, e);
                    }
                }
            }
        }

        Ok(config.container_id.to_string())
    }

    /// Spawn an ephemeral installer container via containerd gRPC
    pub async fn spawn_installer_container(
        &self, image: &str, script: &str, env: &HashMap<String, String>, data_dir: &str,
    ) -> AgentResult<InstallerHandle> {
        let container_id = format!("catalyst-installer-{}", uuid::Uuid::new_v4());
        let qualified_image = Self::qualify_image_ref(image);
        info!("Spawning installer {} with image: {}", container_id, qualified_image);
        self.ensure_image(image).await?;

        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(&container_id);
        fs::create_dir_all(&io_dir).map_err(|e|
            AgentError::ContainerError(format!("mkdir: {}", e)))?;
        let stdin_path = io_dir.join("stdin");
        let stdout_path = io_dir.join("stdout");
        let stderr_path = io_dir.join("stderr");
        if stdin_path.exists() { fs::remove_file(&stdin_path).ok(); }
        create_fifo(&stdin_path).map_err(|e|
            AgentError::ContainerError(format!("fifo: {}", e)))?;
        File::create(&stdout_path).map_err(|e|
            AgentError::ContainerError(format!("stdout: {}", e)))?;
        File::create(&stderr_path).map_err(|e|
            AgentError::ContainerError(format!("stderr: {}", e)))?;

        // Create /etc/resolv.conf for DNS resolution using configured DNS servers
        let resolv_path = io_dir.join("resolv.conf");
        let mut resolv_content = String::new();
        for dns in &self.dns_servers {
            resolv_content.push_str(&format!("nameserver {}\n", dns));
        }
        resolv_content.push_str("options attempts:3 timeout:2\n");
        info!("Installer {} resolv.conf:\n{}", container_id, resolv_content);
        fs::write(&resolv_path, &resolv_content).map_err(|e|
            AgentError::ContainerError(format!("resolv.conf: {}", e)))?;

        let mut env_list = vec![
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
            "TERM=xterm".to_string(),
        ];
        for (k, v) in env { env_list.push(format!("{}={}", k, v)); }
        // Install containers need broader capabilities than runtime containers because
        // install scripts commonly fix file ownership/permissions for the runtime user.
        let caps = ["CAP_CHOWN", "CAP_FOWNER", "CAP_DAC_OVERRIDE", "CAP_SETUID", "CAP_SETGID", "CAP_NET_BIND_SERVICE"];

        // Build mounts including DNS resolv.conf
        let mut mounts = base_mounts(data_dir);
        mounts.push(serde_json::json!({
            "destination": "/etc/resolv.conf",
            "type": "bind",
            "source": resolv_path.to_string_lossy().to_string(),
            "options": ["rbind", "rw"]
        }));

        // Wrap the install script so all files are chowned to the runtime user (1000:1000)
        // after the user-provided script completes. The installer runs as root but the
        // runtime container runs as 1000:1000, so files must be accessible.
        let wrapped_script = format!(
            "{}\n\necho '[Catalyst] Fixing file ownership for runtime user...'\nchown -R 1000:1000 /data",
            script
        );

        let spec = serde_json::json!({
            "ociVersion": "1.1.0",
            "process": {
                "terminal": false, "user": {"uid":0,"gid":0},
                "args": ["sh", "-c", &wrapped_script], "env": env_list,
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
        let spec_any = Any { type_url: SPEC_TYPE_URL.to_string(), value: spec.to_string().into_bytes() };

        let snap_key = format!("{}-snap", container_id);
        self.prepare_snapshot(&qualified_image, &snap_key).await?;

        let container = Container {
            id: container_id.clone(), image: qualified_image,
            runtime: Some(Runtime { name: RUNTIME_NAME.to_string(), options: None }),
            spec: Some(spec_any), snapshot_key: snap_key.clone(),
            snapshotter: "overlayfs".to_string(), ..Default::default()
        };
        let mut client = ContainersClient::new(self.channel.clone());
        let req = CreateContainerRequest { container: Some(container) };
        let req = with_namespace!(req, &self.namespace);
        client.create(req).await.map_err(grpc_err)?;

        let mounts = self.get_snapshot_mounts(&snap_key).await?;
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = CreateTaskRequest {
            container_id: container_id.clone(),
            stdin: stdin_path.to_string_lossy().to_string(),
            stdout: stdout_path.to_string_lossy().to_string(),
            stderr: stderr_path.to_string_lossy().to_string(),
            rootfs: mounts, ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.create(req).await.map_err(grpc_err)?;

        let req = StartRequest { container_id: container_id.clone(), ..Default::default() };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(grpc_err)?;

        Ok(InstallerHandle {
            container_id, namespace: self.namespace.clone(), channel: self.channel.clone(),
            stdout_path, stderr_path,
        })
    }

    pub async fn start_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Starting container: {}", container_id);

        // Check if a task already exists for this container
        let mut tasks = TasksClient::new(self.channel.clone());
        let get_req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(), ..Default::default()
        };
        let get_req = with_namespace!(get_req, &self.namespace);
        match tasks.get(get_req).await {
            Ok(resp) => {
                if let Some(process) = resp.into_inner().process {
                    if process.status == 2 {
                        // Task is already running
                        info!("Container {} already has a running task, nothing to do", container_id);
                        let _ = self.ensure_container_io(container_id).await;
                        return Ok(());
                    }
                    // Task exists but is not running (stopped/created) - delete it first
                    info!("Container {} has a stale task (status={}), deleting before restart", container_id, process.status);
                    let del_req = DeleteTaskRequest { container_id: container_id.to_string() };
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
        let mounts = self.get_snapshot_mounts(&snap_key).await.unwrap_or_default();
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);

        let req = CreateTaskRequest {
            container_id: container_id.to_string(),
            stdin: io_dir.join("stdin").to_string_lossy().to_string(),
            stdout: io_dir.join("stdout").to_string_lossy().to_string(),
            stderr: io_dir.join("stderr").to_string_lossy().to_string(),
            rootfs: mounts, ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.create(req).await.map_err(grpc_err)?;

        let req = StartRequest { container_id: container_id.to_string(), ..Default::default() };
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
            container_id: container_id.to_string(), signal: sig, all: true, ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        if let Err(e) = tasks.kill(req).await {
            if is_not_found(&e) { return Ok(()); }
            return Err(grpc_err(e));
        }
        match tokio::time::timeout(Duration::from_secs(timeout_secs), self.wait_for_exit(container_id)).await {
            Ok(Ok(_)) | Ok(Err(_)) => {}
            Err(_) => {
                warn!(
                    "Container {} did not stop in {}s after {}, sending SIGKILL",
                    container_id, timeout_secs, signal
                );
                let req = TaskKillRequest {
                    container_id: container_id.to_string(), signal: 9, all: true, ..Default::default()
                };
                let req = with_namespace!(req, &self.namespace);
                let _ = tasks.kill(req).await;
                let _ = self.wait_for_exit(container_id).await;
            }
        }
        let req = DeleteTaskRequest { container_id: container_id.to_string() };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;
        Ok(())
    }

    pub async fn kill_container(&self, container_id: &str, signal: &str) -> AgentResult<()> {
        info!("Killing container: {} with signal {}", container_id, signal);
        let sig = parse_signal(signal);
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = TaskKillRequest {
            container_id: container_id.to_string(), signal: sig, all: true, ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        if let Err(e) = tasks.kill(req).await {
            if is_not_found(&e) { return Ok(()); }
            return Err(grpc_err(e));
        }
        let _ = tokio::time::timeout(Duration::from_secs(5), self.wait_for_exit(container_id)).await;
        let req = DeleteTaskRequest { container_id: container_id.to_string() };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;
        Ok(())
    }

    pub async fn force_kill_container(&self, container_id: &str) -> AgentResult<()> {
        self.kill_container(container_id, "SIGKILL").await
    }

    pub async fn remove_container(&self, container_id: &str) -> AgentResult<()> {
        info!("Removing container: {}", container_id);
        let _ = self.teardown_cni_network(container_id).await;
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = TaskKillRequest {
            container_id: container_id.to_string(), signal: 9, all: true, ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.kill(req).await;
        let _ = tokio::time::timeout(Duration::from_secs(3), self.wait_for_exit(container_id)).await;
        let req = DeleteTaskRequest { container_id: container_id.to_string() };
        let req = with_namespace!(req, &self.namespace);
        let _ = tasks.delete(req).await;

        let mut client = ContainersClient::new(self.channel.clone());
        let req = DeleteContainerRequest { id: container_id.to_string() };
        let req = with_namespace!(req, &self.namespace);
        let _ = client.delete(req).await;

        let snap_key = format!("{}-snap", container_id);
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let req = RemoveSnapshotRequest { snapshotter: "overlayfs".to_string(), key: snap_key };
        let req = with_namespace!(req, &self.namespace);
        let _ = snaps.remove(req).await;

        { self.container_io.lock().await.remove(container_id); }
        let _ = fs::remove_dir_all(PathBuf::from(CONSOLE_BASE_DIR).join(container_id));
        Ok(())
    }

    // -- Console I/O --

    pub async fn send_input(&self, container_id: &str, input: &str) -> AgentResult<()> {
        debug!("Sending input to container: {}", container_id);
        if !self.is_container_running(container_id).await.unwrap_or(false) {
            return Err(AgentError::ContainerError(format!(
                "Cannot send input: container {} is not running",
                container_id
            )));
        }

        let has_io = self.ensure_container_io(container_id).await?;
        let handle = {
            let mut m = self.container_io.lock().await;
            m.get_mut(container_id).and_then(|io| io.stdin_writer.as_ref().and_then(|w| w.try_clone().ok()))
        };
        if let Some(h) = handle {
            let input = input.to_string();
            spawn_blocking(move || {
                let mut w = h;
                w.write_all(input.as_bytes()).map_err(|e| AgentError::ContainerError(format!("stdin: {}", e)))?;
                let _ = w.flush();
                Ok::<(), AgentError>(())
            }).await.map_err(|e| AgentError::ContainerError(e.to_string()))??;
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
        if ep.exists() { fs::remove_file(&ep).ok(); }
        create_fifo(&ep).ok();
        File::create(&eo).ok();
        let spec = serde_json::json!({"args":["sh","-c","cat > /proc/1/fd/0"],"env":["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],"cwd":"/"});
        let spec_any = Any { type_url: "types.containerd.io/opencontainers/runtime-spec/1/Process".to_string(), value: spec.to_string().into_bytes() };
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = ExecProcessRequest {
            container_id: container_id.to_string(), exec_id: exec_id.clone(),
            stdin: ep.to_string_lossy().to_string(), stdout: eo.to_string_lossy().to_string(),
            stderr: "".to_string(), terminal: false, spec: Some(spec_any), ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.exec(req).await.map_err(grpc_err)?;
        let req = StartRequest { container_id: container_id.to_string(), exec_id: exec_id.clone() };
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
            if !c.status.contains("Up") { continue; }
            if self.ensure_container_io(&c.id).await.is_ok() { restored += 1; }
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
                    for l in &all[start..] { output.push_str(l); output.push('\n'); }
                } else { output.push_str(&content); }
            }
        }
        Ok(output)
    }

    pub async fn stream_logs<F>(&self, container_id: &str, mut callback: F) -> AgentResult<()>
    where F: FnMut(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()>>>,
    {
        let base = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
        let mut positions = [0u64; 2];
        let paths = [base.join("stdout"), base.join("stderr")];
        loop {
            let running = self.is_container_running(container_id).await.unwrap_or(false);
            for i in 0..2 {
                if let Ok(content) = tokio::fs::read_to_string(&paths[i]).await {
                    if (positions[i] as usize) < content.len() {
                        for line in content[positions[i] as usize..].lines() { callback(line.to_string()).await; }
                        positions[i] = content.len() as u64;
                    }
                }
            }
            if !running { break; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }

    pub async fn spawn_log_stream(&self, container_id: &str) -> AgentResult<LogStream> {
        info!("Starting log stream for container: {}", container_id);
        let base = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
        let stdout = if base.join("stdout").exists() { Some(tokio::fs::File::open(base.join("stdout")).await?) } else { None };
        let stderr = if base.join("stderr").exists() { Some(tokio::fs::File::open(base.join("stderr")).await?) } else { None };
        Ok(LogStream { stdout, stderr, container_id: container_id.to_string() })
    }

    // -- Info & status --

    pub async fn list_containers(&self) -> AgentResult<Vec<ContainerInfo>> {
        let mut client = ContainersClient::new(self.channel.clone());
        let req = ListContainersRequest { ..Default::default() };
        let req = with_namespace!(req, &self.namespace);
        let resp = client.list(req).await.map_err(grpc_err)?;
        let mut result = Vec::new();
        for c in resp.into_inner().containers {
            let running = self.is_container_running(&c.id).await.unwrap_or(false);
            result.push(ContainerInfo {
                id: c.id.clone(), names: c.id.clone(),
                managed: c.labels.contains_key("catalyst.managed"),
                status: if running { "Up".to_string() } else { "Exited".to_string() },
                image: c.image.clone(), command: String::new(),
            });
        }
        Ok(result)
    }

    pub async fn container_exists(&self, container_id: &str) -> bool {
        let mut client = ContainersClient::new(self.channel.clone());
        let req = GetContainerRequest { id: container_id.to_string() };
        let req = with_namespace!(req, &self.namespace);
        client.get(req).await.is_ok()
    }

    pub async fn is_container_running(&self, container_id: &str) -> AgentResult<bool> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(), ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        match tasks.get(req).await {
            Ok(resp) => Ok(resp.into_inner().process.map(|p| p.status == 2).unwrap_or(false)),
            Err(e) if e.code() == tonic::Code::NotFound => Ok(false),
            Err(e) => Err(grpc_err(e)),
        }
    }

    pub async fn get_container_exit_code(&self, container_id: &str) -> AgentResult<Option<i32>> {
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(), ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        match tasks.get(req).await {
            Ok(resp) => Ok(resp.into_inner().process.and_then(|p| if p.status == 3 { Some(p.exit_status as i32) } else { None })),
            Err(_) => Ok(None),
        }
    }

    pub async fn get_container_ip(&self, container_id: &str) -> AgentResult<String> {
        // Check CNI result file
        let cni_state = format!("/var/lib/cni/results/catalyst-{}", container_id);
        if let Ok(content) = fs::read_to_string(&cni_state) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(ips) = v.get("ips").and_then(|v| v.as_array()) {
                    for ip in ips {
                        if let Some(addr) = ip.get("address").and_then(|v| v.as_str()) {
                            let a = addr.split('/').next().unwrap_or("");
                            if !a.is_empty() { return Ok(a.to_string()); }
                        }
                    }
                }
            }
        }
        // Fallback: scan CNI networks dir
        if let Ok(entries) = fs::read_dir("/var/lib/cni/networks") {
            for entry in entries.flatten() {
                let d = entry.path();
                if !d.is_dir() { continue; }
                if let Ok(files) = fs::read_dir(&d) {
                    for f in files.flatten() {
                        let n = f.file_name().to_string_lossy().to_string();
                        if n.parse::<Ipv4Addr>().is_ok() {
                            if let Ok(c) = fs::read_to_string(f.path()) {
                                if c.trim().contains(container_id) { return Ok(n); }
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
        let cg = find_container_cgroup(container_id).unwrap_or_default();
        let cpu = if !cg.is_empty() { read_cgroup_cpu_percent(&cg).await.unwrap_or(0.0) } else { 0.0 };
        let mem = if !cg.is_empty() { read_cgroup_memory(&cg).await.unwrap_or(0) } else { 0 };
        Ok(ContainerStats {
            container_id: container_id.to_string(), container_name: container_id.to_string(),
            cpu_percent: format!("{:.2}%", cpu),
            memory_usage: format!("{}MiB / 0MiB", mem / (1024 * 1024)),
            net_io: "0B / 0B".to_string(), block_io: "0B / 0B".to_string(),
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
        let spec_any = Any { type_url: "types.containerd.io/opencontainers/runtime-spec/1/Process".to_string(), value: spec.to_string().into_bytes() };
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = ExecProcessRequest {
            container_id: container_id.to_string(), exec_id: exec_id.clone(),
            stdin: "".to_string(), stdout: op.to_string_lossy().to_string(),
            stderr: ep.to_string_lossy().to_string(), terminal: false, spec: Some(spec_any), ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        tasks.exec(req).await.map_err(grpc_err)?;

        let req = StartRequest { container_id: container_id.to_string(), exec_id: exec_id.clone() };
        let req = with_namespace!(req, &self.namespace);
        tasks.start(req).await.map_err(grpc_err)?;

        let req = WaitRequest { container_id: container_id.to_string(), exec_id };
        let req = with_namespace!(req, &self.namespace);
        let _ = tokio::time::timeout(Duration::from_secs(30), tasks.wait(req)).await;

        let out = tokio::fs::read_to_string(&op).await.unwrap_or_default();
        let err = tokio::fs::read_to_string(&ep).await.unwrap_or_default();
        let _ = fs::remove_file(&op);
        let _ = fs::remove_file(&ep);
        if !err.is_empty() && out.is_empty() { return Err(AgentError::ContainerError(format!("Exec failed: {}", err))); }
        Ok(out)
    }

    // -- Events --

    pub async fn subscribe_to_container_events(&self, container_id: &str) -> AgentResult<EventStream> {
        let mut client = EventsClient::new(self.channel.clone());
        let req = SubscribeRequest { filters: vec![
            format!("topic==/tasks/exit,container=={}", container_id),
            format!("topic==/tasks/start,container=={}", container_id),
            format!("topic==/tasks/delete,container=={}", container_id),
        ]};
        let req = with_namespace!(req, &self.namespace);
        let resp = client.subscribe(req).await.map_err(grpc_err)?;
        Ok(EventStream { receiver: resp.into_inner() })
    }

    pub async fn subscribe_to_all_events(&self) -> AgentResult<EventStream> {
        let mut client = EventsClient::new(self.channel.clone());
        let req = SubscribeRequest { filters: vec!["topic~=/tasks/".to_string(), "topic~=/containers/".to_string()] };
        let req = with_namespace!(req, &self.namespace);
        let resp = client.subscribe(req).await.map_err(grpc_err)?;
        Ok(EventStream { receiver: resp.into_inner() })
    }

    // -- IP allocation --

    pub async fn clean_stale_ip_allocations(&self, network: &str) -> AgentResult<usize> {
        let dir = format!("/var/lib/cni/networks/{}", network);
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(AgentError::IoError(e.to_string())),
        };
        let containers = self.list_containers().await?;
        let mut active_ips = HashSet::new();
        let mut running = 0;
        for c in containers { if !c.status.contains("Up") { continue; } running += 1;
            if let Ok(ip) = self.get_container_ip(&c.id).await { if !ip.is_empty() { active_ips.insert(ip); } }
        }
        if running > 0 && active_ips.is_empty() { return Ok(0); }
        let mut removed = 0;
        for entry in entries {
            let entry = entry.map_err(|e| AgentError::IoError(e.to_string()))?;
            let path = entry.path();
            let name = match entry.file_name().into_string() { Ok(v) => v, Err(_) => continue };
            if name == "lock" || name.starts_with("last_reserved_ip") { continue; }
            if name.parse::<Ipv4Addr>().is_err() { continue; }
            if !active_ips.contains(&name) {
                if let Ok(md) = fs::metadata(&path) {
                    if let Ok(m) = md.modified() {
                        if let Ok(age) = SystemTime::now().duration_since(m) { if age < Duration::from_secs(60) { continue; } }
                    }
                }
                if fs::remove_file(&path).is_ok() { removed += 1; }
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
        let req = WaitRequest { container_id: container_id.to_string(), ..Default::default() };
        let req = with_namespace!(req, &self.namespace);
        let resp = tasks.wait(req).await.map_err(grpc_err)?;
        Ok(resp.into_inner().exit_status)
    }

    async fn ensure_container_io(&self, container_id: &str) -> AgentResult<bool> {
        if self.container_io.lock().await.contains_key(container_id) { return Ok(true); }
        let io_dir = PathBuf::from(CONSOLE_BASE_DIR).join(container_id);
        let stdin_path = io_dir.join("stdin");
        if !stdin_path.exists() { return Ok(false); }
        let writer = open_fifo_rdwr(&stdin_path)?;
        self.container_io.lock().await.insert(container_id.to_string(), ContainerIo {
            _stdin_fifo: stdin_path, _stdout_file: io_dir.join("stdout"),
            _stderr_file: io_dir.join("stderr"), stdin_writer: Some(writer),
        });
        Ok(true)
    }

    async fn ensure_image(&self, image: &str) -> AgentResult<()> {
        let qualified = Self::qualify_image_ref(image);
        let mut client = ImagesClient::new(self.channel.clone());
        let req = GetImageRequest { name: qualified.clone() };
        let req = with_namespace!(req, &self.namespace);
        match client.get(req).await {
            Ok(_) => return Ok(()),
            Err(e) if e.code() == tonic::Code::NotFound => info!("Image {} not found, pulling...", qualified),
            Err(e) => return Err(grpc_err(e)),
        }
        let output = Command::new("ctr").arg("-n").arg(&self.namespace).arg("images").arg("pull").arg(&qualified)
            .output().await.map_err(|e| AgentError::ContainerError(format!("pull: {}", e)))?;
        if !output.status.success() {
            return Err(AgentError::ContainerError(format!("Image pull failed: {}", String::from_utf8_lossy(&output.stderr))));
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

        Ok(config.get("config").and_then(|c| c.get("Env"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default())
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
                    p.and_then(|p| p.get("architecture")).and_then(|v| v.as_str())
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
        Ok(labels.get("containerd.io/gc.ref.snapshot.overlayfs").cloned())
    }

    async fn read_content_blob(&self, digest: &str) -> AgentResult<Vec<u8>> {
        let mut content = ContentClient::new(self.channel.clone());
        let req = ReadContentRequest { digest: digest.to_string(), ..Default::default() };
        let req = with_namespace!(req, &self.namespace);
        let mut stream = content.read(req).await.map_err(grpc_err)?.into_inner();
        let mut data = Vec::new();
        while let Some(chunk) = stream.message().await.map_err(grpc_err)? {
            data.extend_from_slice(&chunk.data);
        }
        Ok(data)
    }

    async fn prepare_snapshot(&self, image: &str, key: &str) -> AgentResult<()> {
        let _ = Command::new("ctr").arg("-n").arg(&self.namespace)
            .arg("images").arg("unpack").arg("--snapshotter").arg("overlayfs").arg(image)
            .output().await;

        let mut snaps = SnapshotsClient::new(self.channel.clone());
        // Try using image ref as parent first (works on some containerd setups).
        let req = PrepareSnapshotRequest {
            snapshotter: "overlayfs".to_string(), key: key.to_string(), parent: image.to_string(), ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        if snaps.prepare(req).await.is_ok() { return Ok(()); }

        // Resolve the exact unpacked snapshot parent for this image from content labels.
        if let Some(parent) = self.resolve_snapshot_parent_key(image).await? {
            let req = PrepareSnapshotRequest {
                snapshotter: "overlayfs".to_string(),
                key: key.to_string(),
                parent: parent.clone(),
                ..Default::default()
            };
            let req = with_namespace!(req, &self.namespace);
            if snaps.prepare(req).await.is_ok() {
                return Ok(());
            }
            warn!("prepare snapshot with resolved parent {} failed for image {}", parent, image);
        } else {
            warn!("No overlayfs snapshot parent label found for image {}", image);
        }

        Err(AgentError::ContainerError(format!("Failed to prepare snapshot for {}", image)))
    }

    async fn get_snapshot_mounts(&self, key: &str) -> AgentResult<Vec<containerd_client::types::Mount>> {
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let req = MountsRequest { snapshotter: "overlayfs".to_string(), key: key.to_string() };
        let req = with_namespace!(req, &self.namespace);
        Ok(snaps.mounts(req).await.map_err(grpc_err)?.into_inner().mounts)
    }

    fn build_oci_spec(&self, config: &ContainerConfig<'_>, io_dir: &Path, use_host_network: bool, image_env: &[String]) -> AgentResult<serde_json::Value> {
        // Start with image env as base, then overlay our defaults and config env.
        // This preserves image-specific PATH, JAVA_HOME, etc.
        let mut env_map: HashMap<String, String> = HashMap::new();
        for entry in image_env {
            if let Some((k, v)) = entry.split_once('=') {
                env_map.insert(k.to_string(), v.to_string());
            }
        }
        // Template/config env takes highest priority
        for (k, v) in config.env { env_map.insert(k.to_string(), v.to_string()); }
        // Ensure PATH is usable for JVM-based images even if image env probing fails
        // or template/server env accidentally overrides PATH.
        // The Pterodactyl Hytale image provides java at /opt/java/openjdk/bin/java.
        const DEFAULT_PATH: &str =
            "/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
        let path_value = env_map.get("PATH").map(|v| v.trim()).unwrap_or("");
        if path_value.is_empty() {
            env_map.insert("PATH".to_string(), DEFAULT_PATH.to_string());
        } else if !path_value.split(':').any(|segment| segment == "/opt/java/openjdk/bin") {
            env_map.insert(
                "PATH".to_string(),
                format!("/opt/java/openjdk/bin:{}", path_value),
            );
        }
        env_map.insert("TERM".to_string(), "xterm".to_string());
        // Runtime container runs as 1000:1000; set HOME to the data dir
        env_map.insert("HOME".to_string(), "/data".to_string());
        let env_list: Vec<String> = env_map.into_iter().map(|(k, v)| format!("{}={}", k, v)).collect();

        let args = if !config.startup_command.is_empty() {
            let escaped_startup = shell_escape_value(config.startup_command);
            let wrapped_command = format!(
                "export PATH=\"/opt/java/openjdk/bin:${{PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}}\"; exec /bin/sh -c {}",
                escaped_startup
            );
            vec!["/bin/sh".to_string(), "-c".to_string(), wrapped_command]
        } else {
            vec!["/bin/sh".to_string()]
        };

        let mem_limit = (config.memory_mb as i64) * 1024 * 1024;
        let cpu_quota = (config.cpu_cores as i64) * 100_000;
        let cgroup_path = format!("/{}/{}", self.namespace, config.container_id);
        // Runtime containers run as non-root (1000:1000) and need minimal capabilities.
        let caps = ["CAP_NET_BIND_SERVICE"];
        let mut mounts = base_mounts(config.data_dir);
        mounts.push(serde_json::json!({"destination":io_dir.to_string_lossy().to_string(),"type":"bind","source":io_dir.to_string_lossy().to_string(),"options":["rbind","rw"]}));

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

        for (h, c) in [("/etc/machine-id","/etc/machine-id"),("/var/lib/dbus/machine-id","/var/lib/dbus/machine-id"),("/sys/class/dmi/id/product_uuid","/sys/class/dmi/id/product_uuid")] {
            if Path::new(h).exists() { mounts.push(serde_json::json!({"destination":c,"type":"bind","source":h,"options":["rbind","ro"]})); }
        }
        let mut ns = vec![serde_json::json!({"type":"pid"}),serde_json::json!({"type":"ipc"}),serde_json::json!({"type":"uts"}),serde_json::json!({"type":"mount"})];
        if !use_host_network { ns.push(serde_json::json!({"type":"network"})); }

        Ok(serde_json::json!({
            "ociVersion":"1.1.0",
            "process":{"terminal":false,"user":{"uid":1000,"gid":1000},"args":args,"env":env_list,"cwd":"/data",
                "capabilities":{"bounding":caps,"effective":caps,"permitted":caps,"ambient":caps},
                "noNewPrivileges":true,"rlimits":[{"type":"RLIMIT_NOFILE","hard":65536u64,"soft":65536u64}]},
            "root":{"path":"rootfs","readonly":false},"hostname":config.container_id,"mounts":mounts,
            "linux":{"cgroupsPath":cgroup_path,"resources":{"memory":{"limit":mem_limit},"cpu":{"quota":cpu_quota,"period":100000u64},
                "devices":[{"allow":false,"access":"rwm"},{"allow":true,"type":"c","major":1,"minor":3,"access":"rwm"},
                    {"allow":true,"type":"c","major":1,"minor":5,"access":"rwm"},{"allow":true,"type":"c","major":1,"minor":8,"access":"rwm"},
                    {"allow":true,"type":"c","major":1,"minor":9,"access":"rwm"},{"allow":true,"type":"c","major":5,"minor":0,"access":"rwm"},
                    {"allow":true,"type":"c","major":5,"minor":1,"access":"rwm"}]},
                "namespaces":ns,"maskedPaths":masked_paths(),"readonlyPaths":readonly_paths(),
                "seccomp": default_seccomp_profile()}
        }))
    }

    async fn setup_cni_network(&self, container_id: &str, pid: u32, network_mode: Option<&str>, network_ip: Option<&str>, primary_port: u16, port_bindings: &HashMap<u16, u16>) -> AgentResult<()> {
        let network = network_mode.unwrap_or("bridge");
        if network == "host" { return Ok(()); }
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
                let (iface, subnet, gateway) = detect_host_network().unwrap_or_else(|| {
                    warn!("Could not detect host network, falling back to eth0/192.168.1.0");
                    ("eth0".to_string(), "192.168.1.0/24".to_string(), "192.168.1.1".to_string())
                });
                // Calculate rangeStart/rangeEnd from subnet (same logic as NetworkManager)
                let (range_start, range_end) = calculate_ip_range_from_subnet(&subnet);
                info!("macvlan network '{}': master={}, subnet={}, gateway={}, range={}-{}",
                      network, iface, subnet, gateway, range_start, range_end);
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
                let prefix = ipam.get("ranges").and_then(|r| r.get(0)).and_then(|r| r.get(0))
                    .and_then(|r| r.get("subnet")).and_then(|s| s.as_str())
                    .or_else(|| ipam.get("subnet").and_then(|s| s.as_str()))
                    .and_then(|s| s.split('/').nth(1)).unwrap_or("24");
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
        if let Ok(j) = serde_json::to_string(&cfg) { let _ = fs::write(&cfg_path, &j); }
        let result = self.exec_cni_plugin(&cfg, "ADD", container_id, &netns, "eth0").await?;
        let rp = format!("/var/lib/cni/results/catalyst-{}", container_id);
        if let Ok(j) = serde_json::to_string_pretty(&result) { let _ = fs::write(&rp, &j); }
        let cip = result.get("ips").and_then(|v|v.as_array()).and_then(|a|a.first()).and_then(|ip|ip.get("address")).and_then(|v|v.as_str()).unwrap_or("").split('/').next().unwrap_or("");
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
                self.setup_port_forward(primary_port, primary_port, cip).await?;
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

    /// Ensure iptables FORWARD rules allow traffic from bridge to external
    async fn ensure_bridge_forward_rules(&self) {
        // Check if rules already exist to avoid duplicates
        let check_output = Command::new("iptables")
            .args(["-C", "FORWARD", "-i", "catalyst0", "-o", "enp34s0", "-j", "ACCEPT"])
            .output()
            .await;

        if let Ok(output) = check_output {
            if !output.status.success() {
                // Rule doesn't exist, add it
                let result = Command::new("iptables")
                    .args(["-I", "FORWARD", "1", "-i", "catalyst0", "-o", "enp34s0", "-j", "ACCEPT"])
                    .output()
                    .await;
                match result {
                    Ok(o) if o.status.success() => info!("Added FORWARD rule: catalyst0 -> enp34s0"),
                    Ok(o) => warn!("Failed to add FORWARD rule: {}", String::from_utf8_lossy(&o.stderr)),
                    Err(e) => warn!("Failed to execute iptables: {}", e),
                }

                let result = Command::new("iptables")
                    .args(["-I", "FORWARD", "2", "-i", "enp34s0", "-o", "catalyst0", "-j", "ACCEPT"])
                    .output()
                    .await;
                match result {
                    Ok(o) if o.status.success() => info!("Added FORWARD rule: enp34s0 -> catalyst0 (allow new connections)"),
                    Ok(o) => warn!("Failed to add FORWARD rule: {}", String::from_utf8_lossy(&o.stderr)),
                    Err(e) => warn!("Failed to execute iptables: {}", e),
                }
            }
        }
    }

    async fn resolve_task_netns(&self, container_id: &str, initial_pid: u32) -> AgentResult<String> {
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

    async fn exec_cni_plugin(&self, config: &serde_json::Value, command: &str, cid: &str, netns: &str, ifname: &str) -> AgentResult<serde_json::Value> {
        let ptype = config["type"].as_str().unwrap_or("bridge");
        let cni_bin_dir = discover_cni_bin_dir();
        let ppath = format!("{}/{}", cni_bin_dir, ptype);
        if !Path::new(&ppath).exists() {
            return Err(AgentError::ContainerError(format!(
                "CNI plugin not found: {} (searched directories: {:?})",
                ppath, CNI_BIN_DIRS
            )));
        }
        let cfg = serde_json::to_string(config).map_err(|e| AgentError::ContainerError(e.to_string()))?;
        let mut child = Command::new(&ppath)
            .env("CNI_COMMAND",command).env("CNI_CONTAINERID",cid).env("CNI_NETNS",netns).env("CNI_IFNAME",ifname).env("CNI_PATH",cni_bin_dir)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| AgentError::ContainerError(format!("CNI: {}", e)))?;
        if let Some(mut stdin) = child.stdin.take() { use tokio::io::AsyncWriteExt; stdin.write_all(cfg.as_bytes()).await?; drop(stdin); }
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
                command,
                ptype,
                netns,
                out.status,
                plugin_msg,
                stderr,
                stdout
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
                vec!["-t","nat","-A","PREROUTING","-p",proto,"--dport",&hps,"-j","DNAT","--to-destination",&dest],
                vec!["-t","nat","-A","OUTPUT","-p",proto,"--dport",&hps,"-j","DNAT","--to-destination",&dest],
            ] {
                let o = Command::new("iptables").args(&args).output().await?;
                if !o.status.success() { warn!("iptables: {}", String::from_utf8_lossy(&o.stderr)); }
            }
        }
        // MASQUERADE rule for outgoing traffic (needed for NAT)
        for args in [
            vec!["-t","nat","-A","POSTROUTING","-p","tcp","-d",cip,"--dport",&cps,"-j","MASQUERADE"],
            vec!["-t","nat","-A","POSTROUTING","-p","udp","-d",cip,"--dport",&cps,"-j","MASQUERADE"],
        ] {
            let o = Command::new("iptables").args(&args).output().await?;
            if !o.status.success() { warn!("iptables: {}", String::from_utf8_lossy(&o.stderr)); }
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
                    vec!["-t","nat","-D","PREROUTING","-p",proto,"--dport",&hps,"-j","DNAT","--to-destination",&dest],
                    vec!["-t","nat","-D","OUTPUT","-p",proto,"--dport",&hps,"-j","DNAT","--to-destination",&dest],
                ] {
                    let o = Command::new("iptables").args(&args).output().await?;
                    if !o.status.success() {
                        warn!("iptables: {}", String::from_utf8_lossy(&o.stderr));
                    }
                }
        }
        for args in [
            vec!["-t","nat","-D","POSTROUTING","-p","tcp","-d",cip,"--dport",&cps,"-j","MASQUERADE"],
            vec!["-t","nat","-D","POSTROUTING","-p","udp","-d",cip,"--dport",&cps,"-j","MASQUERADE"],
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
        if !Path::new(&rp).exists() { return Ok(()); }
        // Load stored CNI config for proper teardown (bridge vs macvlan)
        let cfg_path = format!("/var/lib/cni/results/catalyst-{}-config", container_id);
        let cfg = fs::read_to_string(&cfg_path).ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(|| serde_json::json!({"cniVersion":"1.0.0","name":"catalyst","type":"bridge","bridge":"catalyst0","ipam":{"type":"host-local","dataDir":"/var/lib/cni/networks"}}));
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest { container_id: container_id.to_string(), ..Default::default() };
        let req = with_namespace!(req, &self.namespace);
        let netns = match tasks.get(req).await {
            Ok(r) => r.into_inner().process.map(|p| format!("/proc/{}/ns/net", p.pid)).unwrap_or_default(),
            Err(_) => String::new(),
        };
        if !netns.is_empty() { let _ = self.exec_cni_plugin(&cfg, "DEL", container_id, &netns, "eth0").await; }
        let _ = fs::remove_file(&rp);
        let _ = fs::remove_file(&cfg_path);
        Ok(())
    }

    fn cleanup_io(&self, container_id: &str) {
        let _ = fs::remove_dir_all(PathBuf::from(CONSOLE_BASE_DIR).join(container_id));
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
fn detect_host_network() -> Option<(String, String, String)> {
    // Parse `ip -4 route show default` → "default via <gw> dev <iface> ..."
    let output = std::process::Command::new("ip")
        .args(["-4", "route", "show", "default"])
        .output().ok()?;
    let route = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = route.split_whitespace().collect();
    let gw_idx = parts.iter().position(|&p| p == "via")?;
    let if_idx = parts.iter().position(|&p| p == "dev")?;
    let gateway = parts.get(gw_idx + 1)?.to_string();
    let iface = parts.get(if_idx + 1)?.to_string();

    // Parse interface address → "inet <ip>/<prefix> ..."
    let output = std::process::Command::new("ip")
        .args(["-4", "-o", "addr", "show", &iface])
        .output().ok()?;
    let addr_line = String::from_utf8_lossy(&output.stdout);
    let cidr = addr_line.split_whitespace()
        .find(|s| s.contains('/') && s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))?
        .to_string();
    let (ip_str, prefix_str) = cidr.split_once('/')?;
    let ip: Ipv4Addr = ip_str.parse().ok()?;
    let prefix: u32 = prefix_str.parse().ok()?;
    let mask = if prefix == 0 { 0u32 } else { !0u32 << (32 - prefix) };
    let net_addr = Ipv4Addr::from(u32::from(ip) & mask);
    let subnet = format!("{}/{}", net_addr, prefix);

    Some((iface, subnet, gateway))
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
        warn!("Invalid IP address format '{}', using default range", base_ip);
        return ("10.0.0.10".to_string(), "10.0.0.250".to_string());
    }

    // Use .10 to .250 as the usable range (matching NetworkManager's cidr_usable_range)
    (
        format!("{}.{}.{}.10", ip_parts[0], ip_parts[1], ip_parts[2]),
        format!("{}.{}.{}.250", ip_parts[0], ip_parts[1], ip_parts[2])
    )
}

fn create_fifo(path: &Path) -> std::io::Result<()> {
    match mkfifo(path, Mode::from_bits_truncate(0o600)) {
        Ok(()) => Ok(()), Err(Errno::EEXIST) => Ok(()),
        Err(err) => Err(std::io::Error::other(err)),
    }
}

fn open_fifo_rdwr(path: &Path) -> AgentResult<File> {
    let file = std::fs::OpenOptions::new().read(true).write(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC).open(path)
        .map_err(|e| AgentError::ContainerError(format!("open FIFO: {}", e)))?;
    if let Ok(flags) = fcntl(&file, FcntlArg::F_GETFL) {
        let mut of = OFlag::from_bits_truncate(flags); of.remove(OFlag::O_NONBLOCK);
        let _ = fcntl(&file, FcntlArg::F_SETFL(of));
    }
    Ok(file)
}

fn set_dir_perms(path: &Path, mode: u32) {
    if let Ok(md) = fs::metadata(path) { let mut p = md.permissions(); p.set_mode(mode); fs::set_permissions(path, p).ok(); }
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
    AgentError::ContainerError(format!("containerd gRPC error ({}): {}", e.code(), e.message()))
}

fn is_not_found(e: &tonic::Status) -> bool {
    e.message().contains("not found") || e.message().contains("process already finished") || e.code() == tonic::Code::NotFound
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
        "/proc/kallsyms",      // Kernel symbols - useful for exploit development
        "/proc/self/mem",      // Memory manipulation vector
        "/sys/kernel",         // Kernel parameters and addresses
        "/sys/class",          // Hardware enumeration for fingerprinting
        "/proc/slabinfo",      // Kernel slab allocator info
        "/proc/modules",       // Loaded kernel modules
    ]
}
fn readonly_paths() -> Vec<&'static str> { vec!["/proc/asound","/proc/bus","/proc/fs","/proc/irq","/proc/sys","/proc/sysrq-trigger"] }

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

fn find_container_cgroup(container_id: &str) -> Option<String> { find_cgroup_recursive("/sys/fs/cgroup", container_id) }
fn find_cgroup_recursive(dir: &str, cid: &str) -> Option<String> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path(); let n = entry.file_name().to_string_lossy().to_string();
        if n.contains(cid) && p.is_dir() { return Some(p.to_string_lossy().to_string()); }
        if p.is_dir() && !n.starts_with('.') { if let Some(f) = find_cgroup_recursive(&p.to_string_lossy(), cid) { return Some(f); } }
    }
    None
}

async fn read_cgroup_cpu_percent(path: &str) -> Option<f64> {
    let content = tokio::fs::read_to_string(format!("{}/cpu.stat", path)).await.ok()?;
    for line in content.lines() {
        if line.starts_with("usage_usec") { return line.split_whitespace().nth(1)?.parse::<u64>().ok().map(|u| u as f64 / 1_000_000.0); }
    }
    Some(0.0)
}

async fn read_cgroup_memory(path: &str) -> Option<u64> {
    tokio::fs::read_to_string(format!("{}/memory.current", path)).await.ok()?.trim().parse().ok()
}
