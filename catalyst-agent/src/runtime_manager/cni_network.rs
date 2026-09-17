//! CNI network setup, teardown, port forwarding, and stale lease cleanup.

use super::*;

impl ContainerdRuntime {
    pub async fn clean_stale_ip_allocations(&self, network: &str) -> AgentResult<usize> {
        let dir = self.cni_data_dir.join(network);
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(AgentError::IoError(e.to_string())),
        };
        let containers = self.list_containers().await?;
        let mut active_ips = HashSet::new();
        let mut running = 0;
        for c in containers {
            if !c.status.contains("Up") {
                continue;
            }
            running += 1;
            if let Ok(ip) = self.get_container_ip(&c.id).await {
                if !ip.is_empty() {
                    active_ips.insert(ip);
                }
            }
        }
        if running > 0 && active_ips.is_empty() {
            return Ok(0);
        }
        let mut removed = 0;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let name = match entry.file_name().into_string() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if name == "lock" || name.starts_with("last_reserved_ip") {
                continue;
            }
            if name.parse::<Ipv4Addr>().is_err() {
                continue;
            }
            if !active_ips.contains(&name) {
                if let Ok(md) = tokio::fs::metadata(&path).await {
                    if let Ok(m) = md.modified() {
                        if let Ok(age) = SystemTime::now().duration_since(m) {
                            if age < Duration::from_secs(60) {
                                continue;
                            }
                        }
                    }
                }
                if tokio::fs::remove_file(&path).await.is_ok() {
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }

    pub fn release_static_ip(cni_data_dir: &Path, network: &str, ip: &str) -> std::io::Result<()> {
        fs::remove_file(cni_data_dir.join(network).join(ip))
    }

    pub(crate) fn derive_bridge_range(subnet: &str) -> (String, String, String) {
        let (addr_str, prefix_str) = match subnet.split_once('/') {
            Some(pair) => pair,
            None => {
                return (
                    "10.42.0.10".into(),
                    "10.42.255.250".into(),
                    "10.42.0.1".into(),
                )
            }
        };
        let prefix: u32 = match prefix_str.parse() {
            Ok(p) if p <= 32 => p,
            _ => {
                return (
                    "10.42.0.10".into(),
                    "10.42.255.250".into(),
                    "10.42.0.1".into(),
                )
            }
        };
        let addr: std::net::Ipv4Addr = match addr_str.parse() {
            Ok(a) => a,
            Err(_) => {
                return (
                    "10.42.0.10".into(),
                    "10.42.255.250".into(),
                    "10.42.0.1".into(),
                )
            }
        };
        let addr_u32 = u32::from(addr);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = addr_u32 & mask;
        let broadcast = network | (!mask);
        let gateway = std::net::Ipv4Addr::from(network + 1);
        let range_start = std::net::Ipv4Addr::from(network + 10);
        let range_end = std::net::Ipv4Addr::from(broadcast - 5);
        (
            range_start.to_string(),
            range_end.to_string(),
            gateway.to_string(),
        )
    }

    pub(crate) async fn setup_cni_network(
        &self,
        container_id: &str,
        pid: u32,
        network_mode: Option<&str>,
        network_ip: Option<&str>,
        primary_port: u16,
        port_bindings: &HashMap<u16, u16>,
    ) -> AgentResult<()> {
        let network = network_mode.unwrap_or("bridge");
        if network == "host" {
            return Ok(());
        }
        // Panel-influenced network names flow into CNI config file paths and
        // plugin JSON; validate with the same label rules as NetworkManager.
        if network != "bridge" && network != "default" {
            crate::net_utils::validate_cni_network_name(network)?;
        }
        // A static IP is interpolated into CNI JSON; it must be a real IP.
        if let Some(ip) = network_ip {
            if ip.parse::<std::net::IpAddr>().is_err() {
                return Err(AgentError::InvalidRequest(format!(
                    "Invalid static container IP '{}'",
                    ip
                )));
            }
        }
        let netns = self.resolve_task_netns(container_id, pid).await?;

        // Build DNS configuration from configured DNS servers
        let dns_config = if !self.dns_servers.is_empty() {
            serde_json::json!({
                "nameservers": self.dns_servers,
                "options": ["attempts:3", "timeout:2"]
            })
        } else {
            serde_json::json!({
                "nameservers": ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"],
                "options": ["attempts:3", "timeout:2"]
            })
        };

        let mut cfg = if network == "bridge" || network == "default" {
            // Bridge network uses NAT with private subnet (configurable via containerd.cni_bridge_subnet)
            // This matches the macvlan config structure with rangeStart/rangeEnd/gateway
            let bridge_subnet = &self.cni_bridge_subnet;
            // Parse subnet to derive rangeStart, rangeEnd, and gateway
            let (range_start, range_end, gateway_ip) = Self::derive_bridge_range(bridge_subnet);
            serde_json::json!({
                "cniVersion": "1.0.0",
                "name": "catalyst",
                "type": "bridge",
                "bridge": self.cni_bridge_name,
                "isGateway": true,
                "ipMasq": true,
                "dns": dns_config,
                "ipam": {
                    "type": "host-local",
                    "ranges": [[{
                        "subnet": bridge_subnet,
                        "rangeStart": range_start,
                        "rangeEnd": range_end,
                        "gateway": gateway_ip
                    }]],
                    "routes": [{"dst": "0.0.0.0/0"}],
                    "dataDir": self.cni_data_dir.to_string_lossy()
                }
            })
        } else {
            // For custom networks, prefer explicit CNI config written by NetworkManager.
            if let Some(mut cfg) = load_named_cni_plugin_config(&self.cni_dir, network) {
                // Add DNS config if not present
                if cfg.get("dns").is_none() {
                    cfg["dns"] = dns_config.clone();
                }
                cfg
            } else {
                // Fallback: synthesize a macvlan config from detected host network.
                // This matches the structure used by NetworkManager with rangeStart/rangeEnd
                let (iface, subnet, gateway) = detect_host_network().await.unwrap_or_else(|| {
                    warn!("Could not detect host network, falling back to eth0/10.0.0.0");
                    (
                        "eth0".to_string(),
                        "10.0.0.0/24".to_string(),
                        "10.0.0.1".to_string(),
                    )
                });
                // Calculate rangeStart/rangeEnd from subnet (same logic as NetworkManager)
                let (range_start, range_end) = calculate_ip_range_from_subnet(&subnet);
                let route_dst = if subnet.contains(':') {
                    "::/0"
                } else {
                    "0.0.0.0/0"
                };
                info!(
                    "macvlan network '{}': master={}, subnet={}, gateway={}, range={}-{}",
                    network, iface, subnet, gateway, range_start, range_end
                );
                serde_json::json!({
                    "cniVersion": "1.0.0",
                    "name": network,
                    "type": "macvlan",
                    "master": iface,
                    "mode": "bridge",
                    "dns": dns_config,
                    "ipam": {
                        "type": "host-local",
                        "ranges": [[{
                            "subnet": subnet,
                            "rangeStart": range_start,
                            "rangeEnd": range_end,
                            "gateway": gateway
                        }]],
                        "routes": [{"dst": route_dst}],
                        "dataDir": self.cni_data_dir.to_string_lossy()
                    }
                })
            }
        };
        if let Some(ip) = network_ip {
            if let Some(ipam) = cfg.get_mut("ipam") {
                // Determine prefix length from the subnet in config
                let prefix = ipam
                    .get("ranges")
                    .and_then(|r| r.get(0))
                    .and_then(|r| r.get(0))
                    .and_then(|r| r.get("subnet"))
                    .and_then(|s| s.as_str())
                    .or_else(|| ipam.get("subnet").and_then(|s| s.as_str()))
                    .and_then(|s| s.split('/').nth(1))
                    .unwrap_or("24");
                ipam["addresses"] = serde_json::json!([{"address":format!("{}/{}", ip, prefix)}]);
            } else {
                warn!(
                    "Ignoring requested static IP {} for network {} because ipam config is missing",
                    ip, network
                );
            }
        }
        // Store CNI config for proper teardown
        let cfg_path = self
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        if let Ok(j) = serde_json::to_string(&cfg) {
            let _ = fs::write(&cfg_path, &j);
        }
        let result = self
            .exec_cni_plugin(&cfg, "ADD", container_id, &netns, "eth0")
            .await?;
        let rp = self
            .cni_results_dir
            .join(format!("catalyst-{}", container_id));
        if let Ok(j) = serde_json::to_string_pretty(&result) {
            let _ = fs::write(&rp, &j);
        }
        let cip = result
            .get("ips")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|ip| ip.get("address"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .split('/')
            .next()
            .unwrap_or("");
        if !cip.is_empty() {
            let mut forwards: Vec<PortForward> = Vec::new();
            if !port_bindings.is_empty() {
                for (cp, hp) in port_bindings {
                    if let Err(e) = self.setup_port_forward(*hp, *cp, cip).await {
                        // Roll back any rules already installed in this call.
                        for prev in &forwards {
                            let _ = self
                                .teardown_port_forward_rules(
                                    prev.host_port,
                                    prev.container_port,
                                    cip,
                                )
                                .await;
                        }
                        return Err(e);
                    }
                    forwards.push(PortForward {
                        host_port: *hp,
                        container_port: *cp,
                    });
                }
            } else if primary_port > 0 {
                self.setup_port_forward(primary_port, primary_port, cip)
                    .await?;
                forwards.push(PortForward {
                    host_port: primary_port,
                    container_port: primary_port,
                });
            }

            if !forwards.is_empty() {
                let state = PortForwardState {
                    container_ip: cip.to_string(),
                    forwards,
                };
                let state_path = self.cni_results_dir.join(format!(
                    "{}{}-ports.json",
                    PORT_FWD_STATE_PREFIX, container_id
                ));
                if let Ok(j) = serde_json::to_string_pretty(&state) {
                    let _ = fs::write(&state_path, &j);
                }
            }
        }

        // For bridge network, ensure FORWARD rules allow traffic to external
        if network == "bridge" || network == "default" {
            self.ensure_bridge_forward_rules().await;
        }

        Ok(())
    }

    pub(crate) async fn ensure_bridge_forward_rules(&self) {
        // Detect the host's default route interface
        let external_iface = detect_default_route_interface().await.unwrap_or_else(|| {
            warn!("Could not detect default route interface; bridge FORWARD rules may not work");
            String::new()
        });
        if external_iface.is_empty() {
            return;
        }
        let iface = external_iface.as_str();

        // Check if rules already exist to avoid duplicates
        let bridge_name = &self.cni_bridge_name;
        let check_output = Command::new("iptables")
            .args([
                "-C",
                "FORWARD",
                "-i",
                bridge_name,
                "-o",
                iface,
                "-j",
                "ACCEPT",
            ])
            .output()
            .await;

        if let Ok(output) = check_output {
            if !output.status.success() {
                // Rule doesn't exist, add it
                let result = Command::new("iptables")
                    .args([
                        "-I",
                        "FORWARD",
                        "1",
                        "-i",
                        bridge_name,
                        "-o",
                        iface,
                        "-j",
                        "ACCEPT",
                    ])
                    .output()
                    .await;
                match result {
                    Ok(o) if o.status.success() => {
                        info!("Added FORWARD rule: {} -> {}", bridge_name, iface)
                    }
                    Ok(o) => warn!(
                        "Failed to add FORWARD rule: {}",
                        String::from_utf8_lossy(&o.stderr)
                    ),
                    Err(e) => warn!("Failed to execute iptables: {}", e),
                }

                let result = Command::new("iptables")
                    .args([
                        "-I",
                        "FORWARD",
                        "2",
                        "-i",
                        iface,
                        "-o",
                        bridge_name,
                        "-j",
                        "ACCEPT",
                    ])
                    .output()
                    .await;
                match result {
                    Ok(o) if o.status.success() => {
                        info!(
                            "Added FORWARD rule: {} -> {} (allow new connections)",
                            iface, bridge_name
                        )
                    }
                    Ok(o) => warn!(
                        "Failed to add FORWARD rule: {}",
                        String::from_utf8_lossy(&o.stderr)
                    ),
                    Err(e) => warn!("Failed to execute iptables: {}", e),
                }
            }
        }
    }

    pub(crate) async fn resolve_task_netns(
        &self,
        container_id: &str,
        initial_pid: u32,
    ) -> AgentResult<String> {
        let mut pid = initial_pid;
        let mut last_get_err: Option<String> = None;

        for _ in 0..20 {
            if pid > 0 {
                let netns = format!("/proc/{}/ns/net", pid);
                if Path::new(&netns).exists() {
                    return Ok(netns);
                }
            }

            let mut tasks = TasksClient::new(self.channel.clone());
            let req = containerd_client::services::v1::GetRequest {
                container_id: container_id.to_string(),
                ..Default::default()
            };
            let req = with_namespace!(req, &self.namespace);
            match tasks.get(req).await {
                Ok(resp) => {
                    pid = resp.into_inner().process.map(|p| p.pid).unwrap_or(0);
                }
                Err(err) => {
                    last_get_err = Some(format!("{}: {}", err.code(), err.message()));
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        let detail = last_get_err
            .map(|value| format!(", last task.get error: {}", value))
            .unwrap_or_default();
        Err(AgentError::ContainerError(format!(
            "Unable to resolve task network namespace for {} (initial pid {}, last pid {}){}",
            container_id, initial_pid, pid, detail
        )))
    }

    pub(crate) async fn exec_cni_plugin(
        &self,
        config: &serde_json::Value,
        command: &str,
        cid: &str,
        netns: &str,
        ifname: &str,
    ) -> AgentResult<serde_json::Value> {
        let ptype = config["type"].as_str().unwrap_or("bridge");
        let cni_bin_dir = discover_cni_bin_dir(&self.cni_bin_dir);
        // Allowlist the plugin type to a strict basename and canonicalize
        // under the plugin dir: `type` comes from panel-influenced CNI JSON.
        let ppath_buf = resolve_cni_plugin_path(&cni_bin_dir, ptype)?;
        let ppath = ppath_buf.to_string_lossy().to_string();
        if !Path::new(&ppath).exists() {
            return Err(AgentError::ContainerError(format!(
                "CNI plugin not found: {} (searched directories: {:?})",
                ppath, CNI_FALLBACK_BIN_DIRS
            )));
        }
        let cfg =
            serde_json::to_string(config).map_err(|e| AgentError::ContainerError(e.to_string()))?;
        let mut child = Command::new(&ppath)
            .env("CNI_COMMAND", command)
            .env("CNI_CONTAINERID", cid)
            .env("CNI_NETNS", netns)
            .env("CNI_IFNAME", ifname)
            .env("CNI_PATH", cni_bin_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AgentError::ContainerError(format!("CNI: {}", e)))?;
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            stdin.write_all(cfg.as_bytes()).await?;
            drop(stdin);
        }
        let out = child.wait_with_output().await?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let plugin_msg = serde_json::from_slice::<serde_json::Value>(&out.stdout)
                .ok()
                .and_then(|v| v.get("msg").and_then(|m| m.as_str()).map(|s| s.to_string()))
                .unwrap_or_default();
            return Err(AgentError::ContainerError(format!(
                "CNI {} failed (plugin={}, netns={}, status={}): msg='{}' stderr='{}' stdout='{}'",
                command, ptype, netns, out.status, plugin_msg, stderr, stdout
            )));
        }
        Ok(serde_json::from_slice(&out.stdout).unwrap_or(serde_json::json!({})))
    }

    pub(crate) async fn setup_port_forward(&self, hp: u16, cp: u16, cip: &str) -> AgentResult<()> {
        let dest = if cip.contains(':') {
            format!("[{}]:{}", cip, cp)
        } else {
            format!("{}:{}", cip, cp)
        };
        let cmd = if cip.contains(':') {
            "ip6tables"
        } else {
            "iptables"
        };
        let hps = hp.to_string();
        let cps = cp.to_string();
        let mut any_rule_added = false;
        let mut first_error: Option<String> = None;

        // Set up forwarding for both TCP and UDP (many game servers use UDP)
        'setup: {
            for proto in ["tcp", "udp"] {
                for args in [
                    vec![
                        "-t",
                        "nat",
                        "-A",
                        "PREROUTING",
                        "-p",
                        proto,
                        "--dport",
                        &hps,
                        "-j",
                        "DNAT",
                        "--to-destination",
                        &dest,
                    ],
                    vec![
                        "-t",
                        "nat",
                        "-A",
                        "OUTPUT",
                        "-p",
                        proto,
                        "--dport",
                        &hps,
                        "-j",
                        "DNAT",
                        "--to-destination",
                        &dest,
                    ],
                ] {
                    if rule_shape_present(cmd, &args).await {
                        continue;
                    }
                    match Command::new(cmd).args(&args).output().await {
                        Ok(o) if o.status.success() => {
                            any_rule_added = true;
                        }
                        Ok(o) => {
                            let err = String::from_utf8_lossy(&o.stderr).to_string();
                            warn!("{}: {}", cmd, err);
                            first_error = Some(format!("{} failed: {}", cmd, err));
                            break 'setup;
                        }
                        Err(e) => {
                            first_error = Some(format!("Failed to run {}: {}", cmd, e));
                            break 'setup;
                        }
                    }
                }
            }
            // MASQUERADE rule for outgoing traffic (needed for NAT)
            for args in [
                vec![
                    "-t",
                    "nat",
                    "-A",
                    "POSTROUTING",
                    "-p",
                    "tcp",
                    "-d",
                    cip,
                    "--dport",
                    &cps,
                    "-j",
                    "MASQUERADE",
                ],
                vec![
                    "-t",
                    "nat",
                    "-A",
                    "POSTROUTING",
                    "-p",
                    "udp",
                    "-d",
                    cip,
                    "--dport",
                    &cps,
                    "-j",
                    "MASQUERADE",
                ],
            ] {
                if rule_shape_present(cmd, &args).await {
                    continue;
                }
                match Command::new(cmd).args(&args).output().await {
                    Ok(o) if o.status.success() => {
                        any_rule_added = true;
                    }
                    Ok(o) => {
                        let err = String::from_utf8_lossy(&o.stderr).to_string();
                        warn!("{}: {}", cmd, err);
                        first_error = Some(format!("{} failed: {}", cmd, err));
                        break;
                    }
                    Err(e) => {
                        first_error = Some(format!("Failed to run {}: {}", cmd, e));
                        break;
                    }
                }
            }
        }

        if let Some(err) = first_error {
            if any_rule_added {
                warn!(
                    "Port-forward setup partially failed for {}:{} -> {}:{}; tearing down rules added in this call",
                    hp, cp, cip, cp
                );
                let _ = self.teardown_port_forward_rules(hp, cp, cip).await;
            }
            return Err(AgentError::NetworkError(format!(
                "Port-forward setup failed for host {} -> {}/{}: {}",
                hp, cip, cp, err
            )));
        }
        Ok(())
    }

    pub(crate) async fn teardown_port_forward(&self, container_id: &str) -> AgentResult<()> {
        let state_path = self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        ));
        if !Path::new(&state_path).exists() {
            return Ok(());
        }

        let raw = match fs::read_to_string(&state_path) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "Failed to read port-forward state {}: {}",
                    state_path.display(),
                    e
                );
                let _ = fs::remove_file(&state_path);
                return Ok(());
            }
        };
        let state: PortForwardState = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                warn!(
                    "Failed to parse port-forward state {}: {}",
                    state_path.display(),
                    e
                );
                let _ = fs::remove_file(&state_path);
                return Ok(());
            }
        };

        for fwd in &state.forwards {
            let _ = self
                .teardown_port_forward_rules(fwd.host_port, fwd.container_port, &state.container_ip)
                .await;
        }
        let _ = fs::remove_file(&state_path);
        Ok(())
    }

    pub(crate) async fn teardown_port_forward_rules(
        &self,
        hp: u16,
        cp: u16,
        cip: &str,
    ) -> AgentResult<()> {
        if cip.is_empty() {
            return Ok(());
        }
        let dest = if cip.contains(':') {
            format!("[{}]:{}", cip, cp)
        } else {
            format!("{}:{}", cip, cp)
        };
        let cmd = if cip.contains(':') {
            "ip6tables"
        } else {
            "iptables"
        };
        let hps = hp.to_string();
        let cps = cp.to_string();
        // Teardown both TCP and UDP rules
        for proto in ["tcp", "udp"] {
            for args in [
                vec![
                    "-t",
                    "nat",
                    "-D",
                    "PREROUTING",
                    "-p",
                    proto,
                    "--dport",
                    &hps,
                    "-j",
                    "DNAT",
                    "--to-destination",
                    &dest,
                ],
                vec![
                    "-t",
                    "nat",
                    "-D",
                    "OUTPUT",
                    "-p",
                    proto,
                    "--dport",
                    &hps,
                    "-j",
                    "DNAT",
                    "--to-destination",
                    &dest,
                ],
            ] {
                let o = Command::new(cmd).args(&args).output().await?;
                if !o.status.success() {
                    warn!("{}: {}", cmd, String::from_utf8_lossy(&o.stderr));
                }
            }
        }
        for args in [
            vec![
                "-t",
                "nat",
                "-D",
                "POSTROUTING",
                "-p",
                "tcp",
                "-d",
                cip,
                "--dport",
                &cps,
                "-j",
                "MASQUERADE",
            ],
            vec![
                "-t",
                "nat",
                "-D",
                "POSTROUTING",
                "-p",
                "udp",
                "-d",
                cip,
                "--dport",
                &cps,
                "-j",
                "MASQUERADE",
            ],
        ] {
            let o = Command::new(cmd).args(&args).output().await?;
            if !o.status.success() {
                warn!("{}: {}", cmd, String::from_utf8_lossy(&o.stderr));
            }
        }
        Ok(())
    }

    /// Re-attach CNI networking, port forwards, and firewall when restarting an
    /// existing container task (stop → start without full recreate).
    ///
    /// Uses previously persisted CNI config / port-forward state when present.
    /// If no prior network state exists, this is a no-op (create_container path
    /// is responsible for first-time setup).
    pub(crate) async fn reattach_network_on_start(
        &self,
        container_id: &str,
        pid: u32,
        server_id: &str,
    ) -> AgentResult<()> {
        let cfg_path = self
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        let ports_path = self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        ));

        // Nothing to reattach if we never set up networking for this container.
        if !cfg_path.exists() && !ports_path.exists() {
            debug!(
                "No prior CNI/port-forward state for {}; skipping network reattach",
                container_id
            );
            return Ok(());
        }

        // Snapshot the desired forwards BEFORE teardown: teardown_port_forward
        // deletes the state file on success, so re-reading it afterwards would
        // always miss and the re-ADD loop below would silently attach no DNAT.
        let prev_forwards: Option<PortForwardState> = fs::read_to_string(&ports_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok());

        // Clear any stale port-forward rules from the previous task netns before
        // re-adding against the new PID's network namespace.
        let _ = self.teardown_port_forward(container_id).await;

        // Prefer full CNI re-ADD with the stored config so the new netns gets an interface.
        if cfg_path.exists() {
            let raw = fs::read_to_string(&cfg_path).map_err(|e| {
                AgentError::ContainerError(format!(
                    "Failed to read CNI config for {}: {}",
                    container_id, e
                ))
            })?;
            let cfg: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
                AgentError::ContainerError(format!(
                    "Failed to parse CNI config for {}: {}",
                    container_id, e
                ))
            })?;

            let netns = self.resolve_task_netns(container_id, pid).await?;
            let result = self
                .exec_cni_plugin(&cfg, "ADD", container_id, &netns, "eth0")
                .await?;
            if let Ok(j) = serde_json::to_string_pretty(&result) {
                let _ = fs::write(
                    self.cni_results_dir
                        .join(format!("catalyst-{}", container_id)),
                    &j,
                );
            }

            let cip = result
                .get("ips")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|ip| ip.get("address"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .split('/')
                .next()
                .unwrap_or("");

            if !cip.is_empty() {
                let mut forwards: Vec<PortForward> = Vec::new();
                if let Some(prev) = &prev_forwards {
                    for fwd in prev.forwards.clone() {
                        if let Err(e) = self
                            .setup_port_forward(fwd.host_port, fwd.container_port, cip)
                            .await
                        {
                            warn!(
                                "Failed to reattach port forward {}->{}:{}: {}",
                                fwd.host_port, cip, fwd.container_port, e
                            );
                        } else {
                            forwards.push(fwd);
                        }
                    }
                }

                if !forwards.is_empty() {
                    let state = PortForwardState {
                        container_ip: cip.to_string(),
                        forwards: forwards.clone(),
                    };
                    if let Ok(j) = serde_json::to_string_pretty(&state) {
                        let _ = fs::write(&ports_path, &j);
                    }

                    for fwd in &forwards {
                        if let Err(e) =
                            FirewallManager::allow_port(fwd.host_port, "tcp", cip, server_id).await
                        {
                            error!("Firewall reattach failed for port {}: {}", fwd.host_port, e);
                            self.report_runtime_error(
                                crate::error_reporter::ErrorLevel::Warn,
                                "agent:firewall",
                                format!(
                                    "Firewall reattach failed for port {} on server {}: {}",
                                    fwd.host_port, server_id, e
                                ),
                                Some(serde_json::json!({ "serverId": server_id, "port": fwd.host_port })),
                            );
                        }
                    }
                } else {
                    info!(
                        "CNI reattached for {} at {} without prior port-forward state",
                        container_id, cip
                    );
                }
            }

            info!(
                "Network reattached for container {} (pid {})",
                container_id, pid
            );
            return Ok(());
        }

        // Config missing but prior port state was snapshotted above (the state
        // file was already deleted by teardown): re-bind DNAT to the current
        // IP when one is known.
        if let Ok(ip) = self.get_container_ip(container_id).await {
            if !ip.is_empty() {
                if let Some(prev) = &prev_forwards {
                    let mut forwards = Vec::new();
                    for fwd in prev.forwards.clone() {
                        if self
                            .setup_port_forward(fwd.host_port, fwd.container_port, &ip)
                            .await
                            .is_ok()
                        {
                            let _ =
                                FirewallManager::allow_port(fwd.host_port, "tcp", &ip, server_id)
                                    .await;
                            forwards.push(fwd);
                        }
                    }
                    if !forwards.is_empty() {
                        let state = PortForwardState {
                            container_ip: ip,
                            forwards,
                        };
                        if let Ok(j) = serde_json::to_string_pretty(&state) {
                            let _ = fs::write(&ports_path, &j);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    pub(crate) async fn teardown_cni_network(&self, container_id: &str) -> AgentResult<()> {
        let _ = self.teardown_port_forward(container_id).await;
        let rp = self
            .cni_results_dir
            .join(format!("catalyst-{}", container_id));
        if !rp.exists() {
            return Ok(());
        }
        // Load stored CNI config for proper teardown (bridge vs macvlan)
        let cfg_path = self
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        let cfg = fs::read_to_string(&cfg_path).ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(|| serde_json::json!({"cniVersion":"1.0.0","name":"catalyst","type":"bridge","bridge":self.cni_bridge_name,"ipam":{"type":"host-local","dataDir":self.cni_data_dir.to_string_lossy()}}));
        let mut tasks = TasksClient::new(self.channel.clone());
        let req = containerd_client::services::v1::GetRequest {
            container_id: container_id.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let netns = match tasks.get(req).await {
            Ok(r) => r
                .into_inner()
                .process
                .map(|p| format!("/proc/{}/ns/net", p.pid))
                .unwrap_or_default(),
            Err(_) => String::new(),
        };
        if !netns.is_empty() {
            let _ = self
                .exec_cni_plugin(&cfg, "DEL", container_id, &netns, "eth0")
                .await;
        } else {
            // Container is already gone (e.g. agent restart).  Try to release
            // the IPAM lease directly so the address is not permanently stuck.
            // The host-local IPAM plugin reads the result file to know which
            // address to free; if that also fails, fall back to removing the
            // lease file from the data directory.
            //
            // Snapshot this container's IPs now: the result/config files are
            // deleted below, and the NAT sweep at the end needs them.
            let stale_ips = self.state_ips_of_container(container_id).await;
            let ipam_data_dir = cfg["ipam"]["dataDir"]
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| self.cni_data_dir.to_string_lossy().to_string());
            let ipam_dir = PathBuf::from(ipam_data_dir).join("catalyst");
            let result_json = tokio::fs::read_to_string(&rp)
                .await
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
            if let Some(ref result) = result_json {
                if let Some(ips) = result.get("ips").and_then(|v| v.as_array()) {
                    for ip_entry in ips {
                        if let Some(addr) = ip_entry.get("address").and_then(|v| v.as_str()) {
                            // Strip CIDR prefix to get bare IP for the lease filename
                            let bare_ip = addr.split('/').next().unwrap_or(addr);
                            let lease = ipam_dir.join(bare_ip);
                            if lease.exists() {
                                info!(
                                    "Releasing stale CNI IPAM lease {} for container {}",
                                    bare_ip, container_id
                                );
                                let _ = fs::remove_file(&lease);
                            }
                        }
                    }
                }
            }
            // The container record itself may still exist (stopped) while its
            // task is gone; only sweep NAT when the record is gone too.
            // teardown_port_forward above already removed rules tracked in
            // ports.json — this catches the rest (e.g. CNI portmap chains
            // from older agents).
            if !self.container_exists(container_id).await {
                let mut ips = stale_ips;
                if let Some(live) = self.live_container_ips().await {
                    ips.retain(|ip| !live.contains(ip));
                } else {
                    ips.clear();
                }
                if !ips.is_empty() {
                    self.sweep_dead_nat_rules(&ips).await;
                }
            }
        }
        let _ = tokio::fs::remove_file(&rp).await;
        let _ = tokio::fs::remove_file(&cfg_path).await;
        Ok(())
    }

    /// Best-effort idempotency guard for `-A`: skip the rule when an
    /// identical one already exists (stop → start re-attach must not stack
    /// duplicates).
    /// All container IPs referenced by on-disk CNI state for one container:
    /// the CNI result file, the ports.json state, and IPAM lease filenames
    /// holding its ID.
    async fn state_ips_of_container(&self, container_id: &str) -> HashSet<String> {
        let mut out = HashSet::new();
        if let Ok(content) = tokio::fs::read_to_string(
            self.cni_results_dir
                .join(format!("catalyst-{}", container_id)),
        )
        .await
        {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(ips) = v.get("ips").and_then(|v| v.as_array()) {
                    for entry in ips {
                        if let Some(addr) = entry.get("address").and_then(|v| v.as_str()) {
                            let bare = addr.split('/').next().unwrap_or("");
                            if bare.parse::<std::net::IpAddr>().is_ok() {
                                out.insert(bare.to_string());
                            }
                        }
                    }
                }
            }
        }
        if let Ok(content) = tokio::fs::read_to_string(self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        )))
        .await
        {
            if let Ok(state) = serde_json::from_str::<PortForwardState>(&content) {
                if !state.container_ip.is_empty() {
                    out.insert(state.container_ip);
                }
            }
        }
        if let Ok(mut entries) = tokio::fs::read_dir(self.cni_data_dir.join("catalyst")).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.parse::<std::net::IpAddr>().is_err() {
                    continue;
                }
                if let Ok(content) = tokio::fs::read_to_string(entry.path()).await {
                    if content.trim() == container_id {
                        out.insert(name);
                    }
                }
            }
        }
        out
    }

    /// IPs currently owned by live containers in this agent's namespace.
    /// `None` when containerd cannot be listed — callers must skip sweeping
    /// then (an empty live set would misclassify everything as dead).
    async fn live_container_ips(&self) -> Option<HashSet<String>> {
        let containers = match self.list_containers().await {
            Ok(c) => c,
            Err(e) => {
                warn!(
                    "NAT sweep: cannot list containers, skipping live-IP guard: {}",
                    e
                );
                return None;
            }
        };
        let mut out = HashSet::new();
        for c in containers {
            // get_container_ip falls back to the result file, so stopped
            // containers keep their addresses too.
            if let Ok(ip) = self.get_container_ip(&c.id).await {
                if !ip.is_empty() {
                    out.insert(ip);
                }
            }
        }
        Some(out)
    }

    /// Delete one parsed NAT rule by exact spec. Missing rules (concurrent
    /// modification) are warnings, not errors.
    async fn delete_nat_rule(&self, cmd: &str, rule: &NatRule) {
        let mut args = vec!["-t", "nat", "-D", rule.chain.as_str()];
        args.extend(rule.spec.iter().map(|s| s.as_str()));
        match Command::new(cmd).args(&args).output().await {
            Ok(o) if o.status.success() => {
                info!("NAT sweep ({}): removed stale {} rule", cmd, rule.chain);
            }
            Ok(o) => {
                warn!(
                    "{} -D {} failed (likely already gone): {}",
                    cmd,
                    rule.chain,
                    String::from_utf8_lossy(&o.stderr).trim()
                );
            }
            Err(e) => {
                warn!("failed to run {}: {}", cmd, e);
            }
        }
    }

    /// Sweep one nat table: drop exact-duplicate rules and rules pointing at
    /// dead container IPs, then garbage-collect unreferenced `CNI-*` chains.
    /// Best-effort throughout; never fails.
    async fn sweep_nat_table(&self, cmd: &str, save_bin: &str, dead_ips: &HashSet<String>) {
        let out = match Command::new(save_bin).args(["-t", "nat"]).output().await {
            Ok(o) if o.status.success() => o,
            Ok(o) => {
                warn!(
                    "{} -t nat failed: {}",
                    save_bin,
                    String::from_utf8_lossy(&o.stderr).trim()
                );
                return;
            }
            Err(e) => {
                warn!("failed to run {}: {}", save_bin, e);
                return;
            }
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let (rules, refcounts, declared) = parse_nat_save(&text);
        if rules.is_empty() {
            return;
        }
        let (del_idx, chains) = plan_nat_cleanup(&rules, &refcounts, &declared, dead_ips);
        if del_idx.is_empty() && chains.is_empty() {
            return;
        }
        info!(
            "NAT sweep ({}): removing {} stale rules and {} orphaned chains",
            cmd,
            del_idx.len(),
            chains.len()
        );
        for idx in del_idx {
            if let Some(rule) = rules.get(idx) {
                self.delete_nat_rule(cmd, rule).await;
            }
        }
        for chain in chains {
            for args in [
                vec!["-t", "nat", "-F", chain.as_str()],
                vec!["-t", "nat", "-X", chain.as_str()],
            ] {
                match Command::new(cmd).args(&args).output().await {
                    Ok(o) if o.status.success() => {}
                    _ => break,
                }
            }
        }
    }

    /// Sweep stale NAT state for dead container IPs (IPv4 always, IPv6 when a
    /// dead address is v6). Runs the exact-duplicate pass unconditionally.
    pub(crate) async fn sweep_dead_nat_rules(&self, dead_ips: &HashSet<String>) {
        self.sweep_nat_table("iptables", "iptables-save", dead_ips)
            .await;
        if dead_ips.iter().any(|ip| ip.contains(':')) {
            self.sweep_nat_table("ip6tables", "ip6tables-save", dead_ips)
                .await;
        }
    }

    /// True when an IP belongs to this agent's bridge subnet. Jump-rule
    /// cleanup is scoped to it so one agent can never remove rules that
    /// belong to another agent's (or the host's) networks.
    fn bridge_subnet_contains(&self, ip: &str) -> bool {
        if let Some((net, prefix)) = self.cni_bridge_subnet.split_once('/') {
            if let Ok(prefix_len) = prefix.parse::<u8>() {
                return crate::net_utils::ip_in_subnet(ip, net, prefix_len);
            }
        }
        false
    }

    /// Global orphan sweep: collect every container IP referenced by on-disk
    /// CNI state, subtract live container IPs, and sweep NAT for the rest.
    /// Assumes one agent owns its CNI state dirs (the default); IPs with no
    /// state references are never touched.
    pub(crate) async fn sweep_orphaned_nat_rules(&self) {
        let live = match self.live_container_ips().await {
            Some(live) => live,
            None => return,
        };
        let mut candidates = HashSet::new();
        // CNI result files.
        if let Ok(mut entries) = tokio::fs::read_dir(&self.cni_results_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let fname = entry.file_name().to_string_lossy().to_string();
                if !fname.starts_with("catalyst-") || fname.contains("-config") {
                    continue;
                }
                if fname.ends_with("-ports.json") {
                    if let Ok(content) = tokio::fs::read_to_string(entry.path()).await {
                        if let Ok(state) = serde_json::from_str::<PortForwardState>(&content) {
                            if !state.container_ip.is_empty() {
                                candidates.insert(state.container_ip);
                            }
                        }
                    }
                    continue;
                }
                if let Ok(content) = tokio::fs::read_to_string(entry.path()).await {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(ips) = v.get("ips").and_then(|v| v.as_array()) {
                            for entry in ips {
                                if let Some(addr) = entry.get("address").and_then(|v| v.as_str()) {
                                    let bare = addr.split('/').next().unwrap_or("");
                                    if bare.parse::<std::net::IpAddr>().is_ok() {
                                        candidates.insert(bare.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // IPAM lease filenames.
        if let Ok(mut entries) = tokio::fs::read_dir(self.cni_data_dir.join("catalyst")).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.parse::<std::net::IpAddr>().is_ok() {
                    candidates.insert(name);
                }
            }
        }
        let dead: HashSet<String> = candidates.difference(&live).cloned().collect();
        if !dead.is_empty() {
            info!(
                "NAT sweep: {} dead container IPs with stale rules: {:?}",
                dead.len(),
                dead
            );
        }
        self.sweep_dead_nat_rules(&dead).await;

        // Second pass: `-s` jumps into CNI-* chains for dead containers that
        // left no state files (e.g. finished installers). Scoped to our
        // bridge subnet; liveness is checked per container record.
        self.sweep_dead_jump_rules().await;

        // Prune IPAM leases for IPs no live container holds, regardless of
        // which container ID the lease names (a live container that moved to
        // a new address orphans its old lease under its own ID).
        if let Ok(mut entries) = tokio::fs::read_dir(self.cni_data_dir.join("catalyst")).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.parse::<std::net::IpAddr>().is_err() || live.contains(&name) {
                    continue;
                }
                info!("Removing orphaned CNI IPAM lease {}", name);
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
    }

    /// Delete `-s <ip> -j CNI-*` jump rules whose comment names a container
    /// record that no longer exists. Only jumps with a source inside our own
    /// bridge subnet are eligible.
    pub(crate) async fn sweep_dead_jump_rules(&self) {
        let save = match Command::new("iptables")
            .args(["-t", "nat", "-S"])
            .output()
            .await
        {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => return,
        };
        // iptables -S prints one rule per line like iptables-save's -A form.
        let mut rules = Vec::new();
        for line in save.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("-A ") {
                let words = split_save_words(rest);
                if words.is_empty() {
                    continue;
                }
                rules.push(NatRule {
                    chain: words[0].clone(),
                    spec: words[1..].to_vec(),
                });
            }
        }
        // Resolve liveness once for every distinct comment ID in range.
        let mut cids: HashSet<String> = HashSet::new();
        for rule in &rules {
            let mut is_jump = false;
            let mut src: Option<&str> = None;
            let mut k = 0;
            while k < rule.spec.len() {
                match rule.spec[k].as_str() {
                    "-j" => {
                        is_jump = rule.spec.get(k + 1).is_some_and(|j| j.starts_with("CNI-"));
                        k += 2;
                    }
                    "-s" => {
                        src = rule.spec.get(k + 1).map(|s| s.as_str());
                        k += 2;
                    }
                    _ => {
                        k += 1;
                    }
                }
            }
            if !is_jump {
                continue;
            }
            let in_scope = src
                .and_then(normalize_rule_ip)
                .is_some_and(|ip| self.bridge_subnet_contains(&ip));
            if !in_scope {
                continue;
            }
            if let Some(cid) = comment_container_id(&rule.spec) {
                cids.insert(cid);
            }
        }
        let mut dead_cids = HashSet::new();
        let candidate_count = cids.len();
        for cid in cids {
            if !self.container_exists(&cid).await {
                dead_cids.insert(cid);
            }
        }
        info!(
            "NAT sweep: scanned {} nat rules, {} in-scope jump candidates, {} dead",
            rules.len(),
            candidate_count,
            dead_cids.len()
        );
        if dead_cids.is_empty() {
            return;
        }
        // Re-read for exact specs (table unchanged since we only read), then
        // delete and let the dupe/chain pass below collect the husks.
        let doomed = select_dead_jump_rules(&rules, &dead_cids);
        if doomed.is_empty() {
            return;
        }
        info!(
            "NAT sweep: removing {} jump rules for dead containers: {:?}",
            doomed.len(),
            dead_cids
        );
        for idx in doomed {
            if let Some(rule) = rules.get(idx) {
                self.delete_nat_rule("iptables", rule).await;
            }
        }
        // Chain garbage-collection (+ dupe pass) on the fresh table.
        self.sweep_dead_nat_rules(&HashSet::new()).await;
    }

    pub async fn cleanup_stale_cni_leases(&self) {
        // --- Phase 0: Sweep NAT for dead container IPs FIRST ---
        // Result files are deleted below; collect stale DNAT/MASQUERADE state
        // while the IPs are still derivable. Duplicate DNAT rules (re-attach
        // stacking) are removed here too.
        self.sweep_orphaned_nat_rules().await;

        // --- Phase 1: Release leases via CNI result files ---
        let results_dir = &self.cni_results_dir;
        if tokio::fs::try_exists(results_dir).await.unwrap_or(false) {
            if let Ok(mut entries) = tokio::fs::read_dir(results_dir).await {
                let mut stale_results: Vec<(String, String)> = Vec::new();
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    // Only CNI *result* files (`catalyst-<id>`) name a container.
                    // Port-forward state (`catalyst-<id>-ports.json`) and the
                    // stored plugin config (`catalyst-<id>-config`) must be
                    // skipped: stripping the prefix yields a bogus id
                    // (`<id>-ports.json`) whose existence check always fails,
                    // which previously deleted live DNAT bookkeeping on every
                    // agent restart.
                    if fname.ends_with("-ports.json") || fname.ends_with("-config") {
                        continue;
                    }
                    if let Some(cid) = fname.strip_prefix("catalyst-") {
                        stale_results.push((cid.to_string(), path.to_string_lossy().to_string()));
                    }
                }

                for (container_id, result_path) in &stale_results {
                    if self.container_exists(container_id).await {
                        continue;
                    }
                    info!(
                        "Container {} no longer exists, releasing stale CNI lease",
                        container_id
                    );
                    if let Err(e) = self.teardown_cni_network(container_id).await {
                        warn!(
                            "CNI teardown failed for stale container {}: {}",
                            container_id, e
                        );
                    }
                    let cfg_path = self
                        .cni_results_dir
                        .join(format!("catalyst-{}-config", container_id));
                    let _ = tokio::fs::remove_file(result_path).await;
                    let _ = tokio::fs::remove_file(&cfg_path).await;
                }
            }
        }

        // --- Phase 2: Scan IPAM data dir for orphaned leases ---
        // Even if result files are gone (e.g. agent was force-killed), the
        // host-local IPAM plugin may still hold lease files.  Cross-reference
        // each lease file's container ID against containerd.
        let ipam_base = self.cni_data_dir.join("catalyst");
        if !tokio::fs::try_exists(&ipam_base).await.unwrap_or(false) {
            return;
        }
        if let Ok(mut entries) = tokio::fs::read_dir(&ipam_base).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if let Ok(md) = tokio::fs::metadata(&path).await {
                    if !md.is_file() {
                        continue;
                    }
                } else {
                    continue;
                }
                // Lease files are named by IP address (e.g. 10.42.0.15)
                // and their contents hold the container ID.
                let container_id = tokio::fs::read_to_string(&path)
                    .await
                    .ok()
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                if container_id.is_empty() {
                    continue;
                }
                if self.container_exists(container_id.trim()).await {
                    continue;
                }
                info!(
                    "Removing orphaned CNI IPAM lease {} (container {})",
                    path.display(),
                    container_id
                );
                let _ = tokio::fs::remove_file(&path).await;
            }
        }
    }

    pub async fn start_ctr_events(
        &self,
    ) -> AgentResult<(
        CtrChildGuard,
        tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    )> {
        let child = Command::new("ctr")
            .args(["-n", &self.namespace, "events"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(false) // CtrChildGuard handles cleanup
            .spawn()
            .map_err(|e| AgentError::ContainerError(format!("ctr events spawn failed: {}", e)))?;

        let _ = child.stdout.as_ref().ok_or_else(|| {
            AgentError::ContainerError("ctr events: stdout pipe not available".into())
        })?;

        let guard = CtrChildGuard { child };
        let (guard, lines) = CtrChildGuard::into_lines(guard);
        Ok((guard, lines))
    }
}

/// One `-A <chain> ...` rule parsed from `iptables-save` output.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NatRule {
    chain: String,
    /// Tokens after `-A <chain>`, unescaped, suitable for an exact `-D` rebuild.
    spec: Vec<String>,
}

/// Split an iptables-save rule line into words, honouring single/double
/// quotes with backslash escapes (comments embed spaces and quotes).
fn split_save_words(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut chars = line.chars().peekable();
    let mut in_word = false;
    while let Some(c) = chars.next() {
        match quote {
            Some(q) => {
                if c == '\\' {
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                    in_word = true;
                } else if c == q {
                    quote = None;
                } else {
                    cur.push(c);
                    in_word = true;
                }
            }
            None => {
                if c == '"' || c == '\'' {
                    quote = Some(c);
                    in_word = true;
                } else if c.is_whitespace() {
                    if in_word {
                        out.push(std::mem::take(&mut cur));
                        in_word = false;
                    }
                } else {
                    cur.push(c);
                    in_word = true;
                }
            }
        }
    }
    if in_word {
        out.push(cur);
    }
    out
}

/// Normalize a NAT rule address token to a bare IP when it denotes exactly
/// one host: plain IPs, `[v6]` brackets, `host:port` DNAT destinations, and
/// `/32|/128` suffixed addresses. Wider subnets return None so a dead host
/// IP can never match a broader rule.
fn normalize_rule_ip(token: &str) -> Option<String> {
    let mut t = token;
    if let Some(stripped) = t.strip_prefix('[') {
        t = stripped.split(']').next().unwrap_or(stripped);
        return t.parse::<std::net::IpAddr>().ok().map(|ip| ip.to_string());
    }
    if let Some((addr, prefix)) = t.split_once('/') {
        if prefix != "32" && prefix != "128" {
            return None;
        }
        return addr
            .parse::<std::net::IpAddr>()
            .ok()
            .map(|ip| ip.to_string());
    }
    if let Some(idx) = t.rfind(':') {
        let (host, port) = t.split_at(idx);
        let port = &port[1..];
        if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) && !host.contains(':') {
            return host
                .parse::<std::net::IpAddr>()
                .ok()
                .map(|ip| ip.to_string());
        }
        // Bare IPv6 without port falls through to the plain parse below.
    }
    t.parse::<std::net::IpAddr>().ok().map(|ip| ip.to_string())
}

/// Extract the single container IP a NAT rule references, if any:
/// DNAT `--to-destination`, MASQUERADE `-d`, or jumps into `CNI-*` chains
/// pinned with `-s`.
fn nat_rule_ip(rule: &NatRule) -> Option<String> {
    let mut to_dest: Option<String> = None;
    let mut src: Option<String> = None;
    let mut dst: Option<String> = None;
    let mut jump: Option<&str> = None;
    let mut i = 0;
    while i < rule.spec.len() {
        match rule.spec[i].as_str() {
            "--to-destination" => {
                if let Some(v) = rule.spec.get(i + 1) {
                    to_dest = normalize_rule_ip(v);
                }
                i += 2;
            }
            "-s" => {
                if let Some(v) = rule.spec.get(i + 1) {
                    src = normalize_rule_ip(v);
                }
                i += 2;
            }
            "-d" => {
                if let Some(v) = rule.spec.get(i + 1) {
                    dst = normalize_rule_ip(v);
                }
                i += 2;
            }
            "-j" => {
                jump = rule.spec.get(i + 1).map(|s| s.as_str());
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }
    if to_dest.is_some() {
        return to_dest;
    }
    match jump {
        Some("MASQUERADE") => dst,
        Some(j) if j.starts_with("CNI-") => src,
        _ => None,
    }
}

/// Parse `iptables-save -t nat` output into rules, `-j` target refcounts,
/// and declared chain names.
fn parse_nat_save(
    save: &str,
) -> (
    Vec<NatRule>,
    std::collections::HashMap<String, usize>,
    Vec<String>,
) {
    let mut rules = Vec::new();
    let mut refcounts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut declared = Vec::new();
    for line in save.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('*') || line == "COMMIT" {
            continue;
        }
        if let Some(rest) = line.strip_prefix(':') {
            if let Some(name) = rest.split_whitespace().next() {
                declared.push(name.to_string());
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("-A ") {
            let words = split_save_words(rest);
            if words.is_empty() {
                continue;
            }
            let chain = words[0].clone();
            let spec = words[1..].to_vec();
            let mut k = 0;
            while k < spec.len() {
                if spec[k] == "-j" {
                    if let Some(t) = spec.get(k + 1) {
                        *refcounts.entry(t.clone()).or_insert(0) += 1;
                    }
                    k += 2;
                } else {
                    k += 1;
                }
            }
            rules.push(NatRule { chain, spec });
        }
    }
    (rules, refcounts, declared)
}

/// Plan deletions: exact-duplicate rules (keep the first occurrence) plus
/// rules whose container IP is dead. Returns rule indices and `CNI-*` chains
/// left with zero references once the planned deletions are applied.
fn plan_nat_cleanup(
    rules: &[NatRule],
    refcounts: &std::collections::HashMap<String, usize>,
    declared: &[String],
    dead_ips: &std::collections::HashSet<String>,
) -> (Vec<usize>, Vec<String>) {
    let mut delete = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (idx, rule) in rules.iter().enumerate() {
        let key = format!("{}\0{}", rule.chain, rule.spec.join("\0"));
        let is_dupe = !seen.insert(key);
        let is_dead = nat_rule_ip(rule)
            .as_ref()
            .is_some_and(|ip| dead_ips.contains(ip));
        if is_dupe || is_dead {
            delete.push(idx);
        }
    }
    let mut refs = refcounts.clone();
    for &idx in &delete {
        let spec = &rules[idx].spec;
        let mut k = 0;
        while k < spec.len() {
            if spec[k] == "-j" {
                if let Some(t) = spec.get(k + 1) {
                    if let Some(c) = refs.get_mut(t) {
                        *c = c.saturating_sub(1);
                    }
                }
                k += 2;
            } else {
                k += 1;
            }
        }
    }
    let mut chains: Vec<String> = declared
        .iter()
        .filter(|c| c.starts_with("CNI-"))
        .filter(|c| refs.get(*c).copied().unwrap_or(0) == 0)
        .cloned()
        .collect();
    chains.sort();
    chains.dedup();
    (delete, chains)
}

/// Extract the `id: "<container-id>"` value from a CNI rule comment token,
/// if present. Comments look like `name: "catalyst" id: "<cid>"`.
fn comment_container_id(spec: &[String]) -> Option<String> {
    for token in spec {
        if let Some(pos) = token.find("id:") {
            let rest = token[pos + 3..].trim_start();
            let rest = rest.strip_prefix('"').unwrap_or(rest);
            let end = rest.find('"').unwrap_or(rest.len());
            let cid = rest[..end].trim();
            if !cid.is_empty() {
                return Some(cid.to_string());
            }
        }
    }
    None
}

/// Indices of `-s <ip> -j CNI-*` jump rules whose comment names a dead
/// container. The caller resolves liveness (containerd); this pure selector
/// keeps the rule shape policy in one testable place.
fn select_dead_jump_rules(
    rules: &[NatRule],
    dead_cids: &std::collections::HashSet<String>,
) -> Vec<usize> {
    let mut out = Vec::new();
    for (idx, rule) in rules.iter().enumerate() {
        let mut jump: Option<&str> = None;
        let mut src: Option<&str> = None;
        let mut k = 0;
        while k < rule.spec.len() {
            match rule.spec[k].as_str() {
                "-j" => {
                    jump = rule.spec.get(k + 1).map(|s| s.as_str());
                    k += 2;
                }
                "-s" => {
                    src = rule.spec.get(k + 1).map(|s| s.as_str());
                    k += 2;
                }
                _ => {
                    k += 1;
                }
            }
        }
        let is_cni_jump = jump.is_some_and(|j| j.starts_with("CNI-"));
        if !is_cni_jump || src.is_none() {
            continue;
        }
        if let Some(cid) = comment_container_id(&rule.spec) {
            if dead_cids.contains(&cid) {
                out.push(idx);
            }
        }
    }
    out
}

/// Best-effort idempotency guard for `-A`: true when an identical rule
/// already exists. `args` is the exact `-A` argv shape (`-t nat -A ...`).
async fn rule_shape_present(cmd: &str, args: &[&str]) -> bool {
    if args.len() < 4 || args[0] != "-t" || args[1] != "nat" || args[2] != "-A" {
        return false;
    }
    let mut check = vec!["-t", "nat", "-C"];
    check.extend_from_slice(&args[3..]);
    Command::new(cmd)
        .args(&check)
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod nat_sweep_tests {
    use super::*;

    const FIXTURE: &str = r#"# Generated by iptables-save v1.8.11 (nf_tables)
*nat
:PREROUTING ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:POSTROUTING ACCEPT [0:0]
:CNI-aaa - [0:0]
:CNI-bbb - [0:0]
-A PREROUTING -p tcp -m tcp --dport 25566 -j DNAT --to-destination 10.44.0.15:25566
-A PREROUTING -p udp -m udp --dport 25566 -j DNAT --to-destination 10.44.0.15:25566
-A PREROUTING -p tcp -m tcp --dport 25566 -j DNAT --to-destination 10.44.0.13:25566
-A PREROUTING -p tcp -m tcp --dport 25566 -j DNAT --to-destination 10.44.0.13:25566
-A POSTROUTING -s 10.44.0.10/32 -m comment --comment "name: \"catalyst\" id: \"dead-installer\"" -j CNI-aaa
-A POSTROUTING -s 10.44.0.13/32 -m comment --comment "name: \"catalyst\" id: \"live-game\"" -j CNI-bbb
-A POSTROUTING -d 10.44.0.15/32 -p tcp -m tcp --dport 25566 -j MASQUERADE
-A POSTROUTING -d 10.44.0.13/32 -p tcp -m tcp --dport 25566 -j MASQUERADE
-A POSTROUTING -d 10.44.0.0/16 -j ACCEPT
COMMIT
"#;

    #[test]
    fn parses_dnat_and_masquerade_shapes() {
        let (rules, _, _) = parse_nat_save(FIXTURE);
        assert_eq!(rules.len(), 9);
        assert_eq!(nat_rule_ip(&rules[0]).as_deref(), Some("10.44.0.15"));
        assert_eq!(rules[0].chain, "PREROUTING");
        assert_eq!(nat_rule_ip(&rules[6]).as_deref(), Some("10.44.0.15"));
        // Subnet rules never match a host IP.
        assert_eq!(nat_rule_ip(&rules[8]), None);
    }

    #[test]
    fn parses_commented_jump_with_escaped_quotes() {
        let (rules, refcounts, declared) = parse_nat_save(FIXTURE);
        assert_eq!(nat_rule_ip(&rules[4]).as_deref(), Some("10.44.0.10"));
        assert_eq!(refcounts.get("CNI-aaa"), Some(&1));
        assert_eq!(refcounts.get("CNI-bbb"), Some(&1));
        assert!(declared.contains(&"CNI-aaa".to_string()));
    }

    #[test]
    fn plans_dead_deletion_and_dupe_removal() {
        let (rules, refcounts, declared) = parse_nat_save(FIXTURE);
        let dead: HashSet<String> = ["10.44.0.15".to_string(), "10.44.0.10".to_string()]
            .into_iter()
            .collect();
        let (del, chains) = plan_nat_cleanup(&rules, &refcounts, &declared, &dead);
        // Rules 0,1 (dead .15 DNAT), rule 3 (exact dupe of rule 2), rule 4
        // (dead .10 jump), rule 6 (dead .15 MASQUERADE). Live .13 rules stay.
        assert_eq!(del, vec![0, 1, 3, 4, 6]);
        // CNI-aaa loses its only reference; CNI-bbb stays referenced.
        assert_eq!(chains, vec!["CNI-aaa".to_string()]);
    }

    #[test]
    fn delete_spec_preserves_argv_tokens() {
        let (rules, _, _) = parse_nat_save(FIXTURE);
        let rule = &rules[4];
        let mut rebuilt = vec!["-A".to_string(), rule.chain.clone()];
        rebuilt.extend(rule.spec.clone());
        assert_eq!(
            rebuilt.join(" "),
            "-A POSTROUTING -s 10.44.0.10/32 -m comment --comment name: \"catalyst\" id: \"dead-installer\" -j CNI-aaa"
        );
    }

    #[test]
    fn normalize_rule_ip_rejects_subnets() {
        assert_eq!(
            normalize_rule_ip("10.44.0.10/32").as_deref(),
            Some("10.44.0.10")
        );
        assert_eq!(normalize_rule_ip("10.44.0.0/16"), None);
        assert_eq!(
            normalize_rule_ip("[fd00::5]:25566").as_deref(),
            Some("fd00::5")
        );
        assert_eq!(normalize_rule_ip("not-an-ip"), None);
    }

    #[test]
    fn empty_save_plans_nothing() {
        let (rules, refcounts, declared) = parse_nat_save("# empty\n*nat\nCOMMIT\n");
        let dead = HashSet::new();
        let (del, chains) = plan_nat_cleanup(&rules, &refcounts, &declared, &dead);
        assert!(del.is_empty());
        assert!(chains.is_empty());
    }

    #[test]
    fn comment_container_id_parses_portmap_comments() {
        let spec = split_save_words(
            r#"-s 10.44.0.10/32 -m comment --comment "name: \"catalyst\" id: \"dead-beef\"" -j CNI-aaa"#,
        );
        // First word is the -s flag; the helper scans the whole spec.
        assert_eq!(comment_container_id(&spec), Some("dead-beef".to_string()));
        let plain =
            split_save_words("-p tcp --dport 25566 -j DNAT --to-destination 10.0.0.5:25566");
        assert_eq!(comment_container_id(&plain), None);
    }

    #[test]
    fn select_dead_jump_rules_keeps_live_containers() {
        let (rules, _, _) = parse_nat_save(FIXTURE);
        // Rule 4 jumps for dead-installer, rule 5 for live-game.
        let dead: HashSet<String> = ["dead-installer".to_string()].into_iter().collect();
        assert_eq!(select_dead_jump_rules(&rules, &dead), vec![4]);
        let live_too: HashSet<String> = ["dead-installer".to_string(), "live-game".to_string()]
            .into_iter()
            .collect();
        assert_eq!(select_dead_jump_rules(&rules, &live_too), vec![4, 5]);
        let empty = HashSet::new();
        assert!(select_dead_jump_rules(&rules, &empty).is_empty());
    }
}
