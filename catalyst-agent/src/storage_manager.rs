use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::task::spawn_blocking;
use tracing::{error, info, warn};

const MAX_METRICS_BUFFER_BYTES: u64 = 100 * 1024 * 1024;

use crate::command_utils;
use crate::{AgentError, AgentResult};
use serde_json::Value;

pub struct StorageManager {
    data_dir: PathBuf,
}

impl StorageManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    pub async fn ensure_mounted(
        &self,
        server_uuid: &str,
        mount_dir: &Path,
        size_mb: u64,
    ) -> AgentResult<PathBuf> {
        let image_path = self.image_path(server_uuid);
        fs::create_dir_all(self.images_dir()).await?;
        fs::create_dir_all(mount_dir).await?;

        // Host (PID 1) mount table is what containerd bind-mounts. A loop image
        // mounted only in the agent's ProtectSystem mount NS is invisible to
        // containers and produces an empty file explorer / empty /data.
        let host_info = self.mount_info_from("/proc/1/mounts", mount_dir).await?;
        let local_info = self.mount_info_from("/proc/mounts", mount_dir).await?;

        if let Some((_, noexec)) = host_info {
            if noexec {
                info!(
                    "Remounting {} to remove noexec (game binaries need exec)",
                    mount_dir.display()
                );
                self.remount_exec(mount_dir).await?;
            }
            if local_info.is_none() {
                self.ensure_local_view(mount_dir).await?;
            }
            return Ok(image_path);
        }

        if local_info.is_some() {
            warn!(
                "Disk image for {} is mounted only in the agent's mount namespace \
                 (ProtectSystem=full). containerd cannot see it — install files \
                 landed on the host directory. Unmounting the private view so we \
                 can reconcile.",
                server_uuid
            );
            self.unmount_local(mount_dir).await?;
        }

        if !image_path.exists() {
            self.create_image(&image_path, size_mb).await?;
        }

        if self.dir_has_data(mount_dir).await? {
            self.migrate_existing_data(server_uuid, mount_dir, &image_path)
                .await?;
        }

        match self.mount_image(&image_path, mount_dir).await {
            Ok(()) => Ok(image_path),
            Err(e) if !command_utils::same_mount_namespace_as_init() => {
                error!(
                    "Cannot mount disk image for {} in the host mount namespace ({}). \
                     Using the plain data directory so install files stay visible to \
                     containerd and the file explorer. Disk quota will not be enforced.",
                    server_uuid, e
                );
                Ok(image_path)
            }
            Err(e) => Err(e),
        }
    }

    pub async fn resize(
        &self,
        server_uuid: &str,
        mount_dir: &Path,
        size_mb: u64,
        allow_online_grow: bool,
    ) -> AgentResult<()> {
        let image_path = self.image_path(server_uuid);
        if !image_path.exists() {
            return Err(AgentError::NotFound("Storage image not found".to_string()));
        }

        let current_mb = self.image_size_mb(&image_path).await?;
        if size_mb == current_mb {
            return Ok(());
        }

        if size_mb > current_mb {
            self.grow_image(&image_path, mount_dir, size_mb, allow_online_grow)
                .await?;
            return Ok(());
        }

        let was_mounted = self.is_mounted(mount_dir).await?;
        if was_mounted {
            self.unmount(mount_dir).await?;
        }

        if let Err(e) = self.shrink_image(&image_path, size_mb).await {
            warn!(
                "Shrink failed for {}, attempting to remount: {}",
                server_uuid, e
            );
            if was_mounted {
                if let Err(remount_err) = self.mount_image(&image_path, mount_dir).await {
                    error!("Failed to remount after shrink failure: {}", remount_err);
                    return Err(AgentError::FileSystemError(format!(
                        "Shrink failed ({}), and remount failed ({})",
                        e, remount_err
                    )));
                }
            }
            return Err(e);
        }

        self.mount_image(&image_path, mount_dir).await?;
        Ok(())
    }

    fn images_dir(&self) -> PathBuf {
        self.data_dir.join("images")
    }

    fn image_path(&self, server_uuid: &str) -> PathBuf {
        self.images_dir().join(format!("{}.img", server_uuid))
    }

    async fn image_size_mb(&self, image_path: &Path) -> AgentResult<u64> {
        let metadata = fs::metadata(image_path).await?;
        Ok(metadata.len() / (1024 * 1024))
    }

    async fn create_image(&self, image_path: &Path, size_mb: u64) -> AgentResult<()> {
        // Cap at 100 GB to prevent unreasonable allocations that could
        // exhaust host disk space via a malicious allocatedDiskMb value.
        const MAX_DISK_MB: u64 = 100 * 1024; // 100 GB in MB
        if size_mb > MAX_DISK_MB {
            return Err(AgentError::InvalidRequest(format!(
                "Requested disk size {} MB exceeds maximum {} MB",
                size_mb, MAX_DISK_MB
            )));
        }
        let image = image_path.to_path_buf();
        let size = size_mb;
        spawn_blocking(move || -> AgentResult<()> {
            info!("Creating storage image {} ({} MB)", image.display(), size);
            let image_str = image
                .to_str()
                .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?;
            command_utils::run_command_sync(
                "fallocate",
                &["-l", &format!("{}M", size), image_str],
            )?;
            command_utils::run_command_sync("mkfs.ext4", &["-F", image_str])?;
            Ok(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Storage create task failed: {}", e)))?
    }

    async fn migrate_existing_data(
        &self,
        server_uuid: &str,
        mount_dir: &Path,
        image_path: &Path,
    ) -> AgentResult<()> {
        let migrate_dir = self.data_dir.join("migrate").join(server_uuid);
        if migrate_dir.exists() {
            return Err(AgentError::FileSystemError(format!(
                "Migration directory already exists: {}",
                migrate_dir.display()
            )));
        }
        fs::create_dir_all(&migrate_dir).await?;

        info!("Migrating existing data for {}", server_uuid);
        self.mount_image(image_path, &migrate_dir).await?;
        let mount_dir_str = format!("{}/", mount_dir.display());
        let mount_dir_dot = format!("{}/.", mount_dir.display());
        let migrate_dir_str = format!("{}/", migrate_dir.display());
        let result = spawn_blocking(move || {
            // Prefer rsync for efficiency, fall back to cp -a if rsync is unavailable
            if std::path::PathBuf::from("/usr/bin/rsync").exists()
                || std::path::PathBuf::from("/usr/local/bin/rsync").exists()
            {
                command_utils::run_command_sync_with_timeout(
                    "rsync",
                    &["-a", mount_dir_str.as_str(), migrate_dir_str.as_str()],
                    3600,
                )
            } else {
                // cp -a with src/. copies directory contents (not the dir itself)
                command_utils::run_command_sync_with_timeout(
                    "cp",
                    &["-a", mount_dir_dot.as_str(), migrate_dir_str.as_str()],
                    3600,
                )
            }
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("data migration task failed: {}", e)))?;
        if let Err(e) = result {
            warn!("Migration failed for {}, cleaning up: {}", server_uuid, e);
            let _ = self.unmount(&migrate_dir).await;
            let _ = fs::remove_dir_all(&migrate_dir).await;
            return Err(e);
        }
        self.unmount(&migrate_dir).await?;
        self.clear_dir(mount_dir).await?;
        fs::remove_dir_all(&migrate_dir).await?;
        Ok(())
    }

    async fn clear_dir(&self, dir: &Path) -> AgentResult<()> {
        let mut entries = fs::read_dir(dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(&path).await?;
            } else {
                fs::remove_file(&path).await?;
            }
        }
        Ok(())
    }

    async fn grow_image(
        &self,
        image_path: &Path,
        mount_dir: &Path,
        size_mb: u64,
        allow_online_grow: bool,
    ) -> AgentResult<()> {
        let mounted = self.is_mounted(mount_dir).await?;
        if allow_online_grow && mounted {
            let image = image_path
                .to_str()
                .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?
                .to_string();
            let mount = mount_dir
                .to_str()
                .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
                .to_string();
            let size_arg = format!("{}M", size_mb);
            spawn_blocking(move || {
                command_utils::run_command_sync("fallocate", &["-l", &size_arg, &image])?;
                command_utils::run_in_host_mount_ns("resize2fs", &[&mount])?;
                Ok::<(), AgentError>(())
            })
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Resize task failed: {}", e)))??;
            return Ok(());
        }
        if mounted {
            self.unmount(mount_dir).await?;
        }
        let image = image_path
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?
            .to_string();
        let size_arg = format!("{}M", size_mb);
        spawn_blocking(move || {
            command_utils::run_command_sync("fallocate", &["-l", &size_arg, &image])?;
            command_utils::run_command_sync("resize2fs", &[&image])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Resize task failed: {}", e)))??;
        Ok(())
    }

    async fn shrink_image(&self, image_path: &Path, size_mb: u64) -> AgentResult<()> {
        let image = image_path
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?
            .to_string();
        let size_arg = format!("{}M", size_mb);
        spawn_blocking(move || {
            command_utils::run_command_sync("e2fsck", &["-f", &image])?;
            command_utils::run_command_sync("resize2fs", &[&image, &size_arg])?;
            command_utils::run_command_sync("fallocate", &["-l", &size_arg, &image])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Resize task failed: {}", e)))??;
        Ok(())
    }

    async fn mount_image(&self, image_path: &Path, mount_dir: &Path) -> AgentResult<()> {
        let image = image_path
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?
            .to_string();
        let mount = mount_dir
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
            .to_string();
        spawn_blocking({
            let mount = mount.clone();
            move || {
                command_utils::run_in_host_mount_ns(
                    "mount",
                    &["-o", "loop,exec,nodev,nosuid", &image, &mount],
                )?;
                Ok::<(), AgentError>(())
            }
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Mount task failed: {}", e)))??;
        self.ensure_local_view(mount_dir).await?;
        Ok(())
    }

    async fn unmount(&self, mount_dir: &Path) -> AgentResult<()> {
        // Same mount NS as PID 1: one umount is enough (and a second would fail).
        if command_utils::same_mount_namespace_as_init() {
            let mount = mount_dir
                .to_str()
                .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
                .to_string();
            return spawn_blocking(move || {
                command_utils::run_command_sync("umount", &[&mount])?;
                Ok::<(), AgentError>(())
            })
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Unmount task failed: {}", e)))?;
        }

        // Private NS: drop the local bind first so the host umount is not busy.
        let _ = self.unmount_local(mount_dir).await;
        if self
            .mount_info_from("/proc/1/mounts", mount_dir)
            .await?
            .is_none()
        {
            return Ok(());
        }
        let mount = mount_dir
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
            .to_string();
        spawn_blocking(move || {
            command_utils::run_in_host_mount_ns("umount", &[&mount])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Unmount task failed: {}", e)))??;
        Ok(())
    }

    async fn unmount_local(&self, mount_dir: &Path) -> AgentResult<()> {
        if self
            .mount_info_from("/proc/mounts", mount_dir)
            .await?
            .is_none()
        {
            return Ok(());
        }
        let mount = mount_dir
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
            .to_string();
        spawn_blocking(move || {
            command_utils::run_command_sync("umount", &[&mount])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Local unmount task failed: {}", e)))??;
        Ok(())
    }

    /// If the host has the loop mount but it did not propagate into the agent's
    /// private mount NS, bind the host's view so FileManager/SFTP see the same
    /// files as containerd.
    async fn ensure_local_view(&self, mount_dir: &Path) -> AgentResult<()> {
        if self
            .mount_info_from("/proc/mounts", mount_dir)
            .await?
            .is_some()
        {
            return Ok(());
        }
        let mount = mount_dir
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
            .to_string();
        let host_view_str = host_root_view(mount_dir).to_string_lossy().to_string();
        info!(
            "Host mount at {} did not propagate; bind-mounting {} -> {}",
            mount, host_view_str, mount
        );
        spawn_blocking(move || {
            command_utils::run_command_sync("mount", &["--bind", &host_view_str, &mount])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| {
            AgentError::FileSystemError(format!("Bind host mount view failed: {}", e))
        })??;
        Ok(())
    }

    /// Returns (is_mounted, has_noexec) from the host mount table (containerd's view).
    async fn get_mount_info(&self, mount_dir: &Path) -> AgentResult<(bool, bool)> {
        if let Some(info) = self.mount_info_from("/proc/1/mounts", mount_dir).await? {
            return Ok(info);
        }
        Ok(self
            .mount_info_from("/proc/mounts", mount_dir)
            .await?
            .unwrap_or((false, false)))
    }

    async fn mount_info_from(
        &self,
        mounts_file: &str,
        mount_dir: &Path,
    ) -> AgentResult<Option<(bool, bool)>> {
        let mounts = match fs::read_to_string(mounts_file).await {
            Ok(s) => s,
            Err(e) if mounts_file != "/proc/mounts" => {
                warn!(
                    "Could not read {}: {}; falling back to /proc/mounts",
                    mounts_file, e
                );
                return Ok(None);
            }
            Err(e) => {
                return Err(e.into());
            }
        };
        Ok(parse_mount_info(&mounts, mount_dir))
    }

    async fn is_mounted(&self, mount_dir: &Path) -> AgentResult<bool> {
        Ok(self.get_mount_info(mount_dir).await?.0)
    }

    async fn remount_exec(&self, mount_dir: &Path) -> AgentResult<()> {
        let mount = mount_dir
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
            .to_string();
        spawn_blocking(move || {
            command_utils::run_in_host_mount_ns("mount", &["-o", "remount,exec", &mount])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Remount task failed: {}", e)))??;
        Ok(())
    }

    // --- Metrics buffering helpers ------------------------------------------------
    fn metrics_buffer_path(&self) -> PathBuf {
        self.data_dir.join("metrics_buffer.jsonl")
    }

    pub async fn append_buffered_metric(&self, line: &str) -> AgentResult<()> {
        fs::create_dir_all(&self.data_dir).await?;
        let path = self.metrics_buffer_path();
        // Rotate if buffer exceeds cap; drop oldest backup
        if let Ok(meta) = fs::metadata(&path).await {
            if meta.len() > MAX_METRICS_BUFFER_BYTES {
                let rotated = self.data_dir.join("metrics_buffer.jsonl.1");
                let _ = fs::remove_file(&rotated).await;
                let _ = fs::rename(&path, &rotated).await;
            }
        }
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;
        let mut writer = tokio::io::BufWriter::new(file);
        writer.write_all(line.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
        Ok(())
    }

    pub async fn read_buffered_metrics(&self) -> AgentResult<Vec<Value>> {
        let path = self.metrics_buffer_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let s = fs::read_to_string(&path).await?;
        let mut out = Vec::new();
        for line in s.lines() {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Value>(line) {
                Ok(v) => out.push(v),
                Err(e) => tracing::warn!("Skipping invalid buffered metric line: {}", e),
            }
        }
        Ok(out)
    }

    pub async fn clear_buffered_metrics(&self) -> AgentResult<()> {
        let path = self.metrics_buffer_path();
        if path.exists() {
            fs::remove_file(path).await?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------------

    async fn dir_has_data(&self, dir: &Path) -> AgentResult<bool> {
        let mut entries = fs::read_dir(dir).await?;
        Ok(entries.next_entry().await?.is_some())
    }
}

/// Parse /proc/mounts (or /proc/1/mounts) for `mount_dir`.
/// Returns Some((true, noexec)) when the exact mount point is present.
pub(crate) fn parse_mount_info(contents: &str, mount_dir: &Path) -> Option<(bool, bool)> {
    let target = mount_dir.to_string_lossy();
    for line in contents.lines() {
        let mut parts = line.split_whitespace();
        let _source = parts.next();
        let mount_point = match parts.next() {
            Some(p) => p.replace("\\040", " "),
            None => continue,
        };
        if mount_point == target {
            let _fs_type = parts.next();
            let opts = parts.next().unwrap_or("");
            let noexec = opts.split(',').any(|o| o == "noexec");
            return Some((true, noexec));
        }
    }
    None
}

/// Host-visible path for `mount_dir` via PID 1's root (used when a host mount
/// does not propagate into the agent's private mount namespace).
pub(crate) fn host_root_view(mount_dir: &Path) -> PathBuf {
    let rel = mount_dir.strip_prefix("/").unwrap_or(mount_dir);
    PathBuf::from("/proc/1/root").join(rel)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const SAMPLE: &str = "\
/dev/sda1 / ext4 rw,relatime 0 0\n\
/dev/loop0 /var/lib/catalyst/srv-1 ext4 rw,relatime,errors=remount-ro 0 0\n\
/dev/loop1 /var/lib/catalyst/old ext4 ro,noexec,nodev,nosuid 0 0\n\
/dev/loop2 /var/lib/catalyst/with\\040space ext4 rw,exec 0 0\n";

    #[test]
    fn parse_mount_info_finds_exact_mount() {
        let info = parse_mount_info(SAMPLE, Path::new("/var/lib/catalyst/srv-1"));
        assert_eq!(info, Some((true, false)));
    }

    #[test]
    fn parse_mount_info_detects_noexec() {
        let info = parse_mount_info(SAMPLE, Path::new("/var/lib/catalyst/old"));
        assert_eq!(info, Some((true, true)));
    }

    #[test]
    fn parse_mount_info_missing_is_none() {
        assert_eq!(
            parse_mount_info(SAMPLE, Path::new("/var/lib/catalyst/missing")),
            None
        );
    }

    #[test]
    fn parse_mount_info_does_not_prefix_match() {
        // /var/lib/catalyst must not match /var/lib/catalyst/srv-1
        assert_eq!(
            parse_mount_info(SAMPLE, Path::new("/var/lib/catalyst")),
            None
        );
    }

    #[test]
    fn parse_mount_info_decodes_escaped_spaces() {
        let info = parse_mount_info(SAMPLE, Path::new("/var/lib/catalyst/with space"));
        assert_eq!(info, Some((true, false)));
    }

    #[test]
    fn host_root_view_prefixes_proc() {
        assert_eq!(
            host_root_view(Path::new("/var/lib/catalyst/abc")),
            PathBuf::from("/proc/1/root/var/lib/catalyst/abc")
        );
    }

    #[test]
    fn host_root_view_relative_passthrough() {
        assert_eq!(
            host_root_view(Path::new("relative/dir")),
            PathBuf::from("/proc/1/root/relative/dir")
        );
    }
}
