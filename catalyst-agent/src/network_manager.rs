use std::fs;
use std::path::Path;
use std::process::Command;
use tracing::info;

use crate::config::CniNetworkConfig;
use crate::AgentError;

const CNI_DIR: &str = "/etc/cni/net.d";
const CONFIG_PATH: &str = "/opt/catalyst-agent/config.toml";

/// Network Manager - Handles dynamic network configuration
pub struct NetworkManager;

impl NetworkManager {
    /// Create a new CNI network configuration
    pub fn create_network(
        network: &CniNetworkConfig,
    ) -> Result<(), AgentError> {
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
            iface.clone()
        } else {
            Self::detect_network_interface()?
        };

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

        info!("✓ Created CNI network '{}' at {}", network.name, cni_config_path);

        // Update config.toml to persist the network
        Self::persist_to_config(network, &interface, &cidr, &gateway, &range_start, &range_end)?;

        Ok(())
    }

    /// Update an existing CNI network configuration
    pub fn update_network(
        old_name: &str,
        network: &CniNetworkConfig,
    ) -> Result<(), AgentError> {
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
            fs::remove_file(&old_cni_path)
                .map_err(|e| AgentError::IoError(format!("Failed to remove old CNI config: {}", e)))?;
            info!("✓ Removed old CNI network '{}'", old_name);
        }

        // Create new config (will handle rename)
        let cni_config_path = format!("{}/{}.conflist", CNI_DIR, network.name);

        // Detect interface if not specified
        let interface = if let Some(ref iface) = network.interface {
            iface.clone()
        } else {
            Self::detect_network_interface()?
        };

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

        info!("✓ Updated CNI network '{}' at {}", network.name, cni_config_path);

        // Update config.toml
        Self::update_config(old_name, network, &interface, &cidr, &gateway, &range_start, &range_end)?;

        Ok(())
    }

    /// Delete a CNI network configuration
    pub fn delete_network(network_name: &str) -> Result<(), AgentError> {
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
        format!(
            r#"{{
  "cniVersion": "1.0.0",
  "name": "{}",
  "plugins": [
    {{
      "type": "macvlan",
      "master": "{}",
      "mode": "bridge",
      "ipam": {{
        "type": "host-local",
        "ranges": [[
          {{
            "subnet": "{}",
            "rangeStart": "{}",
            "rangeEnd": "{}",
            "gateway": "{}"
          }}
        ]],
        "routes": [
          {{ "dst": "0.0.0.0/0" }}
        ]
      }}
    }}
  ]
}}"#,
            name, interface, cidr, range_start, range_end, gateway
        )
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
        // Read existing config or create new one
        let mut config = if Path::new(CONFIG_PATH).exists() {
            fs::read_to_string(CONFIG_PATH)
                .map_err(|e| AgentError::IoError(format!("Failed to read config: {}", e)))?
        } else {
            String::new()
        };

        // Check if networking section exists
        if !config.contains("[networking]") {
            config.push_str("\n[networking]\n");
        }

        // Append network configuration
        let network_entry = format!(
            r#"
[[networking.networks]]
name = "{}"
interface = "{}"
cidr = "{}"
gateway = "{}"
range_start = "{}"
range_end = "{}"
"#,
            network.name, interface, cidr, gateway, range_start, range_end
        );

        config.push_str(&network_entry);

        // Write back to config
        fs::write(CONFIG_PATH, config)
            .map_err(|e| AgentError::IoError(format!("Failed to write config: {}", e)))?;

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
        if !Path::new(CONFIG_PATH).exists() {
            return Self::persist_to_config(network, interface, cidr, gateway, range_start, range_end);
        }

        let config = fs::read_to_string(CONFIG_PATH)
            .map_err(|e| AgentError::IoError(format!("Failed to read config: {}", e)))?;

        // Find and replace the network entry
        let lines: Vec<&str> = config.lines().collect();
        let mut result = Vec::new();
        let mut in_network = false;
        let mut skipped = false;

        for i in 0..lines.len() {
            let line = lines[i];

            // Check if this is the network we're updating
            if line.contains(&format!("name = \"{}\"", old_name)) {
                in_network = true;
                skipped = true;
                continue;
            }

            // If we're in the network block, check if we've exited it
            if in_network {
                if line.starts_with("[") || (line.contains("name = \"") && !line.contains(old_name)) {
                    in_network = false;
                    // Add the updated network entry before the next section
                    result.push(format!(
                        "[[networking.networks]]\nname = \"{}\"\ninterface = \"{}\"\ncidr = \"{}\"\ngateway = \"{}\"\nrange_start = \"{}\"\nrange_end = \"{}\"",
                        network.name, interface, cidr, gateway, range_start, range_end
                    ));
                }
                continue;
            }

            result.push(line.to_string());
        }

        // If we updated the last network, append it
        if skipped && !in_network && !result.iter().any(|l| l.contains(&format!("name = \"{}\"", network.name))) {
            result.push(format!(
                "[[networking.networks]]\nname = \"{}\"\ninterface = \"{}\"\ncidr = \"{}\"\ngateway = \"{}\"\nrange_start = \"{}\"\nrange_end = \"{}\"",
                network.name, interface, cidr, gateway, range_start, range_end
            ));
        }

        fs::write(CONFIG_PATH, result.join("\n"))
            .map_err(|e| AgentError::IoError(format!("Failed to write config: {}", e)))?;

        info!("✓ Updated network '{}' in {}", network.name, CONFIG_PATH);

        Ok(())
    }

    /// Remove network configuration from config.toml
    fn remove_from_config(network_name: &str) -> Result<(), AgentError> {
        if !Path::new(CONFIG_PATH).exists() {
            return Ok(());
        }

        let config = fs::read_to_string(CONFIG_PATH)
            .map_err(|e| AgentError::IoError(format!("Failed to read config: {}", e)))?;

        let lines: Vec<&str> = config.lines().collect();
        let mut result = Vec::new();
        let mut in_network = false;

        for line in lines {
            // Check if this is the network we're removing
            if line.contains(&format!("name = \"{}\"", network_name)) {
                in_network = true;
                continue;
            }

            // If we're in the network block, skip until we hit the next section
            if in_network {
                if line.starts_with("[") && !line.contains("networking.networks]") {
                    in_network = false;
                    result.push(line.to_string());
                } else if !line.starts_with("[") && !line.trim().is_empty() && !line.contains("interface")
                    && !line.contains("cidr") && !line.contains("gateway") && !line.contains("range_")
                {
                    in_network = false;
                    result.push(line.to_string());
                }
                continue;
            }

            result.push(line.to_string());
        }

        fs::write(CONFIG_PATH, result.join("\n"))
            .map_err(|e| AgentError::IoError(format!("Failed to write config: {}", e)))?;

        info!("✓ Removed network '{}' from {}", network_name, CONFIG_PATH);

        Ok(())
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
            if !interface.is_empty() {
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
            if !interface.is_empty() {
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
        Ok((format!("{}.{}.10", ip_parts[0], ip_parts[1]), format!("{}.{}.250", ip_parts[0], ip_parts[1])))
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
}
