//! Backup creation, restoration, upload, and download handlers.

use super::*;

/// Fsync every regular file under `dir` (non-recursive into other mounts) so
/// this server's dirty pages reach disk before archiving. Scoped replacement
/// for the node-wide `sync` previously run before every backup.
async fn sync_dir_tree(dir: &Path) -> std::io::Result<()> {
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&current).await?;
        while let Some(entry) = entries.next_entry().await? {
            let entry_path = entry.path();
            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                stack.push(entry_path);
            } else if file_type.is_file() {
                if let Ok(f) = tokio::fs::File::open(&entry_path).await {
                    let _ = f.sync_data().await;
                }
            }
        }
    }
    Ok(())
}

impl WebSocketHandler {
    pub(crate) async fn cleanup_all_uploads(&self) {
        let sessions: Vec<BackupUploadSession> = {
            let mut uploads = self.active_uploads.write().await;
            uploads.drain().map(|(_, session)| session).collect()
        };

        for session in sessions {
            let path = session.path.clone();
            drop(session.file);
            let _ = tokio::fs::remove_file(&path).await;
        }
    }

    pub(crate) async fn cleanup_stale_uploads(&self) {
        let now = tokio::time::Instant::now();
        let sessions: Vec<BackupUploadSession> = {
            let mut uploads = self.active_uploads.write().await;
            let stale_keys: Vec<String> = uploads
                .iter()
                .filter(|(_, session)| {
                    now.duration_since(session.last_activity) > BACKUP_UPLOAD_INACTIVITY_TIMEOUT
                })
                .map(|(key, _)| key.clone())
                .collect();

            stale_keys
                .into_iter()
                .filter_map(|key| uploads.remove(&key))
                .collect()
        };

        for session in sessions {
            let path = session.path.clone();
            drop(session.file);
            let _ = tokio::fs::remove_file(&path).await;
        }
    }

    pub(crate) async fn handle_create_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;
        let backup_name = msg["backupName"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupName".to_string()))?;
        let backup_path_override = msg["backupPath"].as_str();
        let backup_id = msg["backupId"].as_str();

        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        if let Some(provided) = msg["serverDir"].as_str() {
            let derived = server_dir.to_string_lossy();
            if provided != derived {
                warn!(
                    "Ignoring backend-provided serverDir for {}: '{}' (using '{}')",
                    server_uuid, provided, derived
                );
            }
        }
        let backup_path = match backup_path_override {
            Some(path) => self.resolve_backup_path(server_uuid, path, true).await?,
            None => {
                let filename = format!("{}.tar.gz", backup_name);
                self.resolve_backup_path(server_uuid, &filename, true)
                    .await?
            }
        };
        let backup_dir = backup_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.backup_base_dir(server_uuid));

        if !server_dir.exists() {
            return Err(AgentError::NotFound(format!(
                "Server directory not found: {}",
                server_dir.display()
            )));
        }

        tokio::fs::create_dir_all(&backup_dir).await?;

        info!(
            "Creating backup {} for server {} at {}",
            backup_name,
            server_id,
            backup_path.display()
        );

        // Best-effort quiesce: warn if the server container is running (live backup),
        // then fsync the server's own directory tree so its dirty pages hit disk
        // before tar. A node-wide `sync` (the previous approach) flushed every
        // filesystem on the host at once, converting all servers' accumulated
        // dirty pages into a synchronized writeback storm that stalled every
        // game server on the node.
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if !container_id.is_empty() {
            match self.runtime.is_container_running(&container_id).await {
                Ok(true) => {
                    warn!(
                        "Creating backup while container {} is running — archive may be inconsistent",
                        container_id
                    );
                }
                Ok(false) => {}
                Err(e) => {
                    warn!(
                        "Could not check container running state before backup {}: {}",
                        container_id, e
                    );
                }
            }
        }
        match sync_dir_tree(&server_dir).await {
            Ok(()) => {
                debug!(
                    "server directory fsync completed before tar for backup {}",
                    backup_name
                );
            }
            Err(e) => {
                warn!(
                    "fsync of server directory before backup {} failed; continuing: {}",
                    backup_name, e
                );
            }
        }
        // Best-effort: fsync the server directory metadata so directory entries are durable.
        if let Ok(dir) = std::fs::File::open(&server_dir) {
            let _ = dir.sync_all();
        }

        let archive_result = tokio::process::Command::new("tar")
            .arg("-czf")
            .arg(&backup_path)
            .arg("-C")
            .arg(&server_dir)
            .arg(".")
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run tar: {}", e)))?;

        if !archive_result.status.success() {
            let stderr = String::from_utf8_lossy(&archive_result.stderr);
            return Err(AgentError::IoError(format!(
                "Backup archive failed: {}",
                stderr
            )));
        }

        // Optionally encrypt the backup if an encryption key is provided
        let encrypted = if let Some(enc_key_b64) = msg.get("encryptionKey").and_then(|v| v.as_str())
        {
            // Wrap the decoded key in Zeroizing so it is cleared from memory
            // on drop, preventing persistence in memory/swap/core dumps (UF-09/14).
            let key = zeroize::Zeroizing::new(
                base64::engine::general_purpose::STANDARD
                    .decode(enc_key_b64)
                    .map_err(|e| {
                        AgentError::InvalidRequest(format!("Invalid encryption key: {}", e))
                    })?,
            );
            let raw = tokio::fs::read(&backup_path).await?;
            match backup_crypto::encrypt_backup(&raw, &key) {
                Ok(encrypted_data) => {
                    tokio::fs::write(&backup_path, &encrypted_data).await?;
                    info!("Backup {} encrypted successfully", backup_name);
                    true
                }
                Err(e) => {
                    // Encryption failure should not destroy the unencrypted backup
                    warn!("Backup encryption failed for {}: {}", backup_name, e);
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:backup_encrypt",
                        &format!("Backup encryption failed for {}: {}", backup_name, e),
                        None,
                        None,
                    )
                    .await;
                    false
                }
            }
        } else {
            false
        };

        // Compute checksum on the FINAL on-disk file (after encryption if applicable)
        let mut file = tokio::fs::File::open(&backup_path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        loop {
            let read = file.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        let checksum = hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>();

        let final_metadata = tokio::fs::metadata(&backup_path).await?;
        let final_size_mb = final_metadata.len() as f64 / (1024.0 * 1024.0);

        let event = json!({
            "type": "backup_complete",
            "serverId": server_id,
            "backupName": backup_name,
            "backupPath": backup_path.to_string_lossy(),
            "sizeMb": final_size_mb,
            "checksum": checksum,
            "backupId": backup_id,
            "encrypted": encrypted,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    pub(crate) async fn handle_restore_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        if let Some(provided) = msg["serverDir"].as_str() {
            let derived = server_dir.to_string_lossy();
            if provided != derived {
                warn!(
                    "Ignoring backend-provided serverDir for {}: '{}' (using '{}')",
                    server_uuid, provided, derived
                );
            }
        }
        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;

        if !backup_file.exists() {
            return Err(AgentError::NotFound(format!(
                "Backup file not found: {}",
                backup_file.display()
            )));
        }

        // Determine the actual file to extract from (may be decrypted to a temp file)
        let actual_backup_file;
        let cleanup_temp;
        if let Some(enc_key_b64) = msg.get("encryptionKey").and_then(|v| v.as_str()) {
            // Wrap the decoded key in Zeroizing so it is cleared from memory
            // on drop, preventing persistence in memory/swap/core dumps (UF-09/14).
            let key = zeroize::Zeroizing::new(
                base64::engine::general_purpose::STANDARD
                    .decode(enc_key_b64)
                    .map_err(|e| {
                        AgentError::InvalidRequest(format!("Invalid encryption key: {}", e))
                    })?,
            );
            let raw = tokio::fs::read(&backup_file).await?;
            let decrypted = backup_crypto::decrypt_backup(&raw, &key).map_err(|e| {
                AgentError::InvalidRequest(format!("Backup decryption failed: {}", e))
            })?;
            let tmp_path = backup_file.with_extension("tar.gz.decrypting");
            tokio::fs::write(&tmp_path, &decrypted).await?;
            info!("Backup decrypted successfully for restore");
            actual_backup_file = tmp_path.clone();
            cleanup_temp = Some(tmp_path);
        } else {
            actual_backup_file = backup_file.clone();
            cleanup_temp = None;
        }

        // Decompression bomb protection: reject oversized backup files
        const MAX_LOCAL_BACKUP_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10 GB
        let backup_metadata = tokio::fs::metadata(&actual_backup_file)
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to read backup metadata: {}", e)))?;
        if backup_metadata.len() > MAX_LOCAL_BACKUP_BYTES {
            if let Some(ref tmp) = cleanup_temp {
                let _ = tokio::fs::remove_file(tmp).await;
            }
            return Err(AgentError::InvalidRequest(format!(
                "Backup file too large ({} bytes, max {} bytes)",
                backup_metadata.len(),
                MAX_LOCAL_BACKUP_BYTES
            )));
        }

        // Extract to a temporary directory first so symlink validation happens
        // BEFORE any data touches the live server directory.
        let tmp_dir = server_dir.with_extension("tmp_restore");
        tokio::fs::create_dir_all(&tmp_dir).await?;

        info!(
            "Restoring backup {} for server {} into temp dir {}",
            backup_file.display(),
            server_id,
            tmp_dir.display()
        );

        let restore_result = tokio::process::Command::new("tar")
            .arg("-xzf")
            .arg(&actual_backup_file)
            .arg("-C")
            .arg(&tmp_dir)
            // SECURITY: extract as agent-controlled, not archive-controlled —
            // never restore archive-supplied ownership/permissions/special
            // files (root tar otherwise honors --same-owner and suid bits).
            .arg("--no-same-owner")
            .arg("--no-same-permissions")
            .arg("--no-devices")
            .output()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to run tar: {}", e)))?;

        if !restore_result.status.success() {
            let stderr = String::from_utf8_lossy(&restore_result.stderr);
            // Clean up temp extraction dir on failure (server_dir is untouched)
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            // Clean up temp decrypted file
            if let Some(ref tmp) = cleanup_temp {
                let _ = tokio::fs::remove_file(tmp).await;
            }
            return Err(AgentError::IoError(format!(
                "Backup restore failed: {}",
                stderr
            )));
        }

        // Clean up temp decrypted file after successful extraction
        if let Some(ref tmp) = cleanup_temp {
            let _ = tokio::fs::remove_file(tmp).await;
        }

        // Security: validate that no symlinks in the restored archive escape the
        // server directory.  This prevents a malicious backup from planting symlinks
        // that point to host paths like /etc/shadow or /var/lib/catalyst.
        let canonical_tmp = tokio::fs::canonicalize(&tmp_dir)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Cannot resolve temp dir: {}", e)))?;
        let mut dangerous_symlinks = Vec::new();
        self.check_restore_symlinks(&tmp_dir, &canonical_tmp, &mut dangerous_symlinks)
            .await?;
        if !dangerous_symlinks.is_empty() {
            for symlink in &dangerous_symlinks {
                warn!("Dangerous symlink in restored backup: {}", symlink);
            }
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            return Err(AgentError::SecurityViolation(format!(
                "Backup contains {} symlink(s) that escape the server directory. \
                 Restore aborted and temp directory cleaned up for security.",
                dangerous_symlinks.len()
            )));
        }

        // Validation passed — swap restored data into place. On a systemd
        // loop-mount this copies onto the image then swaps children; it never
        // remove_dir_all + rename over the live mount.
        self.storage_manager
            .replace_directory_contents(&server_dir, &tmp_dir)
            .await?;

        // Ensure restored data is owned by container user
        if let Err(e) = chown_to_container_user(&server_dir).await {
            warn!("Failed to chown restored server directory: {}", e);
        }

        let backup_id = msg["backupId"].as_str();
        let event = if let Some(id) = backup_id {
            json!({
                "type": "backup_restore_complete",
                "serverId": server_id,
                "backupPath": backup_path,
                "backupId": id,
            })
        } else {
            json!({
                "type": "backup_restore_complete",
                "serverId": server_id,
                "backupPath": backup_path,
            })
        };

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    pub(crate) async fn check_restore_symlinks(
        &self,
        dir: &std::path::Path,
        canonical_base: &std::path::Path,
        dangerous: &mut Vec<String>,
    ) -> AgentResult<()> {
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            let mut entries = tokio::fs::read_dir(&current)
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Cannot read dir: {}", e)))?;
            while let Some(entry) = entries
                .next_entry()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Error reading entry: {}", e)))?
            {
                let path = entry.path();
                match entry.file_type().await {
                    Ok(ft) if ft.is_symlink() => {
                        if let Ok(target) = tokio::fs::read_link(&path).await {
                            let parent = path.parent().unwrap_or(&current);
                            let resolved = parent.join(&target);
                            let is_dangerous =
                                if let Ok(canon) = tokio::fs::canonicalize(&resolved).await {
                                    !canon.starts_with(canonical_base)
                                } else if resolved.is_absolute() {
                                    !resolved.starts_with(canonical_base)
                                } else {
                                    false
                                };
                            if is_dangerous {
                                dangerous.push(format!(
                                    "{} -> {}",
                                    path.display(),
                                    target.display()
                                ));
                            }
                        }
                    }
                    Ok(ft) if ft.is_dir() => {
                        stack.push(path);
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    pub(crate) async fn handle_delete_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;
        if backup_file.exists() {
            tokio::fs::remove_file(&backup_file).await?;
        }

        let event = json!({
            "type": "backup_delete_complete",
            "serverId": server_id,
            "backupPath": backup_path,
        });

        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;

        Ok(())
    }

    pub(crate) async fn handle_download_backup_start(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;
        if !backup_file.exists() {
            let event = json!({
                "type": "backup_download_response",
                "requestId": request_id,
                "serverId": server_id,
                "success": false,
                "error": "Backup file not found",
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let event = json!({
            "type": "backup_download_response",
            "requestId": request_id,
            "serverId": server_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    pub(crate) async fn handle_download_backup(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or(server_id);

        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, false)
            .await?;
        if !backup_file.exists() {
            let event = json!({
                "type": "backup_download_chunk",
                "requestId": request_id,
                "serverId": server_id,
                "error": "Backup file not found",
                "done": true,
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let mut file = match tokio::fs::File::open(&backup_file).await {
            Ok(file) => file,
            Err(err) => {
                let event = json!({
                    "type": "backup_download_chunk",
                    "requestId": request_id,
                    "serverId": server_id,
                    "error": format!("Failed to open backup file: {}", err),
                    "done": true,
                });
                let mut w = write.lock().await;
                w.send(Message::Text(event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                return Ok(());
            }
        };
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let read = match file.read(&mut buffer).await {
                Ok(read) => read,
                Err(err) => {
                    let event = json!({
                        "type": "backup_download_chunk",
                        "requestId": request_id,
                        "serverId": server_id,
                        "error": format!("Failed to read backup file: {}", err),
                        "done": true,
                    });
                    let mut w = write.lock().await;
                    w.send(Message::Text(event.to_string().into()))
                        .await
                        .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                    break;
                }
            };
            if read == 0 {
                let done_event = json!({
                    "type": "backup_download_chunk",
                    "requestId": request_id,
                    "serverId": server_id,
                    "done": true,
                });
                let mut w = write.lock().await;
                w.send(Message::Text(done_event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                break;
            }

            let chunk = base64::engine::general_purpose::STANDARD.encode(&buffer[..read]);
            let event = json!({
                "type": "backup_download_chunk",
                "requestId": request_id,
                "serverId": server_id,
                "data": chunk,
                "done": false,
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        }

        Ok(())
    }

    pub(crate) async fn handle_upload_backup_start(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;

        // UF-16: Require cryptographically random request IDs to prevent
        // session injection. The requestId is used as a lookup key, so a
        // predictable ID allows any WS connection to inject chunks into
        // any session. Enforce minimum entropy by requiring sufficient length
        // and hex-like characters.
        if request_id.len() < 32 {
            return Err(AgentError::SecurityViolation(
                "Upload requestId must be at least 32 characters to prevent session injection"
                    .to_string(),
            ));
        }
        let backup_path = msg["backupPath"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing backupPath".to_string()))?;
        let server_uuid = msg
            .get("serverUuid")
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| msg["serverId"].as_str().unwrap_or("unknown"));
        let backup_file = self
            .resolve_backup_path(server_uuid, backup_path, true)
            .await?;
        let file = match tokio::fs::File::create(&backup_file).await {
            Ok(f) => f,
            Err(e) => {
                let event = json!({
                    "type": "backup_upload_response",
                    "requestId": request_id,
                    "success": false,
                    "error": format!("Failed to create upload file: {}", e),
                });
                let mut w = write.lock().await;
                w.send(Message::Text(event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                return Ok(());
            }
        };

        let session = BackupUploadSession {
            file,
            path: backup_file.clone(),
            bytes_written: 0,
            last_activity: tokio::time::Instant::now(),
        };

        let old_session = {
            let mut uploads = self.active_uploads.write().await;
            let old = uploads.remove(request_id);
            uploads.insert(request_id.to_string(), session);
            old
        };
        if let Some(old) = old_session {
            let path = old.path.clone();
            drop(old.file);
            let _ = tokio::fs::remove_file(&path).await;
        }

        let event = json!({
            "type": "backup_upload_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    pub(crate) async fn handle_upload_backup_chunk(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let data = msg["data"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing data".to_string()))?;
        let chunk = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| AgentError::InvalidRequest("Invalid chunk data".to_string()))?;

        // Check size limit under the map lock, then write via a cloned file
        // handle OUTSIDE the lock: holding the map write-lock across the disk
        // write serialized every upload session (and the stale-upload GC /
        // disconnect cleanup) behind one slow write. Chunks of one request are
        // processed sequentially by the WS read loop, so ordering is preserved.
        let chunk_len = chunk.len() as u64;
        enum ChunkError {
            WriteFailed(String),
            UnknownRequest,
        }
        let (write_target, current_len) = {
            let uploads = self.active_uploads.read().await;
            match uploads.get(request_id) {
                Some(session) => {
                    let next_total = session.bytes_written.saturating_add(chunk_len);
                    if next_total > MAX_BACKUP_UPLOAD_BYTES {
                        return Err(AgentError::InvalidRequest(format!(
                            "Upload too large (max {} bytes)",
                            MAX_BACKUP_UPLOAD_BYTES
                        )));
                    }
                    match session.file.try_clone().await {
                        Ok(f) => (Some(f), session.bytes_written),
                        Err(e) => {
                            return Err(AgentError::IoError(format!(
                                "Failed to clone upload handle: {}",
                                e
                            )))
                        }
                    }
                }
                None => (None, 0),
            }
        };
        let write_result: Result<(), ChunkError> = match write_target {
            Some(mut f) => {
                if let Err(e) = f.write_all(&chunk).await {
                    Err(ChunkError::WriteFailed(format!("Write failed: {}", e)))
                } else {
                    let mut uploads = self.active_uploads.write().await;
                    if let Some(session) = uploads.get_mut(request_id) {
                        session.bytes_written = current_len + chunk_len;
                        session.last_activity = tokio::time::Instant::now();
                    }
                    Ok(())
                }
            }
            None => Err(ChunkError::UnknownRequest),
        };

        // On fatal errors, remove the session and clean up the file on disk.
        if let Err(ref err) = write_result {
            let path_to_clean = match err {
                ChunkError::WriteFailed(_) => {
                    let mut uploads = self.active_uploads.write().await;
                    uploads.remove(request_id).map(|s| s.path)
                }
                ChunkError::UnknownRequest => None,
            };
            if let Some(path) = path_to_clean {
                let _ = tokio::fs::remove_file(&path).await;
            }
        }

        if let Err(err) = write_result {
            let error_msg = match &err {
                ChunkError::WriteFailed(msg) => msg.as_str(),
                ChunkError::UnknownRequest => "Unknown upload request",
            };
            let event = json!({
                "type": "backup_upload_chunk_response",
                "requestId": request_id,
                "success": false,
                "error": error_msg,
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let event = json!({
            "type": "backup_upload_chunk_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    pub(crate) async fn handle_upload_backup_chunk_binary(
        &self,
        request_id: &str,
        data: &[u8],
    ) -> AgentResult<()> {
        if data.is_empty() {
            return Ok(());
        }

        // Resolve full session key. Callers may pass either a full requestId
        // (length-prefixed v2 frames) or a legacy 16-byte UUID prefix.
        let resolved_id = {
            let uploads = self.active_uploads.read().await;
            resolve_backup_upload_request_id(request_id, uploads.keys().map(|k| k.as_str()))
        };

        // Check size limit under the map lock, then write via a cloned handle
        // OUTSIDE the lock (see JSON chunk path above for the rationale).
        let data_len = data.len() as u64;
        let (write_target, current_len) = {
            let uploads = self.active_uploads.read().await;
            match uploads.get(&resolved_id) {
                Some(session) => {
                    let next_total = session.bytes_written.saturating_add(data_len);
                    if next_total > MAX_BACKUP_UPLOAD_BYTES {
                        return Err(AgentError::InvalidRequest(format!(
                            "Upload too large (max {} bytes)",
                            MAX_BACKUP_UPLOAD_BYTES
                        )));
                    }
                    match session.file.try_clone().await {
                        Ok(f) => (Some(f), session.bytes_written),
                        Err(e) => {
                            return Err(AgentError::IoError(format!(
                                "Failed to clone upload handle: {}",
                                e
                            )))
                        }
                    }
                }
                None => (None, 0),
            }
        };
        let write_result: Result<(), AgentError> = match write_target {
            Some(mut f) => {
                if let Err(e) = f.write_all(data).await {
                    Err(AgentError::IoError(format!(
                        "Failed to write backup chunk: {}",
                        e
                    )))
                } else {
                    let mut uploads = self.active_uploads.write().await;
                    if let Some(session) = uploads.get_mut(&resolved_id) {
                        session.bytes_written = current_len + data_len;
                        session.last_activity = tokio::time::Instant::now();
                    }
                    Ok(())
                }
            }
            None => Err(AgentError::InvalidRequest(
                "Unknown upload request".to_string(),
            )),
        };

        // On fatal errors, remove the session and clean up the file on disk.
        if let Err(ref err) = write_result {
            let path_to_clean = {
                let mut uploads = self.active_uploads.write().await;
                uploads.remove(&resolved_id).map(|s| s.path)
            };
            if let Some(path) = path_to_clean {
                let _ = tokio::fs::remove_file(&path).await;
            }
            return Err(match err {
                AgentError::InvalidRequest(msg) => AgentError::InvalidRequest(msg.clone()),
                AgentError::IoError(msg) => AgentError::IoError(msg.clone()),
                other => AgentError::InvalidRequest(other.to_string()),
            });
        }

        write_result
    }

    pub(crate) async fn handle_upload_backup_complete(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let session = {
            let mut uploads = self.active_uploads.write().await;
            uploads.remove(request_id)
        };

        let bytes_received: u64;
        if let Some(mut s) = session {
            bytes_received = s.bytes_written;
            if let Err(e) = s.file.flush().await {
                let path = s.path.clone();
                drop(s);
                let _ = tokio::fs::remove_file(&path).await;
                let event = json!({
                    "type": "backup_upload_response",
                    "requestId": request_id,
                    "success": false,
                    "error": format!("Flush failed: {}", e),
                    "bytesReceived": bytes_received,
                });
                let mut w = write.lock().await;
                w.send(Message::Text(event.to_string().into()))
                    .await
                    .map_err(|e| AgentError::NetworkError(e.to_string()))?;
                return Ok(());
            }
        } else {
            let event = json!({
                "type": "backup_upload_response",
                "requestId": request_id,
                "success": false,
                "error": "Unknown upload request",
                "bytesReceived": 0u64,
            });
            let mut w = write.lock().await;
            w.send(Message::Text(event.to_string().into()))
                .await
                .map_err(|e| AgentError::NetworkError(e.to_string()))?;
            return Ok(());
        }

        let event = json!({
            "type": "backup_upload_response",
            "requestId": request_id,
            "success": true,
            "bytesReceived": bytes_received,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    pub(crate) fn backup_base_dir(&self, server_uuid: &str) -> PathBuf {
        self.config
            .server
            .data_dir
            .join("backups")
            .join(server_uuid)
    }

    pub(crate) async fn resolve_backup_path(
        &self,
        server_uuid: &str,
        requested_path: &str,
        allow_create: bool,
    ) -> AgentResult<PathBuf> {
        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let base_dir = self.backup_base_dir(server_uuid);
        if allow_create {
            tokio::fs::create_dir_all(&base_dir).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to create backup directory: {}", e))
            })?;
        }

        let requested = PathBuf::from(requested_path);
        if requested
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(AgentError::InvalidRequest(
                "Invalid backup path".to_string(),
            ));
        }

        let normalized = if requested.is_absolute() {
            // Backend sends absolute paths (e.g. /var/lib/catalyst/backups/<uuid>/file.tar.gz)
            // but we store backups under data_dir/backups/<uuid>/. Extract just the filename.
            let filename = requested
                .file_name()
                .ok_or_else(|| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
            base_dir.join(filename)
        } else {
            base_dir.join(&requested)
        };

        let parent = normalized
            .parent()
            .ok_or_else(|| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
        if allow_create {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to create backup directory: {}", e))
            })?;
        }

        let base_canon = tokio::fs::canonicalize(&base_dir)
            .await
            .map_err(|_| AgentError::FileSystemError("Backup directory missing".to_string()))?;
        let parent_canon = tokio::fs::canonicalize(&parent)
            .await
            .map_err(|_| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
        if !parent_canon.starts_with(&base_canon) {
            return Err(AgentError::PermissionDenied(
                "Access denied: path outside backup directory".to_string(),
            ));
        }

        let file_name = normalized
            .file_name()
            .ok_or_else(|| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
        let candidate = parent_canon.join(file_name);
        if candidate.exists() {
            let canonical = candidate
                .canonicalize()
                .map_err(|_| AgentError::InvalidRequest("Invalid backup path".to_string()))?;
            if !canonical.starts_with(&base_canon) {
                return Err(AgentError::PermissionDenied(
                    "Access denied: path outside backup directory".to_string(),
                ));
            }
            return Ok(canonical);
        }

        Ok(candidate)
    }

    pub(crate) async fn handle_start_backup_stream(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);

        if !server_dir.exists() {
            return Err(AgentError::NotFound(format!(
                "Server directory not found: {}",
                server_dir.display()
            )));
        }

        info!(
            "Starting backup stream for {} from {}",
            server_uuid,
            server_dir.display()
        );

        let mut child = tokio::process::Command::new("tar")
            .arg("-cf")
            .arg("-")
            .arg("-C")
            .arg(&server_dir)
            .arg(".")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to spawn tar: {}", e)))?;

        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::IoError("Failed to capture tar stdout".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AgentError::IoError("Failed to capture tar stderr".to_string()))?;

        // Read stderr in background to avoid deadlock
        let stderr_task = tokio::spawn(async move {
            let mut stderr = stderr;
            let mut buf = Vec::new();
            use tokio::io::AsyncReadExt;
            let _ = stderr.read_to_end(&mut buf).await;
            buf
        });

        let mut buf = vec![0u8; 64 * 1024]; // 64 KB read buffer
        let mut chunk_count: u64 = 0;

        // NOTE: the sink mutex is intentionally taken per-chunk rather than held
        // across the whole stream. Holding it here used to block every
        // control-plane message (power commands, acks, heartbeats) behind an
        // entire multi-GB tar transfer.
        loop {
            use tokio::io::AsyncReadExt;
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    chunk_count += 1;
                    let sent = {
                        let mut w = write.lock().await;
                        tokio::time::timeout(
                            WS_SEND_TIMEOUT,
                            w.send(Message::Binary(buf[..n].to_vec().into())),
                        )
                        .await
                    };
                    if !matches!(sent, Ok(Ok(()))) {
                        child.kill().await.ok();
                        return Err(AgentError::NetworkError(
                            "Failed to send backup chunk".to_string(),
                        ));
                    }
                    // Yield occasionally so other tasks (control messages, event
                    // monitor) stay responsive during long transfers.
                    if chunk_count.is_multiple_of(16) {
                        tokio::task::yield_now().await;
                    }
                }
                Err(e) => {
                    child.kill().await.ok();
                    return Err(AgentError::IoError(format!(
                        "Failed to read tar output: {}",
                        e
                    )));
                }
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to wait for tar: {}", e)))?;

        let stderr_bytes = stderr_task.await.unwrap_or_default();

        if !status.success() {
            let code = status.code().unwrap_or(-1);
            return Err(AgentError::IoError(format!(
                "tar exited with code {}: {}",
                code,
                String::from_utf8_lossy(&stderr_bytes)
            )));
        }

        info!("Backup stream complete for {}", server_uuid);

        // Send completion signal as text frame
        let event = json!({
            "type": "backup_stream_complete",
            "requestId": request_id,
            "serverId": msg["serverId"],
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    pub(crate) async fn handle_prepare_restore_stream(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);

        if let Some(provided) = msg["serverDir"].as_str() {
            let derived = server_dir.to_string_lossy();
            if provided != derived {
                warn!(
                    "Ignoring backend-provided serverDir for {}: '{}' (using '{}')",
                    server_uuid, provided, derived
                );
            }
        }

        // Extract into a temp directory first (same pattern as non-streaming restore)
        // so symlink validation can run before live server_dir is replaced.
        let tmp_dir = server_dir.with_extension("tmp_restore_stream");
        if tmp_dir.exists() {
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
        }
        tokio::fs::create_dir_all(&tmp_dir).await.map_err(|e| {
            AgentError::IoError(format!("Failed to create temp restore directory: {}", e))
        })?;

        info!(
            "Preparing restore stream for {} into temp dir {}",
            server_uuid,
            tmp_dir.display()
        );

        // Spawn tar with stdin piped. stdin stays in the Child so
        // write_restore_stream_chunk can access it via child.stdin.as_mut().
        // SECURITY: same hardening flags as the non-streaming restore —
        // never honor archive-supplied ownership/permissions/special files
        // during root extraction.
        let child = tokio::process::Command::new("tar")
            .arg("-xf")
            .arg("-")
            .arg("-C")
            .arg(&tmp_dir)
            .arg("--no-same-owner")
            .arg("--no-same-permissions")
            .arg("--no-devices")
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| AgentError::IoError(format!("Failed to spawn tar: {}", e)))?;

        self.active_restore_streams
            .write()
            .await
            .insert(request_id.to_string(), child);

        // Initialize byte counter to track restore stream size and prevent
        // decompression bombs (UF-07).
        self.active_restore_bytes_written
            .write()
            .await
            .insert(request_id.to_string(), 0u64);

        *self.active_restore_request_id.write().await = Some(request_id.to_string());

        let event = json!({
            "type": "prepare_restore_stream_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }

    pub async fn write_restore_stream_chunk(
        &self,
        request_id: &str,
        data: &[u8],
    ) -> AgentResult<()> {
        // Acquire streams lock first (lock ordering: streams before bytes_written)
        let mut streams = self.active_restore_streams.write().await;
        if let Some(child) = streams.get_mut(request_id) {
            if let Some(stdin) = child.stdin.as_mut() {
                use tokio::io::AsyncWriteExt;
                stdin.write_all(data).await.map_err(|e| {
                    AgentError::IoError(format!("Failed to write to restore stdin: {}", e))
                })?;
            }
        } else {
            return Err(AgentError::InvalidRequest(
                "No active restore stream".to_string(),
            ));
        }
        drop(streams); // Release streams lock before acquiring bytes_written

        // Track bytes written and check against size limit
        let mut counters = self.active_restore_bytes_written.write().await;
        let counter = counters.entry(request_id.to_string()).or_insert(0);
        *counter = counter.saturating_add(data.len() as u64);
        if *counter > MAX_RESTORE_STREAM_BYTES {
            // Kill the tar process — stream exceeds decompression bomb limit
            let mut streams = self.active_restore_streams.write().await;
            if let Some(mut child) = streams.remove(request_id) {
                let _ = child.kill().await;
                // Reap zombie
                let _ = child.wait().await;
            }
            return Err(AgentError::SecurityViolation(format!(
                "Restore stream exceeded maximum size ({} bytes)",
                MAX_RESTORE_STREAM_BYTES
            )));
        }
        Ok(())
    }

    pub(crate) async fn handle_finish_restore_stream(
        &self,
        msg: &Value,
        write: &Arc<tokio::sync::Mutex<WsWrite>>,
    ) -> AgentResult<()> {
        let request_id = msg["requestId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing requestId".to_string()))?;
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let mut child = self
            .active_restore_streams
            .write()
            .await
            .remove(request_id)
            .ok_or_else(|| AgentError::InvalidRequest("No active restore stream".to_string()))?;

        *self.active_restore_request_id.write().await = None;

        // Close stdin (drop sends EOF)
        child.stdin.take();

        let stderr = child.stderr.take();
        let stderr_task = tokio::spawn(async move {
            if let Some(mut stderr) = stderr {
                let mut buf = Vec::new();
                use tokio::io::AsyncReadExt;
                let _ = stderr.read_to_end(&mut buf).await;
                String::from_utf8_lossy(&buf).to_string()
            } else {
                String::new()
            }
        });

        let server_dir = self.config.server.data_dir.join(server_uuid);
        let tmp_dir = server_dir.with_extension("tmp_restore_stream");

        let status = child
            .wait()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to wait for restore tar: {}", e)))?;

        if !status.success() {
            let stderr_output = stderr_task.await.unwrap_or_default();
            // Clean up temp extraction on failure — live server_dir untouched.
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            return Err(AgentError::IoError(format!(
                "Restore tar failed: {}",
                stderr_output
            )));
        }

        // Security: validate symlinks in the temp tree BEFORE replacing live data.
        // Same check used in non-streaming restore path (UF-01).
        let canonical_tmp = match tokio::fs::canonicalize(&tmp_dir).await {
            Ok(p) => p,
            Err(e) => {
                let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
                return Err(AgentError::FileSystemError(format!(
                    "Cannot resolve temp restore dir: {}",
                    e
                )));
            }
        };
        let mut dangerous = Vec::new();
        if let Err(e) = self
            .check_restore_symlinks(&tmp_dir, &canonical_tmp, &mut dangerous)
            .await
        {
            warn!("Symlink scan failed after restore stream: {}", e);
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            return Err(AgentError::FileSystemError(format!(
                "Symlink scan failed after restore stream: {}",
                e
            )));
        }
        if !dangerous.is_empty() {
            for link in &dangerous {
                warn!("Dangerous symlink in restored backup stream: {}", link);
            }
            let _ = tokio::fs::remove_dir_all(&tmp_dir).await;
            return Err(AgentError::SecurityViolation(format!(
                "Backup contains {} symlink(s) that escape the server directory.                  Restore aborted and temp directory cleaned up for security.",
                dangerous.len()
            )));
        }

        // Validation passed — swap restored data into place (mount-safe).
        self.storage_manager
            .replace_directory_contents(&server_dir, &tmp_dir)
            .await?;

        // Clean up byte counter for this restore stream
        self.active_restore_bytes_written
            .write()
            .await
            .remove(request_id);

        if let Err(e) = chown_to_container_user(&server_dir).await {
            warn!("Failed to chown restored directory: {}", e);
        }

        info!("Restore stream complete for {}", server_uuid);

        let event = json!({
            "type": "finish_restore_stream_response",
            "requestId": request_id,
            "success": true,
        });
        let mut w = write.lock().await;
        w.send(Message::Text(event.to_string().into()))
            .await
            .map_err(|e| AgentError::NetworkError(e.to_string()))?;
        Ok(())
    }
}

/// Resolve a binary-frame request id (full UUID or legacy 16-byte prefix) to the
/// full session key used by `upload_backup_start`.
///
/// Prefer exact match, then a unique prefix/suffix relationship. Ambiguous
/// matches keep the frame id so the write path fails cleanly rather than
/// writing into an arbitrary session.
pub(crate) fn resolve_backup_upload_request_id<'a, I>(request_id: &str, session_keys: I) -> String
where
    I: IntoIterator<Item = &'a str>,
{
    let keys: Vec<&str> = session_keys.into_iter().collect();
    if keys.contains(&request_id) {
        return request_id.to_string();
    }

    let prefix_matches: Vec<&str> = keys
        .iter()
        .copied()
        .filter(|k| k.starts_with(request_id) || request_id.starts_with(k))
        .collect();

    match prefix_matches.as_slice() {
        [only] => only.to_string(),
        // Ambiguous or no match: keep the frame id so the write path fails cleanly
        // rather than writing into an arbitrary session.
        _ => request_id.to_string(),
    }
}

/// Parse a backup upload binary frame into `(request_id, payload)`.
///
/// Supported layouts:
/// 1. **Length-prefixed (v2)** — `[u16 BE id_len][id UTF-8 bytes][payload]`.
///    Used by current backends so the full UUID is present on every chunk.
/// 2. **Legacy fixed 16-byte header** — first 16 bytes are a zero-padded UTF-8
///    prefix of the requestId; remainder is payload. Kept so older panels that
///    still truncate still work when the agent can uniquely resolve the session.
///
/// Disambiguation: if the first two bytes decode as a BE length `L` such that
/// `2 + L <= frame.len()` **and** the following `L` bytes are valid UTF-8 that
/// looks like a request id (printable, no NULs), treat as v2. Otherwise fall
/// back to the legacy 16-byte header when `frame.len() > 16`.
pub(crate) fn parse_backup_binary_frame(data: &[u8]) -> Option<(String, &[u8])> {
    if data.len() >= 2 {
        let id_len = u16::from_be_bytes([data[0], data[1]]) as usize;
        // Reject empty ids and frames that claim more bytes than available.
        // Also require at least one payload byte for a meaningful chunk
        // (empty payloads are no-ops upstream anyway).
        if id_len > 0 && data.len() >= 2 + id_len {
            let id_bytes = &data[2..2 + id_len];
            if looks_like_request_id(id_bytes) {
                if let Ok(id) = std::str::from_utf8(id_bytes) {
                    return Some((id.to_string(), &data[2 + id_len..]));
                }
            }
        }
    }

    // Legacy: fixed 16-byte zero-padded UTF-8 prefix.
    if data.len() > 16 {
        let header = String::from_utf8_lossy(&data[..16])
            .trim_end_matches('\0')
            .to_string();
        if !header.is_empty() {
            return Some((header, &data[16..]));
        }
    }

    None
}

fn looks_like_request_id(bytes: &[u8]) -> bool {
    // UUID / request ids are printable ASCII without control chars or NULs.
    // Cap at 128 to reject pathological length claims that would otherwise
    // swallow almost the entire frame as an "id".
    if bytes.is_empty() || bytes.len() > 128 {
        return false;
    }
    bytes
        .iter()
        .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' | b'-' | b'_' ))
}

#[cfg(test)]
mod request_id_tests {
    use super::{parse_backup_binary_frame, resolve_backup_upload_request_id};

    #[test]
    fn exact_match_preferred() {
        let full = "abcdef0123456789fedcba9876543210";
        let resolved = resolve_backup_upload_request_id(full, [full, "other-session"]);
        assert_eq!(resolved, full);
    }

    #[test]
    fn resolves_16_byte_prefix_to_full_uuid() {
        let full = "abcdef0123456789-fedc-ba98-7654-3210abcd";
        let prefix = &full[..16]; // historically truncated binary header
        assert_eq!(prefix.len(), 16);
        let resolved = resolve_backup_upload_request_id(prefix, [full, "zzzzzzzzzzzzzzzz-other"]);
        assert_eq!(resolved, full);
    }

    #[test]
    fn unknown_prefix_returns_input() {
        let resolved =
            resolve_backup_upload_request_id("deadbeefdeadbeef", ["session-a", "session-b"]);
        assert_eq!(resolved, "deadbeefdeadbeef");
    }

    #[test]
    fn ambiguous_prefix_does_not_pick_arbitrarily() {
        // Two sessions share the same 8-char prefix — must not inject into either.
        let a = "abcdef01-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        let b = "abcdef01-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        let resolved = resolve_backup_upload_request_id("abcdef01", [a, b]);
        assert_eq!(resolved, "abcdef01");
    }

    #[test]
    fn empty_session_set_returns_input() {
        let resolved = resolve_backup_upload_request_id("abcdef0123456789", std::iter::empty());
        assert_eq!(resolved, "abcdef0123456789");
    }

    #[test]
    fn longer_frame_id_matching_session_prefix_resolves() {
        // Frame carries a longer id that starts with a shorter session key.
        let session = "abcdef0123456789";
        let frame = format!("{session}-extra-suffix");
        let resolved = resolve_backup_upload_request_id(&frame, [session]);
        assert_eq!(resolved, session);
    }

    #[test]
    fn parse_length_prefixed_full_uuid() {
        let id = "abcdef01-2345-6789-abcd-ef0123456789";
        let payload = b"TARDATA";
        let id_bytes = id.as_bytes();
        let mut frame = Vec::with_capacity(2 + id_bytes.len() + payload.len());
        let len = id_bytes.len() as u16;
        frame.extend_from_slice(&len.to_be_bytes());
        frame.extend_from_slice(id_bytes);
        frame.extend_from_slice(payload);

        let (parsed_id, parsed_payload) = parse_backup_binary_frame(&frame).expect("parse");
        assert_eq!(parsed_id, id);
        assert_eq!(parsed_payload, payload);
    }

    #[test]
    fn parse_legacy_16_byte_prefix() {
        let full = "abcdef0123456789-fedc-ba98-7654-3210abcd";
        let mut header = [0u8; 16];
        header.copy_from_slice(full.as_bytes()[..16].as_ref());
        let payload = b"LEGACY";
        let mut frame = Vec::with_capacity(16 + payload.len());
        frame.extend_from_slice(&header);
        frame.extend_from_slice(payload);

        let (parsed_id, parsed_payload) = parse_backup_binary_frame(&frame).expect("parse");
        assert_eq!(parsed_id, &full[..16]);
        assert_eq!(parsed_payload, payload);
    }

    #[test]
    fn parse_rejects_empty_frame() {
        assert!(parse_backup_binary_frame(&[]).is_none());
        assert!(parse_backup_binary_frame(&[0, 0]).is_none());
    }
}
