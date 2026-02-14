use std::fs;
use std::path::Path;
use std::process::Command;
use tracing::{info, warn};

use crate::config::CniNetworkConfig;
use crate::AgentError;
use serde_json::json;
use toml::Value as TomlValue;

const CNI_DIR: &str = "/etc/cni/net.d";
const CONFIG_PATH: &str = "/opt/catalyst-agent/config.toml";

/// Network Manager - Handles dynamic network configuration
pub struct NetworkManager;

impl NetworkManager {
    fn validate_network_name(name: &str) -> Result<(), AgentError> {
        let name = name.trim();
        if name.is_empty() || name.len() > 63 {
            return Err(AgentError::InvalidRequest(
                "Invalid network name: must be 1-63 characters".to_string(),
            ));
        }
        if name.contains('/') || name.contains('\\') {
            return Err(AgentError::InvalidRequest(
                "Invalid network name: must not contain path separators".to_string(),
            ));
        }

        let mut chars = name.chars();
        let Some(first) = chars.next() else {
            return Err(AgentError::InvalidRequest(
                "Invalid network name: must not be empty".to_string(),
            ));
        };
        if !first.is_ascii_alphanumeric() {
            return Err(AgentError::InvalidRequest(
                "Invalid network name: must start with an alphanumeric character".to_string(),
            ));
        }
        if !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err(AgentError::InvalidRequest(
                "Invalid network name: allowed characters are a-z, A-Z, 0-9, '-', '_', '.'"
                    .to_string(),
            ));
        }

        Ok(())
    }

    fn normalize_interface_name(interface: &str) -> String {
        // `ip link` can show stacked interfaces as `eth0@if3`. For config and `ip` commands,
        // we want the actual interface name (`eth0`).
        interface.trim().split('@').next().unwrap_or("").to_string()
    }

    fn validate_interface_name(interface: &str) -> Result<(), AgentError> {
        let interface = interface.trim();
        if interface.is_empty() || interface.len() > 15 {
            return Err(AgentError::InvalidRequest(
                "Invalid interface name: must be 1-15 characters".to_string(),
            ));
        }
        if interface.contains('/') || interface.contains('\\') {
            return Err(AgentError::InvalidRequest(
                "Invalid interface name: must not contain path separators".to_string(),
            ));
        }
        let mut chars = interface.chars();
        let Some(first) = chars.next() else {
            return Err(AgentError::InvalidRequest(
                "Invalid interface name: must not be empty".to_string(),
            ));
        };
        if !first.is_ascii_alphanumeric() {
            return Err(AgentError::InvalidRequest(
                "Invalid interface name: must start with an alphanumeric character".to_string(),
            ));
        }
        if !interface
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err(AgentError::InvalidRequest(
                "Invalid interface name: allowed characters are a-z, A-Z, 0-9, '-', '_', '.'"
                    .to_string(),
            ));
        }
        Ok(())
    }

    /// Create a new CNI network configuration
    pub fn create_network(network: &CniNetworkConfig) -> Result<(), AgentError> {
        Self::validate_network_name(&network.name)?;
        let cni_config_path = format!("{}/{}.conflist", CNI_DIR, network.name);

        // Check if network already exists
        if Path::new(&cni_config_path).exists() {
            return Err(AgentError::InternalError(format!(
                "Network '{}' already exists",
                network.name
            )));
        }

        // Detect interface if not specified
        let interface = if let Some(ref iface) = network.interface {
            Self::normalize_interface_name(iface)
        } else {
            Self::detect_network_interface()?
        };
        Self::validate_interface_name(&interface)?;

        // Detect CIDR if not specified
        let cidr = if let Some(ref cidr) = network.cidr {
            Self::normalize_cidr(cidr)?
        } else {
            Self::detect_interface_cidr(&interface)?
        };

        // Calculate IP range if not specified
        let (default_start, default_end) = Self::cidr_usable_range(&cidr)?;
        let range_start = network.range_start.clone().unwrap_or(default_start);
        let range_end = network.range_end.clone().unwrap_or(default_end);

        // Detect gateway if not specified
        let gateway = if let Some(ref gw) = network.gateway {
            gw.clone()
        } else {
            Self::detect_default_gateway()?
        };

        // Validate network configuration
        Self::validate_network_config(&cidr, &gateway, &range_start, &range_end)?;

        // Generate CNI configuration
        let cni_config = Self::generate_cni_config(
            &network.name,
            &interface,
            &cidr,
            &range_start,
            &range_end,
            &gateway,
        );

        // Write CNI config file
        fs::write(&cni_config_path, cni_config)
            .map_err(|e| AgentError::IoError(format!("Failed to write CNI config: {}", e)))?;

        info!(
            "✓ Created CNI network '{}' at {}",
            network.name, cni_config_path
        );

        // Update config.toml to persist the network
        Self::persist_to_config(
            network,
            &interface,
            &cidr,
            &gateway,
            &range_start,
            &range_end,
        )?;

        Ok(())
    }

    /// Update an existing CNI network configuration
    pub fn update_network(old_name: &str, network: &CniNetworkConfig) -> Result<(), AgentError> {
        Self::validate_network_name(old_name)?;
        Self::validate_network_name(&network.name)?;
        let old_cni_path = format!("{}/{}.conflist", CNI_DIR, old_name);

        // Check if old network exists
        if !Path::new(&old_cni_path).exists() {
            return Err(AgentError::InternalError(format!(
                "Network '{}' does not exist",
                old_name
            )));
        }

        // If name changed, delete old config
        if old_name != network.name {
            fs::remove_file(&old_cni_path).map_err(|e| {
                AgentError::IoError(format!("Failed to remove old CNI config: {}", e))
            })?;
            info!("✓ Removed old CNI network '{}'", old_name);
        }

        // Create new config (will handle rename)
        let cni_config_path = format!("{}/{}.conflist", CNI_DIR, network.name);

        // Detect interface if not specified
        let interface = if let Some(ref iface) = network.interface {
            Self::normalize_interface_name(iface)
        } else {
            Self::detect_network_interface()?
        };
        Self::validate_interface_name(&interface)?;

        // Detect CIDR if not specified
        let cidr = if let Some(ref cidr) = network.cidr {
            Self::normalize_cidr(cidr)?
        } else {
            Self::detect_interface_cidr(&interface)?
        };

        // Calculate IP range if not specified
        let (default_start, default_end) = Self::cidr_usable_range(&cidr)?;
        let range_start = network.range_start.clone().unwrap_or(default_start);
        let range_end = network.range_end.clone().unwrap_or(default_end);

        // Detect gateway if not specified
        let gateway = if let Some(ref gw) = network.gateway {
            gw.clone()
        } else {
            Self::detect_default_gateway()?
        };

        // Validate network configuration
        Self::validate_network_config(&cidr, &gateway, &range_start, &range_end)?;

        // Generate CNI configuration
        let cni_config = Self::generate_cni_config(
            &network.name,
            &interface,
            &cidr,
            &range_start,
            &range_end,
            &gateway,
        );

        // Write CNI config file
        fs::write(&cni_config_path, cni_config)
            .map_err(|e| AgentError::IoError(format!("Failed to write CNI config: {}", e)))?;

        info!(
            "✓ Updated CNI network '{}' at {}",
            network.name, cni_config_path
        );

        // Update config.toml
        Self::update_config(
            old_name,
            network,
            &interface,
            &cidr,
            &gateway,
            &range_start,
            &range_end,
        )?;

        Ok(())
    }

    /// Delete a CNI network configuration
    pub fn delete_network(network_name: &str) -> Result<(), AgentError> {
        Self::validate_network_name(network_name)?;
        let cni_config_path = format!("{}/{}.conflist", CNI_DIR, network_name);

        // Check if network exists
        if !Path::new(&cni_config_path).exists() {
            return Err(AgentError::InternalError(format!(
                "Network '{}' does not exist",
                network_name
            )));
        }

        // Remove CNI config file
        fs::remove_file(&cni_config_path)
            .map_err(|e| AgentError::IoError(format!("Failed to remove CNI config: {}", e)))?;

        info!("✓ Deleted CNI network '{}'", network_name);

        // Remove from config.toml
        Self::remove_from_config(network_name)?;

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
                            { "dst": "0.0.0.0/0" }
                        ],
                    }
                }
            ]
        });

        serde_json::to_string_pretty(&config).unwrap_or_else(|_| "{}".to_string())
    }

    /// Persist network configuration to config.toml
    fn persist_to_config(
        network: &CniNetworkConfig,
        interface: &str,
        cidr: &str,
        gateway: &str,
        range_start: &str,
        range_end: &str,
    ) -> Result<(), AgentError> {
        let mut config = Self::load_agent_config_toml()?;
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
                network.name, CONFIG_PATH
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

        Self::store_agent_config_toml(&config)?;
        info!("✓ Persisted network '{}' to {}", network.name, CONFIG_PATH);
        Ok(())
    }

    /// Update network configuration in config.toml
    fn update_config(
        old_name: &str,
        network: &CniNetworkConfig,
        interface: &str,
        cidr: &str,
        gateway: &str,
        range_start: &str,
        range_end: &str,
    ) -> Result<(), AgentError> {
        let mut config = Self::load_agent_config_toml()?;
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

        Self::store_agent_config_toml(&config)?;
        info!("✓ Updated network '{}' in {}", network.name, CONFIG_PATH);
        Ok(())
    }

    /// Remove network configuration from config.toml
    fn remove_from_config(network_name: &str) -> Result<(), AgentError> {
        if !Path::new(CONFIG_PATH).exists() {
            return Ok(());
        }

        let mut config = Self::load_agent_config_toml()?;
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

        Self::store_agent_config_toml(&config)?;
        info!("✓ Removed network '{}' from {}", network_name, CONFIG_PATH);
        Ok(())
    }

    fn load_agent_config_toml() -> Result<TomlValue, AgentError> {
        if !Path::new(CONFIG_PATH).exists() {
            return Ok(TomlValue::Table(toml::value::Table::new()));
        }
        let raw = fs::read_to_string(CONFIG_PATH)
            .map_err(|e| AgentError::IoError(format!("Failed to read config: {}", e)))?;
        toml::from_str::<TomlValue>(&raw)
            .map_err(|e| AgentError::IoError(format!("Failed to parse config TOML: {}", e)))
    }

    fn store_agent_config_toml(value: &TomlValue) -> Result<(), AgentError> {
        let raw = toml::to_string_pretty(value)
            .map_err(|e| AgentError::IoError(format!("Failed to serialize config TOML: {}", e)))?;
        fs::write(CONFIG_PATH, raw)
            .map_err(|e| AgentError::IoError(format!("Failed to write config: {}", e)))
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

    /// Detect the primary network interface
    fn detect_network_interface() -> Result<String, AgentError> {
        // Try to get default route interface
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect default route: {}", e)))?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split_whitespace();
                    while let Some(part) = parts.next() {
                        if part == "dev" {
                            return parts.next().map(|name| name.to_string());
                        }
                    }
                    None
                })
                .unwrap_or_default();
            let interface = Self::normalize_interface_name(&interface);
            if !interface.is_empty()
                && interface != "lo"
                && Self::validate_interface_name(&interface).is_ok()
            {
                return Ok(interface);
            }
        }

        // Fallback: find first non-loopback interface
        let output = Command::new("ip")
            .args(["-o", "link", "show"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect interfaces: {}", e)))?;

        if output.status.success() {
            let interface = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find_map(|line| {
                    let mut parts = line.split(':');
                    let _idx = parts.next()?;
                    let name = parts.next()?.trim().to_string();
                    if name == "lo" {
                        None
                    } else {
                        Some(name)
                    }
                })
                .unwrap_or_default();
            let interface = Self::normalize_interface_name(&interface);
            if !interface.is_empty()
                && interface != "lo"
                && Self::validate_interface_name(&interface).is_ok()
            {
                return Ok(interface);
            }
        }

        Err(AgentError::InternalError(
            "Could not detect network interface".to_string(),
        ))
    }

    /// Detect interface CIDR
    fn detect_interface_cidr(interface: &str) -> Result<String, AgentError> {
        let output = Command::new("ip")
            .args(["addr", "show", interface])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect interface CIDR: {}", e)))?;

        if !output.status.success() {
            return Err(AgentError::InternalError(
                "Failed to get interface address".to_string(),
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("inet ") && !line.contains("inet6") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(cidr) = parts.get(1) {
                    return Self::normalize_cidr(cidr);
                }
            }
        }

        Err(AgentError::InternalError(
            "Could not detect interface CIDR".to_string(),
        ))
    }

    /// Normalize CIDR to ensure it has a subnet mask
    fn normalize_cidr(cidr: &str) -> Result<String, AgentError> {
        if cidr.contains('/') {
            Ok(cidr.to_string())
        } else {
            Ok(format!("{}/24", cidr))
        }
    }

    /// Calculate usable IP range from CIDR
    fn cidr_usable_range(cidr: &str) -> Result<(String, String), AgentError> {
        let parts: Vec<&str> = cidr.split('/').collect();
        if parts.len() != 2 {
            return Err(AgentError::InternalError("Invalid CIDR format".to_string()));
        }

        let base_ip = parts[0];
        let ip_parts: Vec<&str> = base_ip.split('.').collect();

        if ip_parts.len() != 4 {
            return Err(AgentError::InternalError("Invalid IP address".to_string()));
        }

        let _third_octet = ip_parts[2];
        Ok((
            format!("{}.{}.10", ip_parts[0], ip_parts[1]),
            format!("{}.{}.250", ip_parts[0], ip_parts[1]),
        ))
    }

    /// Detect default gateway
    fn detect_default_gateway() -> Result<String, AgentError> {
        let output = Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .map_err(|e| AgentError::IoError(format!("Failed to detect gateway: {}", e)))?;

        if !output.status.success() {
            return Err(AgentError::InternalError(
                "Failed to detect gateway".to_string(),
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("default") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(idx) = parts.iter().position(|&p| p == "via") {
                    if let Some(gateway) = parts.get(idx + 1) {
                        return Ok(gateway.to_string());
                    }
                }
            }
        }

        Err(AgentError::InternalError(
            "Could not detect default gateway".to_string(),
        ))
    }

    /// Validate network configuration parameters
    fn validate_network_config(
        cidr: &str,
        gateway: &str,
        range_start: &str,
        range_end: &str,
    ) -> Result<(), AgentError> {
        // Parse and validate CIDR
        let cidr_parts: Vec<&str> = cidr.split('/').collect();
        if cidr_parts.len() != 2 {
            return Err(AgentError::InternalError(format!(
                "Invalid CIDR format: '{}'. Expected format: x.x.x.x/yy",
                cidr
            )));
        }

        let base_ip = cidr_parts[0];
        let prefix_len: u8 = cidr_parts[1].parse().map_err(|_| {
            AgentError::InternalError(format!("Invalid CIDR prefix length: '{}'", cidr_parts[1]))
        })?;

        if !(8..=30).contains(&prefix_len) {
            return Err(AgentError::InternalError(format!(
                "Invalid CIDR prefix length: '{}'. Must be between 8 and 30",
                prefix_len
            )));
        }

        // Parse IP addresses for comparison
        let gateway_ip = Self::parse_ipv4(gateway)?;
        let range_start_ip = Self::parse_ipv4(range_start)?;
        let range_end_ip = Self::parse_ipv4(range_end)?;

        // Validate gateway is within the subnet
        if !Self::ip_in_subnet(gateway, base_ip, prefix_len) {
            return Err(AgentError::InternalError(format!(
                "Gateway '{}' is not within the subnet '{}/{}'",
                gateway, base_ip, prefix_len
            )));
        }

        // Validate range start is within the subnet
        if !Self::ip_in_subnet(range_start, base_ip, prefix_len) {
            return Err(AgentError::InternalError(format!(
                "Range start '{}' is not within the subnet '{}/{}'",
                range_start, base_ip, prefix_len
            )));
        }

        // Validate range end is within the subnet
        if !Self::ip_in_subnet(range_end, base_ip, prefix_len) {
            return Err(AgentError::InternalError(format!(
                "Range end '{}' is not within the subnet '{}/{}'",
                range_end, base_ip, prefix_len
            )));
        }

        // Validate range start < range end
        if range_start_ip >= range_end_ip {
            return Err(AgentError::InternalError(format!(
                "Range start '{}' must be less than range end '{}'",
                range_start, range_end
            )));
        }

        // Validate gateway is not in the allocation range
        if gateway_ip >= range_start_ip && gateway_ip <= range_end_ip {
            warn!(
                "Gateway '{}' is within the allocation range {}-{}. This may cause issues.",
                gateway, range_start, range_end
            );
        }

        // Warn if range is too small
        let range_size = range_end_ip.saturating_sub(range_start_ip);
        if range_size < 10 {
            warn!(
                "IP range {}-{} is very small ({} addresses). Consider using a larger range.",
                range_start,
                range_end,
                range_size + 1
            );
        }

        Ok(())
    }

    /// Parse IPv4 address to u32 for comparison
    fn parse_ipv4(ip: &str) -> Result<u32, AgentError> {
        let parts: Vec<&str> = ip.split('.').collect();
        if parts.len() != 4 {
            return Err(AgentError::InternalError(format!(
                "Invalid IP address: '{}'",
                ip
            )));
        }

        let mut result: u32 = 0;
        for (i, part) in parts.iter().enumerate() {
            let octet: u8 = part.parse().map_err(|_| {
                AgentError::InternalError(format!("Invalid IP address octet: '{}'", part))
            })?;
            result |= (octet as u32) << (24 - i * 8);
        }

        Ok(result)
    }

    /// Check if an IP address is within a subnet
    fn ip_in_subnet(ip: &str, network: &str, prefix_len: u8) -> bool {
        let ip_parsed = Self::parse_ipv4(ip);
        let network_parsed = Self::parse_ipv4(network);

        match (ip_parsed, network_parsed) {
            (Ok(ip_val), Ok(net_val)) => {
                let mask = if prefix_len == 0 {
                    0
                } else {
                    0xFFFFFFFFu32 << (32 - prefix_len)
                };
                (ip_val & mask) == (net_val & mask)
            }
            _ => false,
        }
    }
}
