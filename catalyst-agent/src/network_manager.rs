use std::path::PathBuf;
use tokio::fs;
use tracing::info;

use crate::atomic_write;
use crate::net_utils;
use crate::config::CniNetworkConfig;
use crate::AgentError;
use serde_json::json;
use toml::Value as TomlValue;

/// Network Manager - Handles dynamic network configuration
/// All paths are configurable via the agent config (cni_dir, config_path).
#[derive(Clone)]
pub struct NetworkManager {
    cni_dir: PathBuf,
    config_path: PathBuf,
}

impl NetworkManager {
    /// Create a new NetworkManager with the given CNI directory and config path.
    pub fn new(cni_dir: PathBuf, config_path: PathBuf) -> Self {
        info!(
            "NetworkManager initialized: cni_dir={}, config_path={}",
            cni_dir.display(),
            config_path.display()
        );
        Self {
            cni_dir,
            config_path,
        }
    }

    fn validate_label(name: &str, max_len: usize, context: &str) -> Result<(), AgentError> {
        let name = name.trim();
        if name.is_empty() || name.len() > max_len {
            return Err(AgentError::InvalidRequest(format!(
                "Invalid {}: must be 1-{} characters",
                context, max_len
            )));
        }
        if name.contains('/') || name.contains('\\') {
            return Err(AgentError::InvalidRequest(format!(
                "Invalid {}: must not contain path separators",
                context
            )));
        }
        let mut chars = name.chars();
        let Some(first) = chars.next() else {
            return Err(AgentError::InvalidRequest(format!(
                "Invalid {}: must not be empty",
                context
            )));
        };
        if !first.is_ascii_alphanumeric() {
            return Err(AgentError::InvalidRequest(format!(
                "Invalid {}: must start with an alphanumeric character",
                context
            )));
        }
        if !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err(AgentError::InvalidRequest(format!(
                "Invalid {}: allowed characters are a-z, A-Z, 0-9, '-', '_', '.'",
                context
            )));
        }
        Ok(())
    }

    fn validate_network_name(name: &str) -> Result<(), AgentError> {
        Self::validate_label(name, 63, "network name")
    }

    fn normalize_interface_name(interface: &str) -> String {
        // `ip link` can show stacked interfaces as `eth0@if3`. For config and `ip` commands,
        // we want the actual interface name (`eth0`).
        interface.trim().split('@').next().unwrap_or("").to_string()
    }

    fn validate_interface_name(interface: &str) -> Result<(), AgentError> {
        Self::validate_label(interface, 15, "interface name")
    }

    /// Create a new CNI network configuration
    pub async fn create_network(&self, network: &CniNetworkConfig) -> Result<(), AgentError> {
        Self::validate_network_name(&network.name)?;
        let cni_config_path = self.cni_dir.join(format!("{}.conflist", network.name));

        // Check if network already exists
        if fs::try_exists(&cni_config_path).await.unwrap_or(false) {
            return Err(AgentError::InternalError(format!(
                "Network '{}' already exists",
                network.name
            )));
        }

        // Detect interface if not specified
        let interface = if let Some(ref iface) = network.interface {
            Self::normalize_interface_name(iface)
        } else {
            net_utils::detect_network_interface_async().await?
        };
        Self::validate_interface_name(&interface)?;

        // Detect CIDR if not specified
        let cidr = if let Some(ref cidr) = network.cidr {
            net_utils::normalize_cidr(cidr)?
        } else {
            net_utils::detect_interface_cidr_async(&interface).await?
        };

        // Calculate IP range if not specified
        let (default_start, default_end) = net_utils::cidr_usable_range(&cidr)?;
        let range_start = network.range_start.clone().unwrap_or(default_start);
        let range_end = network.range_end.clone().unwrap_or(default_end);

        // Detect gateway if not specified
        let gateway = if let Some(ref gw) = network.gateway {
            gw.clone()
        } else {
            net_utils::detect_default_gateway_async().await?
        };

        // Validate network configuration
        net_utils::validate_network_config(&cidr, &gateway, &range_start, &range_end)?;

        // Generate CNI configuration
        let cni_config = Self::generate_cni_config(
            &network.name,
            &interface,
            &cidr,
            &range_start,
            &range_end,
            &gateway,
        );

        // Write CNI config file atomically (temp + rename) to prevent
        // corruption if the agent crashes mid-write.
        atomic_write::atomic_write(&cni_config_path, &cni_config).await?;

        info!(
            "✓ Created CNI network '{}' at {}",
            network.name,
            cni_config_path.display()
        );

        // Update config.toml to persist the network
        if let Err(e) = self
            .persist_to_config(
                network,
                &interface,
                &cidr,
                &gateway,
                &range_start,
                &range_end,
            )
            .await
        {
            let _ = fs::remove_file(&cni_config_path).await;
            return Err(e);
        }

        Ok(())
    }

    /// Update an existing CNI network configuration
    pub async fn update_network(
        &self,
        old_name: &str,
        network: &CniNetworkConfig,
    ) -> Result<(), AgentError> {
        Self::validate_network_name(old_name)?;
        Self::validate_network_name(&network.name)?;
        let old_cni_path = self.cni_dir.join(format!("{}.conflist", old_name));

        // Check if old network exists
        if !fs::try_exists(&old_cni_path).await.unwrap_or(false) {
            return Err(AgentError::InternalError(format!(
                "Network '{}' does not exist",
                old_name
            )));
        }

        // If name changed, delete old config
        if old_name != network.name {
            fs::remove_file(&old_cni_path).await.map_err(|e| {
                AgentError::IoError(format!("Failed to remove old CNI config: {}", e))
            })?;
            info!("✓ Removed old CNI network '{}'", old_name);
        }

        // Create new config (will handle rename)
        let cni_config_path = self.cni_dir.join(format!("{}.conflist", network.name));

        // Detect interface if not specified
        let interface = if let Some(ref iface) = network.interface {
            Self::normalize_interface_name(iface)
        } else {
            net_utils::detect_network_interface_async().await?
        };
        Self::validate_interface_name(&interface)?;

        // Detect CIDR if not specified
        let cidr = if let Some(ref cidr) = network.cidr {
            net_utils::normalize_cidr(cidr)?
        } else {
            net_utils::detect_interface_cidr_async(&interface).await?
        };

        // Calculate IP range if not specified
        let (default_start, default_end) = net_utils::cidr_usable_range(&cidr)?;
        let range_start = network.range_start.clone().unwrap_or(default_start);
        let range_end = network.range_end.clone().unwrap_or(default_end);

        // Detect gateway if not specified
        let gateway = if let Some(ref gw) = network.gateway {
            gw.clone()
        } else {
            net_utils::detect_default_gateway_async().await?
        };

        // Validate network configuration
        net_utils::validate_network_config(&cidr, &gateway, &range_start, &range_end)?;

        // Generate CNI configuration
        let cni_config = Self::generate_cni_config(
            &network.name,
            &interface,
            &cidr,
            &range_start,
            &range_end,
            &gateway,
        );

        // Write CNI config file atomically (temp + rename) to prevent
        // corruption if the agent crashes mid-write.
        atomic_write::atomic_write(&cni_config_path, &cni_config).await?;

        info!(
            "✓ Updated CNI network '{}' at {}",
            network.name,
            cni_config_path.display()
        );

        // Update config.toml
        if let Err(e) = self
            .update_config(
                old_name,
                network,
                &interface,
                &cidr,
                &gateway,
                &range_start,
                &range_end,
            )
            .await
        {
            let _ = fs::remove_file(&cni_config_path).await;
            return Err(e);
        }

        Ok(())
    }

    /// Delete a CNI network configuration
    pub async fn delete_network(&self, network_name: &str) -> Result<(), AgentError> {
        Self::validate_network_name(network_name)?;
        let cni_config_path = self.cni_dir.join(format!("{}.conflist", network_name));

        // Check if network exists
        if !fs::try_exists(&cni_config_path).await.unwrap_or(false) {
            return Err(AgentError::InternalError(format!(
                "Network '{}' does not exist",
                network_name
            )));
        }

        // Remove CNI config file
        fs::remove_file(&cni_config_path)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to remove CNI config: {}", e)))?;

        info!("✓ Deleted CNI network '{}'", network_name);

        // Remove from config.toml
        self.remove_from_config(network_name).await?;

        Ok(())
    }

    /// Generate CNI configuration JSON
    fn generate_cni_config(
        name: &str,
        interface: &str,
        cidr: &str,
        range_start: &str,
        range_end: &str,
        gateway: &str,
    ) -> String {
        let route_dst = if cidr.contains(':') {
            "::/0"
        } else {
            "0.0.0.0/0"
        };
        // Build JSON via a serializer to avoid config injection via user-controlled fields.
        let config = json!({
            "cniVersion": "1.0.0",
            "name": name,
            "plugins": [
                {
                    "type": "macvlan",
                    "master": interface,
                    "mode": "bridge",
                    "ipam": {
                        "type": "host-local",
                        "ranges": [[
                            {
                                "subnet": cidr,
                                "rangeStart": range_start,
                                "rangeEnd": range_end,
                                "gateway": gateway,
                            }
                        ]],
                        "routes": [
                            { "dst": route_dst }
                        ],
                    }
                }
            ]
        });

        serde_json::to_string_pretty(&config).unwrap_or_else(|_| "{}".to_string())
    }

    /// Persist network configuration to config.toml
    async fn persist_to_config(
        &self,
        network: &CniNetworkConfig,
        interface: &str,
        cidr: &str,
        gateway: &str,
        range_start: &str,
        range_end: &str,
    ) -> Result<(), AgentError> {
        let mut config = self.load_agent_config_toml().await?;
        let networks = Self::networks_array_mut(&mut config)?;

        // If already present, treat as idempotent.
        if networks.iter().any(|value| {
            value
                .as_table()
                .and_then(|t| t.get("name"))
                .and_then(TomlValue::as_str)
                == Some(network.name.as_str())
        }) {
            info!(
                "✓ Network '{}' already present in {}",
                network.name,
                self.config_path.display()
            );
            return Ok(());
        }

        networks.push(Self::build_network_toml_entry(
            &network.name,
            interface,
            cidr,
            gateway,
            range_start,
            range_end,
        ));

        self.store_agent_config_toml(&config).await?;
        info!(
            "✓ Persisted network '{}' to {}",
            network.name,
            self.config_path.display()
        );
        Ok(())
    }

    /// Update network configuration in config.toml
    #[allow(clippy::too_many_arguments)]
    async fn update_config(
        &self,
        old_name: &str,
        network: &CniNetworkConfig,
        interface: &str,
        cidr: &str,
        gateway: &str,
        range_start: &str,
        range_end: &str,
    ) -> Result<(), AgentError> {
        let mut config = self.load_agent_config_toml().await?;
        let networks = Self::networks_array_mut(&mut config)?;

        let mut updated = false;
        for value in networks.iter_mut() {
            let Some(table) = value.as_table_mut() else {
                continue;
            };
            let Some(existing_name) = table
                .get("name")
                .and_then(TomlValue::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            if existing_name == old_name {
                *value = Self::build_network_toml_entry(
                    &network.name,
                    interface,
                    cidr,
                    gateway,
                    range_start,
                    range_end,
                );
                updated = true;
                break;
            }
        }

        if !updated {
            networks.push(Self::build_network_toml_entry(
                &network.name,
                interface,
                cidr,
                gateway,
                range_start,
                range_end,
            ));
        }

        self.store_agent_config_toml(&config).await?;
        info!(
            "✓ Updated network '{}' in {}",
            network.name,
            self.config_path.display()
        );
        Ok(())
    }

    /// Remove network configuration from config.toml
    async fn remove_from_config(&self, network_name: &str) -> Result<(), AgentError> {
        if !fs::try_exists(&self.config_path).await.unwrap_or(false) {
            return Ok(());
        }

        let mut config = self.load_agent_config_toml().await?;
        let Ok(networks) = Self::networks_array_mut(&mut config) else {
            return Ok(());
        };

        networks.retain(|value| {
            value
                .as_table()
                .and_then(|t| t.get("name"))
                .and_then(TomlValue::as_str)
                != Some(network_name)
        });

        self.store_agent_config_toml(&config).await?;
        info!(
            "✓ Removed network '{}' from {}",
            network_name,
            self.config_path.display()
        );
        Ok(())
    }

    async fn load_agent_config_toml(&self) -> Result<TomlValue, AgentError> {
        if !fs::try_exists(&self.config_path).await.unwrap_or(false) {
            return Ok(TomlValue::Table(toml::value::Table::new()));
        }
        let raw = fs::read_to_string(&self.config_path)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to read config: {}", e)))?;
        toml::from_str::<TomlValue>(&raw)
            .map_err(|e| AgentError::IoError(format!("Failed to parse config TOML: {}", e)))
    }

    async fn store_agent_config_toml(&self, value: &TomlValue) -> Result<(), AgentError> {
        let raw = toml::to_string_pretty(value)
            .map_err(|e| AgentError::IoError(format!("Failed to serialize config TOML: {}", e)))?;
        // Use atomic write (temp + rename) to prevent config corruption
        // if the agent crashes or loses power mid-write.
        atomic_write::atomic_write(&self.config_path, &raw).await
    }

    fn networks_array_mut(value: &mut TomlValue) -> Result<&mut Vec<TomlValue>, AgentError> {
        if !value.is_table() {
            *value = TomlValue::Table(toml::value::Table::new());
        }
        let root = value.as_table_mut().ok_or_else(|| {
            AgentError::IoError("Invalid config TOML: expected table".to_string())
        })?;

        let networking = root
            .entry("networking")
            .or_insert_with(|| TomlValue::Table(toml::value::Table::new()));
        if !networking.is_table() {
            *networking = TomlValue::Table(toml::value::Table::new());
        }
        let networking_table = networking.as_table_mut().ok_or_else(|| {
            AgentError::IoError("Invalid config TOML: networking must be a table".to_string())
        })?;

        let networks = networking_table
            .entry("networks")
            .or_insert_with(|| TomlValue::Array(Vec::new()));
        if !networks.is_array() {
            *networks = TomlValue::Array(Vec::new());
        }
        networks.as_array_mut().ok_or_else(|| {
            AgentError::IoError(
                "Invalid config TOML: networking.networks must be an array".to_string(),
            )
        })
    }

    fn build_network_toml_entry(
        name: &str,
        interface: &str,
        cidr: &str,
        gateway: &str,
        range_start: &str,
        range_end: &str,
    ) -> TomlValue {
        let mut table = toml::value::Table::new();
        table.insert("name".to_string(), TomlValue::String(name.to_string()));
        table.insert(
            "interface".to_string(),
            TomlValue::String(interface.to_string()),
        );
        table.insert("cidr".to_string(), TomlValue::String(cidr.to_string()));
        table.insert(
            "gateway".to_string(),
            TomlValue::String(gateway.to_string()),
        );
        table.insert(
            "range_start".to_string(),
            TomlValue::String(range_start.to_string()),
        );
        table.insert(
            "range_end".to_string(),
            TomlValue::String(range_end.to_string()),
        );
        TomlValue::Table(table)
    }









}
