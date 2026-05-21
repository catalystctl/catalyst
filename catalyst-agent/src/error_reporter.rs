//! Agent error reporting types shared across the agent codebase.
//!
//! The WebSocketHandler provides the actual `report_error` method that sends
//! error data to the backend panel via the WebSocket connection.

use crate::AgentError;

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
            AgentError::SecurityViolation(_) | AgentError::PermissionDenied(_) => {
                ErrorLevel::Warn
            }
            AgentError::ConfigError(_) => ErrorLevel::Critical,
            _ => ErrorLevel::Error,
        }
    }
}

/// Deduplication window in seconds.
pub const DEDUP_WINDOW_SECS: u64 = 30;
