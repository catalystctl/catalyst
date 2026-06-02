//! Low-level helper functions for containerd operations.

use super::*;

pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    match bytes {
        0..=KB => format!("{}B", bytes),
        b @ 1..=MB => format!("{:.1}KB", b as f64 / KB as f64),
        b @ 1..=GB => format!("{:.1}MB", b as f64 / MB as f64),
        b => format!("{:.1}GB", b as f64 / GB as f64),
    }
}

pub async fn get_container_pids(cgroup_path: &str) -> Option<Vec<u32>> {
    let content = tokio::fs::read_to_string(format!("{}/cgroup.procs", cgroup_path))
        .await
        .ok()?;
    let pids: Vec<u32> = content
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect();
    if pids.is_empty() {
        None
    } else {
        Some(pids)
    }
}

pub async fn read_network_io(cgroup_path: &str) -> Option<(u64, u64, String)> {
    let pids = get_container_pids(cgroup_path).await?;
    let content = tokio::fs::read_to_string(format!("/proc/{}/net/dev", pids[0]))
        .await
        .ok()?;
    let mut total_rx: u64 = 0;
    let mut total_tx: u64 = 0;
    for line in content.lines().skip(2) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 10 {
            if let Ok(rx) = parts[1].parse::<u64>() {
                total_rx += rx;
            }
            if let Ok(tx) = parts[9].parse::<u64>() {
                total_tx += tx;
            }
        }
    }
    Some((
        total_rx,
        total_tx,
        format!(
            "↓ {} / ↑ {}",
            format_bytes(total_rx),
            format_bytes(total_tx)
        ),
    ))
}

pub async fn read_block_io(cgroup_path: &str) -> Option<(u64, u64, String)> {
    let content = tokio::fs::read_to_string(format!("{}/io.stat", cgroup_path))
        .await
        .ok()?;
    let mut read_bytes: u64 = 0;
    let mut write_bytes: u64 = 0;
    for line in content.lines() {
        if line.starts_with("8:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            for part in &parts {
                if let Some(val) = part.strip_prefix("rbytes=") {
                    read_bytes += val.parse::<u64>().unwrap_or(0);
                }
                if let Some(val) = part.strip_prefix("wbytes=") {
                    write_bytes += val.parse::<u64>().unwrap_or(0);
                }
            }
        }
    }
    Some((
        read_bytes,
        write_bytes,
        format!(
            "↓ {} / ↑ {}",
            format_bytes(read_bytes),
            format_bytes(write_bytes)
        ),
    ))
}

pub async fn rotate_logs(console_log_dir: &Path, container_id: &str) {
    let io_dir = console_log_dir.join(container_id);
    for log_name in &["stdout", "stderr"] {
        let log_path = io_dir.join(log_name);
        if let Ok(metadata) = tokio::fs::metadata(&log_path).await {
            if metadata.len() > MAX_LOG_SIZE {
                // Rotate: stdout -> stdout.1 -> stdout.2 (drop oldest)
                for i in (1..=LOG_BACKUP_COUNT).rev() {
                    let src = if i == 1 {
                        log_path.clone()
                    } else {
                        io_dir.join(format!("{}.{}", log_name, i - 1))
                    };
                    let dst = io_dir.join(format!("{}.{}", log_name, i));
                    let _ = tokio::fs::rename(&src, &dst).await;
                }
                // Compress the oldest rotated log
                let oldest = io_dir.join(format!("{}.{}", log_name, LOG_BACKUP_COUNT));
                let _ = tokio::process::Command::new("gzip")
                    .arg("-f")
                    .arg(&oldest)
                    .status()
                    .await;
                // Create new empty log file
                let _ = tokio::fs::File::create(&log_path).await;
                info!(
                    "Rotated log for container {}: {} (was {} bytes)",
                    container_id,
                    log_name,
                    metadata.len()
                );
            }
        }
    }
}

pub fn discover_cni_bin_dir(configured_dir: &Path) -> PathBuf {
    const REQUIRED_PLUGINS: &[&str] = &["bridge", "host-local", "macvlan"];

    // Check the configured directory first
    let has_all = REQUIRED_PLUGINS
        .iter()
        .all(|plugin| configured_dir.join(plugin).exists());
    if has_all {
        return configured_dir.to_path_buf();
    }

    // Fall back to standard locations
    for dir in CNI_FALLBACK_BIN_DIRS {
        let has_all = REQUIRED_PLUGINS
            .iter()
            .all(|plugin| Path::new(&format!("{}/{}", dir, plugin)).exists());
        if has_all {
            return PathBuf::from(dir);
        }
    }

    // Default to the configured dir (error will be raised later when plugin is not found)
    configured_dir.to_path_buf()
}

pub fn parse_ctr_event_line(line: &str) -> Option<CtrEvent> {
    // 7 space-delimited fields; the last one is the JSON payload.
    let mut parts = line.splitn(7, ' ');
    let _date = parts.next()?; // "2026-05-21"
    let _time = parts.next()?; // "20:34:35.416197115"
    let _off = parts.next()?; // "+0000"
    let _zone = parts.next()?; // "UTC"
    let _ns = parts.next()?; // "catalyst"
    let topic = parts.next()?.to_string();
    let json = parts.next()?;

    // Extract container ID from the JSON payload's "id" field.
    let container_id = json
        .find("\"id\":\"")
        .and_then(|start| {
            let after = &json[start + 6..]; // skip "id":"
            after.find('"').map(|end| after[..end].to_string())
        })
        .or_else(|| {
            // Fallback: "id":<value> (no quotes, unlikely)
            json.find("\"id\":").map(|start| {
                let after = &json[start + 5..];
                let end = after.find([',', '}']).unwrap_or(after.len());
                after[..end].trim_matches('"').to_string()
            })
        })?;

    Some(CtrEvent {
        topic,
        container_id,
    })
}

pub fn load_named_cni_plugin_config(cni_dir: &Path, network: &str) -> Option<serde_json::Value> {
    let candidates = [
        cni_dir.join(format!("{}.conflist", network)),
        cni_dir.join(format!("{}.conf", network)),
    ];

    for path in candidates {
        let raw = match fs::read_to_string(&path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let parsed = match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "Invalid CNI config JSON at {} for network {}: {}",
                    path.display(),
                    network,
                    e
                );
                continue;
            }
        };

        // Handle .conflist files by selecting the first plugin entry.
        if let Some(plugins) = parsed.get("plugins").and_then(|v| v.as_array()) {
            if let Some(first) = plugins.first() {
                let mut cfg = first.clone();
                if cfg.get("name").is_none() {
                    cfg["name"] = parsed
                        .get("name")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!(network));
                }
                if cfg.get("cniVersion").is_none() {
                    cfg["cniVersion"] = parsed
                        .get("cniVersion")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!("0.4.0"));
                }
                info!("Loaded CNI network '{}' from {}", network, path.display());
                return Some(cfg);
            }
        }

        // Handle single-plugin .conf files.
        if parsed.get("type").is_some() {
            let mut cfg = parsed;
            if cfg.get("name").is_none() {
                cfg["name"] = serde_json::json!(network);
            }
            if cfg.get("cniVersion").is_none() {
                cfg["cniVersion"] = serde_json::json!("0.4.0");
            }
            info!("Loaded CNI network '{}' from {}", network, path.display());
            return Some(cfg);
        }
    }

    None
}

pub async fn detect_default_route_interface() -> Option<String> {
    let output = tokio::process::Command::new("ip")
        .args(["-4", "route", "show", "default"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let route = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = route.split_whitespace().collect();
    let idx = parts.iter().position(|&p| p == "dev")?;
    let iface = parts.get(idx + 1)?.to_string();
    if iface.is_empty() || iface == "lo" {
        return None;
    }
    Some(iface)
}

pub async fn detect_host_network() -> Option<(String, String, String)> {
    // Try IPv4 default route first, then IPv6
    let (output, is_v6) = if let Ok(output) = tokio::process::Command::new("ip")
        .args(["-4", "route", "show", "default"])
        .output()
        .await
    {
        (output, false)
    } else if let Ok(output) = tokio::process::Command::new("ip")
        .args(["-6", "route", "show", "default"])
        .output()
        .await
    {
        (output, true)
    } else {
        return None;
    };

    let route = String::from_utf8_lossy(&output.stdout);
    let mut parts = route.split_whitespace();
    let mut gateway = None;
    let mut iface = None;
    while let Some(part) = parts.next() {
        if part == "via" {
            gateway = parts.next().map(|s| s.to_string());
        } else if part == "dev" {
            iface = parts.next().map(|s| s.to_string());
        }
    }
    let gateway = gateway?;
    let iface = iface?;

    // Parse interface address for the matching family
    let family_arg = if is_v6 { "-6" } else { "-4" };
    let output = tokio::process::Command::new("ip")
        .args([family_arg, "-o", "addr", "show", &iface])
        .output()
        .await
        .ok()?;
    let addr_line = String::from_utf8_lossy(&output.stdout);
    let cidr = addr_line.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        while let Some(part) = parts.next() {
            if (part == "inet" && !is_v6) || (part == "inet6" && is_v6) {
                return parts.next().map(|s| s.to_string());
            }
        }
        None
    })?;
    let (ip_str, prefix_str) = cidr.split_once('/')?;
    let prefix: u32 = prefix_str.parse().ok()?;

    if is_v6 {
        let ip: std::net::Ipv6Addr = ip_str.parse().ok()?;
        let addr_u128 = u128::from(ip);
        let mask = if prefix == 0 {
            0u128
        } else {
            u128::MAX << (128 - prefix)
        };
        let net_addr = std::net::Ipv6Addr::from(addr_u128 & mask);
        let subnet = format!("{}/{}", net_addr, prefix);
        Some((iface, subnet, gateway))
    } else {
        let ip: Ipv4Addr = ip_str.parse().ok()?;
        let mask = if prefix == 0 {
            0u32
        } else {
            !0u32 << (32 - prefix)
        };
        let net_addr = Ipv4Addr::from(u32::from(ip) & mask);
        let subnet = format!("{}/{}", net_addr, prefix);
        Some((iface, subnet, gateway))
    }
}

pub fn calculate_ip_range_from_subnet(cidr: &str) -> (String, String) {
    if cidr.contains(':') {
        // IPv6
        let parts: Vec<&str> = cidr.split('/').collect();
        if parts.len() != 2 {
            warn!("Invalid IPv6 CIDR format '{}', using default range", cidr);
            return ("fd00::10".to_string(), "fd00::fff0".to_string());
        }

        let addr_str = parts[0];
        let prefix_str = parts[1];
        let prefix: u32 = match prefix_str.parse() {
            Ok(p) if p <= 128 => p,
            _ => {
                warn!(
                    "Invalid IPv6 CIDR prefix '{}', using default range",
                    prefix_str
                );
                return ("fd00::10".to_string(), "fd00::fff0".to_string());
            }
        };

        let addr: std::net::Ipv6Addr = match addr_str.parse() {
            Ok(a) => a,
            Err(_) => {
                warn!("Invalid IPv6 address '{}', using default range", addr_str);
                return ("fd00::10".to_string(), "fd00::fff0".to_string());
            }
        };

        let addr_u128 = u128::from(addr);
        let mask = if prefix == 0 {
            0u128
        } else {
            u128::MAX << (128 - prefix)
        };
        let network = addr_u128 & mask;
        let broadcast = network | (!mask);

        if broadcast <= network + 1 {
            warn!(
                "CIDR '{}' has no usable addresses, using default range",
                cidr
            );
            return ("fd00::10".to_string(), "fd00::fff0".to_string());
        }

        let (start, end) = if prefix < 64 {
            let default_start = network + 10;
            let default_end = broadcast - 5;
            (
                default_start.max(network + 1),
                default_end.min(broadcast - 1),
            )
        } else {
            (network + 1, broadcast - 1)
        };

        (
            std::net::Ipv6Addr::from(start).to_string(),
            std::net::Ipv6Addr::from(end).to_string(),
        )
    } else {
        // IPv4
        let parts: Vec<&str> = cidr.split('/').collect();
        if parts.len() != 2 {
            warn!("Invalid CIDR format '{}', using default range", cidr);
            return ("10.0.0.10".to_string(), "10.0.0.250".to_string());
        }

        let addr_str = parts[0];
        let prefix_str = parts[1];
        let prefix: u32 = match prefix_str.parse() {
            Ok(p) if p <= 32 => p,
            _ => {
                warn!("Invalid CIDR prefix '{}', using default range", prefix_str);
                return ("10.0.0.10".to_string(), "10.0.0.250".to_string());
            }
        };

        let addr: std::net::Ipv4Addr = match addr_str.parse() {
            Ok(a) => a,
            Err(_) => {
                warn!("Invalid IP address '{}', using default range", addr_str);
                return ("10.0.0.10".to_string(), "10.0.0.250".to_string());
            }
        };

        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0u32
        } else {
            !0u32 << (32 - prefix)
        };
        let network = addr_u32 & mask;
        let broadcast = network | (!mask);

        if broadcast <= network + 1 {
            warn!(
                "CIDR '{}' has no usable addresses, using default range",
                cidr
            );
            return ("10.0.0.10".to_string(), "10.0.0.250".to_string());
        }

        // Usable range is network+1 to broadcast-1.
        // For larger subnets (/8, /16) provide a reasonable sub-range.
        let (start, end) = if prefix < 24 {
            let default_start = network + 10;
            let default_end = broadcast - 5;
            (
                default_start.max(network + 1),
                default_end.min(broadcast - 1),
            )
        } else {
            (network + 1, broadcast - 1)
        };

        (
            std::net::Ipv4Addr::from(start).to_string(),
            std::net::Ipv4Addr::from(end).to_string(),
        )
    }
}

pub fn create_fifo(path: &Path) -> std::io::Result<()> {
    match mkfifo(path, Mode::from_bits_truncate(0o600)) {
        Ok(()) => Ok(()),
        Err(Errno::EEXIST) => Ok(()),
        Err(err) => Err(std::io::Error::other(err)),
    }
}

pub fn open_fifo_rdwr(path: &Path) -> AgentResult<File> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(path)
        .map_err(|e| AgentError::ContainerError(format!("open FIFO: {}", e)))?;
    if let Ok(flags) = fcntl(&file, FcntlArg::F_GETFL) {
        let mut of = OFlag::from_bits_truncate(flags);
        of.remove(OFlag::O_NONBLOCK);
        let _ = fcntl(&file, FcntlArg::F_SETFL(of));
    }
    Ok(file)
}

pub fn set_dir_perms(path: &Path, mode: u32) {
    if let Ok(md) = fs::metadata(path) {
        let mut p = md.permissions();
        p.set_mode(mode);
        fs::set_permissions(path, p).ok();
    }
}

pub fn parse_signal(signal: &str) -> u32 {
    match signal.to_ascii_uppercase().as_str() {
        "SIGTERM" | "15" => 15,
        "SIGINT" | "2" => 2,
        "SIGKILL" | "9" => 9,
        _ => 9,
    }
}

pub fn grpc_err(e: tonic::Status) -> AgentError {
    AgentError::ContainerError(format!(
        "containerd gRPC error ({}): {}",
        e.code(),
        e.message()
    ))
}

pub fn is_not_found(e: &tonic::Status) -> bool {
    e.message().contains("not found")
        || e.message().contains("process already finished")
        || e.code() == tonic::Code::NotFound
}

pub async fn find_container_cgroup(container_id: &str) -> Option<String> {
    find_cgroup_recursive("/sys/fs/cgroup", container_id).await
}

pub async fn find_cgroup_recursive(dir: &str, cid: &str) -> Option<String> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let p = entry.path();
        let n = entry.file_name().to_string_lossy().to_string();
        if n.contains(cid) {
            if let Ok(md) = tokio::fs::metadata(&p).await {
                if md.is_dir() {
                    return Some(p.to_string_lossy().to_string());
                }
            }
        }
        if !n.starts_with('.') {
            if let Ok(md) = tokio::fs::metadata(&p).await {
                if md.is_dir() {
                    if let Some(f) =
                        Box::pin(find_cgroup_recursive(&p.to_string_lossy(), cid)).await
                    {
                        return Some(f);
                    }
                }
            }
        }
    }
    None
}

pub async fn read_cgroup_cpu_usage(path: &str) -> Option<u64> {
    let content = tokio::fs::read_to_string(format!("{}/cpu.stat", path))
        .await
        .ok()?;
    for line in content.lines() {
        if line.starts_with("usage_usec") {
            return line.split_whitespace().nth(1)?.parse::<u64>().ok();
        }
    }
    Some(0)
}

pub async fn read_cgroup_memory(path: &str) -> Option<u64> {
    tokio::fs::read_to_string(format!("{}/memory.current", path))
        .await
        .ok()?
        .trim()
        .parse()
        .ok()
}

pub async fn read_cgroup_memory_limit(path: &str) -> Option<u64> {
    let content = tokio::fs::read_to_string(format!("{}/memory.max", path))
        .await
        .ok()?;
    let trimmed = content.trim();
    if trimmed == "max" || trimmed.is_empty() {
        return Some(0);
    }
    trimmed.parse().ok()
}
