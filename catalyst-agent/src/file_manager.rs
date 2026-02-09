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
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}
