use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use sysinfo::System;

/// Agent performance metrics for observability.
///
/// Tracks memory usage, container operation latency, and WebSocket message
/// processing time for Prometheus-style monitoring.
#[derive(Clone)]
pub struct AgentMetrics {
    /// Resident set size in bytes (process memory usage)
    memory_rss_bytes: Arc<AtomicU64>,
    /// Total container operations completed
    container_ops_total: Arc<AtomicU64>,
    /// Total container operation duration in microseconds
    container_ops_duration_us: Arc<AtomicU64>,
    /// Total WebSocket messages processed
    ws_messages_total: Arc<AtomicU64>,
    /// Total WebSocket message processing duration in microseconds
    ws_processing_duration_us: Arc<AtomicU64>,
}

impl AgentMetrics {
    pub fn new() -> Self {
        Self {
            memory_rss_bytes: Arc::new(AtomicU64::new(0)),
            container_ops_total: Arc::new(AtomicU64::new(0)),
            container_ops_duration_us: Arc::new(AtomicU64::new(0)),
            ws_messages_total: Arc::new(AtomicU64::new(0)),
            ws_processing_duration_us: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Update resident set size metric from current process memory usage.
    pub fn update_memory_usage(&self) {
        let mut system = System::new();
        if let Ok(pid) = sysinfo::get_current_pid() {
            // RSS needs neither host memory, process CPU/disk counters, nor
            // every Tokio/blocking-pool thread under /proc/<pid>/task.
            system.refresh_processes_specifics(
                sysinfo::ProcessesToUpdate::Some(&[pid]),
                false,
                sysinfo::ProcessRefreshKind::nothing()
                    .with_memory()
                    .without_tasks(),
            );
            if let Some(process) = system.process(pid) {
                let rss_bytes = process.memory();
                self.memory_rss_bytes.store(rss_bytes, Ordering::Relaxed);
            }
        }
    }

    /// Record a container operation with its duration.
    pub fn record_container_operation(&self, duration: std::time::Duration) {
        self.container_ops_total.fetch_add(1, Ordering::Relaxed);
        self.container_ops_duration_us
            .fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
    }

    /// Record a WebSocket message processing with its duration.
    pub fn record_ws_message(&self, duration: std::time::Duration) {
        self.ws_messages_total.fetch_add(1, Ordering::Relaxed);
        self.ws_processing_duration_us
            .fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
    }

    /// Get current memory RSS in bytes.
    pub fn memory_rss_bytes(&self) -> u64 {
        self.memory_rss_bytes.load(Ordering::Relaxed)
    }

    /// Get total container operations.
    pub fn container_ops_total(&self) -> u64 {
        self.container_ops_total.load(Ordering::Relaxed)
    }

    /// Get average container operation latency in seconds.
    pub fn container_ops_avg_seconds(&self) -> f64 {
        let total = self.container_ops_total.load(Ordering::Relaxed);
        if total == 0 {
            return 0.0;
        }
        let total_us = self.container_ops_duration_us.load(Ordering::Relaxed);
        (total_us as f64) / (total as f64) / 1_000_000.0
    }

    /// Get total WebSocket messages processed.
    pub fn ws_messages_total(&self) -> u64 {
        self.ws_messages_total.load(Ordering::Relaxed)
    }

    /// Get average WebSocket message processing time in seconds.
    pub fn ws_processing_avg_seconds(&self) -> f64 {
        let total = self.ws_messages_total.load(Ordering::Relaxed);
        if total == 0 {
            return 0.0;
        }
        let total_us = self.ws_processing_duration_us.load(Ordering::Relaxed);
        (total_us as f64) / (total as f64) / 1_000_000.0
    }
}

impl Default for AgentMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Timer guard for recording operation duration.
///
/// Automatically records the elapsed time when dropped.
#[allow(dead_code)]
pub struct MetricsTimer<F: FnOnce(std::time::Duration) + Send> {
    start: Instant,
    record: Option<F>,
}

impl<F> MetricsTimer<F>
where
    F: FnOnce(std::time::Duration) + Send,
{
    #[allow(dead_code)]
    pub fn new(record: F) -> Self {
        Self {
            start: Instant::now(),
            record: Some(record),
        }
    }
}

impl<F> Drop for MetricsTimer<F>
where
    F: FnOnce(std::time::Duration) + Send,
{
    fn drop(&mut self) {
        if let Some(record) = self.record.take() {
            let duration = self.start.elapsed();
            record(duration);
        }
    }
}
