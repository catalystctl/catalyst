//! Shared network detection and IP utility functions.
//!
//! Consolidates network interface detection, CIDR normalization, IP validation,
//! and install URL security checks that were previously duplicated between
//! `network_manager.rs`, `system_setup.rs`, and `file_tunnel.rs`.

use crate::AgentError;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use tracing::warn;

// ---------------------------------------------------------------------------
// Network interface detection (sync variants for system_setup)
// ---------------------------------------------------------------------------

/// Detect the primary network interface (sync version using `std::process::Command`).
pub fn detect_network_interface_sync() -> Result<String, AgentError> {
    // Try to get default route interface
    let output = std::process::Command::new("ip")
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
        if !interface.is_empty() && interface != "lo" {
            return Ok(interface);
        }
    }

    // Fallback: find first non-loopback interface
    let output = std::process::Command::new("ip")
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
        if !interface.is_empty() && interface != "lo" {
            return Ok(interface);
        }
    }

    Err(AgentError::InternalError(
        "Could not detect network interface".to_string(),
    ))
}

/// Detect default gateway (sync version).
pub fn detect_default_gateway_sync() -> Result<String, AgentError> {
    let output = std::process::Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .map_err(|e| AgentError::IoError(format!("Failed to detect default gateway: {}", e)))?;

    if output.status.success() {
        let gateway = String::from_utf8_lossy(&output.stdout)
            .lines()
            .find_map(|line| {
                let mut parts = line.split_whitespace();
                while let Some(part) = parts.next() {
                    if part == "via" {
                        return parts.next().map(|value| value.to_string());
                    }
                }
                None
            })
            .unwrap_or_default();
        if !gateway.is_empty() {
            return Ok(gateway);
        }
    }

    Err(AgentError::InternalError(
        "Could not detect default gateway".to_string(),
    ))
}

/// Detect interface CIDR (sync version, IPv4 only).
pub fn detect_interface_cidr_sync(interface: &str) -> Result<String, AgentError> {
    let output = std::process::Command::new("ip")
        .args(["-4", "addr", "show", "dev", interface])
        .output()
        .map_err(|e| AgentError::IoError(format!("Failed to detect interface CIDR: {}", e)))?;

    if output.status.success() {
        let cidr = String::from_utf8_lossy(&output.stdout)
            .lines()
            .find_map(|line| {
                let mut parts = line.split_whitespace();
                while let Some(part) = parts.next() {
                    if part == "inet" {
                        return parts.next().map(|value| value.to_string());
                    }
                }
                None
            })
            .unwrap_or_default();
        if !cidr.is_empty() {
            return normalize_cidr_ipv4(&cidr);
        }
    }

    Err(AgentError::InternalError(
        "Could not detect interface CIDR".to_string(),
    ))
}

// ---------------------------------------------------------------------------
// Network interface detection (async variants for network_manager)
// ---------------------------------------------------------------------------

/// Detect the primary network interface (async version using `tokio::process::Command`).
pub async fn detect_network_interface_async() -> Result<String, AgentError> {
    let output = tokio::process::Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .await
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
        if !interface.is_empty() && interface != "lo" {
            return Ok(interface);
        }
    }

    let output = tokio::process::Command::new("ip")
        .args(["-o", "link", "show"])
        .output()
        .await
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
        if !interface.is_empty() && interface != "lo" {
            return Ok(interface);
        }
    }

    Err(AgentError::InternalError(
        "Could not detect network interface".to_string(),
    ))
}

/// Detect default gateway (async version).
pub async fn detect_default_gateway_async() -> Result<String, AgentError> {
    let output = tokio::process::Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .await
        .map_err(|e| AgentError::IoError(format!("Failed to detect default gateway: {}", e)))?;

    if output.status.success() {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if line.contains("default") {
                let mut parts = line.split_whitespace();
                while let Some(part) = parts.next() {
                    if part == "via" {
                        if let Some(gateway) = parts.next() {
                            return Ok(gateway.to_string());
                        }
                    }
                }
            }
        }
    }

    Err(AgentError::InternalError(
        "Could not detect default gateway".to_string(),
    ))
}

/// Detect interface CIDR (async version, supports both IPv4 and IPv6).
pub async fn detect_interface_cidr_async(interface: &str) -> Result<String, AgentError> {
    let output = tokio::process::Command::new("ip")
        .args(["addr", "show", interface])
        .output()
        .await
        .map_err(|e| AgentError::IoError(format!("Failed to get interface address: {}", e)))?;

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
                return normalize_cidr(cidr);
            }
        }
        if line.contains("inet6 ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(cidr) = parts.get(1) {
                return normalize_cidr(cidr);
            }
        }
    }

    Err(AgentError::InternalError(
        "Could not detect interface CIDR".to_string(),
    ))
}

// ---------------------------------------------------------------------------
// CIDR normalization & range calculation
// ---------------------------------------------------------------------------

/// Normalize CIDR to ensure it has a subnet mask (supports both IPv4 and IPv6).
pub fn normalize_cidr(cidr: &str) -> Result<String, AgentError> {
    if cidr.contains('/') {
        Ok(cidr.to_string())
    } else if cidr.contains(':') {
        Ok(format!("{}/64", cidr))
    } else {
        Ok(format!("{}/24", cidr))
    }
}

/// Normalize an IPv4 CIDR: compute the network address and return the canonical form.
/// E.g. "10.42.1.100/16" → "10.42.0.0/16"
pub fn normalize_cidr_ipv4(cidr: &str) -> Result<String, AgentError> {
    let (addr_str, prefix_str) = cidr
        .split_once('/')
        .ok_or_else(|| AgentError::InvalidRequest("Invalid CIDR format".to_string()))?;
    let prefix: u32 = prefix_str
        .parse()
        .map_err(|_| AgentError::InvalidRequest("Invalid CIDR prefix".to_string()))?;
    if prefix > 32 {
        return Err(AgentError::InvalidRequest(
            "Invalid CIDR prefix".to_string(),
        ));
    }

    let addr: Ipv4Addr = addr_str
        .parse()
        .map_err(|_| AgentError::InvalidRequest("Invalid CIDR address".to_string()))?;
    let addr_u32 = u32::from(addr);
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    let network = addr_u32 & mask;
    Ok(format!("{}/{}", Ipv4Addr::from(network), prefix))
}

/// Calculate usable IP range from CIDR (supports both IPv4 and IPv6).
pub fn cidr_usable_range(cidr: &str) -> Result<(String, String), AgentError> {
    let (addr, prefix) = cidr
        .split_once('/')
        .ok_or_else(|| AgentError::InternalError("Invalid CIDR format".to_string()))?;
    let prefix: u8 = prefix
        .parse()
        .map_err(|_| AgentError::InternalError(format!("Invalid CIDR prefix: '{}'", prefix)))?;

    if cidr.contains(':') {
        // IPv6
        if prefix > 128 {
            return Err(AgentError::InternalError(
                "Invalid IPv6 CIDR prefix".to_string(),
            ));
        }
        let addr_u128 = u128::from(addr.parse::<Ipv6Addr>().map_err(|e| {
            AgentError::InternalError(format!("Invalid IPv6 address in CIDR: {}", e))
        })?);
        let mask = if prefix == 0 {
            0u128
        } else {
            u128::MAX << (128 - prefix)
        };
        let network = addr_u128 & mask;
        let broadcast = network | (!mask);

        if broadcast <= network + 1 {
            return Err(AgentError::InternalError(
                "Subnet too small for usable range".to_string(),
            ));
        }

        let start = network + 1;
        let end = broadcast - 1;
        let (start, end) = if prefix < 64 {
            let default_start = network + 10;
            let default_end = broadcast - 5;
            (default_start.max(start), default_end.min(end))
        } else {
            (start, end)
        };

        Ok((
            Ipv6Addr::from(start).to_string(),
            Ipv6Addr::from(end).to_string(),
        ))
    } else {
        // IPv4
        if prefix > 32 {
            return Err(AgentError::InternalError(
                "Invalid IPv4 CIDR prefix".to_string(),
            ));
        }
        let addr_u32 = u32::from(addr.parse::<Ipv4Addr>().map_err(|e| {
            AgentError::InternalError(format!("Invalid IP address in CIDR: {}", e))
        })?);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        let broadcast = network | (!mask);

        if broadcast <= network + 1 {
            return Err(AgentError::InternalError(
                "Subnet too small for usable range".to_string(),
            ));
        }

        let start = network + 1;
        let end = broadcast - 1;
        let (start, end) = if prefix < 24 {
            let default_start = network + 10;
            let default_end = broadcast - 5;
            (default_start.max(start), default_end.min(end))
        } else {
            (start, end)
        };

        Ok((
            Ipv4Addr::from(start).to_string(),
            Ipv4Addr::from(end).to_string(),
        ))
    }
}

/// IPv4-only CIDR usable range (simple version without default_start/default_end clamping).
pub fn cidr_usable_range_ipv4(cidr: &str) -> Result<(String, String), AgentError> {
    let (addr_str, prefix_str) = cidr
        .split_once('/')
        .ok_or_else(|| AgentError::InvalidRequest("Invalid CIDR format".to_string()))?;
    let prefix: u32 = prefix_str
        .parse()
        .map_err(|_| AgentError::InvalidRequest("Invalid CIDR prefix".to_string()))?;
    if prefix > 32 {
        return Err(AgentError::InvalidRequest(
            "Invalid CIDR prefix".to_string(),
        ));
    }

    let addr: Ipv4Addr = addr_str
        .parse()
        .map_err(|_| AgentError::InvalidRequest("Invalid CIDR address".to_string()))?;
    let addr_u32 = u32::from(addr);
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    let network = addr_u32 & mask;
    let broadcast = network | (!mask);

    if broadcast <= network + 1 {
        return Err(AgentError::InvalidRequest(
            "CIDR has no usable addresses".to_string(),
        ));
    }

    let start = network + 1;
    let end = broadcast - 1;
    Ok((
        Ipv4Addr::from(start).to_string(),
        Ipv4Addr::from(end).to_string(),
    ))
}

// ---------------------------------------------------------------------------
// IP utilities
// ---------------------------------------------------------------------------

/// Parse an IP address string into `IpAddr`.
pub fn parse_ip(ip: &str) -> Result<IpAddr, AgentError> {
    ip.parse::<IpAddr>()
        .map_err(|_| AgentError::InternalError(format!("Invalid IP address: '{}'", ip)))
}

/// Convert an IP address string to a u128 (IPv4 is zero-extended).
pub fn ip_to_u128(ip: &str) -> Result<u128, AgentError> {
    match parse_ip(ip)? {
        IpAddr::V4(a) => Ok(u32::from(a) as u128),
        IpAddr::V6(a) => Ok(u128::from(a)),
    }
}

/// Check whether an IP address falls within a given subnet.
pub fn ip_in_subnet(ip: &str, network: &str, prefix_len: u8) -> bool {
    let ip_val = match ip_to_u128(ip) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let net_val = match ip_to_u128(network) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let is_v6 = network.contains(':');
    let mask = if is_v6 {
        if prefix_len == 0 {
            0u128
        } else {
            u128::MAX << (128 - prefix_len)
        }
    } else {
        let prefix_len = prefix_len.min(32);
        if prefix_len == 0 {
            0u128
        } else {
            (u128::MAX << (32 - prefix_len)) & 0xFFFFFFFF
        }
    };
    (ip_val & mask) == (net_val & mask)
}

// ---------------------------------------------------------------------------
// Install URL security (from file_tunnel.rs)
// ---------------------------------------------------------------------------

/// Check if an IPv6 address is a deprecated site-local address (fec0::/10).
pub fn is_ipv6_site_local(v6: &Ipv6Addr) -> bool {
    let seg0 = v6.segments()[0];
    (seg0 & 0xffc0) == 0xfec0
}

/// Check if an IP address is a private/link-local/loopback address that should
/// not be used as an install script download source (SSRF protection).
pub fn is_forbidden_install_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_broadcast()
            {
                return true;
            }
            // CGNAT 100.64.0.0/10
            let [a, b, ..] = v4.octets();
            a == 100 && (64..=127).contains(&b)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4() {
                return is_forbidden_install_ip(IpAddr::V4(v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unicast_link_local()
                || v6.is_unique_local()
                || is_ipv6_site_local(&v6)
        }
    }
}

/// Validate that an install URL does not point to a private/link-local/loopback address.
pub async fn validate_install_url(url: &reqwest::Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Unsupported URL scheme '{}'", other)),
    }

    if url.username() != "" || url.password().is_some() {
        return Err("install-url cannot include embedded credentials".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "URL is missing a host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL is missing a port".to_string())?;

    // If the host is already an IP literal, validate directly.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_forbidden_install_ip(ip) {
            return Err("Refusing to download from a private/link-local/loopback IP".to_string());
        }
        return Ok(());
    }

    // Resolve host to IPs and block any private/link-local/loopback ranges.
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("DNS lookup failed for '{}': {}", host, e))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("DNS lookup returned no addresses for '{}'", host));
    }
    for addr in addrs {
        if is_forbidden_install_ip(addr.ip()) {
            return Err("Refusing to download from a private/link-local/loopback IP".to_string());
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Network config validation
// ---------------------------------------------------------------------------

/// Validate network configuration parameters (CIDR, gateway, IP range).
pub fn validate_network_config(
    cidr: &str,
    gateway: &str,
    range_start: &str,
    range_end: &str,
) -> Result<(), AgentError> {
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

    let is_v6 = cidr.contains(':');
    let min_prefix: u8 = 8;
    let max_prefix: u8 = if is_v6 { 126 } else { 30 };

    if !(min_prefix..=max_prefix).contains(&prefix_len) {
        return Err(AgentError::InternalError(format!(
            "Invalid CIDR prefix length: '{}'. Must be between {} and {}",
            prefix_len, min_prefix, max_prefix
        )));
    }

    let gateway_ip = ip_to_u128(gateway)?;
    let range_start_ip = ip_to_u128(range_start)?;
    let range_end_ip = ip_to_u128(range_end)?;

    if !ip_in_subnet(gateway, base_ip, prefix_len) {
        return Err(AgentError::InternalError(format!(
            "Gateway '{}' is not within the subnet '{}/{}'",
            gateway, base_ip, prefix_len
        )));
    }

    if !ip_in_subnet(range_start, base_ip, prefix_len) {
        return Err(AgentError::InternalError(format!(
            "Range start '{}' is not within the subnet '{}/{}'",
            range_start, base_ip, prefix_len
        )));
    }

    if !ip_in_subnet(range_end, base_ip, prefix_len) {
        return Err(AgentError::InternalError(format!(
            "Range end '{}' is not within the subnet '{}/{}'",
            range_end, base_ip, prefix_len
        )));
    }

    if range_start_ip >= range_end_ip {
        return Err(AgentError::InternalError(format!(
            "Range start '{}' must be less than range end '{}'",
            range_start, range_end
        )));
    }

    if gateway_ip >= range_start_ip && gateway_ip <= range_end_ip {
        warn!(
            "Gateway '{}' is within the allocation range {}-{}. This may cause issues.",
            gateway, range_start, range_end
        );
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_cidr() {
        assert_eq!(normalize_cidr("10.0.0.0/16").unwrap(), "10.0.0.0/16");
        assert_eq!(normalize_cidr("10.0.0.0").unwrap(), "10.0.0.0/24");
        assert_eq!(normalize_cidr("fe80::1").unwrap(), "fe80::1/64");
    }

    #[test]
    fn test_ip_in_subnet() {
        assert!(ip_in_subnet("10.42.1.5", "10.42.0.0", 16));
        assert!(!ip_in_subnet("10.43.1.5", "10.42.0.0", 16));
    }

    #[test]
    fn test_is_forbidden_install_ip() {
        assert!(is_forbidden_install_ip("127.0.0.1".parse().unwrap()));
        assert!(is_forbidden_install_ip("10.0.0.1".parse().unwrap()));
        assert!(is_forbidden_install_ip("192.168.1.1".parse().unwrap()));
        assert!(!is_forbidden_install_ip("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn test_cidr_usable_range() {
        // /16 is < 24, so default_start clamping applies: start = max(network+1, network+10)
        let (start, end) = cidr_usable_range("10.42.0.0/16").unwrap();
        assert_eq!(start, "10.42.0.10");
        assert_eq!(end, "10.42.255.250");

        // /24 has no default_start clamping: start = network+1
        let (start, end) = cidr_usable_range("192.168.1.0/24").unwrap();
        assert_eq!(start, "192.168.1.1");
        assert_eq!(end, "192.168.1.254");
    }
}
