//! Shared shell/string utility functions used across multiple modules.
//!
//! Consolidates shell escaping, startup command normalization, path validation,
//! and terminal line splitting that were previously duplicated between
//! `websocket_handler.rs` and `runtime_manager.rs`.

use crate::{AgentError, AgentResult};
use regex::Regex;
use std::path::{Component, Path};
use std::sync::LazyLock;
pub fn shell_escape_value(value: &str) -> String {
    // Single-quoting in bash prevents all interpretation except for single quotes themselves.
    // To include a literal single quote: end the single-quoted string, add an escaped quote, restart.
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

/// Detect whether a startup command requires bash rather than plain /bin/sh.
/// Returns true when the command uses bash-specific features that dash/sh cannot handle.
pub fn requires_bash(command: &str) -> bool {
    // Process substitution: $( <(...) )
    if command.contains("<(") || command.contains(">(") {
        return true;
    }
    // [[ double-bracket test ]]
    if command.contains("[[") {
        return true;
    }
    // Array syntax: var=( ... ) or ${arr[@]}
    static ARRAY_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\w+=\(|\$\{\w+\[@]\}").expect("valid array regex"));
    if ARRAY_RE.is_match(command) {
        return true;
    }
    false
}

/// Normalize common bash arithmetic condition syntax so startup commands run under /bin/sh.
/// Example: `((1))` -> `[ $((1)) -ne 0 ]`
pub fn normalize_startup_for_sh(command: &str) -> String {
    static ARITH_COND_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\(\(\s*([^()]*)\s*\)\)").expect("valid arithmetic condition regex")
    });
    ARITH_COND_RE
        .replace_all(command, |caps: &regex::Captures<'_>| {
            let expr = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if expr.is_empty() {
                "[ 0 -ne 0 ]".to_string()
            } else {
                format!("[ $(( {} )) -ne 0 ]", expr)
            }
        })
        .into_owned()
}

/// Cap for `-XX:MaxRAMPercentage` when rewriting visible startup / injecting options.
pub const JAVA_MAX_RAM_PERCENTAGE: f64 = 70.0;
/// Paper/Wings default when the operator did not set `-Xms` / `MEMORY_XMS`.
pub const JAVA_DEFAULT_XMS_MB: u64 = 128;

/// JVM RSS is heap + metaspace + direct buffers + code cache + thread stacks + native.
/// A 2GB *allocation* is the heap the operator bought. The cgroup must be larger
/// so off-heap does not steal that 2GB (or OOM at 1.5G-in-2G).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JavaMemoryPlan {
    pub heap_mb: u64,
    pub xms_mb: u64,
    pub direct_mb: u64,
    pub metaspace_mb: u64,
    /// cgroup memory.max, >= allocation, heap + off-heap overhead.
    pub cgroup_mb: u64,
}

impl JavaMemoryPlan {
    pub fn java_options(&self) -> String {
        format!(
            "-Xms{xms}M -Xmx{heap}M -XX:+UseContainerSupport -XX:MaxRAMPercentage={pct:.1} -XX:MaxDirectMemorySize={direct}M -XX:MaxMetaspaceSize={meta}M -XX:+ExitOnOutOfMemoryError",
            xms = self.xms_mb,
            heap = self.heap_mb,
            pct = JAVA_MAX_RAM_PERCENTAGE,
            direct = self.direct_mb,
            meta = self.metaspace_mb,
        )
    }
}

/// Extra cgroup bytes needed on top of `-Xmx` for a JVM game server.
pub fn java_cgroup_overhead_mb(heap_mb: u64) -> u64 {
    if heap_mb < 256 {
        return 64;
    }
    (heap_mb * 30 / 100).clamp(640, 1024)
}

/// True when startup/image looks like a HotSpot/OpenJDK process.
pub fn looks_like_java(startup: &str, image: &str) -> bool {
    let s = startup.to_ascii_lowercase();
    let i = image.to_ascii_lowercase();
    s.contains("java")
        || s.contains(".jar")
        || i.contains("temurin")
        || i.contains("openjdk")
        || i.contains("graal")
        || i.contains("zulu")
        || i.contains("adoptium")
        || i.contains("liberica")
        || i.contains("semeru")
        || i.contains("hotspot")
        || i.contains("java")
        || i.contains("jdk")
        || i.contains("jre")
}

/// Plan JVM heap (the advertised allocation) and a larger cgroup for off-heap.
///
/// `requested_heap_mb` is an operator `-Xmx` after substitution. It is a
/// ceiling only — never forced *up*, and never above the allocation.
pub fn plan_java_memory(
    allocated_mb: u64,
    requested_heap_mb: Option<u64>,
    requested_xms_mb: Option<u64>,
) -> JavaMemoryPlan {
    let floor = 128u64.min(allocated_mb).max(1);
    let heap = requested_heap_mb
        .filter(|v| *v > 0)
        .unwrap_or(allocated_mb)
        .min(allocated_mb)
        .max(floor);

    let overhead = java_cgroup_overhead_mb(heap);
    let cgroup = allocated_mb.max(heap.saturating_add(overhead));
    let leftover = cgroup.saturating_sub(heap);
    let direct = 128u64.min(leftover / 2).max(32u64.min(leftover));
    let metaspace = (leftover / 3)
        .clamp(32, 384)
        .min(leftover.saturating_sub(direct));

    let default_xms = JAVA_DEFAULT_XMS_MB.min(heap).max(1);
    let xms = requested_xms_mb
        .filter(|v| *v > 0)
        .unwrap_or(default_xms)
        .min(heap)
        .max(1);

    JavaMemoryPlan {
        heap_mb: heap,
        xms_mb: xms,
        direct_mb: direct,
        metaspace_mb: metaspace,
        cgroup_mb: cgroup,
    }
}

/// Parse the last `-Xmx` in a startup string into mebibytes.
pub fn parse_xmx_mb(command: &str) -> Option<u64> {
    parse_xm_flag(command, 'x')
}

/// Parse the last `-Xms` in a startup string into mebibytes.
/// Only matches numeric literals (`-Xms128M`), not `{{MEMORY}}` placeholders.
pub fn parse_xms_mb(command: &str) -> Option<u64> {
    parse_xm_flag(command, 's')
}

fn parse_xm_flag(command: &str, which: char) -> Option<u64> {
    static XMX_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)-Xmx\s*(\d+(?:\.\d+)?)([kmg]?)").expect("valid xmx regex")
    });
    static XMS_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)-Xms\s*(\d+(?:\.\d+)?)([kmg]?)").expect("valid xms regex")
    });
    let re = if which == 's' { &*XMS_RE } else { &*XMX_RE };
    let mut last = None;
    for caps in re.captures_iter(command) {
        let Some(n) = caps.get(1).and_then(|m| m.as_str().parse::<f64>().ok()) else {
            continue;
        };
        let unit = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        if let Some(mb) = jvm_size_to_mb(n, unit) {
            last = Some(mb);
        }
    }
    last
}

fn jvm_size_to_mb(n: f64, unit: &str) -> Option<u64> {
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let bytes = match unit.to_ascii_lowercase().as_str() {
        "" => n, // HotSpot: no suffix = bytes
        "k" => n * 1024.0,
        "m" => n * 1024.0 * 1024.0,
        "g" => n * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((bytes / (1024.0 * 1024.0)).floor() as u64)
}

/// Strip/neutralize explicit `-Xmx`/`-Xms`/`MaxRAMPercentage` literals from
/// startup strings so CLI flags cannot fight `_JAVA_OPTIONS`. Enforcement is
/// the env var (overrides argfiles); this keeps the visible command honest.
pub fn normalize_java_heap_args(command: &str) -> String {
    static HEAP_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)\s+-Xm[sx]\s*\d+(?:\.\d+)?[mMgGkK]?\b").expect("valid heap regex")
    });
    let mut out = HEAP_RE.replace_all(command, " ").into_owned();
    static PERCENT_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)-XX:MaxRAMPercentage=\s*\d+(\.\d+)?").expect("valid pct regex")
    });
    out = PERCENT_RE
        .replace_all(&out, |caps: &regex::Captures<'_>| {
            let raw = caps.get(0).unwrap().as_str();
            let val = raw
                .split('=')
                .nth(1)
                .and_then(|s| s.trim().parse::<f64>().ok())
                .unwrap_or(0.0);
            if val > JAVA_MAX_RAM_PERCENTAGE {
                format!("-XX:MaxRAMPercentage={:.1}", JAVA_MAX_RAM_PERCENTAGE)
            } else {
                raw.to_string()
            }
        })
        .into_owned();
    static WS_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\s{2,}").expect("valid ws regex"));
    WS_RE.replace_all(out.trim(), " ").into_owned()
}

/// Split terminal output into complete lines and a trailing partial fragment.
///
/// Handles three line-termination styles:
/// - `\n`         → normal newline
/// - `\r\n`       → Windows-style newline
/// - `\r`         → carriage return (Paper/Minecraft overwrites current line)
///
/// For `\r` we emulate terminal behaviour: everything since the previous
/// terminator (or start of slice) up to the `\r` is one line, and the next
/// line starts fresh after it.  This prevents Paper's startup progress lines
/// from being concatenated together.
///
/// Returns `(Vec<line_text>, trailing_fragment)`.
/// `trailing_fragment` is the text after the *last* terminator; the caller
/// should keep it for the next read cycle so partial lines are not split.
pub fn split_terminal_lines(text: &str) -> (Vec<String>, &str) {
    let mut lines = Vec::new();
    let mut current_start = 0;

    for (i, ch) in text.char_indices() {
        // If we already advanced current_start past this character (e.g. after
        // a \r\n pair where \r set current_start = i + 2), skip it.
        if i < current_start {
            continue;
        }
        if ch == '\n' {
            let line = &text[current_start..i];
            lines.push(line.to_string());
            current_start = i + 1;
        } else if ch == '\r' {
            let line = &text[current_start..i];
            lines.push(line.to_string());
            // Also skip a following \n if present (\r\n)
            if text.as_bytes().get(i + 1) == Some(&b'\n') {
                current_start = i + 2;
            } else {
                current_start = i + 1;
            }
        }
    }

    let trailing = &text[current_start..];
    (lines, trailing)
}

/// Validate that a string is a single safe path segment (no directory traversal).
pub fn validate_safe_path_segment(value: &str, label: &str) -> AgentResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(AgentError::InvalidRequest(format!(
            "Invalid {}: must be 1-128 characters",
            label
        )));
    }
    if trimmed.contains('\\') {
        return Err(AgentError::InvalidRequest(format!(
            "Invalid {}: contains \\",
            label
        )));
    }
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(AgentError::InvalidRequest(format!(
            "Invalid {}: must be a single path segment",
            label
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_escape_value() {
        assert_eq!(shell_escape_value("hello"), "'hello'");
        assert_eq!(shell_escape_value("it's"), "'it'\"'\"'s'");
        assert_eq!(shell_escape_value(""), "''");
    }

    #[test]
    fn test_requires_bash() {
        assert!(requires_bash("[[ -f foo ]]"));
        assert!(requires_bash("diff <(sort a) <(sort b)"));
        assert!(requires_bash("arr=(1 2 3)"));
        assert!(requires_bash("echo ${arr[@]}"));
        assert!(!requires_bash("echo hello"));
        assert!(!requires_bash("if [ -f foo ]; then echo yes; fi"));
    }

    #[test]
    fn test_normalize_startup_for_sh() {
        assert_eq!(normalize_startup_for_sh("((1))"), "[ $(( 1 )) -ne 0 ]");
        assert_eq!(
            normalize_startup_for_sh("if ((1)); then echo yes; fi"),
            "if [ $(( 1 )) -ne 0 ]; then echo yes; fi"
        );
        // No arithmetic condition → unchanged
        assert_eq!(normalize_startup_for_sh("echo hello"), "echo hello");
    }

    #[test]
    fn test_normalize_java_heap_args() {
        assert_eq!(
            normalize_java_heap_args("java -Xms1G -Xmx2G -jar server.jar --nogui"),
            "java -jar server.jar --nogui"
        );
        assert_eq!(
            normalize_java_heap_args(
                "java -Xms512M -Xmx1024M -XX:MaxRAMPercentage=95.0 -jar foo.jar"
            ),
            "java -XX:MaxRAMPercentage=70.0 -jar foo.jar"
        );
        assert_eq!(
            normalize_java_heap_args("java -XX:MaxRAMPercentage=60.0 -jar foo.jar"),
            "java -XX:MaxRAMPercentage=60.0 -jar foo.jar"
        );
        assert_eq!(
            normalize_java_heap_args("java -Xmx1.5G -jar server.jar"),
            "java -jar server.jar"
        );
        assert_eq!(
            normalize_java_heap_args("java -jar server.jar --nogui"),
            "java -jar server.jar --nogui"
        );
    }

    #[test]
    fn parse_xmx_units() {
        assert_eq!(parse_xmx_mb("java -Xmx2048M -jar server.jar"), Some(2048));
        assert_eq!(parse_xmx_mb("java -Xmx2G -jar server.jar"), Some(2048));
        assert_eq!(parse_xmx_mb("java -Xmx1.5G -jar server.jar"), Some(1536));
        assert_eq!(parse_xmx_mb("java -Xms512M -Xmx1024M -jar x"), Some(1024));
        assert_eq!(parse_xmx_mb("java -jar server.jar"), None);
        assert_eq!(parse_xms_mb("java -Xms128M -Xmx2G -jar x"), Some(128));
        assert_eq!(parse_xms_mb("java -Xms{{MEMORY}}M -jar x"), None);
    }

    #[test]
    fn plan_2g_allocation_gives_2g_heap() {
        let plan = plan_java_memory(2048, None, None);
        assert_eq!(plan.heap_mb, 2048);
        assert_eq!(plan.xms_mb, 128);
        assert_eq!(plan.cgroup_mb, 2048 + 640);
        assert_eq!(plan.direct_mb, 128);
        assert!(plan.heap_mb + plan.direct_mb + plan.metaspace_mb <= plan.cgroup_mb);
        assert!(plan.java_options().contains("-Xmx2048M"));
        assert!(plan.java_options().contains("-Xms128M"));
        assert!(plan.java_options().contains("MaxDirectMemorySize=128M"));
    }

    #[test]
    fn plan_honors_lower_explicit_xmx() {
        let plan = plan_java_memory(2048, Some(1536), None);
        assert_eq!(plan.heap_mb, 1536);
        assert_eq!(plan.xms_mb, 128);
        assert_eq!(plan.direct_mb, 128);
        assert!(plan.cgroup_mb >= 1536 + 640);
        assert!(plan.heap_mb + plan.direct_mb + plan.metaspace_mb <= plan.cgroup_mb);
    }

    #[test]
    fn plan_does_not_force_heap_up() {
        let plan = plan_java_memory(2048, Some(1024), Some(512));
        assert_eq!(plan.heap_mb, 1024);
        assert_eq!(plan.xms_mb, 512);
        assert_eq!(plan.direct_mb, 128);
        assert_eq!(plan.cgroup_mb, 2048);
    }

    #[test]
    fn plan_cgroup_always_exceeds_heap() {
        for allocated in [512u64, 1024, 1536, 2048, 4096, 8192] {
            let plan = plan_java_memory(allocated, Some(allocated), None);
            assert_eq!(plan.heap_mb, allocated);
            assert!(
                plan.cgroup_mb > plan.heap_mb,
                "{plan:?} cgroup must exceed heap"
            );
            assert!(
                plan.heap_mb + plan.direct_mb + plan.metaspace_mb <= plan.cgroup_mb,
                "{plan:?} off-heap does not fit cgroup"
            );
        }
    }

    #[test]
    fn looks_like_java_detects_minecraft_and_not_cs2() {
        assert!(looks_like_java(
            "java -Xmx{{MEMORY}}M -jar server.jar",
            "eclipse-temurin:21-jre"
        ));
        assert!(looks_like_java(
            "./run.sh",
            "ghcr.io/pterodactyl/yolks:java_21"
        ));
        assert!(!looks_like_java(
            "./srcds_run -game csgo",
            "cm2network/csgo"
        ));
    }

    #[test]
    fn test_split_terminal_lines() {
        let (lines, trailing) = split_terminal_lines("hello\nworld\n");
        assert_eq!(lines, vec!["hello", "world"]);
        assert_eq!(trailing, "");

        let (lines, trailing) = split_terminal_lines("partial");
        assert!(lines.is_empty());
        assert_eq!(trailing, "partial");

        let (lines, trailing) = split_terminal_lines("line1\r\nline2\r");
        assert_eq!(lines, vec!["line1", "line2"]);
        assert_eq!(trailing, "");
    }

    #[test]
    fn test_validate_safe_path_segment() {
        assert!(validate_safe_path_segment("my-server", "serverId").is_ok());
        assert!(validate_safe_path_segment("../etc", "serverId").is_err());
        assert!(validate_safe_path_segment("foo/bar", "serverId").is_err());
        assert!(validate_safe_path_segment("", "serverId").is_err());
        assert!(validate_safe_path_segment("a\\b", "serverId").is_err());
    }
}
