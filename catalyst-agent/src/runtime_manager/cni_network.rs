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
        // Persist the exact plugin config before ADD. If this fails no plugin has
        // run, so returning the error is both safe and sufficient; proceeding
        // would create network state that teardown could not identify reliably.
        let cfg_path = self
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        let config_json = serde_json::to_string(&cfg).map_err(|e| {
            AgentError::ContainerError(format!(
                "Failed to serialize CNI config for {}: {}",
                container_id, e
            ))
        })?;
        let config_preexisting = fs::symlink_metadata(&cfg_path).is_ok();
        if let Err(error) = self.write_state_file(&cfg_path, &config_json) {
            // `write` can create/truncate before returning an error. No ADD has
            // run, so a newly-created partial file has no recovery value; a
            // pre-existing path is retained rather than risking foreign state.
            if !config_preexisting {
                if let Err(cleanup) = remove_state_file(&cfg_path).await {
                    return Err(AgentError::ContainerError(format!(
                        "{}; partial CNI config cleanup also failed: {}",
                        error, cleanup
                    )));
                }
            }
            return Err(error);
        }

        // CNI ADD may allocate an IP and install rules before reporting an
        // error. Always run the compensating DEL/owned-lease cleanup with the
        // namespace we already resolved rather than depending on a result file
        // (which deliberately does not exist on this path).
        let result = match self
            .exec_cni_plugin(&cfg, "ADD", container_id, &netns, "eth0")
            .await
        {
            Ok(result) => result,
            Err(error) => {
                return Err(self
                    .rollback_failed_cni_setup(container_id, &netns, error)
                    .await);
            }
        };
        let rp = self
            .cni_results_dir
            .join(format!("catalyst-{}", container_id));
        let result_json = match serde_json::to_string_pretty(&result) {
            Ok(json) => json,
            Err(error) => {
                return Err(self
                    .rollback_failed_cni_setup(
                        container_id,
                        &netns,
                        AgentError::ContainerError(format!(
                            "Failed to serialize CNI result for {}: {}",
                            container_id, error
                        )),
                    )
                    .await);
            }
        };
        if let Err(error) = self.write_state_file(&rp, &result_json) {
            return Err(self
                .rollback_failed_cni_setup(container_id, &netns, error)
                .await);
        }
        let cip = match cni_result_ip(&result) {
            Ok(ip) => ip,
            Err(error) => {
                return Err(self
                    .rollback_failed_cni_setup(container_id, &netns, error)
                    .await);
            }
        };
        if let Err(error) = self
            .setup_cni_port_forwards(container_id, &cip, primary_port, port_bindings)
            .await
        {
            return Err(self
                .rollback_failed_cni_setup(container_id, &netns, error)
                .await);
        }

        // For bridge network, ensure FORWARD rules allow traffic to external
        if network == "bridge" || network == "default" {
            if let Err(error) = self.ensure_bridge_forward_rules().await {
                return Err(self
                    .rollback_failed_cni_setup(container_id, &netns, error)
                    .await);
            }
        }

        Ok(())
    }

    /// Set up all requested forwards as one transaction. The attempted rule is
    /// included in rollback as well as earlier successful rules: a single
    /// `setup_port_forward` call can fail after installing only part of its
    /// TCP/UDP/PREROUTING/OUTPUT/MASQUERADE rule set.
    async fn setup_cni_port_forwards(
        &self,
        container_id: &str,
        container_ip: &str,
        primary_port: u16,
        port_bindings: &HashMap<u16, u16>,
    ) -> AgentResult<()> {
        let mut forwards = Vec::new();
        if !port_bindings.is_empty() {
            for (container_port, host_port) in port_bindings {
                forwards.push(PortForward {
                    host_port: *host_port,
                    container_port: *container_port,
                });
            }
        } else if primary_port > 0 {
            forwards.push(PortForward {
                host_port: primary_port,
                container_port: primary_port,
            });
        }

        let state_path = self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        ));
        let mut setup_error = None;
        for forward in &forwards {
            if let Err(error) = self
                .setup_port_forward(forward.host_port, forward.container_port, container_ip)
                .await
            {
                setup_error = Some(error);
                break;
            }
        }
        if setup_error.is_none() && !forwards.is_empty() {
            let state = PortForwardState {
                container_ip: container_ip.to_string(),
                forwards: forwards.clone(),
            };
            match serde_json::to_string_pretty(&state) {
                Ok(json) => {
                    // This write is intentionally not `?`: on failure the
                    // in-memory attempted-rule list below can still roll back.
                    match self.write_state_file(&state_path, &json) {
                        Ok(()) => return Ok(()),
                        Err(error) => setup_error = Some(error),
                    }
                }
                Err(error) => {
                    setup_error = Some(AgentError::ContainerError(format!(
                        "Failed to serialize port-forward state for {}: {}",
                        container_id, error
                    )));
                }
            }
        } else if setup_error.is_none() {
            return Ok(());
        }

        let primary = setup_error.expect("setup error checked above");
        let mut rollback_errors = Vec::new();
        // Preserve the full attempted set for the outer CNI rollback. Rules
        // which were never installed are harmless: DELETE treats an already
        // absent exact rule as clean.
        match serde_json::to_string_pretty(&PortForwardState {
            container_ip: container_ip.to_string(),
            forwards: forwards.clone(),
        }) {
            Ok(state) => {
                if let Err(error) = self.write_state_file(&state_path, &state) {
                    rollback_errors.push(error.to_string());
                }
            }
            Err(error) => rollback_errors.push(format!(
                "Failed to serialize rollback port-forward state for {}: {}",
                container_id, error
            )),
        }
        for forward in &forwards {
            if let Err(error) = self
                .teardown_port_forward_rules(
                    forward.host_port,
                    forward.container_port,
                    container_ip,
                )
                .await
            {
                rollback_errors.push(error.to_string());
            }
        }
        if rollback_errors.is_empty() {
            Err(primary)
        } else {
            Err(AgentError::NetworkError(format!(
                "{}; port-forward rollback also failed: {}",
                primary,
                rollback_errors.join("; ")
            )))
        }
    }

    async fn rollback_failed_cni_setup(
        &self,
        container_id: &str,
        netns: &str,
        primary: AgentError,
    ) -> AgentError {
        match self
            .teardown_cni_network_with_netns(container_id, Some(netns))
            .await
        {
            Ok(()) => primary,
            Err(cleanup) => AgentError::ContainerError(format!(
                "{}; CNI setup rollback also failed: {}",
                primary, cleanup
            )),
        }
    }

    pub(crate) async fn ensure_bridge_forward_rules(&self) -> AgentResult<()> {
        let external_iface =
            match tokio::time::timeout(CLEANUP_COMMAND_TIMEOUT, detect_default_route_interface())
                .await
            {
                Ok(Some(interface)) => interface,
                Ok(None) => return Err(AgentError::NetworkError(
                    "Could not detect a usable default route interface for bridge FORWARD rules"
                        .to_string(),
                )),
                Err(_) => {
                    return Err(AgentError::NetworkError(format!(
                        "Default route lookup timed out after {}s",
                        CLEANUP_COMMAND_TIMEOUT.as_secs()
                    )))
                }
            };
        let iface = external_iface.as_str();
        let bridge_name = self.cni_bridge_name.as_str();

        // Reconcile each direction independently. The old nested branch skipped
        // the return direction whenever only bridge->external already existed.
        for (input, output) in [(bridge_name, iface), (iface, bridge_name)] {
            let check = ["-C", "FORWARD", "-i", input, "-o", output, "-j", "ACCEPT"];
            match run_bounded_command("iptables", &check).await {
                Ok(check_result) if check_result.status.success() => continue,
                Ok(check_result) if iptables_rule_is_absent(&check_result) => {}
                Ok(check_result) => {
                    return Err(AgentError::NetworkError(format!(
                        "Could not verify FORWARD {} -> {}: {}",
                        input,
                        output,
                        String::from_utf8_lossy(&check_result.stderr).trim()
                    )))
                }
                Err(error) => return Err(error),
            }
            let insert = [
                "-I", "FORWARD", "1", "-i", input, "-o", output, "-j", "ACCEPT",
            ];
            let result = run_bounded_command("iptables", &insert).await?;
            if !result.status.success() {
                return Err(AgentError::NetworkError(format!(
                    "Failed to add FORWARD {} -> {}: {}",
                    input,
                    output,
                    String::from_utf8_lossy(&result.stderr).trim()
                )));
            }
            info!("Reconciled FORWARD rule: {} -> {}", input, output);
        }
        Ok(())
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
            match tokio::time::timeout(Duration::from_secs(2), tasks.get(req)).await {
                Ok(Ok(resp)) => {
                    pid = resp.into_inner().process.map(|p| p.pid).unwrap_or(0);
                }
                Ok(Err(err)) => {
                    last_get_err = Some(format!("{}: {}", err.code(), err.message()));
                }
                Err(_) => {
                    last_get_err = Some("task.get timed out after 2s".to_string());
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
        const CNI_PLUGIN_TIMEOUT: Duration = Duration::from_secs(30);
        let mut child = Command::new(&ppath)
            .kill_on_drop(true)
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
        let out = tokio::time::timeout(CNI_PLUGIN_TIMEOUT, async move {
            if let Some(mut stdin) = child.stdin.take() {
                use tokio::io::AsyncWriteExt;
                stdin.write_all(cfg.as_bytes()).await?;
                drop(stdin);
            }
            child.wait_with_output().await
        })
        .await
        .map_err(|_| {
            AgentError::ContainerError(format!(
                "CNI {} plugin timed out after {}s",
                ptype,
                CNI_PLUGIN_TIMEOUT.as_secs()
            ))
        })?
        .map_err(AgentError::from)?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let plugin_msg = serde_json::from_slice::<serde_json::Value>(&out.stdout)
                .ok()
                .and_then(|v| v.get("msg").and_then(|m| m.as_str()).map(|s| s.to_string()))
                .unwrap_or_default();
            let network = config
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("<unnamed>");
            return Err(AgentError::ContainerError(format!(
                "CNI {} failed (network={}, container={}, plugin={}, netns={}, status={}): msg='{}' stderr='{}' stdout='{}'",
                command, network, cid, ptype, netns, out.status, plugin_msg, stderr, stdout
            )));
        }
        // A successful DEL commonly emits no result. A successful ADD does:
        // accepting `{}` here previously started isolated tasks with no IP and
        // left no reliable recovery record for their port mappings.
        if command != "ADD" && out.stdout.iter().all(|byte| byte.is_ascii_whitespace()) {
            return Ok(serde_json::json!({}));
        }
        let network = config
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("<unnamed>");
        let result: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|error| {
            AgentError::ContainerError(format!(
                "CNI {} for container {} on network {} returned invalid JSON: {}",
                command, cid, network, error
            ))
        })?;
        if command == "ADD" {
            cni_result_ip(&result).map_err(|error| {
                AgentError::ContainerError(format!(
                    "CNI ADD for container {} on network {} returned an invalid result: {}",
                    cid, network, error
                ))
            })?;
        }
        Ok(result)
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
                for chain in ["PREROUTING", "OUTPUT"] {
                    let args = dnat_rule_args("-A", chain, proto, &hps, &dest, true);
                    if rule_shape_present(cmd, &args).await {
                        continue;
                    }
                    match run_bounded_command(cmd, &args).await {
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
                match run_bounded_command(cmd, &args).await {
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
            let rollback_error = if any_rule_added {
                warn!(
                    "Port-forward setup partially failed for {}:{} -> {}:{}; tearing down rules added in this call",
                    hp, cp, cip, cp
                );
                self.teardown_port_forward_rules(hp, cp, cip)
                    .await
                    .err()
                    .map(|error| error.to_string())
            } else {
                None
            };
            return Err(AgentError::NetworkError(format!(
                "Port-forward setup failed for host {} -> {}/{}: {}{}",
                hp,
                cip,
                cp,
                err,
                rollback_error
                    .map(|error| format!("; immediate rollback failed: {}", error))
                    .unwrap_or_default()
            )));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) async fn teardown_port_forward(&self, container_id: &str) -> AgentResult<()> {
        let state_path = self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        ));
        self.teardown_recorded_port_forward_rules(container_id)
            .await?;
        remove_state_file(&state_path).await
    }

    /// Remove the recorded rules but leave the complete state file in place.
    /// Full CNI teardown calls this as one transactional stage and deletes the
    /// file only after DEL, address-safety checks and lease removal all succeed.
    async fn teardown_recorded_port_forward_rules(&self, container_id: &str) -> AgentResult<()> {
        let state_path = self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        ));
        let raw = match fs::read_to_string(&state_path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(AgentError::NetworkError(format!(
                    "Failed to read port-forward state {}; retaining it for retry: {}",
                    state_path.display(),
                    error
                )))
            }
        };
        let state: PortForwardState = serde_json::from_str(&raw).map_err(|error| {
            AgentError::NetworkError(format!(
                "Failed to parse port-forward state {}; retaining it for retry: {}",
                state_path.display(),
                error
            ))
        })?;

        let mut errors = Vec::new();
        for forward in &state.forwards {
            if let Err(error) = self
                .teardown_port_forward_rules(
                    forward.host_port,
                    forward.container_port,
                    &state.container_ip,
                )
                .await
            {
                errors.push(error.to_string());
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(AgentError::NetworkError(format!(
                "Port-forward cleanup incomplete for {}; retaining {}: {}",
                container_id,
                state_path.display(),
                errors.join("; ")
            )))
        }
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
        let mut deletions = Vec::new();
        for proto in ["tcp", "udp"] {
            for chain in ["PREROUTING", "OUTPUT"] {
                // Delete both the scoped current shape and the historical broad
                // shape. This migrates old installations without leaving an
                // unscoped DNAT rule behind after an upgrade or a rollback.
                for local_only in [true, false] {
                    deletions.push(dnat_rule_args("-D", chain, proto, &hps, &dest, local_only));
                }
            }
        }
        deletions.extend([
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
        ]);

        let mut errors = Vec::new();
        for args in deletions {
            match run_bounded_command(cmd, &args).await {
                Ok(output) if output.status.success() || iptables_rule_is_absent(&output) => {}
                Ok(output) => errors.push(format!(
                    "{} -D failed: {}",
                    cmd,
                    String::from_utf8_lossy(&output.stderr).trim()
                )),
                Err(error) => errors.push(error.to_string()),
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(AgentError::NetworkError(format!(
                "Failed to remove all port-forward rules for host {} -> {}:{}: {}",
                hp,
                cip,
                cp,
                errors.join("; ")
            )))
        }
    }

    /// Re-attach CNI networking, port forwards, and firewall when restarting an
    /// existing container task (stop → start without full recreate).
    ///
    /// All recovery inputs are parsed before any mutation. The returned guard
    /// lets start_container compensate a later task-start failure too. A legacy
    /// result/ports file without its exact config is unsafe to reconstruct: it
    /// fails closed and retains every state file rather than claiming a CNI ADD
    /// occurred or rebinding ports through an unrelated network.
    pub(crate) async fn reattach_network_on_start(
        &self,
        container_id: &str,
        pid: u32,
        server_id: &str,
    ) -> AgentResult<Option<NetworkReattachRollback>> {
        let result_path = self
            .cni_results_dir
            .join(format!("catalyst-{}", container_id));
        let cfg_path = self
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        let ports_path = self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        ));

        let previous_result = read_optional_state(&result_path, "CNI result")?;
        let config_raw = read_optional_state(&cfg_path, "CNI config")?;
        let previous_ports_raw = read_optional_state(&ports_path, "port-forward state")?;
        if previous_result.is_none() && config_raw.is_none() && previous_ports_raw.is_none() {
            debug!(
                "No prior CNI/port-forward state for {}; skipping network reattach",
                container_id
            );
            return Ok(None);
        }
        let Some(config_raw) = config_raw else {
            return Err(AgentError::NetworkError(format!(
                "Cannot safely reattach {}: prior CNI result/port state exists but its exact config is missing; retaining all state",
                container_id
            )));
        };
        let cfg: serde_json::Value = serde_json::from_str(&config_raw).map_err(|error| {
            AgentError::ContainerError(format!(
                "Failed to parse CNI config for {} before reattach; retaining all state: {}",
                container_id, error
            ))
        })?;
        let network = cfg
            .get("name")
            .and_then(|name| name.as_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| {
                AgentError::NetworkError(format!(
                    "Stored CNI config for {} has no network name; retaining all state",
                    container_id
                ))
            })?
            .to_string();
        crate::net_utils::validate_cni_network_name(&network)?;

        let previous_ports = previous_ports_raw
            .as_deref()
            .map(|raw| {
                serde_json::from_str::<PortForwardState>(raw).map_err(|error| {
                    AgentError::NetworkError(format!(
                        "Failed to parse port-forward state for {} before reattach; retaining all state: {}",
                        container_id, error
                    ))
                })
            })
            .transpose()?;
        if let Some(state) = &previous_ports {
            if !state.forwards.is_empty() {
                let valid_ip = !state.container_ip.is_empty()
                    && state.container_ip.parse::<std::net::IpAddr>().is_ok();
                if !valid_ip {
                    return Err(AgentError::NetworkError(format!(
                        "Port-forward state for {} has an invalid container IP; retaining all state",
                        container_id
                    )));
                }
            }
        }

        // Resolve the new namespace before touching old NAT rules. If this is
        // indeterminate or unavailable, the persistent desired state is intact.
        let netns = self.resolve_task_netns(container_id, pid).await?;
        let mut rollback = NetworkReattachRollback {
            container_id: container_id.to_string(),
            network,
            config: cfg.clone(),
            netns,
            result_path,
            ports_path,
            previous_result,
            previous_ports_raw,
            current_ip: None,
            attempted_forwards: Vec::new(),
            firewall_configured: false,
            result_committed: false,
            ports_committed: false,
        };

        let result = match self
            .exec_cni_plugin(&cfg, "ADD", container_id, &rollback.netns, "eth0")
            .await
        {
            Ok(result) => result,
            Err(error) => {
                return Err(rollback
                    .rollback(self, reattach_primary(container_id, error))
                    .await)
            }
        };
        let cip = match cni_result_ip(&result) {
            Ok(ip) => ip,
            Err(error) => {
                return Err(rollback
                    .rollback(self, reattach_primary(container_id, error))
                    .await)
            }
        };
        rollback.current_ip = Some(cip.clone());

        let is_catalyst_bridge = cfg.get("type").and_then(|v| v.as_str()) == Some("bridge")
            && cfg.get("bridge").and_then(|v| v.as_str()) == Some(self.cni_bridge_name.as_str());
        if is_catalyst_bridge {
            if let Err(error) = self.ensure_bridge_forward_rules().await {
                return Err(rollback
                    .rollback(self, reattach_primary(container_id, error))
                    .await);
            }
        }

        // Remove old exact rules without deleting their state file. The full
        // desired set is therefore available both for reconstruction and for a
        // subsequent retry if this reattach fails.
        if let Some(state) = &previous_ports {
            for forward in &state.forwards {
                if let Err(error) = self
                    .teardown_port_forward_rules(
                        forward.host_port,
                        forward.container_port,
                        &state.container_ip,
                    )
                    .await
                {
                    return Err(rollback
                        .rollback(self, reattach_primary(container_id, error))
                        .await);
                }
            }
        }

        // Install every desired forward or none. Include the currently attempted
        // mapping in rollback because setup_port_forward may fail after adding
        // only a subset of its TCP/UDP/chained rules (its immediate rollback is
        // also allowed to fail).
        if let Some(state) = &previous_ports {
            for forward in &state.forwards {
                rollback.attempted_forwards.push(forward.clone());
                if let Err(error) = self
                    .setup_port_forward(forward.host_port, forward.container_port, &cip)
                    .await
                {
                    return Err(rollback
                        .rollback(self, reattach_primary(container_id, error))
                        .await);
                }
            }
            for forward in &state.forwards {
                rollback.firewall_configured = true;
                if let Err(error) =
                    FirewallManager::allow_port(forward.host_port, "tcp", &cip, server_id).await
                {
                    self.report_runtime_error(
                        crate::error_reporter::ErrorLevel::Warn,
                        "agent:firewall",
                        format!(
                            "Firewall reattach failed for port {} on server {}: {}",
                            forward.host_port, server_id, error
                        ),
                        Some(serde_json::json!({
                            "serverId": server_id,
                            "port": forward.host_port
                        })),
                    );
                    return Err(rollback
                        .rollback(self, reattach_primary(container_id, error))
                        .await);
                }
            }
        }

        let result_json = match serde_json::to_string_pretty(&result) {
            Ok(json) => json,
            Err(error) => {
                return Err(rollback
                    .rollback(
                        self,
                        reattach_primary(
                            container_id,
                            AgentError::ContainerError(format!(
                                "Failed to serialize reattached CNI result: {}",
                                error
                            )),
                        ),
                    )
                    .await)
            }
        };
        let next_ports_json = match previous_ports.as_ref() {
            Some(state) => match serde_json::to_string_pretty(&PortForwardState {
                container_ip: cip,
                forwards: state.forwards.clone(),
            }) {
                Ok(json) => Some(json),
                Err(error) => {
                    return Err(rollback
                        .rollback(
                            self,
                            reattach_primary(
                                container_id,
                                AgentError::ContainerError(format!(
                                    "Failed to serialize reattached port state: {}",
                                    error
                                )),
                            ),
                        )
                        .await)
                }
            },
            None => None,
        };

        // Atomic per-file replacement prevents a torn write from destroying the
        // only recovery record. If the second rename fails, rollback restores
        // the first file's exact old bytes too.
        if let Err(error) = self.write_state_file_atomic(&rollback.result_path, &result_json) {
            return Err(rollback
                .rollback(self, reattach_primary(container_id, error))
                .await);
        }
        rollback.result_committed = true;
        if let Some(json) = next_ports_json {
            if let Err(error) = self.write_state_file_atomic(&rollback.ports_path, &json) {
                return Err(rollback
                    .rollback(self, reattach_primary(container_id, error))
                    .await);
            }
            rollback.ports_committed = true;
        }

        info!(
            "Network reattached for container {} on {} (pid {})",
            container_id, rollback.network, pid
        );
        Ok(Some(rollback))
    }

    pub(crate) async fn teardown_cni_network(&self, container_id: &str) -> AgentResult<()> {
        self.teardown_cni_network_with_netns(container_id, None)
            .await
    }

    /// Teardown with an optional namespace already resolved by setup.
    async fn teardown_cni_network_with_netns(
        &self,
        container_id: &str,
        known_netns: Option<&str>,
    ) -> AgentResult<()> {
        let rp = self
            .cni_results_dir
            .join(format!("catalyst-{}", container_id));
        let cfg_path = self
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        let ports_path = self.cni_results_dir.join(format!(
            "{}{}-ports.json",
            PORT_FWD_STATE_PREFIX, container_id
        ));
        let mut stale_ips = self.state_ips_of_container(container_id).await;
        let mut errors = Vec::new();

        let (result_present, result_readable) = match fs::metadata(&rp) {
            Ok(_) => (true, true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (false, true),
            Err(error) => {
                errors.push(format!(
                    "Failed to inspect CNI result {}: {}",
                    rp.display(),
                    error
                ));
                (true, false)
            }
        };
        let (config_present, cfg) = match fs::read_to_string(&cfg_path) {
            Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(cfg) => (true, Some(cfg)),
                Err(error) => {
                    errors.push(format!(
                        "Failed to parse CNI config {}; retaining it for retry: {}",
                        cfg_path.display(),
                        error
                    ));
                    (true, None)
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (false, None),
            Err(error) => {
                errors.push(format!(
                    "Failed to read CNI config {}; retaining it for retry: {}",
                    cfg_path.display(),
                    error
                ));
                (true, None)
            }
        };

        if !result_present && !config_present {
            // Exact old/current DNAT shapes are attempted using the ports file
            // itself; no task/config can be consulted on this legacy branch.
            // Never infer or scan a custom IPAM directory without that config.
            if let Err(error) = self
                .teardown_recorded_port_forward_rules(container_id)
                .await
            {
                errors.push(error.to_string());
            }
            if ports_path.exists() {
                errors.push(format!(
                    "Ports-only state for {} has no exact CNI config; its custom IPAM directory cannot be inferred safely, so the record and owned lease are retained",
                    container_id
                ));
            } else if errors.is_empty() {
                if let Err(error) = remove_state_file(&ports_path).await {
                    errors.push(error.to_string());
                }
            }
            return cni_cleanup_result(container_id, errors);
        }

        // A result without a config can occur in old installations. Preserve
        // the legacy bridge fallback only for that case; a present but broken
        // config must never be substituted with another network's config.
        let cfg = match cfg {
            Some(cfg) => cfg,
            None if !config_present && result_present && result_readable => serde_json::json!({
                "cniVersion": "1.0.0", "name": "catalyst", "type": "bridge",
                "bridge": self.cni_bridge_name,
                "ipam": {"type": "host-local", "dataDir": self.cni_data_dir.to_string_lossy()}
            }),
            None => return cni_cleanup_result(container_id, errors),
        };
        let ipam_dir = match self.cni_ipam_dir(&cfg) {
            Ok(dir) => dir,
            Err(error) => {
                errors.push(error.to_string());
                return cni_cleanup_result(container_id, errors);
            }
        };

        let (netns, task_known) = match known_netns {
            Some(netns) if !netns.is_empty() && Path::new(netns).exists() => {
                (netns.to_string(), true)
            }
            // A fast-failing installer can exit between ADD and rollback. Its
            // recorded /proc path is no longer a usable namespace; take the
            // same owned-lease fallback as an already-deleted containerd task.
            Some(_) => (String::new(), true),
            None => {
                let mut tasks = TasksClient::new(self.channel.clone());
                let req = containerd_client::services::v1::GetRequest {
                    container_id: container_id.to_string(),
                    ..Default::default()
                };
                let req = with_namespace!(req, &self.namespace);
                match tokio::time::timeout(Duration::from_secs(5), tasks.get(req)).await {
                    Ok(Ok(response)) => {
                        let netns = response
                            .into_inner()
                            .process
                            .filter(|process| process.pid > 0)
                            .map(|process| format!("/proc/{}/ns/net", process.pid))
                            .filter(|path| Path::new(path).exists())
                            .unwrap_or_default();
                        (netns, true)
                    }
                    Ok(Err(error)) if error.code() == tonic::Code::NotFound => {
                        (String::new(), true)
                    }
                    Ok(Err(error)) => {
                        errors.push(format!(
                            "Cannot resolve task netns for {} ({}: {}); keeping CNI state",
                            container_id,
                            error.code(),
                            error.message()
                        ));
                        (String::new(), false)
                    }
                    Err(_) => {
                        errors.push(format!(
                            "Task netns lookup timed out for {}; keeping CNI state",
                            container_id
                        ));
                        (String::new(), false)
                    }
                }
            }
        };

        let mut cni_complete = task_known && result_readable && errors.is_empty();
        if task_known && result_readable {
            // Only now are the exact config parsed and task state determinate.
            // A transient task Get above therefore leaves DNAT and every state
            // file untouched rather than disrupting a potentially live server.
            if let Err(error) = self
                .teardown_recorded_port_forward_rules(container_id)
                .await
            {
                errors.push(error.to_string());
                cni_complete = false;
            }
            if !netns.is_empty() {
                match self
                    .exec_cni_plugin(&cfg, "DEL", container_id, &netns, "eth0")
                    .await
                {
                    Ok(_) => {
                        // DEL normally releases host-local itself. Scan after a
                        // successful DEL as a crash-safe backstop, but never do
                        // this after a failed DEL or while required DNAT/NAT
                        // removal still has an error: an active stale redirect
                        // must keep its address from being reused.
                        if errors.is_empty() {
                            let leases = release_owned_leases(&ipam_dir, container_id).await;
                            let leases_failed = !leases.errors.is_empty();
                            errors.extend(leases.errors);
                            cni_complete &= !leases_failed;
                        } else {
                            cni_complete = false;
                        }
                    }
                    Err(error) => {
                        errors.push(format!("CNI DEL failed for {}: {}", container_id, error));
                        cni_complete = false;
                    }
                }
            } else {
                // The task is gone (or ADD failed before there was a usable
                // task): release every lease whose *first line* names this exact
                // container in this config's own IPAM directory. No result file
                // and no assumption that the network is named "catalyst" is
                // required, and leases of every other owner are left untouched.
                let leases = inspect_owned_leases(&ipam_dir, container_id).await;
                stale_ips.extend(leases.addresses.iter().cloned());
                let mut may_release_leases = leases.errors.is_empty();
                errors.extend(leases.errors);

                match self.live_container_ips_except(container_id).await {
                    Some(live) => {
                        let reused: HashSet<String> =
                            stale_ips.intersection(&live).cloned().collect();
                        if !reused.is_empty() {
                            // A later generation already owns an old address.
                            // Never delete its NAT/lease state under the dead
                            // container's name; retain our recovery records.
                            errors.push(format!(
                                "CNI addresses {:?} are owned by a later live container; retaining lease and state for {}",
                                reused, container_id
                            ));
                            may_release_leases = false;
                            cni_complete = false;
                        }
                        let dead = dead_ips_for_teardown(stale_ips, Some(&live));
                        if !dead.is_empty() {
                            if let Err(error) = self.sweep_container_nat_rules(&dead).await {
                                errors.push(error.to_string());
                                may_release_leases = false;
                                cni_complete = false;
                            }
                        }
                    }
                    None if stale_ips.is_empty() => {}
                    None => {
                        errors.push(format!(
                            "Cannot verify other containers' addresses for {}; skipping NAT cleanup",
                            container_id
                        ));
                        may_release_leases = false;
                        cni_complete = false;
                    }
                }

                if may_release_leases {
                    // Re-scan and re-check each owner immediately before remove.
                    // Failed NAT cleanup above deliberately skips this stage.
                    let released = release_owned_leases(&ipam_dir, container_id).await;
                    let lease_failed = !released.errors.is_empty();
                    errors.extend(released.errors);
                    cni_complete &= !lease_failed;
                } else {
                    cni_complete = false;
                }
            }
        }

        if cni_complete && errors.is_empty() {
            // Keep all recovery inputs paired until every destructive stage has
            // succeeded. In particular, never discard desired ports because a
            // later DEL/lease/NAT step failed.
            for path in [&rp, &cfg_path, &ports_path] {
                if let Err(error) = remove_state_file(path).await {
                    errors.push(error.to_string());
                    // If even removal of an earlier recovery record fails, keep
                    // every later input (especially config/ports) for retry.
                    break;
                }
            }
        }
        cni_cleanup_result(container_id, errors)
    }

    /// Persist a CNI state file (config, result or port-forward state).
    /// Returning the failure lets setup roll back instead of continuing with
    /// networking that cannot be reconstructed during teardown (issue #310).
    /// Replace one recovery record atomically. The old file survives every
    /// failure before rename, which is essential when reattach must retain its
    /// complete desired port mapping after an unsuccessful restart.
    fn write_state_file_atomic(&self, path: &Path, contents: &str) -> AgentResult<()> {
        let parent = path.parent().ok_or_else(|| {
            AgentError::FileSystemError(format!("CNI state path has no parent: {}", path.display()))
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            AgentError::FileSystemError(format!(
                "Failed to create CNI state dir {}: {}",
                parent.display(),
                error
            ))
        })?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                AgentError::FileSystemError(format!(
                    "Invalid CNI state filename: {}",
                    path.display()
                ))
            })?;
        let temporary = parent.join(format!(
            ".{}.{}.{}.tmp",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let write_result = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            file.write_all(contents.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, path)
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary);
            return Err(AgentError::FileSystemError(format!(
                "Failed to atomically replace CNI state {}: {}",
                path.display(),
                error
            )));
        }
        Ok(())
    }

    fn write_state_file(&self, path: &Path, contents: &str) -> AgentResult<()> {
        if let Some(dir) = path.parent() {
            if let Err(error) = fs::create_dir_all(dir) {
                error!(
                    "Failed to create CNI state dir {}: {}",
                    dir.display(),
                    error
                );
                return Err(AgentError::FileSystemError(format!(
                    "Failed to create CNI state dir {}: {}",
                    dir.display(),
                    error
                )));
            }
        }
        fs::write(path, contents).map_err(|error| {
            error!("Failed to write CNI state {}: {}", path.display(), error);
            AgentError::FileSystemError(format!(
                "Failed to write CNI state {}: {}",
                path.display(),
                error
            ))
        })
    }

    fn cni_ipam_dir(&self, cfg: &serde_json::Value) -> AgentResult<PathBuf> {
        let network = cfg
            .get("name")
            .and_then(|name| name.as_str())
            .unwrap_or("catalyst");
        crate::net_utils::validate_cni_network_name(network)?;
        let data_dir = cfg
            .get("ipam")
            .and_then(|ipam| ipam.get("dataDir"))
            .and_then(|dir| dir.as_str())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.cni_data_dir.clone());
        Ok(data_dir.join(network))
    }

    /// Container IPs referenced by this container's result and ports state.
    /// leases are added by `release_owned_leases`, using the actual config's
    /// IPAM directory rather than assuming the default bridge network.
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
        out
    }

    /// IPs currently owned by live containers in this agent's namespace.
    /// `None` when containerd cannot be listed — callers must skip sweeping
    /// then (an empty live set would misclassify everything as dead).
    async fn live_container_ips(&self) -> Option<HashSet<String>> {
        self.live_container_ips_except("").await
    }

    /// Same as [`Self::live_container_ips`], but ignores the given container
    /// (and its on-disk result file) when deciding what is live. Teardown needs
    /// this: the container being torn down still has a record and a result
    /// file, so counting it as live would leave its own rules unswept.
    async fn live_container_ips_except(&self, exclude: &str) -> Option<HashSet<String>> {
        #[cfg(test)]
        {
            // Existing offline filesystem/argv tests inject records here rather
            // than requiring a generated gRPC server trait (the client crate
            // builds clients only). This branch is absent from production.
            let cached = self.container_list_cache.read().await;
            if !cached.0.is_empty() {
                return Some(
                    cached
                        .0
                        .iter()
                        .filter(|container| exclude.is_empty() || container.id != exclude)
                        .filter_map(|container| {
                            self.cni_results_dir
                                .join(format!("catalyst-{}", container.id))
                                .exists()
                                .then_some(container.id.clone())
                        })
                        .filter_map(|container_id| {
                            fs::read_to_string(
                                self.cni_results_dir
                                    .join(format!("catalyst-{}", container_id)),
                            )
                            .ok()
                            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                            .and_then(|result| {
                                result
                                    .get("ips")?
                                    .as_array()?
                                    .first()?
                                    .get("address")?
                                    .as_str()
                                    .and_then(|address| address.split('/').next())
                                    .map(str::to_string)
                            })
                        })
                        .collect(),
                );
            }
        }
        // Destructive reconciliation must bypass list_containers' two-second UI
        // cache: a later generation created inside that window is still live.
        let mut client = ContainersClient::new(self.channel.clone());
        let request = with_namespace!(ListContainersRequest::default(), &self.namespace);
        let container_ids =
            match tokio::time::timeout(Duration::from_secs(10), client.list(request)).await {
                Ok(Ok(response)) => response
                    .into_inner()
                    .containers
                    .into_iter()
                    .map(|container| container.id)
                    .collect::<Vec<_>>(),
                Ok(Err(error)) => {
                    warn!("NAT sweep: fresh container list failed: {}", error);
                    return None;
                }
                Err(_) => {
                    warn!("NAT sweep: fresh container list timed out");
                    return None;
                }
            };
        let mut out = HashSet::new();
        for container_id in container_ids {
            if !exclude.is_empty() && container_id == exclude {
                continue;
            }
            // get_container_ip falls back to the result file, so stopped
            // containers keep their addresses too.
            match self.get_container_ip(&container_id).await {
                Ok(ip) if !ip.is_empty() => {
                    out.insert(ip);
                }
                Ok(_) => {}
                Err(error) => {
                    warn!(
                        "NAT/lease sweep cannot resolve existing container {} IP; preserving all candidates: {}",
                        container_id, error
                    );
                    return None;
                }
            }
        }
        Some(out)
    }

    /// Delete one parsed NAT rule by exact spec. Concurrent removal is clean;
    /// lock/permission/execution failures reach the caller.
    async fn delete_nat_rule(&self, cmd: &str, rule: &NatRule) -> AgentResult<()> {
        let mut args = vec!["-t", "nat", "-D", rule.chain.as_str()];
        args.extend(rule.spec.iter().map(|s| s.as_str()));
        match run_bounded_command(cmd, &args).await {
            Ok(output) if output.status.success() => {
                info!("NAT sweep ({}): removed stale {} rule", cmd, rule.chain);
                Ok(())
            }
            Ok(output) if iptables_rule_is_absent(&output) => Ok(()),
            Ok(output) => Err(AgentError::NetworkError(format!(
                "{} -D {} failed: {}",
                cmd,
                rule.chain,
                String::from_utf8_lossy(&output.stderr).trim()
            ))),
            Err(error) => Err(error),
        }
    }

    /// Sweep one nat table. The startup orphan sweep may also remove duplicate
    /// rules and unrelated empty CNI chains (`global_gc=true`), but failed
    /// per-container teardown must never mutate unrelated servers/networks.
    async fn sweep_nat_table(
        &self,
        cmd: &str,
        save_bin: &str,
        dead_ips: &HashSet<String>,
        global_gc: bool,
    ) -> AgentResult<()> {
        let out = match run_bounded_command(save_bin, &["-t", "nat"]).await {
            Ok(output) if output.status.success() => output,
            Ok(output) => {
                return Err(AgentError::NetworkError(format!(
                    "{} -t nat failed: {}",
                    save_bin,
                    String::from_utf8_lossy(&output.stderr).trim()
                )));
            }
            Err(error) => return Err(error),
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let (rules, refcounts, declared) = parse_nat_save(&text);
        if rules.is_empty() {
            return Ok(());
        }
        let (del_idx, chains) =
            plan_nat_cleanup_scoped(&rules, &refcounts, &declared, dead_ips, global_gc);
        let mut errors = Vec::new();
        info!(
            "NAT sweep ({}): removing {} stale rules and {} orphaned chains",
            cmd,
            del_idx.len(),
            chains.len()
        );
        for idx in del_idx {
            if let Some(rule) = rules.get(idx) {
                if let Err(error) = self.delete_nat_rule(cmd, rule).await {
                    errors.push(error.to_string());
                }
            }
        }
        for chain in chains {
            for args in [
                vec!["-t", "nat", "-F", chain.as_str()],
                vec!["-t", "nat", "-X", chain.as_str()],
            ] {
                match run_bounded_command(cmd, &args).await {
                    Ok(output) if output.status.success() || iptables_rule_is_absent(&output) => {}
                    Ok(output) => {
                        errors.push(format!(
                            "{} {} failed: {}",
                            cmd,
                            args.join(" "),
                            String::from_utf8_lossy(&output.stderr).trim()
                        ));
                        break;
                    }
                    Err(error) => {
                        errors.push(error.to_string());
                        break;
                    }
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(AgentError::NetworkError(format!(
                "NAT cleanup via {} failed: {}",
                cmd,
                errors.join("; ")
            )))
        }
    }

    async fn sweep_nat_rules(
        &self,
        dead_ips: &HashSet<String>,
        global_gc: bool,
    ) -> AgentResult<()> {
        let mut errors = Vec::new();
        if let Err(error) = self
            .sweep_nat_table("iptables", "iptables-save", dead_ips, global_gc)
            .await
        {
            errors.push(error.to_string());
        }
        if dead_ips.iter().any(|ip| ip.contains(':')) {
            if let Err(error) = self
                .sweep_nat_table("ip6tables", "ip6tables-save", dead_ips, global_gc)
                .await
            {
                errors.push(error.to_string());
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(AgentError::NetworkError(errors.join("; ")))
        }
    }

    /// Strict per-container NAT cleanup: no addresses, rules or chains can be
    /// selected unless they are tied to this container's recorded IPs.
    async fn sweep_container_nat_rules(&self, dead_ips: &HashSet<String>) -> AgentResult<()> {
        if dead_ips.is_empty() {
            return Ok(());
        }
        self.sweep_nat_rules(dead_ips, false).await
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

    /// Delete `-s <ip> -j CNI-*` jump rules whose comment names a container
    /// record that no longer exists. Only jumps with a source inside our own
    /// bridge subnet are eligible.
    pub(crate) async fn sweep_dead_jump_rules(&self) {
        let save = match run_bounded_command("iptables", &["-t", "nat", "-S"]).await {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).to_string()
            }
            Ok(output) => {
                warn!(
                    "iptables nat rule listing failed: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
                return;
            }
            Err(error) => {
                warn!("iptables nat rule listing failed: {}", error);
                return;
            }
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
            match self.container_existence(&cid).await {
                Ok(true) => {}
                Ok(false) => {
                    dead_cids.insert(cid);
                }
                Err(error) => {
                    warn!(
                        "NAT sweep: liveness for {} is indeterminate; retaining its rules: {}",
                        cid, error
                    );
                }
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
                if let Err(error) = self.delete_nat_rule("iptables", rule).await {
                    warn!("Failed to remove dead CNI jump rule: {}", error);
                }
            }
        }
        // Do not run a host-wide empty-chain/duplicate GC here. Unrelated CNI
        // networks may share the host nat table; their empty chains are not
        // ours simply because this startup noticed one orphaned jump rule.
    }

    pub async fn cleanup_stale_cni_leases(&self) {
        // Reconcile every exact state owner, not merely result files. Config-only
        // records retain their real ipam.dataDir; ports-only records can remove
        // exact forwarding but retain state with an explicit missing-config error
        // instead of guessing a custom lease directory.
        let mut owners = HashSet::new();
        match tokio::fs::read_dir(&self.cni_results_dir).await {
            Ok(mut entries) => loop {
                match entries.next_entry().await {
                    Ok(Some(entry)) => {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if let Some(owner) = cni_state_owner_id(&name) {
                            owners.insert(owner.to_string());
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        warn!(
                            "CNI startup reconciliation could not read a state entry; keeping remaining state: {}",
                            error
                        );
                        break;
                    }
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                warn!(
                    "CNI startup reconciliation cannot list state; keeping all leases: {}",
                    error
                );
                return;
            }
        }

        let mut sorted_owners: Vec<String> = owners.iter().cloned().collect();
        sorted_owners.sort();
        for container_id in &sorted_owners {
            match self.container_existence(container_id).await {
                Ok(true) => continue,
                Err(error) => {
                    warn!(
                        "CNI startup reconciliation cannot verify {}; preserving all state: {}",
                        container_id, error
                    );
                    continue;
                }
                Ok(false) => {}
            }
            info!(
                "Container {} is confirmed absent; reconciling its CNI result/config/ports state",
                container_id
            );
            if let Err(error) = self.teardown_cni_network(container_id).await {
                warn!(
                    "CNI teardown incomplete for absent container {}; retaining recovery state and any unreleased lease: {}",
                    container_id, error
                );
            }
        }

        // Comment-bearing CNI chains use the same strict per-ID primitive. No
        // recursive container_exists/liveness helper is involved.
        self.sweep_dead_jump_rules().await;
        self.cleanup_untracked_default_leases(&owners).await;
    }

    /// Recover leases with no remaining result/config/ports artifact only in the
    /// legacy default directory. Custom networks require their exact config;
    /// scanning arbitrary dataDir trees or trusting a foreign owner is unsafe.
    async fn cleanup_untracked_default_leases(&self, state_owners: &HashSet<String>) {
        let ipam_dir = self.cni_data_dir.join("catalyst");
        let live = match self.live_container_ips().await {
            Some(live) => live,
            None => return,
        };
        let mut entries = match tokio::fs::read_dir(&ipam_dir).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => {
                warn!("Cannot list default CNI lease directory: {}", error);
                return;
            }
        };
        let mut candidates = Vec::new();
        loop {
            let entry = match entries.next_entry().await {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(error) => {
                    warn!(
                        "Default CNI lease listing failed; preserving remaining leases: {}",
                        error
                    );
                    break;
                }
            };
            let path = entry.path();
            let address = entry.file_name().to_string_lossy().to_string();
            if !is_lease_filename(&address) {
                continue;
            }
            let content = match tokio::fs::read_to_string(&path).await {
                Ok(content) => content,
                Err(error) => {
                    warn!("Cannot verify lease owner {}: {}", path.display(), error);
                    continue;
                }
            };
            let owner = lease_owner(&content);
            if owner.is_empty() || state_owners.contains(owner) {
                continue;
            }
            candidates.push((path, address, owner.to_string(), content));
        }

        for (path, address, owner, original_content) in candidates {
            if live.contains(&address) {
                warn!(
                    "Retaining old owner {} lease {} because a live/new-generation container uses that IP",
                    owner, address
                );
                continue;
            }
            match self.container_existence(&owner).await {
                Ok(true) => continue,
                Err(error) => {
                    warn!(
                        "Lease owner {} is indeterminate; retaining {}: {}",
                        owner, address, error
                    );
                    continue;
                }
                Ok(false) => {}
            }
            let dead = HashSet::from([address.clone()]);
            if let Err(error) = self.sweep_container_nat_rules(&dead).await {
                warn!(
                    "Required NAT removal for orphaned lease {} failed; retaining lease: {}",
                    address, error
                );
                continue;
            }

            // Re-read and re-probe after the await-heavy NAT operations. A lease
            // rewritten or an owner recreated during reconciliation belongs to a
            // later generation and must not be removed under the old cleanup.
            match tokio::fs::read_to_string(&path).await {
                Ok(content) if content == original_content => {}
                Ok(_) => {
                    warn!(
                        "Lease {} changed during reconciliation; retaining it",
                        address
                    );
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    warn!(
                        "Cannot re-verify lease {} before removal: {}",
                        address, error
                    );
                    continue;
                }
            }
            match self.container_existence(&owner).await {
                Ok(false) => {}
                Ok(true) => continue,
                Err(error) => {
                    warn!(
                        "Lease owner {} became indeterminate; retaining lease: {}",
                        owner, error
                    );
                    continue;
                }
            }
            if let Err(error) = tokio::fs::remove_file(&path).await {
                if error.kind() != std::io::ErrorKind::NotFound {
                    warn!(
                        "Failed to remove confirmed orphan lease {}: {}",
                        address, error
                    );
                }
            } else {
                info!("Removed confirmed orphan CNI lease {}", address);
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

/// Recovery context for a reattach whose ADD may have required plugins to
/// mutate host/namespace state even when they subsequently returned an error.
pub(crate) struct NetworkReattachRollback {
    container_id: String,
    network: String,
    config: serde_json::Value,
    netns: String,
    result_path: PathBuf,
    ports_path: PathBuf,
    previous_result: Option<String>,
    previous_ports_raw: Option<String>,
    current_ip: Option<String>,
    attempted_forwards: Vec<PortForward>,
    firewall_configured: bool,
    result_committed: bool,
    ports_committed: bool,
}

impl NetworkReattachRollback {
    /// Compensate only this restart attempt. The container record, snapshot and
    /// I/O are deliberately not touched; the caller separately removes the new
    /// task. Previous state bytes are restored whenever a new record committed.
    pub(super) async fn rollback(
        self,
        runtime: &ContainerdRuntime,
        primary: AgentError,
    ) -> AgentError {
        let mut errors = Vec::new();
        if self.firewall_configured {
            FirewallManager::remove_server_ports(&self.container_id).await;
        }
        if let Some(ip) = self.current_ip.as_deref() {
            for forward in self.attempted_forwards.iter().rev() {
                if let Err(error) = runtime
                    .teardown_port_forward_rules(forward.host_port, forward.container_port, ip)
                    .await
                {
                    errors.push(format!("new port-forward rollback: {}", error));
                }
            }
        } else if !self.attempted_forwards.is_empty() {
            errors.push("new port-forward rollback has no validated container IP".to_string());
        }

        match runtime
            .exec_cni_plugin(&self.config, "DEL", &self.container_id, &self.netns, "eth0")
            .await
        {
            Ok(_) => {
                // Host-local normally releases its own lease. The scan is only
                // a backstop, and must not run while required NAT rollback has
                // failed: that would allow the address to be reused while old
                // redirection still points at it.
                if errors.is_empty() {
                    match runtime.cni_ipam_dir(&self.config) {
                        Ok(ipam_dir) => {
                            let leases = release_owned_leases(&ipam_dir, &self.container_id).await;
                            errors.extend(leases.errors);
                        }
                        Err(error) => errors.push(error.to_string()),
                    }
                }
            }
            Err(error) => errors.push(format!("new CNI DEL on {}: {}", self.network, error)),
        }

        if self.result_committed {
            if let Err(error) =
                restore_state_file(runtime, &self.result_path, self.previous_result.as_deref())
                    .await
            {
                errors.push(format!("restore previous CNI result: {}", error));
            }
        }
        if self.ports_committed {
            if let Err(error) = restore_state_file(
                runtime,
                &self.ports_path,
                self.previous_ports_raw.as_deref(),
            )
            .await
            {
                errors.push(format!("restore previous port-forward state: {}", error));
            }
        }

        if errors.is_empty() {
            primary
        } else {
            AgentError::ContainerError(format!(
                "{}; network rollback for {} on {} was incomplete: {}",
                primary,
                self.container_id,
                self.network,
                errors.join("; ")
            ))
        }
    }
}

fn reattach_primary(container_id: &str, error: AgentError) -> AgentError {
    AgentError::NetworkError(format!(
        "Network reattach failed for {}: {}",
        container_id, error
    ))
}

fn read_optional_state(path: &Path, kind: &str) -> AgentResult<Option<String>> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AgentError::FileSystemError(format!(
            "Failed to read {} {}; retaining all state: {}",
            kind,
            path.display(),
            error
        ))),
    }
}

async fn restore_state_file(
    runtime: &ContainerdRuntime,
    path: &Path,
    previous: Option<&str>,
) -> AgentResult<()> {
    match previous {
        Some(raw) => runtime.write_state_file_atomic(path, raw),
        None => remove_state_file(path).await,
    }
}

#[derive(Default)]
struct OwnedLeaseCleanup {
    /// Every address confirmed to belong to the container before this pass.
    /// This includes leases whose deletion failed so callers can safely retain
    /// enough information for diagnostics and retry.
    addresses: HashSet<String>,
    errors: Vec<String>,
}

async fn inspect_owned_leases(ipam_dir: &Path, container_id: &str) -> OwnedLeaseCleanup {
    scan_owned_leases(ipam_dir, container_id, false).await
}

/// Release only leases whose host-local owner is exactly `container_id`.
/// The caller supplies the one network directory identified by the stored CNI
/// config. No sibling network directory or differently-owned file is removed.
async fn release_owned_leases(ipam_dir: &Path, container_id: &str) -> OwnedLeaseCleanup {
    scan_owned_leases(ipam_dir, container_id, true).await
}

async fn scan_owned_leases(
    ipam_dir: &Path,
    container_id: &str,
    release: bool,
) -> OwnedLeaseCleanup {
    let mut outcome = OwnedLeaseCleanup::default();
    let mut entries = match tokio::fs::read_dir(ipam_dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return outcome,
        Err(error) => {
            outcome.errors.push(format!(
                "Failed to list CNI IPAM directory {}: {}",
                ipam_dir.display(),
                error
            ));
            return outcome;
        }
    };

    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(error) => {
                outcome.errors.push(format!(
                    "Failed while listing CNI IPAM directory {}: {}",
                    ipam_dir.display(),
                    error
                ));
                break;
            }
        };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_lease_filename(&name) {
            continue;
        }
        let content = match tokio::fs::read_to_string(&path).await {
            Ok(content) => content,
            Err(error) => {
                // Ownership cannot be established, so do not remove the file.
                outcome.errors.push(format!(
                    "Failed to verify CNI lease owner {}: {}",
                    path.display(),
                    error
                ));
                continue;
            }
        };
        if !lease_belongs_to(&content, container_id) {
            continue;
        }
        outcome.addresses.insert(name.clone());
        if release {
            info!(
                "Releasing CNI IPAM lease {} for container {}",
                path.display(),
                container_id
            );
            match tokio::fs::remove_file(&path).await {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => outcome.errors.push(format!(
                    "Failed to remove CNI lease {}: {}",
                    path.display(),
                    error
                )),
            }
        }
    }
    outcome
}

async fn remove_state_file(path: &Path) -> AgentResult<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AgentError::FileSystemError(format!(
            "Failed to remove CNI state {}: {}; retaining recovery information",
            path.display(),
            error
        ))),
    }
}

fn cni_cleanup_result(container_id: &str, errors: Vec<String>) -> AgentResult<()> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(AgentError::NetworkError(format!(
            "CNI cleanup incomplete for {}: {}",
            container_id,
            errors.join("; ")
        )))
    }
}

/// Build one exact DNAT argv. Catalyst's manually managed host forwards must
/// only capture packets addressed to this host; an unqualified protocol/port
/// match also hijacks connections to unrelated remote services on that port.
/// `local_only=false` is retained solely for deleting the legacy broad shape.
fn dnat_rule_args<'a>(
    operation: &'a str,
    chain: &'a str,
    protocol: &'a str,
    host_port: &'a str,
    destination: &'a str,
    local_only: bool,
) -> Vec<&'a str> {
    let mut args = vec![
        "-t", "nat", operation, chain, "-p", protocol, "--dport", host_port,
    ];
    if local_only {
        args.extend(["-m", "addrtype", "--dst-type", "LOCAL"]);
    }
    args.extend(["-j", "DNAT", "--to-destination", destination]);
    args
}

/// Validate the portion of a CNI ADD result that Catalyst depends on and
/// return a normalized address suitable for generated iptables arguments.
/// Every advertised address must be well formed; the first one is retained as
/// the primary address for the existing single-stack port-forward contract.
fn cni_result_ip(result: &serde_json::Value) -> AgentResult<String> {
    if !result.is_object() {
        return Err(AgentError::NetworkError(
            "CNI ADD result must be a JSON object".to_string(),
        ));
    }
    if result
        .get("cniVersion")
        .and_then(|version| version.as_str())
        .is_none_or(|version| version.is_empty())
    {
        return Err(AgentError::NetworkError(
            "CNI ADD result is missing cniVersion".to_string(),
        ));
    }
    let ips = result
        .get("ips")
        .and_then(|ips| ips.as_array())
        .filter(|ips| !ips.is_empty())
        .ok_or_else(|| {
            AgentError::NetworkError("CNI ADD result must contain at least one IP".to_string())
        })?;

    let mut primary = None;
    for entry in ips {
        let address = entry
            .get("address")
            .and_then(|address| address.as_str())
            .ok_or_else(|| {
                AgentError::NetworkError(
                    "CNI ADD result contains an IP entry without an address".to_string(),
                )
            })?;
        let (bare, prefix) = address
            .split_once('/')
            .map(|(bare, prefix)| (bare, Some(prefix)))
            .unwrap_or((address, None));
        let ip = bare.parse::<std::net::IpAddr>().map_err(|error| {
            AgentError::NetworkError(format!("CNI ADD returned invalid IP address: {}", error))
        })?;
        if ip.is_unspecified() {
            return Err(AgentError::NetworkError(
                "CNI ADD returned an unspecified container IP".to_string(),
            ));
        }
        if let Some(prefix) = prefix {
            let bits = prefix.parse::<u8>().map_err(|_| {
                AgentError::NetworkError("CNI ADD returned an invalid IP prefix".to_string())
            })?;
            let maximum = if ip.is_ipv4() { 32 } else { 128 };
            if bits > maximum {
                return Err(AgentError::NetworkError(
                    "CNI ADD returned an out-of-range IP prefix".to_string(),
                ));
            }
        }
        if primary.is_none() {
            primary = Some(ip.to_string());
        }
    }
    primary.ok_or_else(|| AgentError::NetworkError("CNI ADD returned no container IP".to_string()))
}

const CLEANUP_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

async fn run_bounded_command(program: &str, args: &[&str]) -> AgentResult<std::process::Output> {
    run_bounded_command_with_timeout(program, args, CLEANUP_COMMAND_TIMEOUT).await
}

/// Execute an iptables-family cleanup command without allowing a wedged
/// xtables helper to stall container teardown forever. `kill_on_drop` is set
/// before spawning so cancellation as well as the explicit timeout terminates
/// the child instead of leaking it.
async fn run_bounded_command_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> AgentResult<std::process::Output> {
    let mut command = Command::new(program);
    command.args(args).kill_on_drop(true);
    match tokio::time::timeout(timeout, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(AgentError::NetworkError(format!(
            "Failed to execute {}: {}",
            program, error
        ))),
        Err(_) => Err(AgentError::NetworkError(format!(
            "{} cleanup command timed out after {}ms",
            program,
            timeout.as_millis()
        ))),
    }
}

/// `-D` is idempotent only if the normal iptables "already absent" outcomes
/// are distinguished from lock, permission, syntax and execution failures.
fn iptables_rule_is_absent(output: &std::process::Output) -> bool {
    if output.status.success() {
        return true;
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
    stderr.contains("no chain/target/match by that name")
        || stderr.contains("does a matching rule exist")
        || stderr.contains("bad rule (does a matching rule exist")
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

/// Extract an exact container ID from any Catalyst CNI recovery artifact.
/// Config-only and ports-only files are first-class owners; temporary atomic
/// rename files do not start with this prefix and are never reconciled as IDs.
fn cni_state_owner_id(file_name: &str) -> Option<&str> {
    let rest = file_name.strip_prefix("catalyst-")?;
    let owner = rest
        .strip_suffix("-ports.json")
        .or_else(|| rest.strip_suffix("-config"))
        .unwrap_or(rest);
    if owner.is_empty() {
        None
    } else {
        Some(owner)
    }
}

/// Lease files are named by the leased address; host-local keeps bookkeeping
/// next to them (`lock`, `last_reserved_ip.0`) which names no container and is
/// never a lease to prune.
fn is_lease_filename(name: &str) -> bool {
    name.parse::<std::net::IpAddr>().is_ok()
}

/// Owner container ID of a host-local IPAM lease file.
///
/// The plugin writes `<containerID>\r\n<ifname>`, so the owner is the first
/// line. Trimming the whole file leaves `<id>\r\neth0`, which matches no
/// container and made the orphan scan delete leases of running servers
/// (issue #328).
fn lease_owner(content: &str) -> &str {
    content.lines().next().unwrap_or("").trim()
}

/// True when the lease file still names `container_id`.
pub(crate) fn lease_belongs_to(content: &str, container_id: &str) -> bool {
    lease_owner(content) == container_id
}

/// Owner to log when a lease file is an orphan: it names a container the
/// runtime no longer knows. `None` for bookkeeping files, empty owners and
/// leases of existing containers.
#[cfg(test)]
fn orphan_lease_owner<'a>(
    name: &str,
    content: &'a str,
    existing: &HashSet<String>,
) -> Option<&'a str> {
    if !is_lease_filename(name) {
        return None;
    }
    let owner = lease_owner(content);
    if owner.is_empty() || existing.contains(owner) {
        return None;
    }
    Some(owner)
}

/// IPs to sweep from NAT when a container is torn down.
///
/// The container's own addresses are dead even though its result file still
/// exists: `stop_server` deletes the container record only *after* this
/// teardown, and the on-disk result file keeps `get_container_ip` answering for
/// it — that is why the live set must exclude the container being torn down
/// (issue #311). An address still owned by another container is kept, and when
/// containerd cannot be listed (`None`) nothing is swept, because an empty live
/// set would misclassify every address as dead.
fn dead_ips_for_teardown(
    stale: HashSet<String>,
    live: Option<&HashSet<String>>,
) -> HashSet<String> {
    match live {
        Some(live) => stale.into_iter().filter(|ip| !live.contains(ip)).collect(),
        None => HashSet::new(),
    }
}

#[cfg(test)]
fn plan_nat_cleanup(
    rules: &[NatRule],
    refcounts: &std::collections::HashMap<String, usize>,
    declared: &[String],
    dead_ips: &std::collections::HashSet<String>,
) -> (Vec<usize>, Vec<String>) {
    plan_nat_cleanup_scoped(rules, refcounts, declared, dead_ips, true)
}

/// With `global_gc=false`, select only rules containing the dead IPs and only
/// CNI chains referenced by those deleted rules. An already-empty chain or a
/// duplicate rule belonging to another server/network is not ours to remove.
fn plan_nat_cleanup_scoped(
    rules: &[NatRule],
    refcounts: &std::collections::HashMap<String, usize>,
    declared: &[String],
    dead_ips: &std::collections::HashSet<String>,
    global_gc: bool,
) -> (Vec<usize>, Vec<String>) {
    let mut delete = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (idx, rule) in rules.iter().enumerate() {
        let key = format!("{}\0{}", rule.chain, rule.spec.join("\0"));
        let is_dupe = global_gc && !seen.insert(key);
        let is_dead = nat_rule_ip(rule)
            .as_ref()
            .is_some_and(|ip| dead_ips.contains(ip));
        if is_dupe || is_dead {
            delete.push(idx);
        }
    }
    let mut refs = refcounts.clone();
    let mut affected_chains = HashSet::new();
    for &idx in &delete {
        let spec = &rules[idx].spec;
        let mut k = 0;
        while k < spec.len() {
            if spec[k] == "-j" {
                if let Some(target) = spec.get(k + 1) {
                    if let Some(count) = refs.get_mut(target) {
                        *count = count.saturating_sub(1);
                    }
                    if target.starts_with("CNI-") {
                        affected_chains.insert(target.clone());
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
        .filter(|chain| chain.starts_with("CNI-"))
        .filter(|chain| global_gc || affected_chains.contains(*chain))
        .filter(|chain| refs.get(*chain).copied().unwrap_or(0) == 0)
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
    run_bounded_command(cmd, &check)
        .await
        .map(|output| output.status.success())
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

    #[test]
    fn teardown_sweeps_its_own_ips_even_with_a_live_record() {
        // The stopped container still has a record and a result file, but the
        // live set excludes it — so its own addresses are swept (#311).
        let stale: HashSet<String> = ["10.44.0.15".to_string()].into_iter().collect();
        let live: HashSet<String> = ["10.44.0.13".to_string()].into_iter().collect();
        let dead = dead_ips_for_teardown(stale, Some(&live));
        assert_eq!(dead, ["10.44.0.15".to_string()].into_iter().collect());
    }

    #[test]
    fn teardown_keeps_addresses_of_other_containers() {
        let stale: HashSet<String> = ["10.44.0.15".to_string(), "10.44.0.13".to_string()]
            .into_iter()
            .collect();
        let live: HashSet<String> = ["10.44.0.13".to_string()].into_iter().collect();
        let dead = dead_ips_for_teardown(stale, Some(&live));
        assert_eq!(dead, ["10.44.0.15".to_string()].into_iter().collect());
    }

    #[test]
    fn lease_owner_is_the_first_line() {
        // host-local writes `<containerID>\r\neth0` (#328).
        assert_eq!(lease_owner("abc123\r\neth0"), "abc123");
        assert_eq!(lease_owner("abc123\neth0\n"), "abc123");
        assert_eq!(lease_owner("abc123"), "abc123");
        assert_eq!(lease_owner(""), "");
        assert!(lease_belongs_to("abc123\r\neth0", "abc123"));
        assert!(!lease_belongs_to("abc123\r\neth0", "def456"));
        // A lease of another running container is never claimed.
        assert!(!lease_belongs_to("other\r\neth0", "abc123"));
    }

    #[test]
    fn host_local_bookkeeping_is_not_a_lease() {
        assert!(is_lease_filename("10.42.0.10"));
        assert!(!is_lease_filename("last_reserved_ip.0"));
        assert!(!is_lease_filename("lock"));
    }

    #[test]
    fn orphan_scan_keeps_leases_of_running_containers() {
        let existing: HashSet<String> = ["running-id".to_string()].into_iter().collect();
        // The regression: `\r\neth0` must not hide the live owner.
        assert_eq!(
            orphan_lease_owner("10.42.0.10", "running-id\r\neth0", &existing),
            None
        );
        // A lease of a container that is gone is an orphan.
        assert_eq!(
            orphan_lease_owner("10.42.0.11", "dead-id\r\neth0", &existing),
            Some("dead-id")
        );
        // Bookkeeping and empty leases are skipped, never deleted.
        assert_eq!(
            orphan_lease_owner("last_reserved_ip.0", "10.42.0.11", &existing),
            None
        );
        assert_eq!(orphan_lease_owner("10.42.0.12", "", &existing), None);
    }

    #[test]
    fn per_container_plan_does_not_gc_other_servers_or_networks() {
        let (rules, refcounts, mut declared) = parse_nat_save(FIXTURE);
        declared.push("CNI-unrelated-empty".to_string());
        let dead: HashSet<String> = ["10.44.0.15".to_string(), "10.44.0.10".to_string()]
            .into_iter()
            .collect();
        let (delete, chains) = plan_nat_cleanup_scoped(&rules, &refcounts, &declared, &dead, false);
        // Rule 3 is a duplicate, but belongs to another container and is not
        // selected during per-container teardown. Only the affected empty
        // chain is selected; an unrelated empty chain also survives.
        assert_eq!(delete, vec![0, 1, 4, 6]);
        assert_eq!(chains, vec!["CNI-aaa".to_string()]);
    }

    #[test]
    fn teardown_skips_the_sweep_when_containerd_cannot_be_listed() {
        let stale: HashSet<String> = ["10.44.0.15".to_string()].into_iter().collect();
        assert!(dead_ips_for_teardown(stale, None).is_empty());
    }

    #[test]
    fn dnat_add_is_local_only_and_legacy_delete_shape_is_preserved() {
        for chain in ["PREROUTING", "OUTPUT"] {
            let current = dnat_rule_args("-A", chain, "udp", "25565", "10.44.0.20:25565", true);
            assert_eq!(
                current,
                vec![
                    "-t",
                    "nat",
                    "-A",
                    chain,
                    "-p",
                    "udp",
                    "--dport",
                    "25565",
                    "-m",
                    "addrtype",
                    "--dst-type",
                    "LOCAL",
                    "-j",
                    "DNAT",
                    "--to-destination",
                    "10.44.0.20:25565",
                ]
            );
            let legacy = dnat_rule_args("-D", chain, "udp", "25565", "10.44.0.20:25565", false);
            assert!(!legacy.contains(&"addrtype"));
            assert!(legacy.contains(&"--to-destination"));
        }
    }

    #[test]
    fn state_owner_parsing_includes_config_and_ports_only_artifacts() {
        assert_eq!(cni_state_owner_id("catalyst-server-1"), Some("server-1"));
        assert_eq!(
            cni_state_owner_id("catalyst-server-1-config"),
            Some("server-1")
        );
        assert_eq!(
            cni_state_owner_id("catalyst-server-1-ports.json"),
            Some("server-1")
        );
        assert_eq!(cni_state_owner_id("catalyst-"), None);
        assert_eq!(cni_state_owner_id("unrelated"), None);
        assert_eq!(
            cni_state_owner_id(".catalyst-server-1.tmp"),
            None,
            "atomic temporary files are not state owners"
        );
    }
}

#[cfg(test)]
mod cni_reliability_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn runtime_fixture(fail_add: bool) -> (tempfile::TempDir, ContainerdRuntime, PathBuf, PathBuf) {
        runtime_fixture_with_failures(fail_add, false)
    }

    fn runtime_fixture_with_failures(
        fail_add: bool,
        fail_del: bool,
    ) -> (tempfile::TempDir, ContainerdRuntime, PathBuf, PathBuf) {
        let root = tempfile::tempdir().expect("temporary CNI fixture");
        let results = root.path().join("results");
        let networks = root.path().join("networks");
        let ipam_dir = networks.join("tenant");
        let config_dir = root.path().join("net.d");
        let bin_dir = root.path().join("bin");
        let command_log = root.path().join("commands.log");
        let lease = ipam_dir.join("10.44.0.20");
        for dir in [&results, &ipam_dir, &config_dir, &bin_dir] {
            fs::create_dir_all(dir).expect("create fixture directory");
        }
        // discover_cni_bin_dir requires this trio to exist. They are inert
        // fixtures; only the `fake` plugin below is ever executed.
        for plugin in ["bridge", "host-local", "macvlan"] {
            fs::write(bin_dir.join(plugin), "#!/bin/sh\nexit 99\n").expect("dummy plugin");
        }
        let script = format!(
            r#"#!/bin/sh
input=$(cat)
printf '%s %s\n' "$CNI_COMMAND" "$CNI_CONTAINERID" >> "{}"
case "$CNI_COMMAND" in
  ADD)
    printf '%s\r\neth0' "$CNI_CONTAINERID" > "{}"
    case "$input" in
      *'"failAdd":true'*) echo 'injected ADD failure' >&2; exit 23 ;;
      *'"malformedAdd":true'*) printf 'not-json\n'; exit 0 ;;
      *'"emptyAdd":true'*) printf '%s\n' '{{"cniVersion":"1.0.0","ips":[]}}'; exit 0 ;;
    esac
    printf '%s\n' '{{"cniVersion":"1.0.0","ips":[{{"address":"10.44.0.20/24"}}]}}'
    ;;
  DEL)
    case "$input" in
      *'"failDel":true'*) echo 'injected DEL failure' >&2; exit 25 ;;
    esac
    exit 0
    ;;
  *) exit 24 ;;
esac
"#,
            command_log.display(),
            lease.display()
        );
        let plugin = bin_dir.join("fake");
        fs::write(&plugin, script).expect("fake CNI plugin");
        let mut permissions = fs::metadata(&plugin)
            .expect("plugin metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&plugin, permissions).expect("executable fake plugin");
        fs::write(
            config_dir.join("tenant.conf"),
            serde_json::to_string(&serde_json::json!({
                "cniVersion": "1.0.0",
                "name": "tenant",
                "type": "fake",
                "failAdd": fail_add,
                "failDel": fail_del,
                "ipam": {"type": "host-local", "dataDir": networks}
            }))
            .expect("network config"),
        )
        .expect("write network config");

        let runtime = ContainerdRuntime {
            namespace: "catalyst-cni-test".to_string(),
            channel: tonic::transport::Channel::from_static("http://[::1]:1").connect_lazy(),
            container_io: Arc::new(Mutex::new(HashMap::new())),
            dns_servers: Vec::new(),
            cpu_tracker: Arc::new(CpuTracker::new()),
            cgroup_paths: Arc::new(RwLock::new(HashMap::new())),
            container_list_cache: Arc::new(RwLock::new((Vec::new(), Instant::now()))),
            console_log_dir: root.path().join("console"),
            cni_results_dir: results,
            cni_data_dir: networks,
            cni_dir: config_dir,
            cni_bin_dir: bin_dir,
            cni_bridge_name: "catalyst-test0".to_string(),
            cni_bridge_subnet: "10.44.0.0/16".to_string(),
            allow_host_network: Arc::new(AtomicBool::new(false)),
            error_sink: Arc::new(std::sync::RwLock::new(None)),
        };
        (root, runtime, ipam_dir, command_log)
    }

    async fn setup(runtime: &ContainerdRuntime, container_id: &str) -> AgentResult<()> {
        runtime
            .setup_cni_network(
                container_id,
                std::process::id(),
                Some("tenant"),
                None,
                0,
                &HashMap::new(),
            )
            .await
    }

    fn enable_fake_add_mode(runtime: &ContainerdRuntime, container_id: &str, marker: &str) {
        let path = runtime.cni_dir.join("tenant.conf");
        let mut config: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        config[marker] = serde_json::json!(true);
        let raw = serde_json::to_string(&config).unwrap();
        fs::write(path, &raw).unwrap();
        // Reattach deliberately consumes the exact persisted setup config, not
        // the current named network file.
        fs::write(
            runtime
                .cni_results_dir
                .join(format!("catalyst-{}-config", container_id)),
            raw,
        )
        .unwrap();
    }

    #[tokio::test]
    async fn config_write_failure_prevents_add() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture(false);
        let container_id = "installer-config-write-failure";
        let config = runtime
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        fs::create_dir(&config).expect("foreign directory blocks state write");

        let error = setup(&runtime, container_id).await.unwrap_err();
        assert!(error.to_string().contains("Failed to write CNI state"));
        assert!(config.is_dir(), "foreign directory must not be removed");
        assert!(
            !command_log.exists(),
            "CNI ADD must not run after its config could not be persisted"
        );
        assert!(!ipam_dir.join("10.44.0.20").exists());
    }

    #[tokio::test]
    async fn failed_add_without_result_runs_del_and_releases_only_owned_lease() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture(true);
        let container_id = "installer-add-failure";
        let own_lease = ipam_dir.join("10.44.0.20");
        let other_lease = ipam_dir.join("10.44.0.21");
        fs::write(&other_lease, "another-server\r\neth0").expect("other lease");

        let error = setup(&runtime, container_id).await.unwrap_err();
        assert!(error.to_string().contains("injected ADD failure"));
        let commands = fs::read_to_string(&command_log).expect("fake plugin command log");
        assert!(commands.contains(&format!("ADD {}", container_id)));
        assert!(
            commands.contains(&format!("DEL {}", container_id)),
            "partial ADD must be followed by DEL: {}",
            commands
        );
        assert!(!own_lease.exists(), "partial ADD lease must be released");
        assert_eq!(
            fs::read_to_string(&other_lease).unwrap(),
            "another-server\r\neth0"
        );
        assert!(!runtime
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id))
            .exists());
        assert!(!runtime
            .cni_results_dir
            .join(format!("catalyst-{}", container_id))
            .exists());

        // Retrying after successful rollback is a no-op, not another DEL or a
        // request to delete the other server's lease.
        runtime
            .teardown_cni_network_with_netns(container_id, Some(""))
            .await
            .expect("idempotent rollback retry");
        assert!(other_lease.exists());
    }

    #[tokio::test]
    async fn failed_del_is_reported_and_retains_config_and_owned_lease() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture_with_failures(true, true);
        let container_id = "installer-del-failure";
        let config = runtime
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        let lease = ipam_dir.join("10.44.0.20");

        let error = setup(&runtime, container_id).await.unwrap_err();
        assert!(error.to_string().contains("CNI setup rollback also failed"));
        assert!(error.to_string().contains("injected DEL failure"));
        assert!(config.is_file(), "failed DEL must retain its exact config");
        assert_eq!(
            fs::read_to_string(&lease).unwrap(),
            format!("{}\r\neth0", container_id),
            "a live/failed DEL must not free a potentially active lease"
        );
        let commands = fs::read_to_string(&command_log).unwrap();
        assert!(commands.contains(&format!("ADD {}", container_id)));
        assert!(commands.contains(&format!("DEL {}", container_id)));
    }

    #[tokio::test]
    async fn result_write_failure_rolls_back_and_retains_blocked_state_for_retry() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture(false);
        let container_id = "installer-result-write-failure";
        let result = runtime
            .cni_results_dir
            .join(format!("catalyst-{}", container_id));
        let config = runtime
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        fs::create_dir(&result).expect("foreign directory blocks result write");

        let error = setup(&runtime, container_id).await.unwrap_err();
        assert!(error.to_string().contains("Failed to write CNI state"));
        assert!(error.to_string().contains("rollback also failed"));
        let commands = fs::read_to_string(&command_log).expect("fake plugin command log");
        assert!(commands.contains(&format!("DEL {}", container_id)));
        assert!(!ipam_dir.join("10.44.0.20").exists());
        assert!(result.is_dir(), "an unexpected directory is never removed");
        assert!(
            config.is_file(),
            "keep config paired with a result path that could not be cleared"
        );

        fs::remove_dir(&result).expect("clear injected obstruction");
        runtime
            .teardown_cni_network_with_netns(container_id, Some(""))
            .await
            .expect("retry removes config-only state without a result");
        assert!(!config.exists());
        runtime
            .teardown_cni_network_with_netns(container_id, Some(""))
            .await
            .expect("second retry is idempotent");
    }

    #[tokio::test]
    async fn gone_task_custom_lease_survives_cross_generation_ip_reuse() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture(false);
        let container_id = "installer-exited-before-rollback";
        let config = runtime
            .cni_results_dir
            .join(format!("catalyst-{}-config", container_id));
        let raw_config = fs::read_to_string(runtime.cni_dir.join("tenant.conf")).unwrap();
        runtime.write_state_file(&config, &raw_config).unwrap();
        fs::write(
            ipam_dir.join("10.44.0.20"),
            format!("{}\r\neth0", container_id),
        )
        .expect("partial installer lease");

        // A later live generation holds the same address. The old owner must
        // not sweep its NAT state or free a potentially active lease, and this
        // fixture intentionally executes no host iptables helper.
        let other_result = runtime.cni_results_dir.join("catalyst-other-server");
        fs::write(&other_result, r#"{"ips":[{"address":"10.44.0.20/24"}]}"#).unwrap();
        *runtime.container_list_cache.write().await = (
            vec![ContainerInfo {
                id: "other-server".to_string(),
                names: "other-server".to_string(),
                managed: true,
                status: "Up".to_string(),
                command: String::new(),
                image: String::new(),
                labels: HashMap::new(),
            }],
            Instant::now(),
        );

        let error = runtime
            .teardown_cni_network_with_netns(container_id, Some("/gone/installer/netns"))
            .await
            .expect_err("cross-generation live IP must block destructive cleanup");
        assert!(
            error.to_string().contains("later live container"),
            "{error}"
        );
        assert!(config.exists());
        assert_eq!(
            fs::read_to_string(ipam_dir.join("10.44.0.20")).unwrap(),
            format!("{}\r\neth0", container_id)
        );
        assert!(other_result.exists());
        assert!(!command_log.exists(), "no ADD, DEL or host NAT helper ran");
    }

    #[tokio::test]
    async fn owned_lease_cleanup_is_network_scoped_and_idempotent() {
        let root = tempfile::tempdir().expect("lease fixture");
        let tenant = root.path().join("tenant");
        let other_network = root.path().join("other-network");
        fs::create_dir_all(&tenant).unwrap();
        fs::create_dir_all(&other_network).unwrap();
        let own = tenant.join("10.44.0.20");
        let other = tenant.join("10.44.0.21");
        let bookkeeping = tenant.join("last_reserved_ip.0");
        let same_id_other_network = other_network.join("10.44.0.22");
        fs::write(&own, "dead-installer\r\neth0").unwrap();
        fs::write(&other, "running-server\r\neth0").unwrap();
        fs::write(&bookkeeping, "10.44.0.21").unwrap();
        fs::write(&same_id_other_network, "dead-installer\r\neth0").unwrap();

        let first = release_owned_leases(&tenant, "dead-installer").await;
        assert!(first.errors.is_empty(), "{:?}", first.errors);
        assert_eq!(first.addresses, ["10.44.0.20".to_string()].into());
        assert!(!own.exists());
        assert!(other.exists());
        assert!(bookkeeping.exists());
        assert!(same_id_other_network.exists());

        let second = release_owned_leases(&tenant, "dead-installer").await;
        assert!(second.errors.is_empty());
        assert!(second.addresses.is_empty());
        assert!(other.exists());
        assert!(same_id_other_network.exists());
    }

    #[tokio::test]
    async fn corrupt_port_state_is_not_deleted_or_reported_as_clean() {
        let (_root, runtime, _ipam_dir, _command_log) = runtime_fixture(false);
        let container_id = "installer-bad-port-state";
        let path = runtime
            .cni_results_dir
            .join(format!("catalyst-{}-ports.json", container_id));
        fs::write(&path, "not JSON").unwrap();

        let error = runtime
            .teardown_port_forward(container_id)
            .await
            .expect_err("corrupt state cannot prove its rules are gone");
        assert!(error.to_string().contains("retaining it for retry"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "not JSON");
    }

    #[tokio::test]
    async fn transient_container_get_error_is_not_absence() {
        let (_root, runtime, _ipam_dir, _command_log) = runtime_fixture(false);
        let result = tokio::time::timeout(
            Duration::from_secs(7),
            runtime.container_existence("possibly-live-server"),
        )
        .await
        .expect("strict existence probe is bounded");
        let error = result.expect_err("transport failure must remain indeterminate");
        assert!(error.to_string().contains("Container error"));
        assert!(
            runtime.container_exists("possibly-live-server").await,
            "the legacy destructive-caller compatibility predicate fails safe"
        );
    }

    #[tokio::test]
    async fn malformed_and_empty_add_results_run_del_and_never_commit_state() {
        for (marker, expected) in [
            ("malformedAdd", "invalid JSON"),
            ("emptyAdd", "at least one IP"),
        ] {
            let (_root, runtime, ipam_dir, command_log) = runtime_fixture(false);
            let container_id = format!("invalid-add-{marker}");
            enable_fake_add_mode(&runtime, &container_id, marker);

            let error = setup(&runtime, &container_id).await.unwrap_err();
            assert!(error.to_string().contains(expected), "{error}");
            assert!(error.to_string().contains("tenant"), "{error}");
            let commands = fs::read_to_string(command_log).unwrap();
            assert!(commands.contains(&format!("ADD {container_id}")));
            assert!(commands.contains(&format!("DEL {container_id}")));
            assert!(!ipam_dir.join("10.44.0.20").exists());
            assert!(!runtime
                .cni_results_dir
                .join(format!("catalyst-{container_id}"))
                .exists());
            assert!(!runtime
                .cni_results_dir
                .join(format!("catalyst-{container_id}-config"))
                .exists());
        }
    }

    #[tokio::test]
    async fn successful_empty_del_completes_owned_network_cleanup() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture(false);
        let container_id = "empty-del-success";
        setup(&runtime, container_id).await.expect("valid fake ADD");
        assert!(ipam_dir.join("10.44.0.20").exists());

        let netns = format!("/proc/{}/ns/net", std::process::id());
        runtime
            .teardown_cni_network_with_netns(container_id, Some(&netns))
            .await
            .expect("fake DEL exits zero with empty output");
        assert!(fs::read_to_string(command_log)
            .unwrap()
            .contains(&format!("DEL {container_id}")));
        assert!(!ipam_dir.join("10.44.0.20").exists());
        assert!(!runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}"))
            .exists());
        assert!(!runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}-config"))
            .exists());
    }

    #[tokio::test]
    async fn malformed_reattach_add_rolls_back_without_losing_desired_state() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture(false);
        let container_id = "reattach-malformed-add";
        enable_fake_add_mode(&runtime, container_id, "malformedAdd");
        let result_path = runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}"));
        let ports_path = runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}-ports.json"));
        let result = r#"{"cniVersion":"1.0.0","ips":[{"address":"10.44.0.9/24"}]}"#;
        let ports = r#"{"container_ip":"10.44.0.9","forwards":[{"host_port":25565,"container_port":25565},{"host_port":25566,"container_port":25566}]}"#;
        fs::write(&result_path, result).unwrap();
        fs::write(&ports_path, ports).unwrap();

        let error = match runtime
            .reattach_network_on_start(container_id, std::process::id(), container_id)
            .await
        {
            Err(error) => error,
            Ok(_) => panic!("malformed ADD must reject restart"),
        };
        assert!(error.to_string().contains("invalid JSON"), "{error}");
        assert_eq!(fs::read_to_string(result_path).unwrap(), result);
        assert_eq!(fs::read_to_string(ports_path).unwrap(), ports);
        let commands = fs::read_to_string(command_log).unwrap();
        assert!(commands.contains(&format!("ADD {container_id}")));
        assert!(commands.contains(&format!("DEL {container_id}")));
        assert!(!ipam_dir.join("10.44.0.20").exists());
    }

    #[tokio::test]
    async fn missing_config_rejects_legacy_reattach_before_destroying_state() {
        let (_root, runtime, _ipam_dir, command_log) = runtime_fixture(false);
        let container_id = "legacy-result-and-ports";
        let result_path = runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}"));
        let ports_path = runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}-ports.json"));
        fs::write(&result_path, "legacy result bytes").unwrap();
        fs::write(
            &ports_path,
            r#"{"container_ip":"10.44.0.9","forwards":[{"host_port":25565,"container_port":25565}]}"#,
        )
        .unwrap();

        let error = match runtime
            .reattach_network_on_start(container_id, std::process::id(), container_id)
            .await
        {
            Err(error) => error,
            Ok(_) => panic!("result-only state cannot prove an ADD configuration"),
        };
        assert!(error.to_string().contains("config is missing"), "{error}");
        assert_eq!(
            fs::read_to_string(result_path).unwrap(),
            "legacy result bytes"
        );
        assert!(ports_path.exists());
        assert!(!command_log.exists(), "no misleading ADD/DEL was attempted");
    }

    #[tokio::test]
    async fn indeterminate_task_get_preserves_config_result_ports_and_lease() {
        let (_root, runtime, ipam_dir, command_log) = runtime_fixture(false);
        let container_id = "possibly-live-task";
        let config = runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}-config"));
        let result = runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}"));
        let ports = runtime
            .cni_results_dir
            .join(format!("catalyst-{container_id}-ports.json"));
        fs::write(
            &config,
            fs::read_to_string(runtime.cni_dir.join("tenant.conf")).unwrap(),
        )
        .unwrap();
        fs::write(
            &result,
            r#"{"cniVersion":"1.0.0","ips":[{"address":"10.44.0.20/24"}]}"#,
        )
        .unwrap();
        fs::write(
            &ports,
            r#"{"container_ip":"10.44.0.20","forwards":[{"host_port":25565,"container_port":25565}]}"#,
        )
        .unwrap();
        fs::write(
            ipam_dir.join("10.44.0.20"),
            format!("{container_id}\r\neth0"),
        )
        .unwrap();

        let error = runtime
            .teardown_cni_network(container_id)
            .await
            .expect_err("transient task lookup cannot promote teardown");
        assert!(
            error.to_string().contains("Cannot resolve task netns"),
            "{error}"
        );
        assert_eq!(
            fs::read_to_string(&ports).unwrap(),
            r#"{"container_ip":"10.44.0.20","forwards":[{"host_port":25565,"container_port":25565}]}"#
        );
        assert!(result.exists());
        assert!(config.exists());
        assert!(ipam_dir.join("10.44.0.20").exists());
        assert!(
            !command_log.exists(),
            "no CNI plugin ran over indeterminate state"
        );
    }

    #[test]
    fn add_result_validation_rejects_missing_or_invalid_ip_information() {
        for result in [
            serde_json::json!({}),
            serde_json::json!({"cniVersion":"1.0.0","ips":[]}),
            serde_json::json!({"cniVersion":"1.0.0","ips":[{}]}),
            serde_json::json!({"cniVersion":"1.0.0","ips":[{"address":"0.0.0.0/0"}]}),
            serde_json::json!({"cniVersion":"1.0.0","ips":[{"address":"2001:db8::1/129"}]}),
        ] {
            assert!(cni_result_ip(&result).is_err(), "accepted {result}");
        }
        assert_eq!(
            cni_result_ip(&serde_json::json!({
                "cniVersion":"1.0.0",
                "ips":[{"address":"10.44.0.20/24"}]
            }))
            .unwrap(),
            "10.44.0.20"
        );
    }

    #[tokio::test]
    async fn cleanup_command_timeout_is_bounded_without_real_iptables() {
        let started = Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            run_bounded_command_with_timeout(
                "sh",
                &["-c", "exec sleep 30"],
                Duration::from_millis(40),
            ),
        )
        .await
        .expect("outer test-time backstop");
        let error = result.expect_err("sleep should time out");
        assert!(error.to_string().contains("timed out after 40ms"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn missing_rule_is_clean_but_lock_failure_is_not() {
        let missing = std::process::Command::new("sh")
            .args([
                "-c",
                "echo 'iptables: Bad rule (does a matching rule exist in that chain?)' >&2; exit 2",
            ])
            .output()
            .expect("missing-rule fixture");
        assert!(iptables_rule_is_absent(&missing));
        let locked = std::process::Command::new("sh")
            .args([
                "-c",
                "echo 'iptables: Resource temporarily unavailable (xtables lock)' >&2; exit 4",
            ])
            .output()
            .expect("xtables-lock fixture");
        assert!(!iptables_rule_is_absent(&locked));
    }
}
