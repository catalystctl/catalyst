use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AgentConfig {
    pub server: ServerConfig,
    pub containerd: ContainerdConfig,
    #[serde(default)]
    pub networking: NetworkingConfig,
    pub logging: LoggingConfig,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    pub backend_url: String,
    pub node_id: String,
    pub api_key: String,
    pub hostname: String,
    pub data_dir: PathBuf,
    pub max_connections: usize,
}

impl std::fmt::Debug for ServerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServerConfig")
            .field("backend_url", &self.backend_url)
            .field("node_id", &self.node_id)
            .field("api_key", &"[REDACTED]")
            .field("hostname", &self.hostname)
            .field("data_dir", &self.data_dir)
            .field("max_connections", &self.max_connections)
            .finish()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ContainerdConfig {
    pub socket_path: PathBuf,
    pub namespace: String,
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
    vec!["1.1.1.1".to_string(), "8.8.8.8".to_string()]
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

impl AgentConfig {
    pub fn from_file(path: &str) -> Result<Self, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read config: {}", e))?;
        let config: Self =
            toml::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
        if config.server.api_key.trim().is_empty() {
            return Err("server.api_key must be set".to_string());
        }
        Ok(config)
    }

    pub fn from_env() -> Result<Self, String> {
        let config = Self {
            server: ServerConfig {
                backend_url: std::env::var("BACKEND_URL")
                    .unwrap_or_else(|_| "ws://localhost:3000/ws".to_string()),
                node_id: std::env::var("NODE_ID").map_err(|_| "NODE_ID not set".to_string())?,
                api_key: std::env::var("NODE_API_KEY")
                    .map_err(|_| "NODE_API_KEY not set".to_string())?,
                hostname: hostname().map_err(|e| format!("Failed to get hostname: {}", e))?,
                data_dir: PathBuf::from(
                    std::env::var("DATA_DIR").unwrap_or_else(|_| "/var/lib/catalyst".to_string()),
                ),
                max_connections: 100,
            },
            containerd: ContainerdConfig {
                socket_path: PathBuf::from(
                    std::env::var("CONTAINERD_SOCKET")
                        .unwrap_or_else(|_| "/run/containerd/containerd.sock".to_string()),
                ),
                namespace: std::env::var("CONTAINERD_NAMESPACE")
                    .unwrap_or_else(|_| "catalyst".to_string()),
            },
            networking: NetworkingConfig::default(),
            logging: LoggingConfig {
                level: std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string()),
                format: "json".to_string(),
            },
        };
        if config.server.api_key.trim().is_empty() {
            return Err("NODE_API_KEY must not be empty".to_string());
        }
        Ok(config)
    }
}

fn hostname() -> Result<String, std::io::Error> {
    std::process::Command::new("hostname")
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}
