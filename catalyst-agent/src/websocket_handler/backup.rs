//! Backup creation, restoration, upload, and download handlers.

use super::*;

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
                    ).await;
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
        let backup_metadata = tokio::fs::metadata(&actual_backup_file).await
            .map_err(|e| AgentError::IoError(format!("Failed to read backup metadata: {}", e)))?;
        if backup_metadata.len() > MAX_LOCAL_BACKUP_BYTES {
            if let Some(ref tmp) = cleanup_temp {
                let _ = tokio::fs::remove_file(tmp).await;
            }
            return Err(AgentError::InvalidRequest(format!(
                "Backup file too large ({} bytes, max {} bytes)",
                backup_metadata.len(), MAX_LOCAL_BACKUP_BYTES
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

        // Validation passed — atomically replace server_dir with restored data.
        // server_dir may not exist yet, so we ignore remove_dir_all errors.
        let _ = tokio::fs::remove_dir_all(&server_dir).await;
        tokio::fs::rename(&tmp_dir, &server_dir).await.map_err(|e| {
            AgentError::FileSystemError(format!("Failed to move restored directory into place: {}", e))
        })?;

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

        // Check size limit and write the chunk in-place using get_mut.
        // This avoids the remove/insert race where a concurrent chunk finds
        // the session temporarily missing from the map.
        let chunk_len = chunk.len() as u64;
        enum ChunkError {
            TooLarge(String),
            WriteFailed(String),
            UnknownRequest,
        }
        let write_result: Result<(), ChunkError> = {
            let mut uploads = self.active_uploads.write().await;
            match uploads.get_mut(request_id) {
                Some(session) => {
                    let next_total = session.bytes_written.saturating_add(chunk_len);
                    if next_total > MAX_BACKUP_UPLOAD_BYTES {
                        Err(ChunkError::TooLarge(format!(
                            "Upload too large (max {} bytes)",
                            MAX_BACKUP_UPLOAD_BYTES
                        )))
                    } else if let Err(e) = session.file.write_all(&chunk).await {
                        Err(ChunkError::WriteFailed(format!("Write failed: {}", e)))
                    } else {
                        session.bytes_written = next_total;
                        session.last_activity = tokio::time::Instant::now();
                        Ok(())
                    }
                }
                None => Err(ChunkError::UnknownRequest),
            }
        };

        // On fatal errors, remove the session and clean up the file on disk.
        if let Err(ref err) = write_result {
            let path_to_clean = match err {
                ChunkError::TooLarge(_) | ChunkError::WriteFailed(_) => {
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
                ChunkError::TooLarge(msg) | ChunkError::WriteFailed(msg) => msg.as_str(),
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

        // Check size limit and write the chunk in-place using get_mut.
        // This avoids the remove/insert race where a concurrent chunk finds
        // the session temporarily missing from the map.
        let data_len = data.len() as u64;
        let write_result: Result<(), AgentError> = {
            let mut uploads = self.active_uploads.write().await;
            match uploads.get_mut(request_id) {
                Some(session) => {
                    let next_total = session.bytes_written.saturating_add(data_len);
                    if next_total > MAX_BACKUP_UPLOAD_BYTES {
                        Err(AgentError::InvalidRequest(format!(
                            "Upload too large (max {} bytes)",
                            MAX_BACKUP_UPLOAD_BYTES
                        )))
                    } else if let Err(e) = session.file.write_all(data).await {
                        Err(AgentError::IoError(format!("Failed to write backup chunk: {}", e)))
                    } else {
                        session.bytes_written = next_total;
                        session.last_activity = tokio::time::Instant::now();
                        Ok(())
                    }
                }
                None => Err(AgentError::InvalidRequest(
                    "Unknown upload request".to_string(),
                )),
            }
        };

        // On fatal errors, remove the session and clean up the file on disk.
        if let Err(ref err) = write_result {
            let path_to_clean = {
                let mut uploads = self.active_uploads.write().await;
                uploads.remove(request_id).map(|s| s.path)
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

        let mut write_guard = write.lock().await;
        let mut buf = vec![0u8; 64 * 1024]; // 64 KB read buffer

        loop {
            use tokio::io::AsyncReadExt;
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if write_guard
                        .send(Message::Binary(buf[..n].to_vec().into()))
                        .await
                        .is_err()
                    {
                        child.kill().await.ok();
                        return Err(AgentError::NetworkError(
                            "Failed to send backup chunk".to_string(),
                        ));
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

        drop(write_guard);

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

        tokio::fs::create_dir_all(&server_dir).await.map_err(|e| {
            AgentError::IoError(format!("Failed to create server directory: {}", e))
        })?;

        info!(
            "Preparing restore stream for {} into {}",
            server_uuid,
            server_dir.display()
        );

        // Spawn tar with stdin piped. stdin stays in the Child so
        // write_restore_stream_chunk can access it via child.stdin.as_mut().
        let child = tokio::process::Command::new("tar")
            .arg("-xf")
            .arg("-")
            .arg("-C")
            .arg(&server_dir)
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

        let status = child
            .wait()
            .await
            .map_err(|e| AgentError::IoError(format!("Failed to wait for restore tar: {}", e)))?;

        if !status.success() {
            let stderr_output = stderr_task.await.unwrap_or_default();
            // Clean up partial extraction on failure, matching non-streaming behaviour
            let _ = tokio::fs::remove_dir_all(&server_dir).await;
            return Err(AgentError::IoError(format!(
                "Restore tar failed: {}",
                stderr_output
            )));
        }

        // Security: validate that no symlinks in the restored data escape
        // the server directory. This prevents a malicious backup from planting
        // symlinks that point to host paths like /etc/shadow.
        // Same check used in non-streaming restore path (UF-01).
        let canonical_base = tokio::fs::canonicalize(&server_dir)
            .await
            .unwrap_or_else(|_| server_dir.clone());
        let mut dangerous = Vec::new();
        if let Err(e) = self
            .check_restore_symlinks(&server_dir, &canonical_base, &mut dangerous)
            .await
        {
            warn!("Symlink scan failed after restore stream: {}", e);
        }
        if !dangerous.is_empty() {
            warn!(
                "Removing {} dangerous symlinks from restored server {}",
                dangerous.len(),
                server_uuid
            );
            for link in &dangerous {
                // Parse "path -> target" format from check_restore_symlinks
                if let Some(link_path) = link.split(" -> ").next() {
                    // tokio::fs::remove_file on a symlink removes the symlink itself,
                    // not the target — this is the correct behavior.
                    let _ = tokio::fs::remove_file(link_path).await;
                }
            }
            // Inconsistent data remains after removing individual symlinks.
            // Clean up the entire directory to match non-streaming behaviour.
            let _ = tokio::fs::remove_dir_all(&server_dir).await;
            return Err(AgentError::SecurityViolation(format!(
                "Backup contains {} symlink(s) that escape the server directory. \
                 Restore aborted and directory cleaned up for security.",
                dangerous.len()
            )));
        }

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
