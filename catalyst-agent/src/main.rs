use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

mod config;
mod errors;
mod file_manager;
mod file_tunnel;
mod firewall_manager;
mod network_manager;
mod runtime_manager;
mod storage_manager;
mod system_setup;
mod websocket_handler;

pub use config::AgentConfig;
pub use errors::{AgentError, AgentResult};
pub use file_manager::FileManager;
pub use file_tunnel::FileTunnelClient;
pub use firewall_manager::FirewallManager;
pub use network_manager::NetworkManager;
pub use runtime_manager::ContainerdRuntime;
pub use storage_manager::StorageManager;
pub use system_setup::SystemSetup;
pub use websocket_handler::WebSocketHandler;

/// Catalyst Agent - Main application state
pub struct CatalystAgent {
    pub config: Arc<AgentConfig>,
    pub runtime: Arc<ContainerdRuntime>,
    pub ws_handler: Arc<WebSocketHandler>,
    pub file_manager: Arc<FileManager>,
    pub file_tunnel: Arc<FileTunnelClient>,
    pub storage_manager: Arc<StorageManager>,
    pub backend_connected: Arc<RwLock<bool>>,
}

impl CatalystAgent {
    pub async fn new(config: AgentConfig) -> AgentResult<Self> {
        info!("Initializing Catalyst Agent");

        let config = Arc::new(config);
        let runtime = Arc::new(ContainerdRuntime::new(
            config.containerd.socket_path.clone(),
            config.containerd.namespace.clone(),
        ));

        let file_manager = Arc::new(FileManager::new(config.server.data_dir.join("servers")));
        let storage_manager = Arc::new(StorageManager::new(config.server.data_dir.clone()));
        let file_tunnel = Arc::new(FileTunnelClient::new(config.clone(), file_manager.clone()));

        let ws_handler = Arc::new(WebSocketHandler::new(
            config.clone(),
            runtime.clone(),
            file_manager.clone(),
            storage_manager.clone(),
        ));

        Ok(Self {
            config,
            runtime,
            ws_handler,
            file_manager,
            file_tunnel,
            storage_manager,
            backend_connected: Arc::new(RwLock::new(false)),
        })
    }

    pub async fn run(&self) -> AgentResult<()> {
        info!("Starting Catalyst Agent");

        // Run an initial resource snapshot immediately (captures current usage at startup)
        if let Err(e) = self.ws_handler.send_resource_stats().await {
            warn!("Initial resource snapshot failed: {}", e);
        }

        // Start WebSocket connection to backend
        let agent = self.clone_refs();
        let ws_task = tokio::spawn(async move {
            if let Err(e) = agent.ws_handler.connect_and_listen().await {
                error!("WebSocket error: {}", e);
            }
        });

        // Start health monitoring
        let agent = self.clone_refs();
        let health_task = tokio::spawn(async move {
            agent.start_health_monitoring().await;
        });

        // Start file tunnel (HTTP-based file operations)
        let file_tunnel = self.file_tunnel.clone();
        let tunnel_task = tokio::spawn(async move {
            file_tunnel.run().await;
        });

        // Start HTTP server for local management
        tokio::select! {
            _ = ws_task => {},
            _ = health_task => {},
            _ = tunnel_task => {},
        }

        Ok(())
    }

    async fn start_health_monitoring(&self) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));

        loop {
            interval.tick().await;

            // Collect health metrics
            if let Err(err) = self.ws_handler.send_health_report().await {
                warn!("Failed to send health report: {}", err);
            }

            // Collect per-server resource stats
            if let Err(err) = self.ws_handler.send_resource_stats().await {
                warn!("Failed to send resource stats: {}", err);
            }
        }
    }

    fn clone_refs(&self) -> Self {
        Self {
            config: self.config.clone(),
            runtime: self.runtime.clone(),
            ws_handler: self.ws_handler.clone(),
            file_manager: self.file_manager.clone(),
            file_tunnel: self.file_tunnel.clone(),
            storage_manager: self.storage_manager.clone(),
            backend_connected: self.backend_connected.clone(),
        }
    }
}

#[tokio::main]
async fn main() -> AgentResult<()> {
    let mut config_path: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--config" {
            config_path = args.next();
        }
    }

    let config_path = config_path.as_deref().unwrap_or("./config.toml");
    // Load config first so logging level/format can be applied.
    let config = AgentConfig::from_file(config_path)
        .or_else(|_| AgentConfig::from_file("/opt/catalyst-agent/config.toml"))
        .or_else(|_| AgentConfig::from_env())
        .map_err(|e| AgentError::ConfigError(e.to_string()))?;

    let filter = format!("catalyst_agent={},tokio=info", config.logging.level);
    if config.logging.format == "json" {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    info!("Catalyst Agent starting");
    info!("Configuration loaded: {:?}", config);

    // Run system initialization
    info!("Running system setup and dependency check...");
    if let Err(e) = SystemSetup::initialize(&config).await {
        warn!("System setup encountered issues: {}", e);
        warn!("Continuing with existing configuration...");
    }

    // Create and run agent
    let agent = CatalystAgent::new(config).await?;
    agent.run().await?;

    Ok(())
}
