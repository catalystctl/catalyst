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
        // PATH is assembled once while building process.env. Do not prepend a
        // JDK here as well: doing so would shadow an explicitly selected
        // non-Temurin JDK whenever image metadata is unavailable.
        let wrapped_command = format!("exec {} -c {}", shell, escaped_startup);
        return vec![shell.to_string(), "-c".to_string(), wrapped_command];
    }

    if let Some(cmd) = cmd {
        return cmd.to_vec();
    }

    vec!["/bin/sh".to_string()]
}

/// Wine yolks only start Xvfb when `XVFB=1`. Without it, Unity dedicated
/// servers exit with "Failed to create batch mode window".
pub fn apply_wine_xvfb_default(image: &str, env: &mut HashMap<String, String>) {
    if env.contains_key("XVFB") {
        return;
    }
    let wine_image = image.to_ascii_lowercase().contains("wine");
    let wine_env = env.contains_key("WINEARCH")
        || env.contains_key("WINDOWS_INSTALL")
        || env.contains_key("WINETRICKS_RUN")
        || env
            .get("STARTUP")
            .is_some_and(|s| s.to_ascii_lowercase().contains("wine"));
    if wine_image || wine_env {
        env.insert("XVFB".to_string(), "1".to_string());
    }
}

pub fn base_mounts(data_dir: &str) -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({"destination":"/data","type":"bind","source":data_dir,"options":["rbind","rw"]}),
        serde_json::json!({"destination":"/proc","type":"proc","source":"proc"}),
        serde_json::json!({"destination":"/dev","type":"tmpfs","source":"tmpfs","options":["nosuid","strictatime","mode=755","size=65536k"]}),
        serde_json::json!({"destination":"/dev/pts","type":"devpts","source":"devpts","options":["nosuid","noexec","newinstance","ptmxmode=0666","mode=0620","gid=5"]}),
        serde_json::json!({"destination":"/dev/shm","type":"tmpfs","source":"shm","options":["nosuid","noexec","nodev","mode=1777","size=268435456"]}),
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

/// Bounds for panel-driven resource allocations. The OCI spec stores CPU
/// quota and memory limits as i64, so unclamped u64 panel values would
/// overflow the cast. Floor 1 keeps quota/limit nonzero (0 is runc's
/// "unset", i.e. unlimited).
pub const MAX_CPU_CORES: u64 = 128;
pub const MAX_MEMORY_MB: u64 = 262_144; // 256 GiB

/// OCI `linux.resources.cpu` for CFS bandwidth control.
///
/// Quota is enforced per 100ms period. Burst banks unused time as credit,
/// up to one full period, so transient spikes spend credit instead of
/// throttling the whole cgroup until the next refill. The long-term average
/// stays capped at quota.
pub(crate) fn linux_cpu_resources(cpu_cores: u64) -> serde_json::Value {
    // Defense in depth: quota 0 is runc's "unset" — an unlimited container.
    // A malformed backend message must degrade to a sane cap, never to none.
    let cpu_cores = cpu_cores.max(1);
    // runc 1.4.x on cgroup v2 ignores `cpu.weight` (verified empirically:
    // the cgroup keeps the default weight 100) but converts `shares`
    // lossily (1024 -> 174) and applies `unified["cpu.weight"]` exactly.
    // Emit shares (cgroup v1 + lossy v2 fallback) and unified weight
    // (exact v2) so proportional fairness holds on both cgroup versions.
    let burst_supported = crate::runtime_manager::helpers::kernel_supports_cpu_burst();
    linux_cpu_resources_with(cpu_cores, burst_supported)
}

/// like `linux_cpu_resources`, with the kernel-burst support passed in so
/// both branches are testable without root.
pub(crate) fn linux_cpu_resources_with(cpu_cores: u64, burst_supported: bool) -> serde_json::Value {
    // Clamp panel-driven core counts: floor 1 (quota 0 is runc's "unset",
    // i.e. unlimited) and ceiling 128 so the u64->i64 cast and the
    // quota multiplication below cannot overflow.
    let cpu_cores = cpu_cores.clamp(1, MAX_CPU_CORES);
    let quota = (cpu_cores as i64) * 100_000;
    let burst = cpu_cores.saturating_mul(100_000);
    let shares = cpu_cores.saturating_mul(1024);
    // cgroup v2 cpu.weight clamps to 1..=10000; a >100-core allocation
    // must saturate instead of failing container creation at spec-parse.
    let weight = cpu_cores.saturating_mul(100).min(10_000);
    // cpu.max.burst exists only on kernel >= 5.14; runc writes it literally,
    // so on older kernels with a modern runc the write fails task creation.
    // Omit the field where the kernel cannot accept it.
    let mut cpu = serde_json::json!({
        "quota": quota,
        "period": 100000u64,
        "shares": shares,
        "weight": weight,
    });
    if burst_supported {
        cpu["burst"] = serde_json::json!(burst);
    }
    cpu
}

/// Extra cgroup v2 (`unified`) keys for CPU fairness. Kept separate from
/// `linux_memory_resources` because both callers merge into the same map.
pub(crate) fn unified_cpu_weight(cpu_cores: u64) -> String {
    (cpu_cores.max(1).saturating_mul(100).min(10_000)).to_string()
}

/// OCI `linux.resources.memory` plus cgroup v2 `unified` map.
/// `memory.high` is not a portable OCI field; runc applies it via unified.
pub(crate) fn linux_memory_resources(
    memory_mb: u64,
    swap_mb: u64,
    reservation_mb: u64,
) -> (
    serde_json::Map<String, serde_json::Value>,
    serde_json::Value,
) {
    // Clamp panel-driven sizes so the u64->i64 casts and MB->bytes
    // multiplications below cannot overflow (floor 1: limit 0 is
    // runc's "unset", i.e. unlimited).
    let memory_mb = memory_mb.clamp(1, MAX_MEMORY_MB);
    let swap_mb = swap_mb.min(MAX_MEMORY_MB);
    let mem_limit = (memory_mb as i64) * 1024 * 1024;
    // memory.high is the kernel's throttle-threshold: allocation stalls in
    // synchronous reclaim once memory.current passes it. A 90% watermark
    // freezes game threads below the advertised limit (JVM heap + native
    // overhead routinely crosses it). Setting high == limit keeps the limit
    // as the single boundary: working sets that fit run untouched; oversized
    // ones hit a clean OOM kill (restartable) instead of recurring
    // multi-second reclaim freezes.
    let mem_high = mem_limit;
    let mut memory = serde_json::Map::new();
    memory.insert("limit".into(), serde_json::json!(mem_limit));
    if reservation_mb > 0 && reservation_mb < memory_mb {
        let reservation = (reservation_mb as i64) * 1024 * 1024;
        memory.insert("reservation".into(), serde_json::json!(reservation));
    }
    if swap_mb > 0 {
        let total_mb = memory_mb.saturating_add(swap_mb);
        let total_bytes = total_mb.saturating_mul(1024 * 1024);
        let capped = std::cmp::min(total_bytes, 1024u64 * 1024 * 1024 * 1024);
        memory.insert("swap".into(), serde_json::json!(capped as i64));
    } else {
        // SECURITY/robustness: with swap allocation 0 the cgroup's
        // memory.swap.max used to stay at "max" (unlimited swap), defeating
        // memory accounting under pressure. Setting swap == limit disables
        // swap for the cgroup entirely (Wings-style default).
        memory.insert("swap".into(), serde_json::json!(mem_limit));
    }
    let unified = serde_json::json!({
        "memory.high": mem_high.to_string()
    });
    (memory, unified)
}

/// OCI `blockIO.weight` (cgroup v1 blkio, 10..=1000) for panel-driven
/// True when this environment exposes the cgroup v2 `io` controller.
/// Unprivileged LXC containers and similar sandboxes often delegate only
/// `cpu memory pids`; runc then fails creating the container because it cannot
/// write `io.weight`. Unreadable means "assume present" to keep the previous
/// behaviour on normal nodes.
fn io_controller_available() -> bool {
    std::fs::read_to_string("/sys/fs/cgroup/cgroup.controllers")
        .map(|list| list.split_whitespace().any(|controller| controller == "io"))
        .unwrap_or(true)
}

/// ioWeight values. Out-of-range values degrade to the nearest bound
/// instead of failing spec-parse in runc.
pub fn clamp_io_weight(io_weight: u64) -> u64 {
    io_weight.clamp(10, 1000)
}

/// Namespaces for installer containers. Installers run untrusted egg scripts
/// but historically shared the host network namespace (full visibility into
/// host sockets) and saw the host's real cgroup hierarchy. Private
/// `network` + `cgroup` namespaces match the runtime-container posture;
/// the installer gets connectivity via CNI after task start.
pub fn installer_namespaces() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({"type":"pid"}),
        serde_json::json!({"type":"ipc"}),
        serde_json::json!({"type":"uts"}),
        serde_json::json!({"type":"mount"}),
        serde_json::json!({"type":"cgroup"}),
        serde_json::json!({"type":"network"}),
    ]
}

/// Where JVM base images put their JDK. `eclipse-temurin:*` (and the ptero
/// `yolks`/`hytale` images) install the JDK here and expose it only through the
/// image's own `PATH` entry — there is no `/usr/bin/java`.
pub const JAVA_BIN_DIR: &str = "/opt/java/openjdk/bin";

/// PATH used when neither the image nor the panel supplies one.
const DEFAULT_PATH: &str =
    "/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/// Shell variables that change startup behaviour or cause startup files to be
/// read before an egg script gets control.
///
/// `BASH_ENV` supplies a file for non-interactive bash to source; `ENV` is the
/// corresponding interactive POSIX-shell startup file (and is also honoured by
/// bash in POSIX mode). `SHELLOPTS` and `BASHOPTS` import bash option state,
/// including xtrace/verbose settings that can expose substituted secrets.
/// `POSIXLY_CORRECT` changes bash's startup and parsing mode as well as common
/// utility behaviour. Remove only these exact, case-sensitive names: locale,
/// proxy, and unrelated variables remain valid container configuration.
pub(crate) const SHELL_STARTUP_CONTROL_VARS: &[&str] = &[
    "BASH_ENV",
    "ENV",
    "SHELLOPTS",
    "BASHOPTS",
    "POSIXLY_CORRECT",
];

/// Remove shell startup controls from an OCI environment after merging image
/// and panel values. This deliberately does not clear the complete environment.
pub(crate) fn sanitize_shell_startup_env(env: &mut HashMap<String, String>) {
    for key in SHELL_STARTUP_CONTROL_VARS {
        env.remove(*key);
    }
}

/// Apply the same narrow filtering to host commands that inherit the agent's
/// environment and invoke a shell (for example the `nsenter ... sh -c` DNS
/// setup). Other inherited values, including locale and proxy settings, stay.
pub(crate) fn sanitize_shell_startup_command(command: &mut Command) {
    for key in SHELL_STARTUP_CONTROL_VARS {
        command.env_remove(key);
    }
}

/// Make sure `PATH` can resolve the Temurin JDK without taking priority over
/// an explicitly selected JDK. Existing nonblank values retain every byte and
/// segment; a missing Temurin entry is appended only as a fallback. Blank and
/// absent values receive a fixed default instead of allowing an empty segment
/// to put the current working directory first in command lookup.
pub fn ensure_java_on_path(env: &mut HashMap<String, String>) {
    let needs_default = env
        .get("PATH")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);
    if needs_default {
        env.insert("PATH".to_string(), DEFAULT_PATH.to_string());
        return;
    }

    let path_value = env.get("PATH").expect("nonempty PATH was present");
    if !path_value.split(':').any(|segment| segment == JAVA_BIN_DIR) {
        env.insert(
            "PATH".to_string(),
            format!("{}:{}", path_value, JAVA_BIN_DIR),
        );
    }
}

/// Merge an OCI image environment with panel overrides. Wings puts panel
/// variables in Docker's `container.Config.Env`; Docker then combines those
/// with the image configuration. Catalyst performs that merge explicitly, with
/// panel values winning key collisions.
fn build_container_env(
    image_env: &[String],
    overrides: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut env_map = HashMap::new();
    for entry in image_env {
        if let Some((key, value)) = entry.split_once('=') {
            env_map.insert(key.to_string(), value.to_string());
        }
    }
    for (key, value) in overrides {
        env_map.insert(key.clone(), value.clone());
    }
    sanitize_shell_startup_env(&mut env_map);
    ensure_java_on_path(&mut env_map);
    // Match an absent terminal type without replacing an image/panel choice.
    // An explicitly empty TERM is intentional and must survive as empty.
    env_map
        .entry("TERM".to_string())
        .or_insert_with(|| "xterm".to_string());
    env_map
}

/// Process environment for an install container. This keeps image-provided
/// `PATH`, `JAVA_HOME`, locale and proxy configuration while applying panel
/// overrides and the shared PATH/TERM/shell-startup policy.
pub fn build_installer_env(
    image_env: &[String],
    overrides: &HashMap<String, String>,
) -> Vec<String> {
    build_container_env(image_env, overrides)
        .into_iter()
        .map(|(key, value)| format!("{}={}", key, value))
        .collect()
}

/// Capabilities for installer containers. Installers stay uid 0 because egg
/// scripts call chown/chmod/useradd and the wrapper's exit trap does a final
/// `chown -R 1000:1000 /data`; noNewPrivileges + seccomp still apply.
/// SETUID/SETGID are required: Debian apt drops to the `_apt` user for
/// downloads, and useradd/su need them. DAC_OVERRIDE is required: the
/// server data dir is owned by the runtime user (uid 1000) and apt's
/// partial dir by `_apt`, so uid 0 without it gets EACCES on writes.
/// Bounded because the process is already uid 0 (nothing higher to gain)
/// and noNewPrivileges blocks setuid-exec escalation.
pub fn installer_capabilities() -> Vec<&'static str> {
    vec![
        "CAP_CHOWN",
        "CAP_FOWNER",
        "CAP_DAC_OVERRIDE",
        "CAP_SETUID",
        "CAP_SETGID",
        "CAP_NET_BIND_SERVICE",
    ]
}

const IMAGE_METADATA_BLOB_LIMIT: usize = 4 * 1024 * 1024;
const IMAGE_METADATA_TIMEOUT: Duration = Duration::from_secs(30);
const IMAGE_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_IMAGE_INDEX_NESTING: usize = 4;
const SNAPSHOT_PREPARE_TIMEOUT: Duration = Duration::from_secs(10);
// Metadata uses a much narrower cap than the historical generic content cap.
const _: () = assert!(IMAGE_METADATA_BLOB_LIMIT <= MAX_CONTENT_BLOB_SIZE);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImageMetadata {
    pub(crate) config_digest: String,
    pub(crate) env: Vec<String>,
    pub(crate) entrypoint: Option<Vec<String>>,
    pub(crate) cmd: Option<Vec<String>>,
    /// None delegates the Wings-compatible `/` fallback to the daemon caller.
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OciImageDocument {
    config: Option<OciDescriptor>,
    manifests: Option<Vec<OciManifestDescriptor>>,
}

#[derive(Debug, serde::Deserialize)]
struct OciDescriptor {
    digest: String,
    size: i64,
}

#[derive(Debug, serde::Deserialize)]
struct OciManifestDescriptor {
    digest: String,
    size: i64,
    platform: Option<OciPlatform>,
    annotations: Option<HashMap<String, String>>,
}

#[derive(Debug, serde::Deserialize)]
struct OciPlatform {
    architecture: Option<String>,
    os: Option<String>,
    variant: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HostImagePlatform {
    architecture: &'static str,
    preferred_variant: Option<&'static str>,
}

#[derive(Debug, serde::Deserialize)]
struct OciImageConfigFile {
    // architecture and os are required by the OCI image configuration spec;
    // variant is optional and is validated with the same canonical host rules
    // as an index descriptor. The nested `config` process object is optional.
    architecture: Option<String>,
    os: Option<String>,
    variant: Option<String>,
    config: Option<OciProcessConfig>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct OciProcessConfig {
    #[serde(rename = "Env")]
    env: Option<Vec<String>>,
    #[serde(rename = "Entrypoint")]
    entrypoint: Option<Vec<String>>,
    #[serde(rename = "Cmd")]
    cmd: Option<Vec<String>>,
    #[serde(rename = "WorkingDir")]
    working_dir: Option<String>,
}

fn metadata_error(context: &'static str) -> AgentError {
    AgentError::ContainerError(format!("Image metadata: {}", context))
}

/// Keep remote metadata errors short and avoid echoing untrusted status text,
/// image references, config values, or blob contents (which may be secrets).
fn metadata_rpc_error(operation: &'static str, error: tonic::Status) -> AgentError {
    AgentError::ContainerError(format!(
        "Image metadata {} failed with gRPC {:?}",
        operation,
        error.code()
    ))
}

fn parse_metadata_json<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
    kind: &'static str,
) -> AgentResult<T> {
    // Deliberately omit serde's source text: schema errors can quote input
    // values, including arbitrary environment strings from image configs.
    serde_json::from_slice(bytes)
        .map_err(|_| AgentError::ContainerError(format!("Image metadata: invalid {} JSON", kind)))
}

fn host_image_platform_argument() -> AgentResult<String> {
    if std::env::consts::OS != "linux" {
        return Err(metadata_error("unsupported non-Linux host OS"));
    }
    let host = host_image_platform_for(std::env::consts::ARCH)?;
    Ok(format!(
        "linux/{}{}",
        host.architecture,
        host.preferred_variant
            .map(|variant| format!("/{variant}"))
            .unwrap_or_default()
    ))
}

fn host_image_platform_for(arch: &str) -> AgentResult<HostImagePlatform> {
    match arch {
        "x86_64" => Ok(HostImagePlatform {
            architecture: "amd64",
            // OCI's amd64 v1 variant is commonly omitted.
            preferred_variant: None,
        }),
        "aarch64" => Ok(HostImagePlatform {
            architecture: "arm64",
            // Both an omitted variant and the conventional v8 are valid.
            preferred_variant: None,
        }),
        // ARCH == "arm" carries no hardware-version information. Do not guess
        // ARMv7 on a v5/v6 host. Explicit ARMv7 descriptors remain covered by
        // selection-normalization tests, but live host detection is limited to
        // the architectures this agent build actually identifies and supports.
        "arm" => Err(metadata_error(
            "indeterminate 32-bit ARM host variant; refusing to guess ARMv7",
        )),
        _ => Err(metadata_error("unsupported host architecture")),
    }
}

fn canonical_platform_matches(
    host: &HostImagePlatform,
    architecture: Option<&str>,
    os: Option<&str>,
    variant: Option<&str>,
) -> bool {
    if os != Some("linux") || architecture != Some(host.architecture) {
        return false;
    }
    match (host.architecture, variant) {
        // Docker/OCI commonly omit the initial architecture version.
        ("amd64", None | Some("v1")) | ("arm64", None | Some("v8")) => true,
        // The canonical 32-bit ARM target is ARMv7. Since std::env::consts
        // cannot establish another flavour, an absent or different variant is
        // indeterminate/incompatible rather than a reason to guess.
        ("arm", variant) => host.preferred_variant == Some("v7") && variant == Some("v7"),
        _ => false,
    }
}

fn manifest_platform_matches(manifest: &OciManifestDescriptor, host: &HostImagePlatform) -> bool {
    if manifest.annotations.as_ref().is_some_and(|annotations| {
        annotations
            .get("vnd.docker.reference.type")
            .map(String::as_str)
            == Some("attestation-manifest")
    }) {
        return false;
    }
    manifest.platform.as_ref().is_some_and(|platform| {
        canonical_platform_matches(
            host,
            platform.architecture.as_deref(),
            platform.os.as_deref(),
            platform.variant.as_deref(),
        )
    })
}

fn select_platform_manifest(
    document: &OciImageDocument,
    host: HostImagePlatform,
) -> AgentResult<&OciManifestDescriptor> {
    let manifests = document
        .manifests
        .as_ref()
        .ok_or_else(|| metadata_error("image index has no manifests array"))?;
    manifests
        .iter()
        .filter(|manifest| manifest_platform_matches(manifest, &host))
        // If an index has both an omitted and an explicit host variant, prefer
        // the explicit host variant. Never fall back to an arbitrary platform.
        .min_by_key(|manifest| {
            let explicit_preferred = manifest
                .platform
                .as_ref()
                .and_then(|platform| platform.variant.as_deref())
                == host.preferred_variant;
            if explicit_preferred {
                0
            } else {
                1
            }
        })
        .ok_or_else(|| metadata_error("image index has no manifest for the Linux host platform"))
}

fn validate_metadata_size(
    size: i64,
    kind: &'static str,
    source: &'static str,
) -> AgentResult<usize> {
    let size = usize::try_from(size).map_err(|_| {
        AgentError::ContainerError(format!(
            "Image metadata: negative {} size in {}",
            kind, source
        ))
    })?;
    if size > IMAGE_METADATA_BLOB_LIMIT {
        return Err(AgentError::ContainerError(format!(
            "Image metadata: {} exceeds the 4 MiB limit in {}",
            kind, source
        )));
    }
    Ok(size)
}

fn checked_metadata_read_size(limit: usize) -> AgentResult<i64> {
    let with_oversize_probe = limit
        .checked_add(1)
        .ok_or_else(|| metadata_error("metadata read size overflow"))?;
    i64::try_from(with_oversize_probe)
        .map_err(|_| metadata_error("metadata read size does not fit the protocol"))
}

fn append_metadata_chunk(
    data: &mut Vec<u8>,
    chunk: &[u8],
    limit: usize,
    kind: &'static str,
) -> AgentResult<()> {
    // Perform both remaining-capacity and addition checks before extending.
    // Equality is valid; the +1 byte requested from containerd is rejected here.
    let remaining = limit
        .checked_sub(data.len())
        .ok_or_else(|| metadata_error("metadata buffer exceeded its limit"))?;
    let new_len = data
        .len()
        .checked_add(chunk.len())
        .ok_or_else(|| metadata_error("metadata stream length overflow"))?;
    if chunk.len() > remaining || new_len > limit {
        return Err(AgentError::ContainerError(format!(
            "Image metadata: streamed {} exceeds the configured limit",
            kind
        )));
    }
    data.extend_from_slice(chunk);
    Ok(())
}

fn parse_image_config(
    bytes: &[u8],
    config_digest: String,
    host: HostImagePlatform,
) -> AgentResult<ImageMetadata> {
    let file: OciImageConfigFile = parse_metadata_json(bytes, "image config")?;
    let architecture = file
        .architecture
        .as_deref()
        .ok_or_else(|| metadata_error("image config is missing required architecture"))?;
    let os = file
        .os
        .as_deref()
        .ok_or_else(|| metadata_error("image config is missing required os"))?;
    if !canonical_platform_matches(&host, Some(architecture), Some(os), file.variant.as_deref()) {
        return Err(metadata_error(
            "image config platform does not match the canonical Linux host platform",
        ));
    }

    // OCI makes the process config object OPTIONAL. Both a null object and an
    // omitted object therefore produce Docker-compatible empty process fields;
    // present fields with invalid types still fail typed deserialization above.
    let config = file.config.unwrap_or_default();
    let working_dir = match config.working_dir {
        None => None,
        // Docker treats an omitted, null, or empty WorkingDir as unset. The
        // daemon caller owns the Wings-compatible `/` fallback.
        Some(path) if path.is_empty() => None,
        Some(path) => {
            // serde String guarantees UTF-8. OCI uses Unix absolute paths even
            // when the registry is remote; never pass relative cwd to runc.
            if !path.starts_with('/') || path.as_bytes().contains(&0) {
                return Err(metadata_error(
                    "image WorkingDir must be an absolute, nonempty UTF-8 path without NUL",
                ));
            }
            Some(path)
        }
    };
    Ok(ImageMetadata {
        config_digest,
        env: config.env.unwrap_or_default(),
        entrypoint: config.entrypoint,
        cmd: config.cmd,
        working_dir,
    })
}

/// Resolve a target through nested OCI indexes without recursive async calls.
/// The caller's content reader performs the same bounded Content.Info and Read
/// operations for every target/index/manifest/config descriptor, while the
/// public metadata entry point supplies one overall deadline around all reads.
async fn resolve_image_metadata<F, Fut>(
    target: OciDescriptor,
    host: HostImagePlatform,
    mut read_blob: F,
) -> AgentResult<ImageMetadata>
where
    F: FnMut(OciDescriptor, &'static str) -> Fut,
    Fut: std::future::Future<Output = AgentResult<Vec<u8>>>,
{
    let mut descriptor = target;
    let mut index_documents = 0usize;
    let config_descriptor = loop {
        let kind = if index_documents == 0 {
            "image target"
        } else {
            "selected platform manifest"
        };
        let bytes = read_blob(descriptor, kind).await?;
        let document: OciImageDocument = parse_metadata_json(&bytes, kind)?;
        if document.config.is_some() && document.manifests.is_some() {
            return Err(metadata_error(
                "image target ambiguously contains both config and manifests",
            ));
        }

        if document.manifests.is_some() {
            if index_documents >= MAX_IMAGE_INDEX_NESTING {
                return Err(metadata_error(
                    "image index nesting exceeds the maximum depth of 4",
                ));
            }
            let selected = select_platform_manifest(&document, host)?;
            index_documents += 1;
            descriptor = OciDescriptor {
                digest: selected.digest.clone(),
                size: selected.size,
            };
            continue;
        }

        break document.config.ok_or_else(|| {
            if index_documents == 0 {
                metadata_error("image manifest has no config descriptor")
            } else {
                metadata_error("selected manifest has no config descriptor")
            }
        })?;
    };

    if config_descriptor.digest.is_empty() {
        return Err(metadata_error(
            "image config descriptor has an empty digest",
        ));
    }
    let config_digest = config_descriptor.digest.clone();
    let config_bytes = read_blob(config_descriptor, "image config").await?;
    parse_image_config(&config_bytes, config_digest, host)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SnapshotPrepareFailure {
    Timeout,
    AlreadyExists,
    Rpc(tonic::Code),
}

fn snapshot_failure_from_status(status: &tonic::Status) -> SnapshotPrepareFailure {
    if status.code() == tonic::Code::AlreadyExists {
        SnapshotPrepareFailure::AlreadyExists
    } else {
        SnapshotPrepareFailure::Rpc(status.code())
    }
}

fn image_parent_fallback_failure(
    failure: SnapshotPrepareFailure,
) -> AgentResult<SnapshotPrepareFailure> {
    if failure == SnapshotPrepareFailure::AlreadyExists {
        // Never fall through and mistake an existing/stale key for a newly
        // prepared rootfs. The caller's failure path owns explicit removal.
        Err(snapshot_prepare_error("image-parent attempt", failure))
    } else {
        Ok(failure)
    }
}

/// Diagnostics contain only our phase labels and protocol-level causes. In
/// particular, never append Status::message, a snapshot key, a parent label or
/// an image reference: those are daemon-controlled and can contain secrets.
fn snapshot_prepare_diagnostic(phase: &'static str, failure: SnapshotPrepareFailure) -> String {
    let cause = match failure {
        SnapshotPrepareFailure::Timeout => {
            format!("timed out after {}ms", SNAPSHOT_PREPARE_TIMEOUT.as_millis())
        }
        SnapshotPrepareFailure::AlreadyExists => {
            "failed with gRPC AlreadyExists (snapshot key already exists)".to_string()
        }
        SnapshotPrepareFailure::Rpc(code) => format!("failed with gRPC {code:?}"),
    };
    format!("Snapshot prepare {phase} {cause}")
}

fn snapshot_prepare_error(phase: &'static str, failure: SnapshotPrepareFailure) -> AgentError {
    AgentError::ContainerError(snapshot_prepare_diagnostic(phase, failure))
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
        // This is a local existence probe, not an image pull. Give it its own
        // short deadline so a wedged daemon cannot stall before the later,
        // independently bounded metadata lookup. Do not include the reference
        // or tonic's untrusted status message in the timeout diagnostic.
        match tokio::time::timeout(IMAGE_PREFLIGHT_TIMEOUT, client.get(req)).await {
            Ok(Ok(_)) => return Ok(()),
            Ok(Err(e)) if e.code() == tonic::Code::NotFound => {
                info!("Image {} not found, pulling...", qualified)
            }
            Ok(Err(e)) => {
                return Err(AgentError::ContainerError(format!(
                    "Image ensure preflight Images.Get failed with gRPC {:?}",
                    e.code()
                )))
            }
            Err(_) => {
                return Err(AgentError::ContainerError(format!(
                    "Image ensure preflight Images.Get exceeded its {}ms deadline",
                    IMAGE_PREFLIGHT_TIMEOUT.as_millis()
                )))
            }
        }
        const IMAGE_PULL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
        let output = tokio::time::timeout(
            IMAGE_PULL_TIMEOUT,
            Command::new("ctr")
                .kill_on_drop(true)
                .arg("-n")
                .arg(&self.namespace)
                .arg("images")
                .arg("pull")
                .arg("--snapshotter")
                .arg("overlayfs")
                .arg("--platform")
                .arg(host_image_platform_argument()?)
                .arg(&qualified)
                .output(),
        )
        .await
        .map_err(|_| {
            AgentError::ContainerError(format!(
                "Image pull timed out after {}s: {}",
                IMAGE_PULL_TIMEOUT.as_secs(),
                qualified
            ))
        })?
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
        // Preserve an optional digest. Docker references without a tag but with
        // a digest do not acquire a synthetic :latest tag.
        let (reference, digest) = match image.split_once('@') {
            Some((reference, digest)) => (reference, Some(digest)),
            None => (image, None),
        };

        // A colon is a tag separator only after the final slash. Earlier
        // colons belong to a registry endpoint, including host:port and IPv6.
        let last_slash = reference.rfind('/');
        let tag_separator = reference
            .rfind(':')
            .filter(|colon| last_slash.is_none_or(|slash| *colon > slash));
        let (name, tag) = match tag_separator {
            Some(colon) => (&reference[..colon], &reference[colon..]),
            None => (reference, ""),
        };
        let default_tag = if tag.is_empty() && digest.is_none() {
            ":latest"
        } else {
            ""
        };

        // Docker's first path component is a registry only when it is a
        // recognizable endpoint. Thus user/img is a Docker Hub namespace, not
        // an already-qualified registry reference.
        let qualified_name = match name.split_once('/') {
            Some((first, _))
                if first == "localhost" || first.contains('.') || first.contains(':') =>
            {
                name.to_string()
            }
            Some(_) => format!("docker.io/{}", name),
            None => format!("docker.io/library/{}", name),
        };

        let mut qualified = format!("{}{}{}", qualified_name, tag, default_tag);
        if let Some(digest) = digest {
            qualified.push('@');
            qualified.push_str(digest);
        }
        qualified
    }

    /// Strict, bounded image configuration lookup for callers that need the
    /// environment, command configuration, working directory and config digest
    /// consistently from one selected manifest.
    pub(crate) async fn get_image_metadata(&self, image: &str) -> AgentResult<ImageMetadata> {
        self.get_image_metadata_with_timeout(image, IMAGE_METADATA_TIMEOUT)
            .await
    }

    /// Testable overall deadline: connection, Images.Get, Content.Info and every
    /// selected content stream all share this one budget.
    async fn get_image_metadata_with_timeout(
        &self,
        image: &str,
        deadline: Duration,
    ) -> AgentResult<ImageMetadata> {
        tokio::time::timeout(deadline, self.get_image_metadata_inner(image))
            .await
            .map_err(|_| {
                AgentError::ContainerError(format!(
                    "Image metadata exceeded its overall {}ms deadline",
                    deadline.as_millis()
                ))
            })?
    }

    async fn get_image_metadata_inner(&self, image: &str) -> AgentResult<ImageMetadata> {
        if std::env::consts::OS != "linux" {
            return Err(metadata_error("unsupported non-Linux host OS"));
        }
        let host = host_image_platform_for(std::env::consts::ARCH)?;
        let image = Self::qualify_image_ref(image);
        let mut images = ImagesClient::new(self.channel.clone());
        let req = with_namespace!(GetImageRequest { name: image }, &self.namespace);
        let response = images
            .get(req)
            .await
            .map_err(|error| metadata_rpc_error("Images.Get", error))?;
        let target = response
            .into_inner()
            .image
            .ok_or_else(|| metadata_error("Images.Get returned no image"))?
            .target
            .ok_or_else(|| metadata_error("image has no target descriptor"))?;
        let target = OciDescriptor {
            digest: target.digest,
            size: target.size,
        };
        resolve_image_metadata(target, host, |descriptor, kind| async move {
            self.read_image_metadata_blob(&descriptor.digest, descriptor.size, kind)
                .await
        })
        .await
    }

    /// Compatibility fallback wrapper. Strict metadata errors intentionally
    /// retain the historical empty-environment fallback for existing callers.
    #[allow(dead_code)]
    pub(crate) async fn get_image_env(&self, image: &str) -> Vec<String> {
        match self.get_image_metadata(image).await {
            Ok(metadata) => metadata.env,
            Err(error) => {
                warn!("Failed to read image env for {}: {}", image, error);
                vec![]
            }
        }
    }

    /// Compatibility fallback wrapper. The tuple preserves present-but-empty
    /// Entrypoint/Cmd arrays on success and falls back to (None, None) on error.
    #[allow(dead_code)]
    pub(crate) async fn get_image_entrypoint(
        &self,
        image: &str,
    ) -> (Option<Vec<String>>, Option<Vec<String>>) {
        match self.get_image_metadata(image).await {
            Ok(metadata) => (metadata.entrypoint, metadata.cmd),
            Err(error) => {
                warn!("Failed to read image entrypoint for {}: {}", image, error);
                (None, None)
            }
        }
    }

    pub(crate) async fn resolve_image_config_digest(&self, image: &str) -> AgentResult<String> {
        Ok(self.get_image_metadata(image).await?.config_digest)
    }

    async fn resolve_snapshot_parent_key_for_config_digest(
        &self,
        config_digest: &str,
    ) -> AgentResult<Option<String>> {
        if config_digest.is_empty() {
            return Err(metadata_error(
                "empty config digest for snapshot parent lookup",
            ));
        }
        let mut content = ContentClient::new(self.channel.clone());
        let req = with_namespace!(
            InfoRequest {
                digest: config_digest.to_string(),
            },
            &self.namespace
        );
        let response = tokio::time::timeout(IMAGE_METADATA_TIMEOUT, content.info(req))
            .await
            .map_err(|_| metadata_error("snapshot parent Content.Info exceeded its deadline"))?
            .map_err(|error| metadata_rpc_error("snapshot parent Content.Info", error))?;
        let labels = response
            .into_inner()
            .info
            .map(|info| info.labels)
            .unwrap_or_default();
        Ok(labels
            .get("containerd.io/gc.ref.snapshot.overlayfs")
            .cloned())
    }

    pub(crate) async fn resolve_snapshot_parent_key(
        &self,
        image: &str,
    ) -> AgentResult<Option<String>> {
        let config_digest = self.resolve_image_config_digest(image).await?;
        self.resolve_snapshot_parent_key_for_config_digest(&config_digest)
            .await
    }

    async fn read_image_metadata_blob(
        &self,
        digest: &str,
        descriptor_size: i64,
        kind: &'static str,
    ) -> AgentResult<Vec<u8>> {
        if digest.is_empty() {
            return Err(metadata_error("metadata descriptor has an empty digest"));
        }
        // Reject a malformed descriptor before issuing any content read.
        let descriptor_size = validate_metadata_size(descriptor_size, kind, "descriptor")?;
        let mut content = ContentClient::new(self.channel.clone());
        let info_req = with_namespace!(
            InfoRequest {
                digest: digest.to_string(),
            },
            &self.namespace
        );
        let info = content
            .info(info_req)
            .await
            .map_err(|error| metadata_rpc_error("metadata Content.Info", error))?
            .into_inner()
            .info
            .ok_or_else(|| metadata_error("metadata Content.Info returned no info"))?;
        let stored_size = validate_metadata_size(info.size, kind, "content info")?;
        if descriptor_size != stored_size {
            return Err(metadata_error(
                "metadata descriptor and content info sizes disagree",
            ));
        }

        // A nonzero ReadContentRequest.size is essential: zero means unbounded.
        // The extra byte lets a nonconforming service expose an oversized blob,
        // while append_metadata_chunk below independently enforces the cap.
        let read_size = checked_metadata_read_size(IMAGE_METADATA_BLOB_LIMIT)?;
        let read_req = with_namespace!(
            ReadContentRequest {
                digest: digest.to_string(),
                size: read_size,
                ..Default::default()
            },
            &self.namespace
        );
        let mut stream = content
            .read(read_req)
            .await
            .map_err(|error| metadata_rpc_error("metadata Content.Read", error))?
            .into_inner();
        let mut data = Vec::new();
        while let Some(chunk) = stream
            .message()
            .await
            .map_err(|error| metadata_rpc_error("metadata Content.Read stream", error))?
        {
            append_metadata_chunk(&mut data, &chunk.data, IMAGE_METADATA_BLOB_LIMIT, kind)?;
        }
        if data.len() != stored_size {
            return Err(metadata_error(
                "metadata stream length differs from Content.Info",
            ));
        }
        Ok(data)
    }

    #[allow(dead_code)]
    pub(crate) async fn prepare_snapshot(&self, image: &str, key: &str) -> AgentResult<()> {
        self.prepare_snapshot_with_config_digest(image, key, None)
            .await
    }

    /// Prepare an overlay snapshot. Supplying the config digest returned by
    /// get_image_metadata makes the parent-label fallback a single Content.Info
    /// call instead of a second Images.Get/manifest/config traversal.
    pub(crate) async fn prepare_snapshot_with_config_digest(
        &self,
        image: &str,
        key: &str,
        config_digest: Option<&str>,
    ) -> AgentResult<()> {
        let image = Self::qualify_image_ref(image);
        // Supported containerd pulls unpack by default; `ctr images unpack` is
        // not a portable subcommand (and is absent in ctr v2.4.2). Never treat a
        // cached image as unpacked merely because its content exists. Success is
        // conservative: a real bounded Snapshots.Prepare below must succeed with
        // either the image parent or the config's overlayfs snapshot label. A
        // cached legacy image with neither usable parent reaches an explicit Err.
        let mut snaps = SnapshotsClient::new(self.channel.clone());
        // Try using image ref as parent first (works on some containerd setups).
        let req = PrepareSnapshotRequest {
            snapshotter: "overlayfs".to_string(),
            key: key.to_string(),
            parent: image.clone(),
            ..Default::default()
        };
        let req = with_namespace!(req, &self.namespace);
        let first_failure =
            match tokio::time::timeout(SNAPSHOT_PREPARE_TIMEOUT, snaps.prepare(req)).await {
                Ok(Ok(_)) => return Ok(()),
                Ok(Err(status)) => {
                    image_parent_fallback_failure(snapshot_failure_from_status(&status))?
                }
                Err(_) => SnapshotPrepareFailure::Timeout,
            };
        let first_diagnostic = snapshot_prepare_diagnostic("image-parent attempt", first_failure);

        // Use the already-selected config identity whenever available. Only the
        // legacy wrapper, which has no stored metadata, resolves from the image.
        let parent_result = match config_digest {
            Some(digest) => {
                self.resolve_snapshot_parent_key_for_config_digest(digest)
                    .await
            }
            None => self.resolve_snapshot_parent_key(&image).await,
        };
        let parent = match parent_result {
            Ok(parent) => parent,
            Err(error) => {
                return Err(AgentError::ContainerError(format!(
                    "{first_diagnostic}; label-parent lookup failed: {error}"
                )))
            }
        };
        if let Some(parent) = parent {
            let req = PrepareSnapshotRequest {
                snapshotter: "overlayfs".to_string(),
                key: key.to_string(),
                parent,
                ..Default::default()
            };
            let req = with_namespace!(req, &self.namespace);
            let second_failure =
                match tokio::time::timeout(SNAPSHOT_PREPARE_TIMEOUT, snaps.prepare(req)).await {
                    Ok(Ok(_)) => return Ok(()),
                    Ok(Err(status)) => snapshot_failure_from_status(&status),
                    Err(_) => SnapshotPrepareFailure::Timeout,
                };
            return Err(AgentError::ContainerError(format!(
                "{first_diagnostic}; {}",
                snapshot_prepare_diagnostic("label-parent attempt", second_failure)
            )));
        }

        warn!("No overlayfs snapshot parent label found after image-parent prepare failed");
        Err(AgentError::ContainerError(format!(
            "{first_diagnostic}; label-parent attempt unavailable because no overlayfs snapshot parent label was returned"
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
        // Use the same image/panel precedence and environment policy as the
        // installer. Runtime-only values are overlaid below.
        let mut env_map = build_container_env(image_env, config.env);
        // Runtime container runs as 1000:1000; set HOME to the data dir
        env_map.insert("HOME".to_string(), "/data".to_string());
        if !config.startup_command.is_empty() {
            env_map.insert("STARTUP".to_string(), config.startup_command.to_string());
        }
        apply_wine_xvfb_default(config.image, &mut env_map);
        let env_list: Vec<String> = env_map
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect();

        let args = build_process_args(config.startup_command, image_entrypoint, image_cmd);

        let (memory, mut unified) = linux_memory_resources(
            config.memory_mb,
            config.swap_mb,
            config.memory_reservation_mb,
        );
        if let Some(unified_map) = unified.as_object_mut() {
            unified_map.insert(
                "cpu.weight".to_string(),
                serde_json::json!(unified_cpu_weight(config.cpu_cores)),
            );
        }
        let cpu = linux_cpu_resources(config.cpu_cores);
        let cgroup_path = format!("/{}/{}", self.namespace, config.container_id);
        // Runtime containers run as non-root (1000:1000) and need minimal capabilities.
        let caps = ["CAP_NET_BIND_SERVICE"];
        let mut mounts = base_mounts(config.data_dir);
        // Pterodactyl images expect server data at /home/container; bind it to the same host dir as /data
        mounts.push(serde_json::json!({"destination":"/home/container","type":"bind","source":config.data_dir,"options":["rbind","rw"]}));
        // Wings: tmpfs /tmp (exec allowed — some servers unpack helpers there).
        mounts.push(serde_json::json!({"destination":"/tmp","type":"tmpfs","source":"tmpfs","options":["nosuid","nodev","mode=1777","size=104857600"]}));
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
        set_dir_perms(&hosts_path, 0o644);
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
            write_container_bind_file(&resolv_path, &resolv);
        }
        mounts.push(serde_json::json!({"destination":"/etc/resolv.conf","type":"bind","source":resolv_path.to_string_lossy().to_string(),"options":["rbind","rw"]}));

        // Generate a per-container /etc/machine-id so that containers cannot
        // fingerprint the host or correlate with other servers on the same node.
        // Java's SecureRandom and other tools may use this for seeding.
        let machine_id_path = io_dir.join("machine-id");
        if !machine_id_path.exists() {
            let unique_id = format!("{:032x}", uuid::Uuid::new_v4().as_u128());
            write_container_bind_file(&machine_id_path, &unique_id);
        } else {
            set_dir_perms(&machine_id_path, 0o644);
        }
        mounts.push(serde_json::json!({"destination":"/etc/machine-id","type":"bind","source":machine_id_path.to_string_lossy(),"options":["rbind","ro"]}));
        mounts.push(serde_json::json!({"destination":"/var/lib/dbus/machine-id","type":"bind","source":machine_id_path.to_string_lossy(),"options":["rbind","ro"]}));
        let mut ns = vec![
            serde_json::json!({"type":"pid"}),
            serde_json::json!({"type":"ipc"}),
            serde_json::json!({"type":"uts"}),
            serde_json::json!({"type":"mount"}),
            // Private cgroup namespace: without it the read-only /sys/fs/cgroup
            // bind exposes the host's real hierarchy — sibling container IDs,
            // the agent's cgroup, and node-level counters — to any process in
            // the container. runc/Docker defaults include it.
            serde_json::json!({"type":"cgroup"}),
        ];
        if !use_host_network {
            ns.push(serde_json::json!({"type":"network"}));
        }

        let devices = DeviceProfile::standard().devices;
        // Panel-driven ioWeight clamped to the blkio 10..=1000 range so an
        // absurd value cannot fail spec-parse in runc.
        let io_weight = clamp_io_weight(config.io_weight);

        let mut resources = serde_json::json!({
            "memory": memory,
            "cpu": cpu,
            "pids": {"limit": 2048},
            "devices": devices,
            "unified": unified,
        });
        // runc fails hard when the cgroup v2 `io` controller is missing (common
        // inside an unprivileged LXC or a similar sandbox), so only ask for a
        // blockIO weight when the controller is actually present.
        if io_controller_available() {
            resources["blockIO"] = serde_json::json!({"weight": io_weight});
        }

        Ok(serde_json::json!({
            "ociVersion":"1.1.0",
            "process":{"terminal":false,"user":{"uid":1000,"gid":1000},"args":args,"env":env_list,"cwd":"/data",
                "capabilities":{"bounding":caps,"effective":caps,"permitted":caps,"ambient":caps},
                "noNewPrivileges":true,"rlimits":[{"type":"RLIMIT_NOFILE","hard":65536u64,"soft":65536u64}]},
            "root":{"path":"rootfs","readonly":false},"hostname":config.container_id,"mounts":mounts,
            "linux":{"cgroupsPath":cgroup_path,"resources":resources,
                "namespaces":ns,"maskedPaths":masked_paths(),"readonlyPaths":readonly_paths(),
                "seccomp": default_seccomp_profile(),
                "sysctl": container_net_sysctls(use_host_network)}
        }))
    }
}

/// Per-network-namespace socket sysctls. A new netns inherits kernel
/// defaults (rmem/wmem max ~208 KiB), silently clamping game servers'
/// setsockopt(SO_RCVBUF) bursts above that — packet loss and jitter that
/// hosts with tuned sysctls never see.
///
/// Only `net.ipv4.tcp_*` keys are set: runc writes net sysctls after
/// netns creation while still holding the container's init privileges,
/// and `net.core.*` writes require CAP_NET_ADMIN in that netns — the
/// runtime spec grants only CAP_NET_BIND_SERVICE, so `net.core.*` here
/// fails container creation (verified against runc 1.4.3). tcp_rmem/tcp_wmem
/// autotuning maximums apply without extra caps and are the knobs that
/// matter for throughput; UDP SO_RCVBUF requests still clamp to the
/// inherited net.core.rmem_max, which node-level tuning (node-tuning.sh)
/// raises for the whole host.
/// Applied only when the container creates its own netns (host-network
/// containers inherit the host's).
fn container_net_sysctls(use_host_network: bool) -> serde_json::Value {
    if use_host_network {
        return serde_json::json!({});
    }
    serde_json::json!({
        "net.ipv4.tcp_rmem": "4096 87380 16777216",
        "net.ipv4.tcp_wmem": "4096 65536 16777216"
    })
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

    #[test]
    fn wine_image_defaults_xvfb() {
        let mut env = HashMap::new();
        apply_wine_xvfb_default("ghcr.io/ptero-eggs/yolks:wine_latest", &mut env);
        assert_eq!(env.get("XVFB").map(String::as_str), Some("1"));
    }

    #[test]
    fn explicit_xvfb_is_preserved() {
        let mut env = HashMap::from([("XVFB".to_string(), "0".to_string())]);
        apply_wine_xvfb_default("ghcr.io/ptero-eggs/yolks:wine_latest", &mut env);
        assert_eq!(env.get("XVFB").map(String::as_str), Some("0"));
    }

    #[test]
    fn java_image_does_not_set_xvfb() {
        let mut env = HashMap::new();
        apply_wine_xvfb_default("ghcr.io/ptero-eggs/yolks:java_25", &mut env);
        assert!(!env.contains_key("XVFB"));
    }

    #[test]
    fn memory_resources_disables_swap_when_zero() {
        let (memory, unified) = linux_memory_resources(2048, 0, 0);
        let limit = 2048i64 * 1024 * 1024;
        assert_eq!(memory.get("limit"), Some(&serde_json::json!(limit)));
        // SECURITY: swap allocation 0 must DISABLE swap (swap == limit), not
        // leave the cgroup at the kernel default "max" (unlimited).
        assert_eq!(memory.get("swap"), Some(&serde_json::json!(limit)));
        assert!(!memory.contains_key("reservation"));
        // memory.high must equal the limit: a 90% watermark stalls game
        // threads in synchronous reclaim below the advertised allocation.
        assert_eq!(
            unified.get("memory.high"),
            Some(&serde_json::json!(limit.to_string()))
        );
    }

    #[test]
    fn memory_resources_swap_is_memory_plus_swap() {
        let (memory, _) = linux_memory_resources(2048, 512, 0);
        assert_eq!(
            memory.get("swap"),
            Some(&serde_json::json!(2560i64 * 1024 * 1024))
        );
    }

    #[test]
    fn memory_resources_reservation_below_limit() {
        let (memory, _) = linux_memory_resources(2688, 0, 2048);
        assert_eq!(
            memory.get("reservation"),
            Some(&serde_json::json!(2048i64 * 1024 * 1024))
        );
    }

    #[test]
    fn cpu_resources_banks_one_full_period_as_burst() {
        // 2 cores -> 200ms quota per 100ms period, burst equals quota.
        // shares feed cgroup v1 (and the lossy v2 fallback); unified
        // cpu.weight is the exact v2 knob.
        let cpu = linux_cpu_resources_with(2, true);
        assert_eq!(cpu.get("quota"), Some(&serde_json::json!(200000i64)));
        assert_eq!(cpu.get("period"), Some(&serde_json::json!(100000u64)));
        assert_eq!(cpu.get("burst"), Some(&serde_json::json!(200000u64)));
        assert_eq!(cpu.get("shares"), Some(&serde_json::json!(2048i64)));
        assert_eq!(cpu.get("weight"), Some(&serde_json::json!(200u64)));
        assert_eq!(unified_cpu_weight(2), "200");
    }

    #[test]
    fn cpu_resources_single_core_burst_equals_quota() {
        let cpu = linux_cpu_resources_with(1, true);
        assert_eq!(cpu.get("quota"), Some(&serde_json::json!(100000i64)));
        assert_eq!(cpu.get("burst"), Some(&serde_json::json!(100000u64)));
        assert_eq!(cpu.get("shares"), Some(&serde_json::json!(1024i64)));
        assert_eq!(unified_cpu_weight(1), "100");
    }

    #[test]
    fn cpu_resources_omit_burst_when_kernel_lacks_it() {
        // Kernel < 5.14 + modern runc: writing cpu.max.burst fails task
        // creation, so the field must be absent entirely.
        let cpu = linux_cpu_resources_with(2, false);
        assert!(cpu.get("burst").is_none());
        assert_eq!(cpu.get("quota"), Some(&serde_json::json!(200000i64)));
    }

    #[test]
    fn cpu_resources_zero_cores_degrades_to_one() {
        // quota 0 is runc's "unset" (unlimited); a malformed allocation
        // must clamp to 1 core, never produce an uncapped container.
        let cpu = linux_cpu_resources_with(0, true);
        assert_eq!(cpu.get("quota"), Some(&serde_json::json!(100000i64)));
        assert_eq!(unified_cpu_weight(0), "100");
    }

    #[test]
    fn cpu_resources_weight_clamps_at_kernel_max() {
        // 128-core allocation: cpu.weight saturates at the kernel's 10000
        // instead of failing container creation.
        let cpu = linux_cpu_resources_with(128, true);
        assert_eq!(cpu.get("weight"), Some(&serde_json::json!(10000u64)));
        assert_eq!(unified_cpu_weight(128), "10000");
    }

    #[test]
    fn cpu_resources_weight_scales_with_cores() {
        // Proportional fairness: an 8-core server must weigh 8x a 1-core one
        // on both cgroup versions (runc 1.4.x drops cpu.weight on v2, so the
        // unified map is what actually lands there).
        let cpu = linux_cpu_resources(8);
        assert_eq!(cpu.get("shares"), Some(&serde_json::json!(8192i64)));
        assert_eq!(unified_cpu_weight(8), "800");
    }

    #[test]
    fn cpu_resources_clamp_huge_and_zero() {
        // u64::MAX cores must saturate at 128 (12.8M quota), never overflow
        // the i64 cast or wrap to a negative/unlimited quota.
        let cpu = linux_cpu_resources_with(u64::MAX, true);
        assert_eq!(cpu.get("quota"), Some(&serde_json::json!(12_800_000i64)));
        // 0 cores floors to 1.
        let cpu = linux_cpu_resources_with(0, false);
        assert_eq!(cpu.get("quota"), Some(&serde_json::json!(100_000i64)));
    }

    #[test]
    fn memory_resources_clamp_huge_and_zero() {
        // u64::MAX MB must saturate at 256 GiB in bytes, never overflow i64.
        let (memory, _) = linux_memory_resources(u64::MAX, u64::MAX, 0);
        assert_eq!(
            memory.get("limit"),
            Some(&serde_json::json!(274_877_906_944i64))
        );
        // 0 MB floors to 1 MB (limit 0 is runc's "unset" = unlimited).
        let (memory, _) = linux_memory_resources(0, 0, 0);
        assert_eq!(memory.get("limit"), Some(&serde_json::json!(1_048_576i64)));
    }

    #[test]
    fn qualify_image_ref_handles_namespaces_registries_and_digests_idempotently() {
        let cases = [
            ("alpine", "docker.io/library/alpine:latest"),
            ("alpine:3.19", "docker.io/library/alpine:3.19"),
            ("user/img", "docker.io/user/img:latest"),
            ("user/img:1.0", "docker.io/user/img:1.0"),
            ("ghcr.io/o/i:t", "ghcr.io/o/i:t"),
            ("ghcr.io/o/i", "ghcr.io/o/i:latest"),
            // Registry host:port must not be treated as a tag separator.
            ("localhost/i", "localhost/i:latest"),
            ("localhost:5000/i", "localhost:5000/i:latest"),
            ("localhost:5000/i:t", "localhost:5000/i:t"),
            ("127.0.0.1/i", "127.0.0.1/i:latest"),
            ("127.0.0.1:5000/i:t", "127.0.0.1:5000/i:t"),
            ("[::1]:5000/ns/i:t", "[::1]:5000/ns/i:t"),
            // Digest-only refs already identify immutable content; no :latest.
            ("img@sha256:abc123", "docker.io/library/img@sha256:abc123"),
            ("user/img@sha256:abc123", "docker.io/user/img@sha256:abc123"),
            (
                "localhost:5000/ns/img@sha256:abc123",
                "localhost:5000/ns/img@sha256:abc123",
            ),
            (
                "img:tag@sha256:abc123",
                "docker.io/library/img:tag@sha256:abc123",
            ),
            (
                "docker.io/library/alpine@sha256:abc123",
                "docker.io/library/alpine@sha256:abc123",
            ),
            (
                "docker.io/library/alpine:3.19",
                "docker.io/library/alpine:3.19",
            ),
        ];
        for (raw, expected) in cases {
            let qualified = ContainerdRuntime::qualify_image_ref(raw);
            assert_eq!(qualified, expected, "raw reference: {}", raw);
            assert_eq!(
                ContainerdRuntime::qualify_image_ref(&qualified),
                qualified,
                "qualification must be idempotent"
            );
        }
    }

    #[test]
    fn plain_manifest_uses_its_typed_config_descriptor() {
        let manifest: OciImageDocument = parse_metadata_json(
            br#"{
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {
                    "mediaType": "application/vnd.oci.image.config.v1+json",
                    "digest": "sha256:plain-config",
                    "size": 321
                }
            }"#,
            "test manifest",
        )
        .expect("plain manifest must parse");
        assert!(manifest.manifests.is_none());
        let config = manifest.config.expect("plain config descriptor");
        assert_eq!(config.digest, "sha256:plain-config");
        assert_eq!(config.size, 321);

        let invalid = br#"{"config":{"digest":"sha256:x","size":"not-a-size"}}"#;
        assert!(parse_metadata_json::<OciImageDocument>(invalid, "test manifest").is_err());
    }

    fn platform_index() -> OciImageDocument {
        parse_metadata_json(
            br#"{
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.index.v1+json",
                "manifests": [
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:attestation",
                        "size": 100,
                        "platform": {"architecture": "amd64", "os": "linux"},
                        "annotations": {"vnd.docker.reference.type": "attestation-manifest"}
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:unknown",
                        "size": 101,
                        "platform": {"architecture": "unknown", "os": "unknown"}
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:arm64-v8",
                        "size": 102,
                        "platform": {"architecture": "arm64", "os": "linux", "variant": "v8"}
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:amd64-v1",
                        "size": 103,
                        "platform": {"architecture": "amd64", "os": "linux", "variant": "v1"}
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:amd64-default",
                        "size": 104,
                        "platform": {"architecture": "amd64", "os": "linux"}
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:arm-v6",
                        "size": 105,
                        "platform": {"architecture": "arm", "os": "linux", "variant": "v6"}
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:arm-v7",
                        "size": 106,
                        "platform": {"architecture": "arm", "os": "linux", "variant": "v7"}
                    }
                ]
            }"#,
            "test index",
        )
        .expect("platform index must parse")
    }

    async fn resolve_memory_image(
        target_digest: &str,
        host: HostImagePlatform,
        blobs: HashMap<String, Vec<u8>>,
    ) -> (AgentResult<ImageMetadata>, Vec<String>) {
        let reads = Arc::new(std::sync::Mutex::new(Vec::new()));
        let observed_reads = Arc::clone(&reads);
        let target = OciDescriptor {
            digest: target_digest.to_string(),
            size: 1,
        };
        let result = resolve_image_metadata(target, host, move |descriptor, _kind| {
            observed_reads
                .lock()
                .expect("memory reader lock")
                .push(descriptor.digest.clone());
            let bytes = blobs
                .get(&descriptor.digest)
                .cloned()
                .ok_or_else(|| metadata_error("missing in-memory metadata test blob"));
            async move { bytes }
        })
        .await;
        let reads = reads.lock().expect("memory reader lock").clone();
        (result, reads)
    }

    fn memory_blobs(entries: &[(&str, serde_json::Value)]) -> HashMap<String, Vec<u8>> {
        entries
            .iter()
            .map(|(digest, value)| {
                (
                    (*digest).to_string(),
                    serde_json::to_vec(value).expect("serialize in-memory OCI blob"),
                )
            })
            .collect()
    }

    #[test]
    fn index_selects_amd64_or_arm64_host_never_first_attestation() {
        let index = platform_index();
        let amd64 = host_image_platform_for("x86_64").expect("amd64 host");
        let selected = select_platform_manifest(&index, amd64).expect("amd64 manifest");
        assert_eq!(selected.digest, "sha256:amd64-default");

        let arm64 = host_image_platform_for("aarch64").expect("arm64 host");
        let selected = select_platform_manifest(&index, arm64).expect("arm64 manifest");
        assert_eq!(selected.digest, "sha256:arm64-v8");

        let arm = HostImagePlatform {
            architecture: "arm",
            preferred_variant: Some("v7"),
        };
        let selected = select_platform_manifest(&index, arm).expect("explicit arm v7 fixture");
        assert_eq!(selected.digest, "sha256:arm-v7");
    }

    #[test]
    fn index_with_wrong_host_platform_is_an_error_without_fallback() {
        let index: OciImageDocument = parse_metadata_json(
            br#"{
                "manifests": [
                    {"digest":"sha256:attestation","size":1,
                     "platform":{"architecture":"amd64","os":"linux"},
                     "annotations":{"vnd.docker.reference.type":"attestation-manifest"}},
                    {"digest":"sha256:arm64","size":2,
                     "platform":{"architecture":"arm64","os":"linux","variant":"v8"}},
                    {"digest":"sha256:windows","size":3,
                     "platform":{"architecture":"amd64","os":"windows"}}
                ]
            }"#,
            "test index",
        )
        .expect("valid wrong-host index");
        assert!(select_platform_manifest(
            &index,
            host_image_platform_for("x86_64").expect("amd64 host")
        )
        .is_err());
        assert!(host_image_platform_for("mips64").is_err());
    }

    #[tokio::test]
    async fn direct_and_selected_index_configs_must_match_canonical_host() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        let direct = memory_blobs(&[
            (
                "sha256:direct-manifest",
                serde_json::json!({
                    "config": {"digest":"sha256:direct-config","size":1}
                }),
            ),
            (
                "sha256:direct-config",
                serde_json::json!({
                    "architecture":"arm64","os":"linux","config":null
                }),
            ),
        ]);
        let (result, reads) = resolve_memory_image("sha256:direct-manifest", host, direct).await;
        let error = result
            .expect_err("a direct manifest's config must not bypass platform validation")
            .to_string();
        assert!(error.contains("platform does not match"), "{error}");
        assert_eq!(
            reads,
            s(&["sha256:direct-manifest", "sha256:direct-config"])
        );

        let indexed = memory_blobs(&[
            (
                "sha256:index",
                serde_json::json!({"manifests":[
                    {"digest":"sha256:attestation","size":1,
                     "platform":{"architecture":"amd64","os":"linux"},
                     "annotations":{"vnd.docker.reference.type":"attestation-manifest"}},
                    {"digest":"sha256:selected","size":1,
                     "platform":{"architecture":"amd64","os":"linux"}}
                ]}),
            ),
            (
                "sha256:selected",
                serde_json::json!({
                    "config":{"digest":"sha256:index-config","size":1}
                }),
            ),
            (
                "sha256:index-config",
                serde_json::json!({
                    "architecture":"arm64","os":"linux","config":null
                }),
            ),
        ]);
        let (result, reads) = resolve_memory_image("sha256:index", host, indexed).await;
        let error = result
            .expect_err("selected index descriptor and config platform must agree")
            .to_string();
        assert!(error.contains("platform does not match"), "{error}");
        assert_eq!(
            reads,
            s(&["sha256:index", "sha256:selected", "sha256:index-config"])
        );
    }

    #[test]
    fn image_config_requires_well_typed_host_platform_and_compatible_variant() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        for (json, expected) in [
            (
                &br#"{"os":"linux","config":null}"#[..],
                "required architecture",
            ),
            (
                &br#"{"architecture":"amd64","config":null}"#[..],
                "required os",
            ),
            (
                &br#"{"architecture":"amd64","os":"windows","config":null}"#[..],
                "platform does not match",
            ),
            (
                &br#"{"architecture":"amd64","os":"linux","variant":"v2","config":null}"#[..],
                "platform does not match",
            ),
        ] {
            let error = parse_image_config(json, "sha256:bad-platform".to_string(), host)
                .expect_err("missing or incompatible image config platform must fail")
                .to_string();
            assert!(error.contains(expected), "{error}");
        }
        for wrong_type in [
            &br#"{"architecture":42,"os":"linux","config":null}"#[..],
            &br#"{"architecture":"amd64","os":42,"config":null}"#[..],
            &br#"{"architecture":"amd64","os":"linux","variant":7,"config":null}"#[..],
        ] {
            assert!(
                parse_image_config(wrong_type, "sha256:bad-type".to_string(), host).is_err(),
                "wrong platform field types must remain errors"
            );
        }

        // This validates normalization only, not actual execution on 32-bit ARM.
        let indeterminate_arm = host_image_platform_for("arm")
            .expect_err("ARCH=arm alone cannot prove ARMv7 hardware")
            .to_string();
        assert!(indeterminate_arm.contains("refusing to guess ARMv7"));
        let arm = HostImagePlatform {
            architecture: "arm",
            preferred_variant: Some("v7"),
        };
        parse_image_config(
            br#"{"architecture":"arm","os":"linux","variant":"v7","config":null}"#,
            "sha256:armv7".to_string(),
            arm,
        )
        .expect("explicit ARMv7 matches the canonical target");
        for incompatible in [
            &br#"{"architecture":"arm","os":"linux","config":null}"#[..],
            &br#"{"architecture":"arm","os":"linux","variant":"v6","config":null}"#[..],
        ] {
            assert!(
                parse_image_config(incompatible, "sha256:arm-bad".to_string(), arm).is_err(),
                "std::env::consts must not make an unknown ARM flavour look compatible"
            );
        }
    }

    #[tokio::test]
    async fn two_level_indexes_resolve_host_manifest_and_skip_nested_attestations() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        let blobs = memory_blobs(&[
            (
                "sha256:root-index",
                serde_json::json!({"manifests":[
                    {"digest":"sha256:root-attestation","size":1,
                     "platform":{"architecture":"amd64","os":"linux"},
                     "annotations":{"vnd.docker.reference.type":"attestation-manifest"}},
                    {"digest":"sha256:child-index","size":1,
                     "platform":{"architecture":"amd64","os":"linux"}}
                ]}),
            ),
            (
                "sha256:child-index",
                serde_json::json!({"manifests":[
                    {"digest":"sha256:child-attestation","size":1,
                     "platform":{"architecture":"amd64","os":"linux"},
                     "annotations":{"vnd.docker.reference.type":"attestation-manifest"}},
                    {"digest":"sha256:host-manifest","size":1,
                     "platform":{"architecture":"amd64","os":"linux","variant":"v1"}}
                ]}),
            ),
            (
                "sha256:host-manifest",
                serde_json::json!({
                    "config":{"digest":"sha256:nested-config","size":1}
                }),
            ),
            (
                "sha256:nested-config",
                // An omitted process config remains valid after nested traversal.
                serde_json::json!({"architecture":"amd64","os":"linux"}),
            ),
        ]);
        let (result, reads) = resolve_memory_image("sha256:root-index", host, blobs).await;
        let metadata = result.expect("valid two-level OCI index traversal");
        assert_eq!(metadata.config_digest, "sha256:nested-config");
        assert!(metadata.env.is_empty());
        assert_eq!(metadata.entrypoint, None);
        assert_eq!(
            reads,
            s(&[
                "sha256:root-index",
                "sha256:child-index",
                "sha256:host-manifest",
                "sha256:nested-config",
            ])
        );
    }

    #[tokio::test]
    async fn nested_index_without_host_platform_errors_without_first_fallback() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        let blobs = memory_blobs(&[
            (
                "sha256:root",
                serde_json::json!({"manifests":[
                    {"digest":"sha256:child","size":1,
                     "platform":{"architecture":"amd64","os":"linux"}}
                ]}),
            ),
            (
                "sha256:child",
                serde_json::json!({"manifests":[
                    {"digest":"sha256:attestation","size":1,
                     "platform":{"architecture":"amd64","os":"linux"},
                     "annotations":{"vnd.docker.reference.type":"attestation-manifest"}},
                    {"digest":"sha256:wrong","size":1,
                     "platform":{"architecture":"arm64","os":"linux","variant":"v8"}},
                    {"digest":"sha256:indeterminate","size":1}
                ]}),
            ),
        ]);
        let (result, reads) = resolve_memory_image("sha256:root", host, blobs).await;
        let error = result
            .expect_err("nested index has no runnable host platform")
            .to_string();
        assert!(
            error.contains("no manifest for the Linux host platform"),
            "{error}"
        );
        assert_eq!(reads, s(&["sha256:root", "sha256:child"]));
    }

    #[tokio::test]
    async fn excessive_index_nesting_is_an_explicit_bounded_error() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        let mut blobs = HashMap::new();
        for level in 0..=MAX_IMAGE_INDEX_NESTING {
            let digest = format!("sha256:index-{level}");
            let next = format!("sha256:index-{}", level + 1);
            blobs.insert(
                digest,
                serde_json::to_vec(&serde_json::json!({"manifests":[
                    {"digest":next,"size":1,
                     "platform":{"architecture":"amd64","os":"linux"}}
                ]}))
                .expect("serialize excessive-nesting index"),
            );
        }
        let (result, reads) = resolve_memory_image("sha256:index-0", host, blobs).await;
        let error = result
            .expect_err("fifth index document must exceed the depth bound")
            .to_string();
        assert!(error.contains("maximum depth of 4"), "{error}");
        assert_eq!(reads.len(), MAX_IMAGE_INDEX_NESTING + 1);
        assert_eq!(reads[0], "sha256:index-0");
        assert_eq!(reads[MAX_IMAGE_INDEX_NESTING], "sha256:index-4");
        assert!(!reads.contains(&"sha256:index-5".to_string()));
    }

    #[tokio::test]
    async fn plain_manifest_resolution_reads_target_and_config_once() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        let blobs = memory_blobs(&[
            (
                "sha256:plain-manifest",
                serde_json::json!({
                    "config":{"digest":"sha256:plain-config","size":1}
                }),
            ),
            (
                "sha256:plain-config",
                serde_json::json!({
                    "architecture":"amd64","os":"linux",
                    "config":{"Env":["LANG=C.UTF-8"],"Cmd":["/init"]}
                }),
            ),
        ]);
        let (result, reads) = resolve_memory_image("sha256:plain-manifest", host, blobs).await;
        let metadata = result.expect("plain OCI manifest");
        assert_eq!(metadata.config_digest, "sha256:plain-config");
        assert_eq!(metadata.env, s(&["LANG=C.UTF-8"]));
        assert_eq!(metadata.cmd, Some(s(&["/init"])));
        assert_eq!(
            reads,
            s(&["sha256:plain-manifest", "sha256:plain-config"]),
            "plain manifests must not be walked or cached repeatedly"
        );
    }

    #[test]
    fn typed_image_config_preserves_environment_commands_and_working_dir() {
        let large_value = "large=".to_string() + &"x".repeat(128 * 1024);
        let config = serde_json::to_vec(&serde_json::json!({
            "architecture": "amd64",
            "os": "linux",
            "config": {
                "Env": [
                    "TOKEN=left=middle==right=",
                    "LANG=en_US.UTF-8",
                    "LC_ALL=C.UTF-8",
                    large_value,
                ],
                "Entrypoint": [],
                "Cmd": ["", "/entrypoint.sh", "argument=with=equals"],
                "WorkingDir": "/srv/数据"
            }
        }))
        .expect("serialize config fixture");
        let metadata = parse_image_config(
            &config,
            "sha256:config".to_string(),
            host_image_platform_for("x86_64").expect("amd64 host"),
        )
        .expect("metadata");
        assert_eq!(metadata.config_digest, "sha256:config");
        assert_eq!(metadata.env[0], "TOKEN=left=middle==right=");
        assert_eq!(metadata.env[1], "LANG=en_US.UTF-8");
        assert_eq!(metadata.env[2], "LC_ALL=C.UTF-8");
        assert_eq!(metadata.env[3].len(), 6 + 128 * 1024);
        assert_eq!(metadata.entrypoint, Some(Vec::new()));
        assert_eq!(
            metadata.cmd,
            Some(s(&["", "/entrypoint.sh", "argument=with=equals"]))
        );
        assert_eq!(metadata.working_dir.as_deref(), Some("/srv/数据"));
    }

    #[test]
    fn optional_process_config_null_or_omitted_keeps_docker_semantics() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        let metadata = parse_image_config(
            br#"{
                "architecture": "amd64",
                "os": "linux",
                "config": {
                    "Env": null,
                    "Entrypoint": [],
                    "Cmd": null,
                    "WorkingDir": ""
                }
            }"#,
            "sha256:nulls".to_string(),
            host,
        )
        .expect("null and empty Docker fields are valid");
        assert!(metadata.env.is_empty());
        assert_eq!(metadata.entrypoint, Some(Vec::new()));
        assert_eq!(metadata.cmd, None);
        assert_eq!(metadata.working_dir, None);

        let missing_fields = parse_image_config(
            br#"{"architecture":"amd64","os":"linux","config":{}}"#,
            "sha256:minimal".to_string(),
            host,
        )
        .expect("missing runtime fields are valid");
        assert!(missing_fields.env.is_empty());
        assert_eq!(missing_fields.entrypoint, None);
        assert_eq!(missing_fields.cmd, None);
        assert_eq!(missing_fields.working_dir, None);

        for (json, digest) in [
            (
                &br#"{"architecture":"amd64","os":"linux"}"#[..],
                "sha256:omitted",
            ),
            (
                &br#"{"architecture":"amd64","os":"linux","config":null}"#[..],
                "sha256:null",
            ),
        ] {
            let metadata = parse_image_config(json, digest.to_string(), host)
                .expect("OCI's optional process config may be omitted or null");
            assert_eq!(metadata.config_digest, digest);
            assert!(metadata.env.is_empty());
            assert_eq!(metadata.entrypoint, None);
            assert_eq!(metadata.cmd, None);
            assert_eq!(metadata.working_dir, None);
        }

        for corrupt in [&br#"not-json"#[..], &[0xff][..]] {
            assert!(
                parse_image_config(corrupt, "sha256:bad".to_string(), host).is_err(),
                "corrupt config must not silently become empty metadata"
            );
        }
    }

    #[test]
    fn config_rejects_present_wrong_types_without_leaking_values() {
        let host = host_image_platform_for("x86_64").expect("amd64 host");
        let invalid_configs = [
            br#"{"architecture":"amd64","os":"linux","config":[]}"#[..].to_vec(),
            br#"{"architecture":"amd64","os":"linux","config":{"Env":"PATH=/usr/bin"}}"#[..].to_vec(),
            br#"{"architecture":"amd64","os":"linux","config":{"Env":["must-not-leak-secret",42]}}"#[..].to_vec(),
            br#"{"architecture":"amd64","os":"linux","config":{"Entrypoint":["/init",false]}}"#[..].to_vec(),
            br#"{"architecture":"amd64","os":"linux","config":{"Cmd":{"0":"/bin/sh"}}}"#[..].to_vec(),
            br#"{"architecture":"amd64","os":"linux","config":{"WorkingDir":[]}}"#[..].to_vec(),
        ];
        for bytes in invalid_configs {
            let error = parse_image_config(&bytes, "sha256:bad".to_string(), host)
                .expect_err("invalid present field must be rejected")
                .to_string();
            assert!(error.contains("invalid image config JSON"), "{error}");
            assert!(!error.contains("must-not-leak-secret"), "{error}");
        }

        for working_dir in ["relative/path", " ", "/bad\0path"] {
            let bytes = serde_json::to_vec(&serde_json::json!({
                "architecture": "amd64",
                "os": "linux",
                "config": {"WorkingDir": working_dir}
            }))
            .expect("serialize invalid WorkingDir");
            let error = parse_image_config(&bytes, "sha256:bad".to_string(), host)
                .expect_err("invalid WorkingDir must be rejected")
                .to_string();
            assert!(error.contains("WorkingDir"), "{error}");
            if working_dir != " " {
                assert!(!error.contains(working_dir), "{error}");
            }
        }
        let root = parse_image_config(
            br#"{"architecture":"amd64","os":"linux","config":{"WorkingDir":"/"}}"#,
            "sha256:root".to_string(),
            host,
        )
        .expect("absolute root WorkingDir");
        assert_eq!(root.working_dir.as_deref(), Some("/"));
    }

    #[test]
    fn snapshot_prepare_diagnostics_preserve_phase_and_sanitized_cause() {
        let secret = "untrusted-image-key-parent-label-and-daemon-secret";
        let duplicate = tonic::Status::already_exists(secret);
        assert_eq!(
            snapshot_failure_from_status(&duplicate),
            SnapshotPrepareFailure::AlreadyExists
        );
        let duplicate_failure = snapshot_failure_from_status(&duplicate);
        let duplicate_error = image_parent_fallback_failure(duplicate_failure)
            .expect_err("AlreadyExists must stop image-parent fallback explicitly")
            .to_string();
        assert!(duplicate_error.contains("image-parent attempt"));
        assert!(duplicate_error.contains("AlreadyExists"));
        assert!(!duplicate_error.contains(secret), "{duplicate_error}");
        let duplicate_label =
            snapshot_prepare_diagnostic("label-parent attempt", duplicate_failure);
        assert!(duplicate_label.contains("label-parent attempt"));
        assert!(duplicate_label.contains("gRPC AlreadyExists"));
        assert!(!duplicate_label.contains(secret));

        let unavailable = tonic::Status::unavailable(secret);
        let terminal = format!(
            "{}; {}",
            snapshot_prepare_diagnostic("image-parent attempt", SnapshotPrepareFailure::Timeout),
            snapshot_prepare_diagnostic(
                "label-parent attempt",
                snapshot_failure_from_status(&unavailable),
            )
        );
        assert!(terminal.contains("image-parent attempt timed out after 10000ms"));
        assert!(terminal.contains("label-parent attempt failed with gRPC Unavailable"));
        assert!(!terminal.contains(secret), "{terminal}");
        assert!(terminal.len() < 512, "diagnostics must stay bounded");

        // A timeout is represented directly so this test does not need a fake
        // containerd service or a real ten-second wait. Cover the other common
        // recovery distinction, a stale/missing parent, in the opposite phase.
        let not_found = snapshot_failure_from_status(&tonic::Status::not_found(secret));
        let missing_then_timeout = format!(
            "{}; {}",
            snapshot_prepare_diagnostic("image-parent attempt", not_found),
            snapshot_prepare_diagnostic("label-parent attempt", SnapshotPrepareFailure::Timeout)
        );
        assert!(missing_then_timeout.contains("image-parent attempt failed with gRPC NotFound"));
        assert!(missing_then_timeout.contains("label-parent attempt timed out"));
        assert!(!missing_then_timeout.contains(secret));
    }

    #[test]
    fn metadata_caps_accept_exact_limit_and_reject_plus_one_before_append() {
        let limit = i64::try_from(IMAGE_METADATA_BLOB_LIMIT).expect("limit fits i64");
        assert_eq!(
            validate_metadata_size(limit, "test config", "descriptor").expect("exact limit"),
            IMAGE_METADATA_BLOB_LIMIT
        );
        assert!(validate_metadata_size(limit + 1, "test config", "descriptor").is_err());
        assert!(validate_metadata_size(limit, "test config", "content info").is_ok());
        assert!(validate_metadata_size(limit + 1, "test config", "content info").is_err());
        assert!(validate_metadata_size(-1, "test config", "descriptor").is_err());
        assert_eq!(
            checked_metadata_read_size(IMAGE_METADATA_BLOB_LIMIT).expect("bounded read size"),
            limit + 1
        );
        assert!(checked_metadata_read_size(usize::MAX).is_err());

        let mut bytes = b"1234567".to_vec();
        append_metadata_chunk(&mut bytes, b"89abcdef", 15, "test stream")
            .expect("chunk reaching exact boundary");
        assert_eq!(bytes, b"123456789abcdef");
        let before_too_large = bytes.clone();
        assert!(append_metadata_chunk(&mut bytes, b"!", 15, "test stream").is_err());
        assert_eq!(
            bytes, before_too_large,
            "failed append must not mutate data"
        );
        assert!(append_metadata_chunk(&mut bytes, b"", 14, "test stream").is_err());

        let actual_limit_chunk = vec![b'x'; IMAGE_METADATA_BLOB_LIMIT];
        let mut actual = Vec::new();
        append_metadata_chunk(
            &mut actual,
            &actual_limit_chunk,
            IMAGE_METADATA_BLOB_LIMIT,
            "test config",
        )
        .expect("exact 4 MiB stream");
        assert!(
            append_metadata_chunk(&mut actual, b"y", IMAGE_METADATA_BLOB_LIMIT, "test config")
                .is_err()
        );
        assert_eq!(actual.len(), IMAGE_METADATA_BLOB_LIMIT);
    }

    #[tokio::test]
    async fn hanging_unix_metadata_socket_is_bounded_by_overall_deadline() {
        // This private listener never accepts or writes an HTTP/2 response.
        // It cannot interfere with the host's real containerd socket.
        let directory = tempfile::tempdir().expect("private metadata test directory");
        let socket_path = directory.path().join("hanging-containerd.sock");
        let _listener = tokio::net::UnixListener::bind(&socket_path).expect("private Unix socket");
        let channel = tokio::time::timeout(
            Duration::from_secs(1),
            containerd_client::connect(&socket_path),
        )
        .await
        .expect("Unix connection setup must itself be bounded")
        .expect("connect to private Unix socket");
        let mut runtime = test_runtime();
        runtime.channel = channel;

        let started = Instant::now();
        let error = tokio::time::timeout(
            Duration::from_secs(1),
            runtime.get_image_metadata_with_timeout("alpine:3.19", Duration::from_millis(50)),
        )
        .await
        .expect("outer guard proves the operation cannot hang")
        .expect_err("hanging metadata service must time out")
        .to_string();
        assert!(error.contains("overall 50ms deadline"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(1));

        // The same deliberately nonresponsive local channel controls an image
        // which appears to exist but whose preflight Get never answers. The
        // outer guard detects any escape from ensure_image's own deadline; an
        // internal timeout must return before ctr can be spawned for a pull.
        let started = Instant::now();
        let error = tokio::time::timeout(
            IMAGE_PREFLIGHT_TIMEOUT + Duration::from_millis(500),
            runtime.ensure_image("alpine:3.19"),
        )
        .await
        .expect("ensure_image escaped its bounded preflight")
        .expect_err("hanging preflight Get must time out")
        .to_string();
        assert!(
            error.contains("ensure preflight Images.Get exceeded its 1000ms deadline"),
            "{error}"
        );
        assert!(!error.contains("pull"), "{error}");
        assert!(started.elapsed() < IMAGE_PREFLIGHT_TIMEOUT + Duration::from_millis(500));
    }

    #[test]
    fn io_weight_clamps_to_blkio_range() {
        assert_eq!(clamp_io_weight(500), 500);
        assert_eq!(clamp_io_weight(0), 10);
        assert_eq!(clamp_io_weight(1), 10);
        assert_eq!(clamp_io_weight(1000), 1000);
        assert_eq!(clamp_io_weight(99_999), 1000);
        assert_eq!(clamp_io_weight(u64::MAX), 1000);
    }

    #[test]
    fn installer_namespaces_include_network_and_cgroup() {
        let ns = installer_namespaces();
        let types: Vec<&str> = ns
            .iter()
            .filter_map(|v| v.get("type").and_then(|t| t.as_str()))
            .collect();
        for required in ["pid", "ipc", "uts", "mount", "cgroup", "network"] {
            assert!(types.contains(&required), "missing namespace {}", required);
        }
    }

    #[test]
    fn installer_capabilities_keep_install_essentials_drop_admin() {
        let caps = installer_capabilities();
        // Egg installs need these: apt drops to _apt, scripts fix
        // ownership on the uid-1000-owned data dir.
        for required in [
            "CAP_CHOWN",
            "CAP_FOWNER",
            "CAP_DAC_OVERRIDE",
            "CAP_SETUID",
            "CAP_SETGID",
        ] {
            assert!(caps.contains(&required), "{} must be kept", required);
        }
        // Host-admin primitives must stay dropped.
        for dropped in [
            "CAP_SYS_ADMIN",
            "CAP_NET_ADMIN",
            "CAP_SYS_PTRACE",
            "CAP_SYS_MODULE",
            "CAP_MKNOD",
        ] {
            assert!(!caps.contains(&dropped), "{} must be dropped", dropped);
        }
    }

    // ── Install-container environment ───────────────────────────────────
    //
    // Regression: the installer env used to be built from scratch with a fixed
    // PATH (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`) and
    // the image's own env was dropped. `eclipse-temurin:21-jdk-jammy` — the
    // install image of the Pterodactyl Fabric egg — ships java ONLY at
    // /opt/java/openjdk/bin/java (verified: no /usr/bin/java, /bin/java or
    // /usr/local/bin/java in any image layer), so the Fabric install script's
    // `java -jar fabric-installer.jar …` died with "java: command not found".
    // The script has no `set -e` (Pterodactyl semantics) and ends with
    // `echo -e "Install Complete"`, so the install reported success with no
    // server.jar and the server then crash-looped on start.

    fn env_map_of(pairs: &[&str]) -> HashMap<String, String> {
        let mut map = HashMap::new();
        for pair in pairs {
            match pair.split_once('=') {
                Some((k, v)) => map.insert(k.to_string(), v.to_string()),
                None => panic!("bad env pair {}", pair),
            };
        }
        map
    }

    fn env_list_to_map(entries: Vec<String>) -> HashMap<String, String> {
        entries
            .into_iter()
            .map(|entry| {
                let (key, value) = entry.split_once('=').expect("KEY=VALUE");
                (key.to_string(), value.to_string())
            })
            .collect()
    }

    #[test]
    fn installer_env_keeps_the_image_jdk_on_path() {
        // The eclipse-temurin image config, verbatim.
        let image_env = s(&[
            "PATH=/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "JAVA_HOME=/opt/java/openjdk",
            "LANG=en_US.UTF-8",
            "JAVA_VERSION=jdk-21.0.13+9",
        ]);
        let egg_env = env_map_of(&[
            "MC_VERSION=latest",
            "FABRIC_VERSION=latest",
            "LOADER_VERSION=latest",
            "SERVER_JARFILE=server.jar",
        ]);

        let built: HashMap<String, String> = build_installer_env(&image_env, &egg_env)
            .into_iter()
            .map(|e| {
                let (k, v) = e.split_once('=').expect("KEY=VALUE");
                (k.to_string(), v.to_string())
            })
            .collect();

        // This is the assertion that fails on the old code: `java` was not on
        // PATH at all, because the image PATH was discarded.
        let path = built.get("PATH").expect("PATH must be set");
        assert!(
            path.split(':').any(|seg| seg == JAVA_BIN_DIR),
            "install PATH must resolve java, got {}",
            path
        );
        assert_eq!(
            built.get("JAVA_HOME").map(String::as_str),
            Some("/opt/java/openjdk")
        );
        // Image env survives (locale warnings, mysql/apt tooling, …).
        assert_eq!(built.get("LANG").map(String::as_str), Some("en_US.UTF-8"));
        // Egg variables are exported to the install script.
        assert_eq!(
            built.get("FABRIC_VERSION").map(String::as_str),
            Some("latest")
        );
        assert_eq!(
            built.get("SERVER_JARFILE").map(String::as_str),
            Some("server.jar")
        );
        assert_eq!(built.get("TERM").map(String::as_str), Some("xterm"));
    }

    #[test]
    fn installer_env_prefers_egg_values_but_still_resolves_java() {
        // An egg may legitimately set PATH. Panel values supplied through
        // Docker's Config.Env collide with and replace the image value; the
        // Temurin directory is then appended only as a non-shadowing fallback.
        let image_env = s(&["PATH=/usr/bin:/bin"]);
        let egg_env = env_map_of(&["PATH=/data/bin:/usr/bin:/bin", "RCON_PASSWORD=x"]);

        let built: HashMap<String, String> = build_installer_env(&image_env, &egg_env)
            .into_iter()
            .map(|e| {
                let (k, v) = e.split_once('=').expect("KEY=VALUE");
                (k.to_string(), v.to_string())
            })
            .collect();

        let path = built.get("PATH").expect("PATH must be set");
        assert_eq!(path, "/data/bin:/usr/bin:/bin:/opt/java/openjdk/bin");
        assert_eq!(built.get("RCON_PASSWORD").map(String::as_str), Some("x"));
    }

    #[test]
    fn installer_env_without_image_env_still_has_a_sane_path() {
        let built: HashMap<String, String> = build_installer_env(&[], &env_map_of(&["A=1"]))
            .into_iter()
            .map(|e| {
                let (k, v) = e.split_once('=').expect("KEY=VALUE");
                (k.to_string(), v.to_string())
            })
            .collect();
        assert_eq!(built.get("PATH").map(String::as_str), Some(DEFAULT_PATH));
        assert_eq!(built.get("A").map(String::as_str), Some("1"));
    }

    #[test]
    fn ensure_java_on_path_is_idempotent() {
        let mut env = env_map_of(&["PATH=/opt/java/openjdk/bin:/usr/bin:/bin"]);
        ensure_java_on_path(&mut env);
        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some("/opt/java/openjdk/bin:/usr/bin:/bin"),
            "an existing java entry must not be duplicated"
        );
        // Reapplying the policy changes nothing after the fallback is present.
        let before = env.clone();
        ensure_java_on_path(&mut env);
        assert_eq!(env, before);

        // A substring match is not enough — only a whole PATH segment counts,
        // and the independent expected literal below guards the actual JDK path.
        let mut tricked = env_map_of(&["PATH=/usr/bin:/opt/java/openjdk/binaries"]);
        ensure_java_on_path(&mut tricked);
        assert_eq!(
            tricked.get("PATH").map(String::as_str),
            Some("/usr/bin:/opt/java/openjdk/binaries:/opt/java/openjdk/bin")
        );
        let with_fallback = tricked.clone();
        ensure_java_on_path(&mut tricked);
        assert_eq!(tricked, with_fallback);
    }

    #[test]
    fn nonblank_path_keeps_every_byte_and_explicit_jdk_priority() {
        let original = " /opt/eclipse-adoptium/bin::/usr/bin:\t";
        let mut env = env_map_of(&[]);
        env.insert("PATH".to_string(), original.to_string());
        ensure_java_on_path(&mut env);
        assert_eq!(
            env.get("PATH").map(String::as_str),
            Some(" /opt/eclipse-adoptium/bin::/usr/bin:\t:/opt/java/openjdk/bin"),
            "no existing byte may be trimmed or reordered"
        );
        assert!(env["PATH"].starts_with(original));
    }

    #[test]
    fn missing_empty_and_whitespace_path_receive_secure_default() {
        let cases: Vec<Option<&str>> = vec![None, Some(""), Some(" \t ")];
        for supplied in cases {
            let mut env = HashMap::new();
            if let Some(value) = supplied {
                env.insert("PATH".to_string(), value.to_string());
            }
            ensure_java_on_path(&mut env);
            assert_eq!(
                env.get("PATH").map(String::as_str),
                Some(
                    "/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
                ),
                "blank PATH must not become current-directory lookup: {:?}",
                supplied
            );
        }
    }

    #[test]
    fn exact_existing_path_segment_survives_without_mutation() {
        let original = " /custom/bin :/usr/bin:/opt/java/openjdk/bin:\t/other/bin\t";
        let mut env = env_map_of(&[]);
        env.insert("PATH".to_string(), original.to_string());
        ensure_java_on_path(&mut env);
        assert_eq!(env.get("PATH").map(String::as_str), Some(original));
        ensure_java_on_path(&mut env);
        assert_eq!(env.get("PATH").map(String::as_str), Some(original));
    }

    #[test]
    fn term_defaults_only_when_absent_and_preserves_explicit_empty() {
        let absent = env_list_to_map(build_installer_env(&[], &HashMap::new()));
        assert_eq!(absent.get("TERM").map(String::as_str), Some("xterm"));

        let image = env_list_to_map(build_installer_env(&s(&["TERM=dumb"]), &HashMap::new()));
        assert_eq!(image.get("TERM").map(String::as_str), Some("dumb"));

        let panel = env_list_to_map(build_installer_env(
            &s(&["TERM=dumb"]),
            &env_map_of(&["TERM=screen-256color"]),
        ));
        assert_eq!(
            panel.get("TERM").map(String::as_str),
            Some("screen-256color")
        );

        let empty = env_list_to_map(build_installer_env(
            &s(&["TERM=vt100"]),
            &env_map_of(&["TERM="]),
        ));
        assert_eq!(empty.get("TERM").map(String::as_str), Some(""));
    }

    #[test]
    fn non_path_collisions_use_panel_values_without_dropping_image_keys() {
        let built = env_list_to_map(build_installer_env(
            &s(&["COLLIDES=image", "IMAGE_ONLY=retained"]),
            &env_map_of(&["COLLIDES=panel", "PANEL_ONLY=retained"]),
        ));
        assert_eq!(built.get("COLLIDES").map(String::as_str), Some("panel"));
        assert_eq!(
            built.get("IMAGE_ONLY").map(String::as_str),
            Some("retained")
        );
        assert_eq!(
            built.get("PANEL_ONLY").map(String::as_str),
            Some("retained")
        );
    }

    #[test]
    fn shell_startup_controls_are_removed_but_configuration_survives() {
        let built = env_list_to_map(build_installer_env(
            &s(&[
                "BASH_ENV=/image/startup.sh",
                "SHELLOPTS=xtrace:verbose",
                "LANG=C.UTF-8",
                "HTTPS_PROXY=http://proxy.example:8443",
            ]),
            &env_map_of(&[
                "ENV=/panel/startup.sh",
                "BASHOPTS=extdebug",
                "POSIXLY_CORRECT=1",
                "LC_ALL=en_US.UTF-8",
                "HTTP_PROXY=http://proxy.example:8080",
                "NO_PROXY=localhost,127.0.0.1",
                "BASH_ENV_SAFE=not-a-shell-control",
                "env=case-sensitive-and-unrelated",
            ]),
        ));
        for control in SHELL_STARTUP_CONTROL_VARS {
            assert!(!built.contains_key(*control), "unexpected {}", control);
        }
        for (key, value) in [
            ("LANG", "C.UTF-8"),
            ("LC_ALL", "en_US.UTF-8"),
            ("HTTPS_PROXY", "http://proxy.example:8443"),
            ("HTTP_PROXY", "http://proxy.example:8080"),
            ("NO_PROXY", "localhost,127.0.0.1"),
            ("BASH_ENV_SAFE", "not-a-shell-control"),
            ("env", "case-sensitive-and-unrelated"),
        ] {
            assert_eq!(built.get(key).map(String::as_str), Some(value));
        }
    }

    #[test]
    fn inherited_command_env_gets_targeted_shell_control_removals() {
        use std::ffi::OsStr;

        let mut command = Command::new("sh");
        for key in SHELL_STARTUP_CONTROL_VARS {
            command.env(key, "unsafe-test-value");
        }
        command
            .env("LANG", "C.UTF-8")
            .env("HTTPS_PROXY", "http://proxy.example:8443")
            .env("BASH_ENV_SAFE", "retain");
        sanitize_shell_startup_command(&mut command);

        let entries: HashMap<&OsStr, Option<&OsStr>> = command.as_std().get_envs().collect();
        for key in SHELL_STARTUP_CONTROL_VARS {
            assert_eq!(entries.get(OsStr::new(key)).copied(), Some(None));
        }
        assert_eq!(
            entries.get(OsStr::new("LANG")).copied(),
            Some(Some(OsStr::new("C.UTF-8")))
        );
        assert_eq!(
            entries.get(OsStr::new("HTTPS_PROXY")).copied(),
            Some(Some(OsStr::new("http://proxy.example:8443")))
        );
        assert_eq!(
            entries.get(OsStr::new("BASH_ENV_SAFE")).copied(),
            Some(Some(OsStr::new("retain")))
        );
    }

    #[test]
    fn image_metadata_absence_does_not_secretly_rewrite_path_in_args() {
        let args = build_process_args("/custom/jdk/bin/java -jar server.jar", None, None);
        assert_eq!(&args[..2], &["/bin/sh", "-c"]);
        assert!(!args[2].contains("export PATH"));
        assert!(args[2].contains("/custom/jdk/bin/java -jar server.jar"));
    }

    #[test]
    fn missing_installentrypoint_uses_legacy_interpreter_choice() {
        for (image, script, expected) in [
            ("debian:bookworm", "#!/bin/bash\ntrue", "bash"),
            ("alpine:3.19", "#!/bin/bash\ntrue", "sh"),
            ("debian:bookworm", "#!/bin/ash\ntrue", "bash"),
            ("debian:bookworm", "true", "bash"),
        ] {
            let (interpreter, argument) = detect_install_interpreter(image, script);
            assert_eq!((interpreter, argument), (expected, "-c"));
        }
    }

    #[tokio::test]
    async fn runtime_env_appends_java_fallback_without_shared_tmp_files() {
        // build_oci_spec and the installer share the environment policy. Use a
        // private io_dir: build_oci_spec writes hosts/resolv.conf/machine-id.
        let dir = tempfile::tempdir().expect("private runtime test directory");
        let env = env_map_of(&["PATH=/usr/bin:/bin", "TERM=screen-256color"]);
        let bindings = HashMap::new();
        let config = test_container_config(&env, &bindings);
        let spec = test_runtime()
            .build_oci_spec(&config, dir.path(), true, &[], None, None)
            .expect("spec");
        let env_list = spec["process"]["env"]
            .as_array()
            .expect("env array")
            .iter()
            .map(|v| v.as_str().unwrap_or(""))
            .collect::<Vec<_>>();
        assert!(
            env_list.contains(&"PATH=/usr/bin:/bin:/opt/java/openjdk/bin"),
            "runtime PATH must retain an explicit JDK before the fallback: {:?}",
            env_list
        );
        assert!(env_list.contains(&"TERM=screen-256color"));
        for generated_file in ["hosts", "resolv.conf", "machine-id"] {
            assert!(dir.path().join(generated_file).is_file());
        }
    }

    fn test_runtime() -> ContainerdRuntime {
        ContainerdRuntime {
            namespace: "catalyst".to_string(),
            channel: tonic::transport::Channel::from_static("http://[::1]:1").connect_lazy(),
            container_io: Arc::new(Mutex::new(HashMap::new())),
            dns_servers: vec!["1.1.1.1".to_string()],
            cpu_tracker: Arc::new(CpuTracker::new()),
            cgroup_paths: Arc::new(RwLock::new(HashMap::new())),
            container_list_cache: Arc::new(RwLock::new((Vec::new(), Instant::now()))),
            console_log_dir: PathBuf::from("/tmp"),
            cni_results_dir: PathBuf::from("/tmp"),
            cni_data_dir: PathBuf::from("/tmp"),
            cni_dir: PathBuf::from("/tmp"),
            cni_bin_dir: PathBuf::from("/tmp"),
            cni_bridge_name: "catalyst0".to_string(),
            cni_bridge_subnet: "10.42.0.0/16".to_string(),
            allow_host_network: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            error_sink: Arc::new(std::sync::RwLock::new(None)),
        }
    }

    fn test_container_config<'a>(
        env: &'a HashMap<String, String>,
        bindings: &'a HashMap<u16, u16>,
    ) -> ContainerConfig<'a> {
        ContainerConfig {
            container_id: "srv-test",
            server_id: "srv-test",
            image: "alpine:3.19",
            startup_command: "sleep infinity",
            env,
            memory_mb: 1024,
            memory_reservation_mb: 0,
            swap_mb: 0,
            cpu_cores: 2,
            io_weight: 500,
            data_dir: "/tmp",
            port: 25565,
            port_bindings: bindings,
            network_mode: None,
            network_ip: None,
        }
    }

    #[tokio::test]
    async fn oci_spec_always_emits_pids_limit_and_runs_as_1000() {
        let runtime = test_runtime();
        let dir = tempfile::tempdir().unwrap();
        let env = HashMap::new();
        let bindings = HashMap::new();
        let spec = runtime
            .build_oci_spec(
                &test_container_config(&env, &bindings),
                dir.path(),
                false,
                &[],
                None,
                None,
            )
            .unwrap();
        assert_eq!(
            spec.pointer("/linux/resources/pids/limit"),
            Some(&serde_json::json!(2048))
        );
        assert_eq!(
            spec.pointer("/process/user/uid"),
            Some(&serde_json::json!(1000))
        );
        assert_eq!(
            spec.pointer("/process/user/gid"),
            Some(&serde_json::json!(1000))
        );
        let ns: Vec<&str> = spec["linux"]["namespaces"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.get("type").and_then(|t| t.as_str()))
            .collect();
        assert!(ns.contains(&"network"));
        assert!(ns.contains(&"cgroup"));
    }

    #[tokio::test]
    async fn oci_spec_clamps_io_weight_from_panel() {
        let runtime = test_runtime();
        let dir = tempfile::tempdir().unwrap();
        let env = HashMap::new();
        let bindings = HashMap::new();
        let mut cfg = test_container_config(&env, &bindings);
        cfg.io_weight = 99_999;
        let spec = runtime
            .build_oci_spec(&cfg, dir.path(), false, &[], None, None)
            .unwrap();
        assert_eq!(
            spec.pointer("/linux/resources/blockIO/weight"),
            Some(&serde_json::json!(1000u64))
        );
    }
}
