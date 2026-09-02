//! Ownership fixups for server data files.
//!
//! The agent runs as root (it must, to manage containerd, mounts, and the
//! firewall), but server containers run as `uid/gid 1000` and their `/data`
//! is a bind mount of `{data_dir}/{server_uuid}`. Any file or directory the
//! agent creates inside a server's data directory is initially owned by
//! `root:root`, which the container process cannot modify — installers and
//! game servers then fail to write their own files (issue #237).
//!
//! Every agent-side creation path under a server directory must therefore
//! hand the created file (and any directories it had to create) to the
//! container user. The helpers here centralize that policy. They are
//! best-effort: the underlying operation has already succeeded, so failures
//! are logged rather than propagated. When the agent is not running as root
//! (e.g. local development) the chown syscall cannot succeed and is skipped.

use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

/// UID the server containers run as (matches the runtime spec in
/// `runtime_manager::image_and_spec` and the install wrapper in
/// `runtime_manager::container_ops`, which both use 1000).
pub const CONTAINER_UID: u32 = 1000;
/// GID the server containers run as.
pub const CONTAINER_GID: u32 = 1000;

/// Agent-owned state under the data dir. Everything else (a server's data
/// dir is `{data_dir}/{server_uuid}`) is container data and must be owned by
/// the container user.
const DATA_DIR_AGENT_ENTRIES: &[&str] = &["images", "backups", "migrate", "console"];

/// True when the current process can change file ownership (i.e. is root).
pub fn can_chown() -> bool {
    // SAFETY: geteuid() is a simple syscall that always succeeds.
    unsafe { libc::geteuid() == 0 }
}

/// Walk from `path` up to (excluding) `stop_at` and return every ancestor in
/// between, innermost first. Returns an empty vec when `path` equals or lies
/// outside `stop_at`.
fn ancestors_below(stop_at: &Path, path: &Path) -> Vec<PathBuf> {
    let stop = stop_at
        .canonicalize()
        .unwrap_or_else(|_| stop_at.to_path_buf());
    let mut out = Vec::new();
    let mut current = Some(path);
    while let Some(p) = current {
        if !p.starts_with(&stop) || p == stop {
            break;
        }
        out.push(p.to_path_buf());
        current = p.parent();
    }
    out
}

/// chown a single path to the container user. Best-effort: a missing path is
/// silently ignored (the caller may chown before the file exists), anything
/// else is logged.
async fn chown_one(path: &Path) {
    // SECURITY: chown with AT_SYMLINK_NOFOLLOW (lchown semantics) — chown(2)
    // follows symlinks, so a container racing the agent could swap an in-jail
    // ancestor directory for a symlink during the resolve→chown window and
    // make root chown an attacker-chosen HOST path. Not-following means a
    // swapped symlink is chowned itself (harmless) instead of its target.
    match std::os::unix::fs::lchown(path, Some(CONTAINER_UID), Some(CONTAINER_GID)) {
        Ok(()) => debug!(
            "Handed {:?} to the container user ({}:{})",
            path, CONTAINER_UID, CONTAINER_GID
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => warn!(
            "Could not hand {:?} to the container user ({}:{}): {}",
            path, CONTAINER_UID, CONTAINER_GID, e
        ),
    }
}

/// Hand `path` — and every ancestor directory strictly below `stop_at` — to
/// the container user. Callers pass the agent data dir as `stop_at` so any
/// directories the agent had to create between the server root and the file
/// are covered too. Best-effort; no-op when not running as root.
pub async fn ensure_container_owned(stop_at: &Path, path: &Path) {
    if !can_chown() {
        return;
    }
    for p in ancestors_below(stop_at, path) {
        chown_one(&p).await;
    }
}

/// Recursively hand `dir` and everything below it to the container user.
/// Used after bulk operations (archive extraction, restore, clone) that
/// create whole trees. Best-effort; no-op when not running as root.
pub async fn chown_tree(dir: &Path) -> std::io::Result<()> {
    if !can_chown() {
        return Ok(());
    }
    let status = tokio::process::Command::new("chown")
        .arg("-R")
        .arg(format!("{}:{}", CONTAINER_UID, CONTAINER_GID))
        .arg(dir)
        .status()
        .await?;
    if !status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!(
                "chown -R {}:{} failed with exit code {:?}",
                CONTAINER_UID,
                CONTAINER_GID,
                status.code()
            ),
        ));
    }
    Ok(())
}

/// One-time repair for server directories created or written by earlier
/// agent versions, which left files owned by `root:root` (issue #237).
/// Chowns every directory under the data dir that is not agent-owned state
/// (see [`DATA_DIR_AGENT_ENTRIES`]) to the container user. Called in the
/// background on agent startup; safe to re-run (chown is idempotent).
pub async fn repair_existing_servers(data_dir: &Path) -> std::io::Result<usize> {
    if !can_chown() {
        return Ok(0);
    }
    let mut repaired = 0;
    let mut entries = tokio::fs::read_dir(data_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        if DATA_DIR_AGENT_ENTRIES.iter().any(|s| *s == name) {
            continue;
        }
        let path = entry.path();
        // Only directories can be server data dirs; symlink_metadata does not
        // follow symlinks, so a symlink planted in the data dir can never make
        // the recursive chown below walk outside the data dir.
        match tokio::fs::symlink_metadata(&path).await {
            Ok(m) if m.is_dir() => {}
            _ => continue,
        }
        // Server dirs are single safe path segments (uuids); skip anything else.
        if crate::shell_utils::validate_safe_path_segment(&name, "data dir entry").is_err() {
            continue;
        }
        match chown_tree(&path).await {
            Ok(()) => repaired += 1,
            Err(e) => warn!("Ownership repair failed for {:?}: {}", path, e),
        }
    }
    if repaired > 0 {
        info!(
            "Ownership repair: handed {} server director{} to the container user ({}:{})",
            repaired,
            if repaired == 1 { "y" } else { "ies" },
            CONTAINER_UID,
            CONTAINER_GID
        );
    }
    Ok(repaired)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// chown to another uid requires root; only assert ownership when the
    /// test process can actually change it.
    fn ownership_observable() -> bool {
        can_chown()
    }

    #[test]
    fn ancestors_below_walks_innermost_first() {
        let stop = Path::new("/data");
        let file = Path::new("/data/srv1/a/b/file.txt");
        let got = ancestors_below(stop, file);
        let parts: Vec<&str> = got.iter().map(|p| p.to_str().unwrap()).collect();
        assert_eq!(
            parts,
            vec![
                "/data/srv1/a/b/file.txt",
                "/data/srv1/a/b",
                "/data/srv1/a",
                "/data/srv1"
            ]
        );
    }

    #[test]
    fn ancestors_below_stops_at_boundary() {
        assert!(ancestors_below(Path::new("/data"), Path::new("/data")).is_empty());
        assert!(ancestors_below(Path::new("/data"), Path::new("/etc/passwd")).is_empty());
        assert!(ancestors_below(Path::new("/data"), Path::new("/database/x")).is_empty());
    }

    #[test]
    fn ancestors_below_keeps_sibling_prefixes_out() {
        // "/datax" must not count as below "/data".
        assert!(ancestors_below(Path::new("/data"), Path::new("/datax/srv1")).is_empty());
    }

    #[tokio::test]
    async fn ensure_container_owned_sets_owner() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("srv1").join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("f.txt");
        std::fs::write(&file, b"x").unwrap();

        ensure_container_owned(dir.path(), &file).await;

        if !ownership_observable() {
            return;
        }
        use std::os::unix::fs::MetadataExt;
        for p in [&file, &nested, &dir.path().join("srv1")] {
            let meta = std::fs::metadata(p).unwrap();
            assert_eq!(meta.uid(), CONTAINER_UID, "uid of {:?}", p);
            assert_eq!(meta.gid(), CONTAINER_GID, "gid of {:?}", p);
        }
    }

    #[tokio::test]
    async fn ensure_container_owned_tolerates_missing_path() {
        let dir = tempfile::tempdir().unwrap();
        // Leaf does not exist yet — must not warn/panic, ancestors still fixed.
        ensure_container_owned(dir.path(), &dir.path().join("later.txt")).await;
    }

    #[tokio::test]
    async fn chown_tree_sets_owner_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let tree = dir.path().join("srv1");
        std::fs::create_dir_all(tree.join("a")).unwrap();
        std::fs::write(tree.join("a").join("f.bin"), b"x").unwrap();

        chown_tree(&tree).await.unwrap();

        if !ownership_observable() {
            return;
        }
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::metadata(tree.join("a").join("f.bin")).unwrap();
        assert_eq!(meta.uid(), CONTAINER_UID);
        assert_eq!(meta.gid(), CONTAINER_GID);
    }

    #[tokio::test]
    async fn repair_existing_servers_fixes_server_dirs_only() {
        let data = tempfile::tempdir().unwrap();
        // Server data dir (uuid-like name) plus agent-owned state that must
        // be skipped, and a non-server file.
        let server = data.path().join("cmaid8f9x0001uvqx9abcd123");
        std::fs::create_dir_all(server.join("plugins")).unwrap();
        std::fs::write(server.join("server.properties"), b"x").unwrap();
        std::fs::create_dir_all(data.path().join("images")).unwrap();
        std::fs::write(data.path().join("images").join("keep.img"), b"").unwrap();
        std::fs::write(data.path().join("firewall-rules.jsonl"), b"").unwrap();

        let repaired = repair_existing_servers(data.path()).await.unwrap();

        // Exactly one directory is a repairable server dir: the exclusion
        // list must have skipped `images`, and the loose file never counts.
        assert_eq!(repaired, if ownership_observable() { 1 } else { 0 });

        if !ownership_observable() {
            return;
        }
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::metadata(server.join("server.properties")).unwrap();
        assert_eq!(meta.uid(), CONTAINER_UID);
        assert_eq!(meta.gid(), CONTAINER_GID);
    }
}
