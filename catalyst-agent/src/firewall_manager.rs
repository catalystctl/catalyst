use crate::errors::{AgentError, AgentResult};
use std::process::Command;
use tracing::{info, warn};

/// Firewall manager for automatically configuring firewall rules
pub struct FirewallManager;

#[derive(Debug, PartialEq)]
pub enum FirewallType {
    Ufw,
    Iptables,
    Firewalld,
    None,
}

impl FirewallManager {
    /// Detect which firewall is active on the system
    pub fn detect_firewall() -> FirewallType {
        // Check for UFW first (most common on Ubuntu/Debian)
        if let Ok(output) = Command::new("ufw").arg("status").output() {
            let status = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && status.contains("Status: active") {
                info!("Detected active UFW firewall");
                return FirewallType::Ufw;
            }
        }

        // Check for firewalld (common on RHEL/CentOS/Fedora)
        if let Ok(output) = Command::new("firewall-cmd").arg("--state").output() {
            let status = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && status.contains("running") {
                info!("Detected active firewalld");
                return FirewallType::Firewalld;
            }
        }

        // Check for iptables (fallback, always present on Linux)
        if Command::new("iptables")
            .arg("-L")
            .arg("-n")
            .output()
            .is_ok()
        {
            info!("Using iptables for firewall management");
            return FirewallType::Iptables;
        }

        warn!("No firewall detected or iptables not available");
        FirewallType::None
    }

    /// Allow a port through the detected firewall
    pub async fn allow_port(port: u16, container_ip: &str) -> AgentResult<()> {
        Self::validate_container_ip(container_ip)?;
        let firewall_type = Self::detect_firewall();

        match firewall_type {
            FirewallType::Ufw => Self::allow_port_ufw(port).await,
            FirewallType::Firewalld => Self::allow_port_firewalld(port).await,
            FirewallType::Iptables => Self::allow_port_iptables(port, container_ip).await,
            FirewallType::None => {
                warn!("No firewall detected, skipping port configuration");
                Ok(())
            }
        }
    }

    /// Remove port rules from the detected firewall
    pub async fn remove_port(port: u16, container_ip: &str) -> AgentResult<()> {
        Self::validate_container_ip(container_ip)?;
        let firewall_type = Self::detect_firewall();

        match firewall_type {
            FirewallType::Ufw => Self::remove_port_ufw(port).await,
            FirewallType::Firewalld => Self::remove_port_firewalld(port).await,
            FirewallType::Iptables => Self::remove_port_iptables(port, container_ip).await,
            FirewallType::None => Ok(()),
        }
    }

    /// Configure UFW to allow a port
    async fn allow_port_ufw(port: u16) -> AgentResult<()> {
        info!("Configuring UFW to allow port {}", port);

        // Allow the port through UFW
        let output = Command::new("ufw")
            .arg("allow")
            .arg(port.to_string())
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run ufw: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::FirewallError(format!("UFW failed: {}", stderr)));
        }

        // Reload UFW to apply changes
        let reload = Command::new("ufw")
            .arg("reload")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to reload ufw: {}", e)))?;
        if !reload.status.success() {
            let stderr = String::from_utf8_lossy(&reload.stderr);
            return Err(AgentError::FirewallError(format!(
                "UFW reload failed: {}",
                stderr
            )));
        }

        info!("✓ UFW configured to allow port {}", port);
        Ok(())
    }

    /// Remove UFW rule for a port
    async fn remove_port_ufw(port: u16) -> AgentResult<()> {
        info!("Removing UFW rule for port {}", port);

        let output = Command::new("ufw")
            .arg("delete")
            .arg("allow")
            .arg(port.to_string())
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run ufw: {}", e)))?;

        if !output.status.success() {
            warn!(
                "Failed to remove UFW rule for port {} (may not exist)",
                port
            );
        }

        Ok(())
    }

    /// Configure firewalld to allow a port
    async fn allow_port_firewalld(port: u16) -> AgentResult<()> {
        info!("Configuring firewalld to allow port {}", port);

        // Add permanent rule
        let output = Command::new("firewall-cmd")
            .arg("--permanent")
            .arg("--add-port")
            .arg(format!("{}/tcp", port))
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run firewall-cmd: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::FirewallError(format!(
                "firewalld failed: {}",
                stderr
            )));
        }

        // Reload firewalld
        let reload = Command::new("firewall-cmd")
            .arg("--reload")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to reload firewalld: {}", e)))?;
        if !reload.status.success() {
            let stderr = String::from_utf8_lossy(&reload.stderr);
            return Err(AgentError::FirewallError(format!(
                "firewalld reload failed: {}",
                stderr
            )));
        }

        info!("✓ firewalld configured to allow port {}", port);
        Ok(())
    }

    /// Remove firewalld rule for a port
    async fn remove_port_firewalld(port: u16) -> AgentResult<()> {
        info!("Removing firewalld rule for port {}", port);

        let output = Command::new("firewall-cmd")
            .arg("--permanent")
            .arg("--remove-port")
            .arg(format!("{}/tcp", port))
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run firewall-cmd: {}", e)))?;

        if !output.status.success() {
            warn!(
                "Failed to remove firewalld rule for port {} (may not exist)",
                port
            );
        }

        let reload = Command::new("firewall-cmd")
            .arg("--reload")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to reload firewalld: {}", e)))?;
        if !reload.status.success() {
            let stderr = String::from_utf8_lossy(&reload.stderr);
            return Err(AgentError::FirewallError(format!(
                "firewalld reload failed: {}",
                stderr
            )));
        }

        Ok(())
    }

    /// Configure iptables to allow a port (with container FORWARD rules)
    async fn allow_port_iptables(port: u16, container_ip: &str) -> AgentResult<()> {
        info!(
            "Configuring iptables to allow port {} for container {}",
            port, container_ip
        );

        // Add INPUT rule for the port
        let output = Command::new("iptables")
            .arg("-I")
            .arg("INPUT")
            .arg("-p")
            .arg("tcp")
            .arg("--dport")
            .arg(port.to_string())
            .arg("-j")
            .arg("ACCEPT")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run iptables: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("iptables INPUT rule may already exist: {}", stderr);
        }

        // Add FORWARD rule for incoming traffic to container
        let output = Command::new("iptables")
            .arg("-I")
            .arg("FORWARD")
            .arg("-p")
            .arg("tcp")
            .arg("--dport")
            .arg(port.to_string())
            .arg("-d")
            .arg(container_ip)
            .arg("-j")
            .arg("ACCEPT")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run iptables: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("iptables FORWARD rule may already exist: {}", stderr);
        }

        // Add FORWARD rule for outgoing traffic from container
        let output = Command::new("iptables")
            .arg("-I")
            .arg("FORWARD")
            .arg("-p")
            .arg("tcp")
            .arg("--sport")
            .arg(port.to_string())
            .arg("-s")
            .arg(container_ip)
            .arg("-j")
            .arg("ACCEPT")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run iptables: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("iptables FORWARD rule may already exist: {}", stderr);
        }

        info!(
            "✓ iptables configured to allow port {} with container forwarding",
            port
        );
        Ok(())
    }

    /// Remove iptables rules for a port
    async fn remove_port_iptables(port: u16, container_ip: &str) -> AgentResult<()> {
        info!(
            "Removing iptables rules for port {} and container {}",
            port, container_ip
        );

        // Remove INPUT rule
        let output = Command::new("iptables")
            .arg("-D")
            .arg("INPUT")
            .arg("-p")
            .arg("tcp")
            .arg("--dport")
            .arg(port.to_string())
            .arg("-j")
            .arg("ACCEPT")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run iptables: {}", e)))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("iptables INPUT rule removal failed: {}", stderr);
        }

        // Remove FORWARD rules
        let output = Command::new("iptables")
            .arg("-D")
            .arg("FORWARD")
            .arg("-p")
            .arg("tcp")
            .arg("--dport")
            .arg(port.to_string())
            .arg("-d")
            .arg(container_ip)
            .arg("-j")
            .arg("ACCEPT")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run iptables: {}", e)))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("iptables FORWARD rule removal failed: {}", stderr);
        }

        let output = Command::new("iptables")
            .arg("-D")
            .arg("FORWARD")
            .arg("-p")
            .arg("tcp")
            .arg("--sport")
            .arg(port.to_string())
            .arg("-s")
            .arg(container_ip)
            .arg("-j")
            .arg("ACCEPT")
            .output()
            .map_err(|e| AgentError::FirewallError(format!("Failed to run iptables: {}", e)))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!("iptables FORWARD rule removal failed: {}", stderr);
        }

        Ok(())
    }

    fn validate_container_ip(container_ip: &str) -> AgentResult<()> {
        container_ip
            .parse::<std::net::Ipv4Addr>()
            .map_err(|_| AgentError::InvalidRequest("Invalid container IP".to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_firewall() {
        let firewall = FirewallManager::detect_firewall();
        // Should detect at least one firewall type or None
        assert!(matches!(
            firewall,
            FirewallType::Ufw
                | FirewallType::Iptables
                | FirewallType::Firewalld
                | FirewallType::None
        ));
    }
}
