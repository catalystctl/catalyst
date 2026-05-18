use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{info, warn};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentConfig {
    pub server: ServerConfig,
    pub containerd: ContainerdConfig,
    #[serde(default)]
    pub networking: NetworkingConfig,
    pub logging: LoggingConfig,
    #[serde(default)]
    pub agent: AgentPathsConfig,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    pub backend_url: String,
    pub node_id: String,
    pub api_key: String,
    pub hostname: String,
    pub data_dir: PathBuf,
    /// Maximum number of game servers allowed on this node.
    /// Previously named `max_connections`; now enforces server count.
    pub max_connections: usize,
    /// Directory for container console I/O (stdout/stderr FIFOs and log files).
    /// When not explicitly set, derives from `data_dir/console`.
    #[serde(default = "default_console_log_dir")]
    pub console_log_dir: PathBuf,
}

impl std::fmt::Debug for ServerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServerConfig")
            .field("backend_url", &self.backend_url)
            .field("node_id", &self.node_id)
            .field("api_key", &"[REDACTED]")
            .field("hostname", &self.hostname)
            .field("data_dir", &self.data_dir)
            .field("console_log_dir", &self.console_log_dir)
            .field("max_connections", &self.max_connections)
            .finish()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ContainerdConfig {
    pub socket_path: PathBuf,
    pub namespace: String,
    /// Directory where CNI network configuration files (.conflist) are stored.
    #[serde(default = "default_cni_dir")]
    pub cni_dir: PathBuf,
    /// Directory where CNI plugin binaries are installed.
    #[serde(default = "default_cni_bin_dir")]
    pub cni_bin_dir: PathBuf,
    /// Directory used by the host-local IPAM plugin for lease storage.
    #[serde(default = "default_cni_data_dir")]
    pub cni_data_dir: PathBuf,
    /// Directory for CNI result/state files and port-forward state.
    #[serde(default = "default_cni_results_dir")]
    pub cni_results_dir: PathBuf,
    /// Bridge interface name for the default NAT network.
    #[serde(default = "default_cni_bridge_name")]
    pub cni_bridge_name: String,
    /// Subnet for the default bridge NAT network (e.g. "10.42.0.0/16").
    #[serde(default = "default_cni_bridge_subnet")]
    pub cni_bridge_subnet: String,
    /// Systemd override directory for the containerd service unit.
    #[serde(default = "default_systemd_override_dir")]
    pub systemd_override_dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LoggingConfig {
    pub level: String,
    pub format: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NetworkingConfig {
    #[serde(default)]
    pub networks: Vec<CniNetworkConfig>,
    /// DNS servers for containers. Defaults to Cloudflare (1.1.1.1) and Google (8.8.8.8) if not set.
    #[serde(default = "default_dns_servers")]
    pub dns_servers: Vec<String>,
}

impl Default for NetworkingConfig {
    fn default() -> Self {
        Self {
            networks: Vec::new(),
            dns_servers: default_dns_servers(),
        }
    }
}

fn default_dns_servers() -> Vec<String> {
    vec![
        "1.1.1.1".to_string(),
        "8.8.8.8".to_string(),
        "2606:4700:4700::1111".to_string(),
        "2001:4860:4860::8888".to_string(),
    ]
}

/// Agent-level paths and settings that are independent of the container runtime.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentPathsConfig {
    /// Path to the agent's config.toml (used by NetworkManager for persistence).
    #[serde(default = "default_config_path")]
    pub config_path: PathBuf,
    /// GitHub repository for agent release binaries.
    #[serde(default = "default_release_repo")]
    pub release_repo: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CniNetworkConfig {
    pub name: String,
    pub interface: Option<String>,
    pub cidr: Option<String>,
    pub gateway: Option<String>,
    pub range_start: Option<String>,
    pub range_end: Option<String>,
}

// ---------------------------------------------------------------------------
// Default value functions for serde + env-var fallbacks
// ---------------------------------------------------------------------------

fn default_console_log_dir() -> PathBuf {
    PathBuf::from("/var/log/catalyst/console")
}
fn default_cni_dir() -> PathBuf {
    PathBuf::from("/etc/cni/net.d")
}
fn default_cni_bin_dir() -> PathBuf {
    PathBuf::from("/opt/cni/bin")
}
fn default_cni_data_dir() -> PathBuf {
    PathBuf::from("/var/lib/cni/networks")
}
fn default_cni_results_dir() -> PathBuf {
    PathBuf::from("/var/lib/cni/results")
}
fn default_cni_bridge_name() -> String {
    "catalyst0".to_string()
}
fn default_cni_bridge_subnet() -> String {
    "10.42.0.0/16".to_string()
}
fn default_systemd_override_dir() -> PathBuf {
    PathBuf::from("/etc/systemd/system/containerd.service.d")
}
fn default_config_path() -> PathBuf {
    PathBuf::from("/opt/catalyst-agent/config.toml")
}
fn default_release_repo() -> String {
    "catalystctl/catalyst".to_string()
}

impl Default for AgentPathsConfig {
    fn default() -> Self {
        Self {
            config_path: default_config_path(),
            release_repo: default_release_repo(),
        }
    }
}

impl Default for ContainerdConfig {
    fn default() -> Self {
        Self {
            socket_path: PathBuf::from("/run/containerd/containerd.sock"),
            namespace: "catalyst".to_string(),
            cni_dir: default_cni_dir(),
            cni_bin_dir: default_cni_bin_dir(),
            cni_data_dir: default_cni_data_dir(),
            cni_results_dir: default_cni_results_dir(),
            cni_bridge_name: default_cni_bridge_name(),
            cni_bridge_subnet: default_cni_bridge_subnet(),
            systemd_override_dir: default_systemd_override_dir(),
        }
    }
}

impl AgentConfig {
    pub fn from_file(path: &str) -> Result<Self, String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = std::fs::metadata(path)
                .map_err(|e| format!("Failed to read config metadata: {}", e))?;
            let mode = metadata.permissions().mode();
            if mode & 0o004 != 0 {
                warn!(
                    "Config file {} is world-readable ({:o}). \
                    Run: chmod o-r {}",
                    path,
                    mode & 0o777,
                    path
                );
            }
        }
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read config: {}", e))?;
        let mut config: Self =
            toml::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
        if config.server.api_key.trim().is_empty() {
            return Err("server.api_key must be set".to_string());
        }

        // When console_log_dir is the default sentinel, derive it from data_dir
        // so that logs follow the data directory when the user overrides it.
        if config.server.console_log_dir == PathBuf::from("/var/log/catalyst/console") {
            config.server.console_log_dir = config.server.data_dir.join("console");
            info!(
                "Console log dir derived from data_dir: {}",
                config.server.console_log_dir.display()
            );
        }

        Ok(config)
    }

    pub fn from_env() -> Result<Self, String> {
        let data_dir = PathBuf::from(
            std::env::var("DATA_DIR").unwrap_or_else(|_| "/var/lib/catalyst".to_string()),
        );
        let console_log_dir = if let Ok(v) = std::env::var("CONSOLE_LOG_DIR") {
            PathBuf::from(v)
        } else {
            // Derive from data_dir when not explicitly set
            data_dir.join("console")
        };

        let config = Self {
            server: ServerConfig {
                backend_url: std::env::var("BACKEND_URL")
                    .unwrap_or_else(|_| "ws://localhost:3000/ws".to_string()),
                node_id: std::env::var("NODE_ID").map_err(|_| "NODE_ID not set".to_string())?,
                api_key: std::env::var("NODE_API_KEY")
                    .map_err(|_| "NODE_API_KEY not set".to_string())?,
                hostname: hostname().map_err(|e| format!("Failed to get hostname: {}", e))?,
                data_dir: data_dir.clone(),
                console_log_dir,
                max_connections: 100,
            },
            containerd: ContainerdConfig {
                socket_path: PathBuf::from(
                    std::env::var("CONTAINERD_SOCKET")
                        .unwrap_or_else(|_| "/run/containerd/containerd.sock".to_string()),
                ),
                namespace: std::env::var("CONTAINERD_NAMESPACE")
                    .unwrap_or_else(|_| "catalyst".to_string()),
                cni_dir: PathBuf::from(
                    std::env::var("CNI_DIR").unwrap_or_else(|_| "/etc/cni/net.d".to_string()),
                ),
                cni_bin_dir: PathBuf::from(
                    std::env::var("CNI_BIN_DIR").unwrap_or_else(|_| "/opt/cni/bin".to_string()),
                ),
                cni_data_dir: PathBuf::from(
                    std::env::var("CNI_DATA_DIR")
                        .unwrap_or_else(|_| "/var/lib/cni/networks".to_string()),
                ),
                cni_results_dir: PathBuf::from(
                    std::env::var("CNI_RESULTS_DIR")
                        .unwrap_or_else(|_| "/var/lib/cni/results".to_string()),
                ),
                cni_bridge_name: std::env::var("CNI_BRIDGE_NAME")
                    .unwrap_or_else(|_| "catalyst0".to_string()),
                cni_bridge_subnet: std::env::var("CNI_BRIDGE_SUBNET")
                    .unwrap_or_else(|_| "10.42.0.0/16".to_string()),
                systemd_override_dir: PathBuf::from(
                    std::env::var("SYSTEMD_OVERRIDE_DIR")
                        .unwrap_or_else(|_| "/etc/systemd/system/containerd.service.d".to_string()),
                ),
            },
            networking: NetworkingConfig::default(),
            logging: LoggingConfig {
                level: std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string()),
                format: "json".to_string(),
            },
            agent: AgentPathsConfig {
                config_path: PathBuf::from(
                    std::env::var("CATALYST_CONFIG_PATH")
                        .unwrap_or_else(|_| "/opt/catalyst-agent/config.toml".to_string()),
                ),
                release_repo: std::env::var("AGENT_RELEASE_REPO")
                    .unwrap_or_else(|_| "catalystctl/catalyst".to_string()),
            },
        };
        if config.server.api_key.trim().is_empty() {
            return Err("NODE_API_KEY must not be empty".to_string());
        }
        Ok(config)
    }

    /// Return the resolved config.toml path that should be used for persistence.
    /// This accounts for the CLI --config flag, the system default, and the
    /// agent.config_path config field.
    pub fn resolved_config_path(&self) -> &PathBuf {
        &self.agent.config_path
    }
}

fn hostname() -> Result<String, std::io::Error> {
    std::process::Command::new("hostname")
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}
