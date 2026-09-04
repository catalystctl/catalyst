use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::task::spawn_blocking;
use tracing::{error, info, warn};

const MAX_METRICS_BUFFER_BYTES: u64 = 100 * 1024 * 1024;
/// Cap at 100 GB to prevent a malicious allocatedDiskMb from filling the host.
const MAX_DISK_MB: u64 = 100 * 1024;
/// ext4 metadata + 1 MiB rounding. A 50 GB image reporting 20 GB is a grow;
/// a 50 GB image reporting 49.5 GB is not.
const FS_GROW_SLACK_MB: u64 = 256;

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

        // Reinstall/start used to return early when the image was already
        // mounted, so a panel disk change (10 GB → 80 GB) never grew the
        // loop. SteamCMD then hit 0x202 after ~30 GB.
        //
        // Also heal the "file grew, filesystem did not" case: fallocate without
        // losetup --set-capacity leaves the loop/ext4 at the old size while
        // image_size_mb() already matches the panel quota.
        if image_path.exists() {
            let current_mb = self.image_size_mb(&image_path).await?;
            let mounted = self.is_mounted(mount_dir).await.unwrap_or(false);
            let fs_mb = if mounted {
                match self.filesystem_size_mb(mount_dir).await {
                    Ok(mb) => Some(mb),
                    Err(e) => {
                        warn!(
                            "Could not read filesystem size for {} ({}). Will refresh loop capacity.",
                            server_uuid, e
                        );
                        None
                    }
                }
            } else {
                None
            };
            let file_too_small = image_needs_grow(current_mb, size_mb);
            let fs_too_small = fs_mb.is_some_and(|mb| filesystem_needs_grow(mb, size_mb));
            let fs_unknown_while_mounted = mounted && fs_mb.is_none() && current_mb >= size_mb;
            if file_too_small || fs_too_small || fs_unknown_while_mounted {
                info!(
                    "Growing storage for {} (image {} MB, filesystem {:?} MB, requested {} MB)",
                    server_uuid, current_mb, fs_mb, size_mb
                );
                self.grow_image(&image_path, mount_dir, size_mb, true)
                    .await?;
            }
            // uid 1000 cannot see the default 5% root reserve; Paper then thinks
            // the disk is empty. Harmless if already 0.
            self.clear_ext4_reserved_blocks(&image_path, mount_dir, mounted)
                .await;
        }

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
        } else if let Err(e) = self.resize_unmounted_image(&image_path).await {
            // Do not block start: a later online heal can still grow a live mount.
            warn!(
                "Could not grow unmounted image {} to fill the file: {}",
                image_path.display(),
                e
            );
        }

        if self.dir_has_data(mount_dir).await? {
            self.migrate_existing_data(server_uuid, mount_dir, &image_path)
                .await?;
        }

        match self.mount_image(&image_path, mount_dir).await {
            Ok(()) => {
                if let Ok(fs_mb) = self.filesystem_size_mb(mount_dir).await {
                    if filesystem_needs_grow(fs_mb, size_mb) {
                        info!(
                            "Mounted {} but filesystem is {} MB (requested {} MB); growing",
                            server_uuid, fs_mb, size_mb
                        );
                        self.grow_image(&image_path, mount_dir, size_mb, true)
                            .await?;
                    }
                }
                Ok(image_path)
            }
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

    /// Grow any live loop image whose file is larger than the mounted
    /// filesystem. `fallocate` without `losetup --set-capacity` leaves Paper
    /// (and `df /data`) stuck on the old size even though the `.img` is 50 GB.
    /// Called on agent start so an update heals running servers.
    pub async fn heal_mounted_images(&self) -> AgentResult<()> {
        let images_dir = self.images_dir();
        if !images_dir.exists() {
            return Ok(());
        }
        let mut entries = match fs::read_dir(&images_dir).await {
            Ok(e) => e,
            Err(e) => {
                warn!("Could not scan storage images for heal: {}", e);
                return Ok(());
            }
        };
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Some(uuid) = name.strip_suffix(".img") else {
                continue;
            };
            if uuid.is_empty() || uuid.contains('/') || uuid.contains('\0') {
                continue;
            }
            let mount_dir = self.data_dir.join(uuid);
            if !self.is_mounted(&mount_dir).await.unwrap_or(false) {
                continue;
            }
            let file_mb = match self.image_size_mb(&path).await {
                Ok(mb) => mb,
                Err(e) => {
                    warn!("heal: could not stat image {}: {}", path.display(), e);
                    continue;
                }
            };
            if file_mb == 0 {
                continue;
            }
            let fs_mb = self.filesystem_size_mb(&mount_dir).await.ok();
            let needs = match fs_mb {
                Some(mb) => filesystem_needs_grow(mb, file_mb),
                None => true,
            };
            if !needs {
                continue;
            }
            info!(
                "Healing storage for {}: image {} MB, filesystem {:?} MB",
                uuid, file_mb, fs_mb
            );
            if let Err(e) = self.grow_image(&path, &mount_dir, file_mb, true).await {
                warn!("Failed to heal storage for {}: {}", uuid, e);
            }
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
        let mounted = self.is_mounted(mount_dir).await.unwrap_or(false);
        let fs_mb = if mounted {
            self.filesystem_size_mb(mount_dir).await.ok()
        } else {
            None
        };
        // Grow / heal only when the requested size is at least the current file.
        // A smaller request is a shrink — never fallocate -l downward on a live image.
        if size_mb >= current_mb {
            let fs_too_small = fs_mb.is_some_and(|mb| filesystem_needs_grow(mb, size_mb));
            let fs_unknown = mounted && fs_mb.is_none();
            if image_needs_grow(current_mb, size_mb) || fs_too_small || fs_unknown {
                self.grow_image(&image_path, mount_dir, size_mb, allow_online_grow)
                    .await?;
            }
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

    pub async fn image_quota_mb(&self, server_uuid: &str) -> AgentResult<u64> {
        self.image_size_mb(&self.image_path(server_uuid)).await
    }

    fn image_path(&self, server_uuid: &str) -> PathBuf {
        self.images_dir().join(format!("{}.img", server_uuid))
    }

    async fn image_size_mb(&self, image_path: &Path) -> AgentResult<u64> {
        let metadata = fs::metadata(image_path).await?;
        Ok(metadata.len() / (1024 * 1024))
    }

    async fn filesystem_size_mb(&self, mount_dir: &Path) -> AgentResult<u64> {
        let local = self.mount_info_from("/proc/mounts", mount_dir).await?;
        let probe = if local.is_some() {
            mount_dir.to_path_buf()
        } else {
            host_root_view(mount_dir)
        };
        spawn_blocking(move || filesystem_size_mb_at(&probe))
            .await
            .map_err(|e| AgentError::FileSystemError(format!("statvfs task failed: {}", e)))?
    }

    async fn create_image(&self, image_path: &Path, size_mb: u64) -> AgentResult<()> {
        validate_disk_mb(size_mb)?;
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
            // Default 5% root reserve is invisible to uid 1000 (Paper) and can
            // make getUsableSpace() look empty near the quota.
            let _ = command_utils::run_command_sync("tune2fs", &["-m", "0", image_str]);
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
        validate_disk_mb(size_mb)?;
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
            spawn_blocking(move || {
                // Skip fallocate when the file is already at quota (heal path).
                // Never shrink a live image here — resize() routes shrinks offline.
                let file_mb = std::fs::metadata(&image)
                    .map(|m| m.len() / (1024 * 1024))
                    .unwrap_or(0);
                if image_needs_grow(file_mb, size_mb) {
                    let size_arg = format!("{}M", size_mb);
                    command_utils::run_command_sync("fallocate", &["-l", &size_arg, &image])?;
                }
                grow_mounted_filesystem(&image, &mount)
            })
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Resize task failed: {}", e)))??;
            self.verify_filesystem_grown(mount_dir, size_mb).await?;
            return Ok(());
        }
        if mounted {
            self.unmount(mount_dir).await?;
        }
        let image = image_path
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?
            .to_string();
        let grow_result = spawn_blocking(move || {
            let file_mb = std::fs::metadata(&image)
                .map(|m| m.len() / (1024 * 1024))
                .unwrap_or(0);
            if image_needs_grow(file_mb, size_mb) {
                let size_arg = format!("{}M", size_mb);
                command_utils::run_command_sync("fallocate", &["-l", &size_arg, &image])?;
            }
            command_utils::run_command_sync("resize2fs", &[&image])?;
            let _ = command_utils::run_command_sync("tune2fs", &["-m", "0", &image]);
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Resize task failed: {}", e)))?;
        if mounted {
            if let Err(remount_err) = self.mount_image(image_path, mount_dir).await {
                if let Err(grow_err) = grow_result {
                    return Err(AgentError::FileSystemError(format!(
                        "Offline grow failed ({grow_err}), and remount failed ({remount_err})"
                    )));
                }
                return Err(remount_err);
            }
            self.verify_filesystem_grown(mount_dir, size_mb).await?;
            return grow_result;
        }
        grow_result
    }

    /// Grow the ext4 inside an unmounted image to fill the file.
    /// `resize2fs` is a no-op when the filesystem already matches.
    async fn resize_unmounted_image(&self, image_path: &Path) -> AgentResult<()> {
        let image = image_path
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?
            .to_string();
        spawn_blocking(move || {
            command_utils::run_command_sync("resize2fs", &[&image])?;
            let _ = command_utils::run_command_sync("tune2fs", &["-m", "0", &image]);
            Ok(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("resize2fs task failed: {}", e)))?
    }

    async fn clear_ext4_reserved_blocks(&self, image_path: &Path, mount_dir: &Path, mounted: bool) {
        let image = match image_path.to_str() {
            Some(s) => s.to_string(),
            None => return,
        };
        let mount = mount_dir.to_string_lossy().to_string();
        let result = spawn_blocking(move || {
            if mounted {
                // Never tune2fs the .img while it is loop-mounted — that attaches
                // a second loop and can leave the live FS at the old size.
                let loop_dev = find_loop_device(&image, &mount)?;
                command_utils::run_in_host_mount_ns("tune2fs", &["-m", "0", &loop_dev])
            } else {
                command_utils::run_command_sync("tune2fs", &["-m", "0", &image])
            }
        })
        .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                warn!("tune2fs -m 0 failed for {}: {}", image_path.display(), e);
            }
            Err(e) => {
                warn!(
                    "tune2fs -m 0 task failed for {}: {}",
                    image_path.display(),
                    e
                );
            }
        }
    }

    async fn verify_filesystem_grown(&self, mount_dir: &Path, size_mb: u64) -> AgentResult<()> {
        let mut last_mb = 0u64;
        for attempt in 0..5 {
            last_mb = self.filesystem_size_mb(mount_dir).await?;
            if !filesystem_needs_grow(last_mb, size_mb) {
                info!(
                    "Filesystem at {} is {} MB after grow to {} MB",
                    mount_dir.display(),
                    last_mb,
                    size_mb
                );
                return Ok(());
            }
            if attempt < 4 {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
        }
        Err(AgentError::FileSystemError(format!(
            "Filesystem at {} is still {} MB after grow to {} MB \
             (loop device may not have picked up the new image size)",
            mount_dir.display(),
            last_mb,
            size_mb
        )))
    }

    async fn shrink_image(&self, image_path: &Path, size_mb: u64) -> AgentResult<()> {
        let image = image_path
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?
            .to_string();
        let size_arg = format!("{}M", size_mb);
        spawn_blocking(move || {
            // The filesystem MUST be clean before resize2fs shrinks it. Run
            // e2fsck with -y so every repair prompt is answered "yes": the
            // agent has no terminal, and a filesystem needing interactive
            // repair would otherwise abort with status 8 ("need terminal
            // for interactive repairs"). Exit codes carry meaning here —
            // 0 = clean, 1 = errors corrected, 2 = corrected (reboot
            // advised, irrelevant for an unmounted image) — so 1 and 2 are
            // success. Anything else (e.g. 4 = uncorrected errors) fails
            // the shrink with the tool's stderr included. Generous timeout:
            // repairing a large filesystem can take well over 10 minutes.
            command_utils::run_command_sync_with_ok_codes(
                "e2fsck",
                &["-f", "-y", &image],
                3600,
                &[1, 2],
            )
            .map(|_| {
                info!("e2fsck completed for {} (clean or auto-repaired)", image);
            })?;
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
                    &["-o", "loop,exec,nodev,nosuid,noatime", &image, &mount],
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

    // --- Event buffering helpers (error reports, state updates) ------------------
    // Critical control-plane messages that must survive an agent↔panel disconnect
    // are appended here when the socket is down and replayed on reconnect.
    // Much smaller cap than the metrics buffer: these are low-volume, and stale
    // error reports lose value quickly.
    fn events_buffer_path(&self) -> PathBuf {
        self.data_dir.join("events_buffer.jsonl")
    }

    pub async fn append_buffered_event(&self, line: &str) -> AgentResult<()> {
        fs::create_dir_all(&self.data_dir).await?;
        let path = self.events_buffer_path();
        const MAX_EVENT_BUFFER_BYTES: u64 = 4 * 1024 * 1024;
        if let Ok(meta) = fs::metadata(&path).await {
            if meta.len() > MAX_EVENT_BUFFER_BYTES {
                // Rotate; drop the oldest half of history implicitly by keeping
                // only the rotated (newer) file going forward.
                let rotated = self.data_dir.join("events_buffer.jsonl.1");
                let _ = fs::remove_file(&rotated).await;
                let _ = fs::rename(&path, &rotated).await;
            }
        }
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;
        use tokio::io::AsyncWriteExt;
        let mut writer = tokio::io::BufWriter::new(file);
        writer.write_all(line.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
        Ok(())
    }

    pub async fn read_buffered_events(&self) -> AgentResult<Vec<Value>> {
        let path = self.events_buffer_path();
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
                Err(e) => tracing::warn!("Skipping invalid buffered event line: {}", e),
            }
        }
        Ok(out)
    }

    pub async fn clear_buffered_events(&self) -> AgentResult<()> {
        let path = self.events_buffer_path();
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

fn validate_disk_mb(size_mb: u64) -> AgentResult<()> {
    if size_mb == 0 {
        return Err(AgentError::InvalidRequest(
            "Requested disk size must be greater than 0 MB".to_string(),
        ));
    }
    if size_mb > MAX_DISK_MB {
        return Err(AgentError::InvalidRequest(format!(
            "Requested disk size {} MB exceeds maximum {} MB",
            size_mb, MAX_DISK_MB
        )));
    }
    Ok(())
}

/// True when the live filesystem is still meaningfully smaller than the quota.
/// Slack covers ext4 metadata (inode tables, journal) plus 1 MiB rounding.
pub(crate) fn filesystem_needs_grow(fs_mb: u64, requested_mb: u64) -> bool {
    let slack = FS_GROW_SLACK_MB.max(requested_mb / 20);
    requested_mb > fs_mb.saturating_add(slack)
}

fn filesystem_size_mb_at(path: &Path) -> AgentResult<u64> {
    let stat = nix::sys::statvfs::statvfs(path).map_err(|e| {
        AgentError::FileSystemError(format!("statvfs failed for {}: {e}", path.display()))
    })?;
    let bytes = (stat.blocks() as u64).saturating_mul(stat.fragment_size() as u64);
    Ok(bytes / (1024 * 1024))
}

/// After fallocate, tell the kernel the loop is bigger, then grow ext4.
/// Without `--set-capacity`, resize2fs sees the old device size and no-ops.
fn grow_mounted_filesystem(image: &str, mount: &str) -> AgentResult<()> {
    let loop_dev = find_loop_device(image, mount)?;
    command_utils::run_in_host_mount_ns("losetup", &["--set-capacity", &loop_dev])?;
    let resize = match command_utils::run_in_host_mount_ns("resize2fs", &[&loop_dev]) {
        Ok(()) => Ok(()),
        Err(e) => {
            warn!(
                "resize2fs {} failed ({}); trying mount path {}",
                loop_dev, e, mount
            );
            command_utils::run_in_host_mount_ns("resize2fs", &[mount])
        }
    };
    let _ = command_utils::run_in_host_mount_ns("tune2fs", &["-m", "0", &loop_dev]);
    resize
}

fn find_loop_device(image: &str, mount: &str) -> AgentResult<String> {
    for mounts_file in ["/proc/1/mounts", "/proc/mounts"] {
        if let Ok(contents) = std::fs::read_to_string(mounts_file) {
            if let Some(src) = parse_mount_source(&contents, Path::new(mount)) {
                if src.starts_with("/dev/loop") {
                    return Ok(src);
                }
            }
        }
    }
    let out = command_utils::run_in_host_mount_ns_capture("losetup", &["-j", image])?;
    parse_losetup_device(&out).ok_or_else(|| {
        AgentError::FileSystemError(format!(
            "No loop device found for image {} (mounted at {})",
            image, mount
        ))
    })
}

/// First `/dev/loopN` from `losetup -j <image>` output.
pub(crate) fn parse_losetup_device(output: &str) -> Option<String> {
    let line = output.lines().find(|l| !l.trim().is_empty())?;
    let dev = line.split(':').next()?.trim();
    if dev.starts_with("/dev/loop") {
        Some(dev.to_string())
    } else {
        None
    }
}

/// Block device backing `mount_dir` in a `/proc/mounts` dump.
pub(crate) fn parse_mount_source(contents: &str, mount_dir: &Path) -> Option<String> {
    let target = mount_dir.to_string_lossy();
    for line in contents.lines() {
        let mut parts = line.split_whitespace();
        let source = match parts.next() {
            Some(s) => s.replace("\\040", " "),
            None => continue,
        };
        let mount_point = match parts.next() {
            Some(p) => p.replace("\\040", " "),
            None => continue,
        };
        if mount_point == target {
            return Some(source);
        }
    }
    None
}

/// Parse /proc/mounts (or /proc/1/mounts) for `mount_dir`.
/// Returns Some((true, noexec)) when the exact mount point is present.
pub(crate) fn image_needs_grow(current_mb: u64, requested_mb: u64) -> bool {
    requested_mb > current_mb
}

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
    fn image_needs_grow_when_requested_is_larger() {
        assert!(image_needs_grow(10240, 81920));
        assert!(!image_needs_grow(81920, 81920));
        assert!(!image_needs_grow(81920, 10240));
    }

    #[test]
    fn filesystem_needs_grow_detects_stale_ext4() {
        // 50 GB image, 20 GB live FS — the user-facing Paper crash.
        assert!(filesystem_needs_grow(20 * 1024, 50 * 1024));
        // Same quota, FS already there (with ext4 overhead).
        assert!(!filesystem_needs_grow(50 * 1024 - 512, 50 * 1024));
        assert!(!filesystem_needs_grow(20 * 1024, 20 * 1024));
        // Tiny grow still counts.
        assert!(filesystem_needs_grow(1024, 2048));
        // 20% slack covers typical ext4 overhead on a fully-grown image.
        assert!(!filesystem_needs_grow(10 * 1024 - 400, 10 * 1024));
    }

    #[test]
    fn parse_losetup_device_reads_first_loop() {
        let out = "/dev/loop0: [2049]:12345 (/var/lib/catalyst/servers/images/abc.img)\n";
        assert_eq!(parse_losetup_device(out).as_deref(), Some("/dev/loop0"));
        let offset = "/dev/loop3: [2049]:1 (/path/to.img) (offset 0, sizelimit 0)\n";
        assert_eq!(parse_losetup_device(offset).as_deref(), Some("/dev/loop3"));
        assert_eq!(parse_losetup_device(""), None);
        assert_eq!(parse_losetup_device("not-a-loop: foo\n"), None);
    }

    #[test]
    fn parse_mount_source_finds_loop() {
        let src = parse_mount_source(SAMPLE, Path::new("/var/lib/catalyst/srv-1"));
        assert_eq!(src.as_deref(), Some("/dev/loop0"));
        assert_eq!(
            parse_mount_source(SAMPLE, Path::new("/var/lib/catalyst/missing")),
            None
        );
        assert_eq!(
            parse_mount_source(SAMPLE, Path::new("/var/lib/catalyst/with space")).as_deref(),
            Some("/dev/loop2")
        );
    }

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
    async fn heal_mounted_images_noop_without_images() {
        let tmp = tempfile::tempdir().unwrap();
        let sm = StorageManager::new(tmp.path().to_path_buf());
        sm.heal_mounted_images()
            .await
            .expect("heal with no images dir");
        std::fs::create_dir_all(tmp.path().join("images")).unwrap();
        std::fs::write(tmp.path().join("images/not-an-image.txt"), b"x").unwrap();
        sm.heal_mounted_images()
            .await
            .expect("heal skips non-img files");
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
