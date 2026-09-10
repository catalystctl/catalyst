//! Backup encryption/decryption utilities using AES-256-GCM.
//!
//! Extracted from `websocket_handler.rs` to keep crypto concerns isolated.

use aes_gcm::aead::Generate;
use aes_gcm::aead::{consts::U12, Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

/// Magic header prepended to encrypted backups for format identification.
pub const BACKUP_ENCRYPTION_MAGIC: &[u8] = b"CATALYST_ENC_V1:";
/// SEC-H-01/13: chunk size for streaming AES-GCM (64 KiB per chunk, each with
/// its own nonce: [u32 BE len][12-byte nonce][ciphertext+tag]...).
pub const BACKUP_CRYPTO_CHUNK: usize = 64 * 1024;
/// Cap streaming encrypt/decrypt totals (matches 10 GiB backup ceiling).
pub const BACKUP_CRYPTO_MAX_BYTES: u64 = 10 * 1024 * 1024 * 1024;

/// Encrypt backup data using AES-256-GCM with the given 32-byte key (legacy
/// single-shot format kept for test vectors; production encrypts via
/// `encrypt_backup_streaming`).
///
/// The output format is: `[MAGIC_HEADER][12-byte nonce][ciphertext + tag]`.
#[cfg(test)]
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

/// SEC-H-01: streaming chunked decrypt — mirrors `encrypt_backup_streaming`.
/// Also accepts the legacy single-shot format (magic + nonce + ct): a reader
/// positioned after the magic either parses as `[u32 BE len][frame]...`
/// chunks, or (when that parse fails auth) the stream is rewound and
/// decrypted as one legacy blob. Requires a seekable reader.
pub fn decrypt_backup_streaming(
    mut reader: impl std::io::Read + std::io::Seek,
    mut writer: impl std::io::Write,
    key: &[u8],
) -> Result<u64, String> {
    if key.len() != 32 {
        return Err("Encryption key must be 32 bytes for AES-256".to_string());
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;
    let mut magic = vec![0u8; BACKUP_ENCRYPTION_MAGIC.len()];
    reader
        .read_exact(&mut magic)
        .map_err(|_| "Not an encrypted backup".to_string())?;
    if magic != BACKUP_ENCRYPTION_MAGIC {
        return Err("Not an encrypted backup".to_string());
    }
    let mut total: u64 = 0;
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(0),
        Err(e) => return Err(format!("read failed: {}", e)),
    }
    let first_len = u32::from_be_bytes(len_buf) as usize;
    // A chunked stream starts with a plausible frame length whose frame
    // authenticates under the key. Anything else (or a frame that fails
    // GCM auth) means this is a legacy single-shot payload: rewind to just
    // after the magic and decrypt the remainder in one shot.
    let mut chunked = false;
    if (12..=BACKUP_CRYPTO_CHUNK + 64).contains(&first_len) {
        let mut frame = vec![0u8; first_len];
        if reader.read_exact(&mut frame).is_ok() {
            if let Ok(pt) = decrypt_chunk(&cipher, &frame) {
                chunked = true;
                total = total.saturating_add(pt.len() as u64);
                if total > BACKUP_CRYPTO_MAX_BYTES {
                    return Err("Backup exceeds maximum size".to_string());
                }
                writer
                    .write_all(&pt)
                    .map_err(|e| format!("write failed: {}", e))?;
            }
        }
    }
    if !chunked {
        reader
            .seek(std::io::SeekFrom::Start(
                BACKUP_ENCRYPTION_MAGIC.len() as u64
            ))
            .map_err(|e| format!("seek failed: {}", e))?;
        let mut rest = Vec::new();
        reader
            .read_to_end(&mut rest)
            .map_err(|e| format!("read failed: {}", e))?;
        let mut legacy = Vec::with_capacity(BACKUP_ENCRYPTION_MAGIC.len() + rest.len());
        legacy.extend_from_slice(BACKUP_ENCRYPTION_MAGIC);
        legacy.extend_from_slice(&rest);
        let pt = decrypt_backup(&legacy, key)?;
        total = total.saturating_add(pt.len() as u64);
        if total > BACKUP_CRYPTO_MAX_BYTES {
            return Err("Backup exceeds maximum size".to_string());
        }
        writer
            .write_all(&pt)
            .map_err(|e| format!("write failed: {}", e))?;
        return Ok(total);
    }
    // Chunked mode: keep reading `[u32 BE len][frame]` until EOF.
    loop {
        match reader.read_exact(&mut len_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("read failed: {}", e)),
        }
        let len = u32::from_be_bytes(len_buf) as usize;
        if !(12..=BACKUP_CRYPTO_CHUNK + 64).contains(&len) {
            return Err("Invalid chunk length".to_string());
        }
        let mut frame = vec![0u8; len];
        reader
            .read_exact(&mut frame)
            .map_err(|_| "Truncated chunk".to_string())?;
        let pt = decrypt_chunk(&cipher, &frame)?;
        total = total.saturating_add(pt.len() as u64);
        if total > BACKUP_CRYPTO_MAX_BYTES {
            return Err("Backup exceeds maximum size".to_string());
        }
        writer
            .write_all(&pt)
            .map_err(|e| format!("write failed: {}", e))?;
    }
    Ok(total)
}

/// Decrypt one `[12-byte nonce][ciphertext+tag]` frame.
fn decrypt_chunk(cipher: &Aes256Gcm, frame: &[u8]) -> Result<Vec<u8>, String> {
    let nonce = Nonce::<U12>::try_from(&frame[..12])
        .map_err(|_| "Invalid encrypted backup: bad nonce".to_string())?;
    cipher
        .decrypt(&nonce, &frame[12..])
        .map_err(|e| format!("Decryption failed: {}", e))
}

/// SEC-H-01: streaming chunked encrypt — constant memory regardless of input
/// size. Per chunk: `[u32 BE len][12-byte nonce][ciphertext+tag]`. Each chunk
/// gets a fresh random nonce (never reuse a GCM nonce across chunks).
pub fn encrypt_backup_streaming(
    mut reader: impl std::io::Read,
    mut writer: impl std::io::Write,
    key: &[u8],
) -> Result<u64, String> {
    if key.len() != 32 {
        return Err("Encryption key must be 32 bytes for AES-256".to_string());
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Failed to create cipher: {}", e))?;
    writer
        .write_all(BACKUP_ENCRYPTION_MAGIC)
        .map_err(|e| format!("write failed: {}", e))?;
    let mut total: u64 = 0;
    let mut buf = vec![0u8; BACKUP_CRYPTO_CHUNK];
    loop {
        let mut filled = 0;
        while filled < buf.len() {
            match reader.read(&mut buf[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) => return Err(format!("read failed: {}", e)),
            }
        }
        if filled == 0 {
            break;
        }
        total = total.saturating_add(filled as u64);
        if total > BACKUP_CRYPTO_MAX_BYTES {
            return Err("Backup exceeds maximum size".to_string());
        }
        let nonce: Nonce<U12> = Nonce::<U12>::generate();
        let ct = cipher
            .encrypt(&nonce, &buf[..filled])
            .map_err(|e| format!("Encryption failed: {}", e))?;
        let len = (nonce.as_slice().len() + ct.len()) as u32;
        writer
            .write_all(&len.to_be_bytes())
            .map_err(|e| format!("write failed: {}", e))?;
        writer
            .write_all(nonce.as_slice())
            .map_err(|e| format!("write failed: {}", e))?;
        writer
            .write_all(&ct)
            .map_err(|e| format!("write failed: {}", e))?;
    }
    Ok(total)
}

/// SEC-7: secure-temp helper for crypto flows — creates an O_EXCL
/// unpredictable file in the same dir as `anchor` with 0600 perms, returned
/// together with its path so the caller can fsync and rename it into place.
pub fn secure_temp_sibling(
    anchor: &std::path::Path,
) -> Result<(std::fs::File, std::path::PathBuf), String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let parent = anchor.parent().unwrap_or(std::path::Path::new("."));
    for _ in 0..10 {
        // rand 0.10: rand::random() is the stable entry point.
        let v: u128 = rand::random();
        let name = format!("{:032x}", v);
        let path = parent.join(format!(".decrypt-{}.tmp", name));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
        {
            Ok(f) => {
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
                return Ok((f, path));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("create secure temp: {}", e)),
        }
    }
    Err("could not create secure temp".to_string())
}

#[cfg(test)]
mod security_hardening_tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn streaming_decrypt_accepts_legacy_single_shot_format() {
        // Files written by the pre-streaming encrypt_backup must still decrypt.
        let key = [7u8; 32];
        let plaintext = b"legacy single-shot encrypted backup payload";
        let legacy = encrypt_backup(plaintext, &key).unwrap();
        let mut out = Vec::new();
        let total = decrypt_backup_streaming(Cursor::new(&legacy), &mut out, &key).unwrap();
        assert_eq!(total, plaintext.len() as u64);
        assert_eq!(out, plaintext);
    }

    #[test]
    fn streaming_roundtrip_constant_memory_shape() {
        let key = [7u8; 32];
        let plaintext: Vec<u8> = (0..(BACKUP_CRYPTO_CHUNK * 3 + 123))
            .map(|i| (i % 251) as u8)
            .collect();
        let mut enc = Vec::new();
        let total = encrypt_backup_streaming(Cursor::new(&plaintext), &mut enc, &key).unwrap();
        assert_eq!(total, plaintext.len() as u64);
        let mut dec = Vec::new();
        let out = decrypt_backup_streaming(Cursor::new(&enc), &mut dec, &key).unwrap();
        assert_eq!(out, plaintext.len() as u64);
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn streaming_tamper_rejected() {
        let key = [7u8; 32];
        let mut enc = Vec::new();
        encrypt_backup_streaming(Cursor::new(b"hello world"), &mut enc, &key).unwrap();
        let flip = enc.len() - 1;
        enc[flip] ^= 0xff;
        let mut dec = Vec::new();
        assert!(decrypt_backup_streaming(Cursor::new(&enc), &mut dec, &key).is_err());
    }
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
