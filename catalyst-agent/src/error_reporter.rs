//! Agent error reporting types shared across the agent codebase.
//!
//! The WebSocketHandler provides the actual `report_error` method that sends
//! error data to the backend panel via the WebSocket connection.

use crate::AgentError;
use std::sync::Arc;

/// Error severity levels matching backend `systemError` levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorLevel {
    Error,
    Warn,
    Critical,
}

impl ErrorLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorLevel::Error => "error",
            ErrorLevel::Warn => "warn",
            ErrorLevel::Critical => "critical",
        }
    }

    /// Map an `AgentError` variant to an appropriate severity level.
    pub fn from_agent_error(err: &AgentError) -> Self {
        match err {
            AgentError::SecurityViolation(_) | AgentError::PermissionDenied(_) => ErrorLevel::Warn,
            AgentError::ConfigError(_) => ErrorLevel::Critical,
            _ => ErrorLevel::Error,
        }
    }
}

/// Deduplication window in seconds.
pub const DEDUP_WINDOW_SECS: u64 = 30;

/// Sink used by layers that have no WebSocketHandler access (runtime manager,
/// file tunnel) to route errors into the panel reporting pipeline. Installed
/// by main.rs after the WebSocketHandler is constructed; implementations
/// should be cheap and non-blocking (spawn async work internally).
pub type ErrorSink =
    Arc<dyn Fn(ErrorLevel, String, String, Option<serde_json::Value>) + Send + Sync>;
