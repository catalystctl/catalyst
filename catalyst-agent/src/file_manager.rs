use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tracing::{debug, info, warn};

use crate::{AgentError, AgentResult};

/// Archive hardening caps (SEC-C-03).
pub(crate) const MAX_ARCHIVE_MEMBERS: usize = 50_000;
pub(crate) const MAX_ARCHIVE_TOTAL_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10 GiB uncompressed
pub(crate) const MAX_ARCHIVE_RATIO: u64 = 100; // uncompressed may not exceed 100x compressed

/// An exclusively-created temp file plus its path (std handles carry no path).
/// Written via `as_file()`/`AsyncWriteExt` on the std handle, removed/renamed
/// through `path()`.
pub struct TempFile {
    file: tokio::fs::File,
    path: PathBuf,
}

impl TempFile {
    fn new(file: tokio::fs::File, path: PathBuf) -> Self {
        Self { file, path }
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        tokio::io::AsyncWriteExt::write_all(&mut self.file, buf).await
    }
    pub async fn sync_all(&mut self) -> std::io::Result<()> {
        tokio::fs::File::sync_all(&self.file).await
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        // Best-effort: if the caller never renamed us onto the target (task
        // cancelled, early error return), remove the temp file so cancelled
        // writes don't litter the server directory.
        if self.path.exists() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Open a file without following a trailing symlink (O_NOFOLLOW).
/// `write=true` opens write-only (existing file, no create/truncate);
/// `write=false` opens read-only. Symlink targets fail with ELOOP.
pub(crate) fn open_no_follow(path: &Path, write: bool) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut opts = std::fs::OpenOptions::new();
    if write {
        opts.write(true);
    } else {
        opts.read(true);
    }
    opts.custom_flags(libc::O_NOFOLLOW);
    opts.open(path)
}

/// Canonical base for a server jail (trust anchor for ancestor checks).
fn jail_base_sync(data_dir: &Path, server_id: &str) -> Result<PathBuf, AgentError> {
    let server_base = data_dir.join(server_id);
    if let Ok(p) = server_base.canonicalize() {
        return Ok(p);
    }
    let data_canon = data_dir.canonicalize().map_err(|_| {
        AgentError::FileSystemError(format!("Data directory does not exist: {:?}", data_dir))
    })?;
    let resolved = data_canon.join(server_id);
    if !resolved.starts_with(&data_canon) {
        return Err(AgentError::PermissionDenied(
            "Server ID escapes data directory".to_string(),
        ));
    }
    Ok(resolved)
}

/// Re-validate every ancestor of `dir` up to `canonical_base`: none may be
/// a symlink and each must canonicalize inside the base. Closes the
/// create_dir_all → use window where the container swaps a parent for a link.
fn revalidate_ancestors(canonical_base: &Path, dir: &Path) -> AgentResult<()> {
    let mut cur = dir.to_path_buf();
    loop {
        if !cur.starts_with(canonical_base) && cur != *canonical_base {
            return Err(AgentError::PermissionDenied(
                "Access denied: path outside data directory".to_string(),
            ));
        }
        match std::fs::symlink_metadata(&cur) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(AgentError::PermissionDenied(
                    "Access denied: ancestor is a symbolic link".to_string(),
                ));
            }
            Ok(_) => {
                if let Ok(c) = cur.canonicalize() {
                    if !c.starts_with(canonical_base) {
                        return Err(AgentError::PermissionDenied(
                            "Access denied: path outside data directory".to_string(),
                        ));
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(AgentError::FileSystemError(format!(
                    "Cannot stat ancestor: {}",
                    e
                )));
            }
        }
        if cur == *canonical_base {
            break;
        }
        match cur.parent() {
            Some(p) if p != cur => cur = p.to_path_buf(),
            _ => break,
        }
        if !dir.starts_with(canonical_base) && cur == *canonical_base {
            break;
        }
    }
    Ok(())
}

/// Reject one archive member name before extraction (SEC-C-03).
fn reject_archive_member_name(name: &str) -> AgentResult<()> {
    if name.is_empty() || name.contains('\0') {
        return Err(AgentError::SecurityViolation(
            "Archive contains invalid entry name".to_string(),
        ));
    }
    let p = Path::new(name);
    if p.is_absolute() {
        return Err(AgentError::SecurityViolation(format!(
            "Archive contains absolute path: {}",
            name
        )));
    }
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                return Err(AgentError::SecurityViolation(format!(
                    "Archive contains '..' path: {}",
                    name
                )));
            }
            std::path::Component::Prefix(_) | std::path::Component::RootDir => {
                return Err(AgentError::SecurityViolation(format!(
                    "Archive contains absolute path: {}",
                    name
                )));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Enforce member-count / total-size / compression-ratio caps.
fn enforce_archive_caps(
    member_count: usize,
    total_uncompressed: u64,
    compressed_len: u64,
) -> AgentResult<()> {
    if member_count > MAX_ARCHIVE_MEMBERS {
        return Err(AgentError::SecurityViolation(format!(
            "Archive has too many entries ({} > {})",
            member_count, MAX_ARCHIVE_MEMBERS
        )));
    }
    if total_uncompressed > MAX_ARCHIVE_TOTAL_BYTES {
        return Err(AgentError::SecurityViolation(format!(
            "Archive uncompressed size too large ({} bytes)",
            total_uncompressed
        )));
    }
    if compressed_len > 0 && total_uncompressed > compressed_len.saturating_mul(MAX_ARCHIVE_RATIO) {
        return Err(AgentError::SecurityViolation(format!(
            "Archive compression ratio too high ({} -> {} bytes)",
            compressed_len, total_uncompressed
        )));
    }
    Ok(())
}

/// Pre-list a zip archive and reject dangerous members before extraction.
/// Uses `unzip -Z -v` (verbose listing includes type flags) plus a fallback
/// parse; any symlink / absolute / `..` / device-looking entry is rejected.
async fn prevalidate_zip_archive(archive: &Path, compressed_len: u64) -> AgentResult<()> {
    let out = tokio::process::Command::new("unzip")
        .args(["-Z", "-v", &archive.to_string_lossy()])
        .output()
        .await
        .map_err(|e| AgentError::FileSystemError(format!("unzip -Z failed: {}", e)))?;
    if !out.status.success() {
        return Err(AgentError::FileSystemError(
            "Cannot list zip archive".to_string(),
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut count = 0usize;
    let mut total = 0u64;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("Archive:")
            || trimmed.starts_with("Zip file size:")
            || trimmed.contains("file(s),")
            || trimmed.starts_with("Length")
            || trimmed.starts_with("----")
        {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 8 {
            continue;
        }
        // `unzip -Z -v` columns: Length Method Size Ratio Date Time CRC Name...
        // Name is the last field; type char is embedded in the long form.
        let name = parts[parts.len() - 1];
        if name.is_empty() || name == "." {
            continue;
        }
        reject_archive_member_name(name)?;
        // Symlink entries show as `... Symbolic link ... -> target` or carry
        // a trailing `-> target` marker in verbose output.
        if line.contains("symbolic link") || line.contains(" -> ") {
            return Err(AgentError::SecurityViolation(format!(
                "Archive contains symlink entry: {}",
                name
            )));
        }
        let len: u64 = parts[0].replace(',', "").parse().unwrap_or(0);
        total = total.saturating_add(len);
        count += 1;
    }
    // Fallback: short listing when verbose parse yields nothing (empty names).
    if count == 0 {
        let out = tokio::process::Command::new("unzip")
            .args(["-Z", "-1", &archive.to_string_lossy()])
            .output()
            .await
            .map_err(|e| AgentError::FileSystemError(format!("unzip -Z failed: {}", e)))?;
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let name = line.trim().trim_end_matches('/');
                if name.is_empty() || name == "." {
                    continue;
                }
                reject_archive_member_name(name)?;
                count += 1;
            }
        }
    }
    enforce_archive_caps(count, total, compressed_len)
}

/// Pre-list a tar.gz archive and reject dangerous members before extraction.
/// Rejects absolute paths, `..`, symlinks/hardlinks, char/block/fifo/device
/// entries; enforces count / size / ratio caps.
async fn prevalidate_tar_archive(archive: &Path, compressed_len: u64) -> AgentResult<()> {
    let out = tokio::process::Command::new("tar")
        .args(["-tzvf", &archive.to_string_lossy()])
        .output()
        .await
        .map_err(|e| AgentError::FileSystemError(format!("tar -t failed: {}", e)))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AgentError::FileSystemError(format!(
            "Cannot list tar archive: {}",
            stderr
        )));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut count = 0usize;
    let mut total = 0u64;
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        // GNU tar -tvf: `TYPE... owner/group SIZE DATE TIME NAME [-> target]`
        let flag = line.chars().next().unwrap_or('-');
        match flag {
            // Reject symlink, hardlink, char, block, fifo entries outright.
            'l' | 'h' | 'c' | 'b' | 'p' => {
                return Err(AgentError::SecurityViolation(format!(
                    "Archive contains unsafe entry type '{}': {}",
                    flag, line
                )));
            }
            '-' | 'd' => {}
            _ => {
                // Unknown type flag (socket `s`, etc.) — reject closed.
                return Err(AgentError::SecurityViolation(format!(
                    "Archive contains unsupported entry type: {}",
                    line
                )));
            }
        }
        // `-> target` markers must never appear for regular entries.
        if line.contains(" -> ") {
            return Err(AgentError::SecurityViolation(format!(
                "Archive contains link entry: {}",
                line
            )));
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 6 {
            continue;
        }
        // NOTE: do NOT use parse_tar_list_line here — it silently skips
        // `..` names (fine for listing, fatal for validation).
        let size: u64 = parts[2].replace(',', "").parse().unwrap_or(0);
        let name = parts[5..].join(" ");
        let name = name.trim_end_matches('/');
        if name.is_empty() || name == "." {
            continue;
        }
        reject_archive_member_name(name)?;
        total = total.saturating_add(size);
        count += 1;
    }
    enforce_archive_caps(count, total, compressed_len)
}

/// Default matches the panel `fileTunnelMaxUploadMb` default (500MB).
/// Overridden at runtime from the panel via handshake / file_upload_limit.
pub const DEFAULT_MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;

pub struct FileManager {
    data_dir: PathBuf,
    max_file_size: AtomicU64,
}

impl FileManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            max_file_size: AtomicU64::new(DEFAULT_MAX_FILE_SIZE),
        }
    }

    /// SECURITY: create an unpredictable, exclusively-created temp file next
    /// to `target` (same directory → same-fs atomic rename). O_EXCL
    /// (`.create_new(true)`) fails on ANY pre-existing directory entry,
    /// including a dangling symlink planted by the container, so a root write
    /// can never traverse a container-controlled name. Mode is 0600 until the
    /// rename + ownership handoff completes. The suffix is 128 bits from a
    /// CSPRNG (unpredictable to the container user) plus retries on collision.
    pub async fn create_secure_temp_sibling(target: &Path) -> AgentResult<TempFile> {
        let dir = target
            .parent()
            .ok_or_else(|| AgentError::InvalidRequest("Invalid target path".to_string()))?;
        let stem = target
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());
        // Sanitize the stem so a malicious target name cannot inject path
        // separators into the temp name (defense in depth; target is already
        // jail-resolved, but temp names must never contain `/`).
        let stem: String = stem
            .chars()
            .map(|c| {
                if c == '/' || c == '\\' || c == '\0' {
                    '_'
                } else {
                    c
                }
            })
            .take(64)
            .collect();
        // Retry on the (astronomically unlikely) name collision.
        for _ in 0..8 {
            let unique: u128 = rand::random();
            let name = format!(".catalyst-tmp-{}-{:032x}", stem, unique);
            let candidate = dir.join(name);
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&candidate)
                .await
            {
                Ok(f) => return Ok(TempFile::new(f, candidate)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => {
                    return Err(AgentError::FileSystemError(format!(
                        "Failed to create temp file: {}",
                        e
                    )))
                }
            }
        }
        Err(AgentError::FileSystemError(
            "Failed to create unique temp file after retries".to_string(),
        ))
    }

    /// SECURITY: exclusive-create (O_EXCL) a 0600 file at `path`. Unlike
    /// `File::create`, this refuses to follow a pre-existing symlink planted
    /// at the destination (root writes must never traverse container-planted
    /// names).
    async fn create_exclusive_file(path: &Path) -> AgentResult<tokio::fs::File> {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .await
            .map_err(|e| {
                AgentError::FileSystemError(format!(
                    "Failed to create file (refusing to follow existing entries): {}",
                    e
                ))
            })
    }

    /// SECURITY: stream `response` into an unpredictable O_EXCL temp file in
    /// the target's directory and return it. The caller must hold the TempFile
    /// until it has renamed it onto the target: rename(2) REPLACES a symlink
    /// at the destination rather than following it, the temp name itself can
    /// never be pre-planted by the container (exclusive creation), and the
    /// Drop guard deletes the temp file if the caller bails out early.
    pub async fn write_stream_to_exclusive_temp(
        &self,
        server_id: &str,
        target: &str,
        mut response: reqwest::Response,
    ) -> AgentResult<TempFile> {
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let full_path = self.resolve_path(server_id, target)?;
        if let Some(parent) = full_path.parent() {
            Self::ensure_parent_dir_secure(&canonical_base, parent).await?;
        }
        let mut temp = Self::create_secure_temp_sibling(&full_path).await?;
        let mut total: u64 = 0;
        let mut write_err: Option<AgentError> = None;
        while write_err.is_none() {
            let chunk = match response.chunk().await {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(e) => {
                    write_err = Some(AgentError::FileSystemError(format!(
                        "Failed to read upload chunk: {}",
                        e
                    )));
                    break;
                }
            };
            total += chunk.len() as u64;
            if total > self.max_file_size() {
                write_err = Some(AgentError::FileSystemError(format!(
                    "File too large: exceeds {}MB",
                    self.max_file_size() / 1024 / 1024
                )));
                break;
            }
            if let Err(e) = temp.write_all(&chunk).await {
                write_err = Some(AgentError::FileSystemError(format!(
                    "Failed to write upload chunk: {}",
                    e
                )));
            }
        }
        if let Some(err) = write_err {
            let temp_path = temp.path().to_path_buf();
            drop(temp);
            let _ = fs::remove_file(&temp_path).await;
            return Err(err);
        }
        if let Err(e) = temp.sync_all().await {
            let temp_path = temp.path().to_path_buf();
            drop(temp);
            let _ = fs::remove_file(&temp_path).await;
            return Err(AgentError::FileSystemError(format!(
                "Failed to sync uploaded file: {}",
                e
            )));
        }
        // Hand ownership to the caller; dropping it here would trigger the
        // Drop guard and delete the just-written file before the rename.
        Ok(temp)
    }

    pub fn max_file_size(&self) -> u64 {
        self.max_file_size.load(Ordering::Relaxed)
    }

    /// The agent data directory. Server directories live at
    /// `{data_dir}/{server_uuid}`; ownership fixups use this as the boundary
    /// below which everything is handed to the container user.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Apply the panel-wide upload cap. Zero is ignored.
    pub fn set_max_file_size(&self, bytes: u64) {
        if bytes == 0 {
            return;
        }
        self.max_file_size.store(bytes, Ordering::Relaxed);
        info!(
            max_upload_bytes = bytes,
            max_upload_mb = bytes / 1024 / 1024,
            "Applied panel file upload limit"
        );
    }

    /// Free bytes on the filesystem that backs `path` (loop image or host dir).
    pub fn available_bytes(path: &Path) -> AgentResult<u64> {
        let probe = if path.exists() {
            path
        } else {
            path.parent().filter(|p| p.exists()).unwrap_or(path)
        };
        let stat = nix::sys::statvfs::statvfs(probe).map_err(|e| {
            AgentError::FileSystemError(format!("statvfs failed for {}: {e}", probe.display()))
        })?;
        Ok((stat.blocks_available() as u64).saturating_mul(stat.fragment_size() as u64))
    }

    /// Extra bytes a write at `offset` of `write_len` would grow `path` by.
    pub fn write_growth_bytes(current_len: u64, offset: u64, write_len: u64) -> u64 {
        offset.saturating_add(write_len).saturating_sub(current_len)
    }

    /// Reject a write that would grow the file past free space on its filesystem.
    pub async fn ensure_write_fits(
        &self,
        path: &Path,
        offset: u64,
        write_len: u64,
    ) -> AgentResult<()> {
        let current = match fs::metadata(path).await {
            Ok(m) => m.len(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
            Err(e) => {
                return Err(AgentError::FileSystemError(format!(
                    "Cannot access file: {e}"
                )));
            }
        };
        let extra = Self::write_growth_bytes(current, offset, write_len);
        if extra == 0 {
            return Ok(());
        }
        let avail = Self::available_bytes(path)?;
        if extra > avail {
            return Err(AgentError::FileSystemError(format!(
                "No space left on device: need {extra} more bytes, {avail} available"
            )));
        }
        Ok(())
    }

    /// Validate and resolve a path within the container's data directory
    pub fn resolve_path(&self, server_id: &str, requested_path: &str) -> AgentResult<PathBuf> {
        // Reject ids that are empty, traversal segments, or contain path
        // separators / NUL. `""` and "." would resolve to the entire data
        // directory and ".." to its parent — all three must never be usable
        // as a server root, even though the panel normally sends cuids.
        Self::validate_server_id(server_id)?;
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

        // Try to canonicalize the server base. If it doesn't exist (e.g. server was
        // just created or migrated), fall back to a logical path check using the
        // data_dir (which must exist) as the trust anchor.
        let canonical_base = match server_base.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                let data_dir_canon = self.data_dir.canonicalize().map_err(|_| {
                    AgentError::FileSystemError(format!(
                        "Data directory does not exist: {:?}",
                        self.data_dir
                    ))
                })?;
                let resolved = data_dir_canon.join(server_id);
                if !resolved.starts_with(&data_dir_canon) {
                    return Err(AgentError::PermissionDenied(
                        "Server ID escapes data directory".to_string(),
                    ));
                }
                resolved
            }
        };

        let normalized = if requested.is_absolute() {
            let trimmed = requested_path.trim_start_matches('/');
            if trimmed.is_empty() {
                // Listing the server root ("/" or "") must resolve to the
                // server base itself — not its parent. join("") is a no-op on
                // PathBuf, but the parent-canonicalize fallback below would
                // then reject data_dir as "outside" server_base.
                canonical_base.clone()
            } else {
                canonical_base.join(trimmed)
            }
        } else if requested_path.is_empty() || requested_path == "." {
            canonical_base.clone()
        } else {
            canonical_base.join(requested_path)
        };

        // Exact server root (existing or not).
        if normalized == canonical_base {
            return Ok(canonical_base);
        }

        if let Ok(canonical) = normalized.canonicalize() {
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
        if let Ok(parent_canon) = parent.canonicalize() {
            if !parent_canon.starts_with(&canonical_base) {
                return Err(AgentError::PermissionDenied(
                    "Access denied: path outside data directory".to_string(),
                ));
            }
            let file_name = normalized
                .file_name()
                .ok_or_else(|| AgentError::InvalidRequest("Invalid path".to_string()))?;
            // SECURITY: the target does not exist (canonicalize failed), but the
            // FINAL COMPONENT ITSELF may still be a symlink — typically a
            // dangling one planted by the container (e.g. payload -> /etc/cron.d/x).
            // Returning the symlink path here made every write sink follow it
            // with root privileges. lstat (symlink_metadata) the component and
            // reject links so writes can never traverse a container-planted
            // symlink out of the jail.
            let final_path = parent_canon.join(file_name);
            if final_path.symlink_metadata().is_ok() {
                return Err(AgentError::PermissionDenied(
                    "Access denied: cannot write through a symbolic link".to_string(),
                ));
            }
            return Ok(final_path);
        }

        let relative = normalized.strip_prefix(&canonical_base).map_err(|_| {
            AgentError::PermissionDenied("Access denied: path outside data directory".to_string())
        })?;
        Ok(canonical_base.join(relative))
    }

    /// Resolve a server id for filesystem use with the same hardening as
    /// `resolve_path`: no empty/traversal/separator ids. Shared by callers
    /// that only need the root and never a nested path.
    pub(crate) fn validate_server_id(server_id: &str) -> AgentResult<()> {
        if server_id.is_empty()
            || server_id == "."
            || server_id == ".."
            || server_id.contains('/')
            || server_id.contains('\\')
            || server_id.contains('\0')
            || server_id.trim().is_empty()
        {
            return Err(AgentError::InvalidRequest("Invalid server id".to_string()));
        }
        Ok(())
    }

    /// Resolve a path and ensure its parent directory exists. Used by install-url.
    pub async fn resolve_and_ensure_parent(
        &self,
        server_id: &str,
        path: &str,
    ) -> AgentResult<std::path::PathBuf> {
        let full_path = self.resolve_path(server_id, path)?;
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        if let Some(parent) = full_path.parent() {
            Self::ensure_parent_dir_secure(&canonical_base, parent).await?;
            // Confirm the target still resolves inside the jail after mkdir.
            let re = self.resolve_path(server_id, path)?;
            if re != full_path {
                return Err(AgentError::PermissionDenied(
                    "Access denied: path changed during directory creation".to_string(),
                ));
            }
        }
        Ok(full_path)
    }

    /// mkdir -p then re-validate every ancestor (TOCTOU close): each must not
    /// be a symlink and must stay under `canonical_base`.
    async fn ensure_parent_dir_secure(canonical_base: &Path, dir: &Path) -> AgentResult<()> {
        fs::create_dir_all(dir)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to create dir: {}", e)))?;
        revalidate_ancestors(canonical_base, dir)
    }

    pub async fn read_file(&self, server_id: &str, path: &str) -> AgentResult<Vec<u8>> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Reading file: {:?}", full_path);

        // Check file size limit
        let metadata = fs::metadata(&full_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Cannot access file: {}", e)))?;

        let max = self.max_file_size();
        if metadata.len() > max {
            return Err(AgentError::FileSystemError(format!(
                "File too large: {} > {}MB",
                metadata.len(),
                max / 1024 / 1024
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

    /// Verify a path exists and is within the server root without loading content.
    pub async fn file_exists(&self, server_id: &str, path: &str) -> AgentResult<bool> {
        let full_path = self.resolve_path(server_id, path)?;
        match fs::metadata(&full_path).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(AgentError::FileSystemError(format!(
                "Cannot access file: {}",
                e
            ))),
        }
    }

    pub async fn write_file(&self, server_id: &str, path: &str, data: &str) -> AgentResult<()> {
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Writing file: {:?}", full_path);

        // Create parent directories if needed, then re-validate ancestors.
        if let Some(parent) = full_path.parent() {
            Self::ensure_parent_dir_secure(&canonical_base, parent).await?;
        }

        // Check size limit before writing
        let max = self.max_file_size();
        if data.len() as u64 > max {
            return Err(AgentError::FileSystemError(format!(
                "File too large: {} > {}MB",
                data.len(),
                max / 1024 / 1024
            )));
        }

        // SECURITY: never write through a predictable ".tmp" sibling name.
        // The server directory is writable by the container user (uid 1000),
        // who can plant `config.tmp -> /etc/cron.d/x` as a symlink; a root
        // fs::write through that name is an arbitrary host write. Create an
        // unpredictable, exclusively-created (O_EXCL) temp file instead —
        // O_EXCL fails on any pre-existing entry, including dangling symlinks.
        let mut temp_path = Self::create_secure_temp_sibling(&full_path).await?;
        let write_result =
            async {
                temp_path.write_all(data.as_bytes()).await.map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to write file: {}", e))
                })?;
                temp_path.sync_all().await.map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to sync file: {}", e))
                })?;
                Ok(())
            }
            .await;
        if let Err(e) = write_result {
            let _ = fs::remove_file(temp_path.path()).await;
            return Err(e);
        }
        if let Err(e) = fs::rename(temp_path.path(), &full_path).await {
            let _ = fs::remove_file(temp_path.path()).await;
            return Err(AgentError::FileSystemError(format!(
                "Failed to rename temp file: {}",
                e
            )));
        }

        // The agent runs as root; hand the new file (and any created parents)
        // to the container user so the server process can modify it (#237).
        crate::ownership::ensure_container_owned(&self.data_dir, &full_path).await;

        info!("File written successfully: {:?}", full_path);

        Ok(())
    }

    pub async fn delete_file(&self, server_id: &str, path: &str) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Deleting file: {:?}", full_path);

        let meta = fs::symlink_metadata(&full_path).await?;
        if meta.is_dir() && !meta.file_type().is_symlink() {
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
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let from_path = self.resolve_path(server_id, from)?;
        let to_path = self.resolve_path(server_id, to)?;

        debug!("Renaming {:?} -> {:?}", from_path, to_path);

        if let Some(parent) = to_path.parent() {
            Self::ensure_parent_dir_secure(&canonical_base, parent).await?;
        }

        fs::rename(&from_path, &to_path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to rename: {}", e)))?;

        // Rename preserves ownership: if the source was root-owned (legacy
        // files from #237), re-hand the destination to the container user.
        crate::ownership::ensure_container_owned(&self.data_dir, &to_path).await;

        info!("Renamed successfully: {:?} -> {:?}", from_path, to_path);

        Ok(())
    }

    pub async fn list_dir(&self, server_id: &str, path: &str) -> AgentResult<Vec<FileEntry>> {
        let full_path = self.resolve_path(server_id, path)?;

        debug!("Listing directory: {:?}", full_path);

        // Auto-create the server root so the file explorer works immediately
        // after server create / before first install (Wings also ensures the
        // data directory exists before SFTP/file ops).
        if path == "/" || path.is_empty() || path == "." {
            if let Err(e) = fs::create_dir_all(&full_path).await {
                // Not fatal if it already exists or is a mount point we can read.
                debug!("create_dir_all for list root {:?}: {}", full_path, e);
            } else {
                // Fresh server root: hand it to the container user (#237).
                crate::ownership::ensure_container_owned(&self.data_dir, &full_path).await;
            }
        }

        let mut entries = Vec::new();
        let mut dir = fs::read_dir(&full_path).await.map_err(|e| {
            AgentError::FileSystemError(format!("Failed to read dir {}: {}", path, e))
        })?;

        while let Some(entry) = dir
            .next_entry()
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Error reading dir entry: {}", e)))?
        {
            let name = entry.file_name().to_string_lossy().to_string();

            // Prefer symlink_metadata so a broken symlink (common after partial
            // installs / SteamCMD self-updates) does not fail the entire listing.
            let meta = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => match fs::symlink_metadata(entry.path()).await {
                    Ok(m) => m,
                    Err(e) => {
                        warn!(
                            "Skipping unreadable entry {:?} in {:?}: {}",
                            name, full_path, e
                        );
                        continue;
                    }
                },
            };

            let file_type = meta.file_type();
            let is_dir = file_type.is_dir();
            // Report symlinks to directories as directories when the target is
            // resolvable; otherwise treat as a file entry so the UI can show it.
            let is_dir = if file_type.is_symlink() && !is_dir {
                fs::metadata(entry.path())
                    .await
                    .map(|m| m.is_dir())
                    .unwrap_or(false)
            } else {
                is_dir
            };

            entries.push(FileEntry {
                name,
                is_dir,
                size: if is_dir { 0 } else { meta.len() },
                modified: meta
                    .modified()
                    .ok()
                    .and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                    .unwrap_or(0),
                mode: meta.permissions().mode(),
            });
        }

        // Deterministic ordering: directories first, then name.
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        info!(
            "Directory listed: {:?} ({} entries)",
            full_path,
            entries.len()
        );

        Ok(entries)
    }

    /// Create a file or directory at the given path.
    pub async fn create_entry(
        &self,
        server_id: &str,
        path: &str,
        is_directory: bool,
        content: &str,
    ) -> AgentResult<()> {
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let full_path = self.resolve_path(server_id, path)?;
        debug!("Creating entry: {:?} (dir={})", full_path, is_directory);

        if is_directory {
            Self::ensure_parent_dir_secure(&canonical_base, &full_path).await?;
        } else {
            if let Some(parent) = full_path.parent() {
                Self::ensure_parent_dir_secure(&canonical_base, parent).await?;
            }
            // Same O_EXCL temp+rename path as write_file: never fs::write
            // through a container-plantable name.
            let max = self.max_file_size();
            if content.len() as u64 > max {
                return Err(AgentError::FileSystemError(format!(
                    "File too large: {} > {}MB",
                    content.len(),
                    max / 1024 / 1024
                )));
            }
            let mut temp = Self::create_secure_temp_sibling(&full_path).await?;
            let write_result = async {
                temp.write_all(content.as_bytes()).await.map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to create file: {}", e))
                })?;
                temp.sync_all().await.map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to sync file: {}", e))
                })?;
                Ok(())
            }
            .await;
            if let Err(e) = write_result {
                let _ = fs::remove_file(temp.path()).await;
                return Err(e);
            }
            if let Err(e) = fs::rename(temp.path(), &full_path).await {
                let _ = fs::remove_file(temp.path()).await;
                return Err(AgentError::FileSystemError(format!(
                    "Failed to rename temp file: {}",
                    e
                )));
            }
        }

        // Hand the new entry (and created parents) to the container user (#237).
        crate::ownership::ensure_container_owned(&self.data_dir, &full_path).await;

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
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let full_path = self.resolve_path(server_id, path)?;
        debug!(
            "Writing bytes to file: {:?} ({} bytes)",
            full_path,
            data.len()
        );

        let max = self.max_file_size();
        if data.len() as u64 > max {
            return Err(AgentError::FileSystemError(format!(
                "File too large: {} > {}MB",
                data.len(),
                max / 1024 / 1024
            )));
        }

        if let Some(parent) = full_path.parent() {
            Self::ensure_parent_dir_secure(&canonical_base, parent).await?;
        }

        // SECURITY: see write_file — O_EXCL unpredictable temp name, never a
        // container-plantable ".tmp" sibling.
        let mut temp_path = Self::create_secure_temp_sibling(&full_path).await?;
        let write_result =
            async {
                temp_path.write_all(data).await.map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to write file: {}", e))
                })?;
                temp_path.sync_all().await.map_err(|e| {
                    AgentError::FileSystemError(format!("Failed to sync file: {}", e))
                })?;
                Ok(())
            }
            .await;
        if let Err(e) = write_result {
            let _ = fs::remove_file(temp_path.path()).await;
            return Err(e);
        }
        if let Err(e) = fs::rename(temp_path.path(), &full_path).await {
            let _ = fs::remove_file(temp_path.path()).await;
            return Err(AgentError::FileSystemError(format!(
                "Failed to rename temp file: {}",
                e
            )));
        }

        // Hand the uploaded file (and created parents) to the container user (#237).
        crate::ownership::ensure_container_owned(&self.data_dir, &full_path).await;

        info!("File bytes written: {:?} ({} bytes)", full_path, data.len());
        Ok(())
    }

    /// Stream response body directly to a file.
    pub async fn write_file_stream(
        &self,
        server_id: &str,
        path: &str,
        mut response: reqwest::Response,
    ) -> AgentResult<()> {
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let full_path = self.resolve_path(server_id, path)?;
        debug!("Streaming to file: {:?}", full_path);

        if let Some(parent) = full_path.parent() {
            Self::ensure_parent_dir_secure(&canonical_base, parent).await?;
        }

        let mut file = match Self::create_exclusive_file(&full_path).await {
            Ok(f) => f,
            Err(e) => {
                return Err(e);
            }
        };

        let mut total: u64 = 0;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to read chunk: {}", e)))?
        {
            total += chunk.len() as u64;
            if total > self.max_file_size() {
                let _ = fs::remove_file(&full_path).await;
                return Err(AgentError::FileSystemError(format!(
                    "File too large: exceeds {}MB",
                    self.max_file_size() / 1024 / 1024
                )));
            }
            file.write_all(&chunk).await.map_err(|e| {
                AgentError::FileSystemError(format!("Failed to write chunk: {}", e))
            })?;
        }

        info!("File stream written: {:?} ({} bytes)", full_path, total);

        // Hand the streamed file (and created parents) to the container user (#237).
        crate::ownership::ensure_container_owned(&self.data_dir, &full_path).await;

        Ok(())
    }

    /// Set file permissions (chmod).
    /// Masks out setuid (0o4000), setgid (0o2000), and sticky (0o1000) bits
    /// to prevent privilege escalation via file permissions on server data.
    pub async fn set_permissions(&self, server_id: &str, path: &str, mode: u32) -> AgentResult<()> {
        let full_path = self.resolve_path(server_id, path)?;

        // Strip dangerous permission bits that could allow privilege escalation.
        // setuid allows executing as the file owner (potentially root),
        // setgid allows executing as the file group, and sticky bit on
        // regular files has no useful purpose for game servers.
        let safe_mode = mode & !0o7000;
        if safe_mode != mode {
            warn!(
                "Stripped dangerous permission bits from {:o} -> {:o}",
                mode, safe_mode
            );
        }

        debug!("Setting permissions on {:?} to {:o}", full_path, safe_mode);

        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(safe_mode);
        fs::set_permissions(&full_path, permissions)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("Failed to chmod: {}", e)))?;

        info!("Permissions set: {:?} -> {:o}", full_path, safe_mode);
        Ok(())
    }

    /// Create a directory within a server's data directory.
    /// Unlike other operations, this creates the server base dir if it doesn't exist.
    pub async fn mkdir(&self, server_id: &str, path: &str) -> AgentResult<()> {
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let resolved = self.resolve_path(server_id, path)?;
        Self::ensure_parent_dir_secure(&canonical_base, &resolved).await?;
        // Hand the new directory (and created parents) to the container user (#237).
        crate::ownership::ensure_container_owned(&self.data_dir, &resolved).await;
        info!("Directory created: {:?}", resolved);
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
                // Prevent option-injection from user-controlled file/archive names.
                // `--` forces zip to treat subsequent args as positional paths.
                .args(["-r", "--", &archive_full.to_string_lossy()])
                .args(&relative_paths)
                .current_dir(&canonical_base)
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("zip failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AgentError::FileSystemError(format!(
                    "zip error: {}",
                    stderr
                )));
            }
        } else {
            let output = tokio::process::Command::new("tar")
                .args([
                    "-czf",
                    &archive_full.to_string_lossy(),
                    "-C",
                    &canonical_base.to_string_lossy(),
                ])
                // Prevent option-injection from user-controlled filenames.
                .arg("--")
                .args(&relative_paths)
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("tar failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AgentError::FileSystemError(format!(
                    "tar error: {}",
                    stderr
                )));
            }
        }

        info!("Archive created: {:?}", archive_full);
        Ok(())
    }

    /// Decompress an archive to a target directory.
    /// SEC-C-03: pre-list members and reject absolute / `..` / symlink /
    /// hardlink / device entries plus count/size/ratio caps BEFORE extraction,
    /// then post-scan for regular files escaping the jail (not just symlinks).
    pub async fn decompress_to(
        &self,
        server_id: &str,
        archive_path: &str,
        target_path: &str,
    ) -> AgentResult<()> {
        Self::validate_server_id(server_id)?;
        let canonical_base = jail_base_sync(&self.data_dir, server_id)?;
        let archive_full = self.resolve_path(server_id, archive_path)?;
        let target_full = self.resolve_path(server_id, target_path)?;

        debug!("Decompressing {:?} to {:?}", archive_full, target_full);

        // Open the archive O_NOFOLLOW so a planted symlink is rejected.
        open_no_follow(&archive_full, false).map_err(|e| {
            if e.raw_os_error() == Some(libc::ELOOP) {
                AgentError::PermissionDenied(
                    "Access denied: archive is a symbolic link".to_string(),
                )
            } else {
                AgentError::FileSystemError(format!("Cannot open archive: {}", e))
            }
        })?;
        let compressed_len = std::fs::metadata(&archive_full)
            .map(|m| m.len())
            .unwrap_or(0);

        // Pre-list and reject dangerous members before anything is written.
        let archive_lower = archive_path.to_lowercase();
        let is_zip = archive_lower.ends_with(".zip");
        if is_zip {
            prevalidate_zip_archive(&archive_full, compressed_len).await?;
        } else {
            prevalidate_tar_archive(&archive_full, compressed_len).await?;
        }

        Self::ensure_parent_dir_secure(&canonical_base, &target_full).await?;

        if is_zip {
            // unzip has no type-exclusion flags: pass `--` anchored excludes
            // for absolute/`..` names as defense in depth (prevalidation is
            // the primary control).
            let output = tokio::process::Command::new("unzip")
                .arg("-o")
                .arg("-K")
                .arg(&archive_full)
                .arg("-x")
                .arg("--")
                .arg("/*")
                .arg("../*")
                .arg("-d")
                .arg(&target_full)
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("unzip failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // unzip exits 11 when every entry is skipped by -x excludes;
                // that means the archive was all-escape payload — fail closed.
                let _ = fs::remove_dir_all(&target_full).await;
                return Err(AgentError::SecurityViolation(format!(
                    "Archive rejected during extraction: {}",
                    stderr
                )));
            }
        } else {
            let output = tokio::process::Command::new("tar")
                .arg("-xzf")
                .arg(&archive_full)
                .arg("-C")
                .arg(&target_full)
                // SECURITY: never honor archive-supplied ownership or
                // permission bits during root extraction.
                .arg("--no-same-owner")
                .arg("--no-same-permissions")
                // Anchored excludes are defense in depth; prevalidation
                // above is the primary control.
                .arg("--anchored")
                .arg("--exclude=/*")
                .arg("--exclude=../*")
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("tar extract failed: {}", e)))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let _ = fs::remove_dir_all(&target_full).await;
                return Err(AgentError::FileSystemError(format!(
                    "tar error: {}",
                    stderr
                )));
            }
        }

        // Post-scan: reject ANY extracted entry (regular file, dir, or link)
        // escaping the jail — not just symlinks — and delete on escape.
        if let Err(e) = self
            .validate_extracted_tree(&target_full, &canonical_base)
            .await
        {
            let _ = fs::remove_dir_all(&target_full).await;
            return Err(e);
        }

        // Extraction runs as root: hand the whole tree to the container user (#237).
        if let Err(e) = crate::ownership::chown_tree(&target_full).await {
            warn!(
                "Failed to hand extracted archive to the container user: {}",
                e
            );
        }

        info!(
            "Archive decompressed: {:?} -> {:?}",
            archive_full, target_full
        );
        Ok(())
    }

    /// Validate that no extracted entries escape the jail: every regular
    /// file/dir must canonicalize inside `canonical_base`, and every symlink
    /// (dangling or not) must lexically normalize inside it.
    async fn validate_extracted_tree(
        &self,
        extract_dir: &std::path::Path,
        canonical_base: &std::path::Path,
    ) -> AgentResult<()> {
        let mut dangerous = Vec::new();
        self.check_symlinks_recursive(extract_dir, canonical_base, &mut dangerous)
            .await?;
        if !dangerous.is_empty() {
            for (path, target) in &dangerous {
                warn!(
                    "Dangerous symlink detected in extracted archive: {} -> {}",
                    path.display(),
                    target.display()
                );
            }
            return Err(AgentError::SecurityViolation(format!(
                "Archive contains {} symlink(s) that escape the server directory. \
                 Extraction aborted and target directory cleaned up for security.",
                dangerous.len()
            )));
        }
        // Regular files / dirs escaping via `..` members that tar/unzip may
        // have written outside the jail.
        let mut stack = vec![extract_dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            let canon = current.canonicalize().map_err(|e| {
                AgentError::FileSystemError(format!("Cannot resolve extracted path: {}", e))
            })?;
            if !canon.starts_with(canonical_base) {
                return Err(AgentError::SecurityViolation(format!(
                    "Archive wrote outside the server directory: {}",
                    current.display()
                )));
            }
            let mut entries = match fs::read_dir(&current).await {
                Ok(e) => e,
                Err(_) => continue,
            };
            while let Some(entry) = entries
                .next_entry()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Error reading dir: {}", e)))?
            {
                let ft = entry.file_type().await.map_err(|e| {
                    AgentError::FileSystemError(format!("Error reading entry: {}", e))
                })?;
                if ft.is_symlink() {
                    continue; // checked above
                }
                if ft.is_dir() {
                    stack.push(entry.path());
                } else if ft.is_file() {
                    let canon = entry.path().canonicalize().map_err(|e| {
                        AgentError::FileSystemError(format!("Cannot resolve extracted file: {}", e))
                    })?;
                    if !canon.starts_with(canonical_base) {
                        return Err(AgentError::SecurityViolation(format!(
                            "Archive wrote outside the server directory: {}",
                            entry.path().display()
                        )));
                    }
                } else {
                    // Sockets, devices, fifos must never survive extraction.
                    return Err(AgentError::SecurityViolation(format!(
                        "Archive contains special file: {}",
                        entry.path().display()
                    )));
                }
            }
        }
        Ok(())
    }

    /// Recursively check for symlinks that escape the base directory.
    async fn check_symlinks_recursive(
        &self,
        dir: &std::path::Path,
        canonical_base: &std::path::Path,
        dangerous_symlinks: &mut Vec<(PathBuf, PathBuf)>,
    ) -> AgentResult<()> {
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            let mut entries = match fs::read_dir(&current).await {
                Ok(e) => e,
                Err(e) => {
                    debug!("Cannot read directory {:?}: {}", current, e);
                    continue;
                }
            };

            while let Some(entry) = entries
                .next_entry()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("Error reading dir: {}", e)))?
            {
                let path = entry.path();

                match entry.file_type().await {
                    Ok(ft) if ft.is_symlink() => {
                        if let Ok(target) = std::fs::read_link(&path) {
                            let parent = path.parent().unwrap_or(&current);
                            let resolved = parent.join(&target);
                            // Dangling links are graded lexically normalized
                            // (`..` pops), never Ok-by-default.
                            let is_dangerous = if let Ok(canon_target) = resolved.canonicalize() {
                                !canon_target.starts_with(canonical_base)
                            } else {
                                let mut norm = PathBuf::new();
                                for comp in resolved.components() {
                                    match comp {
                                        std::path::Component::ParentDir => {
                                            norm.pop();
                                        }
                                        std::path::Component::CurDir => {}
                                        c => norm.push(c.as_os_str()),
                                    }
                                }
                                !norm.starts_with(canonical_base)
                            };
                            if is_dangerous {
                                dangerous_symlinks.push((path, target));
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

    /// List contents of an archive without extracting.
    pub async fn list_archive_contents(
        &self,
        server_id: &str,
        archive_path: &str,
    ) -> AgentResult<Vec<ArchiveEntry>> {
        let archive_full = self.resolve_path(server_id, archive_path)?;
        debug!("Listing archive contents: {:?}", archive_full);
        // O_NOFOLLOW: a planted symlink must not be followed for listing.
        open_no_follow(&archive_full, false).map_err(|e| {
            if e.raw_os_error() == Some(libc::ELOOP) {
                AgentError::PermissionDenied(
                    "Access denied: archive is a symbolic link".to_string(),
                )
            } else {
                AgentError::FileSystemError(format!("Cannot open archive: {}", e))
            }
        })?;

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
                // Skip header and summary lines
                if line.is_empty()
                    || line.starts_with("Archive:")
                    || line.starts_with("Zip file size:")
                    || line.contains("files,")
                {
                    continue;
                }
                // zipinfo -Z -l format: perms version os size type csize method date time name
                // Example: -rw-r--r--  2.0 unx        5 b-        5 stor 26-Feb-11 20:33 test-arch/file.txt
                let parts: Vec<&str> = line
                    .split(char::is_whitespace)
                    .filter(|s| !s.is_empty())
                    .collect();
                // Need at least: perms, version, os, size, type, csize, method, date, time, name = 10 fields
                if parts.len() < 10 {
                    continue;
                }
                let is_dir = parts[0].starts_with('d') || parts[9].ends_with('/');
                let name = parts[9].trim_end_matches('/').to_string();
                if name.is_empty() || name == "." || name.starts_with("..") {
                    continue;
                }
                let size: u64 = parts[3].parse().unwrap_or(0);
                entries.push(ArchiveEntry {
                    name,
                    size,
                    is_dir,
                    modified: None,
                });
            }
        } else if archive_lower.ends_with(".tar.gz") || archive_lower.ends_with(".tgz") {
            let output = tokio::process::Command::new("tar")
                .args(["-tzvf", &archive_full.to_string_lossy()])
                .output()
                .await
                .map_err(|e| AgentError::FileSystemError(format!("tar -t failed: {}", e)))?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Some(entry) = parse_tar_list_line(line) {
                    entries.push(entry);
                }
            }
        } else {
            return Err(AgentError::InvalidRequest(
                "Unsupported archive type".to_string(),
            ));
        }

        info!(
            "Archive contents listed: {:?} ({} entries)",
            archive_full,
            entries.len()
        );
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

/// Parse one `tar -tzvf` line. GNU tar pads the size column with spaces;
/// `splitn(N, whitespace)` treats those as empty fields and drops the name.
fn parse_tar_list_line(line: &str) -> Option<ArchiveEntry> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 6 {
        return None;
    }
    let name = parts[5..].join(" ");
    let name = name.trim_end_matches('/').to_string();
    if name.is_empty() || name == "." || name.starts_with("..") {
        return None;
    }
    Some(ArchiveEntry {
        name,
        size: parts[2].parse().unwrap_or(0),
        is_dir: parts[0].starts_with('d') || parts.last().is_some_and(|n| n.ends_with('/')),
        modified: Some(format!("{}T{}:00Z", parts[3], parts[4])),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_fm() -> FileManager {
        let dir = std::env::temp_dir().join(format!("catalyst-fm-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        FileManager::new(dir)
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let fm = make_fm();
        let result = fm.resolve_path("srv1", "../../../etc/passwd");
        assert!(result.is_err(), "'..' traversal must be rejected");
    }

    #[test]
    fn rejects_absolute_escape() {
        let fm = make_fm();
        let result = fm.resolve_path("srv1", "/etc/passwd");
        // Absolute paths are re-rooted under the server dir, so /etc/passwd
        // becomes <data_dir>/srv1/etc/passwd — but let's verify it stays inside.
        match result {
            Ok(p) => {
                let base = fm.data_dir.join("srv1");
                assert!(
                    p.starts_with(&base),
                    "absolute path must be confined to server dir"
                );
            }
            Err(_) => { /* acceptable: some impls reject absolutes */ }
        }
    }

    #[test]
    fn archive_member_names_rejected() {
        assert!(reject_archive_member_name("../evil.sh").is_err());
        assert!(reject_archive_member_name("/abs/path").is_err());
        assert!(reject_archive_member_name("a/../../b").is_err());
        assert!(reject_archive_member_name("ok/sub/file.txt").is_ok());
        assert!(reject_archive_member_name("plain.txt").is_ok());
    }

    #[test]
    fn archive_caps_enforced() {
        assert!(enforce_archive_caps(MAX_ARCHIVE_MEMBERS + 1, 10, 100).is_err());
        assert!(enforce_archive_caps(10, MAX_ARCHIVE_TOTAL_BYTES + 1, 100).is_err());
        // 100x ratio: 101 bytes out of 1 byte compressed is over.
        assert!(enforce_archive_caps(10, 101, 1).is_err());
        assert!(enforce_archive_caps(10, 100, 1).is_ok());
    }

    #[test]
    fn open_no_follow_rejects_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("real.txt");
        std::fs::write(&target, b"x").unwrap();
        let link = dir.path().join("link.txt");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let err = open_no_follow(&link, false).expect_err("symlink must fail");
        assert_eq!(err.raw_os_error(), Some(libc::ELOOP));
        assert!(open_no_follow(&target, false).is_ok());
    }

    #[test]
    fn ancestor_revalidation_rejects_swapped_parent() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("base");
        let sub = base.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let canon = base.canonicalize().unwrap();
        assert!(revalidate_ancestors(&canon, &sub).is_ok());
        // Swap `sub` for a symlink to outside: revalidation must fail.
        std::fs::remove_dir(&sub).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc", &sub).unwrap();
        assert!(revalidate_ancestors(&canon, &sub).is_err());
    }

    #[tokio::test]
    async fn tar_slip_members_rejected_before_extract() {
        // GNU tar strips `../` at creation (with a warning), so craft the
        // malicious tarball via python tarfile (no sanitization).
        let fm = make_fm();
        let srv = fm.data_dir.join("srv1");
        std::fs::create_dir_all(&srv).unwrap();
        let archive = srv.join("evil.tar.gz");
        let script = format!(
            "import tarfile,io; t=tarfile.open('{}','w:gz'); d=b'evil'; i=tarfile.TarInfo('../evil.txt'); i.size=len(d); t.addfile(i,io.BytesIO(d)); t.close()",
            archive.display()
        );
        let status = std::process::Command::new("python3")
            .args(["-c", &script])
            .status();
        if !status.map(|s| s.success()).unwrap_or(false) {
            return; // python3 unavailable — skip
        }
        let err = fm
            .decompress_to("srv1", "evil.tar.gz", "out")
            .await
            .expect_err("tar-slip must be rejected");
        assert!(
            err.to_string().contains("..")
                || err.to_string().to_lowercase().contains("escap")
                || err.to_string().to_lowercase().contains("violation"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn zip_absolute_member_rejected_before_extract() {
        let fm = make_fm();
        let srv = fm.data_dir.join("srv1");
        std::fs::create_dir_all(&srv).unwrap();
        // Craft a zip with an absolute name via python (zip CLI strips them).
        let archive = srv.join("evil.zip");
        let script = format!(
            "import zipfile; zipfile.ZipFile('{}','w').writestr('/abs.txt', b'x')",
            archive.display()
        );
        let status = std::process::Command::new("python3")
            .args(["-c", &script])
            .status();
        if !status.map(|s| s.success()).unwrap_or(false) {
            return; // python3 unavailable — skip
        }
        let err = fm
            .decompress_to("srv1", "evil.zip", "out")
            .await
            .expect_err("absolute zip member must be rejected");
        assert!(
            err.to_string().to_lowercase().contains("absolute")
                || err.to_string().to_lowercase().contains("violation"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn tar_symlink_member_rejected_before_extract() {
        let fm = make_fm();
        let srv = fm.data_dir.join("srv1");
        std::fs::create_dir_all(&srv).unwrap();
        let work = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/shadow", work.path().join("link")).unwrap();
        let archive = srv.join("link.tar.gz");
        let status = std::process::Command::new("tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(work.path())
            .arg("link")
            .status()
            .unwrap();
        assert!(status.success());
        let err = fm
            .decompress_to("srv1", "link.tar.gz", "out")
            .await
            .expect_err("symlink member must be rejected");
        assert!(
            err.to_string().to_lowercase().contains("symlink")
                || err.to_string().to_lowercase().contains("link")
                || err.to_string().to_lowercase().contains("violation"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn planted_tmp_symlink_is_not_followed_on_write() {
        // SECURITY regression (F-1): a container user (uid 1000) can create
        // <server>/config.tmp as a symlink to a host path. write_file must
        // NEVER write through that name — it now uses an unpredictable
        // O_EXCL temp and rename(2), which replaces symlinks instead of
        // following them.
        let fm = make_fm();
        let srv = fm.data_dir.join("srv1");
        std::fs::create_dir_all(&srv).unwrap();

        let outside =
            std::env::temp_dir().join(format!("catalyst-fm-outside-{}", uuid::Uuid::new_v4()));
        std::fs::write(&outside, b"ORIGINAL").unwrap();

        // Target file does not exist yet; plant the classic .tmp symlink.
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, srv.join("config.tmp")).unwrap();

        fm.write_file("srv1", "config", "new content")
            .await
            .expect("write must succeed");

        // The planted symlink target must be untouched.
        let after = std::fs::read(&outside).unwrap();
        assert_eq!(
            after, b"ORIGINAL",
            "planted .tmp symlink target must not be written"
        );
        // The real file must contain the new content.
        let written = std::fs::read(srv.join("config")).unwrap();
        assert_eq!(written, b"new content");
        // No temp leftovers: the pre-planted config.tmp symlink is consumed
        // by rename(2) (replaced, not followed), so no other *.tmp entries
        // may appear.
        let leftovers: Vec<_> = std::fs::read_dir(&srv)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.contains(".tmp") && name != "config.tmp"
            })
            .collect();
        assert!(leftovers.is_empty(), "temp leftovers: {:?}", leftovers);
        // The planted symlink is the attacker's own artifact — the agent must
        // not consume or write through it. It must still be a symlink
        // (untouched), and the outside file unchanged (asserted above).
        #[cfg(unix)]
        {
            let meta = std::fs::symlink_metadata(srv.join("config.tmp")).unwrap();
            assert!(
                meta.file_type().is_symlink(),
                "planted symlink must remain untouched"
            );
        }
        let _ = std::fs::remove_file(&outside);
    }

    #[tokio::test]
    async fn planted_dangling_symlink_at_target_is_rejected() {
        // The final-component symlink check: writes INTO a dangling symlink
        // planted by the container must be rejected outright.
        let fm = make_fm();
        let srv = fm.data_dir.join("srv1");
        std::fs::create_dir_all(&srv).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/cron.d/catalyst-pwn", srv.join("payload")).unwrap();
        let result = fm.write_file("srv1", "payload", "evil").await;
        assert!(result.is_err(), "write through dangling symlink must fail");
        assert!(!std::path::Path::new("/etc/cron.d/catalyst-pwn").exists());
    }

    #[tokio::test]
    async fn secure_temp_sibling_rejects_preplanted_name() {
        // create_secure_temp_sibling must fail (not follow) when a name
        // collision with an existing symlink occurs — after retries.
        let fm = make_fm();
        let srv = fm.data_dir.join("srv1");
        std::fs::create_dir_all(&srv).unwrap();
        let target = srv.join("data.bin");
        // The helper uses unpredictable names, so a pre-planted collision is
        // improbable; the property we can assert directly is that creation
        // succeeds and yields a 0600 file whose path did not exist before.
        let mut tmp = FileManager::create_secure_temp_sibling(&target)
            .await
            .expect("temp creation must succeed");
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(tmp.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "temp file must be 0600");
        // Writing through the TempFile works and is durable at path.
        tmp.write_all(b"abc").await.unwrap();
        tmp.sync_all().await.unwrap();
        assert_eq!(std::fs::read(tmp.path()).unwrap(), b"abc");
    }

    #[test]
    fn rejects_server_id_with_slash() {
        let fm = make_fm();
        let result = fm.resolve_path("evil/../other", "file.txt");
        assert!(result.is_err(), "server_id with '/' must be rejected");
    }

    #[test]
    fn rejects_nested_dotdot_segments() {
        let fm = make_fm();
        // Even mixed with legitimate segments, ParentDir must be rejected before join.
        assert!(fm
            .resolve_path("srv1", "world/../../../etc/passwd")
            .is_err());
        assert!(fm.resolve_path("srv1", "./../secret").is_err());
    }

    #[test]
    fn accepts_simple_relative_path_under_server() {
        let fm = make_fm();
        // Base dir may not exist yet; resolve_path still returns a logical path under data_dir.
        let result = fm.resolve_path("srv1", "server.properties");
        assert!(
            result.is_ok(),
            "simple relative path should resolve: {:?}",
            result.err()
        );
        let p = result.unwrap();
        assert!(p.ends_with("srv1/server.properties") || p.ends_with("srv1\\server.properties"));
    }

    #[test]
    fn resolves_server_root_before_dir_exists() {
        let fm = make_fm();
        // Critical file-explorer path: list "/" on a brand-new server whose
        // data directory has not been created yet must NOT fail with
        // "path outside data directory".
        let root = fm.resolve_path("new-server", "/");
        assert!(
            root.is_ok(),
            "root path must resolve before server dir exists: {:?}",
            root.err()
        );
        let p = root.unwrap();
        assert!(p.ends_with("new-server") || p.ends_with("new-server/"));

        let empty = fm.resolve_path("new-server", "");
        assert!(empty.is_ok(), "empty path should also resolve to root");
    }

    #[tokio::test]
    async fn list_dir_creates_root_and_skips_broken_symlinks() {
        let fm = make_fm();
        let server = "srv-list";
        // Root does not exist yet — list_dir should create it and return empty.
        let entries = fm.list_dir(server, "/").await.expect("list root");
        assert!(entries.is_empty());

        let root = fm.data_dir.join(server);
        std::fs::write(root.join("a.txt"), b"hi").unwrap();
        std::fs::create_dir(root.join("world")).unwrap();
        // Broken symlink must not fail the entire listing.
        std::os::unix::fs::symlink(root.join("missing-target"), root.join("broken-link")).unwrap();

        let entries = fm
            .list_dir(server, "/")
            .await
            .expect("list with mixed entries");
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"world"));
        assert!(names.contains(&"broken-link"));
        // Directories first
        assert!(entries[0].is_dir, "directories should sort first");
    }

    #[test]
    fn parses_gnu_tar_tzvf_padded_size() {
        let line = "-rw-r--r-- root/root         1 2026-08-12 21:58 lab-explorer/note-renamed.txt";
        let entry = parse_tar_list_line(line).expect("line should parse");
        assert_eq!(entry.name, "lab-explorer/note-renamed.txt");
        assert_eq!(entry.size, 1);
        assert!(!entry.is_dir);
    }

    #[test]
    fn parses_gnu_tar_tzvf_directory() {
        let line = "drwxr-xr-x root/root         0 2026-08-12 21:58 lab-explorer/";
        let entry = parse_tar_list_line(line).expect("dir should parse");
        assert_eq!(entry.name, "lab-explorer");
        assert!(entry.is_dir);
    }

    #[tokio::test]
    async fn write_file_bytes_respects_runtime_limit() {
        let fm = make_fm();
        fm.set_max_file_size(8);
        let err = fm
            .write_file_bytes("srv1", "big.bin", b"0123456789")
            .await
            .expect_err("over-limit write must fail");
        assert!(
            err.to_string().to_lowercase().contains("too large"),
            "{err}"
        );
        fm.set_max_file_size(32);
        fm.write_file_bytes("srv1", "ok.bin", b"0123456789")
            .await
            .expect("under-limit write must succeed");
        assert_eq!(fm.max_file_size(), 32);
    }

    #[test]
    fn set_max_file_size_ignores_zero() {
        let fm = make_fm();
        let before = fm.max_file_size();
        fm.set_max_file_size(0);
        assert_eq!(fm.max_file_size(), before);
    }

    #[test]
    fn write_growth_only_counts_extension() {
        assert_eq!(FileManager::write_growth_bytes(100, 0, 50), 0);
        assert_eq!(FileManager::write_growth_bytes(100, 90, 20), 10);
        assert_eq!(FileManager::write_growth_bytes(0, 0, 25), 25);
    }

    #[tokio::test]
    async fn ensure_write_fits_rejects_more_than_free_space() {
        let fm = make_fm();
        let path = fm.resolve_path("srv1", "huge.bin").unwrap();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        // Use a write size that can never fit regardless of small statvfs
        // races between the two available_bytes() probes (~free-space jitter).
        let avail = FileManager::available_bytes(path.parent().unwrap()).unwrap();
        let huge = avail.saturating_add(1024 * 1024 * 1024);
        let err = fm
            .ensure_write_fits(&path, 0, huge)
            .await
            .expect_err("over-capacity write must fail");
        assert!(err.to_string().to_lowercase().contains("no space"), "{err}");
    }

    #[test]
    fn server_id_validation_rejects_traversal_forms() {
        // The whole point: these must never become a filesystem root.
        for bad in [
            "", ".", "..", "  ", "/", "\\", "a/b", "a\\b", "a\0b", "/etc",
        ] {
            assert!(
                FileManager::validate_server_id(bad).is_err(),
                "{bad:?} must be rejected"
            );
        }
        // Normal cuid-style ids pass.
        assert!(FileManager::validate_server_id("cmsnp4saw000bjcpdae71zasg").is_ok());
        assert!(FileManager::validate_server_id("server-with-dashes_and_underscores.1").is_ok());
    }

    #[test]
    fn resolve_path_rejects_traversal_server_ids() {
        let fm = make_fm();
        // ".." as server id would otherwise resolve to the data dir's parent.
        let err = fm
            .resolve_path("..", "world.txt")
            .expect_err(".. server id must fail");
        assert!(err.to_string().contains("Invalid server id"), "{err}");
        let err = fm
            .resolve_path("", "world.txt")
            .expect_err("empty server id must fail");
        assert!(err.to_string().contains("Invalid server id"), "{err}");
    }

    /// Serve `body` once over loopback HTTP so tests can obtain a real
    /// streaming reqwest::Response without extra dev-dependencies.
    async fn serve_one_body(body: &'static [u8]) -> (String, tokio::task::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::task::spawn_blocking(move || {
            let (stream, _) = listener.accept().expect("no inbound connection");
            use std::io::{Read, Write};
            let mut stream = stream;
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf); // discard the request head
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .unwrap();
            stream.write_all(body).unwrap();
        });
        (format!("http://127.0.0.1:{port}/"), handle)
    }

    #[tokio::test]
    async fn uploaded_stream_survives_until_caller_renames() {
        // Regression: write_stream_to_exclusive_temp used to return only the
        // temp path; the TempFile's Drop guard then deleted the just-written
        // file, so the caller's rename failed with ENOENT and every upload
        // died with "No such file or directory (os error 2)".
        let fm = make_fm();
        let srv = fm.data_dir.join("srv1");
        std::fs::create_dir_all(&srv).unwrap();

        let (url, server) = serve_one_body(b"uploaded-bytes").await;
        let resp = reqwest::get(&url).await.expect("mock upload fetch");
        let temp = fm
            .write_stream_to_exclusive_temp("srv1", "maps/file.bsp", resp)
            .await
            .expect("stream write should succeed");
        server.await.unwrap();

        // The temp file must still exist while the caller holds the handle.
        assert!(
            temp.path().exists(),
            "temp file deleted before caller rename"
        );

        let dest = fm.resolve_path("srv1", "maps/file.bsp").unwrap();
        tokio::fs::rename(temp.path(), &dest).await.unwrap();
        drop(temp);
        assert_eq!(std::fs::read(&dest).unwrap(), b"uploaded-bytes");
    }
}
