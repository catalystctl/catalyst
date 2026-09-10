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

/// Run a blocking `std::process::Command` on a dedicated thread so callers on
/// an async runtime do not stall a worker (system_setup still uses the sync API).
fn run_command_blocking(program: &str, args: &[&str]) -> Result<std::process::Output, AgentError> {
    let program = program.to_string();
    let args: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    std::thread::spawn(move || std::process::Command::new(program).args(args).output())
        .join()
        .map_err(|_| AgentError::InternalError("command thread panicked".to_string()))?
        .map_err(|e| AgentError::IoError(format!("Failed to run command: {}", e)))
}

/// Detect the primary network interface (sync version using `std::process::Command`).
pub fn detect_network_interface_sync() -> Result<String, AgentError> {
    // Try to get default route interface
    let output = run_command_blocking("ip", &["route", "show", "default"])?;

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
    let output = run_command_blocking("ip", &["-o", "link", "show"])?;

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
    let output = run_command_blocking("ip", &["route", "show", "default"])?;

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
    let output = run_command_blocking("ip", &["-4", "addr", "show", "dev", interface])?;

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

/// Hosts allowed for cleartext `ws://` without `CATALYST_ALLOW_INSECURE_WS=1`.
///
/// Includes loopback (`localhost`, `127.0.0.0/8`, `::1`) and RFC1918 private
/// LAN ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) so agents can
/// reach a panel exposed on the local network without TLS. Public IPs and
/// unresolved DNS names still require `wss://` or the explicit override.
pub fn is_allowed_insecure_ws_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    // `Url::host_str()` returns IPv6 without brackets, but accept both forms.
    let host = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);

    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => v4.is_loopback() || v4.is_private(),
        Ok(IpAddr::V6(v6)) => {
            // Check native IPv6 loopback/ULA first. `::1` is also IPv4-compatible
            // (`0.0.0.1`), so calling to_ipv4() before is_loopback() would reject it.
            if v6.is_loopback() || v6.is_unique_local() {
                return true;
            }
            if let Some(v4) = v6.to_ipv4() {
                return v4.is_loopback() || v4.is_private();
            }
            false
        }
        // Non-IP hostnames (e.g. panel.lan) are not allowlisted by name alone.
        Err(_) => false,
    }
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
///
/// NOTE on per-hop revalidation: the file_tunnel download loop calls this on
/// every redirect hop (redirect policy is `none`, each `Location` is joined
/// and revalidated before the next fetch), so a redirect to an internal
/// address is refused at the hop that introduces it. TOCTOU caveat: DNS is
/// re-resolved per hop but the TCP connection itself is not bound to the
/// validated address (reqwest offers no remote_addr hook without a custom
/// connector), so a fast-flux name could resolve differently between the
/// check and the connect. Mitigation is defense-in-depth: numeric forms are
/// canonicalized below, DNS results are all checked, and egress to
/// RFC1918/link-local ranges should additionally be dropped at the host
/// firewall for high-risk deployments.
/// Parse one dotted-quad component in decimal, octal (`0177`), or hex
/// (`0x7f`) form, mirroring `inet_aton` semantics.
fn parse_ip_component(part: &str) -> Option<u32> {
    let part = part.trim();
    if part.is_empty() {
        return None;
    }
    if let Some(hex) = part.strip_prefix("0x").or_else(|| part.strip_prefix("0X")) {
        if hex.is_empty() || hex.len() > 8 {
            return None;
        }
        u32::from_str_radix(hex, 16).ok()
    } else if part.len() > 1 && part.starts_with('0') && part.bytes().all(|b| b.is_ascii_digit()) {
        if part.len() > 11 {
            return None;
        }
        u32::from_str_radix(part, 8).ok()
    } else {
        if part.len() > 10 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        part.parse::<u32>().ok()
    }
}

/// Canonicalize a URL host that is an IP in a non-standard numeric form to an
/// `IpAddr`, so SSRF checks cannot be bypassed with decimal/octal/hex or
/// shortened encodings (`2130706433`, `0x7f.0.0.1`, `0177.0.0.1`,
/// `0x7f000001`, `127.1`). Returns `None` for DNS names (handled by the
/// resolver path) and for malformed input.
pub fn canonicalize_numeric_ip_host(host: &str) -> Option<IpAddr> {
    let host = host.trim();
    let bare = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    // Standard literal (v4/v6): nothing to canonicalize.
    if let Ok(ip) = bare.parse::<IpAddr>() {
        return Some(ip);
    }
    if bare.is_empty() || bare.contains(':') || bare.contains('%') {
        return None;
    }
    // Single number: full 32-bit value in decimal or hex.
    if !bare.contains('.') {
        let value = if bare.starts_with("0x") || bare.starts_with("0X") {
            u32::from_str_radix(&bare[2..], 16).ok()?
        } else if bare.len() > 1 && bare.starts_with('0') {
            u32::from_str_radix(bare, 8).ok()?
        } else {
            bare.parse::<u64>().ok().and_then(|v| v.try_into().ok())?
        };
        return Some(IpAddr::V4(Ipv4Addr::from(value)));
    }
    // Dotted form with 2-4 parts, inet_aton-style tail packing.
    let parts: Vec<&str> = bare.split('.').collect();
    if parts.len() < 2 || parts.len() > 4 {
        return None;
    }
    let nums: Vec<u32> = parts
        .iter()
        .map(|p| parse_ip_component(p))
        .collect::<Option<_>>()?;
    let value: u64 = match nums.len() {
        4 => {
            if nums.iter().any(|&n| n > 255) {
                return None;
            }
            ((nums[0] as u64) << 24)
                | ((nums[1] as u64) << 16)
                | ((nums[2] as u64) << 8)
                | nums[3] as u64
        }
        3 => {
            if nums[0] > 255 || nums[1] > 255 || nums[2] > 0xffff {
                return None;
            }
            ((nums[0] as u64) << 24) | ((nums[1] as u64) << 16) | nums[2] as u64
        }
        2 => {
            if nums[0] > 255 || nums[1] > 0xffffff {
                return None;
            }
            ((nums[0] as u64) << 24) | nums[1] as u64
        }
        _ => return None,
    };
    let value: u32 = value.try_into().ok()?;
    Some(IpAddr::V4(Ipv4Addr::from(value)))
}

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

    // If the host is an IP literal — including non-standard numeric forms
    // like 2130706433, 0x7f.0.0.1, 0177.0.0.1, or 127.1 — canonicalize and
    // validate directly so SSRF checks cannot be bypassed by encoding.
    if let Some(ip) = canonicalize_numeric_ip_host(host) {
        if is_forbidden_install_ip(ip) {
            return Err("Refusing to download from a private/link-local/loopback IP".to_string());
        }
        return Ok(());
    }
    // Anything else (DNS names, zoned IPv6) goes through the resolver path
    // below; IP literals that reach it are returned as-is by lookup_host
    // and checked per resolved address.

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

/// Parse a panel-supplied port value, validating 1..=65535 before any
/// narrowing cast (a bare `as u16` silently truncates, e.g. 65536 -> 0).
pub fn parse_port_value(value: u64) -> Result<u16, AgentError> {
    if value == 0 || value > u16::MAX as u64 {
        return Err(AgentError::InvalidRequest(format!(
            "Invalid port '{}': must be 1-65535",
            value
        )));
    }
    Ok(value as u16)
}

/// Parse a panel-supplied `portBindings` map (`{containerPort: hostPort}`).
/// Both sides must be valid u16 ports; privileged host ports (<1024) are
/// denied because binding them implies host-level service impersonation.
pub fn parse_port_bindings(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<std::collections::HashMap<u16, u16>, AgentError> {
    let mut out = std::collections::HashMap::new();
    for (container_port, host_port) in map {
        let container_port = container_port.parse::<u16>().map_err(|_| {
            AgentError::InvalidRequest(format!(
                "Invalid portBindings container port '{}': must be 1-65535",
                container_port
            ))
        })?;
        if container_port == 0 {
            return Err(AgentError::InvalidRequest(
                "Invalid portBindings container port '0'".to_string(),
            ));
        }
        let host_raw = host_port.as_u64().ok_or_else(|| {
            AgentError::InvalidRequest("Invalid portBindings host port".to_string())
        })?;
        let host_port = parse_port_value(host_raw).map_err(|_| {
            AgentError::InvalidRequest("Invalid portBindings host port".to_string())
        })?;
        if host_port < 1024 {
            warn!(
                "Denying portBindings host port {} (<1024, privileged range)",
                host_port
            );
            return Err(AgentError::InvalidRequest(format!(
                "portBindings host port {} is in the privileged range (<1024) and is denied",
                host_port
            )));
        }
        out.insert(container_port, host_port);
    }
    Ok(out)
}

/// Validate a panel-requested static container IP (`CATALYST_NETWORK_IP` /
/// `AERO_NETWORK_IP`): must parse as an IP, sit inside the bridge subnet,
/// and must not be the subnet's network, gateway, or broadcast address.
/// Returns the validated IP string, or an error describing why DHCP
/// fallback should be used instead.
pub fn validate_static_ip_in_subnet(ip: &str, bridge_subnet: &str) -> Result<String, String> {
    let addr: IpAddr = ip
        .trim()
        .parse()
        .map_err(|_| format!("Invalid static container IP '{}'", ip))?;
    let (net_str, prefix_str) = bridge_subnet
        .split_once('/')
        .ok_or_else(|| format!("Invalid bridge subnet '{}'", bridge_subnet))?;
    let prefix: u32 = prefix_str
        .parse()
        .map_err(|_| format!("Invalid bridge subnet '{}'", bridge_subnet))?;
    match addr {
        IpAddr::V4(v4) => {
            if prefix > 32 {
                return Err(format!("Invalid bridge subnet '{}'", bridge_subnet));
            }
            let net_v4: Ipv4Addr = net_str
                .parse()
                .map_err(|_| format!("Invalid bridge subnet '{}'", bridge_subnet))?;
            let mask = if prefix == 0 {
                0u32
            } else {
                u32::MAX << (32 - prefix)
            };
            let net = u32::from(net_v4) & mask;
            let broadcast = net | (!mask);
            let gateway = net + 1;
            let candidate = u32::from(v4);
            if (candidate & mask) != net {
                return Err(format!(
                    "Static IP {} is not inside the bridge subnet {}",
                    ip, bridge_subnet
                ));
            }
            if candidate == net || candidate == gateway || candidate == broadcast {
                return Err(format!(
                    "Static IP {} is the network, gateway, or broadcast address of {}",
                    ip, bridge_subnet
                ));
            }
        }
        IpAddr::V6(_) => {
            return Err(format!(
                "Static IP {} is IPv6 but the bridge subnet {} is IPv4",
                ip, bridge_subnet
            ));
        }
    }
    Ok(ip.trim().to_string())
}

/// Validate a CNI network name with the same label rules as NetworkManager.
/// Panel-supplied `networkMode` values flow into CNI config file paths and
/// plugin JSON, so path separators and odd characters are rejected.
pub fn validate_cni_network_name(name: &str) -> Result<(), AgentError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 63 {
        return Err(AgentError::InvalidRequest(
            "Invalid network name: must be 1-63 characters".to_string(),
        ));
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(AgentError::InvalidRequest(
            "Invalid network name: must not contain path separators".to_string(),
        ));
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphanumeric() => {}
        _ => {
            return Err(AgentError::InvalidRequest(
                "Invalid network name: must start with an alphanumeric character".to_string(),
            ));
        }
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(AgentError::InvalidRequest(
            "Invalid network name: allowed characters are a-z, A-Z, 0-9, '-', '_', '.'".to_string(),
        ));
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
    fn test_is_allowed_insecure_ws_host() {
        // Loopback
        assert!(is_allowed_insecure_ws_host("localhost"));
        assert!(is_allowed_insecure_ws_host("LOCALHOST"));
        assert!(is_allowed_insecure_ws_host("127.0.0.1"));
        assert!(is_allowed_insecure_ws_host("127.1.2.3"));
        assert!(is_allowed_insecure_ws_host("::1"));
        assert!(is_allowed_insecure_ws_host("[::1]"));

        // RFC1918 private LANs
        assert!(is_allowed_insecure_ws_host("10.0.0.5"));
        assert!(is_allowed_insecure_ws_host("172.16.0.1"));
        assert!(is_allowed_insecure_ws_host("172.31.255.254"));
        assert!(is_allowed_insecure_ws_host("192.168.1.50"));

        // IPv6 ULA
        assert!(is_allowed_insecure_ws_host("fd12:3456:789a::1"));

        // Public / non-private must still be blocked
        assert!(!is_allowed_insecure_ws_host("8.8.8.8"));
        assert!(!is_allowed_insecure_ws_host("1.1.1.1"));
        assert!(!is_allowed_insecure_ws_host("172.15.0.1")); // just outside 172.16/12
        assert!(!is_allowed_insecure_ws_host("172.32.0.1")); // just outside 172.16/12
        assert!(!is_allowed_insecure_ws_host("panel.example.com"));
        assert!(!is_allowed_insecure_ws_host(""));
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

    #[test]
    fn test_numeric_ip_canonicalization_vectors() {
        // Every encoding of 127.0.0.1 must canonicalize to the loopback.
        for host in [
            "2130706433",   // decimal u32
            "0x7f000001",   // hex u32
            "0x7F000001",   // hex uppercase
            "0x7f.0.0.1",   // dotted hex
            "0177.0.0.1",   // dotted octal
            "017700000001", // octal u32 (0o1770000001 = 2130706433)
            "127.1",        // shortened form
            "127.0.1",      // shortened form
            "0x7f.1",
        ] {
            let ip = canonicalize_numeric_ip_host(host)
                .unwrap_or_else(|| panic!("{} should canonicalize", host));
            assert_eq!(ip, "127.0.0.1".parse::<IpAddr>().unwrap(), "host {}", host);
            assert!(
                is_forbidden_install_ip(ip),
                "host {} must be forbidden",
                host
            );
        }
        // 192.168.1.1 in decimal / hex.
        for host in ["3232235777", "0xc0a80101"] {
            let ip = canonicalize_numeric_ip_host(host).expect("should canonicalize");
            assert_eq!(ip, "192.168.1.1".parse::<IpAddr>().unwrap());
            assert!(is_forbidden_install_ip(ip));
        }
        // Public IPs stay public through the canonicalizer.
        let ip = canonicalize_numeric_ip_host("134744072").expect("8.8.8.8 decimal");
        assert_eq!(ip, "8.8.8.8".parse::<IpAddr>().unwrap());
        assert!(!is_forbidden_install_ip(ip));
        let ip = canonicalize_numeric_ip_host("0x08080808").expect("8.8.8.8 hex");
        assert_eq!(ip, "8.8.8.8".parse::<IpAddr>().unwrap());
        // Standard literals pass through unchanged.
        assert_eq!(
            canonicalize_numeric_ip_host("1.1.1.1"),
            Some("1.1.1.1".parse().unwrap())
        );
        assert_eq!(
            canonicalize_numeric_ip_host("[::1]"),
            Some("::1".parse().unwrap())
        );
        // DNS names and garbage do not canonicalize.
        assert_eq!(canonicalize_numeric_ip_host("panel.example.com"), None);
        assert_eq!(canonicalize_numeric_ip_host(""), None);
        assert_eq!(canonicalize_numeric_ip_host("999.999.999.999"), None);
        assert_eq!(canonicalize_numeric_ip_host("0xzzzz"), None);
    }

    #[test]
    fn test_parse_port_value_matrix() {
        assert_eq!(parse_port_value(1).unwrap(), 1);
        assert_eq!(parse_port_value(25565).unwrap(), 25565);
        assert_eq!(parse_port_value(65535).unwrap(), 65535);
        // Truncation traps: bare `as u16` would map these to 0 / 4464.
        assert!(parse_port_value(0).is_err());
        assert!(parse_port_value(65536).is_err());
        assert!(parse_port_value(70000).is_err());
        assert!(parse_port_value(u64::MAX).is_err());
    }

    #[test]
    fn test_parse_port_bindings_matrix() {
        // Valid matrix.
        let map: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(r#"{"25565": 25565, "25566": 25570}"#).unwrap();
        let out = parse_port_bindings(&map).unwrap();
        assert_eq!(out.get(&25565), Some(&25565));
        assert_eq!(out.get(&25566), Some(&25570));
        // Privileged host ports are denied.
        for raw in [r#"{"80": 80}"#, r#"{"443": 443}"#, r#"{"25565": 22}"#] {
            let map: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(raw).unwrap();
            assert!(parse_port_bindings(&map).is_err(), "raw {}", raw);
        }
        // Out-of-range sides are denied.
        for raw in [
            r#"{"0": 25565}"#,
            r#"{"65536": 25565}"#,
            r#"{"abc": 25565}"#,
            r#"{"25565": 0}"#,
            r#"{"25565": 70000}"#,
            r#"{"25565": "25565"}"#,
        ] {
            let map: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(raw).unwrap();
            assert!(parse_port_bindings(&map).is_err(), "raw {}", raw);
        }
    }

    #[test]
    fn test_validate_static_ip_in_subnet() {
        let subnet = "10.42.0.0/16";
        assert_eq!(
            validate_static_ip_in_subnet("10.42.5.20", subnet).unwrap(),
            "10.42.5.20"
        );
        // Network, gateway, and broadcast are unusable.
        assert!(validate_static_ip_in_subnet("10.42.0.0", subnet).is_err());
        assert!(validate_static_ip_in_subnet("10.42.0.1", subnet).is_err());
        assert!(validate_static_ip_in_subnet("10.42.255.255", subnet).is_err());
        // Outside the subnet, garbage, and IPv6 are rejected.
        assert!(validate_static_ip_in_subnet("10.43.0.5", subnet).is_err());
        assert!(validate_static_ip_in_subnet("not-an-ip", subnet).is_err());
        assert!(validate_static_ip_in_subnet("fd00::5", subnet).is_err());
    }

    #[test]
    fn test_validate_cni_network_name() {
        assert!(validate_cni_network_name("bridge").is_ok());
        assert!(validate_cni_network_name("tenant-net_1.prod").is_ok());
        assert!(validate_cni_network_name("").is_err());
        assert!(validate_cni_network_name("../evil").is_err());
        assert!(validate_cni_network_name("a/b").is_err());
        assert!(validate_cni_network_name("a\\b").is_err());
        assert!(validate_cni_network_name("-lead").is_err());
        assert!(validate_cni_network_name("has space").is_err());
        assert!(validate_cni_network_name("semi;colon").is_err());
        assert!(validate_cni_network_name(&"a".repeat(64)).is_err());
    }
}
