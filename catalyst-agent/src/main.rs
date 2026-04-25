use std::sync::Arc;
use tokio::signal::ctrl_c;
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinSet;
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
        let runtime = Arc::new(
            ContainerdRuntime::new(
                config.containerd.socket_path.clone(),
                config.containerd.namespace.clone(),
                config.networking.dns_servers.clone(),
            )
            .await?,
        );

        // Initialize firewall manager — loads persisted rule state from disk
        // so rules can be cleaned up even after agent restart.
        FirewallManager::init();

        // FileManager uses the same base data_dir as storage - servers are stored at {data_dir}/{server_uuid}
        let file_manager = Arc::new(FileManager::new(config.server.data_dir.clone()));
        let storage_manager = Arc::new(StorageManager::new(config.server.data_dir.clone()));
        let backend_connected = Arc::new(RwLock::new(false));
        let file_tunnel = Arc::new(FileTunnelClient::new(
            config.clone(),
            file_manager.clone(),
            backend_connected.clone(),
        ));

        // Release any stale CNI IPAM leases from containers that no longer exist
        // (e.g. containers that were running when the agent was killed).
        runtime.cleanup_stale_cni_leases().await;

        let ws_handler = Arc::new(WebSocketHandler::new(
            config.clone(),
            runtime.clone(),
            file_manager.clone(),
            storage_manager.clone(),
            backend_connected.clone(),
        ));

        Ok(Self {
            config,
            runtime,
            ws_handler,
            file_manager,
            file_tunnel,
            storage_manager,
            backend_connected,
        })
    }

    pub async fn run(&self, mut shutdown_rx: broadcast::Receiver<()>) -> AgentResult<()> {
        info!("Starting Catalyst Agent");

        // Run an initial resource snapshot immediately (captures current usage at startup)
        if let Err(e) = self.ws_handler.send_resource_stats(None).await {
            warn!("Initial resource snapshot failed: {}", e);
        }

        let mut join_set = JoinSet::new();

        // Start WebSocket connection to backend
        let agent = self.clone_refs();
        let mut ws_shutdown = shutdown_rx.resubscribe();
        join_set.spawn(async move {
            tokio::select! {
                result = agent.ws_handler.connect_and_listen() => {
                    if let Err(e) = result {
                        error!("WebSocket error: {}", e);
                    }
                }
                _ = ws_shutdown.recv() => {
                    info!("WebSocket task shutting down");
                }
            }
        });

        // Start health monitoring
        let agent = self.clone_refs();
        let health_shutdown = shutdown_rx.resubscribe();
        join_set.spawn(async move {
            agent.start_health_monitoring(health_shutdown).await;
        });

        // Start file tunnel (HTTP-based file operations)
        let file_tunnel = self.file_tunnel.clone();
        let mut tunnel_shutdown = shutdown_rx.resubscribe();
        join_set.spawn(async move {
            tokio::select! {
                _ = file_tunnel.run() => {},
                _ = tunnel_shutdown.recv() => {
                    info!("File tunnel task shutting down");
                }
            }
        });

        // Wait for either a shutdown signal or any task to exit
        tokio::select! {
            _ = shutdown_rx.recv() => {
                info!("Shutdown signal received");
            }
            result = join_set.join_next() => {
                match result {
                    Some(Ok(())) => info!("A task exited normally"),
                    Some(Err(e)) => {
                        if e.is_panic() {
                            error!("A task panicked: {}", e);
                        } else {
                            error!("A task was cancelled: {}", e);
                        }
                    }
                    None => info!("All tasks exited"),
                }
            }
        }

        // Explicitly abort all remaining tasks
        join_set.abort_all();

        // Wait for all tasks to finish
        while let Some(result) = join_set.join_next().await {
            if let Err(e) = result {
                if e.is_panic() {
                    error!("Task panicked during shutdown: {}", e);
                }
            }
        }

        // Clean up firewall rules on shutdown.
        info!("Shutting down — cleaning up tracked firewall rules");
        FirewallManager::remove_all_tracked().await;

        Ok(())
    }

    async fn start_health_monitoring(&self, mut shutdown_rx: broadcast::Receiver<()>) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));

        loop {
            tokio::select! {
                _ = interval.tick() => {},
                _ = shutdown_rx.recv() => {
                    info!("Health monitoring shutting down");
                    break;
                }
            }

            // Collect health metrics
            if let Err(err) = self.ws_handler.send_health_report().await {
                warn!("Failed to send health report: {}", err);
            }

            // Collect per-server resource stats
            if let Err(err) = self.ws_handler.send_resource_stats(None).await {
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
    // Do not silently fall back to env if an explicit config file exists but is invalid.
    let config = {
        let explicit = std::path::Path::new(config_path);
        let system = std::path::Path::new("/opt/catalyst-agent/config.toml");

        if explicit.exists() {
            AgentConfig::from_file(config_path).map_err(AgentError::ConfigError)?
        } else if system.exists() {
            AgentConfig::from_file("/opt/catalyst-agent/config.toml")
                .map_err(AgentError::ConfigError)?
        } else {
            AgentConfig::from_env().map_err(AgentError::ConfigError)?
        }
    };

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

    let (shutdown_tx, shutdown_rx) = broadcast::channel(1);

    // Spawn SIGTERM handler
    let shutdown_tx_sigterm = shutdown_tx.clone();
    tokio::spawn(async move {
        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to create SIGTERM handler: {}", e);
                return;
            }
        };
        sigterm.recv().await;
        info!("Received SIGTERM, initiating shutdown");
        let _ = shutdown_tx_sigterm.send(());
    });

    // Spawn SIGINT handler
    let shutdown_tx_sigint = shutdown_tx.clone();
    tokio::spawn(async move {
        if let Err(e) = ctrl_c().await {
            error!("Failed to wait for ctrl-c: {}", e);
            return;
        }
        info!("Received SIGINT, initiating shutdown");
        let _ = shutdown_tx_sigint.send(());
    });

    agent.run(shutdown_rx).await?;

    Ok(())
}
