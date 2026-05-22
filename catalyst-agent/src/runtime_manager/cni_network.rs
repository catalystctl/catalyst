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
                    self.setup_port_forward(*hp, *cp, cip).await?;
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
        let ppath = format!("{}/{}", cni_bin_dir.display(), ptype);
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
        // Set up forwarding for both TCP and UDP (many game servers use UDP)
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
                let o = Command::new(cmd).args(&args).output().await?;
                if !o.status.success() {
                    warn!("{}: {}", cmd, String::from_utf8_lossy(&o.stderr));
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
            let o = Command::new(cmd).args(&args).output().await?;
            if !o.status.success() {
                warn!("{}: {}", cmd, String::from_utf8_lossy(&o.stderr));
            }
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


    pub(crate) async fn teardown_port_forward_rules(&self, hp: u16, cp: u16, cip: &str) -> AgentResult<()> {
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
        }
        let _ = tokio::fs::remove_file(&rp).await;
        let _ = tokio::fs::remove_file(&cfg_path).await;
        Ok(())
    }


    pub async fn cleanup_stale_cni_leases(&self) {
        // --- Phase 1: Release leases via CNI result files ---
        let results_dir = &self.cni_results_dir;
        if tokio::fs::try_exists(results_dir).await.unwrap_or(false) {
            if let Ok(mut entries) = tokio::fs::read_dir(results_dir).await {
                let mut stale_results: Vec<(String, String)> = Vec::new();
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if let Some(cid) = fname.strip_prefix("catalyst-") {
                        if fname.contains("-config") {
                            continue;
                        }
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
        let mut child = Command::new("ctr")
            .args(["-n", &self.namespace, "events"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(false) // CtrChildGuard handles cleanup
            .spawn()
            .map_err(|e| AgentError::ContainerError(format!(
                "ctr events spawn failed: {}", e
            )))?;

        let _ = child.stdout.as_ref().ok_or_else(|| {
            AgentError::ContainerError("ctr events: stdout pipe not available".into())
        })?;

        let guard = CtrChildGuard { child };
        let (guard, lines) = CtrChildGuard::into_lines(guard);
        Ok((guard, lines))
    }


}
