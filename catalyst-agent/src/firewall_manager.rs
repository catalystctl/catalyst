use crate::errors::{AgentError, AgentResult};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tokio::process::Command;
use tracing::{info, warn};

async fn run_firewall_command(cmd: &str, args: &[&str]) -> AgentResult<std::process::Output> {
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new(cmd).args(args).output(),
    )
    .await
    .map_err(|_| AgentError::FirewallError(format!("{} command timed out", cmd)))?
    .map_err(|e| AgentError::FirewallError(format!("Failed to run {}: {}", cmd, e)))?;
    Ok(output)
}

static IPTABLES_MUTEX: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Persistent state file that tracks which firewall rules the agent has
/// created, so they can be reliably removed on server deletion and survive
/// agent restarts.
///
/// Format (one JSON object per line):
///   {"port":25565,"server_id":"srv-abc","container_ip":"10.42.0.5","proto":"tcp"}
const RULE_STATE_FILE: &str = "/var/lib/catalyst/firewall-rules.jsonl";

// ---------------------------------------------------------------------------
// Firewall manager
// ---------------------------------------------------------------------------

/// Firewall manager for automatically configuring firewall rules.
pub struct FirewallManager;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum FirewallType {
    Ufw,
    Iptables,
    Firewalld,
    None,
}

// ---------------------------------------------------------------------------
// Rule tracking
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FirewallRule {
    pub port: u16,
    pub proto: String,
    pub server_id: String,
    pub container_ip: String,
}

static TRACKED_RULES: Mutex<Vec<FirewallRule>> = Mutex::new(Vec::new());

fn lock_rules() -> std::sync::MutexGuard<'static, Vec<FirewallRule>> {
    TRACKED_RULES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Load tracked rules from the persistent state file, merging with any
/// already loaded in memory (used on agent startup).
fn load_tracked_rules() {
    let mut rules = lock_rules();
    if !rules.is_empty() {
        return; // already loaded
    }

    if !Path::new(RULE_STATE_FILE).exists() {
        return;
    }

    match std::fs::read_to_string(RULE_STATE_FILE) {
        Ok(contents) => {
            let count = contents
                .lines()
                .filter(|line| !line.trim().is_empty())
                .filter_map(|line| serde_json::from_str::<FirewallRule>(line).ok())
                .inspect(|rule| rules.push(rule.clone()))
                .count();
            if count > 0 {
                info!(
                    "Loaded {} tracked firewall rules from {}",
                    count, RULE_STATE_FILE
                );
            }
        }
        Err(e) => warn!("Could not load firewall rule state: {}", e),
    }
}

/// Persist tracked rules to disk.
fn save_tracked_rules() {
    let rules = lock_rules();
    let temp = format!("{}.tmp", RULE_STATE_FILE);
    let data = rules
        .iter()
        .map(|r| serde_json::to_string(r).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    drop(rules);
    if let Err(e) = std::fs::write(&temp, data) {
        warn!("Could not save firewall rule state: {}", e);
        return;
    }
    if let Err(e) = std::fs::rename(&temp, RULE_STATE_FILE) {
        warn!("Could not atomically replace firewall rule state: {}", e);
        let _ = std::fs::remove_file(&temp);
    }
}

/// Record that we added a firewall rule for a server port.
fn track_rule(port: u16, proto: &str, server_id: &str, container_ip: &str) {
    let mut rules = lock_rules();
    // Avoid duplicates.
    let exists = rules.iter().any(|r| {
        r.port == port
            && r.proto == proto
            && r.server_id == server_id
            && r.container_ip == container_ip
    });
    if !exists {
        rules.push(FirewallRule {
            port,
            proto: proto.to_string(),
            server_id: server_id.to_string(),
            container_ip: container_ip.to_string(),
        });
        drop(rules);
        save_tracked_rules();
    }
}

/// Remove all tracked rules for a given server and return the removed rules.
fn untrack_server_rules(server_id: &str) -> Vec<FirewallRule> {
    let mut rules = lock_rules();
    let mut removed = Vec::new();
    let original_len = rules.len();
    rules.retain(|r| {
        if r.server_id == server_id {
            removed.push(r.clone());
            false
        } else {
            true
        }
    });
    if removed.len() != original_len {
        drop(rules);
        save_tracked_rules();
    }
    removed
}

// ---------------------------------------------------------------------------
// Firewall detection
// ---------------------------------------------------------------------------

impl FirewallManager {
    /// Detect which firewall is active on the system.
    pub async fn detect_firewall() -> FirewallType {
        if let Ok(output) = run_firewall_command("ufw", &["status"]).await {
            let status = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && status.contains("Status: active") {
                info!("Detected active UFW firewall");
                return FirewallType::Ufw;
            }
        }

        if let Ok(output) = run_firewall_command("firewall-cmd", &["--state"]).await {
            let status = String::from_utf8_lossy(&output.stdout);
            if output.status.success() && status.contains("running") {
                info!("Detected active firewalld");
                return FirewallType::Firewalld;
            }
        }

        if run_firewall_command("iptables", &["-L", "-n"])
            .await
            .is_ok()
        {
            info!("Using iptables for firewall management");
            return FirewallType::Iptables;
        }

        warn!("No firewall detected or iptables not available");
        FirewallType::None
    }

    /// Ensure tracked rules are loaded from disk.  Call once at startup.
    pub fn init() {
        load_tracked_rules();
    }

    // -----------------------------------------------------------------------
    // Public API — allow / remove ports
    // -----------------------------------------------------------------------

    /// Allow a port through the detected firewall for a specific server.
    /// The rule is tracked so it can be removed later.
    pub async fn allow_port(
        port: u16,
        protocol: &str,
        container_ip: &str,
        server_id: &str,
    ) -> AgentResult<()> {
        Self::validate_container_ip(container_ip)?;

        // Always apply both tcp and udp for game servers.
        let protos = match protocol {
            "tcp" => vec!["tcp"],
            "udp" => vec!["udp"],
            _ => vec!["tcp", "udp"],
        };

        for proto in &protos {
            let firewall_type = Self::detect_firewall().await;
            let result = match firewall_type {
                FirewallType::Ufw => Self::allow_port_ufw(port).await,
                FirewallType::Firewalld => Self::allow_port_firewalld(port, proto).await,
                FirewallType::Iptables => {
                    Self::allow_port_iptables(port, proto, container_ip).await
                }
                FirewallType::None => {
                    info!(
                        "No firewall detected, skipping allow for port {}/{}",
                        port, proto
                    );
                    Ok(())
                }
            };

            if result.is_ok() {
                track_rule(port, proto, server_id, container_ip);
            } else if let Err(e) = result {
                warn!(
                    "Firewall allow failed for port {}/{} (non-fatal): {}",
                    port, proto, e
                );
            }
        }

        Ok(())
    }

    /// Remove all firewall rules associated with a server.
    /// Called when a server is deleted or its container is removed.
    pub async fn remove_server_ports(server_id: &str) {
        let rules = untrack_server_rules(server_id);
        if rules.is_empty() {
            return;
        }

        info!(
            "Removing {} firewall rule(s) for server {}",
            rules.len(),
            server_id
        );

        // Deduplicate by (port, proto) to avoid redundant calls.
        let mut seen: HashSet<(u16, String)> = HashSet::new();
        for rule in &rules {
            let key = (rule.port, rule.proto.clone());
            if seen.insert(key) {
                let firewall_type = Self::detect_firewall().await;
                let result = match firewall_type {
                    FirewallType::Ufw => Self::remove_port_ufw(rule.port).await,
                    FirewallType::Firewalld => {
                        Self::remove_port_firewalld(rule.port, &rule.proto).await
                    }
                    FirewallType::Iptables => {
                        Self::remove_port_iptables(rule.port, &rule.proto, &rule.container_ip).await
                    }
                    FirewallType::None => Ok(()),
                };
                if let Err(e) = result {
                    warn!(
                        "Firewall remove failed for port {}/{} (non-fatal): {}",
                        rule.port, rule.proto, e
                    );
                }
            }
        }
    }

    /// Remove all tracked firewall rules on agent shutdown.
    /// This is a safety net — rules are normally removed per-server.
    pub async fn remove_all_tracked() {
        let rules: Vec<_> = {
            let guard = lock_rules();
            guard.iter().cloned().collect()
        };
        if rules.is_empty() {
            return;
        }

        info!(
            "Removing all {} tracked firewall rules (agent shutdown)",
            rules.len()
        );

        let mut seen: HashSet<(u16, String, String)> = HashSet::new();
        for rule in &rules {
            let key = (rule.port, rule.proto.clone(), rule.container_ip.clone());
            if seen.insert(key) {
                let firewall_type = Self::detect_firewall().await;
                let _ = match firewall_type {
                    FirewallType::Ufw => Self::remove_port_ufw(rule.port).await,
                    FirewallType::Firewalld => {
                        Self::remove_port_firewalld(rule.port, &rule.proto).await
                    }
                    FirewallType::Iptables => {
                        Self::remove_port_iptables(rule.port, &rule.proto, &rule.container_ip).await
                    }
                    FirewallType::None => Ok(()),
                };
            }
        }
    }

    /// Allow traffic to a specific container IP (FORWARD rules only, no INPUT).
    /// Used by iptables-based setups for macvlan/bridge networking.
    pub async fn allow_container_ip(container_ip: &str) -> AgentResult<()> {
        Self::validate_container_ip(container_ip)?;
        let firewall_type = Self::detect_firewall().await;

        match firewall_type {
            FirewallType::Ufw | FirewallType::Firewalld | FirewallType::None => {
                // UFW and firewalld handle forwarding internally.
                // No FORWARD rules needed for port-based allow rules.
                Ok(())
            }
            FirewallType::Iptables => Self::allow_container_ip_iptables(container_ip).await,
        }
    }

    /// Remove FORWARD rules for a container IP.
    pub async fn remove_container_ip(container_ip: &str) -> AgentResult<()> {
        Self::validate_container_ip(container_ip)?;
        let firewall_type = Self::detect_firewall().await;

        match firewall_type {
            FirewallType::Ufw | FirewallType::Firewalld | FirewallType::None => Ok(()),
            FirewallType::Iptables => Self::remove_container_ip_iptables(container_ip).await,
        }
    }

    // -----------------------------------------------------------------------
    // UFW implementation
    // -----------------------------------------------------------------------

    /// Allow a port through UFW.
    ///
    /// Uses a comment tag so we can identify our rules later.
    async fn allow_port_ufw(port: u16) -> AgentResult<()> {
        info!("Configuring UFW to allow port {}", port);

        let output = run_firewall_command(
            "ufw",
            &[
                "allow",
                &port.to_string(),
                "comment",
                "catalyst-game-server",
            ],
        )
        .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::FirewallError(format!(
                "UFW allow failed: {}",
                stderr
            )));
        }

        // No need to reload — `ufw allow` applies immediately.
        info!("✓ UFW configured to allow port {}", port);
        Ok(())
    }

    /// Remove a UFW rule by comment.  We search numbered rules to find the
    /// one with our comment and delete it by number, which avoids the
    /// interactive `y/N` prompt that `ufw delete allow` would produce.
    async fn remove_port_ufw(port: u16) -> AgentResult<()> {
        info!("Removing UFW rule for port {}", port);

        // List rules with numbers and find ours.
        let output = run_firewall_command("ufw", &["status", "numbered"]).await?;

        if !output.status.success() {
            warn!(
                "Could not list UFW rules, skipping removal for port {}",
                port
            );
            return Ok(());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Collect rule numbers that match our port AND have the catalyst comment.
        // UFW numbered output looks like:
        //   [ 1] 25565/tcp    ALLOW IN    Anywhere                   (catalyst-game-server)
        // We need to parse from bottom to top when deleting.
        let mut matching_numbers: Vec<String> = Vec::new();
        for line in stdout.lines() {
            if (line.contains(&format!("{}/tcp", port)) || line.contains(&format!("{}/udp", port)))
                && line.contains("catalyst-game-server")
            {
                // Extract the number between [ and ].
                if let Some(start) = line.find('[') {
                    if let Some(end) = line[start..].find(']') {
                        let num = line[start + 1..start + end].trim();
                        matching_numbers.push(num.to_string());
                    }
                }
            }
        }

        if matching_numbers.is_empty() {
            info!("No UFW rule found for port {}", port);
            return Ok(());
        }

        // Delete from highest number to lowest to avoid index shifting.
        matching_numbers.sort_by(|a, b| b.cmp(a));
        for num in &matching_numbers {
            let output = run_firewall_command("ufw", &["delete", num]).await?;

            if output.status.success() {
                info!("✓ Removed UFW rule #{}", num);
            } else {
                warn!(
                    "Failed to remove UFW rule #{}: {}",
                    num,
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // firewalld implementation
    // -----------------------------------------------------------------------

    async fn allow_port_firewalld(port: u16, protocol: &str) -> AgentResult<()> {
        info!("Configuring firewalld to allow port {}/{}", port, protocol);

        let output = run_firewall_command(
            "firewall-cmd",
            &[
                "--permanent",
                "--add-port",
                &format!("{}/{}", port, protocol),
            ],
        )
        .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::FirewallError(format!(
                "firewalld add failed: {}",
                stderr
            )));
        }

        Self::reload_firewalld().await?;

        info!("✓ firewalld configured to allow port {}/{}", port, protocol);
        Ok(())
    }

    async fn remove_port_firewalld(port: u16, protocol: &str) -> AgentResult<()> {
        info!("Removing firewalld rule for port {}/{}", port, protocol);

        let output = run_firewall_command(
            "firewall-cmd",
            &[
                "--permanent",
                "--remove-port",
                &format!("{}/{}", port, protocol),
            ],
        )
        .await?;

        if !output.status.success() {
            warn!(
                "Failed to remove firewalld rule for port {}/{} (may not exist)",
                port, protocol
            );
            // Don't return error — try reload anyway.
        }

        Self::reload_firewalld().await?;
        Ok(())
    }

    async fn reload_firewalld() -> AgentResult<()> {
        let output = run_firewall_command("firewall-cmd", &["--reload"]).await?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AgentError::FirewallError(format!(
                "firewalld reload failed: {}",
                stderr
            )));
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // iptables implementation
    // -----------------------------------------------------------------------

    /// Add idempotent iptables rules using the `catalyst` comment match.
    /// `-C` checks first to avoid duplicates.
    async fn allow_port_iptables(port: u16, protocol: &str, container_ip: &str) -> AgentResult<()> {
        info!(
            "Configuring iptables to allow port {}/{} for container {}",
            port, protocol, container_ip
        );

        // INPUT rule — allow traffic to the host port.
        Self::iptables_ensure_rule(&[
            "-I",
            "INPUT",
            "-p",
            protocol,
            "--dport",
            &port.to_string(),
            "-m",
            "comment",
            "--comment",
            "catalyst-game-server",
            "-j",
            "ACCEPT",
        ])
        .await?;

        // FORWARD rule — incoming to container.
        Self::iptables_ensure_rule(&[
            "-I",
            "FORWARD",
            "-p",
            protocol,
            "--dport",
            &port.to_string(),
            "-d",
            container_ip,
            "-m",
            "comment",
            "--comment",
            "catalyst-game-server",
            "-j",
            "ACCEPT",
        ])
        .await?;

        // FORWARD rule — outgoing from container.
        Self::iptables_ensure_rule(&[
            "-I",
            "FORWARD",
            "-p",
            protocol,
            "--sport",
            &port.to_string(),
            "-s",
            container_ip,
            "-m",
            "comment",
            "--comment",
            "catalyst-game-server",
            "-j",
            "ACCEPT",
        ])
        .await?;

        info!(
            "✓ iptables configured to allow port {}/{} for container {}",
            port, protocol, container_ip
        );
        Ok(())
    }

    /// Remove iptables rules by comment match.  Safer than `-D` with exact
    /// args because we might not know the exact rule position or parameters.
    async fn remove_port_iptables(
        port: u16,
        protocol: &str,
        container_ip: &str,
    ) -> AgentResult<()> {
        info!(
            "Removing iptables rules for port {}/{} container {}",
            port, protocol, container_ip
        );

        // Remove all rules in the chain that match our comment + port + protocol.
        // Loop until no more matches remain (handles duplicate insertions).
        for chain in &["INPUT", "FORWARD"] {
            loop {
                // List rule numbers with line numbers to find our rules.
                let output =
                    run_firewall_command("iptables", &["-L", chain, "-n", "--line-numbers"])
                        .await?;

                if !output.status.success() {
                    break;
                }

                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut found_num: Option<usize> = None;

                for line in stdout.lines() {
                    if line.contains("catalyst-game-server")
                        && line.contains(&port.to_string())
                        && line.contains(protocol)
                    {
                        // First token is the line number.
                        if let Some(num_str) = line.split_whitespace().next() {
                            if let Ok(num) = num_str.parse::<usize>() {
                                found_num = Some(num);
                                break;
                            }
                        }
                    }
                }

                match found_num {
                    Some(num) => {
                        let output =
                            run_firewall_command("iptables", &["-D", chain, &num.to_string()])
                                .await?;
                        if !output.status.success() {
                            break; // no more rules to remove
                        }
                        // continue loop — there might be more duplicates
                    }
                    None => break, // no matching rules left
                }
            }
        }

        Ok(())
    }

    /// Allow all traffic to/from a container IP in the FORWARD chain.
    async fn allow_container_ip_iptables(container_ip: &str) -> AgentResult<()> {
        let rules: &[(&str, &[&str])] = &[
            (
                "incoming",
                &[
                    "-I",
                    "FORWARD",
                    "-d",
                    container_ip,
                    "-j",
                    "ACCEPT",
                    "-m",
                    "comment",
                    "--comment",
                    "catalyst-container",
                ],
            ),
            (
                "outgoing",
                &[
                    "-I",
                    "FORWARD",
                    "-s",
                    container_ip,
                    "-j",
                    "ACCEPT",
                    "-m",
                    "comment",
                    "--comment",
                    "catalyst-container",
                ],
            ),
        ];
        for (args_desc, args) in rules {
            Self::iptables_ensure_rule(args)
                .await
                .map_err(|e| {
                    warn!(
                        "iptables FORWARD {} rule for {} failed (non-fatal): {}",
                        args_desc, container_ip, e
                    );
                    e
                })
                .ok();
        }
        Ok(())
    }

    async fn remove_container_ip_iptables(container_ip: &str) -> AgentResult<()> {
        for chain in &["FORWARD"] {
            loop {
                let output =
                    run_firewall_command("iptables", &["-L", chain, "-n", "--line-numbers"])
                        .await?;

                if !output.status.success() {
                    break;
                }

                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut found_num: Option<usize> = None;

                for line in stdout.lines() {
                    if line.contains("catalyst-container") && (line.contains(container_ip)) {
                        if let Some(num_str) = line.split_whitespace().next() {
                            if let Ok(num) = num_str.parse::<usize>() {
                                found_num = Some(num);
                                break;
                            }
                        }
                    }
                }

                match found_num {
                    Some(num) => {
                        let output =
                            run_firewall_command("iptables", &["-D", chain, &num.to_string()])
                                .await?;
                        if !output.status.success() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
        Ok(())
    }

    /// Ensure an iptables rule exists — uses `-C` to check first, only
    /// inserts if missing (idempotent).  Uses a mutex to prevent races
    /// between the check and the insert.
    async fn iptables_ensure_rule(args: &[&str]) -> AgentResult<()> {
        let _guard = IPTABLES_MUTEX.lock().await;

        // Build the check command: replace -I with -C.
        let mut check_args: Vec<&str> = Vec::with_capacity(args.len());
        for arg in args {
            if *arg == "-I" {
                check_args.push("-C");
            } else {
                check_args.push(arg);
            }
        }

        let check = run_firewall_command("iptables", &check_args).await;
        if let Ok(output) = check {
            if output.status.success() {
                return Ok(()); // rule already exists
            }
        }

        // Rule doesn't exist — insert it.
        let output = run_firewall_command("iptables", args).await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(AgentError::FirewallError(format!(
                "iptables failed: {}",
                stderr
            )))
        } else {
            Ok(())
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

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

    #[tokio::test]
    async fn test_detect_firewall() {
        let firewall = FirewallManager::detect_firewall().await;
        assert!(matches!(
            firewall,
            FirewallType::Ufw
                | FirewallType::Iptables
                | FirewallType::Firewalld
                | FirewallType::None
        ));
    }

    #[test]
    fn test_validate_container_ip() {
        assert!(FirewallManager::validate_container_ip("10.42.0.5").is_ok());
        assert!(FirewallManager::validate_container_ip("not-an-ip").is_err());
    }

    #[test]
    fn test_track_and_untrack() {
        // Clear any existing rules in test.
        lock_rules().clear();

        track_rule(25565, "tcp", "srv-1", "10.42.0.5");
        track_rule(25565, "udp", "srv-1", "10.42.0.5");
        track_rule(25566, "tcp", "srv-2", "10.42.0.6");

        // Duplicate should be ignored.
        track_rule(25565, "tcp", "srv-1", "10.42.0.5");

        let rules = lock_rules();
        assert_eq!(rules.len(), 3);

        drop(rules);

        let removed = untrack_server_rules("srv-1");
        assert_eq!(removed.len(), 2);

        let remaining = lock_rules();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].server_id, "srv-2");
    }
}
