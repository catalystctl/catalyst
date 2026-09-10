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
/// SEC-7: cap metadata payload size (bytes, serialized) for error reports.
pub const MAX_ERROR_METADATA_BYTES: usize = 4 * 1024;

/// SEC-7: central secret redactor for error reports. Replaces values of
/// secret-looking keys with [REDACTED], strips Authorization/Cookie headers,
/// and caps the serialized metadata size.
pub fn redact_secrets(mut value: serde_json::Value) -> serde_json::Value {
    const SECRET_KEYS: &[&str] = &[
        "api_key",
        "apikey",
        "token",
        "secret",
        "password",
        "passwd",
        "private_key",
        "privatekey",
        "auth_token",
        "webhook_secret",
        "authorization",
        "cookie",
        "set-cookie",
    ];
    fn is_secret(key: &str) -> bool {
        let lower = key.to_ascii_lowercase();
        SECRET_KEYS.iter().any(|s| lower == *s || lower.contains(s))
    }
    fn walk(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(map) => {
                for (k, child) in map.iter_mut() {
                    if is_secret(k) {
                        *child = serde_json::Value::String("[REDACTED]".to_string());
                    } else {
                        walk(child);
                    }
                }
            }
            serde_json::Value::Array(arr) => {
                for item in arr.iter_mut() {
                    walk(item);
                }
            }
            _ => {}
        }
    }
    walk(&mut value);
    // Cap serialized size: truncate string leaves until under budget.
    loop {
        let len = serde_json::to_string(&value).map(|s| s.len()).unwrap_or(0);
        if len <= MAX_ERROR_METADATA_BYTES {
            break;
        }
        // Drop the largest string field to converge quickly.
        fn largest_string_path(v: &serde_json::Value, prefix: String, best: &mut (String, usize)) {
            match v {
                serde_json::Value::Object(map) => {
                    for (k, child) in map {
                        largest_string_path(child, format!("{}.{}", prefix, k), best);
                    }
                }
                serde_json::Value::String(s) if s.len() > best.1 => {
                    *best = (prefix.clone(), s.len());
                }
                _ => {}
            }
        }
        let mut best = (String::new(), 0);
        largest_string_path(&value, String::new(), &mut best);
        if best.0.is_empty() {
            break;
        }
        // Navigate and truncate.
        let mut cur = &mut value;
        for part in best.0.split('.').filter(|p| !p.is_empty()) {
            cur = &mut cur[part];
        }
        *cur = serde_json::Value::String("[TRUNCATED]".to_string());
    }
    value
}

/// Sink used by layers that have no WebSocketHandler access (runtime manager,
/// file tunnel) to route errors into the panel reporting pipeline. Installed
/// by main.rs after the WebSocketHandler is constructed; implementations
/// should be cheap and non-blocking (spawn async work internally).
pub type ErrorSink =
    Arc<dyn Fn(ErrorLevel, String, String, Option<serde_json::Value>) + Send + Sync>;

#[cfg(test)]
mod security_hardening_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redaction_strips_secrets_and_headers() {
        let v = redact_secrets(json!({
            "api_key": "secret",
            "nested": { "password": "hunter2", "ok": 1 },
            "headers": { "Authorization": "Bearer x", "Cookie": "s=1" },
        }));
        assert_eq!(v["api_key"], json!("[REDACTED]"));
        assert_eq!(v["nested"]["password"], json!("[REDACTED]"));
        assert_eq!(v["nested"]["ok"], json!(1));
        assert_eq!(v["headers"]["Authorization"], json!("[REDACTED]"));
        assert_eq!(v["headers"]["Cookie"], json!("[REDACTED]"));
    }

    #[test]
    fn redaction_caps_metadata_size() {
        let big = "x".repeat(MAX_ERROR_METADATA_BYTES * 2);
        let v = redact_secrets(json!({ "blob": big }));
        let len = serde_json::to_string(&v).unwrap().len();
        assert!(len <= MAX_ERROR_METADATA_BYTES, "len={}", len);
    }
}
