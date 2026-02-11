use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use tokio::fs;
use tracing::{debug, info};

use crate::{AgentError, AgentResult};

const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024; // 100MB

pub struct FileManager {
    data_dir: PathBuf,
}

impl FileManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    /// Validate and resolve a path within the container's data directory
    fn resolve_path(&self, server_id: &str, requested_path: &str) -> AgentResult<PathBuf> {
        if server_id.contains('/') || server_id.contains('\\') {
            return Err(AgentError::InvalidRequest("Invalid server id".to_string()));
        }
        let server_base = self.data_dir.join(server_id);
        let requested = PathBuf::from(requested_path);

        // Prevent directory traversal before resolving.
        if requested
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(AgentError::PermissionDenied(format!(
                "Path traversal attempt detected: {}",
                requested_path
            )));
        }

        let canonical_base = server_base
            .canonicalize()
            .map_err(|_| AgentError::PermissionDenied("Server directory missing".to_string()))?;

        let normalized = if requested.is_absolute() {
            canonical_base.join(requested_path.trim_start_matches('/'))
        } else {
            canonical_base.join(requested_path)
        };

        if normalized.exists() {
            let canonical = normalized.canonicalize().map_err(|_| {
                AgentError::PermissionDenied(format!(
                    "Path traversal attempt detected: {}",
                    requested_path
                ))
            })?;
            if !canonical.starts_with(&canonical_base) {
                return Err(AgentError::PermissionDenied(
                    "Access denied: path outside data directory".to_string(),
                ));
            }
            return Ok(canonical);
        }

        let parent = normalized
            .parent()
            .ok_or_else(|| AgentError::InvalidRequest("Invalid path".to_string()))?;
        if parent.exists() {
            let parent_canon = parent.canonicalize().map_err(|_| {
                AgentError::PermissionDenied("Path traversal attempt detected".to_string())
            })?;
            if !parent_canon.starts_with(&canonical_base) {
                return Err(AgentError::PermissionDenied(
                    "Access denied: path outside data directory".to_string(),
                ));
            }
            let file_name = normalized
                .file_name()
                .ok_or_else(|| AgentError::InvalidRequest("Invalid path".to_string()))?;
            return Ok(parent_canon.join(file_name));
        }

        let relative = normalized.strip_prefix(&canonical_base).map_err(|_| {
            AgentError::PermissionDenied("Access denied: path outside data directory".to_string())
        })?;
        Ok(canonical_base.join(relative))
    }

    /// Resolve a path and ensure its parent directory exists. Used by install-url.
    pub async fn resolve_and_ensure_parent(
        &self,
        server_id: &str,
        path: &str,
    ) -> AgentResult<std::path::PathBuf> {
        let full_path = self.resolve_path(server_id, path)?;
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to create dir: {}", e)))?;
        }
        Ok(full_path)
    }

    pub async fn read_file(&self, server_id: &str, path: &str) -> AgentResult<Vec<u8>> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Reading file: {:?}", full_path);

        // Check file size limit
        let metadata = fs::metadata(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Cannot access file: {}", e)))?;

        if metadata.len() > MAX_FILE_SIZE {
            return Err(AgentError::FileSystemError(format!(
                "File too large: {} > {}MB",
                metadata.len(),
                MAX_FILE_SIZE / 1024 / 1024
            )));
        }

        let content = fs::read(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to read file: {}", e)))?;

        info!(
            "File read successfully: {:?} ({} bytes)",
            full_path,
            content.len()
        );

        Ok(content)
    }

    pub async fn write_file(&self, server_id: &str, path: &str, data: &str) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Writing file: {:?}", full_path);

        // Create parent directories if needed
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to create dir: {}", e)))?;
        }

        // Check size limit before writing
        if data.len() as u64 > MAX_FILE_SIZE {
            return Err(AgentError::FileSystemError(format!(
                "File too large: {} > {}MB",
                data.len(),
                MAX_FILE_SIZE / 1024 / 1024
            )));
        }

        fs::write(&full_path, data.as_bytes())
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to write file: {}", e)))?;

        info!("File written successfully: {:?}", full_path);

        Ok(())
    }

    pub async fn delete_file(&self, server_id: &str, path: &str) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Deleting file: {:?}", full_path);

        if full_path.is_dir() {
            fs::remove_dir_all(&full_path)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to delete: {}", e)))?;
        } else {
            fs::remove_file(&full_path).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to delete file: {}", e))
            })?;
        }

        info!("Deleted successfully: {:?}", full_path);

        Ok(())
    }

    pub async fn rename_file(&self, server_id: &str, from: &str, to: &str) -> AgentResult<()> {
        let from_path = self.resolve_path(server_id, from)?;
        let to_path = self.resolve_path(server_id, to)?;

        debug!("Renaming {:?} -> {:?}", from_path, to_path);

        if let Some(parent) = to_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to create dir: {}", e)))?;
        }

        fs::rename(&from_path, &to_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to rename: {}", e)))?;

        info!("Renamed successfully: {:?} -> {:?}", from_path, to_path);

        Ok(())
    }

    pub async fn list_dir(&self, server_id: &str, path: &str) -> AgentResult<Vec<FileEntry>> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Listing directory: {:?}", full_path);

        let mut entries = Vec::new();
        let mut dir = fs::read_dir(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to read dir: {}", e)))?;

        while let Some(entry) = dir
            .next_entry()
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Error reading dir entry: {}", e)))?
        {
            let metadata = entry.metadata().await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to get metadata: {}", e))
            })?;

            let name = entry.file_name().to_string_lossy().to_string();

            let is_dir = metadata.is_dir();

            entries.push(FileEntry {
                name,
                is_dir,
                size: if is_dir { 0 } else { metadata.len() },
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                    .unwrap_or(0),
                mode: metadata.permissions().mode(),
            });
        }

        info!(
            "Directory listed: {:?} ({} entries)",
            full_path,
            entries.len()
        );

        Ok(entries)
    }

    pub async fn compress_directory(&self, _server_id: &str, _path: &str) -> AgentResult<Vec<u8>> {
        Err(AgentError::InvalidRequest(
            "Directory compression is not supported yet".to_string(),
        ))
    }

    pub async fn decompress_archive(
        &self,
        _server_id: &str,
        _path: &str,
        _archive: &[u8],
    ) -> AgentResult<()> {
        Err(AgentError::InvalidRequest(
            "Archive decompression is not supported yet".to_string(),
        ))
    }

    /// Create a file or directory at the given path.
    pub async fn create_entry(
        &self,
        server_id: &str,
        path: &str,
        is_directory: bool,
        content: &str,
    ) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;
        debug!("Creating entry: {:?} (dir={})", full_path, is_directory);

        if is_directory {
            fs::create_dir_all(&full_path)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to create dir: {}", e)))?;
        } else {
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent).await.map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to create parent dir: {}", e))
                })?;
            }
            fs::write(&full_path, content.as_bytes())
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to create file: {}", e)))?;
        }

        info!("Entry created: {:?}", full_path);
        Ok(())
    }

    /// Write raw bytes to a file (for uploads).
    pub async fn write_file_bytes(
        &self,
        server_id: &str,
        path: &str,
        data: &[u8],
    ) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;
        debug!("Writing bytes to file: {:?} ({} bytes)", full_path, data.len());

        if data.len() as u64 > MAX_FILE_SIZE {
            return Err(AgentError::FileSystemError(format!(
                "File too large: {} > {}MB",
                data.len(),
                MAX_FILE_SIZE / 1024 / 1024
            )));
        }

        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to create dir: {}", e))
            })?;
        }

        fs::write(&full_path, data)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to write file: {}", e)))?;

        info!("File bytes written: {:?} ({} bytes)", full_path, data.len());
        Ok(())
    }

    /// Set file permissions (chmod).
    pub async fn set_permissions(&self, server_id: &str, path: &str, mode: u32) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;
        debug!("Setting permissions on {:?} to {:o}", full_path, mode);

        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(mode);
        fs::set_permissions(&full_path, permissions)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to chmod: {}", e)))?;

        info!("Permissions set: {:?} -> {:o}", full_path, mode);
        Ok(())
    }

    /// Compress files into an archive (tar.gz or zip).
    pub async fn compress_files(
        &self,
        server_id: &str,
        archive_path: &str,
        source_paths: &[String],
    ) -> AgentResult<()> {
        let archive_full = self.resolve_path(server_id, archive_path)?;
        let server_base = self.data_dir.join(server_id);
        let canonical_base = server_base
            .canonicalize()
            .map_err(|_| AgentError::PermissionDenied("Server directory missing".to_string()))?;

        debug!("Compressing to {:?}", archive_full);

        if let Some(parent) = archive_full.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Failed to create dir: {}", e)))?;
        }

        // Resolve each source path relative to server base
        let mut relative_paths = Vec::new();
        for src in source_paths {
            let resolved = self.resolve_path(server_id, src)?;
            let rel = resolved
                .strip_prefix(&canonical_base)
                .map_err(|_| AgentError::PermissionDenied("Path outside server dir".to_string()))?;
            relative_paths.push(rel.to_string_lossy().to_string());
        }

        let archive_lower = archive_path.to_lowercase();
        if archive_lower.ends_with(".zip") {
            let output = tokio::process::Command::new("zip")
                .args(["-r", &archive_full.to_string_lossy()])
                .args(&relative_paths)
                .current_dir(&canonical_base)
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("zip failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AgentError::FileSystemError(format!("zip error: {}", stderr)));
            }
        } else {
            let output = tokio::process::Command::new("tar")
                .args(["-czf", &archive_full.to_string_lossy(), "-C", &canonical_base.to_string_lossy()])
                .args(&relative_paths)
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("tar failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AgentError::FileSystemError(format!("tar error: {}", stderr)));
            }
        }

        info!("Archive created: {:?}", archive_full);
        Ok(())
    }

    /// Decompress an archive to a target directory.
    pub async fn decompress_to(
        &self,
        server_id: &str,
        archive_path: &str,
        target_path: &str,
    ) -> AgentResult<()> {
        let archive_full = self.resolve_path(server_id, archive_path)?;
        let target_full = self.resolve_path(server_id, target_path)?;

        debug!("Decompressing {:?} to {:?}", archive_full, target_full);

        fs::create_dir_all(&target_full)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to create target dir: {}", e)))?;

        let archive_lower = archive_path.to_lowercase();
        if archive_lower.ends_with(".zip") {
            let output = tokio::process::Command::new("unzip")
                .args(["-o", &archive_full.to_string_lossy(), "-d", &target_full.to_string_lossy()])
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("unzip failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AgentError::FileSystemError(format!("unzip error: {}", stderr)));
            }
        } else {
            let output = tokio::process::Command::new("tar")
                .args(["-xzf", &archive_full.to_string_lossy(), "-C", &target_full.to_string_lossy()])
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("tar extract failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AgentError::FileSystemError(format!("tar error: {}", stderr)));
            }
        }

        info!("Archive decompressed: {:?} -> {:?}", archive_full, target_full);
        Ok(())
    }

    /// List contents of an archive without extracting.
    pub async fn list_archive_contents(
        &self,
        server_id: &str,
        archive_path: &str,
    ) -> AgentResult<Vec<ArchiveEntry>> {
        let archive_full = self.resolve_path(server_id, archive_path)?;
        debug!("Listing archive contents: {:?}", archive_full);

        let archive_lower = archive_path.to_lowercase();
        let mut entries = Vec::new();

        if archive_lower.ends_with(".zip") {
            let output = tokio::process::Command::new("unzip")
                .args(["-Z", "-l", &archive_full.to_string_lossy()])
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("unzip -Z failed: {}", e)))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                // zipinfo -l format: perms version os size type csize method date time name
                let parts: Vec<&str> = line.splitn(10, char::is_whitespace).filter(|s| !s.is_empty()).collect();
                if parts.len() < 9 { continue; }
                let is_dir = parts[0].starts_with('d') || parts[8].ends_with('/');
                let name = parts[8].trim_end_matches('/').to_string();
                if name.is_empty() || name == "." || name.starts_with("..") { continue; }
                let size: u64 = parts[3].parse().unwrap_or(0);
                entries.push(ArchiveEntry { name, size, is_dir, modified: None });
            }
        } else if archive_lower.ends_with(".tar.gz") || archive_lower.ends_with(".tgz") {
            let output = tokio::process::Command::new("tar")
                .args(["-tzvf", &archive_full.to_string_lossy()])
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("tar -t failed: {}", e)))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                // tar -tzvf format: drwxr-xr-x user/group  0 2024-01-01 00:00 path/to/dir/
                let parts: Vec<&str> = line.splitn(6, char::is_whitespace).filter(|s| !s.is_empty()).collect();
                if parts.len() < 6 { continue; }
                let is_dir = parts[0].starts_with('d') || parts[5].ends_with('/');
                let name = parts[5].trim_end_matches('/').to_string();
                if name.is_empty() || name == "." || name.starts_with("..") { continue; }
                let size: u64 = parts[2].parse().unwrap_or(0);
                let modified = if parts.len() >= 5 {
                    Some(format!("{}T{}:00Z", parts[3], parts[4]))
                } else {
                    None
                };
                entries.push(ArchiveEntry { name, size, is_dir, modified });
            }
        } else {
            return Err(AgentError::InvalidRequest("Unsupported archive type".to_string()));
        }

        info!("Archive contents listed: {:?} ({} entries)", archive_full, entries.len());
        Ok(entries)
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
    pub mode: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: Option<String>,
}
