use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{error, info, warn};

use crate::config::AgentConfig;
use crate::file_manager::FileManager;

const POLL_CONCURRENCY: usize = 4;
const MAX_CONCURRENT_REQUESTS: usize = 50; // Max concurrent file operations
const RETRY_DELAY: Duration = Duration::from_secs(2);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
struct TunnelRequest {
    #[serde(rename = "requestId")]
    request_id: String,
    operation: String,
    #[serde(rename = "serverUuid")]
    server_uuid: String,
    path: String,
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct PollResponse {
    requests: Vec<TunnelRequest>,
}

#[derive(Debug, Serialize)]
struct TunnelResponse {
    #[serde(rename = "requestId")]
    request_id: String,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "contentType")]
    content_type: Option<String>,
}

pub struct FileTunnelClient {
    config: Arc<AgentConfig>,
    file_manager: Arc<FileManager>,
    client: Client,
    base_url: String,
    request_semaphore: Arc<Semaphore>,
}

impl FileTunnelClient {
    pub fn new(config: Arc<AgentConfig>, file_manager: Arc<FileManager>) -> Self {
        let client = Client::builder()
            .pool_max_idle_per_host(POLL_CONCURRENCY + 2)
            .timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client");

        // Derive HTTP base URL from the WebSocket backend_url
        let ws_url = &config.server.backend_url;
        let base_url = ws_url
            .replace("wss://", "https://")
            .replace("ws://", "http://")
            .trim_end_matches("/ws")
            .trim_end_matches('/')
            .to_string();

        // Semaphore to limit concurrent file operations
        let request_semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));

        Self {
            config,
            file_manager,
            client,
            base_url,
            request_semaphore,
        }
    }

    /// Main run loop - spawns POLL_CONCURRENCY concurrent poll workers.
    pub async fn run(&self) {
        info!(
            "File tunnel starting with {} concurrent pollers, max {} concurrent operations",
            POLL_CONCURRENCY, MAX_CONCURRENT_REQUESTS
        );

        let mut handles = Vec::new();
        for i in 0..POLL_CONCURRENCY {
            let client = self.client.clone();
            let base_url = self.base_url.clone();
            let node_id = self.config.server.node_id.clone();
            let secret = self.config.server.secret.clone();
            let file_manager = self.file_manager.clone();
            let request_semaphore = self.request_semaphore.clone();

            handles.push(tokio::spawn(async move {
                poll_worker(i, client, base_url, node_id, secret, file_manager, request_semaphore).await;
            }));
        }

        // Wait for all workers (they run forever)
        for handle in handles {
            if let Err(e) = handle.await {
                error!("Poll worker exited: {}", e);
            }
        }
    }
}

async fn poll_worker(
    worker_id: usize,
    client: Client,
    base_url: String,
    node_id: String,
    secret: String,
    file_manager: Arc<FileManager>,
    request_semaphore: Arc<Semaphore>,
) {
    let poll_url = format!("{}/api/internal/file-tunnel/poll", base_url);
    let mut retry_delay = RETRY_DELAY;

    loop {
        match client
            .get(&poll_url)
            .header("X-Node-Id", &node_id)
            .header("X-Node-Secret", &secret)
            .timeout(Duration::from_secs(35))
            .send()
            .await
        {
            Ok(resp) => {
                retry_delay = RETRY_DELAY; // Reset on success

                if !resp.status().is_success() {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(
                        worker_id,
                        "Poll returned {}: {}", status, body
                    );
                    tokio::time::sleep(retry_delay).await;
                    continue;
                }

                match resp.json::<PollResponse>().await {
                    Ok(poll) => {
                        for request in poll.requests {
                            let client = client.clone();
                            let base_url = base_url.clone();
                            let node_id = node_id.clone();
                            let secret = secret.clone();
                            let fm = file_manager.clone();
                            let semaphore = request_semaphore.clone();

                            // Process each request concurrently, limited by semaphore
                            tokio::spawn(async move {
                                // Acquire permit before processing to limit concurrency
                                let _permit = semaphore.acquire().await.unwrap();
                                process_request(client, base_url, node_id, secret, fm, request)
                                    .await;
                            });
                        }
                    }
                    Err(e) => {
                        warn!(worker_id, "Failed to parse poll response: {}", e);
                        tokio::time::sleep(RETRY_DELAY).await;
                    }
                }
            }
            Err(e) => {
                if !e.is_timeout() {
                    warn!(worker_id, "Poll request failed: {}", e);
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(MAX_RETRY_DELAY);
                }
                // Timeouts are expected (long-poll), just retry immediately
            }
        }
    }
}

async fn process_request(
    client: Client,
    base_url: String,
    node_id: String,
    secret: String,
    file_manager: Arc<FileManager>,
    request: TunnelRequest,
) {
    // Reduced logging - don't log full path in debug
    info!(
        request_id = %request.request_id,
        operation = %request.operation,
        "Processing file tunnel request"
    );

    let ctx = TunnelCtx {
        client: &client,
        base_url: &base_url,
        node_id: &node_id,
        secret: &secret,
        request_id: &request.request_id,
    };

    match request.operation.as_str() {
        "list" => handle_list(&ctx, &file_manager, &request).await,
        "download" => handle_download(&ctx, &file_manager, &request).await,
        "upload" => handle_upload(&ctx, &file_manager, &request).await,
        "write" => handle_write(&ctx, &file_manager, &request).await,
        "create" => handle_create(&ctx, &file_manager, &request).await,
        "delete" => handle_delete(&ctx, &file_manager, &request).await,
        "rename" => handle_rename(&ctx, &file_manager, &request).await,
        "permissions" => handle_permissions(&ctx, &file_manager, &request).await,
        "compress" => handle_compress(&ctx, &file_manager, &request).await,
        "decompress" => handle_decompress(&ctx, &file_manager, &request).await,
        "archive-contents" => handle_archive_contents(&ctx, &file_manager, &request).await,
        "install-url" => handle_install_url(&ctx, &file_manager, &request).await,
        _ => {
            send_json_response(
                &ctx,
                false,
                None,
                Some(format!("Unknown operation: {}", request.operation)),
            )
            .await;
        }
    }
}

// --- Operation Handlers ---

async fn handle_list(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    match fm.list_dir(&req.server_uuid, &req.path).await {
        Ok(entries) => {
            // Convert to format expected by frontend
            let files: Vec<Value> = entries
                .into_iter()
                .map(|e| {
                    json!({
                        "name": e.name,
                        "size": e.size,
                        "isDirectory": e.is_dir,
                        "type": if e.is_dir { "directory" } else { "file" },
                        "modified": format_timestamp(e.modified),
                        "mode": e.mode & 0o7777,
                    })
                })
                .collect();
            send_json_response(ctx, true, Some(json!(files)), None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_download(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    match fm.read_file(&req.server_uuid, &req.path).await {
        Ok(data) => {
            send_stream_response(ctx, true, None, data).await;
        }
        Err(e) => {
            send_stream_response(ctx, false, Some(e.to_string()), vec![]).await;
        }
    }
}

async fn handle_upload(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    // Fetch upload data from backend
    let upload_url = format!(
        "{}/api/internal/file-tunnel/upload/{}",
        ctx.base_url, req.request_id
    );
    match ctx.client
        .get(&upload_url)
        .header("X-Node-Id", ctx.node_id)
        .header("X-Node-Secret", ctx.secret)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            match resp.bytes().await {
                Ok(data) => {
                    match fm.write_file_bytes(&req.server_uuid, &req.path, &data).await {
                        Ok(()) => {
                            send_json_response(ctx, true, None, None).await;
                        }
                        Err(e) => {
                            send_json_response(ctx, false, None, Some(e.to_string())).await;
                        }
                    }
                }
                Err(e) => {
                    send_json_response(ctx, false, None, Some(format!("Failed to read upload data: {}", e))).await;
                }
            }
        }
        Ok(resp) => {
            send_json_response(ctx, false, None, Some(format!("Failed to fetch upload: {}", resp.status()))).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(format!("Upload fetch error: {}", e))).await;
        }
    }
}

async fn handle_write(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    let content = req
        .data
        .as_ref()
        .and_then(|d| d.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match fm.write_file(&req.server_uuid, &req.path, content).await {
        Ok(()) => {
            send_json_response(ctx, true, None, None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_create(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    let is_directory = req
        .data
        .as_ref()
        .and_then(|d| d.get("isDirectory"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let content = req
        .data
        .as_ref()
        .and_then(|d| d.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match fm.create_entry(&req.server_uuid, &req.path, is_directory, content).await {
        Ok(()) => {
            send_json_response(ctx, true, None, None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_delete(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    match fm.delete_file(&req.server_uuid, &req.path).await {
        Ok(()) => {
            send_json_response(ctx, true, None, None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_rename(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    let to = match req.data.as_ref().and_then(|d| d.get("to")).and_then(|v| v.as_str()) {
        Some(to) => to,
        None => {
            send_json_response(ctx, false, None, Some("Missing 'to' path".to_string())).await;
            return;
        }
    };

    match fm.rename_file(&req.server_uuid, &req.path, to).await {
        Ok(()) => {
            send_json_response(ctx, true, None, None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_permissions(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    let mode = match req.data.as_ref().and_then(|d| d.get("mode")).and_then(|v| v.as_u64()) {
        Some(m) => m as u32,
        None => {
            send_json_response(ctx, false, None, Some("Missing mode".to_string())).await;
            return;
        }
    };

    match fm.set_permissions(&req.server_uuid, &req.path, mode).await {
        Ok(()) => {
            send_json_response(ctx, true, None, None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_compress(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    let paths: Vec<String> = req
        .data
        .as_ref()
        .and_then(|d| d.get("paths"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    if paths.is_empty() {
        send_json_response(ctx, false, None, Some("Missing paths".to_string())).await;
        return;
    }

    match fm.compress_files(&req.server_uuid, &req.path, &paths).await {
        Ok(()) => {
            send_json_response(ctx, true, None, None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_decompress(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    let target = match req
        .data
        .as_ref()
        .and_then(|d| d.get("targetPath"))
        .and_then(|v| v.as_str())
    {
        Some(t) => t,
        None => {
            send_json_response(ctx, false, None, Some("Missing targetPath".to_string())).await;
            return;
        }
    };

    match fm.decompress_to(&req.server_uuid, &req.path, target).await {
        Ok(()) => {
            send_json_response(ctx, true, None, None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_archive_contents(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    match fm.list_archive_contents(&req.server_uuid, &req.path).await {
        Ok(entries) => {
            let data: Vec<Value> = entries
                .into_iter()
                .map(|e| {
                    json!({
                        "name": e.name,
                        "size": e.size,
                        "isDirectory": e.is_dir,
                        "modified": e.modified,
                    })
                })
                .collect();
            send_json_response(ctx, true, Some(json!(data)), None).await;
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
        }
    }
}

async fn handle_install_url(
    ctx: &TunnelCtx<'_>,
    fm: &FileManager,
    req: &TunnelRequest,
) {
    let url = match req.data.as_ref().and_then(|d| d.get("url")).and_then(|v| v.as_str()) {
        Some(u) => u,
        None => {
            send_json_response(ctx, false, None, Some("Missing 'url' in data".to_string())).await;
            return;
        }
    };

    // Resolve and ensure parent directory exists
    let target_path = match fm.resolve_and_ensure_parent(&req.server_uuid, &req.path).await {
        Ok(p) => p,
        Err(e) => {
            send_json_response(ctx, false, None, Some(e.to_string())).await;
            return;
        }
    };

    // Download from the external URL
    let dl_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let response = match dl_client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            send_json_response(ctx, false, None, Some(format!("Download failed: {}", e))).await;
            return;
        }
    };

    if !response.status().is_success() {
        send_json_response(
            ctx,
            false,
            None,
            Some(format!("Download returned HTTP {}", response.status())),
        )
        .await;
        return;
    }

    match response.bytes().await {
        Ok(bytes) => {
            if let Err(e) = tokio::fs::write(&target_path, &bytes).await {
                send_json_response(ctx, false, None, Some(format!("Write failed: {}", e))).await;
            } else {
                send_json_response(ctx, true, None, None).await;
            }
        }
        Err(e) => {
            send_json_response(ctx, false, None, Some(format!("Download read failed: {}", e)))
                .await;
        }
    }
}

// --- Response Helpers ---

struct TunnelCtx<'a> {
    client: &'a Client,
    base_url: &'a str,
    node_id: &'a str,
    secret: &'a str,
    request_id: &'a str,
}

async fn send_json_response(
    ctx: &TunnelCtx<'_>,
    success: bool,
    data: Option<Value>,
    error: Option<String>,
) {
    let url = format!(
        "{}/api/internal/file-tunnel/response/{}",
        ctx.base_url, ctx.request_id
    );
    let response = TunnelResponse {
        request_id: ctx.request_id.to_string(),
        success,
        data,
        error,
        content_type: None,
    };

    if let Err(e) = ctx.client
        .post(&url)
        .header("X-Node-Id", ctx.node_id)
        .header("X-Node-Secret", ctx.secret)
        .json(&response)
        .send()
        .await
    {
        error!(request_id = ctx.request_id, "Failed to send JSON response: {}", e);
    }
}

async fn send_stream_response(
    ctx: &TunnelCtx<'_>,
    success: bool,
    error: Option<String>,
    body: Vec<u8>,
) {
    let url = format!(
        "{}/api/internal/file-tunnel/response/{}/stream",
        ctx.base_url, ctx.request_id
    );

    let mut req = ctx.client
        .post(&url)
        .header("X-Node-Id", ctx.node_id)
        .header("X-Node-Secret", ctx.secret)
        .header("X-Tunnel-Success", if success { "true" } else { "false" })
        .header("Content-Type", "application/octet-stream");

    if let Some(ref err) = error {
        req = req.header("X-Tunnel-Error", err.as_str());
    }

    if let Err(e) = req.body(body).send().await {
        error!(request_id = ctx.request_id, "Failed to send stream response: {}", e);
    }
}

fn format_timestamp(secs: u64) -> String {
    if secs == 0 {
        return String::new();
    }
    // Convert unix timestamp to ISO 8601
    chrono::DateTime::from_timestamp(secs as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}
