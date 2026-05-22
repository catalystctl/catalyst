//! Shared shell/string utility functions used across multiple modules.
//!
//! Consolidates shell escaping, startup command normalization, path validation,
//! and terminal line splitting that were previously duplicated between
//! `websocket_handler.rs` and `runtime_manager.rs`.

use crate::{AgentError, AgentResult};
use regex::Regex;
use std::path::{Component, Path};
use std::sync::OnceLock;

/// Shell-escape a value for safe interpolation into a bash script.
/// Wraps the value in single quotes and escapes any embedded single quotes.
pub fn shell_escape_value(value: &str) -> String {
    // Single-quoting in bash prevents all interpretation except for single quotes themselves.
    // To include a literal single quote: end the single-quoted string, add an escaped quote, restart.
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{}'", escaped)
}

/// Detect whether a startup command requires bash rather than plain /bin/sh.
/// Returns true when the command uses bash-specific features that dash/sh cannot handle.
pub fn requires_bash(command: &str) -> bool {
    // Process substitution: $( <(...) )
    if command.contains("<(") || command.contains(">(") {
        return true;
    }
    // [[ double-bracket test ]]
    if command.contains("[[") {
        return true;
    }
    // Array syntax: var=( ... ) or ${arr[@]}
    static ARRAY_RE: OnceLock<Regex> = OnceLock::new();
    let re =
        ARRAY_RE.get_or_init(|| Regex::new(r"\w+=\(|\$\{\w+\[@]\}").expect("valid array regex"));
    if re.is_match(command) {
        return true;
    }
    false
}

/// Normalize common bash arithmetic condition syntax so startup commands run under /bin/sh.
/// Example: `((1))` -> `[ $((1)) -ne 0 ]`
pub fn normalize_startup_for_sh(command: &str) -> String {
    static ARITH_COND_RE: OnceLock<Regex> = OnceLock::new();
    let re = ARITH_COND_RE.get_or_init(|| {
        Regex::new(r"\(\(\s*([^()]*)\s*\)\)").expect("valid arithmetic condition regex")
    });
    re.replace_all(command, |caps: &regex::Captures<'_>| {
        let expr = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        if expr.is_empty() {
            "[ 0 -ne 0 ]".to_string()
        } else {
            format!("[ $(( {} )) -ne 0 ]", expr)
        }
    })
    .into_owned()
}

/// Split terminal output into complete lines and a trailing partial fragment.
///
/// Handles three line-termination styles:
/// - `\n`         → normal newline
/// - `\r\n`       → Windows-style newline
/// - `\r`         → carriage return (Paper/Minecraft overwrites current line)
///
/// For `\r` we emulate terminal behaviour: everything since the previous
/// terminator (or start of slice) up to the `\r` is one line, and the next
/// line starts fresh after it.  This prevents Paper's startup progress lines
/// from being concatenated together.
///
/// Returns `(Vec<line_text>, trailing_fragment)`.
/// `trailing_fragment` is the text after the *last* terminator; the caller
/// should keep it for the next read cycle so partial lines are not split.
pub fn split_terminal_lines(text: &str) -> (Vec<String>, &str) {
    let mut lines = Vec::new();
    let mut current_start = 0;

    for (i, ch) in text.char_indices() {
        // If we already advanced current_start past this character (e.g. after
        // a \r\n pair where \r set current_start = i + 2), skip it.
        if i < current_start {
            continue;
        }
        if ch == '\n' {
            let line = &text[current_start..i];
            lines.push(line.to_string());
            current_start = i + 1;
        } else if ch == '\r' {
            let line = &text[current_start..i];
            lines.push(line.to_string());
            // Also skip a following \n if present (\r\n)
            if text.as_bytes().get(i + 1) == Some(&b'\n') {
                current_start = i + 2;
            } else {
                current_start = i + 1;
            }
        }
    }

    let trailing = &text[current_start..];
    (lines, trailing)
}

/// Validate that a string is a single safe path segment (no directory traversal).
pub fn validate_safe_path_segment(value: &str, label: &str) -> AgentResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(AgentError::InvalidRequest(format!(
            "Invalid {}: must be 1-128 characters",
            label
        )));
    }
    if trimmed.contains('\\') {
        return Err(AgentError::InvalidRequest(format!(
            "Invalid {}: contains \\",
            label
        )));
    }
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(AgentError::InvalidRequest(format!(
            "Invalid {}: must be a single path segment",
            label
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_escape_value() {
        assert_eq!(shell_escape_value("hello"), "'hello'");
        assert_eq!(shell_escape_value("it's"), "'it'\"'\"'s'");
        assert_eq!(shell_escape_value(""), "''");
    }

    #[test]
    fn test_requires_bash() {
        assert!(requires_bash("[[ -f foo ]]"));
        assert!(requires_bash("diff <(sort a) <(sort b)"));
        assert!(requires_bash("arr=(1 2 3)"));
        assert!(requires_bash("echo ${arr[@]}"));
        assert!(!requires_bash("echo hello"));
        assert!(!requires_bash("if [ -f foo ]; then echo yes; fi"));
    }

    #[test]
    fn test_normalize_startup_for_sh() {
        assert_eq!(normalize_startup_for_sh("((1))"), "[ $(( 1 )) -ne 0 ]");
        assert_eq!(
            normalize_startup_for_sh("if ((1)); then echo yes; fi"),
            "if [ $(( 1 )) -ne 0 ]; then echo yes; fi"
        );
        // No arithmetic condition → unchanged
        assert_eq!(
            normalize_startup_for_sh("echo hello"),
            "echo hello"
        );
    }

    #[test]
    fn test_split_terminal_lines() {
        let (lines, trailing) = split_terminal_lines("hello\nworld\n");
        assert_eq!(lines, vec!["hello", "world"]);
        assert_eq!(trailing, "");

        let (lines, trailing) = split_terminal_lines("partial");
        assert!(lines.is_empty());
        assert_eq!(trailing, "partial");

        let (lines, trailing) = split_terminal_lines("line1\r\nline2\r");
        assert_eq!(lines, vec!["line1", "line2"]);
        assert_eq!(trailing, "");
    }

    #[test]
    fn test_validate_safe_path_segment() {
        assert!(validate_safe_path_segment("my-server", "serverId").is_ok());
        assert!(validate_safe_path_segment("../etc", "serverId").is_err());
        assert!(validate_safe_path_segment("foo/bar", "serverId").is_err());
        assert!(validate_safe_path_segment("", "serverId").is_err());
        assert!(validate_safe_path_segment("a\\b", "serverId").is_err());
    }
}
