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

use libc::ENOSPC;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use russh::server::{Auth, ChannelOpenHandle, Msg, Server, Session};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use russh_sftp::protocol::{
    File, FileAttributes, Handle, Name, OpenFlags, Packet, Status, StatusCode, Version,
};
use russh_sftp::server::StatusReply;

use crate::config::AgentConfig;
use crate::file_manager::FileManager;

/// Largest SFTP READ reply. Clients can reissue short reads until EOF;
/// returning a smaller reply avoids attacker-controlled multi-gigabyte buffers.
const MAX_SFTP_READ_CHUNK: usize = 1024 * 1024;
// ---------------------------------------------------------------------------
// File-change notifications
// ---------------------------------------------------------------------------
//
// The panel's file manager refreshes on the `server_files_changed` SSE event.
// Web uploads emit it from the backend's file routes; SFTP mutations happen
// entirely on the node, so the agent reports them over its own control-plane
// WebSocket and the gateway translates the message into the same SSE event.
//
// The message carries `serverId` (mandatory: the gateway fans out per server
// and applies access scoping) and mirrors the backend's payload shape
// (routes/servers/files.ts `notifyFileChange`): `{ type, serverId, action,
// path | from/to, timestamp }`.

/// Backend-visible message type. The gateway maps this onto the
/// `server_files_changed` SSE event.
const FILES_CHANGED_MESSAGE_TYPE: &str = "server_files_changed";

/// Coalescing window for repeated writes to the same (server, path).
///
/// SFTP delivers a file as many `write` calls at increasing offsets (32 KB
/// chunks in practice). Emitting per chunk would flood the panel for a large
/// upload, so successive writes to one path collapse into a single event.
const WRITE_COALESCE_WINDOW: std::time::Duration = std::time::Duration::from_secs(1);

/// Paths with a pending coalesced write, keyed by `"{server_id}\u{1}{path}"`.
/// Value = when the first un-emitted write for that path was seen.
static PENDING_WRITES: once_cell::sync::Lazy<
    std::sync::Mutex<HashMap<String, std::time::Instant>>,
> = once_cell::sync::Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

/// Lock the pending-write map, recovering from poisoning like DIR_READ_STATE.
fn pending_writes_lock() -> std::sync::MutexGuard<'static, HashMap<String, std::time::Instant>> {
    PENDING_WRITES.lock().unwrap_or_else(|poisoned| {
        tracing::warn!("PENDING_WRITES mutex was poisoned; recovering inner map");
        poisoned.into_inner()
    })
}

/// Key uniquely identifying one (server, path) coalescing slot.
///
/// The separator is a control character that cannot appear in a resolved SFTP
/// path, so `({"a", "b/c"})` can never collide with `({"a/b", "c"})`.
fn write_coalesce_key(server_id: &str, path: &str) -> String {
    format!("{}\u{1}{}", server_id, path)
}

/// Pure coalescing decision over a set of recently-emitted `(server, path)`
/// keys. Split out from the global map so the rule can be tested exactly,
/// without sharing process-wide mutable state between tests.
///
/// Returns `true` when this write should emit. On `true` the key is recorded at
/// `now`; expired entries are swept so the map stays bounded on a long-lived
/// agent that touches many distinct paths.
fn coalesce_write_at(
    seen: &mut HashMap<String, std::time::Instant>,
    key: &str,
    now: std::time::Instant,
    window: std::time::Duration,
) -> bool {
    seen.retain(|_, first_seen| now.saturating_duration_since(*first_seen) < window);
    if seen.contains_key(key) {
        return false;
    }
    seen.insert(key.to_string(), now);
    true
}

/// Decide whether a write to `(server_id, path)` should emit now.
///
/// Returns `true` only for the first write of a burst: within
/// [`WRITE_COALESCE_WINDOW`] further writes to the same path are suppressed, so
/// a chunked upload produces a bounded number of events regardless of size.
/// The first emit is never delayed — the panel must not wait a second to hear
/// that a file changed, and SFTP gives no reliable "final chunk" signal.
fn should_emit_write(server_id: &str, path: &str, now: std::time::Instant) -> bool {
    let key = write_coalesce_key(server_id, path);
    let mut pending = pending_writes_lock();
    coalesce_write_at(&mut pending, &key, now, WRITE_COALESCE_WINDOW)
}

/// Build the `server_files_changed` payload for one mutation.
///
/// `action` uses the same vocabulary as the backend's file routes (`write`,
/// `create`, `delete`, `rename`, `permissions`, `mkdir`, `rmdir`). `path` is the
/// SFTP-visible path; `rename` sends `from`/`to` instead, matching the backend.
fn files_changed_payload(
    server_id: &str,
    action: &str,
    path: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
) -> Option<serde_json::Value> {
    // A missing server id would make the gateway drop the event (it fans out
    // per server and scopes access by it), and a payload without a path cannot
    // be invalidated by the frontend. Refuse to emit either.
    if server_id.is_empty() {
        return None;
    }
    if path.is_none() && (from.is_none() || to.is_none()) {
        return None;
    }
    let mut payload = serde_json::json!({
        "type": FILES_CHANGED_MESSAGE_TYPE,
        "serverId": server_id,
        "action": action,
        "timestamp": chrono::Utc::now().timestamp_millis(),
    });
    let obj = payload.as_object_mut()?;
    if let Some(p) = path {
        obj.insert("path".to_string(), serde_json::Value::String(p.to_string()));
    }
    if let Some(f) = from {
        obj.insert("from".to_string(), serde_json::Value::String(f.to_string()));
    }
    if let Some(t) = to {
        obj.insert("to".to_string(), serde_json::Value::String(t.to_string()));
    }
    Some(payload)
}

/// Emit a file-change notification for a successful SFTP mutation.
///
/// Fire-and-forget: the payload is handed to the control-plane WebSocket
/// dispatcher, which spawns the send (and falls back to the existing
/// buffer-for-replay path when disconnected). A failure or a missing handler
/// is logged and dropped — it must never fail or delay the SFTP operation.
fn notify_files_changed(
    server_id: &str,
    action: &str,
    path: Option<&str>,
    from: Option<&str>,
    to: Option<&str>,
) {
    let Some(payload) = files_changed_payload(server_id, action, path, from, to) else {
        return;
    };
    let text = payload.to_string();
    if !crate::websocket_handler::dispatch_outbound_event(text) {
        tracing::debug!(
            "SFTP {} for server {} not dispatched (agent WebSocket not ready)",
            action,
            server_id
        );
    }
}

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
    /// Directory handles opened by this session; cleared on Drop so
    /// DIR_READ_STATE does not leak if the client disconnects without close.
    open_dir_handles: Arc<std::sync::Mutex<HashSet<String>>>,
}

#[derive(Debug, Clone)]
struct SftpError(String);

impl SftpError {
    fn status_code(&self) -> StatusCode {
        // Map common error messages to appropriate SFTP status codes
        if self.0 == "EOF" {
            StatusCode::Eof
        } else if self.0.starts_with("Permission denied") {
            StatusCode::PermissionDenied
        } else if self.0.starts_with("No such file") {
            StatusCode::NoSuchFile
        } else {
            StatusCode::Failure
        }
    }
}

impl From<SftpError> for StatusCode {
    fn from(err: SftpError) -> StatusCode {
        err.status_code()
    }
}

// russh-sftp ≥2.3 requires Handler::Error: Into<StatusReply>
impl From<SftpError> for StatusReply {
    fn from(err: SftpError) -> StatusReply {
        let message = err.0.clone();
        StatusReply::new(err.status_code()).with_message(message)
    }
}

/// Auth rejection that steers the client back to password auth.
fn reject_password() -> Auth {
    Auth::Reject {
        proceed_with_methods: Some(MethodSet::from([MethodKind::Password].as_slice())),
        partial_success: false,
    }
}

impl CatalystSftpHandler {
    fn new(file_manager: Arc<FileManager>, server_id: String, permissions: Vec<String>) -> Self {
        Self {
            file_manager,
            server_id,
            permissions,
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
                // O_NOFOLLOW probe: a planted symlink at the target is rejected
                // (ELOOP) instead of followed by root.
                match crate::file_manager::open_no_follow(&full_path, false) {
                    Ok(_) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => {
                        return Err(SftpError("Permission denied: refusing symlink".into()));
                    }
                }
                let exists = tokio::fs::metadata(&full_path).await.is_ok();
                let created = pflags.contains(OpenFlags::TRUNCATE)
                    || (pflags.contains(OpenFlags::CREATE) && !exists);
                if created {
                    // Only wipe/create when TRUNCATE is set, or CREATE on a missing file.
                    let _ = fm.write_file(&server_id, &filename, "").await;
                    // TRUNCATE/create is a real mutation on its own (a client may
                    // open-write and never send data). One event per open — no
                    // coalescing needed, and the subsequent chunk writes coalesce
                    // separately.
                    notify_files_changed(&server_id, "create", Some(&filename), None, None);
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
        let permissions = self.permissions.clone();

        async move {
            // SECURITY: reads were previously unguarded — a write-only sub-user
            // could fabricate a handle string and read in-jail files without
            // the file.read scope.
            if !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }
            // Stream: resolve path (permission check), then seek+read exactly
            // len bytes instead of loading the entire file into memory.
            // O_NOFOLLOW: a planted symlink at the target is rejected (ELOOP).
            let full_path = fm
                .resolve_path(&server_id, &path)
                .map_err(|e| SftpError(format!("Read failed: {}", e)))?;

            let std_file = crate::file_manager::open_no_follow(&full_path, false).map_err(|e| {
                if e.raw_os_error() == Some(libc::ELOOP) {
                    SftpError("Permission denied: refusing symlink".into())
                } else {
                    SftpError(format!("Read failed: {}", e))
                }
            })?;
            let mut file = tokio::fs::File::from_std(std_file);

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

            let to_read = std::cmp::min(
                std::cmp::min(len as u64, file_len - offset),
                MAX_SFTP_READ_CHUNK as u64,
            ) as usize;
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
        let path = Self::path_from_handle(&handle).unwrap_or_default();

        async move {
            if !Self::has_permission(&permissions, "file.write") {
                return Err(SftpError("Permission denied".into()));
            }

            // Stream: seek directly to the offset and write the chunk.
            // Cap is remaining space on the server's disk (loop quota / host FS),
            // not the panel web-upload limit.
            let full_path = fm
                .resolve_path(&server_id, &path)
                .map_err(|e| SftpError(format!("Write failed: {}", e)))?;

            if let Some(parent) = full_path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| SftpError(format!("Write failed: {}", e)))?;
            }

            if let Err(e) = fm
                .ensure_write_fits(&full_path, offset, data.len() as u64)
                .await
            {
                return Err(SftpError(e.to_string()));
            }

            // O_NOFOLLOW: never open through a planted symlink. Try a
            // no-follow open first; only when the file is missing fall back
            // to an O_EXCL create (which also refuses symlinks).
            let std_file = match crate::file_manager::open_no_follow(&full_path, true) {
                Ok(f) => f,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    use std::os::unix::fs::OpenOptionsExt;
                    std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .custom_flags(libc::O_NOFOLLOW)
                        .open(&full_path)
                        .map_err(|e| {
                            if e.raw_os_error() == Some(libc::ELOOP) {
                                SftpError("Permission denied: refusing symlink".into())
                            } else {
                                SftpError(format!("Write failed: {}", e))
                            }
                        })?
                }
                Err(e) => {
                    return Err(if e.raw_os_error() == Some(libc::ELOOP) {
                        SftpError("Permission denied: refusing symlink".into())
                    } else {
                        SftpError(format!("Write failed: {}", e))
                    });
                }
            };
            let mut file = tokio::fs::File::from_std(std_file);

            file.seek(SeekFrom::Start(offset))
                .await
                .map_err(|e| SftpError(format!("Write seek failed: {}", e)))?;

            file.write_all(&data).await.map_err(|e| {
                if e.raw_os_error() == Some(ENOSPC) {
                    SftpError("No space left on device".into())
                } else {
                    SftpError(format!("Write failed: {}", e))
                }
            })?;

            // SFTP writes bypass FileManager, so ownership is fixed here:
            // hand the file (and created parents) to the container user (#237).
            crate::ownership::ensure_container_owned(fm.data_dir(), &full_path).await;

            // Only after the bytes are durably written: coalesced so a chunked
            // upload emits once per window instead of once per 32 KB chunk.
            if should_emit_write(&server_id, &path, std::time::Instant::now()) {
                notify_files_changed(&server_id, "write", Some(&path), None, None);
            }

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
        let permissions = self.permissions.clone();

        async move {
            if !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }
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
        let permissions = self.permissions.clone();

        async move {
            if !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }
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
                notify_files_changed(&server_id, "permissions", Some(&path), None, None);
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
        let permissions = self.permissions.clone();

        async move {
            // SECURITY: dir handles are forgeable strings — without this gate
            // a write-only subuser could enumerate directory metadata.
            if !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }
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
            notify_files_changed(&server_id, "delete", Some(&filename), None, None);
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
            notify_files_changed(&server_id, "mkdir", Some(&path), None, None);
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
            notify_files_changed(&server_id, "rmdir", Some(&path), None, None);
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
        let permissions = self.permissions.clone();

        async move {
            if !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }
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
        let permissions = self.permissions.clone();

        async move {
            if !Self::has_permission(&permissions, "file.read") {
                return Err(SftpError("Permission denied".into()));
            }
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
        // Backend sends rename as from/to (no `path`); mirror that shape.
        notify_files_changed(
            &self.server_id,
            "rename",
            None,
            Some(&oldpath),
            Some(&newpath),
        );
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
        Ok(reject_password())
    }

    async fn auth_publickey(
        &mut self,
        _user: &str,
        _public_key: &russh::keys::PublicKey,
    ) -> Result<Auth, Self::Error> {
        // Reject publickey signature too (belt and suspenders).
        Ok(reject_password())
    }

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        let server_id = user;

        if !password.starts_with("sftp_") {
            tracing::warn!(
                "SFTP auth rejected: non-sftp token for server {}",
                server_id
            );
            return Ok(reject_password());
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
                Ok(reject_password())
            }
            Err(e) => {
                tracing::error!("SFTP token validation error: {}", e);
                Ok(reject_password())
            }
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let mut channels = self.channels.lock().await;
        channels.insert(channel.id(), channel);
        // russh 0.62: must explicitly accept via ChannelOpenHandle
        reply.accept().await;
        Ok(())
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
        tracing::info!("SFTP subsystem started for server {}", server_id);

        let stream = channel.into_stream();
        let handler = CatalystSftpHandler::new(file_manager, server_id.clone(), permissions);

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

    // russh 0.62 / ssh-key 0.7 + rand 0.10: use thread rng
    let key = ssh_key::PrivateKey::random(&mut rand::rng(), ssh_key::Algorithm::Ed25519)
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

#[cfg(test)]
mod file_change_notification_tests {
    use super::*;
    use serde_json::json;
    use std::time::{Duration, Instant};

    /// The payload must match the backend's `server_files_changed` contract
    /// (routes/servers/files.ts `notifyFileChange`): type, serverId, action,
    /// optional path / from+to, plus a timestamp.
    #[test]
    fn payload_matches_backend_contract_for_path_actions() {
        let p = files_changed_payload("srv1", "write", Some("/plugins/a.jar"), None, None)
            .expect("payload");
        assert_eq!(p["type"], json!("server_files_changed"));
        assert_eq!(p["serverId"], json!("srv1"));
        assert_eq!(p["action"], json!("write"));
        assert_eq!(p["path"], json!("/plugins/a.jar"));
        assert!(p["timestamp"].is_i64());
        // Absent keys must not be present as nulls — the FE checks `typeof`.
        assert!(p.get("from").is_none());
        assert!(p.get("to").is_none());
    }

    #[test]
    fn rename_payload_uses_from_to_and_no_path() {
        let p = files_changed_payload("srv1", "rename", None, Some("/a.txt"), Some("/b.txt"))
            .expect("payload");
        assert_eq!(p["from"], json!("/a.txt"));
        assert_eq!(p["to"], json!("/b.txt"));
        assert!(
            p.get("path").is_none(),
            "rename must mirror the backend shape"
        );
    }

    /// serverId is mandatory: the gateway fans out per server and applies
    /// access scoping with it, so an empty id must never be emitted.
    #[test]
    fn payload_refuses_empty_server_id() {
        assert!(files_changed_payload("", "write", Some("/a"), None, None).is_none());
    }

    /// A payload with neither a path nor a from/to pair gives the frontend
    /// nothing to invalidate.
    #[test]
    fn payload_refuses_missing_target() {
        assert!(files_changed_payload("srv1", "write", None, None, None).is_none());
        // Half a rename is not a usable target either.
        assert!(files_changed_payload("srv1", "rename", None, Some("/a"), None).is_none());
    }

    // ── Coalescing rule ─────────────────────────────────────────────────────
    // Tested through the pure `coalesce_write_at` over a local map: the real
    // rule is process-wide, and sharing that map across parallel tests would
    // make the sweep in one test prune another's entries.

    fn emit(seen: &mut HashMap<String, Instant>, server: &str, path: &str, at: Instant) -> bool {
        let key = write_coalesce_key(server, path);
        coalesce_write_at(seen, &key, at, WRITE_COALESCE_WINDOW)
    }

    #[test]
    fn write_coalesces_within_window() {
        let mut seen = HashMap::new();
        let t0 = Instant::now();
        assert!(emit(&mut seen, "srv", "/big.bin", t0), "first write emits");
        // Chunks arriving back-to-back at increasing offsets stay silent.
        for i in 1..=64u64 {
            assert!(
                !emit(
                    &mut seen,
                    "srv",
                    "/big.bin",
                    t0 + Duration::from_millis(i * 10)
                ),
                "chunk {} within the window must be coalesced",
                i
            );
        }
    }

    #[test]
    fn write_emits_again_after_window_elapses() {
        let mut seen = HashMap::new();
        let t0 = Instant::now();
        assert!(emit(&mut seen, "srv", "/f", t0));
        assert!(!emit(
            &mut seen,
            "srv",
            "/f",
            t0 + WRITE_COALESCE_WINDOW / 2
        ));
        assert!(
            emit(&mut seen, "srv", "/f", t0 + WRITE_COALESCE_WINDOW),
            "a later burst once the window elapsed emits again"
        );
    }

    /// Coalescing is per (server, path): a busy upload must not silence a
    /// different file, and one server's activity must not silence another's.
    #[test]
    fn write_coalescing_is_keyed_by_server_and_path() {
        let mut seen = HashMap::new();
        let t0 = Instant::now();
        assert!(emit(&mut seen, "srv-a", "/a", t0));
        assert!(emit(&mut seen, "srv-a", "/b", t0), "different path emits");
        assert!(emit(&mut seen, "srv-b", "/a", t0), "different server emits");
        assert!(
            !emit(&mut seen, "srv-a", "/a", t0 + Duration::from_millis(5)),
            "the original (server, path) is still coalescing"
        );
    }

    /// The separator must make (server, path) pairs unambiguous — a server id
    /// is attacker-influenced only via the backend, but the join must still not
    /// allow two distinct pairs to share one coalescing slot.
    #[test]
    fn coalesce_key_separates_server_from_path() {
        assert_ne!(
            write_coalesce_key("a", "b/c"),
            write_coalesce_key("a/b", "c"),
            "different (server, path) pairs must not collide"
        );
    }

    /// A large upload must produce a bounded number of events: N chunks in one
    /// window yield exactly one.
    #[test]
    fn large_upload_event_count_is_bounded() {
        let mut seen = HashMap::new();
        let t0 = Instant::now();
        // 100 MB in 32 KB chunks = 3200 write calls, all inside one window.
        let chunks = 3200u64;
        // 3200 * 200us = 0.64s < the 1s window.
        let step = Duration::from_micros(200);
        let emitted = (0..chunks)
            .filter(|i| emit(&mut seen, "srv", "/huge.tar", t0 + step * (*i as u32)))
            .count();
        assert_eq!(emitted, 1, "a chunked upload within one window emits once");
        assert_eq!(seen.len(), 1, "the map holds only the one live path");
    }

    /// Expired entries are swept, so the map cannot grow without bound on a
    /// long-lived agent that touches many distinct paths.
    #[test]
    fn expired_entries_are_swept() {
        let mut seen = HashMap::new();
        let t0 = Instant::now();
        assert!(emit(&mut seen, "srv", "/a", t0));
        assert!(emit(&mut seen, "srv", "/b", t0));
        assert_eq!(seen.len(), 2);

        // A write past the window prunes the stale entries, then records its own.
        assert!(emit(&mut seen, "srv", "/c", t0 + WRITE_COALESCE_WINDOW * 3));
        assert_eq!(seen.len(), 1, "expired entries must not accumulate");
    }

    /// The global wrapper must agree with the pure rule (one smoke test — the
    /// real rule is covered above without shared state).
    #[test]
    fn global_wrapper_emits_once_per_window() {
        // Unique ids keep this test independent of any other test's entries.
        let srv = "srv-global-wrapper";
        let t0 = Instant::now();
        assert!(should_emit_write(srv, "/smoke", t0));
        assert!(!should_emit_write(
            srv,
            "/smoke",
            t0 + WRITE_COALESCE_WINDOW / 2
        ));
    }

    /// Actions shared with the backend file routes must use the same spelling,
    /// so one frontend case covers both paths. `mkdir`/`rmdir` are SFTP-only
    /// (the backend creates directories via `create`); the frontend keys its
    /// invalidation on `path`/`from`/`to`, not on `action`, so they need no
    /// frontend change.
    #[test]
    fn shared_actions_keep_the_backend_spelling() {
        const BACKEND_ACTIONS: &[&str] = &[
            "upload",
            "create",
            "compress",
            "decompress",
            "write",
            "permissions",
            "delete",
            "rename",
        ];
        for action in ["create", "write", "delete", "permissions", "rename"] {
            assert!(
                BACKEND_ACTIONS.contains(&action),
                "action {} must match the backend vocabulary",
                action
            );
        }
        for action in ["mkdir", "rmdir"] {
            assert!(
                !BACKEND_ACTIONS.contains(&action),
                "{} is SFTP-only; document it if the backend adopts it",
                action
            );
        }
    }

    #[tokio::test]
    async fn oversized_read_requests_return_bounded_byte_exact_chunks() {
        use russh_sftp::server::Handler;
        let dir = tempfile::tempdir().unwrap();
        let server = dir.path().join("read-server");
        tokio::fs::create_dir(&server).await.unwrap();
        let expected: Vec<u8> = (0..MAX_SFTP_READ_CHUNK + 251)
            .map(|i| (i % 251) as u8)
            .collect();
        tokio::fs::write(server.join("binary.dat"), &expected)
            .await
            .unwrap();
        let mut handler = CatalystSftpHandler::new(
            Arc::new(FileManager::new(dir.path().to_path_buf())),
            "read-server".to_string(),
            vec!["file.read".to_string()],
        );
        let handle = CatalystSftpHandler::make_file_handle("binary.dat");
        let mut received = Vec::new();
        while received.len() < expected.len() {
            let reply = handler
                .read(1, handle.clone(), received.len() as u64, u32::MAX)
                .await
                .unwrap();
            assert!(reply.data.len() <= MAX_SFTP_READ_CHUNK);
            received.extend_from_slice(&reply.data);
        }
        assert_eq!(received, expected);
        let eof = handler
            .read(2, handle, received.len() as u64, u32::MAX)
            .await
            .unwrap_err();
        assert_eq!(eof.status_code(), StatusCode::Eof);
    }
}
