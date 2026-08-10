//! SFTP server module for the Catalyst Agent.
//!
//! Runs an SSH/SFTP server on the node, allowing users to connect
//! with standard SFTP clients (FileZilla, WinSCP, etc.).
//!
//! Authentication is delegated to the backend via
//! `POST /api/agent/sftp/validate-token`. The backend validates
//! the `sftp_`-prefixed token and returns the userId + permissions.
//!
//! File operations use the existing `FileManager` for path resolution
//! and sandbox enforcement.
//!
//! ## Handle Strategy
//!
//! SFTP handles are opaque strings returned by `open`/`opendir` and
//! passed back to `read`/`write`/`readdir`/`close`. We encode the
//! path directly in the handle string so we don't need mutable state
//! across async method calls:
//! - File handles: `"file:{counter}:{path}"`
//! - Dir handles:  `"dir:{counter}:{path}"`
//!
//! ## Readdir Pagination
//!
//! The SFTP protocol calls `readdir` repeatedly until it returns EOF.
//! Since our handler methods return `impl Future` and can't share
//! mutable state across calls, we return **all** entries on the first
//! call and the client caches them. Subsequent calls return EOF.
//! (This matches how most SFTP server implementations work in practice.)

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io::SeekFrom;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use russh::server::{Auth, Msg, Server, Session};
use russh::{Channel, ChannelId, MethodSet};
use russh_sftp::protocol::{
    File, FileAttributes, Handle, Name, OpenFlags, Packet, Status, StatusCode, Version,
};

use crate::config::AgentConfig;
use crate::file_manager::FileManager;

// ---------------------------------------------------------------------------
// SFTP server configuration
// ---------------------------------------------------------------------------

/// SFTP-specific configuration extracted from AgentConfig.
#[derive(Debug, Clone)]
pub struct SftpConfig {
    /// Port the SFTP server listens on.
    pub port: u16,
    /// Path to the SSH host key file.
    pub host_key_path: PathBuf,
    /// Whether SFTP is enabled.
    pub enabled: bool,
    /// Backend HTTP URL for token validation.
    pub backend_url: String,
    /// Agent API key for authenticating with the backend.
    pub api_key: String,
    /// Node ID for authenticating with the backend.
    pub node_id: String,
    /// Maximum file size for SFTP write operations (bytes).
    pub max_file_size: u64,
}

impl SftpConfig {
    pub fn from_agent_config(config: &AgentConfig) -> Self {
        let backend_http = {
            let url = config.server.backend_url.clone();
            let stripped = if let Some(rest) = url.strip_prefix("wss://") {
                format!("https://{}", rest)
            } else if let Some(rest) = url.strip_prefix("ws://") {
                format!("http://{}", rest)
            } else {
                url
            };
            stripped
                .trim_end_matches("/ws")
                .trim_end_matches('/')
                .to_string()
        };

        Self {
            port: std::env::var("SFTP_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(config.sftp.port),
            host_key_path: std::env::var("SFTP_HOST_KEY")
                .ok()
                .map(PathBuf::from)
                .unwrap_or_else(|| config.sftp.host_key_path.clone()),
            enabled: std::env::var("SFTP_ENABLED")
                .ok()
                .map(|v| v != "false" && v != "0")
                .unwrap_or(true),
            backend_url: backend_http,
            api_key: config.server.api_key.clone(),
            node_id: config.server.node_id.clone(),
            max_file_size: std::env::var("SFTP_MAX_FILE_SIZE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100 * 1024 * 1024),
        }
    }
}

// ---------------------------------------------------------------------------
// Token validation via backend
// ---------------------------------------------------------------------------

async fn validate_sftp_token(
    config: &SftpConfig,
    token: &str,
    server_id: &str,
) -> Result<Option<(String, String, Vec<String>)>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/agent/sftp/validate-token", config.backend_url);

    let resp = client
        .post(&url)
        .header("x-catalyst-node-id", &config.node_id)
        .header("x-catalyst-node-token", &config.api_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "token": token,
            "serverId": server_id,
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Backend returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let data = body.get("data").ok_or("Missing data field")?;
    let valid = data.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);

    if !valid {
        return Ok(None);
    }

    let user_id = data
        .get("userId")
        .and_then(|v| v.as_str())
        .ok_or("Missing userId")?
        .to_string();
    let server_uuid = data
        .get("serverUuid")
        .and_then(|v| v.as_str())
        .ok_or("Missing serverUuid")?
        .to_string();
    let permissions = data
        .get("permissions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    Ok(Some((user_id, server_uuid, permissions)))
}

// ---------------------------------------------------------------------------
// SFTP Handler implementation (russh-sftp server::Handler trait)
// ---------------------------------------------------------------------------

static HANDLE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Tracks which directory handles have been fully read.
/// Key = handle string, Value = true if readdir has returned entries.
static DIR_READ_STATE: once_cell::sync::Lazy<std::sync::Mutex<HashMap<String, bool>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

/// Recover from a poisoned mutex instead of panicking the SFTP task.
fn dir_read_state_lock() -> std::sync::MutexGuard<'static, HashMap<String, bool>> {
    DIR_READ_STATE.lock().unwrap_or_else(|poisoned| {
        tracing::warn!("DIR_READ_STATE mutex was poisoned; recovering inner map");
        poisoned.into_inner()
    })
}

/// SFTP handler backed by FileManager.
struct CatalystSftpHandler {
    file_manager: Arc<FileManager>,
    server_id: String,
    permissions: Vec<String>,
    max_file_size: u64,
    /// Directory handles opened by this session; cleared on Drop so
    /// DIR_READ_STATE does not leak if the client disconnects without close.
    open_dir_handles: Arc<std::sync::Mutex<HashSet<String>>>,
}

#[derive(Debug, Clone)]
struct SftpError(String);

impl From<SftpError> for StatusCode {
    fn from(err: SftpError) -> StatusCode {
        // Map common error messages to appropriate SFTP status codes
        if err.0 == "EOF" {
            StatusCode::Eof
        } else if err.0.starts_with("Permission denied") {
            StatusCode::PermissionDenied
        } else if err.0.starts_with("No such file") {
            StatusCode::NoSuchFile
        } else {
            StatusCode::Failure
        }
    }
}

impl CatalystSftpHandler {
    fn new(
        file_manager: Arc<FileManager>,
        server_id: String,
        permissions: Vec<String>,
        max_file_size: u64,
    ) -> Self {
        Self {
            file_manager,
            server_id,
            permissions,
            max_file_size,
            open_dir_handles: Arc::new(std::sync::Mutex::new(HashSet::new())),
        }
    }

    fn has_permission(permissions: &[String], perm: &str) -> bool {
        permissions.contains(&"*".to_string()) || permissions.contains(&perm.to_string())
    }

    /// Create a file handle encoding the path.
    fn make_file_handle(path: &str) -> String {
        let id = HANDLE_COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("file:{}:{}", id, path)
    }

    /// Create a directory handle encoding the path.
    fn make_dir_handle(path: &str) -> String {
        let id = HANDLE_COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("dir:{}:{}", id, path)
    }

    /// Extract the path from a handle string (format: `type:counter:path`).
    fn path_from_handle(handle: &str) -> Option<String> {
        let parts: Vec<&str> = handle.splitn(3, ':').collect();
        if parts.len() == 3 {
            Some(parts[2].to_string())
        } else {
            None
        }
    }

    fn status_ok(id: u32) -> Status {
        Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: String::new(),
        }
    }
}

impl Drop for CatalystSftpHandler {
    fn drop(&mut self) {
        // Session ended — purge any dir handles this handler still owns.
        let handles = match self.open_dir_handles.lock() {
            Ok(mut g) => g.drain().collect::<Vec<_>>(),
            Err(poisoned) => poisoned.into_inner().drain().collect::<Vec<_>>(),
        };
        if handles.is_empty() {
            return;
        }
        let mut state = dir_read_state_lock();
        for h in handles {
            state.remove(&h);
        }
    }
}

impl russh_sftp::server::Handler for CatalystSftpHandler {
    type Error = SftpError;

    fn unimplemented(&self) -> Self::Error {
        SftpError("Not implemented".to_string())
    }

    async fn init(
        &mut self,
        _version: u32,
        _extensions: HashMap<String, String>,
    ) -> Result<Version, Self::Error> {
        tracing::info!("SFTP init received");
        Ok(Version::new())
    }

    fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> impl Future<Output = Result<Handle, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let permissions = self.permissions.clone();

        async move {
            let is_write = pflags.contains(OpenFlags::WRITE)
                || pflags.contains(OpenFlags::CREATE)
                || pflags.contains(OpenFlags::TRUNCATE);

            tracing::info!("SFTP open: {} (write={})", filename, is_write);

            if is_write && !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }
            if !is_write && !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }

            if is_write {
                // Create parent dirs and the file itself only when CREATE/TRUNCATE require it.
                // CREATE without TRUNCATE must not wipe an existing file (append/open-for-write).
                if let Err(e) = fm.resolve_and_ensure_parent(&server_id, &filename).await {
                    return Err(SftpError(format!("Failed to resolve path: {}", e)));
                }
                let full_path = fm
                    .resolve_path(&server_id, &filename)
                    .map_err(|e| SftpError(format!("Failed to resolve path: {}", e)))?;
                let exists = tokio::fs::metadata(&full_path).await.is_ok();
                if pflags.contains(OpenFlags::TRUNCATE)
                    || (pflags.contains(OpenFlags::CREATE) && !exists)
                {
                    // Only wipe/create when TRUNCATE is set, or CREATE on a missing file.
                    let _ = fm.write_file(&server_id, &filename, "").await;
                } else if pflags.contains(OpenFlags::CREATE) && exists {
                    // CREATE without TRUNCATE on existing file: leave content intact.
                } else if !exists {
                    return Err(SftpError("No such file".into()));
                }
            } else {
                // Verify file exists without loading content into memory.
                let exists = fm
                    .file_exists(&server_id, &filename)
                    .await
                    .map_err(|e| SftpError(format!("Failed to open file: {}", e)))?;
                if !exists {
                    return Err(SftpError("No such file".into()));
                }
            }

            Ok(Handle {
                handle: Self::make_file_handle(&filename),
                id,
            })
        }
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        // Clean up directory read state
        {
            let mut state = dir_read_state_lock();
            state.remove(&handle);
        }
        match self.open_dir_handles.lock() {
            Ok(mut owned) => {
                owned.remove(&handle);
            }
            Err(poisoned) => {
                poisoned.into_inner().remove(&handle);
            }
        }
        Ok(Self::status_ok(id))
    }

    fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> impl Future<Output = Result<russh_sftp::protocol::Data, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let path = Self::path_from_handle(&handle).unwrap_or_default();

        async move {
            // Stream: resolve path (permission check), then seek+read exactly
            // len bytes instead of loading the entire file into memory.
            let full_path = fm
                .resolve_path(&server_id, &path)
                .map_err(|e| SftpError(format!("Read failed: {}", e)))?;

            let mut file = tokio::fs::File::open(&full_path)
                .await
                .map_err(|e| SftpError(format!("Read failed: {}", e)))?;

            let file_len = file
                .metadata()
                .await
                .map_err(|e| SftpError(format!("Read failed: {}", e)))?
                .len();

            if offset >= file_len {
                return Err(SftpError("EOF".into()));
            }

            file.seek(SeekFrom::Start(offset))
                .await
                .map_err(|e| SftpError(format!("Read seek failed: {}", e)))?;

            let to_read = std::cmp::min(len as u64, file_len - offset) as usize;
            let mut buf = vec![0u8; to_read];
            let n = file
                .read(&mut buf)
                .await
                .map_err(|e| SftpError(format!("Read failed: {}", e)))?;
            buf.truncate(n);

            if n == 0 {
                return Err(SftpError("EOF".into()));
            }

            Ok(russh_sftp::protocol::Data { id, data: buf })
        }
    }

    fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> impl Future<Output = Result<Status, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let permissions = self.permissions.clone();
        let max_file_size = self.max_file_size;
        let path = Self::path_from_handle(&handle).unwrap_or_default();

        async move {
            if !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }

            // Stream: seek directly to the offset and write the chunk.
            // Avoids O(n²) read-modify-write of the entire file per chunk.
            if offset.saturating_add(data.len() as u64) > max_file_size {
                return Err(SftpError("File too large".into()));
            }

            let full_path = fm
                .resolve_path(&server_id, &path)
                .map_err(|e| SftpError(format!("Write failed: {}", e)))?;

            if let Some(parent) = full_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| SftpError(format!("Write failed: {}", e)))?;
            }

            // truncate(false): random-access seek+write; CREATE alone must not wipe.
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(false)
                .open(&full_path)
                .await
                .map_err(|e| SftpError(format!("Write failed: {}", e)))?;

            file.seek(SeekFrom::Start(offset))
                .await
                .map_err(|e| SftpError(format!("Write seek failed: {}", e)))?;

            file.write_all(&data)
                .await
                .map_err(|e| SftpError(format!("Write failed: {}", e)))?;

            Ok(Self::status_ok(id))
        }
    }

    fn lstat(
        &mut self,
        id: u32,
        path: String,
    ) -> impl Future<Output = Result<russh_sftp::protocol::Attrs, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();

        async move {
            let full_path = fm
                .resolve_path(&server_id, &path)
                .map_err(|e| SftpError(format!("{}", e)))?;

            let metadata = tokio::fs::symlink_metadata(&full_path)
                .await
                .map_err(|e| SftpError(format!("lstat failed: {}", e)))?;

            Ok(russh_sftp::protocol::Attrs {
                id,
                attrs: FileAttributes::from(&metadata),
            })
        }
    }

    fn fstat(
        &mut self,
        id: u32,
        handle: String,
    ) -> impl Future<Output = Result<russh_sftp::protocol::Attrs, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let path = Self::path_from_handle(&handle).unwrap_or_default();

        async move {
            let full_path = fm
                .resolve_path(&server_id, &path)
                .map_err(|e| SftpError(format!("{}", e)))?;

            let metadata = tokio::fs::metadata(&full_path)
                .await
                .map_err(|e| SftpError(format!("fstat failed: {}", e)))?;

            Ok(russh_sftp::protocol::Attrs {
                id,
                attrs: FileAttributes::from(&metadata),
            })
        }
    }

    fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> impl Future<Output = Result<Status, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let permissions = self.permissions.clone();

        async move {
            if !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }

            if let Some(mode) = attrs.permissions {
                fm.set_permissions(&server_id, &path, mode)
                    .await
                    .map_err(|e| SftpError(format!("chmod failed: {}", e)))?;
            }

            Ok(Self::status_ok(id))
        }
    }

    fn fsetstat(
        &mut self,
        id: u32,
        _handle: String,
        _attrs: FileAttributes,
    ) -> impl Future<Output = Result<Status, Self::Error>> + Send {
        let permissions = self.permissions.clone();
        async move {
            if !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }
            Ok(Self::status_ok(id))
        }
    }

    fn opendir(
        &mut self,
        id: u32,
        path: String,
    ) -> impl Future<Output = Result<Handle, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let permissions = self.permissions.clone();
        let open_dirs = self.open_dir_handles.clone();

        async move {
            tracing::info!("SFTP opendir: path='{}', server_id='{}'", path, server_id);

            if !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }

            // Verify the directory exists
            if let Err(e) = fm.list_dir(&server_id, &path).await {
                tracing::error!("SFTP opendir: list_dir failed for '{}': {}", path, e);
                return Err(SftpError(format!("Failed to open directory: {}", e)));
            }

            let handle_str = Self::make_dir_handle(&path);

            // Mark this handle as "not yet read" and track for session Drop cleanup
            {
                let mut state = dir_read_state_lock();
                state.insert(handle_str.clone(), false);
            }
            match open_dirs.lock() {
                Ok(mut g) => {
                    g.insert(handle_str.clone());
                }
                Err(poisoned) => {
                    poisoned.into_inner().insert(handle_str.clone());
                }
            }

            Ok(Handle {
                handle: handle_str,
                id,
            })
        }
    }

    fn readdir(
        &mut self,
        id: u32,
        handle: String,
    ) -> impl Future<Output = Result<Name, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let path = Self::path_from_handle(&handle).unwrap_or_default();

        async move {
            tracing::info!("SFTP readdir: {}", path);

            // Check if this handle has already been read
            let already_read = {
                let mut state = dir_read_state_lock();
                match state.get_mut(&handle) {
                    Some(done) => {
                        if *done {
                            true
                        } else {
                            *done = true;
                            false
                        }
                    }
                    None => false,
                }
            };

            if already_read {
                // Second call → signal EOF
                tracing::info!("SFTP readdir: EOF for {}", path);
                return Err(SftpError("EOF".into()));
            }

            let entries = fm
                .list_dir(&server_id, &path)
                .await
                .map_err(|e| SftpError(format!("readdir failed: {}", e)))?;

            if entries.is_empty() {
                return Err(SftpError("EOF".into()));
            }

            let files: Vec<File> = entries
                .iter()
                .map(|e| {
                    let longname = if e.is_dir {
                        format!("drwxr-xr-x\t{}\t{}", e.size, e.name)
                    } else {
                        format!("-rw-r--r--\t{}\t{}", e.size, e.name)
                    };

                    let attrs = FileAttributes {
                        size: Some(e.size),
                        permissions: Some(if e.is_dir {
                            0o40000 | 0o755
                        } else {
                            e.mode & 0o777
                        }),
                        mtime: Some(e.modified as u32),
                        atime: Some(e.modified as u32),
                        ..Default::default()
                    };

                    File {
                        filename: e.name.clone(),
                        longname,
                        attrs,
                    }
                })
                .collect();

            Ok(Name { id, files })
        }
    }

    fn remove(
        &mut self,
        id: u32,
        filename: String,
    ) -> impl Future<Output = Result<Status, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let permissions = self.permissions.clone();
        async move {
            if !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }
            fm.delete_file(&server_id, &filename)
                .await
                .map_err(|e| SftpError(format!("{}", e)))?;
            Ok(Self::status_ok(id))
        }
    }

    fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> impl Future<Output = Result<Status, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let permissions = self.permissions.clone();
        async move {
            if !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }
            fm.mkdir(&server_id, &path)
                .await
                .map_err(|e| SftpError(format!("{}", e)))?;
            Ok(Self::status_ok(id))
        }
    }

    fn rmdir(
        &mut self,
        id: u32,
        path: String,
    ) -> impl Future<Output = Result<Status, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();
        let permissions = self.permissions.clone();
        async move {
            if !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }
            fm.delete_file(&server_id, &path)
                .await
                .map_err(|e| SftpError(format!("{}", e)))?;
            Ok(Self::status_ok(id))
        }
    }

    fn realpath(
        &mut self,
        id: u32,
        path: String,
    ) -> impl Future<Output = Result<Name, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();

        async move {
            tracing::info!("SFTP realpath: path='{}', server_id='{}'", path, server_id);

            let full_path = match fm.resolve_path(&server_id, &path) {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("SFTP realpath: resolve_path failed for '{}': {}", path, e);
                    return Err(SftpError(format!("{}", e)));
                }
            };

            let base = match fm.resolve_path(&server_id, "/") {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("SFTP realpath: resolve_path '/' failed: {}", e);
                    return Err(SftpError(format!("{}", e)));
                }
            };

            let relative = full_path.strip_prefix(&base).unwrap_or(&full_path);
            let sftp_path = format!("/{}", relative.to_string_lossy().trim_start_matches('/'));

            tracing::info!("SFTP realpath: resolved '{}' -> '{}'", path, sftp_path);

            Ok(Name {
                id,
                files: vec![File::dummy(sftp_path)],
            })
        }
    }

    fn stat(
        &mut self,
        id: u32,
        path: String,
    ) -> impl Future<Output = Result<russh_sftp::protocol::Attrs, Self::Error>> + Send {
        let fm = self.file_manager.clone();
        let server_id = self.server_id.clone();

        async move {
            tracing::info!("SFTP stat: path='{}', server_id='{}'", path, server_id);

            let full_path = match fm.resolve_path(&server_id, &path) {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("SFTP stat: resolve_path failed for '{}': {}", path, e);
                    return Err(SftpError(format!("{}", e)));
                }
            };

            let metadata = tokio::fs::metadata(&full_path).await.map_err(|e| {
                tracing::error!("SFTP stat: metadata failed for {:?}: {}", full_path, e);
                SftpError(format!("stat failed: {}", e))
            })?;

            Ok(russh_sftp::protocol::Attrs {
                id,
                attrs: FileAttributes::from(&metadata),
            })
        }
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        if !Self::has_permission(&self.permissions, "file.write") {
            return Err(SftpError("Permission denied".into()));
        }
        self.file_manager
            .rename_file(&self.server_id, &oldpath, &newpath)
            .await
            .map_err(|e| SftpError(format!("{}", e)))?;
        Ok(Self::status_ok(id))
    }

    async fn readlink(&mut self, _id: u32, _path: String) -> Result<Name, Self::Error> {
        Err(SftpError("Not implemented".into()))
    }

    async fn symlink(
        &mut self,
        _id: u32,
        _linkpath: String,
        _targetpath: String,
    ) -> Result<Status, Self::Error> {
        Err(SftpError("Not implemented".into()))
    }

    fn extended(
        &mut self,
        _id: u32,
        request: String,
        _data: Vec<u8>,
    ) -> impl Future<Output = Result<Packet, Self::Error>> + Send {
        let request = request.clone();
        async move { Err(SftpError(format!("Unsupported extension: {}", request))) }
    }
}

// ---------------------------------------------------------------------------
// SSH server implementation
// ---------------------------------------------------------------------------

struct CatalystSshServer {
    config: Arc<SftpConfig>,
    file_manager: Arc<FileManager>,
    clients: Arc<AtomicUsize>,
}

impl Server for CatalystSshServer {
    type Handler = SshSession;

    fn new_client(&mut self, peer_addr: Option<std::net::SocketAddr>) -> Self::Handler {
        let count = self.clients.fetch_add(1, Ordering::Relaxed) + 1;
        tracing::info!(
            "New SFTP connection from {:?} (total clients: {})",
            peer_addr,
            count
        );
        SshSession {
            config: self.config.clone(),
            file_manager: self.file_manager.clone(),
            authenticated: false,
            user_id: None,
            server_id: None,
            permissions: Vec::new(),
            clients: self.clients.clone(),
            channels: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}

struct SshSession {
    config: Arc<SftpConfig>,
    file_manager: Arc<FileManager>,
    authenticated: bool,
    user_id: Option<String>,
    server_id: Option<String>,
    permissions: Vec<String>,
    clients: Arc<AtomicUsize>,
    /// Channels stored when `channel_open_session` fires, retrieved in
    /// `subsystem_request` so we can convert them to an async stream
    /// for the SFTP subsystem.
    channels: Arc<tokio::sync::Mutex<HashMap<ChannelId, Channel<Msg>>>>,
}

impl Drop for SshSession {
    fn drop(&mut self) {
        self.clients.fetch_sub(1, Ordering::Relaxed);
    }
}

#[async_trait::async_trait]
impl russh::server::Handler for SshSession {
    type Error = anyhow::Error;

    async fn auth_publickey_offered(
        &mut self,
        _user: &str,
        _public_key: &russh::keys::PublicKey,
    ) -> Result<Auth, Self::Error> {
        // SFTP only supports password auth (sftp_ tokens).
        // Reject publickey at the offer stage so the client doesn't
        // waste time signing a challenge.
        Ok(Auth::Reject {
            proceed_with_methods: Some(MethodSet::PASSWORD),
        })
    }

    async fn auth_publickey(
        &mut self,
        _user: &str,
        _public_key: &russh::keys::PublicKey,
    ) -> Result<Auth, Self::Error> {
        // Reject publickey signature too (belt and suspenders).
        Ok(Auth::Reject {
            proceed_with_methods: Some(MethodSet::PASSWORD),
        })
    }

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        let server_id = user;

        if !password.starts_with("sftp_") {
            tracing::warn!(
                "SFTP auth rejected: non-sftp token for server {}",
                server_id
            );
            return Ok(Auth::Reject {
                proceed_with_methods: Some(MethodSet::PASSWORD),
            });
        }

        match validate_sftp_token(&self.config, password, server_id).await {
            Ok(Some((user_id, server_uuid, permissions))) => {
                tracing::info!(
                    "SFTP auth succeeded: user {} for server {} (uuid={})",
                    user_id,
                    server_id,
                    server_uuid
                );
                self.authenticated = true;
                self.user_id = Some(user_id);
                self.server_id = Some(server_uuid);
                self.permissions = permissions;
                Ok(Auth::Accept)
            }
            Ok(None) => {
                tracing::warn!("SFTP auth failed: invalid token for server {}", server_id);
                Ok(Auth::Reject {
                    proceed_with_methods: Some(MethodSet::PASSWORD),
                })
            }
            Err(e) => {
                tracing::error!("SFTP token validation error: {}", e);
                Ok(Auth::Reject {
                    proceed_with_methods: Some(MethodSet::PASSWORD),
                })
            }
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        let mut channels = self.channels.lock().await;
        channels.insert(channel.id(), channel);
        Ok(true)
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            tracing::warn!("Rejected subsystem request: {}", name);
            let _ = session.channel_failure(channel_id);
            return Ok(());
        }

        if !self.authenticated {
            tracing::warn!("SFTP subsystem requested before authentication");
            let _ = session.channel_failure(channel_id);
            return Ok(());
        }

        // Retrieve the channel we stored in channel_open_session.
        let channel = {
            let mut channels = self.channels.lock().await;
            channels.remove(&channel_id)
        };

        let channel = match channel {
            Some(ch) => ch,
            None => {
                tracing::error!(
                    "SFTP subsystem requested for unknown channel {}",
                    channel_id
                );
                let _ = session.channel_failure(channel_id);
                return Ok(());
            }
        };

        // Accept the subsystem and start the SFTP handler.
        session.channel_success(channel_id)?;

        let server_id = self.server_id.clone().unwrap_or_default();
        let file_manager = self.file_manager.clone();
        let permissions = self.permissions.clone();
        let max_file_size = self.config.max_file_size;

        tracing::info!("SFTP subsystem started for server {}", server_id);

        // Convert the SSH channel into an AsyncRead+AsyncWrite stream,
        // then hand it off to the russh-sftp server loop.
        let stream = channel.into_stream();
        let handler =
            CatalystSftpHandler::new(file_manager, server_id.clone(), permissions, max_file_size);

        tracing::info!(
            "SFTP: calling russh_sftp::server::run for server {}",
            server_id
        );
        russh_sftp::server::run(stream, handler).await;
        tracing::info!(
            "SFTP: russh_sftp::server::run returned for server {}",
            server_id
        );

        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel_id: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.close(channel_id)?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SFTP server start function
// ---------------------------------------------------------------------------

/// Load or generate an SSH host key.
fn load_or_generate_host_key(path: &PathBuf) -> Result<ssh_key::PrivateKey, String> {
    if path.exists() {
        let key_data =
            std::fs::read(path).map_err(|e| format!("Failed to read host key: {}", e))?;
        let key_str = String::from_utf8_lossy(&key_data);
        let key = ssh_key::PrivateKey::from_openssh(key_str.as_ref())
            .map_err(|e| format!("Failed to decode host key: {}", e))?;
        return Ok(key);
    }

    tracing::warn!(
        "No SFTP host key found at {:?} — generating a new one",
        path
    );

    let mut rng = rand_08::rngs::OsRng;
    let key = ssh_key::PrivateKey::random(&mut rng, ssh_key::Algorithm::Ed25519)
        .map_err(|e| format!("Failed to generate host key: {}", e))?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create host key directory: {}", e))?;
    }

    let pem = key
        .to_openssh(ssh_key::LineEnding::LF)
        .map_err(|e| format!("Failed to encode host key: {}", e))?;
    std::fs::write(path, &pem).map_err(|e| format!("Failed to write host key: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, perms)
            .map_err(|e| format!("Failed to set host key permissions: {}", e))?;
    }

    Ok(key)
}

/// Start the SFTP server as a background task.
pub async fn start_sftp_server(
    config: SftpConfig,
    file_manager: Arc<FileManager>,
) -> Result<(), String> {
    if !config.enabled {
        tracing::info!("SFTP server disabled — not starting");
        return Ok(());
    }

    let host_key = load_or_generate_host_key(&config.host_key_path)?;
    let port = config.port;

    // Allow the SFTP port through the host firewall.
    // Uses a dedicated tracking key "__sftp__" so the rule is not
    // confused with per-server container port rules. SFTP only needs TCP.
    //
    // First, remove any previously-tracked SFTP rule (handles port changes
    // and ensures a clean state).
    crate::firewall_manager::FirewallManager::remove_server_ports("__sftp__").await;

    // Now add the current SFTP port.
    if let Err(e) =
        crate::firewall_manager::FirewallManager::allow_port(port, "tcp", "0.0.0.0", "__sftp__")
            .await
    {
        tracing::warn!(
            "Failed to open SFTP port {} in firewall (non-fatal): {}",
            port,
            e
        );
    }

    let clients: Arc<AtomicUsize> = Arc::new(AtomicUsize::new(0));
    let config_arc = Arc::new(config.clone());

    let mut server = CatalystSshServer {
        config: config_arc,
        file_manager,
        clients: clients.clone(),
    };

    let listen_addr = format!("0.0.0.0:{}", port);

    let russh_config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    });

    tracing::info!("SFTP server starting on port {}", port);

    server
        .run_on_address(russh_config, listen_addr.as_str())
        .await
        .map_err(|e| format!("SFTP server failed to start: {}", e))?;

    Ok(())
}
