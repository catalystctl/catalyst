//! Fedora 44 / systemd `RestrictSUIDSGID` compatibility migration.
//!
//! systemd implements `RestrictSUIDSGID=yes` with a seccomp rule that denies
//! `openat2(2)` outright -- classic seccomp cannot inspect the mode inside
//! `struct open_how` -- and that denial returns `ENOSYS`. Fedora 44's GNU tar
//! backports gnulib's `openat2` support, so every `tar` the agent shells out to
//! (backup restore, archive decompress) aborts with "Function not implemented"
//! and restores never complete.
//!
//! <https://github.com/systemd/systemd/issues/43314> was closed upstream as
//! "fix in GNU tar", so there is no systemd release to wait for.
//!
//! Fresh installs get `RestrictSUIDSGID=no` from `deploy-agent.sh`. A node that
//! updates only the agent binary keeps its old unit, and systemd drop-ins win
//! over the main unit, so this module repairs the on-disk configuration at
//! startup. `ProtectSystem=full` makes `/etc` read-only for the agent itself, so
//! the drop-in is installed through PID 1's mount namespace.

use std::path::{Path, PathBuf};

use tracing::{info, warn};

use crate::command_utils;
use crate::{AgentError, AgentResult};

/// systemd unit that runs the agent.
pub const UNIT_NAME: &str = "catalyst-agent.service";

/// Directory holding the unit's drop-ins.
pub const DROPIN_DIR: &str = "/etc/systemd/system/catalyst-agent.service.d";

/// Drop-in written by this migration. The `zz-` prefix makes it sort last, so
/// it wins over every other drop-in: systemd applies drop-ins in filename order
/// and the last assignment of a directive wins.
pub const COMPAT_DROPIN_NAME: &str = "zz-catalyst-openat2-compat.conf";

/// Body of the drop-in that neutralizes a stale `RestrictSUIDSGID=yes`.
pub const COMPAT_DROPIN_BODY: &str = r#"# Written by catalyst-agent. systemd's RestrictSUIDSGID denies openat2(2) with
# ENOSYS, and Fedora 44's GNU tar needs openat2, so backup restores fail with
# "Function not implemented" (systemd/systemd#43314). The zz- prefix keeps this
# drop-in last so it wins over older overrides.
[Service]
RestrictSUIDSGID=no
"#;

/// Staging path for the drop-in. `/run` is shared with PID 1, unlike `/tmp`
/// (which `PrivateTmp=true` makes private), so `nsenter` can see the file.
const STAGING_FILE: &str = "/run/catalyst-openat2-compat.conf.staged";

/// One-shot guard so a node whose drop-in does not take effect is not restarted
/// in a loop. `/run` is tmpfs, so this clears on reboot.
const RESTART_MARKER: &str = "/run/catalyst-openat2-compat-restart.done";

/// Result of [`ensure_openat2_compat`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompatOutcome {
    /// A compat drop-in was written (or refreshed) and systemd reloaded.
    pub applied: bool,
    /// `openat2(2)` is still blocked for *this* process.
    pub blocked: bool,
}

/// `RestrictSUIDSGID` value from the last assignment in `contents`.
///
/// systemd accepts the usual boolean spellings. An unrecognised or empty value
/// yields `None` so we never rewrite a setting we do not understand.
pub fn parse_restrict_suid_sgid(contents: &str) -> Option<bool> {
    let mut value = None;
    for raw in contents.lines() {
        let line = raw.trim();
        if line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some((key, val)) = line.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("RestrictSUIDSGID") {
            continue;
        }
        match val.trim().to_ascii_lowercase().as_str() {
            "yes" | "true" | "1" | "on" => value = Some(true),
            "no" | "false" | "0" | "off" => value = Some(false),
            _ => {}
        }
    }
    value
}

/// Effective `RestrictSUIDSGID` for a unit plus its drop-ins.
///
/// `files` is in systemd's apply order (unit first, drop-ins sorted by
/// filename), and the last assignment wins.
pub fn effective_restrict_suid_sgid(files: &[(String, String)]) -> Option<bool> {
    files.iter().fold(None, |acc, (_, contents)| {
        parse_restrict_suid_sgid(contents).or(acc)
    })
}

/// True when the effective configuration still enables `RestrictSUIDSGID`.
pub fn needs_compat(files: &[(String, String)]) -> bool {
    effective_restrict_suid_sgid(files) == Some(true)
}

/// The drop-in body to install, or `None` when nothing needs repairing.
pub fn compat_plan(files: &[(String, String)]) -> Option<&'static str> {
    needs_compat(files).then_some(COMPAT_DROPIN_BODY)
}

/// `struct open_how` from `linux/openat2.h`. Defined locally because
/// `libc::open_how` is `#[non_exhaustive]` and cannot be constructed here.
#[repr(C)]
struct OpenHow {
    flags: u64,
    mode: u64,
    resolve: u64,
}

/// True when `openat2(2)` works in this process.
///
/// A seccomp filter (systemd `RestrictSUIDSGID=yes`) or a pre-5.6 kernel makes
/// the syscall fail with `ENOSYS`; any other outcome means it is usable.
#[cfg(target_os = "linux")]
pub fn openat2_usable() -> bool {
    let Ok(path) = std::ffi::CString::new("/proc/self/exe") else {
        return true;
    };
    let how = OpenHow {
        flags: (libc::O_RDONLY | libc::O_CLOEXEC) as u64,
        mode: 0,
        resolve: 0,
    };
    // SAFETY: `path` is a valid NUL-terminated string and `how` outlives the
    // call; the kernel only reads `size_of::<OpenHow>()` bytes from it.
    let ret = unsafe {
        libc::syscall(
            libc::SYS_openat2,
            libc::AT_FDCWD,
            path.as_ptr(),
            &how as *const OpenHow,
            std::mem::size_of::<OpenHow>(),
        )
    };
    if ret >= 0 {
        // SAFETY: a non-negative return is a file descriptor owned by this call.
        unsafe { libc::close(ret as libc::c_int) };
        true
    } else {
        std::io::Error::last_os_error().raw_os_error() != Some(libc::ENOSYS)
    }
}

/// Non-Linux builds never run under systemd; report usable so nothing happens.
#[cfg(not(target_os = "linux"))]
pub fn openat2_usable() -> bool {
    true
}

/// Major/minor of the running kernel, parsed from `/proc/sys/kernel/osrelease`.
fn kernel_version() -> Option<(u32, u32)> {
    let release = std::fs::read_to_string("/proc/sys/kernel/osrelease").ok()?;
    let mut parts = release.trim().split('.').filter_map(|part| {
        let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
        digits.parse::<u32>().ok()
    });
    Some((parts.next()?, parts.next()?))
}

/// True when the kernel implements `openat2(2)` at all (Linux 5.6+). On such a
/// kernel an `ENOSYS` from [`openat2_usable`] can only come from seccomp.
fn kernel_supports_openat2() -> bool {
    kernel_version().is_some_and(|version| version >= (5, 6))
}

/// systemd sets `INVOCATION_ID` for every service it starts.
fn running_under_systemd() -> bool {
    std::env::var_os("INVOCATION_ID").is_some()
}

/// Unit file paths in systemd's apply order: the unit first, then its drop-ins
/// sorted by filename.
fn unit_and_dropins(unit_dir: &Path, dropin_dir: &Path) -> AgentResult<Vec<PathBuf>> {
    let mut paths = vec![unit_dir.join(UNIT_NAME)];
    if dropin_dir.is_dir() {
        let mut dropins: Vec<PathBuf> = std::fs::read_dir(dropin_dir)
            .map_err(|e| {
                AgentError::IoError(format!("Cannot read {}: {}", dropin_dir.display(), e))
            })?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "conf"))
            .collect();
        dropins.sort();
        paths.extend(dropins);
    }
    Ok(paths)
}

fn read_configs(paths: &[PathBuf]) -> AgentResult<Vec<(String, String)>> {
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        match std::fs::read_to_string(path) {
            Ok(contents) => out.push((path.display().to_string(), contents)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(AgentError::IoError(format!(
                    "Cannot read {}: {}",
                    path.display(),
                    e
                )))
            }
        }
    }
    Ok(out)
}

/// Install (or refresh) the compat drop-in when the effective configuration
/// still enables `RestrictSUIDSGID`. Returns `true` when it changed something.
pub async fn ensure_openat2_compat() -> AgentResult<bool> {
    ensure_openat2_compat_in(Path::new("/etc/systemd/system"), Path::new(DROPIN_DIR)).await
}

async fn ensure_openat2_compat_in(unit_dir: &Path, dropin_dir: &Path) -> AgentResult<bool> {
    // Only systemd-managed hosts have a unit to repair.
    if !Path::new("/run/systemd/system").exists() {
        return Ok(false);
    }
    if !unit_dir.join(UNIT_NAME).exists() {
        return Ok(false);
    }

    let configs = read_configs(&unit_and_dropins(unit_dir, dropin_dir)?)?;
    if compat_plan(&configs).is_none() {
        return Ok(false);
    }

    let dest = dropin_dir.join(COMPAT_DROPIN_NAME);
    if std::fs::read_to_string(&dest).is_ok_and(|contents| contents == COMPAT_DROPIN_BODY) {
        return Ok(false);
    }

    install_dropin(&dest)?;
    command_utils::run_command_sync("systemctl", &["daemon-reload"])?;
    info!(
        "Disabled RestrictSUIDSGID via {} (Fedora 44 openat2/ENOSYS compatibility)",
        dest.display()
    );
    Ok(true)
}

/// Write [`COMPAT_DROPIN_BODY`] to `dest`.
///
/// `ProtectSystem=full` mounts `/etc` read-only inside the agent's mount
/// namespace, so the file is staged in `/run` and copied through PID 1's mount
/// namespace (the same mechanism the agent uses for loop mounts).
fn install_dropin(dest: &Path) -> AgentResult<()> {
    let dest = dest
        .to_str()
        .ok_or_else(|| AgentError::InvalidRequest("Non-UTF-8 drop-in path".to_string()))?;
    let dir = Path::new(dest)
        .parent()
        .and_then(Path::to_str)
        .ok_or_else(|| AgentError::InvalidRequest("Drop-in path has no parent".to_string()))?;

    std::fs::write(STAGING_FILE, COMPAT_DROPIN_BODY)
        .map_err(|e| AgentError::IoError(format!("Cannot stage {}: {}", STAGING_FILE, e)))?;
    command_utils::run_in_host_mount_ns("mkdir", &["-p", dir])?;
    let copied = command_utils::run_in_host_mount_ns("cp", &[STAGING_FILE, dest]);
    let _ = std::fs::remove_file(STAGING_FILE);
    copied?;

    let installed = std::fs::read_to_string(dest)
        .map_err(|e| AgentError::IoError(format!("Cannot verify {}: {}", dest, e)))?;
    if installed != COMPAT_DROPIN_BODY {
        return Err(AgentError::IoError(format!(
            "Drop-in {} did not install correctly",
            dest
        )));
    }
    Ok(())
}

/// Repair the unit if needed, then restart once when this process is still
/// sandboxed by the stale restriction.
pub async fn migrate_and_maybe_restart() -> CompatOutcome {
    let applied = match ensure_openat2_compat().await {
        Ok(applied) => applied,
        Err(e) => {
            warn!(
                "Could not repair the systemd unit for openat2 compatibility: {}",
                e
            );
            false
        }
    };

    let blocked = !openat2_usable();
    let outcome = CompatOutcome { applied, blocked };
    if !blocked {
        return outcome;
    }

    let dropin = Path::new(DROPIN_DIR).join(COMPAT_DROPIN_NAME);
    if !dropin.exists() || !kernel_supports_openat2() || !running_under_systemd() {
        warn!(
            "openat2(2) is blocked by systemd RestrictSUIDSGID; archive restores will fail on Fedora 44 until catalyst-agent.service restarts with RestrictSUIDSGID=no (systemd/systemd#43314)"
        );
        return outcome;
    }

    if Path::new(RESTART_MARKER).exists() {
        warn!(
            "openat2(2) is still blocked after the compatibility restart; leaving the agent running (archive restores may fail on Fedora 44)"
        );
        return outcome;
    }
    if let Err(e) = std::fs::write(RESTART_MARKER, "restart attempted\n") {
        warn!("Cannot write {}; not restarting: {}", RESTART_MARKER, e);
        return outcome;
    }

    // A seccomp filter is installed at process start and cannot be lifted, so
    // the unit has to be started again to pick up the repaired configuration.
    // Ask systemd directly rather than exiting and relying on `Restart=`, so
    // the fix also lands on a unit with no restart policy. `--no-block` returns
    // before systemd stops this process, and the marker above keeps this to at
    // most one attempt per boot.
    info!(
        "Restarting catalyst-agent.service to apply the RestrictSUIDSGID/openat2 \
         compatibility drop-in (systemd/systemd#43314)"
    );
    match command_utils::run_command_sync("systemctl", &["restart", "--no-block", UNIT_NAME]) {
        Ok(()) => info!("Requested restart of {}", UNIT_NAME),
        Err(e) => warn!(
            "Could not restart {} ({}); restart it manually to apply the RestrictSUIDSGID/openat2 compatibility drop-in",
            UNIT_NAME, e
        ),
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(contents: &str) -> (String, String) {
        ("catalyst-agent.service".to_string(), contents.to_string())
    }

    #[test]
    fn parses_every_boolean_spelling() {
        for yes in ["yes", "true", "1", "on", "YES", "True", " on "] {
            assert_eq!(
                parse_restrict_suid_sgid(&format!("RestrictSUIDSGID={}", yes)),
                Some(true),
                "{yes} must parse as enabled"
            );
        }
        for no in ["no", "false", "0", "off"] {
            assert_eq!(
                parse_restrict_suid_sgid(&format!("RestrictSUIDSGID={}", no)),
                Some(false),
                "{no} must parse as disabled"
            );
        }
    }

    #[test]
    fn ignores_comments_unknown_values_and_other_keys() {
        let contents = "# RestrictSUIDSGID=yes
; RestrictSUIDSGID=yes
RestrictSUIDSGID=maybe
ProtectHome=true
";
        assert_eq!(parse_restrict_suid_sgid(contents), None);
    }

    #[test]
    fn last_assignment_in_a_file_wins() {
        assert_eq!(
            parse_restrict_suid_sgid(
                "RestrictSUIDSGID=yes
RestrictSUIDSGID=no
"
            ),
            Some(false)
        );
        assert_eq!(
            parse_restrict_suid_sgid(
                "RestrictSUIDSGID=no
RestrictSUIDSGID=yes
"
            ),
            Some(true)
        );
    }

    #[test]
    fn dropin_overrides_the_unit() {
        let files = vec![
            file(
                "[Service]
RestrictSUIDSGID=yes
",
            ),
            (
                "limits.conf".to_string(),
                "[Service]
RestrictSUIDSGID=no
"
                .to_string(),
            ),
        ];
        assert!(!needs_compat(&files));
        assert!(compat_plan(&files).is_none());
    }

    #[test]
    fn dropin_can_re_enable_it() {
        // The Fedora 44 regression: the main unit is clean but a stale drop-in
        // turns RestrictSUIDSGID back on, which is why a zz- drop-in is used.
        let files = vec![
            file(
                "[Service]
RestrictSUIDSGID=no
",
            ),
            (
                "limits.conf".to_string(),
                "[Service]
RestrictSUIDSGID=yes
"
                .to_string(),
            ),
        ];
        assert!(needs_compat(&files));
        assert_eq!(compat_plan(&files), Some(COMPAT_DROPIN_BODY));
    }

    #[test]
    fn unset_is_not_a_problem() {
        let files = vec![file(
            "[Service]
ProtectHome=true
",
        )];
        assert_eq!(effective_restrict_suid_sgid(&files), None);
        assert!(!needs_compat(&files));
    }

    #[test]
    fn compat_dropin_disables_the_setting() {
        assert_eq!(
            parse_restrict_suid_sgid(COMPAT_DROPIN_BODY),
            Some(false),
            "the generated drop-in must itself disable RestrictSUIDSGID"
        );
        assert!(COMPAT_DROPIN_NAME.starts_with("zz-"), "must sort last");
    }

    #[test]
    fn openat2_probe_is_deterministic() {
        // The probe must return a verdict on every host (blocked or not) and
        // must not depend on call order.
        assert_eq!(openat2_usable(), openat2_usable());
    }

    #[test]
    fn kernel_version_is_parsed() {
        // Any host running this test has a parseable osrelease.
        assert!(kernel_version().is_some_and(|(major, _)| major >= 1));
    }

    #[test]
    fn dropins_are_discovered_in_filename_order() {
        let root = tempfile::tempdir().unwrap();
        let unit_dir = root.path();
        let dropin_dir = unit_dir.join("catalyst-agent.service.d");
        std::fs::create_dir_all(&dropin_dir).unwrap();
        // Clean main unit, stale drop-in that re-enables the restriction.
        std::fs::write(unit_dir.join(UNIT_NAME), "[Service]\nRestrictSUIDSGID=no\n").unwrap();
        std::fs::write(
            dropin_dir.join("limits.conf"),
            "[Service]\nRestrictSUIDSGID=yes\n",
        )
        .unwrap();
        std::fs::write(
            dropin_dir.join(COMPAT_DROPIN_NAME),
            "[Service]\nRestrictSUIDSGID=no\n",
        )
        .unwrap();
        // Anything that is not a *.conf is not a drop-in.
        std::fs::write(dropin_dir.join("README"), "not a drop-in\n").unwrap();

        let paths = unit_and_dropins(unit_dir, &dropin_dir).unwrap();
        assert_eq!(paths.len(), 3, "unit + two drop-ins: {paths:?}");
        assert!(paths[0].ends_with(UNIT_NAME));
        assert!(paths[1].ends_with("limits.conf"));
        assert!(paths[2].ends_with(COMPAT_DROPIN_NAME), "zz- must sort last");

        let configs = read_configs(&paths).unwrap();
        assert!(
            !needs_compat(&configs),
            "the zz- drop-in wins over limits.conf"
        );

        // Without it the stale limits.conf re-enables the restriction.
        std::fs::remove_file(dropin_dir.join(COMPAT_DROPIN_NAME)).unwrap();
        let configs = read_configs(&unit_and_dropins(unit_dir, &dropin_dir).unwrap()).unwrap();
        assert!(needs_compat(&configs));
    }
}
