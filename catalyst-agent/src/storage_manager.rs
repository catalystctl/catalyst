use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::task::spawn_blocking;
use tracing::{error, info, warn};

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

        let (mounted, noexec) = self.get_mount_info(mount_dir).await?;
        if mounted {
            // If an older mount still has noexec (from before the fix), remount
            // with exec so game binaries can run from /data.
            if noexec {
                info!(
                    "Remounting {} to remove noexec (game binaries need exec)",
                    mount_dir.display()
                );
                self.remount_exec(mount_dir).await?;
            }
            return Ok(image_path);
        }

        if !image_path.exists() {
            self.create_image(&image_path, size_mb).await?;
        }

        if self.dir_has_data(mount_dir).await? {
            self.migrate_existing_data(server_uuid, mount_dir, &image_path)
                .await?;
        }

        self.mount_image(&image_path, mount_dir).await?;
        Ok(image_path)
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
        let image = image_path.to_path_buf();
        let size = size_mb;
        spawn_blocking(move || -> AgentResult<()> {
            info!("Creating storage image {} ({} MB)", image.display(), size);
            let image_str = image
                .to_str()
                .ok_or_else(|| AgentError::FileSystemError("Invalid image path".to_string()))?;
            run("fallocate", &["-l", &format!("{}M", size), image_str])?;
            run("mkfs.ext4", &["-F", image_str])?;
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
        let src = format!("{}/", mount_dir.display());
        let dst = format!("{}/", migrate_dir.display());
        let result = spawn_blocking(move || {
            run_with_timeout("rsync", &["-a", src.as_str(), dst.as_str()], 3600)
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("rsync task failed: {}", e)))?;
        if let Err(e) = result {
            warn!(
                "Migration rsync failed for {}, cleaning up: {}",
                server_uuid, e
            );
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
                run("fallocate", &["-l", &size_arg, &image])?;
                run("resize2fs", &[&mount])?;
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
            run("fallocate", &["-l", &size_arg, &image])?;
            run("resize2fs", &[&image])?;
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
            run("e2fsck", &["-f", &image])?;
            run("resize2fs", &[&image, &size_arg])?;
            run("fallocate", &["-l", &size_arg, &image])?;
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
        spawn_blocking(move || {
            run("mount", &["-o", "loop,exec,nodev,nosuid", &image, &mount])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Mount task failed: {}", e)))??;
        Ok(())
    }

    async fn unmount(&self, mount_dir: &Path) -> AgentResult<()> {
        let mount = mount_dir
            .to_str()
            .ok_or_else(|| AgentError::FileSystemError("Invalid mount path".to_string()))?
            .to_string();
        spawn_blocking(move || {
            run("umount", &[&mount])?;
            Ok::<(), AgentError>(())
        })
        .await
        .map_err(|e| AgentError::FileSystemError(format!("Unmount task failed: {}", e)))??;
        Ok(())
    }

    /// Returns (is_mounted, has_noexec) by parsing /proc/mounts once.
    async fn get_mount_info(&self, mount_dir: &Path) -> AgentResult<(bool, bool)> {
        let mounts = fs::read_to_string("/proc/mounts").await?;
        let target = mount_dir.to_string_lossy();
        for line in mounts.lines() {
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
                return Ok((true, noexec));
            }
        }
        Ok((false, false))
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
            run("mount", &["-o", "remount,exec", &mount])?;
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

fn run(command: &str, args: &[&str]) -> AgentResult<()> {
    run_with_timeout(command, args, 600)
}

fn run_with_timeout(command: &str, args: &[&str], timeout_secs: u64) -> AgentResult<()> {
    let mut child = std::process::Command::new(command)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AgentError::FileSystemError(format!("Failed to run {}: {}", command, e)))?;

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                return Err(AgentError::FileSystemError(format!(
                    "{} failed with status {}",
                    command, status
                )));
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(AgentError::FileSystemError(format!(
                        "{} timed out after {}s",
                        command, timeout_secs
                    )));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                return Err(AgentError::FileSystemError(format!(
                    "Failed to wait for {}: {}",
                    command, e
                )));
            }
        }
    }
}
