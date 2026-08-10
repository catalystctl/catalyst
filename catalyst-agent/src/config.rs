use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{error, info, warn};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentConfig {
    pub server: ServerConfig,
    pub containerd: ContainerdConfig,
    #[serde(default)]
    pub networking: NetworkingConfig,
    pub logging: LoggingConfig,
    #[serde(default)]
    pub agent: AgentPathsConfig,
    #[serde(default)]
    pub sftp: SftpConfigSection,
}

/// SFTP server configuration section in config.toml.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SftpConfigSection {
    /// Port the SFTP server listens on. Default: 2022.
    #[serde(default = "default_sftp_port")]
    pub port: u16,
    /// Path to the SSH host key file.
    #[serde(default = "default_sftp_host_key_path")]
    pub host_key_path: PathBuf,
}

fn default_sftp_port() -> u16 {
    2022
}
fn default_sftp_host_key_path() -> PathBuf {
    PathBuf::from("/opt/catalyst-agent/sftp_host_key")
}

impl Default for SftpConfigSection {
    fn default() -> Self {
        Self {
            port: default_sftp_port(),
            host_key_path: default_sftp_host_key_path(),
        }
    }
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
            if mode & 0o077 != 0 {
                warn!(
                    "Config file {} has overly broad permissions ({:o}). Fixing permissions...",
                    path,
                    mode & 0o777
                );
                // Strip ALL non-owner bits (not just "other") to match the
                // deploy script's chmod 0600. This prevents group read/write
                // as well as world access to the config containing the API key.
                let fixed_mode = mode & 0o600; // owner read+write only
                let perms = std::fs::Permissions::from_mode(fixed_mode);
                if let Err(e) = std::fs::set_permissions(path, perms) {
                    error!("Failed to fix config permissions: {}", e);
                } else {
                    info!("Config permissions fixed to {:o}", fixed_mode & 0o777);
                }
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
        if config.server.console_log_dir.as_path()
            == std::path::Path::new("/var/log/catalyst/console")
        {
            config.server.console_log_dir = config.server.data_dir.join("console");
            info!(
                "Console log dir derived from data_dir: {}",
                config.server.console_log_dir.display()
            );
        }

        config.apply_env_overrides();
        Ok(config)
    }

    /// Overlay selected environment variables on top of a file-loaded config.
    /// Env vars always win when set, matching the documented container contract.
    pub fn apply_env_overrides(&mut self) {
        if let Ok(v) = std::env::var("BACKEND_URL") {
            if !v.trim().is_empty() {
                self.server.backend_url = v;
            }
        }
        if let Ok(v) = std::env::var("NODE_ID") {
            if !v.trim().is_empty() {
                self.server.node_id = v;
            }
        }
        if let Ok(v) = std::env::var("NODE_API_KEY") {
            if !v.trim().is_empty() {
                self.server.api_key = v;
            }
        }
        if let Ok(v) = std::env::var("HOSTNAME") {
            if !v.trim().is_empty() {
                self.server.hostname = v;
            }
        }
        if let Ok(v) = std::env::var("DATA_DIR") {
            if !v.trim().is_empty() {
                self.server.data_dir = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("CONSOLE_LOG_DIR") {
            if !v.trim().is_empty() {
                self.server.console_log_dir = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("MAX_CONNECTIONS") {
            if let Ok(n) = v.parse::<usize>() {
                self.server.max_connections = std::cmp::min(n, 1000);
            }
        }
        if let Ok(v) = std::env::var("CONTAINERD_SOCKET") {
            if !v.trim().is_empty() {
                self.containerd.socket_path = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("CONTAINERD_NAMESPACE") {
            if !v.trim().is_empty() {
                self.containerd.namespace = v;
            }
        }
        if let Ok(v) = std::env::var("CNI_DIR") {
            if !v.trim().is_empty() {
                self.containerd.cni_dir = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("CNI_BIN_DIR") {
            if !v.trim().is_empty() {
                self.containerd.cni_bin_dir = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("CNI_DATA_DIR") {
            if !v.trim().is_empty() {
                self.containerd.cni_data_dir = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("CNI_RESULTS_DIR") {
            if !v.trim().is_empty() {
                self.containerd.cni_results_dir = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("CNI_BRIDGE_NAME") {
            if !v.trim().is_empty() {
                self.containerd.cni_bridge_name = v;
            }
        }
        if let Ok(v) = std::env::var("CNI_BRIDGE_SUBNET") {
            if !v.trim().is_empty() {
                self.containerd.cni_bridge_subnet = v;
            }
        }
        if let Ok(v) = std::env::var("SYSTEMD_OVERRIDE_DIR") {
            if !v.trim().is_empty() {
                self.containerd.systemd_override_dir = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("LOG_LEVEL") {
            if !v.trim().is_empty() {
                self.logging.level = v;
            }
        }
        if let Ok(v) = std::env::var("CATALYST_CONFIG_PATH") {
            if !v.trim().is_empty() {
                self.agent.config_path = PathBuf::from(v);
            }
        }
        if let Ok(v) = std::env::var("AGENT_RELEASE_REPO") {
            if !v.trim().is_empty() {
                self.agent.release_repo = v;
            }
        }
        if let Ok(v) = std::env::var("SFTP_PORT") {
            if let Ok(port) = v.parse::<u16>() {
                self.sftp.port = port;
            }
        }
        if let Ok(v) = std::env::var("SFTP_HOST_KEY") {
            if !v.trim().is_empty() {
                self.sftp.host_key_path = PathBuf::from(v);
            }
        }
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
                // Default to wss:// (encrypted). ws:// is only allowed for
                // loopback addresses unless CATALYST_ALLOW_INSECURE_WS=1 is set.
                backend_url: std::env::var("BACKEND_URL")
                    .unwrap_or_else(|_| "wss://localhost:3000/ws".to_string()),
                node_id: std::env::var("NODE_ID").map_err(|_| "NODE_ID not set".to_string())?,
                api_key: std::env::var("NODE_API_KEY")
                    .map_err(|_| "NODE_API_KEY not set".to_string())?,
                hostname: hostname().map_err(|e| format!("Failed to get hostname: {}", e))?,
                data_dir: data_dir.clone(),
                console_log_dir,
                // Cap at 1000 to prevent resource exhaustion from absurd values
                max_connections: std::cmp::min(
                    std::env::var("MAX_CONNECTIONS")
                        .ok()
                        .and_then(|v| v.parse::<usize>().ok())
                        .unwrap_or(100),
                    1000,
                ),
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
            sftp: SftpConfigSection {
                port: std::env::var("SFTP_PORT")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(2022),
                host_key_path: std::env::var("SFTP_HOST_KEY")
                    .ok()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("/opt/catalyst-agent/sftp_host_key")),
            },
        };
        if config.server.api_key.trim().is_empty() {
            return Err("NODE_API_KEY must not be empty".to_string());
        }
        // UF-25: API key is passed as an env var, which is readable by any
        // local user via /proc/<pid>/environ. Recommend deploying with
        // hidepid=2 on /proc or reading the key from a file instead.
        // For now, we log a warning if the key comes from the environment.
        if std::env::var("NODE_API_KEY").is_ok() {
            tracing::warn!(
                "NODE_API_KEY is set via environment variable. This key is readable \
                by any local user via /proc/<pid>/environ. Consider using a \
                config file with 0600 permissions instead, or set hidepid=2 on /proc."
            );
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
    // hostname(1) is a blocking subprocess; run it on a dedicated thread so any
    // future async caller of config load does not stall the runtime worker.
    let raw = std::thread::spawn(|| {
        std::process::Command::new("hostname")
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
    })
    .join()
    .map_err(|_| std::io::Error::other("hostname thread panicked"))??;
    // Sanitize hostname: allow only alphanumeric, hyphens, and dots.
    // This prevents any shell metacharacters from the hostname command
    // from propagating into config values, even though JSON serialization
    // already prevents injection into structured output.
    let sanitized: String = raw
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '.')
        .collect();
    if sanitized != raw {
        tracing::warn!(
            "Hostname '{}' contained disallowed characters; sanitized to '{}'",
            raw,
            sanitized
        );
    }
    Ok(sanitized)
}
