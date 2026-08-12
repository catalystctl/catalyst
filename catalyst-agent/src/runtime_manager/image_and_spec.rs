//! Image management, OCI spec generation, and install script detection.

use super::*;

pub fn detect_install_interpreter(image: &str, script: &str) -> (&'static str, &'static str) {
    let image_lower = image.to_lowercase();
    let is_alpine = image_lower.contains("alpine");

    // Check explicit shebang
    let first_line = script.lines().next().unwrap_or("").trim();
    if first_line.starts_with("#!") {
        let shebang = first_line.trim_start_matches("#!").trim();
        let interpreter = shebang.split_whitespace().next().unwrap_or("");
        let basename = interpreter.rsplit('/').next().unwrap_or(interpreter);
        match basename {
            "bash" => {
                if is_alpine {
                    // Alpine has no bash; busybox ash supports [[ ]] and most bash-isms
                    return ("sh", "-c");
                } else {
                    return ("bash", "-c");
                }
            }
            "ash" => {
                // ash scripts on Alpine → use sh (busybox ash)
                // ash scripts on non-Alpine → use bash (superset, ash unavailable)
                if is_alpine {
                    return ("sh", "-c");
                } else {
                    return ("bash", "-c");
                }
            }
            _ => (),
        }
    }

    // No shebang or unknown interpreter — choose based on image
    if is_alpine {
        // On Alpine, /bin/sh = busybox ash which supports [[ ]]
        ("sh", "-c")
    } else {
        // On Debian/Ubuntu and other images, use bash for Pterodactyl compatibility
        // Most scripts have bash-isms even without an explicit shebang
        ("bash", "-c")
    }
}

/// True when image Cmd is a Pterodactyl yolks `/entrypoint.sh` that evals `$STARTUP`.
fn cmd_evaluates_startup(cmd: &[String]) -> bool {
    cmd.iter().any(|part| {
        let base = part.rsplit('/').next().unwrap_or(part);
        base == "entrypoint.sh" || base == "entrypoint"
    })
}

/// True when the startup string must be parsed by a shell (not exec'd as argv[0]).
fn startup_needs_shell(command: &str) -> bool {
    command.contains(char::is_whitespace)
        || command.contains('"')
        || command.contains('\'')
        || command.contains("$(")
        || command.contains("[[")
        || command.contains("$((")
        || command.contains('`')
        || command.contains(';')
        || command.contains("&&")
        || command.contains("||")
}

/// Build OCI `process.args` for a game-server container.
///
/// Pterodactyl Wings never overrides image Entrypoint/Cmd. Modern yolks
/// (`debian_trixie` and anything based on it, including `wine_latest`) use:
///   ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
///   CMD        ["/bin/bash", "/entrypoint.sh"]  // evals `$STARTUP`
/// Replacing Cmd with the raw startup string makes tini `exec` the entire
/// command line as argv[0] → ENOENT:
///   [FATAL tini] exec wine ./SonsOfTheForestDS.exe ... failed: No such file or directory
pub fn build_process_args(
    startup_command: &str,
    image_entrypoint: Option<&[String]>,
    image_cmd: Option<&[String]>,
) -> Vec<String> {
    let entrypoint = image_entrypoint.filter(|e| !e.is_empty());
    let cmd = image_cmd.filter(|c| !c.is_empty());

    // Wings-compatible: yolks entrypoint.sh reads STARTUP from the environment.
    if let Some(cmd) = cmd {
        if cmd_evaluates_startup(cmd) {
            let mut args = entrypoint.unwrap_or(&[]).to_vec();
            args.extend(cmd.iter().cloned());
            return args;
        }
    }

    if let Some(entrypoint) = entrypoint {
        let mut args = entrypoint.to_vec();
        if !startup_command.is_empty() {
            if startup_needs_shell(startup_command) {
                let shell = if crate::shell_utils::requires_bash(startup_command) {
                    "/bin/bash"
                } else {
                    "/bin/sh"
                };
                args.push(shell.to_string());
                args.push("-c".to_string());
            }
            args.push(startup_command.to_string());
        } else if let Some(cmd) = cmd {
            args.extend(cmd.iter().cloned());
        }
        return args;
    }

    if !startup_command.is_empty() {
        let escaped_startup = crate::shell_utils::shell_escape_value(startup_command);
        let shell = if crate::shell_utils::requires_bash(startup_command) {
            "/bin/bash"
        } else {
            "/bin/sh"
        };
        let wrapped_command = format!(
            "export PATH=\"/opt/java/openjdk/bin:${{PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}}\"; exec {} -c {}",
            shell, escaped_startup
        );
        return vec![shell.to_string(), "-c".to_string(), wrapped_command];
    }

    if let Some(cmd) = cmd {
        return cmd.to_vec();
    }

    vec!["/bin/sh".to_string()]
}

pub fn base_mounts(data_dir: &str) -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({"destination":"/data","type":"bind","source":data_dir,"options":["rbind","rw"]}),
        serde_json::json!({"destination":"/proc","type":"proc","source":"proc"}),
        serde_json::json!({"destination":"/dev","type":"tmpfs","source":"tmpfs","options":["nosuid","strictatime","mode=755","size=65536k"]}),
        serde_json::json!({"destination":"/dev/pts","type":"devpts","source":"devpts","options":["nosuid","noexec","newinstance","ptmxmode=0666","mode=0620","gid=5"]}),
        serde_json::json!({"destination":"/dev/shm","type":"tmpfs","source":"shm","options":["nosuid","noexec","nodev","mode=1777","size=65536k"]}),
        serde_json::json!({"destination":"/dev/mqueue","type":"mqueue","source":"mqueue","options":["nosuid","noexec","nodev"]}),
        serde_json::json!({"destination":"/sys","type":"sysfs","source":"sysfs","options":["nosuid","noexec","nodev","ro"]}),
        serde_json::json!({"destination":"/sys/fs/cgroup","type":"cgroup","source":"cgroup","options":["nosuid","noexec","nodev","relatime","ro"]}),
    ]
}

pub fn masked_paths() -> Vec<&'static str> {
    vec![
        // Original masked paths
        "/proc/kcore",
        "/proc/latency_stats",
        "/proc/timer_list",
        "/proc/timer_stats",
        "/proc/sched_debug",
        "/sys/firmware",
        // Additional security-sensitive paths
        "/proc/kallsyms", // Kernel symbols - useful for exploit development
        "/proc/self/mem", // Memory manipulation vector
        "/sys/kernel",    // Kernel parameters and addresses
        "/sys/class",     // Hardware enumeration for fingerprinting
        "/proc/slabinfo", // Kernel slab allocator info
        "/proc/modules",  // Loaded kernel modules
    ]
}

pub fn readonly_paths() -> Vec<&'static str> {
    vec![
        "/proc/asound",
        "/proc/bus",
        "/proc/fs",
        "/proc/irq",
        "/proc/sys",
        "/proc/sysrq-trigger",
    ]
}

pub fn seccomp_arches() -> Vec<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => vec!["SCMP_ARCH_X86_64", "SCMP_ARCH_X86", "SCMP_ARCH_X32"],
        "aarch64" => vec!["SCMP_ARCH_AARCH64", "SCMP_ARCH_ARM"],
        "arm" => vec!["SCMP_ARCH_ARM"],
        _ => Vec::new(),
    }
}

pub fn default_seccomp_profile() -> serde_json::Value {
    // Deny-list a small set of high-risk syscalls while keeping broad compatibility.
    // This is intentionally conservative; consumers can harden further via host policy.
    serde_json::json!({
        "defaultAction": "SCMP_ACT_ALLOW",
        "architectures": seccomp_arches(),
        "syscalls": [
            {
                "names": [
                    "acct",
                    "add_key",
                    "bpf",
                    "delete_module",
                    "finit_module",
                    "init_module",
                    "iopl",
                    "ioperm",
                    "kexec_file_load",
                    "kexec_load",
                    "keyctl",
                    "mount",
                    "open_by_handle_at",
                    "perf_event_open",
                    "pivot_root",
                    "process_vm_readv",
                    "process_vm_writev",
                    "ptrace",
                    "quotactl",
                    "reboot",
                    "request_key",
                    "setns",
                    "swapoff",
                    "swapon",
                    "syslog",
                    "umount2",
                    "unshare"
                ],
                "action": "SCMP_ACT_ERRNO",
                "errnoRet": 1
            }
        ]
    })
}

use super::ContainerdRuntime;

impl ContainerdRuntime {
    pub(crate) async fn ensure_image(&self, image: &str) -> AgentResult<()> {
        let qualified = Self::qualify_image_ref(image);
        let mut client = ImagesClient::new(self.channel.clone());
        let req = GetImageRequest {
            name: qualified.clone(),
        };
        let req = with_namespace!(req, &self.namespace);
        match client.get(req).await {
            Ok(_) => return Ok(()),
            Err(e) if e.code() == tonic::Code::NotFound => {
                info!("Image {} not found, pulling...", qualified)
            }
            Err(e) => return Err(grpc_err(e)),
        }
        let output = Command::new("ctr")
            .arg("-n")
            .arg(&self.namespace)
            .arg("images")
            .arg("pull")
            .arg(&qualified)
            .output()
            .await
            .map_err(|e| AgentError::ContainerError(format!("pull: {}", e)))?;
        if !output.status.success() {
            return Err(AgentError::ContainerError(format!(
                "Image pull failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        info!("Image {} pulled", qualified);
        Ok(())
    }

    pub(crate) fn qualify_image_ref(image: &str) -> String {
        let name = image.split(':').next().unwrap_or(image);
        if name.contains('/') {
            // Already has a registry or org prefix (e.g. ghcr.io/org/img, user/img)
            image.to_string()
        } else {
            // Bare image name like "alpine:3.19" -> "docker.io/library/alpine:3.19"
            format!("docker.io/library/{}", image)
        }
    }

    pub(crate) async fn get_image_env(&self, image: &str) -> Vec<String> {
        match self.get_image_env_inner(image).await {
            Ok(env) => env,
            Err(e) => {
                warn!("Failed to read image env for {}: {}", image, e);
                vec![]
            }
        }
    }

    pub(crate) async fn get_image_env_inner(&self, image: &str) -> AgentResult<Vec<String>> {
        let config_digest = self.resolve_image_config_digest(image).await?;

        let config_bytes = self.read_content_blob(&config_digest).await?;
        let config: serde_json::Value = serde_json::from_slice(&config_bytes)
            .map_err(|e| AgentError::ContainerError(format!("Bad config JSON: {}", e)))?;

        Ok(config
            .get("config")
            .and_then(|c| c.get("Env"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default())
    }

    pub(crate) async fn get_image_entrypoint(
        &self,
        image: &str,
    ) -> (Option<Vec<String>>, Option<Vec<String>>) {
        match self.get_image_entrypoint_inner(image).await {
            Ok(v) => v,
            Err(e) => {
                warn!("Failed to read image entrypoint for {}: {}", image, e);
                (None, None)
            }
        }
    }

    pub(crate) async fn get_image_entrypoint_inner(
        &self,
        image: &str,
    ) -> AgentResult<(Option<Vec<String>>, Option<Vec<String>>)> {
        let config_digest = self.resolve_image_config_digest(image).await?;
        let config_bytes = self.read_content_blob(&config_digest).await?;
        let config: serde_json::Value = serde_json::from_slice(&config_bytes)
            .map_err(|e| AgentError::ContainerError(format!("Bad config JSON: {}", e)))?;

        let entrypoint = config
            .get("config")
            .and_then(|c| c.get("Entrypoint"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });

        let cmd = config
            .get("config")
            .and_then(|c| c.get("Cmd"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });

        Ok((entrypoint, cmd))
    }

    pub(crate) async fn resolve_image_config_digest(&self, image: &str) -> AgentResult<String> {
        let mut images = ImagesClient::new(self.channel.clone());
        let req = GetImageRequest {
            name: image.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = images.get(req).await.map_err(grpc_err)?;
        let img = resp
            .into_inner()
            .image
            .ok_or_else(|| AgentError::ContainerError("No image returned".into()))?;
        let target = img
            .target
            .ok_or_else(|| AgentError::ContainerError("Image has no target descriptor".into()))?;

        let manifest_bytes = self.read_content_blob(&target.digest).await?;
        let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
            .map_err(|e| AgentError::ContainerError(format!("Bad manifest JSON: {}", e)))?;

        if let Some(manifests) = manifest.get("manifests").and_then(|v| v.as_array()) {
            let manifest_digest = manifests
                .iter()
                .find(|m| {
                    let p = m.get("platform");
                    p.and_then(|p| p.get("architecture"))
                        .and_then(|v| v.as_str())
                        == Some("amd64")
                        && p.and_then(|p| p.get("os")).and_then(|v| v.as_str()) == Some("linux")
                })
                .or_else(|| manifests.first())
                .and_then(|m| m.get("digest"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| AgentError::ContainerError("No manifest in index".into()))?;
            let inner_bytes = self.read_content_blob(manifest_digest).await?;
            let inner: serde_json::Value = serde_json::from_slice(&inner_bytes)
                .map_err(|e| AgentError::ContainerError(format!("Bad inner manifest: {}", e)))?;
            return inner
                .get("config")
                .and_then(|c| c.get("digest"))
                .and_then(|v| v.as_str())
                .map(|v| v.to_string())
                .ok_or_else(|| AgentError::ContainerError("No config in manifest".into()));
        }

        manifest
            .get("config")
            .and_then(|c| c.get("digest"))
            .and_then(|v| v.as_str())
            .map(|v| v.to_string())
            .ok_or_else(|| AgentError::ContainerError("No config in manifest".into()))
    }

    pub(crate) async fn resolve_snapshot_parent_key(
        &self,
        image: &str,
    ) -> AgentResult<Option<String>> {
        let config_digest = self.resolve_image_config_digest(image).await?;
        let mut content = ContentClient::new(self.channel.clone());
        let req = InfoRequest {
            digest: config_digest,
        };
        let req = with_namespace!(req, &self.namespace);
        let resp = content.info(req).await.map_err(grpc_err)?;
        let labels = resp
            .into_inner()
            .info
            .map(|info| info.labels)
            .unwrap_or_default();
        Ok(labels
            .get("containerd.io/gc.ref.snapshot.overlayfs")
            .cloned())
    }

    pub(crate) async fn read_content_blob(&self, digest: &str) -> AgentResult<Vec<u8>> {
        let mut content = ContentClient::new(self.channel.clone());
        let req = ReadContentRequest {
            digest: digest.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let mut stream = content.read(req).await.map_err(grpc_err)?.into_inner();
        let mut data = Vec::new();
        while let Some(chunk) = stream.message().await.map_err(grpc_err)? {
            data.extend_from_slice(&chunk.data);
            if data.len() > MAX_CONTENT_BLOB_SIZE {
                return Err(AgentError::InvalidRequest(
                    "Content blob exceeds maximum size".to_string(),
                ));
            }
        }
        Ok(data)
    }

    pub(crate) async fn prepare_snapshot(&self, image: &str, key: &str) -> AgentResult<()> {
        let _ = Command::new("ctr")
            .arg("-n")
            .arg(&self.namespace)
            .arg("images")
            .arg("unpack")
            .arg("--snapshotter")
            .arg("overlayfs")
            .arg(image)
            .output()
            .await;

        let mut snaps = SnapshotsClient::new(self.channel.clone());
        // Try using image ref as parent first (works on some containerd setups).
        let req = PrepareSnapshotRequest {
            snapshotter: "overlayfs".to_string(),
            key: key.to_string(),
            parent: image.to_string(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        if let Ok(Ok(_)) = tokio::time::timeout(Duration::from_secs(10), snaps.prepare(req)).await {
            return Ok(());
        }

        // Resolve the exact unpacked snapshot parent for this image from content labels.
        if let Some(parent) = self.resolve_snapshot_parent_key(image).await? {
            let req = PrepareSnapshotRequest {
                snapshotter: "overlayfs".to_string(),
                key: key.to_string(),
                parent: parent.clone(),
                ..Default::default()
            };
            let req = with_namespace!(req, &self.namespace);
            match tokio::time::timeout(Duration::from_secs(10), snaps.prepare(req)).await {
                Ok(Ok(_)) => return Ok(()),
                _ => {
                    warn!(
                        "prepare snapshot with resolved parent {} failed for image {}",
                        parent, image
                    );
                }
            }
        } else {
            warn!(
                "No overlayfs snapshot parent label found for image {}",
                image
            );
        }

        Err(AgentError::ContainerError(format!(
            "Failed to prepare snapshot for {}",
            image
        )))
    }

    pub(crate) async fn get_snapshot_mounts(
        &self,
        key: &str,
    ) -> AgentResult<Vec<containerd_client::types::Mount>> {
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        let req = MountsRequest {
            snapshotter: "overlayfs".to_string(),
            key: key.to_string(),
        };
        let req = with_namespace!(req, &self.namespace);
        Ok(snaps
            .mounts(req)
            .await
            .map_err(grpc_err)?
            .into_inner()
            .mounts)
    }

    pub(crate) fn build_oci_spec(
        &self,
        config: &ContainerConfig<'_>,
        io_dir: &Path,
        use_host_network: bool,
        image_env: &[String],
        image_entrypoint: Option<&[String]>,
        image_cmd: Option<&[String]>,
    ) -> AgentResult<serde_json::Value> {
        // Start with image env as base, then overlay our defaults and config env.
        // This preserves image-specific PATH, JAVA_HOME, etc.
        let mut env_map: HashMap<String, String> = HashMap::new();
        for entry in image_env {
            if let Some((k, v)) = entry.split_once('=') {
                env_map.insert(k.to_string(), v.to_string());
            }
        }
        // Template/config env takes highest priority
        for (k, v) in config.env {
            env_map.insert(k.to_string(), v.to_string());
        }
        // Ensure PATH is usable for JVM-based images even if image env probing fails
        // or template/server env accidentally overrides PATH.
        // The Pterodactyl Hytale image provides java at /opt/java/openjdk/bin/java.
        const DEFAULT_PATH: &str =
            "/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
        let path_value = env_map.get("PATH").map(|v| v.trim()).unwrap_or("");
        if path_value.is_empty() {
            env_map.insert("PATH".to_string(), DEFAULT_PATH.to_string());
        } else if !path_value
            .split(':')
            .any(|segment| segment == "/opt/java/openjdk/bin")
        {
            env_map.insert(
                "PATH".to_string(),
                format!("/opt/java/openjdk/bin:{}", path_value),
            );
        }
        env_map.insert("TERM".to_string(), "xterm".to_string());
        // Runtime container runs as 1000:1000; set HOME to the data dir
        env_map.insert("HOME".to_string(), "/data".to_string());
        if !config.startup_command.is_empty() {
            env_map.insert("STARTUP".to_string(), config.startup_command.to_string());
        }
        let env_list: Vec<String> = env_map
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();

        let args = build_process_args(config.startup_command, image_entrypoint, image_cmd);

        let mem_limit = (config.memory_mb as i64) * 1024 * 1024;
        let mem_high = (mem_limit as f64 * 0.9) as i64;
        // Swap: memory + swap (0 means no swap limit). OCI spec uses
        // memory.swap as the total (memory + swap), not swap alone.
        let mem_swap = if config.swap_mb > 0 {
            // Use saturating_add to prevent overflow; memory values are u64 from config.
            // Cap at 1 TiB to prevent negative i64 cast which would create an
            // unlimited cgroup memory limit.
            let total_mb = config.memory_mb.saturating_add(config.swap_mb);
            let total_bytes = total_mb.saturating_mul(1024 * 1024);
            let capped = std::cmp::min(total_bytes, 1024u64 * 1024 * 1024 * 1024);
            Some(capped as i64)
        } else {
            None
        };
        let cpu_quota = (config.cpu_cores as i64) * 100_000;
        let cpu_weight = config.cpu_cores * 100;
        let cgroup_path = format!("/{}/{}", self.namespace, config.container_id);
        // Runtime containers run as non-root (1000:1000) and need minimal capabilities.
        let caps = ["CAP_NET_BIND_SERVICE"];
        let mut mounts = base_mounts(config.data_dir);
        // Pterodactyl images expect server data at /home/container; bind it to the same host dir as /data
        mounts.push(serde_json::json!({"destination":"/home/container","type":"bind","source":config.data_dir,"options":["rbind","rw"]}));
        // stdio is wired via CreateTaskRequest (stdin/stdout/stderr fields),
        // so no bind mounts are needed here.  Binding host log paths into the
        // container at those same absolute host paths would let a container
        // enumerate other containers' log directories.

        // Generate /etc/hosts so the container hostname resolves (Java getLocalHost() etc.)
        let hosts_path = io_dir.join("hosts");
        let hosts_content = format!(
            "127.0.0.1\tlocalhost\n::1\tlocalhost\n127.0.0.1\t{}\n",
            config.container_id
        );
        fs::write(&hosts_path, &hosts_content).ok();
        mounts.push(serde_json::json!({"destination":"/etc/hosts","type":"bind","source":hosts_path.to_string_lossy().to_string(),"options":["rbind","rw"]}));

        // Provide /etc/resolv.conf for DNS resolution inside the container
        // Use configured DNS servers (defaults to 1.1.1.1, 8.8.8.8)
        let resolv_path = io_dir.join("resolv.conf");
        {
            let mut resolv = String::new();
            for dns in &self.dns_servers {
                resolv.push_str(&format!("nameserver {}\n", dns));
            }
            // Add options for better DNS behavior
            resolv.push_str("options attempts:3 timeout:2\n");
            info!("Container {} resolv.conf:\n{}", config.container_id, resolv);
            fs::write(&resolv_path, &resolv).ok();
        }
        mounts.push(serde_json::json!({"destination":"/etc/resolv.conf","type":"bind","source":resolv_path.to_string_lossy().to_string(),"options":["rbind","rw"]}));

        // Generate a per-container /etc/machine-id so that containers cannot
        // fingerprint the host or correlate with other servers on the same node.
        // Java's SecureRandom and other tools may use this for seeding.
        let machine_id_path = io_dir.join("machine-id");
        if !machine_id_path.exists() {
            let unique_id = format!("{:032x}", uuid::Uuid::new_v4().as_u128());
            fs::write(&machine_id_path, &unique_id).ok();
        }
        mounts.push(serde_json::json!({"destination":"/etc/machine-id","type":"bind","source":machine_id_path.to_string_lossy(),"options":["rbind","ro"]}));
        mounts.push(serde_json::json!({"destination":"/var/lib/dbus/machine-id","type":"bind","source":machine_id_path.to_string_lossy(),"options":["rbind","ro"]}));
        let mut ns = vec![
            serde_json::json!({"type":"pid"}),
            serde_json::json!({"type":"ipc"}),
            serde_json::json!({"type":"uts"}),
            serde_json::json!({"type":"mount"}),
        ];
        if !use_host_network {
            ns.push(serde_json::json!({"type":"network"}));
        }

        let devices = DeviceProfile::standard().devices;

        Ok(serde_json::json!({
            "ociVersion":"1.1.0",
            "process":{"terminal":false,"user":{"uid":1000,"gid":1000},"args":args,"env":env_list,"cwd":"/data",
                "capabilities":{"bounding":caps,"effective":caps,"permitted":caps,"ambient":caps},
                "noNewPrivileges":true,"rlimits":[{"type":"RLIMIT_NOFILE","hard":65536u64,"soft":65536u64}]},
            "root":{"path":"rootfs","readonly":false},"hostname":config.container_id,"mounts":mounts,
            "linux":{"cgroupsPath":cgroup_path,"resources":{"memory":{"limit":mem_limit,
                "high":mem_high,"swap":mem_swap},"cpu":{"quota":cpu_quota,"period":100000u64,"weight":cpu_weight},
                "blockIO":{"weight":config.io_weight},
                "pids":{"limit":512},
                "devices":devices},
                "namespaces":ns,"maskedPaths":masked_paths(),"readonlyPaths":readonly_paths(),
                "seccomp": default_seccomp_profile()}
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|p| (*p).to_string()).collect()
    }

    #[test]
    fn wine_yolk_keeps_tini_and_entrypoint_sh() {
        // ghcr.io/ptero-eggs/yolks:wine_latest inherits debian_trixie:
        //   ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
        //   CMD        ["/bin/bash", "/entrypoint.sh"]
        let startup = "wine ./SonsOfTheForestDS.exe -userdatapath \"/home/container/serverconfig\" -dedicatedserver.IpAddress \"0.0.0.0\"";
        let entrypoint = s(&["/usr/bin/tini", "-g", "--"]);
        let cmd = s(&["/bin/bash", "/entrypoint.sh"]);
        let args = build_process_args(startup, Some(&entrypoint), Some(&cmd));
        assert_eq!(
            args,
            s(&["/usr/bin/tini", "-g", "--", "/bin/bash", "/entrypoint.sh"])
        );
        // Must NOT pass the raw startup string as tini's argv — that is the
        // [FATAL tini] exec wine ./SonsOfTheForestDS.exe ... ENOENT bug.
        assert!(!args.iter().any(|a| a.contains("SonsOfTheForestDS.exe")));
    }

    #[test]
    fn debian_trixie_cmd_only_entrypoint_sh() {
        let entrypoint = s(&["/usr/bin/tini", "-g", "--"]);
        let cmd = s(&["/entrypoint.sh"]);
        let args = build_process_args("java -jar server.jar", Some(&entrypoint), Some(&cmd));
        assert_eq!(args, s(&["/usr/bin/tini", "-g", "--", "/entrypoint.sh"]));
    }

    #[test]
    fn older_java_yolk_without_tini_still_uses_entrypoint_sh() {
        let cmd = s(&["/bin/bash", "/entrypoint.sh"]);
        let args = build_process_args("java -Xmx2048M -jar server.jar", None, Some(&cmd));
        assert_eq!(args, s(&["/bin/bash", "/entrypoint.sh"]));
    }

    #[test]
    fn tini_without_entrypoint_sh_wraps_spaced_startup() {
        let entrypoint = s(&["/usr/bin/tini", "-g", "--"]);
        let args = build_process_args("wine ./game.exe -port 25565", Some(&entrypoint), None);
        assert_eq!(
            args,
            s(&[
                "/usr/bin/tini",
                "-g",
                "--",
                "/bin/sh",
                "-c",
                "wine ./game.exe -port 25565"
            ])
        );
    }

    #[test]
    fn no_image_metadata_wraps_startup_in_shell() {
        let args = build_process_args("java -jar server.jar", None, None);
        assert_eq!(args[0], "/bin/sh");
        assert_eq!(args[1], "-c");
        assert!(args[2].contains("java -jar server.jar"));
    }

    #[test]
    fn empty_startup_falls_back_to_image_cmd() {
        let entrypoint = s(&["/usr/bin/tini", "--"]);
        let cmd = s(&["sleep", "infinity"]);
        let args = build_process_args("", Some(&entrypoint), Some(&cmd));
        assert_eq!(args, s(&["/usr/bin/tini", "--", "sleep", "infinity"]));
    }

    #[test]
    fn custom_image_cmd_is_not_treated_as_yolk_entrypoint() {
        // ubuntu:22.04 style CMD ["bash"] must not swallow the egg startup.
        let args = build_process_args("java -jar server.jar", None, Some(&s(&["bash"])));
        assert_eq!(args[0], "/bin/sh");
        assert_eq!(args[1], "-c");
        assert!(args[2].contains("java -jar server.jar"));
    }
}
