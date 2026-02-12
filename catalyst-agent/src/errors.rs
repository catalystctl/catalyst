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
