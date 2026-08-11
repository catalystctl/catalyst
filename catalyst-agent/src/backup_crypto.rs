//! Backup encryption/decryption utilities using AES-256-GCM.
//!
//! Extracted from `websocket_handler.rs` to keep crypto concerns isolated.

use aes_gcm::aead::Generate;
use aes_gcm::aead::{consts::U12, Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

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
    // aes-gcm 0.11: Nonce::generate() uses getrandom (default feature)
    let nonce: Nonce<U12> = Nonce::<U12>::generate();
    let ciphertext = cipher
        .encrypt(&nonce, data)
        .map_err(|e| format!("Encryption failed: {}", e))?;
    // Prepend magic header + nonce
    let mut result = BACKUP_ENCRYPTION_MAGIC.to_vec();
    result.extend_from_slice(nonce.as_slice());
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
    let nonce = Nonce::<U12>::try_from(&payload[..12])
        .map_err(|_| "Invalid encrypted backup: bad nonce".to_string())?;
    let ciphertext = &payload[12..];
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;
    cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; 32] {
        let mut key = [0u8; 32];
        for (i, b) in key.iter_mut().enumerate() {
            *b = i as u8;
        }
        key
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = test_key();
        let plaintext = b"Hello, catalyst backup!";
        let encrypted = encrypt_backup(plaintext, &key).unwrap();
        assert!(encrypted.starts_with(BACKUP_ENCRYPTION_MAGIC));
        let decrypted = decrypt_backup(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let key = test_key();
        let plaintext = b"sensitive data";
        let mut encrypted = encrypt_backup(plaintext, &key).unwrap();
        // Flip a byte in the ciphertext portion (after magic + nonce)
        let flip_at = BACKUP_ENCRYPTION_MAGIC.len() + 12 + 2;
        if flip_at < encrypted.len() {
            encrypted[flip_at] ^= 0xff;
        }
        assert!(decrypt_backup(&encrypted, &key).is_err());
    }

    #[test]
    fn wrong_key_rejected() {
        let key = test_key();
        let mut other = test_key();
        other[0] ^= 0xff;
        let encrypted = encrypt_backup(b"data", &key).unwrap();
        assert!(decrypt_backup(&encrypted, &other).is_err());
    }

    #[test]
    fn unencrypted_rejected() {
        let key = test_key();
        assert!(decrypt_backup(b"not encrypted", &key).is_err());
    }

    #[test]
    fn bad_key_length_rejected() {
        assert!(encrypt_backup(b"x", b"short").is_err());
        assert!(decrypt_backup(b"x", b"short").is_err());
    }
}
