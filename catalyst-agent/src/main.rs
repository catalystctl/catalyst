use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use std::sync::Arc;
use tokio::signal::ctrl_c;
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinSet;
use tracing::{error, info, warn};

mod atomic_write;
mod backup_crypto;
mod command_utils;
mod config;
mod error_reporter;
mod errors;
mod file_manager;
mod file_tunnel;
mod firewall_manager;
mod net_utils;
mod network_manager;
mod runtime_manager;
mod sftp_server;
mod shell_utils;
mod storage_manager;
mod system_setup;
mod updater;
mod websocket_handler;

pub use config::AgentConfig;
pub use errors::{AgentError, AgentResult};
pub use file_manager::FileManager;
pub use file_tunnel::FileTunnelClient;
pub use firewall_manager::FirewallManager;
pub use network_manager::NetworkManager;
pub use runtime_manager::{ContainerdRuntime, ContainerdRuntimeConfig};
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
        info!("Initializing Catalyst Agent v{}", env!("CARGO_PKG_VERSION"));

        let config = Arc::new(config);
        let runtime_config = ContainerdRuntimeConfig {
            socket_path: config.containerd.socket_path.clone(),
            namespace: config.containerd.namespace.clone(),
            dns_servers: config.networking.dns_servers.clone(),
            console_log_dir: config.server.console_log_dir.clone(),
            cni_results_dir: config.containerd.cni_results_dir.clone(),
            cni_data_dir: config.containerd.cni_data_dir.clone(),
            cni_dir: config.containerd.cni_dir.clone(),
            cni_bin_dir: config.containerd.cni_bin_dir.clone(),
            cni_bridge_name: config.containerd.cni_bridge_name.clone(),
            cni_bridge_subnet: config.containerd.cni_bridge_subnet.clone(),
        };
        let runtime = Arc::new(ContainerdRuntime::new(runtime_config).await?);

        // Initialize firewall manager — loads persisted rule state from disk
        // so rules can be cleaned up even after agent restart.
        FirewallManager::init(&config.server.data_dir);

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
                        agent.ws_handler.report_error(
                            crate::error_reporter::ErrorLevel::Critical,
                            "agent:bootstrap",
                            &format!("WebSocket connection failed: {}", e),
                            None,
                            None,
                        ).await;
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

        // Start SFTP server (SSH-based file access on this node)
        let sftp_config = sftp_server::SftpConfig::from_agent_config(&self.config);
        let sftp_file_manager = self.file_manager.clone();
        let sftp_ws_handler = self.ws_handler.clone();
        let mut sftp_shutdown = shutdown_rx.resubscribe();
        join_set.spawn(async move {
            let sftp_port = sftp_config.port;
            let sftp_enabled = sftp_config.enabled;
            tokio::select! {
                result = sftp_server::start_sftp_server(sftp_config, sftp_file_manager) => {
                    if let Err(e) = result {
                        error!("SFTP server error: {}", e);
                        sftp_ws_handler.report_error(
                            crate::error_reporter::ErrorLevel::Error,
                            "agent:sftp_server",
                            &e.to_string(),
                            None,
                            None,
                        ).await;
                    }
                },
                _ = sftp_shutdown.recv() => {
                    info!("SFTP server task shutting down");
                }
            }
            if sftp_enabled {
                info!("SFTP server stopped (port {})", sftp_port);
            }
        });

        // Wait for either a shutdown signal or any task to exit
        let error_reporter_agent = self.clone_refs();
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
                        // Best-effort: try to report to backend before shutdown
                        error_reporter_agent.ws_handler.report_error(
                            crate::error_reporter::ErrorLevel::Error,
                            "agent:task_panic",
                            &e.to_string(),
                            None,
                            None,
                        ).await;
                    }
                    None => info!("All tasks exited"),
                }
            }
        }

        // Best-effort WebSocket close before aborting tasks so the backend
        // sees a clean disconnect instead of a dropped TCP connection.
        self.ws_handler.graceful_ws_close().await;

        // Explicitly abort all remaining tasks
        join_set.abort_all();

        // Wait for all tasks to finish (short bounded wait so shutdown can't hang)
        let shutdown_deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        while let Some(result) = join_set.join_next().await {
            if let Err(e) = result {
                if e.is_panic() {
                    error!("Task panicked during shutdown: {}", e);
                }
            }
            if tokio::time::Instant::now() >= shutdown_deadline {
                warn!("Shutdown wait timed out; remaining tasks will be dropped");
                break;
            }
        }

        // Kill ctr events subprocess if still running.
        if let Some(ctr_pid) = *self.ws_handler.ctr_event_pid.lock().await {
            info!("Killing ctr events subprocess (PID {})", ctr_pid);
            let _ = kill(Pid::from_raw(ctr_pid as i32), Signal::SIGKILL);
        }

        // Do NOT tear down firewall rules for still-running containers on
        // graceful agent shutdown (SIGTERM/restart). Containers may keep
        // running under containerd; removing host firewall/NAT would cut
        // player traffic. Full uninstall paths can call remove_all_tracked.
        match self.runtime.list_containers().await {
            Ok(containers) if containers.iter().any(|c| c.managed) => {
                info!(
                    "Shutting down with managed containers still present — preserving firewall rules"
                );
            }
            Ok(_) => {
                info!("Shutting down with no managed containers — skipping firewall teardown");
            }
            Err(e) => {
                warn!(
                    "Could not list containers during shutdown ({}); leaving firewall rules in place",
                    e
                );
            }
        }

        Ok(())
    }

    async fn start_health_monitoring(&self, mut shutdown_rx: broadcast::Receiver<()>) {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));

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
    // Install the rustls crypto provider before any TLS connection is made.
    // Both tokio-tungstenite and reqwest pull in rustls, and with multiple
    // backends available (ring + aws-lc-rs), rustls cannot auto-select one.
    // We choose ring for consistency with the WebSocket handler.
    if let Err(e) = rustls::crypto::ring::default_provider().install_default() {
        warn!("rustls crypto provider already installed: {:?}", e);
    }

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
    // Resolution order:
    //   1. Explicit --config path
    //   2. CATALYST_CONFIG_PATH env var
    //   3. ./config.toml (cwd)
    //   4. /opt/catalyst-agent/config.toml (system default)
    //   5. Pure env-var config (no file)
    let config = {
        let explicit = std::path::Path::new(config_path);
        let env_config = std::env::var("CATALYST_CONFIG_PATH").ok();
        let system = std::path::Path::new("/opt/catalyst-agent/config.toml");

        if explicit.exists() {
            info!("Loading config from explicit path: {}", config_path);
            let mut c = AgentConfig::from_file(config_path).map_err(AgentError::ConfigError)?;
            // Store the resolved path so NetworkManager can persist to it
            c.agent.config_path = std::path::PathBuf::from(config_path);
            c
        } else if let Some(ref env_path) = env_config {
            if std::path::Path::new(env_path).exists() {
                info!("Loading config from CATALYST_CONFIG_PATH: {}", env_path);
                let mut c = AgentConfig::from_file(env_path).map_err(AgentError::ConfigError)?;
                c.agent.config_path = std::path::PathBuf::from(env_path);
                c
            } else {
                AgentConfig::from_env().map_err(AgentError::ConfigError)?
            }
        } else if system.exists() {
            info!("Loading config from system default: /opt/catalyst-agent/config.toml");
            let mut c = AgentConfig::from_file("/opt/catalyst-agent/config.toml")
                .map_err(AgentError::ConfigError)?;
            c.agent.config_path = std::path::PathBuf::from("/opt/catalyst-agent/config.toml");
            c
        } else {
            AgentConfig::from_env().map_err(AgentError::ConfigError)?
        }
    };

    let filter = format!(
        "catalyst_agent={},russh_sftp=debug,russh=debug,tokio=info",
        config.logging.level
    );

    if config.logging.format == "json" {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    info!("Catalyst Agent v{} starting", env!("CARGO_PKG_VERSION"));
    info!("Configuration loaded: {:?}", config);

    // Run system initialization
    info!("Running system setup and dependency check...");
    if let Err(e) = SystemSetup::initialize(&config).await {
        warn!("System setup encountered issues: {}", e);
        warn!("Continuing with existing configuration...");
        // Report via global tracing; actual WS reporting will happen once connected
    }

    // Create and run agent
    let agent = CatalystAgent::new(config).await?;

    let (shutdown_tx, shutdown_rx) = broadcast::channel(1);

    // Inject the shutdown sender into the WS handler so the restart_agent
    // command can trigger a graceful shutdown.
    agent.ws_handler.set_shutdown_tx(shutdown_tx.clone()).await;

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
