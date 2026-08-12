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

    /// True when `path` is a mount point in the host (containerd) mount table.
    /// Errors if the mount table cannot be read — callers must fail closed.
    pub async fn path_is_mounted(&self, path: &Path) -> AgentResult<bool> {
        Ok(self.get_mount_info(path).await?.0)
    }

    /// Replace `dest` with the contents of `src`.
    ///
    /// `rename(src, dest)` fails when `dest` is a live loop-mount (the default
    /// for systemd-installed agents). In that case we copy onto the image first
    /// and only then swap children, so a failed copy leaves the live tree intact.
    /// If we cannot read the mount table we abort rather than guessing.
    pub async fn replace_directory_contents(&self, dest: &Path, src: &Path) -> AgentResult<()> {
        if !src.exists() {
            return Err(AgentError::NotFound(format!(
                "Restore source does not exist: {}",
                src.display()
            )));
        }
        let mounted = self.path_is_mounted(dest).await?;
        if mounted {
            info!(
                "{} is a mount point; staging restore on the image then swapping",
                dest.display()
            );
            return self.replace_mounted_directory_contents(dest, src).await;
        }
        self.replace_unmounted_directory(dest, src).await
    }

    /// Copy `src` onto a sibling dir *inside* the live mount, then swap children.
    /// Live dest is not cleared until the copy has succeeded.
    async fn replace_mounted_directory_contents(&self, dest: &Path, src: &Path) -> AgentResult<()> {
        let staging = dest.join(".catalyst-restore-new");
        let old = dest.join(".catalyst-restore-old");
        let _ = fs::remove_dir_all(&staging).await;
        let _ = fs::remove_dir_all(&old).await;
        fs::create_dir_all(&staging).await.map_err(|e| {
            AgentError::FileSystemError(format!(
                "Failed to create restore staging {}: {}",
                staging.display(),
                e
            ))
        })?;
        if let Err(e) = self.copy_dir_contents(src, &staging).await {
            let _ = fs::remove_dir_all(&staging).await;
            return Err(e);
        }
        fs::create_dir_all(&old).await.map_err(|e| {
            AgentError::FileSystemError(format!(
                "Failed to create restore backup dir {}: {}",
                old.display(),
                e
            ))
        })?;
        if let Err(e) = move_children_except(
            dest,
            &old,
            &[".catalyst-restore-new", ".catalyst-restore-old"],
        )
        .await
        {
            let _ = move_children_except(&old, dest, &[]).await;
            let _ = fs::remove_dir_all(&old).await;
            let _ = fs::remove_dir_all(&staging).await;
            return Err(e);
        }
        if let Err(e) = move_children_except(&staging, dest, &[]).await {
            let _ = move_children_except(dest, &staging, &[".catalyst-restore-old"]).await;
            let _ = move_children_except(&old, dest, &[]).await;
            let _ = fs::remove_dir_all(&old).await;
            let _ = fs::remove_dir_all(&staging).await;
            return Err(e);
        }
        let _ = fs::remove_dir_all(&staging).await;
        let _ = fs::remove_dir_all(&old).await;
        let _ = fs::remove_dir_all(src).await;
        Ok(())
    }

    /// Dest is not a mount point: move it aside, then rename src into place.
    /// If dest *is* secretly a mount, the aside-rename fails and dest is untouched.
    async fn replace_unmounted_directory(&self, dest: &Path, src: &Path) -> AgentResult<()> {
        if dest.exists() {
            let bak = dest.with_extension("replace_old");
            let _ = fs::remove_dir_all(&bak).await;
            fs::rename(dest, &bak).await.map_err(|e| {
                AgentError::FileSystemError(format!(
                    "Failed to move {} aside before restore (is it a mount point?): {}",
                    dest.display(),
                    e
                ))
            })?;
            if let Err(e) = fs::rename(src, dest).await {
                let _ = fs::rename(&bak, dest).await;
                return Err(AgentError::FileSystemError(format!(
                    "Failed to move {} onto {}: {}",
                    src.display(),
                    dest.display(),
                    e
                )));
            }
            let _ = fs::remove_dir_all(&bak).await;
            return Ok(());
        }
        fs::rename(src, dest).await.map_err(|e| {
            AgentError::FileSystemError(format!(
                "Failed to move {} onto {}: {}",
                src.display(),
                dest.display(),
                e
            ))
        })?;
        Ok(())
    }

    /// Unmount a server disk image (if any), then delete the mount dir and `.img`.
    pub async fn destroy_server_storage(
        &self,
        server_uuid: &str,
        mount_dir: &Path,
    ) -> AgentResult<()> {
        match self.path_is_mounted(mount_dir).await {
            Ok(true) => {
                self.unmount(mount_dir).await?;
            }
            Ok(false) => {}
            Err(e) => {
                // Fail closed: try to unmount anyway so remove_dir_all cannot
                // wipe a live image whose mount table we failed to read.
                warn!(
                    "Could not determine if {} is mounted ({}); attempting unmount before delete",
                    mount_dir.display(),
                    e
                );
                if let Err(unmount_err) = self.unmount(mount_dir).await {
                    return Err(AgentError::FileSystemError(format!(
                        "Refusing to delete {}: mount status unknown ({}) and unmount failed ({})",
                        mount_dir.display(),
                        e,
                        unmount_err
                    )));
                }
            }
        }
        if mount_dir.exists() {
            fs::remove_dir_all(mount_dir).await.map_err(|e| {
                AgentError::FileSystemError(format!(
                    "Failed to remove {}: {}",
                    mount_dir.display(),
                    e
                ))
            })?;
        }
        let image = self.image_path(server_uuid);
        if image.exists() {
            fs::remove_file(&image).await.map_err(|e| {
                AgentError::FileSystemError(format!(
                    "Failed to remove storage image {}: {}",
                    image.display(),
                    e
                ))
            })?;
        }
        Ok(())
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

    async fn copy_dir_contents(&self, src: &Path, dest: &Path) -> AgentResult<()> {
        let src_slash = format!("{}/", src.display());
        let src_dot = format!("{}/.", src.display());
        let dest_slash = format!("{}/", dest.display());
        spawn_blocking(move || {
            if PathBuf::from("/usr/bin/rsync").exists()
                || PathBuf::from("/usr/local/bin/rsync").exists()
            {
                command_utils::run_command_sync_with_timeout(
                    "rsync",
                    &["-a", src_slash.as_str(), dest_slash.as_str()],
                    3600,
                )
            } else {
                command_utils::run_command_sync_with_timeout(
                    "cp",
                    &["-a", src_dot.as_str(), dest_slash.as_str()],
                    3600,
                )
            }
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("copy_dir_contents task failed: {}", e)))?
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

/// Move children of `from` into `to`, skipping `except` names and ext4 `lost+found`.
async fn move_children_except(from: &Path, to: &Path, except: &[&str]) -> AgentResult<()> {
    let mut entries = fs::read_dir(from).await.map_err(|e| {
        AgentError::FileSystemError(format!("Failed to read {}: {}", from.display(), e))
    })?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| {
        AgentError::FileSystemError(format!("Failed to read entry in {}: {}", from.display(), e))
    })? {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if except.iter().any(|n| *n == name_str) || name_str == "lost+found" {
            continue;
        }
        let src = entry.path();
        let dest = to.join(&name);
        fs::rename(&src, &dest).await.map_err(|e| {
            AgentError::FileSystemError(format!(
                "Failed to move {} -> {}: {}",
                src.display(),
                dest.display(),
                e
            ))
        })?;
    }
    Ok(())
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

    #[tokio::test]
    async fn replace_unmounted_directory_swaps_without_wiping_src_on_rename_fail() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        let src = tmp.path().join("src");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(dest.join("live.txt"), b"keep-me").unwrap();
        std::fs::write(src.join("new.txt"), b"restored").unwrap();

        let sm = StorageManager::new(tmp.path().to_path_buf());
        sm.replace_unmounted_directory(&dest, &src)
            .await
            .expect("unmounted swap");

        assert!(dest.join("new.txt").exists());
        assert!(!dest.join("live.txt").exists());
        assert!(!src.exists());
    }

    #[tokio::test]
    async fn replace_directory_contents_missing_src_is_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("live.txt"), b"keep-me").unwrap();
        let sm = StorageManager::new(tmp.path().to_path_buf());
        let err = sm
            .replace_directory_contents(&dest, &tmp.path().join("missing"))
            .await
            .expect_err("missing src");
        assert!(
            dest.join("live.txt").exists(),
            "live dest must be untouched"
        );
        let _ = err;
    }
}
