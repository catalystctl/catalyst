use thiserror::Error;

pub type AgentResult<T> = Result<T, AgentError>;

#[derive(Error, Debug)]
pub enum AgentError {
    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Container error: {0}")]
    ContainerError(String),

    #[error("File system error: {0}")]
    FileSystemError(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Security violation: {0}")]
    SecurityViolation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Installation error: {0}")]
    InstallationError(String),

    #[error("Firewall error: {0}")]
    FirewallError(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Internal error: {0}")]
    InternalError(String),
}

impl From<std::io::Error> for AgentError {
    fn from(err: std::io::Error) -> Self {
        AgentError::IoError(err.to_string())
    }
}

/// SEC-7: sanitize an error string for panel delivery — replace absolute
/// paths with basenames + a short hash (stable correlation without leaking
/// host layout), strip control characters.
pub fn sanitize_error_for_panel(message: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut out = String::with_capacity(message.len());
    for token in message.split_whitespace() {
        if token.contains('/') || token.contains('\\') {
            let base = token
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(token)
                .trim_matches(|c| c == '"' || c == '\'' || c == ',' || c == ';' || c == ')');
            let mut h = DefaultHasher::new();
            token.hash(&mut h);
            out.push_str(&format!("<{}#{:x}>", base, h.finish() & 0xffff));
        } else {
            out.push_str(token);
        }
        out.push(' ');
    }
    let trimmed = out.trim_end().to_string();
    trimmed
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect()
}

#[cfg(test)]
mod security_hardening_tests {
    use super::*;

    #[test]
    fn panel_errors_hide_paths_keep_basename() {
        let s = sanitize_error_for_panel("Failed to read file: /var/lib/catalyst/secret/data.txt");
        assert!(!s.contains("/var/lib/catalyst"), "got {s}");
        assert!(s.contains("data.txt"), "got {s}");
        assert!(s.contains('#'), "got {s}");
    }

    #[test]
    fn panel_errors_strip_controls() {
        let s = sanitize_error_for_panel("boom\x00\x1b[31m");
        assert!(!s.contains('\x00'));
        assert!(!s.contains('\x1b'));
    }
}
