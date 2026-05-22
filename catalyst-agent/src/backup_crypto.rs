//! Backup encryption/decryption utilities using AES-256-GCM.
//!
//! Extracted from `websocket_handler.rs` to keep crypto concerns isolated.

use aes_gcm::aead::Aead;
use aes_gcm::{AeadCore, Aes256Gcm, KeyInit, Nonce};

/// Magic header prepended to encrypted backups for format identification.
pub const BACKUP_ENCRYPTION_MAGIC: &[u8] = b"CATALYST_ENC_V1:";

/// Encrypt backup data using AES-256-GCM with the given 32-byte key.
///
/// The output format is: `[MAGIC_HEADER][12-byte nonce][ciphertext + tag]`.
pub fn encrypt_backup(data: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err("Encryption key must be 32 bytes for AES-256".to_string());
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;
    let nonce = Aes256Gcm::generate_nonce(&mut rand_08::thread_rng()); // 96-bit
    let ciphertext = cipher
        .encrypt(&nonce, data)
        .map_err(|e| format!("Encryption failed: {}", e))?;
    // Prepend magic header + nonce
    let mut result = BACKUP_ENCRYPTION_MAGIC.to_vec();
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Decrypt backup data using AES-256-GCM with the given 32-byte key.
///
/// Expects input format: `[MAGIC_HEADER][12-byte nonce][ciphertext + tag]`.
pub fn decrypt_backup(data: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err("Encryption key must be 32 bytes for AES-256".to_string());
    }
    if !data.starts_with(BACKUP_ENCRYPTION_MAGIC) {
        return Err("Not an encrypted backup".to_string());
    }
    let payload = &data[BACKUP_ENCRYPTION_MAGIC.len()..];
    if payload.len() < 12 {
        return Err("Invalid encrypted backup: too short".to_string());
    }
    let nonce = Nonce::from_slice(&payload[..12]);
    let ciphertext = &payload[12..];
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}
