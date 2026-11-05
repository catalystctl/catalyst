//! Server install, start, stop, kill, delete, and auto-restart logic.

use super::*;

/// Retain a bounded tail for installer diagnostics. Complete output is relayed
/// immediately to the panel, so keeping it all in agent memory only harms nodes
/// that are already busy installing games.
fn append_installer_diagnostic(buffer: &mut String, chunk: &str, max_bytes: usize) {
    if chunk.len() >= max_bytes {
        let mut start = chunk.len() - max_bytes;
        while !chunk.is_char_boundary(start) {
            start += 1;
        }
        buffer.clear();
        buffer.push_str(&chunk[start..]);
        return;
    }
    let mut excess = buffer
        .len()
        .saturating_add(chunk.len())
        .saturating_sub(max_bytes);
    while !buffer.is_char_boundary(excess) {
        excess += 1;
    }
    buffer.drain(..excess);
    buffer.push_str(chunk);
}

#[derive(Default)]
struct InstallerMarkers {
    restart_message: bool,
    steamcmd_script: bool,
    restarting: bool,
    disk_write_failed: bool,
}

impl InstallerMarkers {
    fn record(&mut self, output: &str) {
        self.restart_message |=
            output.contains("Restarting steamcmd") || output.contains("Restarting SteamCMD");
        self.steamcmd_script |= output.contains("steamcmd.sh");
        self.restarting |= output.contains("Restarting");
        self.disk_write_failed |= output.contains("0x202");
    }

    fn steamcmd_restart(&self) -> bool {
        self.restart_message || (self.steamcmd_script && self.restarting)
    }
}

struct InstallerAttemptResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
    steamcmd_restart: bool,
    disk_write_failed: bool,
}

struct InstallerAttemptSpec<'a> {
    install_image: &'a str,
    final_script: &'a str,
    env_map: &'a HashMap<String, String>,
    host_server_dir: &'a str,
    install_entrypoint: Option<&'a str>,
}

struct InstallerStreamDelivery<'a> {
    position: &'a mut u64,
    diagnostic: &'a mut String,
    markers: &'a mut InstallerMarkers,
}

const INSTALLER_PENDING_PREFIX: &str = "pending:";
const INSTALLER_CONTAINER_PREFIX: &str = "container:";
const INSTALL_CANCELLED: &str = "installation cancelled";

/// A per-attempt value in `active_installs`. Pending registrations close the
/// pre-spawn cancellation window; container registrations carry both ownership
/// and the exact ID that cancellation is allowed to remove.
#[derive(Debug, Clone, PartialEq, Eq)]
enum InstallerRegistration {
    Pending(String),
    Container {
        attempt_id: String,
        container_id: String,
    },
    /// Compatibility with an entry written by an older agent in this process.
    LegacyContainer(String),
}

impl InstallerRegistration {
    fn pending(attempt_id: &str) -> String {
        format!("{INSTALLER_PENDING_PREFIX}{attempt_id}")
    }

    fn container(attempt_id: &str, container_id: &str) -> String {
        format!("{INSTALLER_CONTAINER_PREFIX}{attempt_id}:{container_id}")
    }

    fn parse(value: &str) -> Self {
        if let Some(attempt_id) = value.strip_prefix(INSTALLER_PENDING_PREFIX) {
            return Self::Pending(attempt_id.to_string());
        }
        if let Some(rest) = value.strip_prefix(INSTALLER_CONTAINER_PREFIX) {
            if let Some((attempt_id, container_id)) = rest.split_once(':') {
                if !attempt_id.is_empty() && !container_id.is_empty() {
                    return Self::Container {
                        attempt_id: attempt_id.to_string(),
                        container_id: container_id.to_string(),
                    };
                }
            }
        }
        Self::LegacyContainer(value.to_string())
    }

    fn attempt_id(&self) -> Option<&str> {
        match self {
            Self::Pending(attempt_id) | Self::Container { attempt_id, .. } => Some(attempt_id),
            Self::LegacyContainer(_) => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum InstallerAttach {
    Attached,
    Cancelled,
    Superseded,
}

type InstallerCancellations = HashMap<String, HashSet<String>>;

/// State transitions are pure and shared by install and cancel. Callers hold
/// both `active_installs` and `cancelled_installs` locks (in that order), making
/// cancellation and target removal atomic with respect to registration.
fn begin_installer_attempt(
    active: &mut HashMap<String, String>,
    _cancelled: &mut InstallerCancellations,
    server_id: &str,
    attempt_id: &str,
) {
    // A new generation must not erase cancellation owned by an older attempt
    // that is still unwinding after an immediate reinstall.
    active.insert(
        server_id.to_string(),
        InstallerRegistration::pending(attempt_id),
    );
}

fn pre_register_installer_attempt(
    active: &mut HashMap<String, String>,
    cancelled: &mut InstallerCancellations,
    server_id: &str,
    attempt_id: &str,
) -> bool {
    if active.contains_key(server_id) {
        return false;
    }
    begin_installer_attempt(active, cancelled, server_id, attempt_id);
    true
}

fn installer_attempt_is_cancelled(
    cancelled: &InstallerCancellations,
    server_id: &str,
    attempt_id: &str,
) -> bool {
    cancelled
        .get(server_id)
        .is_some_and(|attempts| attempts.contains(attempt_id))
}

fn cancel_installer_attempt(
    active: &mut HashMap<String, String>,
    cancelled: &mut InstallerCancellations,
    server_id: &str,
) -> Option<InstallerRegistration> {
    let target = active
        .remove(server_id)
        .map(|value| InstallerRegistration::parse(&value));
    if let Some(attempt_id) = target.as_ref().and_then(InstallerRegistration::attempt_id) {
        cancelled
            .entry(server_id.to_string())
            .or_default()
            .insert(attempt_id.to_string());
    }
    target
}

fn attach_installer_container(
    active: &mut HashMap<String, String>,
    cancelled: &InstallerCancellations,
    server_id: &str,
    attempt_id: &str,
    container_id: &str,
) -> InstallerAttach {
    if installer_attempt_is_cancelled(cancelled, server_id, attempt_id) {
        return InstallerAttach::Cancelled;
    }
    match active
        .get(server_id)
        .map(|value| InstallerRegistration::parse(value))
    {
        Some(InstallerRegistration::Pending(owner)) if owner == attempt_id => {
            active.insert(
                server_id.to_string(),
                InstallerRegistration::container(attempt_id, container_id),
            );
            InstallerAttach::Attached
        }
        _ => InstallerAttach::Superseded,
    }
}

/// Re-arm only the exact container that has completed cleanup. The following
/// SteamCMD retry may attach a replacement, while another generation cannot.
fn release_installer_container(
    active: &mut HashMap<String, String>,
    server_id: &str,
    attempt_id: &str,
    container_id: &str,
) {
    let cleaned = active.get(server_id).is_some_and(|value| {
        matches!(
            InstallerRegistration::parse(value),
            InstallerRegistration::Container {
                attempt_id: ref owner,
                container_id: ref registered,
            } if owner == attempt_id && registered == container_id
        )
    });
    if cleaned {
        active.insert(
            server_id.to_string(),
            InstallerRegistration::pending(attempt_id),
        );
    }
}

fn installer_attempt_is_current(
    active: &HashMap<String, String>,
    cancelled: &InstallerCancellations,
    server_id: &str,
    attempt_id: &str,
) -> bool {
    !installer_attempt_is_cancelled(cancelled, server_id, attempt_id)
        && active.get(server_id).is_some_and(|value| {
            InstallerRegistration::parse(value).attempt_id() == Some(attempt_id)
        })
}

fn consume_installer_cancellation(
    cancelled: &mut InstallerCancellations,
    server_id: &str,
    attempt_id: &str,
) -> bool {
    let Some(attempts) = cancelled.get_mut(server_id) else {
        return false;
    };
    let removed = attempts.remove(attempt_id);
    if attempts.is_empty() {
        cancelled.remove(server_id);
    }
    removed
}

fn clear_installer_attempt(
    active: &mut HashMap<String, String>,
    server_id: &str,
    attempt_id: &str,
) {
    let owned = active
        .get(server_id)
        .is_some_and(|value| InstallerRegistration::parse(value).attempt_id() == Some(attempt_id));
    if owned {
        active.remove(server_id);
    }
}

fn finish_installer_attempt(
    active: &mut HashMap<String, String>,
    cancelled: &mut InstallerCancellations,
    server_id: &str,
    attempt_id: &str,
) -> bool {
    clear_installer_attempt(active, server_id, attempt_id);
    consume_installer_cancellation(cancelled, server_id, attempt_id)
}

#[derive(Debug, Default, PartialEq, Eq)]
struct InstallerBatchPlan {
    batches: Vec<(usize, String)>,
    consumed_bytes: usize,
}

/// Convert newly-read terminal text into bounded delivery batches. Offsets are
/// relative to the read cursor and include terminators (including CRLF). A
/// caller advances only through batches whose sends actually succeeded.
fn plan_installer_batches(
    text: &str,
    include_trailing: bool,
    max_batch_bytes: usize,
) -> InstallerBatchPlan {
    let limit = text.len();
    let mut plan = InstallerBatchPlan::default();
    let mut batch = String::new();
    let mut batch_end = 0;
    let mut start = 0;
    let mut index = 0;
    while index < limit {
        let ch = text[index..].chars().next().expect("index is in bounds");
        if ch == '\n' || ch == '\r' {
            let mut end = index + ch.len_utf8();
            if ch == '\r' && text.as_bytes().get(end) == Some(&b'\n') {
                end += 1;
            }
            let payload = format!("{}\n", &text[start..index]);
            batch.push_str(&payload);
            batch_end = end;
            if batch.len() >= max_batch_bytes {
                plan.batches.push((batch_end, std::mem::take(&mut batch)));
            }
            start = end;
            plan.consumed_bytes = end;
            index = end;
        } else {
            index += ch.len_utf8();
        }
    }

    let trailing = &text[start..];
    if include_trailing && !trailing.is_empty() {
        batch.push_str(trailing);
        batch.push('\n');
        batch_end = text.len();
        plan.consumed_bytes = text.len();
    }
    if !batch.is_empty() {
        plan.batches.push((batch_end, std::mem::take(&mut batch)));
    }
    plan
}

fn commit_installer_batch_cursor(
    position: &mut u64,
    previous_end: &mut usize,
    batch_end: usize,
    text_len: usize,
) -> AgentResult<()> {
    if batch_end > text_len || batch_end < *previous_end {
        return Err(AgentError::InternalError(
            "invalid installer output cursor".to_string(),
        ));
    }
    let delta = (batch_end - *previous_end) as u64;
    *position = position
        .checked_add(delta)
        .ok_or_else(|| AgentError::InternalError("installer output cursor overflow".to_string()))?;
    *previous_end = batch_end;
    Ok(())
}

/// Deliver all currently complete installer batches through `emit`. The cursor
/// advances only after a successful send; a failed batch remains in the file for
/// the next read. Empty EOF reads complete without requiring a live writer.
async fn deliver_installer_text<F, Fut>(
    text: &str,
    include_trailing: bool,
    delivery: InstallerStreamDelivery<'_>,
    mut emit: F,
) -> AgentResult<bool>
where
    F: FnMut(Arc<str>) -> Fut,
    Fut: std::future::Future<Output = AgentResult<bool>>,
{
    let InstallerStreamDelivery {
        position,
        diagnostic,
        markers,
    } = delivery;
    if text.is_empty() {
        return Ok(true);
    }
    markers.record(text);
    let InstallerBatchPlan {
        batches,
        consumed_bytes,
    } = plan_installer_batches(text, include_trailing, MAX_CONSOLE_BATCH_BYTES);
    let mut previous_end = 0usize;
    for (batch_end, batch) in batches {
        let batch: Arc<str> = batch.into();
        if !emit(Arc::clone(&batch)).await? {
            return Ok(false);
        }
        append_installer_diagnostic(diagnostic, &batch, 64 * 1024);
        commit_installer_batch_cursor(position, &mut previous_end, batch_end, text.len())?;
    }
    debug_assert_eq!(previous_end, consumed_bytes);
    Ok(true)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InstallOperation {
    Install,
    Reinstall,
    Rebuild,
}

/// Shared completion for install/reinstall/rebuild: one terminal error event,
/// cancellation suppression, and attempt-state cleanup on every return.
async fn finish_install_operation(
    handler: &WebSocketHandler,
    server_id: &str,
    attempt_id: &str,
    result: AgentResult<()>,
) -> AgentResult<()> {
    let cancelled = {
        let mut active = handler.active_installs.write().await;
        let mut cancelled = handler.cancelled_installs.write().await;
        finish_installer_attempt(&mut active, &mut cancelled, server_id, attempt_id)
    };

    if cancelled {
        let _ = handler
            .emit_console_output(server_id, "system", "[Catalyst] Installation cancelled.\n")
            .await;
        return Ok(());
    }

    if let Err(error) = result {
        // Installer output may contain values substituted from secret variables.
        // Retain only lengths in logs; the actionable reason still goes to the
        // authenticated panel through the state event.
        warn!(
            "Installation failed for server {} (error reason: {} bytes; content withheld from logs)",
            server_id,
            error.to_string().len()
        );
        if let Err(emit_error) = handler
            .emit_server_state_update(server_id, "error", Some(error.to_string()), None, None)
            .await
        {
            return Err(AgentError::InstallationError(format!(
                "{error}; additionally failed to emit terminal error state: {emit_error}"
            )));
        }
        return Err(error);
    }

    Ok(())
}

impl WebSocketHandler {
    pub(crate) async fn spawn_health_checker(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;

            // Snapshot the current server ports map
            let entries: Vec<(String, String, u16)> = {
                self.server_ports
                    .read()
                    .await
                    .iter()
                    .map(|(sid, (cid, port))| (sid.clone(), cid.clone(), *port))
                    .collect()
            };

            for (server_id, container_id, port) in &entries {
                // Verify the container is still running before probing
                let is_running = self
                    .runtime
                    .is_container_running(container_id)
                    .await
                    .unwrap_or(false);
                if !is_running {
                    continue;
                }

                let ip = match self.runtime.get_container_ip(container_id).await {
                    Ok(ip) if !ip.is_empty() => ip,
                    _ => continue,
                };

                let addr = format!("{}:{}", ip, port);
                let parsed: std::net::SocketAddr = match addr.parse() {
                    Ok(a) => a,
                    Err(_) => continue,
                };
                let healthy = tokio::task::spawn_blocking(move || {
                    std::net::TcpStream::connect_timeout(&parsed, Duration::from_secs(3))
                })
                .await
                .unwrap_or(Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "health check timed out",
                )))
                .is_ok();

                // Only emit when state actually changes to avoid noise
                let mut health_states = self.server_health_state.write().await;
                let prev = health_states.get(server_id).copied();
                if prev != Some(healthy) {
                    health_states.insert(server_id.clone(), healthy);
                    drop(health_states); // Release lock before sending
                                         // Distinguish unhealthy from running so the panel can surface failures.
                    let status = if healthy { "running" } else { "unhealthy" };
                    let reason = if healthy {
                        Some("Health check passed".to_string())
                    } else {
                        Some("Health check failed".to_string())
                    };
                    info!(
                        "Health check for {}: {} (port {})",
                        server_id,
                        if healthy { "healthy" } else { "unhealthy" },
                        port
                    );
                    let _ = self
                        .emit_server_state_update(server_id, status, reason, None, None)
                        .await;
                }
            }
        }
    }

    /// Install work is process-scoped, not WebSocket-scoped. Terminal state is
    /// buffered across reconnects and `active_installs` owns cancellation and
    /// cleanup, so aborting this task on an ordinary disconnect would only leak
    /// the installer and strand the panel in `installing`.
    pub(crate) fn spawn_installation_task<F>(&self, task: F)
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        let _handle = tokio::spawn(task);
    }

    pub(crate) async fn dispatch_install_operation(
        &self,
        msg: Value,
        operation: InstallOperation,
        inflight_slot: tokio::sync::OwnedSemaphorePermit,
    ) {
        // Register before yielding back to the inbound read loop. Otherwise a
        // promptly scheduled cancel task could run before the install task's
        // first await and its cancellation would look stale.
        let pre_registered_attempt = if let Some(server_id) = msg["serverId"].as_str() {
            let mut active = self.active_installs.write().await;
            let mut cancelled = self.cancelled_installs.write().await;
            // A serialized operation already owning this server keeps its
            // exact container target; the queued operation registers after
            // acquiring server_key's mutex below.
            let attempt_id = uuid::Uuid::new_v4().to_string();
            pre_register_installer_attempt(&mut active, &mut cancelled, server_id, &attempt_id)
                .then_some(attempt_id)
        } else {
            None
        };

        let handler = self.clone();
        self.spawn_installation_task(async move {
            // Keep backpressure and the server lock alive for the entire
            // operation, not merely until handle_message returns.
            let _inflight_slot = inflight_slot;
            let server_key = msg
                .get("serverId")
                .or_else(|| msg.get("serverUuid"))
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            let lock = handler.server_lock(&server_key).await;
            let _guard = lock.lock().await;
            let (operation_name, result) = match operation {
                InstallOperation::Install => (
                    "install_server",
                    handler
                        .perform_install_operation(
                            &msg,
                            InstallOperation::Install,
                            pre_registered_attempt.as_deref(),
                        )
                        .await,
                ),
                InstallOperation::Reinstall => (
                    "reinstall_server",
                    handler
                        .perform_install_operation(
                            &msg,
                            InstallOperation::Reinstall,
                            pre_registered_attempt.as_deref(),
                        )
                        .await,
                ),
                InstallOperation::Rebuild => (
                    "rebuild_server",
                    handler
                        .perform_install_operation(
                            &msg,
                            InstallOperation::Rebuild,
                            pre_registered_attempt.as_deref(),
                        )
                        .await,
                ),
            };
            if let Err(error) = result {
                // Error bodies can contain substituted installer secrets.
                error!(
                    "{} failed for {} (reason: {} bytes; content withheld)",
                    operation_name,
                    server_key,
                    error.to_string().len()
                );
                let component = match operation {
                    InstallOperation::Install => format!("agent:install_server:{server_key}"),
                    InstallOperation::Reinstall => "agent:reinstall_server".to_string(),
                    InstallOperation::Rebuild => "agent:rebuild_server".to_string(),
                };
                handler
                    .report_error(
                        ErrorLevel::Error,
                        &component,
                        &error.to_string(),
                        None,
                        Some(serde_json::json!({
                            "serverId": server_key,
                            "operation": match operation {
                                InstallOperation::Install => "install",
                                InstallOperation::Reinstall => "reinstall",
                                InstallOperation::Rebuild => "rebuild",
                            },
                        })),
                    )
                    .await;
            }
        });
    }

    async fn installer_attempt_is_current(&self, server_id: &str, attempt_id: &str) -> bool {
        let active = self.active_installs.read().await;
        let cancelled = self.cancelled_installs.read().await;
        installer_attempt_is_current(&active, &cancelled, server_id, attempt_id)
    }

    async fn ensure_installer_attempt_current(
        &self,
        server_id: &str,
        attempt_id: &str,
    ) -> AgentResult<()> {
        if self
            .installer_attempt_is_current(server_id, attempt_id)
            .await
        {
            Ok(())
        } else {
            Err(AgentError::InstallationError(INSTALL_CANCELLED.to_string()))
        }
    }

    async fn clear_installer_registration(&self, server_id: &str, attempt_id: &str) {
        let mut active = self.active_installs.write().await;
        clear_installer_attempt(&mut active, server_id, attempt_id);
    }

    async fn release_installer_container(
        &self,
        server_id: &str,
        attempt_id: &str,
        container_id: &str,
    ) {
        let mut active = self.active_installs.write().await;
        release_installer_container(&mut active, server_id, attempt_id, container_id);
    }

    async fn cleanup_installer_resources(
        &self,
        installer: &crate::runtime_manager::InstallerHandle,
    ) -> AgentResult<()> {
        let container_id = &installer.container_id;
        // Keep the task netns alive until CNI DEL has run. Never let either
        // failure skip the other half of teardown, and never hide either error.
        let cni_result = self.runtime.teardown_cni_network(container_id).await;
        if let Err(ref error) = cni_result {
            warn!(
                "Installer CNI teardown failed for {}: {}",
                container_id, error
            );
        }
        let cleanup_result = installer.cleanup().await;
        if let Err(ref error) = cleanup_result {
            warn!(
                "Installer container cleanup failed for {}: {}",
                container_id, error
            );
        }

        match (cni_result, cleanup_result) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(cni), Ok(())) => Err(AgentError::InstallationError(format!(
                "Installer CNI cleanup failed: {cni}"
            ))),
            (Ok(()), Err(cleanup)) => Err(AgentError::InstallationError(format!(
                "Installer container cleanup failed: {cleanup}"
            ))),
            (Err(cni), Err(cleanup)) => Err(AgentError::InstallationError(format!(
                "Installer cleanup failed (CNI: {cni}; container: {cleanup})"
            ))),
        }
    }

    async fn run_installer_attempt(
        &self,
        server_id: &str,
        attempt_id: &str,
        spec: InstallerAttemptSpec<'_>,
    ) -> AgentResult<InstallerAttemptResult> {
        // Check the pending registration before preparing anything. The attach
        // below closes the remaining await race before Tasks.Start can run, and
        // abandons only this attempt's exact prepared container.
        if !self
            .installer_attempt_is_current(server_id, attempt_id)
            .await
        {
            return Err(AgentError::InstallationError(INSTALL_CANCELLED.to_string()));
        }

        let prepared = self
            .runtime
            .prepare_installer_container_with_entrypoint(
                spec.install_image,
                spec.final_script,
                spec.env_map,
                spec.host_server_dir,
                spec.install_entrypoint,
            )
            .await
            .map_err(|e| {
                AgentError::IoError(format!("Failed to spawn installer container: {}", e))
            })?;
        let container_id = prepared.container_id().to_string();
        let attach = {
            let mut active = self.active_installs.write().await;
            let cancelled = self.cancelled_installs.read().await;
            attach_installer_container(
                &mut active,
                &cancelled,
                server_id,
                attempt_id,
                &container_id,
            )
        };
        if attach != InstallerAttach::Attached {
            // No InstallerHandle exists yet. Prepared cleanup performs the full
            // CNI/task/container/snapshot/I/O unwind without starting the script.
            let cleanup_result = prepared.cleanup().await;
            self.clear_installer_registration(server_id, attempt_id)
                .await;
            let error = match attach {
                InstallerAttach::Cancelled => {
                    AgentError::InstallationError(INSTALL_CANCELLED.to_string())
                }
                InstallerAttach::Superseded => AgentError::InstallationError(
                    "Installer attempt was superseded before its container was registered"
                        .to_string(),
                ),
                InstallerAttach::Attached => unreachable!(),
            };
            return match cleanup_result {
                Ok(()) => Err(error),
                Err(cleanup) => Err(AgentError::InstallationError(format!(
                    "{error}; cleanup also failed: {cleanup}"
                ))),
            };
        }

        // Registration now exposes the exact target to cancellation. Starting
        // consumes the prepared handle, so there is deliberately no late attach.
        // A start error already includes any full-stack cleanup failure from the
        // runtime's unwind; retain that entire error for the scoped report.
        let installer = prepared.start().await.map_err(|error| {
            AgentError::IoError(format!("Failed to start installer container: {error}"))
        })?;

        // No `?` is allowed to bypass teardown after a started container exists.
        let run_result = self
            .run_spawned_installer(server_id, attempt_id, &installer)
            .await;
        let cleanup_result = self.cleanup_installer_resources(&installer).await;
        if cleanup_result.is_ok() {
            // Keep the operation registered for a legitimate SteamCMD retry.
            // Only this exact, now-cleaned container can return to pending.
            self.release_installer_container(server_id, attempt_id, &container_id)
                .await;
        }

        match (run_result, cleanup_result) {
            (Err(error), Err(cleanup)) => Err(AgentError::InstallationError(format!(
                "{error}; cleanup also failed: {cleanup}"
            ))),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(cleanup)) => Err(cleanup),
            (Ok(result), Ok(())) => Ok(result),
        }
    }

    async fn run_spawned_installer(
        &self,
        server_id: &str,
        attempt_id: &str,
        installer: &crate::runtime_manager::InstallerHandle,
    ) -> AgentResult<InstallerAttemptResult> {
        let mut stdout_pos = 0u64;
        let mut stderr_pos = 0u64;
        let mut stdout_buffer = String::new();
        let mut stderr_buffer = String::new();
        let mut markers = InstallerMarkers::default();

        loop {
            if !self
                .installer_attempt_is_current(server_id, attempt_id)
                .await
            {
                return Err(AgentError::InstallationError(INSTALL_CANCELLED.to_string()));
            }

            if let Ok(new_text) =
                super::console::read_new_tail_bytes(&installer.stdout_path, &mut stdout_pos).await
            {
                if !deliver_installer_text(
                    &new_text,
                    false,
                    InstallerStreamDelivery {
                        position: &mut stdout_pos,
                        diagnostic: &mut stdout_buffer,
                        markers: &mut markers,
                    },
                    |batch| async move {
                        self.emit_console_output(server_id, "stdout", &batch).await
                    },
                )
                .await?
                {
                    debug!(
                        "Holding installer stdout cursor for {} after failed delivery",
                        server_id
                    );
                }
            }
            if let Ok(new_text) =
                super::console::read_new_tail_bytes(&installer.stderr_path, &mut stderr_pos).await
            {
                if !deliver_installer_text(
                    &new_text,
                    false,
                    InstallerStreamDelivery {
                        position: &mut stderr_pos,
                        diagnostic: &mut stderr_buffer,
                        markers: &mut markers,
                    },
                    |batch| async move {
                        self.emit_console_output(server_id, "stderr", &batch).await
                    },
                )
                .await?
                {
                    debug!(
                        "Holding installer stderr cursor for {} after failed delivery",
                        server_id
                    );
                }
            }

            match tokio::time::timeout(Duration::from_millis(200), installer.wait()).await {
                Ok(Ok(exit_code)) => {
                    // An ended installer still has on-disk output. Always inspect
                    // it: empty EOF reads finish even offline. Failed non-empty
                    // sends retain their cursors and retry after reconnect.
                    loop {
                        if !self
                            .installer_attempt_is_current(server_id, attempt_id)
                            .await
                        {
                            return Err(AgentError::InstallationError(
                                INSTALL_CANCELLED.to_string(),
                            ));
                        }
                        let stdout = super::console::read_new_tail_bytes(
                            &installer.stdout_path,
                            &mut stdout_pos,
                        )
                        .await
                        .map_err(|error| {
                            AgentError::IoError(format!(
                                "Failed to drain installer stdout: {error}"
                            ))
                        })?;
                        let stderr = super::console::read_new_tail_bytes(
                            &installer.stderr_path,
                            &mut stderr_pos,
                        )
                        .await
                        .map_err(|error| {
                            AgentError::IoError(format!(
                                "Failed to drain installer stderr: {error}"
                            ))
                        })?;
                        let stdout_delivered = deliver_installer_text(
                            &stdout,
                            true,
                            InstallerStreamDelivery {
                                position: &mut stdout_pos,
                                diagnostic: &mut stdout_buffer,
                                markers: &mut markers,
                            },
                            |batch| async move {
                                self.emit_console_output(server_id, "stdout", &batch).await
                            },
                        )
                        .await?;
                        let stderr_delivered = deliver_installer_text(
                            &stderr,
                            true,
                            InstallerStreamDelivery {
                                position: &mut stderr_pos,
                                diagnostic: &mut stderr_buffer,
                                markers: &mut markers,
                            },
                            |batch| async move {
                                self.emit_console_output(server_id, "stderr", &batch).await
                            },
                        )
                        .await?;
                        if stdout_delivered && stderr_delivered {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                    return Ok(InstallerAttemptResult {
                        exit_code,
                        stdout: stdout_buffer,
                        stderr: stderr_buffer,
                        steamcmd_restart: markers.steamcmd_restart(),
                        disk_write_failed: markers.disk_write_failed,
                    });
                }
                Ok(Err(error)) => {
                    return Err(AgentError::IoError(format!(
                        "Installer wait failed: {error}"
                    )));
                }
                Err(_) => {}
            }
        }
    }

    pub(crate) async fn install_server(&self, msg: &Value) -> AgentResult<()> {
        self.perform_install_operation(msg, InstallOperation::Install, None)
            .await
    }

    async fn perform_install_operation(
        &self,
        msg: &Value,
        operation: InstallOperation,
        pre_registered_attempt: Option<&str>,
    ) -> AgentResult<()> {
        // Without an ID there is no server whose state can be updated. Every
        // other validation/setup/spawn/wait/late error follows one completion.
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let attempt_id = match pre_registered_attempt {
            Some(attempt_id) => attempt_id.to_string(),
            None => {
                let attempt_id = uuid::Uuid::new_v4().to_string();
                let mut active = self.active_installs.write().await;
                let mut cancelled = self.cancelled_installs.write().await;
                begin_installer_attempt(&mut active, &mut cancelled, server_id, &attempt_id);
                attempt_id
            }
        };

        let result = match operation {
            InstallOperation::Install => self.install_server_inner(msg, &attempt_id).await,
            InstallOperation::Reinstall => self.reinstall_server_inner(msg, &attempt_id).await,
            InstallOperation::Rebuild => self.rebuild_server_inner(msg, &attempt_id).await,
        };
        finish_install_operation(self, server_id, &attempt_id, result).await
    }

    async fn install_server_inner(&self, msg: &Value, attempt_id: &str) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        if msg["suspended"].as_bool().unwrap_or(false) {
            return Err(AgentError::InvalidRequest(
                "Server is suspended".to_string(),
            ));
        }

        let template = msg["template"]
            .as_object()
            .ok_or_else(|| AgentError::InvalidRequest("Missing template".to_string()))?;

        let install_script = template
            .get("installScript")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing installScript in template".to_string())
            })?;

        let environment = msg
            .get("environment")
            .and_then(|v| v.as_object())
            .ok_or_else(|| {
                AgentError::InvalidRequest("Missing or invalid environment".to_string())
            })?;

        info!("Installing server: {} (UUID: {})", server_id, server_uuid);

        // Cancellation is allowed during setup too; never clear a new request
        // outside the atomic begin/cancel registration transition.
        if !self
            .installer_attempt_is_current(server_id, attempt_id)
            .await
        {
            return Err(AgentError::InstallationError(INSTALL_CANCELLED.to_string()));
        }

        self.cleanup_all_server_containers(server_id, server_uuid)
            .await?;
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;

        // Derive host mount path on-agent (defense in depth). Do not trust control-plane host paths.
        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let derived_server_dir = self.config.server.data_dir.join(server_uuid);
        let host_server_dir = derived_server_dir.to_string_lossy().to_string();
        if let Some(provided) = environment.get("SERVER_DIR").and_then(|v| v.as_str()) {
            if provided != host_server_dir {
                warn!(
                    "Ignoring backend-provided SERVER_DIR for {}: '{}' (using '{}')",
                    server_uuid, provided, host_server_dir
                );
            }
        }

        let disk_mb = msg["allocatedDiskMb"]
            .as_u64()
            .unwrap_or(10240)
            .clamp(1, 1_048_576);
        let server_dir_path = PathBuf::from(&host_server_dir);
        self.storage_manager
            .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
            .await?;
        if let Ok(actual_mb) = self.storage_manager.image_quota_mb(server_uuid).await {
            self.emit_console_output(
                server_id,
                "system",
                &format!("[Catalyst] Disk image is {actual_mb} MB (requested {disk_mb} MB).\n"),
            )
            .await?;
        }

        let server_dir_path = std::path::PathBuf::from(&host_server_dir);

        tokio::fs::create_dir_all(&server_dir_path)
            .await
            .map_err(|e| {
                AgentError::IoError(format!("Failed to create server directory: {}", e))
            })?;

        info!("Created server directory: {}", server_dir_path.display());

        // Container runs as uid 1000:1000 — ensure it can write to its data dir
        if let Err(e) = chown_to_container_user(&server_dir_path).await {
            warn!("Failed to chown server directory: {}", e);
        }

        // Replace variables in install script
        let mut final_script = install_script.to_string();

        // Debug: log raw install script for troubleshooting
        // Using debug! (not info!) because the substituted script body contains
        // secrets (passwords, API keys) that should never be written to disk
        // at the default info log level.
        debug!("[DEBUG] install_server: raw install_script (first 500 chars):\n---BEGIN RAW---\n{}---END RAW---",
            if install_script.len() > 500 { format!("{}... [truncated, total {} bytes]", &install_script[..500], install_script.len()) } else { install_script.to_string() }
        );
        debug!(
            "[DEBUG] install_server: environment keys: {:?}",
            environment.keys().collect::<Vec<_>>()
        );

        // Strip carriage returns to avoid $'\r': command not found errors
        final_script = final_script.replace("\r\n", "\n").replace('\r', "\n");
        for (key, value) in environment {
            let placeholder = format!("{{{{{}}}}}", key);
            let replacement = if key == "SERVER_DIR" {
                CONTAINER_SERVER_DIR
            } else {
                value.as_str().unwrap_or("")
            };
            // Shell-escape the value to prevent command injection via user-controlled env vars
            let escaped = shell_utils::shell_escape_value(replacement);
            final_script = final_script.replace(&placeholder, &escaped);
        }

        // Get the install image from template (fallback to Alpine if not specified)
        let install_image = template
            .get("installImage")
            .and_then(|v| v.as_str())
            .unwrap_or("alpine:3.19");

        info!(
            "[DEBUG] install_server: install_image from template: {:?}",
            template.get("installImage")
        );
        info!(
            "[DEBUG] install_server: resolved install_image: {}",
            install_image
        );
        info!(
            "[DEBUG] install_server: host_server_dir: {}",
            host_server_dir
        );
        // Using debug! (not info!) because the substituted script body contains
        // secrets (passwords, API keys) that should never be written to disk
        // at the default info log level.
        debug!("[DEBUG] install_server: final_script (first 500 chars after var substitution):\n---BEGIN FINAL---\n{}---END FINAL---",
            if final_script.len() > 500 { format!("{}... [truncated, total {} bytes]", &final_script[..500], final_script.len()) } else { final_script.clone() }
        );

        // Convert environment from Map<String, Value> to HashMap<String, String>
        let mut env_map = HashMap::new();
        for (key, value) in environment {
            if let Some(s) = value.as_str() {
                env_map.insert(key.clone(), s.to_string());
            }
        }
        env_map.insert("HOST_SERVER_DIR".to_string(), host_server_dir.clone());
        env_map.insert("SERVER_DIR".to_string(), CONTAINER_SERVER_DIR.to_string());

        // Wings always provides these builtins to install containers. Mirror them
        // from the live allocation so $SERVER_MEMORY / $SERVER_PORT / $SERVER_IP
        // work even when the panel omitted them from the template variable list.
        let memory_mb = msg["allocatedMemoryMb"].as_u64().unwrap_or(1024);
        let primary_port = msg["primaryPort"].as_u64().unwrap_or(0);
        env_map
            .entry("SERVER_MEMORY".to_string())
            .or_insert_with(|| memory_mb.to_string());
        env_map
            .entry("MEMORY".to_string())
            .or_insert_with(|| memory_mb.to_string());
        if primary_port > 0 {
            env_map
                .entry("SERVER_PORT".to_string())
                .or_insert_with(|| primary_port.to_string());
            env_map
                .entry("PORT".to_string())
                .or_insert_with(|| primary_port.to_string());
        }
        env_map
            .entry("SERVER_IP".to_string())
            .or_insert_with(|| "0.0.0.0".to_string());
        env_map
            .entry("SERVER_UUID".to_string())
            .or_insert_with(|| server_uuid.to_string());
        env_map
            .entry("P_SERVER_UUID".to_string())
            .or_insert_with(|| server_uuid.to_string());
        env_map
            .entry("UUID".to_string())
            .or_insert_with(|| server_uuid.to_string());
        env_map
            .entry("P_SERVER_LOCATION".to_string())
            .or_insert_with(|| "catalyst".to_string());
        env_map
            .entry("TZ".to_string())
            .or_insert_with(|| "UTC".to_string());
        env_map
            .entry("HOME".to_string())
            .or_insert_with(|| CONTAINER_SERVER_DIR.to_string());

        info!(
            "Executing installation script in containerized environment using image: {}",
            install_image
        );
        self.emit_console_output(server_id, "system", "[Catalyst] Starting installation...\n")
            .await?;

        // Execute the install script with SteamCMD self-update retry support.
        // SteamCMD frequently self-updates and restarts on first run, causing
        // non-zero exit codes. We detect this pattern and retry once.
        let mut attempt = 0;
        let InstallerAttemptResult {
            exit_code,
            stdout: stdout_buffer,
            stderr: stderr_buffer,
            disk_write_failed,
            ..
        } = loop {
            attempt += 1;
            match self
                .run_installer_attempt(
                    server_id,
                    attempt_id,
                    InstallerAttemptSpec {
                        install_image,
                        final_script: &final_script,
                        env_map: &env_map,
                        host_server_dir: &host_server_dir,
                        install_entrypoint: template
                            .get("installEntrypoint")
                            .and_then(|v| v.as_str()),
                    },
                )
                .await
            {
                Ok(result) if result.exit_code != 0 && attempt < 2 && result.steamcmd_restart => {
                    self.emit_console_output(
                        server_id,
                        "system",
                        "[Catalyst] SteamCMD self-updated and restarted. Retrying installation...\n",
                    )
                    .await?;
                    continue;
                }
                Ok(result) => break result,
                Err(error) => return Err(error),
            }
        };

        // The outer operation consumes this attempt's cancellation and avoids
        // an error event after removal, including when it surfaced as exit 137.
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;

        if exit_code != 0 {
            let stderr_trimmed = stderr_buffer.trim();
            let stdout_trimmed = stdout_buffer.trim();
            let mut reason = if !stderr_trimmed.is_empty() {
                stderr_trimmed.to_string()
            } else if !stdout_trimmed.is_empty() {
                stdout_trimmed.to_string()
            } else {
                "Install script failed".to_string()
            };
            if disk_write_failed {
                reason = format!(
                    "SteamCMD 0x202: disk write failed. Catalyst gives each server a loop-mounted quota (default 10 GB). CS2 needs about 40 GB. Resize the server disk and reinstall. ({reason})"
                );
            }
            if exit_code == 137 {
                reason = format!(
                    "Install container was killed (exit 137, likely out of memory). Installs are capped at 2 GiB RAM with a 1 GiB /tmp. ({reason})"
                );
            }
            // Never log raw installer tails: they often contain shell values
            // substituted from passwords/API keys. Lengths are safe diagnostics.
            warn!(
                "Install script failed for {} with exit {} (stdout {} bytes, stderr {} bytes)",
                server_id,
                exit_code,
                stdout_buffer.len(),
                stderr_buffer.len()
            );
            let _ = self
                .emit_console_output(server_id, "stderr", &format!("{}\n", reason))
                .await;
            return Err(AgentError::InstallationError(format!(
                "Install script failed: {}",
                reason
            )));
        }

        if stdout_buffer.trim().is_empty() && stderr_buffer.trim().is_empty() {
            self.emit_console_output(server_id, "system", "[Catalyst] Installation complete.\n")
                .await?;
        }

        // Check for EULA files that require acceptance before marking install as done.
        // If a known EULA file exists but is not accepted, pause here and wait for
        // the user to accept/decline via the frontend modal.
        // Jail-aware resolve (same rationale as the console-exit EULA check).
        let eula_file = self.file_manager.resolve_path(server_uuid, "eula.txt").ok();
        if let Some(eula_file) = eula_file.filter(|p| p.exists()) {
            let eula_content = tokio::fs::read_to_string(&eula_file)
                .await
                .unwrap_or_default();
            if !eula_content.to_lowercase().contains("eula=true") {
                info!(
                    "EULA not accepted for server {}, pausing install",
                    server_uuid
                );
                self.emit_console_output(
                    server_id,
                    "system",
                    "[Catalyst] Minecraft EULA must be accepted before the server can start.\n",
                )
                .await?;
                self.emit_eula_required(server_id, server_uuid, &eula_content, &host_server_dir)
                    .await?;
                return Ok(());
            }
        }

        // Stop any existing log streams for this server before marking as stopped
        // This ensures clean state when transitioning to game server container
        self.stop_log_streams_for_server(server_id).await;

        // Emit state update
        self.emit_server_state_update(server_id, "stopped", None, None, None)
            .await?;

        info!("Server installed successfully: {}", server_uuid);
        Ok(())
    }

    pub(crate) async fn cancel_install_server(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;
        let server_uuid = msg["serverUuid"].as_str().unwrap_or("");

        info!(
            "Cancelling install for server: {} (UUID: {})",
            server_id, server_uuid
        );

        // Hold active_installs before cancelled_installs, matching begin/attach.
        // The flag and target removal therefore cannot be interleaved with the
        // install's pending-to-container transition.
        let target = {
            let mut active = self.active_installs.write().await;
            let mut cancelled = self.cancelled_installs.write().await;
            cancel_installer_attempt(&mut active, &mut cancelled, server_id)
        };

        let container_id = match target {
            Some(InstallerRegistration::Container { container_id, .. })
            | Some(InstallerRegistration::LegacyContainer(container_id)) => Some(container_id),
            Some(InstallerRegistration::Pending(attempt_id)) => {
                info!(
                    "Cancelled pending install attempt {} for {} before container registration",
                    attempt_id, server_id
                );
                None
            }
            None => {
                // Never guess by the global `catalyst-installer-` prefix: a
                // different server may own every one of those containers.
                debug!("No active installer registered for server {}", server_id);
                None
            }
        };

        if let Some(container_id) = container_id {
            info!(
                "Killing installer {} for server {}",
                container_id, server_id
            );
            if let Err(error) = self.runtime.remove_container(&container_id).await {
                warn!(
                    "Failed to remove installer {} for server {}: {}",
                    container_id, server_id, error
                );
            }
        } else {
            let _ = self
                .emit_console_output(
                    server_id,
                    "system",
                    "[Catalyst] Install cancelled before container registration.\n",
                )
                .await;
        }

        let _ = self
            .emit_console_output(server_id, "system", "[Catalyst] Installation cancelled.\n")
            .await;
        // Backend already reset panel state; this replayable emit also covers a
        // missed panel update and the pre-spawn/no-container paths.
        self.emit_server_state_update(
            server_id,
            "stopped",
            Some("Install cancelled by user".to_string()),
            None,
            None,
        )
        .await
    }

    async fn reinstall_server_inner(&self, msg: &Value, attempt_id: &str) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        info!("Reinstalling server: {} (UUID: {})", server_id, server_uuid);
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;
        self.emit_console_output(server_id, "system", "[Catalyst] Reinstalling server...\n")
            .await?;

        // Stop server if running
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if !container_id.is_empty()
            && self
                .runtime
                .is_container_running(&container_id)
                .await
                .unwrap_or(false)
        {
            let stop_policy = StopPolicy::default();
            let _ = self
                .stop_server(server_id, container_id.clone(), &stop_policy)
                .await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;

        // Cleanup all containers
        self.cleanup_all_server_containers(server_id, server_uuid)
            .await?;
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;

        // Wipe server data directory contents (keep the directory itself)
        shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        let server_dir = self.config.server.data_dir.join(server_uuid);
        if server_dir.exists() {
            let mut entries = tokio::fs::read_dir(&server_dir).await.map_err(|e| {
                AgentError::IoError(format!("Failed to read server directory: {}", e))
            })?;
            while let Some(entry) = entries.next_entry().await.map_err(|e| {
                AgentError::IoError(format!("Failed to read directory entry: {}", e))
            })? {
                let path = entry.path();
                // Use symlink_metadata so we don't follow links into unexpected trees.
                let meta = tokio::fs::symlink_metadata(&path).await.map_err(|e| {
                    AgentError::IoError(format!("Failed to stat {}: {}", path.display(), e))
                })?;
                if meta.is_dir() {
                    tokio::fs::remove_dir_all(&path).await.map_err(|e| {
                        AgentError::IoError(format!(
                            "Failed to remove dir {}: {}",
                            path.display(),
                            e
                        ))
                    })?;
                } else {
                    // Files and symlinks: remove_file, never remove_dir_all.
                    tokio::fs::remove_file(&path).await.map_err(|e| {
                        AgentError::IoError(format!("Failed to remove {}: {}", path.display(), e))
                    })?;
                }
            }
            self.emit_console_output(server_id, "system", "[Catalyst] Server data wiped.\n")
                .await?;
        }

        // Run the install script under this operation's original registration,
        // so cancellation remains effective throughout setup and both attempts.
        self.install_server_inner(msg, attempt_id).await
    }

    async fn rebuild_server_inner(&self, msg: &Value, attempt_id: &str) -> AgentResult<()> {
        let server_uuid = msg["serverUuid"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        info!("Rebuilding server: {} (UUID: {})", server_id, server_uuid);
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;
        self.emit_console_output(
            server_id,
            "system",
            "[Catalyst] Rebuilding server: re-running install script (user data preserved)...\n",
        )
        .await?;

        // Stop server if running
        let container_id = self.resolve_container_id(server_id, server_uuid).await;
        if !container_id.is_empty()
            && self
                .runtime
                .is_container_running(&container_id)
                .await
                .unwrap_or(false)
        {
            let stop_policy = StopPolicy::default();
            let _ = self
                .stop_server(server_id, container_id.clone(), &stop_policy)
                .await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;

        // Cleanup containers only (NOT data)
        self.cleanup_all_server_containers(server_id, server_uuid)
            .await?;
        self.ensure_installer_attempt_current(server_id, attempt_id)
            .await?;

        self.emit_console_output(
            server_id,
            "system",
            "[Catalyst] Container removed. Re-running installation script...\n",
        )
        .await?;

        // Re-run the template install script over the existing data directory.
        // Unlike reinstall, nothing is wiped first, so user files survive unless
        // the template's own install script overwrites them.
        self.install_server_inner(msg, attempt_id).await
    }

    pub(crate) async fn start_server_with_details(&self, msg: &Value) -> AgentResult<()> {
        let server_id = msg["serverId"]
            .as_str()
            .ok_or_else(|| AgentError::InvalidRequest("Missing serverId".to_string()))?;

        let result: AgentResult<()> = async {
            let server_uuid = msg["serverUuid"]
                .as_str()
                .ok_or_else(|| AgentError::InvalidRequest("Missing serverUuid".to_string()))?;

            // Enforce max servers per node
            let current_servers = self.runtime.list_containers().await?.len();
            if current_servers >= self.config.server.max_connections {
                return Err(AgentError::InvalidRequest(format!(
                    "Node at capacity: {}/{} servers",
                    current_servers, self.config.server.max_connections
                )));
            }

            let template = msg["template"]
                .as_object()
                .ok_or_else(|| AgentError::InvalidRequest("Missing template".to_string()))?;

            let docker_image = msg
                .get("environment")
                .and_then(|v| v.get("TEMPLATE_IMAGE"))
                .and_then(|v| v.as_str())
                .or_else(|| template.get("image").and_then(|v| v.as_str()))
                .ok_or_else(|| {
                    AgentError::InvalidRequest("Missing image in template".to_string())
                })?;

            let startup_command = template
                .get("startup")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    AgentError::InvalidRequest("Missing startup in template".to_string())
                })?;

            let memory_mb = msg["allocatedMemoryMb"].as_u64().ok_or_else(|| {
                AgentError::InvalidRequest("Missing allocatedMemoryMb".to_string())
            })?;
            // Clamp panel-driven allocations so u64->i64 casts and MB->bytes
            // multiplications in the OCI builders cannot overflow.
            let memory_mb = memory_mb.clamp(1, crate::runtime_manager::MAX_MEMORY_MB);

            let cpu_cores = msg["allocatedCpuCores"].as_u64().ok_or_else(|| {
                AgentError::InvalidRequest("Missing allocatedCpuCores".to_string())
            })?;
            let cpu_cores = cpu_cores.clamp(1, crate::runtime_manager::MAX_CPU_CORES);

            let swap_mb = msg["allocatedSwapMb"]
                .as_u64()
                .unwrap_or(0)
                .min(crate::runtime_manager::MAX_MEMORY_MB);
            let io_weight = msg["ioWeight"].as_u64().unwrap_or(500).clamp(10, 1000);
            let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240).clamp(1, 1_048_576);

            // Validated 1..=65535 before the narrowing cast: a bare `as u16`
            // silently truncates (65536 -> 0, 70000 -> 4464).
            let primary_port = crate::net_utils::parse_port_value(
                msg["primaryPort"].as_u64().ok_or_else(|| {
                    AgentError::InvalidRequest("Missing primaryPort".to_string())
                })?,
            )
            .map_err(|_| AgentError::InvalidRequest("Invalid primaryPort".to_string()))?;

            let network_mode = msg.get("networkMode").and_then(|v| v.as_str());
            let port_bindings_value = msg.get("portBindings");

            let environment = msg
                .get("environment")
                .and_then(|v| v.as_object())
                .ok_or_else(|| {
                    AgentError::InvalidRequest("Missing or invalid environment".to_string())
                })?;

            // Convert environment to HashMap
            let mut env_map = std::collections::HashMap::new();
            for (key, value) in environment {
                if let Some(val_str) = value.as_str() {
                    env_map.insert(key.clone(), val_str.to_string());
                }
            }

            // Derive host mount path on-agent (defense in depth). Do not trust control-plane host paths.
            shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
            let derived_server_dir = self.config.server.data_dir.join(server_uuid);
            let host_server_dir = derived_server_dir.to_string_lossy().to_string();
            if let Some(provided) = environment.get("SERVER_DIR").and_then(|v| v.as_str()) {
                if provided != host_server_dir {
                    warn!(
                        "Ignoring backend-provided SERVER_DIR for {}: '{}' (using '{}')",
                        server_uuid, provided, host_server_dir
                    );
                }
            }

            let server_dir_path = PathBuf::from(&host_server_dir);
            self.storage_manager
                .ensure_mounted(server_uuid, &server_dir_path, disk_mb)
                .await?;
            // Container runs as uid 1000:1000 — ensure it can write to its data dir
            if let Err(e) = chown_to_container_user(&server_dir_path).await {
                warn!("Failed to chown server directory: {}", e);
            }
            env_map.insert("HOST_SERVER_DIR".to_string(), host_server_dir.clone());
            env_map.insert("SERVER_DIR".to_string(), CONTAINER_SERVER_DIR.to_string());

            // Proton/SteamCMD containers need STEAM_COMPAT_DATA_PATH and
            // STEAM_COMPAT_CLIENT_INSTALL_PATH so Wine prefixes and compat data
            // are written to the server's data directory instead of crashing.
            let lower_image = docker_image.to_lowercase();
            if lower_image.contains("proton") || lower_image.contains("steamcmd") {
                let appid = env_map.get("SRCDS_APPID").cloned().unwrap_or_default();
                let compat_path = if !appid.is_empty() {
                    format!("/data/.steam/steam/steamapps/compatdata/{}", appid)
                } else {
                    "/data/.proton".to_string()
                };
                env_map.insert("STEAM_COMPAT_DATA_PATH".to_string(), compat_path.clone());
                env_map.insert(
                    "STEAM_COMPAT_CLIENT_INSTALL_PATH".to_string(),
                    "/data/Steam".to_string(),
                );
                info!(
                    "Proton/SteamCMD image detected; set STEAM_COMPAT_DATA_PATH={} STEAM_COMPAT_CLIENT_INSTALL_PATH=/data/Steam",
                    &compat_path
                );
                // Pre-create the compatdata directory on the host so Proton can
                // write its lock file and prefix without crashing on first start.
                // SECURITY: create through the jail-aware resolver so a
                // container-planted symlink at any of these names cannot make
                // the agent create directories outside the server dir as root.
                let rel_compat = compat_path.strip_prefix("/data/").unwrap_or(".proton");
                match crate::file_manager::ensure_dir_beneath(&server_dir_path, rel_compat) {
                    Ok(p) => {
                        if let Err(e) = chown_to_container_user(&p).await {
                            warn!("Failed to chown compatdata dir {}: {}", p.display(), e);
                        }
                    }
                    Err(e) => warn!("Failed to create compatdata dir: {}", e),
                }
                // Also pre-create the Steam client install directory.
                match crate::file_manager::ensure_dir_beneath(&server_dir_path, "Steam") {
                    Ok(p) => {
                        if let Err(e) = chown_to_container_user(&p).await {
                            warn!("Failed to chown Steam dir {}: {}", p.display(), e);
                        }
                    }
                    Err(e) => warn!("Failed to create Steam dir: {}", e),
                }
            }

            info!("Starting server: {} (UUID: {})", server_id, server_uuid);
            info!(
                "Image: {}, Port: {}, Memory: {}MB, CPU: {}",
                docker_image, primary_port, memory_mb, cpu_cores
            );
            self.emit_console_output(server_id, "system", "[Catalyst] Starting server...\n")
                .await?;

            // Replace template variables in startup command
            let mut final_startup_command = startup_command.to_string();

            // Wings builtins + Catalyst aliases for startup command substitution.
            env_map.insert("MEMORY".to_string(), memory_mb.to_string());
            env_map.insert("SERVER_MEMORY".to_string(), memory_mb.to_string());
            env_map.insert("PORT".to_string(), primary_port.to_string());
            env_map.insert("SERVER_PORT".to_string(), primary_port.to_string());
            env_map
                .entry("SERVER_IP".to_string())
                .or_insert_with(|| "0.0.0.0".to_string());
            env_map
                .entry("SERVER_UUID".to_string())
                .or_insert_with(|| server_uuid.to_string());
            env_map
                .entry("P_SERVER_UUID".to_string())
                .or_insert_with(|| server_uuid.to_string());
            env_map
                .entry("UUID".to_string())
                .or_insert_with(|| server_uuid.to_string());
            env_map
                .entry("P_SERVER_LOCATION".to_string())
                .or_insert_with(|| "catalyst".to_string());
            env_map
                .entry("TZ".to_string())
                .or_insert_with(|| "UTC".to_string());
            env_map
                .entry("HOME".to_string())
                .or_insert_with(|| CONTAINER_SERVER_DIR.to_string());

            // Keep GAME_PORT in sync when the egg defines it.
            if env_map.contains_key("GAME_PORT") {
                env_map.insert("GAME_PORT".to_string(), primary_port.to_string());
            }

            // `MEMORY_XMS` from the panel is an operator override. Eggs that
            // use {{MEMORY_XMS}} without a value get Paper's 128M default.
            // Do not auto-fill 50% of allocation — that commits a huge heap
            // at boot (unlike Pterodactyl's -Xms128M).
            let xms_from_panel = env_map
                .get("MEMORY_XMS")
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|v| *v > 0);
            let xms_percent = env_map
                .get("MEMORY_XMS_PERCENT")
                .and_then(|v| v.parse::<u64>().ok())
                .filter(|v| *v > 0 && *v <= 100);
            if xms_from_panel.is_none() {
                env_map.insert(
                    "MEMORY_XMS".to_string(),
                    crate::shell_utils::JAVA_DEFAULT_XMS_MB.to_string(),
                );
            }

            // Replace all {{VARIABLE}} placeholders.
            // Values are inserted RAW (not shell-escaped) because eggs commonly
            // embed them inside larger tokens (e.g. -Xmx{{SERVER_MEMORY}}M).
            // Shell-escaping each value would break those tokens ('2048'M).
            // Defense-in-depth against injection is handled by the panel's
            // variable validation + the fact that the full command is passed
            // as a single argv element to sh -c / image entrypoint.
            for (key, value) in &env_map {
                let placeholder = format!("{{{{{}}}}}", key);
                final_startup_command = final_startup_command.replace(&placeholder, value);
            }

            // Some templates use bash-style arithmetic tests like ((1)); convert for /bin/sh.
            final_startup_command = shell_utils::normalize_startup_for_sh(&final_startup_command);

            // ── Java: advertised allocation is the heap; cgroup is larger ──────────
            // Operators who set Memory=2GB expect -Xmx2G, not 1.5G. Off-heap
            // (Direct defaults to Xmx, metaspace, stacks, glibc arenas) is added
            // to the cgroup instead of stolen from the heap. _JAVA_OPTIONS is
            // appended last by HotSpot and overrides CLI / @argfiles.
            let mut container_memory_mb = memory_mb;
            let java_fix_enabled =
                env_map.get("CATALYST_JAVA_MEMORY_FIX").map(|v| v.as_str()) != Some("0");
            let is_java = crate::shell_utils::looks_like_java(&final_startup_command, docker_image);
            if java_fix_enabled && is_java {
                let requested_heap = crate::shell_utils::parse_xmx_mb(&final_startup_command);
                // Modded eggs (Forge/NeoForge/CurseForge/Modrinth) chain
                // @user_jvm_args.txt / @unix_args.txt. Those files often ship a
                // hardcoded -Xmx2G from the modpack. _JAVA_OPTIONS overrides
                // them, but only up to the heap we plan here: when the CLI
                // already requests less than the allocation we honor it, so a
                // stale 2G entry is exactly how an 8GB server stays at ~2GB.
                // Inspect the files on the host before start to name the culprit.
                let mut argfile_heap: Option<(String, u64)> = None;
                for name in ["user_jvm_args.txt", "unix_args.txt"] {
                    let p = server_dir_path.join(name);
                    if let Ok(text) = tokio::fs::read_to_string(&p).await {
                        if let Some(mb) = crate::shell_utils::parse_xmx_mb(&text) {
                            argfile_heap = Some((name.to_string(), mb));
                        }
                    }
                }
                let literal_xms = crate::shell_utils::parse_xms_mb(startup_command);
                let requested_xms = xms_from_panel.or_else(|| {
                    xms_percent.map(|pct| (memory_mb * pct / 100).max(1))
                }).or(literal_xms);
                let plan = crate::shell_utils::plan_java_memory(
                    memory_mb,
                    requested_heap,
                    requested_xms,
                );
                if memory_mb >= 256 && plan.heap_mb >= 128 {
                    let existing = env_map.get("_JAVA_OPTIONS").cloned().unwrap_or_default();
                    let injected = plan.java_options();
                    let merged = if existing.trim().is_empty() {
                        injected
                    } else {
                        format!("{} {}", existing.trim(), injected)
                    };
                    env_map.insert("_JAVA_OPTIONS".to_string(), merged);
                    env_map
                        .entry("MALLOC_ARENA_MAX".to_string())
                        .or_insert_with(|| "2".to_string());
                    final_startup_command = crate::shell_utils::normalize_java_heap_args(
                        &final_startup_command,
                    );
                    container_memory_mb = plan.cgroup_mb;
                    info!(
                        "Java memory plan: heap {}M xms {}M direct {}M metaspace {}M cgroup {}M (allocation {}M, orig startup: {})",
                        plan.heap_mb,
                        plan.xms_mb,
                        plan.direct_mb,
                        plan.metaspace_mb,
                        plan.cgroup_mb,
                        memory_mb,
                        startup_command
                    );
                    let _ = self
                        .emit_console_output(
                            server_id,
                            "system",
                            &format!(
                                "[Catalyst] JVM heap -Xmx{}M (server Memory {}M); container {}M to fit off-heap (direct {}M, metaspace {}M)\n",
                                plan.heap_mb, memory_mb, plan.cgroup_mb, plan.direct_mb, plan.metaspace_mb
                            ),
                        )
                        .await;
                    if let Some(warning) = crate::shell_utils::heap_below_allocation_warning(
                        memory_mb,
                        requested_heap,
                        argfile_heap.as_ref().map(|(n, mb)| (n.as_str(), *mb)),
                    ) {
                        warn!(
                            "Java heap below allocation for {}: {}",
                            server_id, warning
                        );
                        let _ = self
                            .emit_console_output(
                                server_id,
                                "system",
                                &format!("[Catalyst] {}\n", warning),
                            )
                            .await;
                    }
                }
            }

            info!("Final startup command: {}", final_startup_command);

            // Apply Pterodactyl egg config.files (properties/json/ini/yaml/xml/file)
            // before the container starts — same timing as Wings UpdateConfigurationFiles.
            {
                let mut specs = crate::config_parser::specs_from_template(template);
                let paper_like = is_java
                    || lower_image.contains("minecraft")
                    || lower_image.contains("purpur")
                    || lower_image.contains("paper")
                    || lower_image.contains("folia")
                    || lower_image.contains("spigot")
                    || lower_image.contains("bukkit");
                if paper_like {
                    specs.extend(crate::config_parser::paper_disk_space_specs());
                    // Paper's getUsableSpace() on a missing world/ can return 0
                    // even when /data has tens of GB. Create it on the loop FS.
                    if let Err(e) =
                        crate::file_manager::ensure_dir_beneath(&server_dir_path, "world")
                    {
                        warn!("Failed to create world dir: {}", e);
                    }
                    let _ = self
                        .emit_console_output(
                            server_id,
                            "system",
                            "[Catalyst] Paper/Purpur disk-space exit disabled (Java often reports 0 bytes free on loop mounts).\n",
                        )
                        .await;
                }
                if !specs.is_empty() {
                    let primary_ip = env_map
                        .get("SERVER_IP")
                        .cloned()
                        .unwrap_or_else(|| "0.0.0.0".to_string());
                    let disk_mb = msg["allocatedDiskMb"].as_u64().unwrap_or(10240);
                    let cfg_ctx = crate::config_parser::ConfigResolveContext {
                        env: env_map.clone(),
                        primary_port,
                        primary_ip,
                        server_uuid: server_uuid.to_string(),
                        server_memory_mb: memory_mb,
                        server_disk_mb: disk_mb,
                        docker_interface: "0.0.0.0".to_string(),
                    };
                    if let Err(e) = crate::config_parser::apply_configuration_files(
                        &server_dir_path,
                        &specs,
                        &cfg_ctx,
                    )
                    .await
                    {
                        warn!(
                            "Config file application reported error for {}: {}",
                            server_uuid, e
                        );
                    }
                    // Ensure runtime user can still write after config rewrites.
                    if let Err(e) = chown_to_container_user(&server_dir_path).await {
                        warn!(
                            "Failed to chown after config apply for {}: {}",
                            server_uuid, e
                        );
                    }
                }
            }

            let network_ip = env_map
                .get("CATALYST_NETWORK_IP")
                .or_else(|| env_map.get("AERO_NETWORK_IP"))
                .map(|value| value.as_str())
                .and_then(|raw| {
                    match crate::net_utils::validate_static_ip_in_subnet(
                        raw,
                        &self.config.containerd.cni_bridge_subnet,
                    ) {
                        Ok(valid) => Some(valid),
                        Err(reason) => {
                            // Fall back to DHCP instead of failing the start:
                            // a bad static IP must not wedge the server.
                            warn!(
                                "Ignoring invalid CATALYST_NETWORK_IP '{}' for {}: {}; using DHCP",
                                raw, server_id, reason
                            );
                            None
                        }
                    }
                });
            let network_ip_ref = network_ip.as_deref();

            let mut port_bindings = HashMap::new();
            if let Some(map) = port_bindings_value.and_then(|value| value.as_object()) {
                port_bindings = crate::net_utils::parse_port_bindings(map)?;
            }

            self.cleanup_all_server_containers(server_id, server_uuid)
                .await?;

            // Create and start container
            self.runtime
                .create_container(crate::runtime_manager::ContainerConfig {
                    container_id: server_id,
                    server_id,
                    image: docker_image,
                    startup_command: &final_startup_command,
                    env: &env_map,
                    memory_mb: container_memory_mb,
                    memory_reservation_mb: if container_memory_mb > memory_mb {
                        memory_mb
                    } else {
                        0
                    },
                    swap_mb,
                    cpu_cores,
                    io_weight,
                    data_dir: &host_server_dir,
                    port: primary_port,
                    port_bindings: &port_bindings,
                    network_mode,
                    network_ip: network_ip_ref,
                })
                .await?;

            let is_running = match self.runtime.is_container_running(server_id).await {
                Ok(value) => value,
                Err(err) => {
                    error!("Failed to check container state for {}: {}", server_id, err);
                    self.report_error(
                        ErrorLevel::Error,
                        "agent:container_health",
                        &format!("Failed to check container state for {}: {}", server_id, err),
                        None,
                        None,
                    ).await;
                    false
                }
            };
            if !is_running {
                let exit_code = self
                    .runtime
                    .get_container_exit_code(server_id)
                    .await
                    .unwrap_or(None);
                let reason = if exit_code == Some(137) {
                    format!("Container exited immediately with code 137 (OOM killed — cgroup {}M limit exceeded; JVM off-heap counts toward the limit — increase Memory allocation)", memory_mb)
                } else {
                    match exit_code {
                        Some(code) => format!("Container exited immediately with code {}", code),
                        None => "Container exited immediately after start".to_string(),
                    }
                };
                if let Ok(logs) = self.runtime.get_logs(server_id, Some(100)).await {
                    if !logs.trim().is_empty() {
                        self.emit_console_output(server_id, "stderr", &logs).await?;
                    }
                }
                return Err(AgentError::ContainerError(reason));
            }

            let container_id = self.resolve_container_id(server_id, server_uuid).await;
            if !container_id.is_empty() {
                // Stop any existing log streams for this server before starting new one
                // This is critical when transitioning from installer to game server container
                self.stop_log_streams_for_server(server_id).await;
                self.spawn_log_stream(server_id, &container_id);
                self.spawn_exit_monitor(server_id, &container_id);

                // Store auto-restart config, start message, and port for this server
                // Clamp panel-driven auto-restart knobs: unbounded delay
                // wedges restart loops, unbounded windows defeat rate
                // limiting, unbounded maxRestarts is an infinite crash loop.
                let mut ar_config = parse_auto_restart_config(msg);
                clamp_auto_restart_config(&mut ar_config);
                self.auto_restart_configs
                    .write()
                    .await
                    .insert(server_id.to_string(), ar_config);
                self.start_server_messages
                    .write()
                    .await
                    .insert(server_id.to_string(), {
                        // Store a restart plan with real environment values so
                        // auto-restart can recreate the container correctly.
                        // Drop installScript (not needed for restart). Do NOT
                        // redact env values here — redaction belongs in logs only.
                        let mut restart_msg = msg.clone();
                        if let Some(obj) = restart_msg.as_object_mut() {
                            obj.remove("installScript");
                        }
                        restart_msg
                    });
                self.server_ports
                    .write()
                    .await
                    .insert(server_id.to_string(), (container_id.clone(), primary_port));
            }

            // Emit state update
            self.emit_server_state_update(
                server_id,
                "running",
                None,
                Some(port_bindings.clone()),
                None,
            )
            .await?;

            info!("Server started successfully: {}", server_id);
            Ok(())
        }
        .await;

        if let Err(err) = &result {
            let reason = format!("Start failed: {}", err);
            let _ = self
                .emit_console_output(server_id, "stderr", &format!("[Catalyst] {}\n", reason))
                .await;
            let _ = self
                .emit_server_state_update(server_id, "error", Some(reason), None, None)
                .await;
        }

        result
    }

    pub(crate) async fn start_server(
        &self,
        server_id: &str,
        container_id: String,
    ) -> AgentResult<()> {
        if container_id.is_empty() {
            return Err(AgentError::ContainerError(format!(
                "Container not found for server {}",
                server_id
            )));
        }
        info!(
            "Starting server: {} (container {})",
            server_id, container_id
        );

        // In production, fetch server config from database or local cache
        match self.runtime.start_container(&container_id).await {
            Ok(()) => {
                self.spawn_log_stream(server_id, &container_id);
                self.spawn_exit_monitor(server_id, &container_id);
                self.emit_server_state_update(server_id, "running", None, None, None)
                    .await?;
                Ok(())
            }
            Err(err) => {
                let reason = format!("Start failed: {}", err);
                let _ = self
                    .emit_console_output(server_id, "stderr", &format!("[Catalyst] {}\n", reason))
                    .await;
                let _ = self
                    .emit_server_state_update(server_id, "error", Some(reason), None, None)
                    .await;
                Err(err)
            }
        }
    }

    async fn wait_for_container_shutdown(&self, container_id: &str, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if !self
                .runtime
                .is_container_running(container_id)
                .await
                .unwrap_or(false)
            {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    pub(crate) async fn stop_server(
        &self,
        server_id: &str,
        container_id: String,
        stop_policy: &StopPolicy,
    ) -> AgentResult<()> {
        if container_id.is_empty() {
            info!(
                "No container found for server {}, marking as stopped",
                server_id
            );
            self.stop_monitor_task(server_id).await;
            self.auto_restart_configs.write().await.remove(server_id);
            self.restart_trackers.write().await.remove(server_id);
            self.start_server_messages.write().await.remove(server_id);
            self.server_ports.write().await.remove(server_id);
            self.server_health_state.write().await.remove(server_id);
            self.emit_server_state_update(server_id, "stopped", None, None, None)
                .await?;
            return Ok(());
        }
        info!(
            "Stopping server: {} (container {})",
            server_id, container_id
        );

        self.stop_monitor_task(server_id).await;
        // Clean up auto-restart state since the stop is intentional
        self.auto_restart_configs.write().await.remove(server_id);
        self.restart_trackers.write().await.remove(server_id);
        self.start_server_messages.write().await.remove(server_id);
        self.server_ports.write().await.remove(server_id);
        self.server_health_state.write().await.remove(server_id);

        if self
            .runtime
            .is_container_running(&container_id)
            .await
            .unwrap_or(false)
        {
            let mut stopped_gracefully = false;
            if let Some(command) = stop_policy.stop_command.as_deref() {
                let payload = if command.ends_with('\n') {
                    command.to_string()
                } else {
                    format!("{}\n", command)
                };
                let _ = self
                    .emit_console_output(
                        server_id,
                        "system",
                        "[Catalyst] Sending graceful stop command to server process...\n",
                    )
                    .await;

                match self.runtime.send_input(&container_id, &payload).await {
                    Ok(()) => {
                        if self
                            .wait_for_container_shutdown(&container_id, Duration::from_secs(20))
                            .await
                        {
                            stopped_gracefully = true;
                        } else {
                            let _ = self
                                .emit_console_output(
                                    server_id,
                                    "system",
                                    &format!(
                                        "[Catalyst] Stop command timed out, sending {}...\n",
                                        stop_policy.stop_signal
                                    ),
                                )
                                .await;
                        }
                    }
                    Err(err) => {
                        warn!(
                            "Graceful stop command failed for server {} (container {}): {}",
                            server_id, container_id, err
                        );
                        let _ = self
                            .emit_console_output(
                                server_id,
                                "system",
                                &format!(
                                    "[Catalyst] Stop command failed ({}), sending {}...\n",
                                    err, stop_policy.stop_signal
                                ),
                            )
                            .await;
                    }
                }
            }

            if !stopped_gracefully {
                let _ = self
                    .emit_console_output(
                        server_id,
                        "system",
                        &format!(
                            "[Catalyst] Requesting graceful shutdown with {}...\n",
                            stop_policy.stop_signal
                        ),
                    )
                    .await;
                self.runtime
                    .stop_container_with_signal(&container_id, &stop_policy.stop_signal, 30)
                    .await?;
            }
        }

        if self.runtime.container_exists(&container_id).await {
            self.runtime.remove_container(&container_id).await?;
        }

        self.emit_server_state_update(server_id, "stopped", None, None, None)
            .await?;

        Ok(())
    }

    pub(crate) async fn kill_server(
        &self,
        server_id: &str,
        container_id: String,
    ) -> AgentResult<()> {
        if container_id.is_empty() {
            info!(
                "No container found for server {}, marking as killed",
                server_id
            );
            self.stop_monitor_task(server_id).await;
            self.emit_server_state_update(
                server_id,
                "crashed",
                Some("Killed by agent".to_string()),
                None,
                Some(137),
            )
            .await?;
            return Ok(());
        }
        info!(
            "Force killing server: {} (container {})",
            server_id, container_id
        );

        // Stop monitoring first - we don't want monitor interfering
        self.stop_monitor_task(server_id).await;

        let _ = self
            .emit_console_output(
                server_id,
                "system",
                "[Catalyst] Force killing server with SIGKILL...\n",
            )
            .await;

        // Force kill the container - this method never fails and always attempts cleanup
        if let Err(e) = self.runtime.force_kill_container(&container_id).await {
            warn!(
                "Force kill had issues for {}: {}, continuing with cleanup",
                container_id, e
            );
        }

        // Always attempt to remove the container regardless of what happened above
        // remove_container also sends SIGKILL, so this is a safety net
        if self.runtime.container_exists(&container_id).await {
            if let Err(e) = self.runtime.remove_container(&container_id).await {
                warn!(
                    "Failed to remove container {}: {}, server state still updated",
                    container_id, e
                );
            }
        }

        // Always update state to crashed - this must happen no matter what
        self.emit_server_state_update(
            server_id,
            "crashed",
            Some("Killed by agent".to_string()),
            None,
            Some(137), // 128 + 9 (SIGKILL exit code)
        )
        .await?;

        Ok(())
    }

    pub(crate) async fn delete_server(
        &self,
        server_id: &str,
        server_uuid: &str,
    ) -> AgentResult<()> {
        // SECURITY: these identifiers are joined into filesystem paths
        // (data_dir/<id>) and used in remove_dir_all below. An absolute or
        // traversal id would escape the data dir and delete arbitrary host
        // directories as root (Path::join replaces the base on "/..." and
        // "../" escapes it). Validate both as single safe segments.
        crate::shell_utils::validate_safe_path_segment(server_id, "serverId")?;
        crate::shell_utils::validate_safe_path_segment(server_uuid, "serverUuid")?;
        info!("Deleting server: {} (uuid: {})", server_id, server_uuid);

        // Stop monitoring
        self.stop_monitor_task(server_id).await;

        // Try both possible container names (server_id and server_uuid)
        for container_name in &[server_id, server_uuid] {
            if self.runtime.container_exists(container_name).await {
                if self
                    .runtime
                    .is_container_running(container_name)
                    .await
                    .unwrap_or(false)
                {
                    if let Err(e) = self.runtime.stop_container(container_name, 5).await {
                        warn!(
                            "Failed to stop container {} during delete: {}",
                            container_name, e
                        );
                        let _ = self.runtime.kill_container(container_name, "SIGKILL").await;
                    }
                }
                if let Err(e) = self.runtime.remove_container(container_name).await {
                    warn!(
                        "Failed to remove container {} during delete: {}",
                        container_name, e
                    );
                }
            }
        }

        // Clean up firewall rules for this server (by both identifiers)
        FirewallManager::remove_server_ports(server_id).await;
        if !server_uuid.is_empty() && server_uuid != server_id {
            FirewallManager::remove_server_ports(server_uuid).await;
        }

        // Clean up server data directory + disk image (unmount first if needed)
        let data_dir = self.config.server.data_dir.clone();
        for id in &[server_id, server_uuid] {
            if !id.is_empty() {
                let server_dir = std::path::Path::new(&data_dir).join(id);
                if let Err(e) = self
                    .storage_manager
                    .destroy_server_storage(id, &server_dir)
                    .await
                {
                    warn!(
                        "Failed to destroy storage for {}: {}",
                        server_dir.display(),
                        e
                    );
                } else {
                    info!("Removed server storage: {}", server_dir.display());
                }
            }
        }

        info!("Server {} deleted successfully", server_id);
        Ok(())
    }
}

/// Clamp panel-driven auto-restart knobs to safe ranges: delay 1..=3600s,
/// window 1..=86400s, maxRestarts 0..=100.
pub(crate) fn clamp_auto_restart_config(config: &mut AutoRestartConfig) {
    config.delay_secs = config.delay_secs.clamp(1, 3600);
    config.window_secs = config.window_secs.clamp(1, 86400);
    config.max_restarts = config.max_restarts.min(100);
}

#[cfg(test)]
mod server_lifecycle_security_tests {
    use super::*;

    #[test]
    fn auto_restart_clamps_absurd_values() {
        let mut config = AutoRestartConfig {
            enabled: true,
            delay_secs: 0,
            max_restarts: 999_999,
            window_secs: 1_000_000,
        };
        clamp_auto_restart_config(&mut config);
        assert_eq!(config.delay_secs, 1);
        assert_eq!(config.max_restarts, 100);
        assert_eq!(config.window_secs, 86400);
    }

    #[test]
    fn auto_restart_preserves_sane_values() {
        let mut config = AutoRestartConfig {
            enabled: true,
            delay_secs: 30,
            max_restarts: 5,
            window_secs: 300,
        };
        clamp_auto_restart_config(&mut config);
        assert_eq!(config.delay_secs, 30);
        assert_eq!(config.max_restarts, 5);
        assert_eq!(config.window_secs, 300);
    }

    #[test]
    fn auto_restart_allows_zero_max_restarts() {
        // 0 = never auto-restart; must survive the clamp.
        let mut config = AutoRestartConfig {
            enabled: true,
            delay_secs: 10,
            max_restarts: 0,
            window_secs: 60,
        };
        clamp_auto_restart_config(&mut config);
        assert_eq!(config.max_restarts, 0);
    }

    #[test]
    fn installer_diagnostics_retain_only_a_utf8_safe_tail() {
        let mut output = "prefix ".repeat(256);
        append_installer_diagnostic(&mut output, "\u{1f980}tail", 64);

        assert!(output.len() <= 64);
        assert!(output.ends_with("\u{1f980}tail"));
        assert!(std::str::from_utf8(output.as_bytes()).is_ok());
    }

    #[test]
    fn installer_markers_survive_diagnostic_tail_eviction() {
        let mut markers = InstallerMarkers::default();
        let mut tail = String::new();
        for text in [
            "steamcmd.sh\n",
            "Restarting\n0x202\n",
            &"later output\n".repeat(100),
        ] {
            markers.record(text);
            append_installer_diagnostic(&mut tail, text, 64);
        }
        assert!(!tail.contains("steamcmd.sh"));
        assert!(markers.steamcmd_restart());
        assert!(markers.disk_write_failed);
    }

    #[test]
    fn dispatch_preregistration_never_overwrites_a_live_attempt() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        assert!(pre_register_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
        assert!(!pre_register_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "queued-b"
        ));
        assert_eq!(
            InstallerRegistration::parse(active.get("alpha").unwrap()),
            InstallerRegistration::Pending("attempt-a".to_string())
        );

        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-a",
                "catalyst-installer-alpha"
            ),
            InstallerAttach::Attached
        );
        assert!(!pre_register_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "queued-c"
        ));
        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha"),
            Some(InstallerRegistration::Container {
                attempt_id: "attempt-a".to_string(),
                container_id: "catalyst-installer-alpha".to_string(),
            })
        );
    }

    #[test]
    fn pending_cancel_blocks_attach_and_is_consumed_once() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "attempt-a");
        assert!(installer_attempt_is_current(
            &active,
            &cancelled,
            "alpha",
            "attempt-a"
        ));

        let target = cancel_installer_attempt(&mut active, &mut cancelled, "alpha");
        assert_eq!(
            target,
            Some(InstallerRegistration::Pending("attempt-a".to_string()))
        );
        assert!(!active.contains_key("alpha"));
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-a",
                "catalyst-installer-alpha"
            ),
            InstallerAttach::Cancelled
        );
        assert!(!active.contains_key("alpha"));
        assert!(consume_installer_cancellation(
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
        assert!(!consume_installer_cancellation(
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
    }

    #[test]
    fn cancelled_prepare_cannot_start_or_displace_the_replacement_attempt() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "attempt-a");

        // A is still preparing when cancellation removes only its pending
        // registration. B may then prepare and attach its own exact container.
        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha"),
            Some(InstallerRegistration::Pending("attempt-a".to_string()))
        );
        assert!(pre_register_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-b"
        ));
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-b",
                "container-b"
            ),
            InstallerAttach::Attached
        );

        // A's eventual prepared handle is rejected before its consuming start.
        // Its scoped cleanup/clear cannot reattach A or remove B's start gate.
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-a",
                "container-a"
            ),
            InstallerAttach::Cancelled
        );
        clear_installer_attempt(&mut active, "alpha", "attempt-a");
        release_installer_container(&mut active, "alpha", "attempt-a", "container-a");
        assert_eq!(
            InstallerRegistration::parse(active.get("alpha").unwrap()),
            InstallerRegistration::Container {
                attempt_id: "attempt-b".to_string(),
                container_id: "container-b".to_string(),
            }
        );

        // A second attach is not a start step: B remains registered exactly
        // once and a late lifecycle caller cannot replace its prepared target.
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-b",
                "container-b-late"
            ),
            InstallerAttach::Superseded
        );
        assert_eq!(
            InstallerRegistration::parse(active.get("alpha").unwrap()),
            InstallerRegistration::Container {
                attempt_id: "attempt-b".to_string(),
                container_id: "container-b".to_string(),
            }
        );
    }

    #[test]
    fn cancelling_one_server_never_targets_another_or_scans_prefixes() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        for (server, attempt, container) in [
            ("alpha", "attempt-a", "catalyst-installer-alpha"),
            ("beta", "attempt-b", "catalyst-installer-beta"),
        ] {
            begin_installer_attempt(&mut active, &mut cancelled, server, attempt);
            assert_eq!(
                attach_installer_container(&mut active, &cancelled, server, attempt, container),
                InstallerAttach::Attached
            );
        }

        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha"),
            Some(InstallerRegistration::Container {
                attempt_id: "attempt-a".to_string(),
                container_id: "catalyst-installer-alpha".to_string(),
            })
        );
        assert!(active.contains_key("beta"));
        assert!(!cancelled.contains_key("beta"));
        assert!(installer_attempt_is_current(
            &active,
            &cancelled,
            "beta",
            "attempt-b"
        ));

        // No registration means no container ID at all; there is deliberately
        // no fallback from which a caller could remove another install.
        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "unknown"),
            None
        );
        assert!(active.contains_key("beta"));
        clear_installer_attempt(&mut active, "beta", "attempt-b");
        assert!(active.is_empty());
    }

    #[test]
    fn stale_attempt_cleanup_cannot_clear_a_new_registration() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "old");
        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha"),
            Some(InstallerRegistration::Pending("old".to_string()))
        );
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "new");
        assert!(installer_attempt_is_cancelled(&cancelled, "alpha", "old"));
        assert!(!installer_attempt_is_cancelled(&cancelled, "alpha", "new"));

        clear_installer_attempt(&mut active, "alpha", "old");
        assert!(installer_attempt_is_current(
            &active, &cancelled, "alpha", "new"
        ));
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "new",
                "catalyst-installer-new"
            ),
            InstallerAttach::Attached
        );
        clear_installer_attempt(&mut active, "alpha", "old");
        assert!(active.contains_key("alpha"));
        clear_installer_attempt(&mut active, "alpha", "new");
        assert!(!active.contains_key("alpha"));
    }

    #[test]
    fn steamcmd_retry_rearms_only_the_cleaned_container_of_the_same_attempt() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "attempt-a");
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-a",
                "container-one"
            ),
            InstallerAttach::Attached
        );

        // A live registration cannot be replaced, and cleaning a different ID
        // cannot detach it. Only successful cleanup of the owned ID re-arms it.
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-a",
                "container-live"
            ),
            InstallerAttach::Superseded
        );
        release_installer_container(&mut active, "alpha", "attempt-a", "wrong-container");
        assert_eq!(
            InstallerRegistration::parse(active.get("alpha").unwrap()),
            InstallerRegistration::Container {
                attempt_id: "attempt-a".to_string(),
                container_id: "container-one".to_string(),
            }
        );

        release_installer_container(&mut active, "alpha", "attempt-a", "container-one");
        assert!(installer_attempt_is_current(
            &active,
            &cancelled,
            "alpha",
            "attempt-a"
        ));
        assert_eq!(
            attach_installer_container(
                &mut active,
                &cancelled,
                "alpha",
                "attempt-a",
                "container-two"
            ),
            InstallerAttach::Attached
        );
        clear_installer_attempt(&mut active, "alpha", "stale-attempt");
        assert!(installer_attempt_is_current(
            &active,
            &cancelled,
            "alpha",
            "attempt-a"
        ));

        // A terminal run failure with successful cleanup leaves this pending
        // registration for outer finish; that failure must not leak it.
        release_installer_container(&mut active, "alpha", "attempt-a", "container-two");
        assert_eq!(
            InstallerRegistration::parse(active.get("alpha").unwrap()),
            InstallerRegistration::Pending("attempt-a".to_string())
        );
        assert!(!finish_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
        assert!(active.is_empty());
        assert!(cancelled.is_empty());
    }

    #[test]
    fn cancelled_old_finish_is_suppressed_without_touching_immediate_reinstall() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "attempt-a");
        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha"),
            Some(InstallerRegistration::Pending("attempt-a".to_string()))
        );
        assert!(pre_register_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-b"
        ));

        // `finish_install_operation` returns before its error event when this is
        // true. A's completion consumes A only and cannot clear B's registration.
        assert!(finish_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
        assert!(installer_attempt_is_current(
            &active,
            &cancelled,
            "alpha",
            "attempt-b"
        ));
        assert!(!installer_attempt_is_cancelled(
            &cancelled,
            "alpha",
            "attempt-b"
        ));
    }

    #[test]
    fn late_attempt_cannot_consume_the_new_attempts_cancellation() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "attempt-a");
        cancel_installer_attempt(&mut active, &mut cancelled, "alpha");
        assert!(pre_register_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-b"
        ));
        cancel_installer_attempt(&mut active, &mut cancelled, "alpha");

        assert!(finish_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
        assert!(installer_attempt_is_cancelled(
            &cancelled,
            "alpha",
            "attempt-b"
        ));
        assert!(!finish_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
        assert!(installer_attempt_is_cancelled(
            &cancelled,
            "alpha",
            "attempt-b"
        ));
        assert!(finish_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-b"
        ));
        assert!(cancelled.is_empty());
    }

    #[test]
    fn repeated_reconnect_generations_keep_their_own_cancellation() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        begin_installer_attempt(&mut active, &mut cancelled, "alpha", "attempt-a");
        for (abandoned, next) in [("attempt-a", "attempt-b"), ("attempt-b", "attempt-c")] {
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha");
            assert!(pre_register_installer_attempt(
                &mut active,
                &mut cancelled,
                "alpha",
                next
            ));
            assert!(finish_installer_attempt(
                &mut active,
                &mut cancelled,
                "alpha",
                abandoned
            ));
            assert!(installer_attempt_is_current(
                &active, &cancelled, "alpha", next
            ));
        }

        // Another stale completion during a later connection cannot affect C.
        assert!(!finish_installer_attempt(
            &mut active,
            &mut cancelled,
            "alpha",
            "attempt-a"
        ));
        assert!(installer_attempt_is_current(
            &active,
            &cancelled,
            "alpha",
            "attempt-c"
        ));
    }

    #[test]
    fn cancel_without_an_active_attempt_leaves_no_orphan_state() {
        let mut active = HashMap::new();
        let mut cancelled = InstallerCancellations::new();
        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha"),
            None
        );
        assert!(active.is_empty());
        assert!(cancelled.is_empty());
        assert_eq!(
            cancel_installer_attempt(&mut active, &mut cancelled, "alpha"),
            None
        );
        assert!(cancelled.is_empty());
    }

    #[test]
    fn registration_parser_preserves_legacy_exact_container_id() {
        assert_eq!(
            InstallerRegistration::parse("catalyst-installer-legacy"),
            InstallerRegistration::LegacyContainer("catalyst-installer-legacy".to_string())
        );
        let encoded = InstallerRegistration::container("attempt-1", "catalyst-installer-one");
        assert_eq!(
            InstallerRegistration::parse(&encoded),
            InstallerRegistration::Container {
                attempt_id: "attempt-1".to_string(),
                container_id: "catalyst-installer-one".to_string(),
            }
        );
        assert_eq!(
            InstallerRegistration::parse("legacy:container:one"),
            InstallerRegistration::LegacyContainer("legacy:container:one".to_string())
        );
    }

    #[test]
    fn installer_batch_plan_holds_trailing_fragment_until_final_flush() {
        let live = plan_installer_batches("alpha\r\n\u{1f980}\rpartial", false, 1024);
        assert_eq!(live.consumed_bytes, "alpha\r\n\u{1f980}\r".len());
        assert_eq!(live.batches.len(), 1);
        assert_eq!(live.batches[0].0, "alpha\r\n\u{1f980}\r".len());
        assert_eq!(live.batches[0].1, "alpha\n\u{1f980}\n");

        let final_flush = plan_installer_batches("alpha\r\n\u{1f980}\rpartial", true, 1024);
        assert_eq!(
            final_flush.consumed_bytes,
            "alpha\r\n\u{1f980}\rpartial".len()
        );
        assert_eq!(final_flush.batches.len(), 1);
        assert_eq!(final_flush.batches[0].1, "alpha\n\u{1f980}\npartial\n");
        assert_eq!(
            final_flush.batches[0].0,
            "alpha\r\n\u{1f980}\rpartial".len()
        );
    }

    #[tokio::test]
    async fn failed_second_send_retains_and_retries_exact_remainder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installer-stdout");
        let first_line = "a".repeat(MAX_CONSOLE_BATCH_BYTES);
        let text = format!("{first_line}\nsecond\nthird\npartial");
        tokio::fs::write(&path, &text).await.unwrap();

        let mut position = 0u64;
        let mut diagnostic = String::new();
        let mut markers = InstallerMarkers::default();
        let first_read = super::super::console::read_new_tail_bytes(&path, &mut position)
            .await
            .unwrap();
        assert_eq!(first_read, text);

        let mut send_count = 0usize;
        let mut delivered = Vec::new();
        let complete = deliver_installer_text(
            &first_read,
            false,
            InstallerStreamDelivery {
                position: &mut position,
                diagnostic: &mut diagnostic,
                markers: &mut markers,
            },
            |batch| {
                send_count += 1;
                let succeeded = send_count != 2;
                if succeeded {
                    delivered.push(batch.to_string());
                }
                std::future::ready(Ok(succeeded))
            },
        )
        .await
        .unwrap();

        let expected_first = format!("{first_line}\n");
        assert!(!complete);
        assert_eq!(send_count, 2, "the second batch really failed");
        assert_eq!(position, expected_first.len() as u64);
        assert_eq!(diagnostic, expected_first);
        assert_eq!(delivered, vec![expected_first.clone()]);

        let retained = super::super::console::read_new_tail_bytes(&path, &mut position)
            .await
            .unwrap();
        assert_eq!(retained, "second\nthird\npartial");
        assert_eq!(position, expected_first.len() as u64);
        let complete = deliver_installer_text(
            &retained,
            true,
            InstallerStreamDelivery {
                position: &mut position,
                diagnostic: &mut diagnostic,
                markers: &mut markers,
            },
            |batch| {
                delivered.push(batch.to_string());
                std::future::ready(Ok(true))
            },
        )
        .await
        .unwrap();

        assert!(complete);
        assert_eq!(position, text.len() as u64);
        assert_eq!(
            delivered.concat(),
            format!("{first_line}\nsecond\nthird\npartial\n"),
            "successful delivery must contain every batch exactly once"
        );
    }

    #[tokio::test]
    async fn disconnected_eof_completes_but_pending_bytes_retain_their_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("installer-stdout");
        let contents = "already delivered output\n";
        tokio::fs::write(&path, contents).await.unwrap();
        let mut eof_position = contents.len() as u64;
        let eof = super::super::console::read_new_tail_bytes(&path, &mut eof_position)
            .await
            .unwrap();
        assert!(eof.is_empty());
        assert_eq!(eof_position, contents.len() as u64);

        let mut eof_diagnostic = String::new();
        let mut markers = InstallerMarkers::default();
        let mut offline_sends = 0usize;
        let complete = deliver_installer_text(
            &eof,
            true,
            InstallerStreamDelivery {
                position: &mut eof_position,
                diagnostic: &mut eof_diagnostic,
                markers: &mut markers,
            },
            |_| {
                offline_sends += 1;
                std::future::ready(Ok(false))
            },
        )
        .await
        .unwrap();
        assert!(complete, "empty EOF must not wait for a reconnection");
        assert_eq!(offline_sends, 0);
        assert_eq!(eof_position, contents.len() as u64);
        assert!(eof_diagnostic.is_empty());

        // This is the no-writer send result from emit_console_output. It must
        // wait without consuming bytes even though the empty EOF above finishes.
        let mut pending_position = 7u64;
        let mut pending_diagnostic = String::new();
        let complete = deliver_installer_text(
            "pending\n",
            true,
            InstallerStreamDelivery {
                position: &mut pending_position,
                diagnostic: &mut pending_diagnostic,
                markers: &mut markers,
            },
            |_| {
                offline_sends += 1;
                std::future::ready(Ok(false))
            },
        )
        .await
        .unwrap();
        assert!(!complete);
        assert_eq!(offline_sends, 1);
        assert_eq!(pending_position, 7);
        assert!(pending_diagnostic.is_empty());
    }

    #[test]
    fn invalid_cursor_transition_is_rejected_without_mutation() {
        let mut position = 10u64;
        let mut previous_end = 4usize;
        assert!(commit_installer_batch_cursor(&mut position, &mut previous_end, 3, 8).is_err());
        assert_eq!(position, 10);
        assert_eq!(previous_end, 4);
        assert!(commit_installer_batch_cursor(&mut position, &mut previous_end, 9, 8).is_err());
        assert_eq!(position, 10);
    }
}
