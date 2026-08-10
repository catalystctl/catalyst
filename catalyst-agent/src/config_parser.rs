//! Pterodactyl/Wings-compatible configuration file parser.
//!
//! Eggs store config.files as:
//! ```json
//! {
//!   "server.properties": {
//!     "parser": "properties",
//!     "find": {
//!       "server-port": "{{server.build.default.port}}"
//!     }
//!   }
//! }
//! ```
//!
//! Wings converts the `find` map into match/replace pairs and rewrites the file
//! before every server start. Catalyst mirrors that behaviour so imported eggs
//! bind to the correct port/IP/env without manual file edits.

use crate::{AgentError, AgentResult};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use tracing::{debug, info, warn};

const MAX_CONFIG_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ConfigReplacement {
    pub match_key: String,
    pub if_value: Option<String>,
    pub replace_with: String,
}

#[derive(Debug, Clone)]
pub struct ConfigFileSpec {
    pub file_name: String,
    pub parser: String,
    pub replacements: Vec<ConfigReplacement>,
}

/// Context used to resolve Wings-style placeholders such as
/// `{{server.build.default.port}}` and `{{server.build.env.SERVER_NAME}}`.
#[derive(Debug, Clone)]
pub struct ConfigResolveContext {
    pub env: HashMap<String, String>,
    pub primary_port: u16,
    pub primary_ip: String,
    pub server_uuid: String,
    pub server_memory_mb: u64,
    pub server_disk_mb: u64,
    pub docker_interface: String,
}

impl ConfigResolveContext {
    pub fn resolve_placeholders(&self, input: &str) -> String {
        static RE: OnceLock<Regex> = OnceLock::new();
        let re = RE.get_or_init(|| {
            Regex::new(r"\{\{\s*([^}]+?)\s*\}\}").expect("valid placeholder regex")
        });

        re.replace_all(input, |caps: &regex::Captures<'_>| {
            let raw = caps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            self.lookup(raw).unwrap_or_else(|| caps[0].to_string())
        })
        .into_owned()
    }

    fn lookup(&self, path: &str) -> Option<String> {
        let lower = path.to_ascii_lowercase();
        match lower.as_str() {
            "server.build.default.port" | "server.build.ports.primary" => {
                Some(self.primary_port.to_string())
            }
            "server.build.default.ip" | "server.build.ip" | "config.docker.interface" => {
                Some(self.primary_ip.clone())
            }
            "server.build.memory" | "server.memory" => Some(self.server_memory_mb.to_string()),
            "server.build.disk" | "server.disk" => Some(self.server_disk_mb.to_string()),
            "server.uuid" | "server.id" => Some(self.server_uuid.clone()),
            "docker.interface" | "docker.network.interface" => Some(self.docker_interface.clone()),
            _ => {
                if let Some(rest) = path
                    .strip_prefix("server.build.env.")
                    .or_else(|| path.strip_prefix("server.environment."))
                    .or_else(|| path.strip_prefix("env."))
                    .or_else(|| path.strip_prefix("server.env."))
                {
                    return self
                        .env
                        .get(rest)
                        .cloned()
                        .or_else(|| self.env.get(&rest.to_ascii_uppercase()).cloned());
                }
                // Bare {{VAR}} → env lookup
                self.env
                    .get(path)
                    .cloned()
                    .or_else(|| self.env.get(&path.to_ascii_uppercase()).cloned())
            }
        }
    }
}

/// Parse egg `features.pterodactylConfigFiles` (or raw egg config.files) into specs.
pub fn parse_config_file_specs(value: &Value) -> Vec<ConfigFileSpec> {
    let obj = match value {
        Value::Object(map) => map,
        Value::String(s) => {
            match serde_json::from_str::<Value>(s) {
                Ok(Value::Object(map)) => {
                    // Leak-free: convert owned map via Box
                    return parse_config_file_specs(&Value::Object(map));
                }
                _ => return Vec::new(),
            }
        }
        _ => return Vec::new(),
    };

    let mut specs = Vec::new();
    for (file_name, meta) in obj {
        let meta_obj = match meta.as_object() {
            Some(m) => m,
            None => continue,
        };
        let parser = meta_obj
            .get("parser")
            .and_then(|v| v.as_str())
            .unwrap_or("file")
            .to_ascii_lowercase();

        let mut replacements = Vec::new();

        // Wings process-config format: replace: [{match, replace_with|value, if_value}]
        if let Some(Value::Array(arr)) = meta_obj.get("replace") {
            for item in arr {
                if let Some(rep) = item.as_object() {
                    let match_key = rep
                        .get("match")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if match_key.is_empty() {
                        continue;
                    }
                    let replace_with = rep
                        .get("replace_with")
                        .or_else(|| rep.get("value"))
                        .map(value_to_string)
                        .unwrap_or_default();
                    let if_value = rep
                        .get("if_value")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    replacements.push(ConfigReplacement {
                        match_key,
                        if_value,
                        replace_with,
                    });
                }
            }
        }

        // Egg export format: find: { "key": "value", ... }
        if let Some(Value::Object(find_map)) = meta_obj.get("find") {
            for (k, v) in find_map {
                replacements.push(ConfigReplacement {
                    match_key: k.clone(),
                    if_value: None,
                    replace_with: value_to_string(v),
                });
            }
        }

        if replacements.is_empty() {
            continue;
        }

        specs.push(ConfigFileSpec {
            file_name: file_name.clone(),
            parser,
            replacements,
        });
    }

    specs
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Resolve a config-relative path under the server data directory without escaping it.
fn resolve_under_server(server_dir: &Path, relative: &str) -> AgentResult<PathBuf> {
    let cleaned = relative.replace('\\', "/");
    let mut out = server_dir.to_path_buf();
    for comp in Path::new(&cleaned).components() {
        match comp {
            Component::Normal(seg) => out.push(seg),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AgentError::PermissionDenied(format!(
                    "Config file path escapes server dir: {}",
                    relative
                )));
            }
            Component::RootDir | Component::Prefix(_) => {}
        }
    }
    if !out.starts_with(server_dir) {
        return Err(AgentError::PermissionDenied(format!(
            "Config file path outside server dir: {}",
            relative
        )));
    }
    Ok(out)
}

/// Apply all configuration file specs for a server. Best-effort: individual
/// file failures are logged and do not abort server start (matches Wings).
pub async fn apply_configuration_files(
    server_dir: &Path,
    specs: &[ConfigFileSpec],
    ctx: &ConfigResolveContext,
) -> AgentResult<()> {
    if specs.is_empty() {
        return Ok(());
    }

    info!(
        "Applying {} Pterodactyl configuration file(s) under {}",
        specs.len(),
        server_dir.display()
    );

    for spec in specs {
        match apply_one(server_dir, spec, ctx).await {
            Ok(()) => debug!("Config file applied: {}", spec.file_name),
            Err(e) => {
                warn!(
                    "Failed to apply config file '{}': {} (continuing)",
                    spec.file_name, e
                );
            }
        }
    }
    Ok(())
}

async fn apply_one(
    server_dir: &Path,
    spec: &ConfigFileSpec,
    ctx: &ConfigResolveContext,
) -> AgentResult<()> {
    let path = resolve_under_server(server_dir, &spec.file_name)?;

    // "file" parser skips missing files (Wings behaviour). Other parsers create.
    let exists = tokio::fs::try_exists(&path).await.unwrap_or(false);
    if !exists && spec.parser == "file" {
        debug!(
            "Skipping text config file that does not exist yet: {}",
            spec.file_name
        );
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AgentError::FileSystemError(format!(
                "Failed to create config parent for {}: {}",
                spec.file_name, e
            ))
        })?;
    }

    if exists {
        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| AgentError::FileSystemError(format!("stat {}: {}", spec.file_name, e)))?;
        if meta.len() > MAX_CONFIG_FILE_BYTES {
            return Err(AgentError::FileSystemError(format!(
                "Config file {} too large ({} bytes)",
                spec.file_name,
                meta.len()
            )));
        }
    }

    let resolved: Vec<ConfigReplacement> = spec
        .replacements
        .iter()
        .map(|r| ConfigReplacement {
            match_key: r.match_key.clone(),
            if_value: r.if_value.clone(),
            replace_with: ctx.resolve_placeholders(&r.replace_with),
        })
        .collect();

    match spec.parser.as_str() {
        "properties" => apply_properties(&path, &resolved).await,
        "file" => apply_text_file(&path, &resolved).await,
        "json" => apply_json(&path, &resolved).await,
        "yaml" | "yml" => apply_yaml(&path, &resolved).await,
        "ini" => apply_ini(&path, &resolved).await,
        "xml" => apply_xml(&path, &resolved).await,
        other => {
            warn!("Unknown config parser '{}'; treating as file", other);
            apply_text_file(&path, &resolved).await
        }
    }
}

async fn read_or_empty(path: &Path) -> AgentResult<String> {
    match tokio::fs::read_to_string(path).await {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(AgentError::FileSystemError(format!(
            "Failed to read {}: {}",
            path.display(),
            e
        ))),
    }
}

async fn atomic_write(path: &Path, content: &str) -> AgentResult<()> {
    let tmp = path.with_extension("catalyst-cfg-tmp");
    tokio::fs::write(&tmp, content.as_bytes())
        .await
        .map_err(|e| AgentError::FileSystemError(format!("write temp: {}", e)))?;
    tokio::fs::rename(&tmp, path)
        .await
        .map_err(|e| AgentError::FileSystemError(format!("rename temp: {}", e)))?;
    Ok(())
}

/// properties parser — preserves leading comment block, sets/creates keys.
async fn apply_properties(path: &Path, reps: &[ConfigReplacement]) -> AgentResult<()> {
    let raw = read_or_empty(path).await?;
    let mut header = String::new();
    let mut body_started = false;
    let mut map: HashMap<String, String> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim_start();
        if !body_started
            && (trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!'))
        {
            header.push_str(line);
            header.push('\n');
            continue;
        }
        body_started = true;
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
            continue;
        }
        if let Some((k, v)) = split_properties_kv(line) {
            if !map.contains_key(&k) {
                order.push(k.clone());
            }
            map.insert(k, v);
        }
    }

    for rep in reps {
        if let Some(if_val) = &rep.if_value {
            match map.get(&rep.match_key) {
                Some(cur) if cur == if_val => {}
                _ => continue,
            }
        }
        if !map.contains_key(&rep.match_key) {
            order.push(rep.match_key.clone());
        }
        map.insert(rep.match_key.clone(), rep.replace_with.clone());
    }

    let mut out = header;
    for key in order {
        if let Some(val) = map.get(&key) {
            // Escape non-ASCII like Wings (QuoteToASCII without surrounding quotes)
            let escaped = escape_properties_value(val);
            out.push_str(&key);
            out.push('=');
            out.push_str(&escaped);
            out.push('\n');
        }
    }
    atomic_write(path, &out).await
}

fn split_properties_kv(line: &str) -> Option<(String, String)> {
    let mut delim = None;
    for (i, ch) in line.char_indices() {
        if ch == '=' || ch == ':' {
            delim = Some(i);
            break;
        }
    }
    let idx = delim?;
    let key = line[..idx].trim().to_string();
    if key.is_empty() {
        return None;
    }
    let value = line[idx + 1..].trim().to_string();
    Some((key, value))
}

fn escape_properties_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        let cp = ch as u32;
        if ch == '\\' {
            out.push_str("\\\\");
        } else if ch == '\n' {
            out.push_str("\\n");
        } else if ch == '\r' {
            out.push_str("\\r");
        } else if ch == '\t' {
            out.push_str("\\t");
        } else if cp > 0x7F {
            out.push_str(&format!("\\u{:04x}", cp));
        } else {
            out.push(ch);
        }
    }
    out
}

/// Plain-text parser: lines whose prefix matches `match` are replaced wholesale.
async fn apply_text_file(path: &Path, reps: &[ConfigReplacement]) -> AgentResult<()> {
    let raw = read_or_empty(path).await?;
    let mut out = String::with_capacity(raw.len());
    for line in raw.lines() {
        let mut replaced = false;
        for rep in reps {
            if line.starts_with(&rep.match_key) {
                out.push_str(&rep.replace_with);
                out.push('\n');
                replaced = true;
                break;
            }
        }
        if !replaced {
            out.push_str(line);
            out.push('\n');
        }
    }
    // If file was empty and we have replacements that look like full lines, append them
    if raw.trim().is_empty() {
        for rep in reps {
            if !out.contains(&rep.replace_with) {
                out.push_str(&rep.replace_with);
                out.push('\n');
            }
        }
    }
    atomic_write(path, &out).await
}

async fn apply_json(path: &Path, reps: &[ConfigReplacement]) -> AgentResult<()> {
    let raw = read_or_empty(path).await?;
    let mut root: Value = if raw.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str(&raw).map_err(|e| {
            AgentError::FileSystemError(format!("Invalid JSON in {}: {}", path.display(), e))
        })?
    };

    for rep in reps {
        set_json_path(
            &mut root,
            &rep.match_key,
            &rep.replace_with,
            rep.if_value.as_deref(),
        );
    }

    let pretty = serde_json::to_string_pretty(&root)
        .map_err(|e| AgentError::FileSystemError(format!("Failed to serialize JSON: {}", e)))?;
    atomic_write(path, &format!("{}\n", pretty)).await
}

fn coerce_json_value(raw: &str) -> Value {
    if raw.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if raw.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if raw.eq_ignore_ascii_case("null") || raw.is_empty() {
        // Keep empty string for config keys that intentionally clear a value
        if raw.is_empty() {
            return Value::String(String::new());
        }
        return Value::Null;
    }
    if let Ok(n) = raw.parse::<i64>() {
        return Value::Number(n.into());
    }
    if let Ok(n) = raw.parse::<f64>() {
        if let Some(num) = serde_json::Number::from_f64(n) {
            return Value::Number(num);
        }
    }
    Value::String(raw.to_string())
}

fn set_json_path(root: &mut Value, path: &str, value: &str, if_value: Option<&str>) {
    // Support single-level wildcard: foo.*.bar
    if let Some((head, tail)) = path.split_once(".*") {
        let head = head.trim_matches('.');
        let tail = tail.trim_matches('.');
        if let Some(Value::Object(map)) = navigate_mut(root, head, false) {
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                if let Some(child) = map.get_mut(&key) {
                    if tail.is_empty() {
                        if if_value_allows(child, if_value) {
                            *child = coerce_json_value(value);
                        }
                    } else {
                        set_json_path(child, tail, value, if_value);
                    }
                }
            }
        } else if let Some(Value::Array(arr)) = navigate_mut(root, head, false) {
            for child in arr.iter_mut() {
                if tail.is_empty() {
                    if if_value_allows(child, if_value) {
                        *child = coerce_json_value(value);
                    }
                } else {
                    set_json_path(child, tail, value, if_value);
                }
            }
        }
        return;
    }

    // Ensure path exists then set
    if let Some(target) = navigate_mut(root, path, true) {
        if if_value_allows(target, if_value) {
            *target = coerce_json_value(value);
        }
    }
}

fn if_value_allows(current: &Value, if_value: Option<&str>) -> bool {
    match if_value {
        None => true,
        Some(expected) => {
            let cur = match current {
                Value::String(s) => s.clone(),
                Value::Bool(b) => b.to_string(),
                Value::Number(n) => n.to_string(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            cur == expected
        }
    }
}

fn navigate_mut<'a>(root: &'a mut Value, path: &str, create: bool) -> Option<&'a mut Value> {
    if path.is_empty() {
        return Some(root);
    }
    let parts: Vec<&str> = path.split('.').filter(|p| !p.is_empty()).collect();
    let mut cur = root;
    for (i, part) in parts.iter().enumerate() {
        let last = i + 1 == parts.len();
        // Array index syntax: key[0]
        let (key, index) = parse_array_part(part);
        if create {
            if !cur.is_object() {
                *cur = Value::Object(Map::new());
            }
            let obj = cur.as_object_mut()?;
            if let Some(idx) = index {
                let entry = obj
                    .entry(key.to_string())
                    .or_insert_with(|| Value::Array(vec![]));
                if !entry.is_array() {
                    *entry = Value::Array(vec![]);
                }
                let arr = entry.as_array_mut()?;
                while arr.len() <= idx {
                    arr.push(if last {
                        Value::Null
                    } else {
                        Value::Object(Map::new())
                    });
                }
                cur = arr.get_mut(idx)?;
            } else {
                let entry = obj.entry(key.to_string()).or_insert_with(|| {
                    if last {
                        Value::Null
                    } else {
                        Value::Object(Map::new())
                    }
                });
                cur = entry;
            }
        } else if let Some(idx) = index {
            cur = cur
                .as_object_mut()?
                .get_mut(key)?
                .as_array_mut()?
                .get_mut(idx)?;
        } else {
            cur = cur.as_object_mut()?.get_mut(key)?;
        }
    }
    Some(cur)
}

fn parse_array_part(part: &str) -> (&str, Option<usize>) {
    if let Some(open) = part.find('[') {
        if let Some(close) = part.find(']') {
            if close > open {
                let key = &part[..open];
                if let Ok(idx) = part[open + 1..close].parse::<usize>() {
                    return (key, Some(idx));
                }
            }
        }
    }
    (part, None)
}

async fn apply_yaml(path: &Path, reps: &[ConfigReplacement]) -> AgentResult<()> {
    // Convert YAML → JSON via serde_yaml, reuse JSON path setter, write YAML back.
    let raw = read_or_empty(path).await?;
    let mut json_value: Value = if raw.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        let yaml_val: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| {
            AgentError::FileSystemError(format!("Invalid YAML in {}: {}", path.display(), e))
        })?;
        serde_json::to_value(yaml_val)
            .map_err(|e| AgentError::FileSystemError(format!("YAML→JSON convert failed: {}", e)))?
    };

    for rep in reps {
        set_json_path(
            &mut json_value,
            &rep.match_key,
            &rep.replace_with,
            rep.if_value.as_deref(),
        );
    }

    let yaml_val: serde_yaml::Value = serde_json::from_value(json_value)
        .map_err(|e| AgentError::FileSystemError(format!("JSON→YAML convert failed: {}", e)))?;
    let out = serde_yaml::to_string(&yaml_val)
        .map_err(|e| AgentError::FileSystemError(format!("Failed to serialize YAML: {}", e)))?;
    atomic_write(path, &out).await
}

/// Minimal INI parser supporting `key`, `section.key`, and `[Section.With.Dots].key`.
async fn apply_ini(path: &Path, reps: &[ConfigReplacement]) -> AgentResult<()> {
    let raw = read_or_empty(path).await?;
    // section -> ordered keys
    let mut sections: Vec<(String, Vec<(String, String)>)> = Vec::new();
    let mut current = String::new();
    sections.push((current.clone(), Vec::new()));

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current = trimmed[1..trimmed.len() - 1].to_string();
            if !sections.iter().any(|(s, _)| s == &current) {
                sections.push((current.clone(), Vec::new()));
            }
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_string();
            let val = v.trim().to_string();
            if let Some((_, pairs)) = sections.iter_mut().find(|(s, _)| s == &current) {
                if let Some(existing) = pairs.iter_mut().find(|(pk, _)| pk == &key) {
                    existing.1 = val;
                } else {
                    pairs.push((key, val));
                }
            }
        }
    }

    for rep in reps {
        let (section, key) = split_ini_match(&rep.match_key);
        if let Some(if_val) = &rep.if_value {
            let cur = sections
                .iter()
                .find(|(s, _)| s == &section)
                .and_then(|(_, pairs)| {
                    pairs
                        .iter()
                        .find(|(k, _)| k == &key)
                        .map(|(_, v)| v.clone())
                });
            if cur.as_deref() != Some(if_val.as_str()) {
                continue;
            }
        }
        if !sections.iter().any(|(s, _)| s == &section) {
            sections.push((section.clone(), Vec::new()));
        }
        if let Some((_, pairs)) = sections.iter_mut().find(|(s, _)| s == &section) {
            if let Some(existing) = pairs.iter_mut().find(|(k, _)| k == &key) {
                existing.1 = rep.replace_with.clone();
            } else {
                pairs.push((key, rep.replace_with.clone()));
            }
        }
    }

    let mut out = String::new();
    for (section, pairs) in sections {
        if pairs.is_empty() && section.is_empty() {
            continue;
        }
        if !section.is_empty() {
            out.push('[');
            out.push_str(&section);
            out.push(']');
            out.push('\n');
        }
        for (k, v) in pairs {
            out.push_str(&k);
            out.push('=');
            out.push_str(&v);
            out.push('\n');
        }
    }
    atomic_write(path, &out).await
}

fn split_ini_match(match_key: &str) -> (String, String) {
    // [Section.Name].key  OR  section.key  OR  key
    if match_key.starts_with('[') {
        if let Some(end) = match_key.find(']') {
            let section = match_key[1..end].to_string();
            let rest = match_key[end + 1..].trim_start_matches('.').to_string();
            if rest.is_empty() {
                return (section, String::new());
            }
            return (section, rest);
        }
    }
    if let Some((section, key)) = match_key.split_once('.') {
        // Only treat as section.key when there is exactly one conceptual split at first dot
        // Wings uses path[0]=section, path[1]=key for len==2; deeper dots stay in key for bracket form.
        return (section.to_string(), key.to_string());
    }
    (String::new(), match_key.to_string())
}

/// Minimal XML support: set text content of elements addressed by dotted paths
/// (e.g. `dedicated.server_options.name`). Creates intermediate elements as needed.
async fn apply_xml(path: &Path, reps: &[ConfigReplacement]) -> AgentResult<()> {
    let raw = read_or_empty(path).await?;
    let mut content = if raw.trim().is_empty() {
        String::from("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<root/>\n")
    } else {
        raw
    };

    for rep in reps {
        content = set_xml_path_text(&content, &rep.match_key, &rep.replace_with);
    }
    atomic_write(path, &content).await
}

fn set_xml_path_text(xml: &str, path: &str, value: &str) -> String {
    let parts: Vec<&str> = path.split('.').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return xml.to_string();
    }
    let tag = parts.last().copied().unwrap_or("");
    // Prefer replacing existing <tag>...</tag> or <tag .../> near end of path
    let _open_re = format!(r"(?s)<{tag}(\s[^>]*)?>");
    let paired = Regex::new(&format!(r"(?s)(<{tag}(?:\s[^>]*)?>)(.*?)(</{tag}>)")).ok();
    if let Some(re) = paired {
        if re.is_match(xml) {
            let escaped = xml_escape(value);
            return re
                .replace(xml, |caps: &regex::Captures<'_>| {
                    format!("{}{}{}", &caps[1], escaped, &caps[3])
                })
                .into_owned();
        }
    }

    // Self-closing → expand
    if let Ok(re) = Regex::new(&format!(r"<{}(\s[^>]*)?/>", regex::escape(tag))) {
        if re.is_match(xml) {
            let escaped = xml_escape(value);
            return re
                .replace(xml, format!("<{tag}>{}</{tag}>", escaped))
                .into_owned();
        }
    }

    // Append before closing root-ish tag if nothing matched
    let escaped = xml_escape(value);
    let mut element = String::new();
    for (i, part) in parts.iter().enumerate() {
        if i + 1 == parts.len() {
            element.push_str(&format!("<{part}>{escaped}</{part}>"));
        } else {
            element.push_str(&format!("<{part}>"));
        }
    }
    for part in parts.iter().rev().skip(1) {
        element.push_str(&format!("</{part}>"));
    }

    if let Some(idx) = xml.rfind("</") {
        let mut out = String::with_capacity(xml.len() + element.len());
        out.push_str(&xml[..idx]);
        out.push_str(&element);
        out.push('\n');
        out.push_str(&xml[idx..]);
        out
    } else {
        format!("{}\n{}\n", xml, element)
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Extract config specs from a template JSON object (agent start message).
pub fn specs_from_template(template: &Map<String, Value>) -> Vec<ConfigFileSpec> {
    let features = template.get("features");
    let mut specs = Vec::new();
    if let Some(features) = features {
        if let Some(cfg) = features.get("pterodactylConfigFiles") {
            specs.extend(parse_config_file_specs(cfg));
        }
    }
    specs
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn ctx() -> ConfigResolveContext {
        let mut env = HashMap::new();
        env.insert("SERVER_NAME".into(), "TestWorld".into());
        env.insert("MAX_PLAYERS".into(), "20".into());
        env.insert("SERVER_PORT".into(), "25565".into());
        ConfigResolveContext {
            env,
            primary_port: 25565,
            primary_ip: "0.0.0.0".into(),
            server_uuid: "uuid-1".into(),
            server_memory_mb: 2048,
            server_disk_mb: 10240,
            docker_interface: "0.0.0.0".into(),
        }
    }

    #[test]
    fn resolves_wings_placeholders() {
        let c = ctx();
        assert_eq!(
            c.resolve_placeholders("port={{server.build.default.port}}"),
            "port=25565"
        );
        assert_eq!(
            c.resolve_placeholders("name={{server.build.env.SERVER_NAME}}"),
            "name=TestWorld"
        );
        assert_eq!(
            c.resolve_placeholders("name={{env.SERVER_NAME}}"),
            "name=TestWorld"
        );
        assert_eq!(c.resolve_placeholders("{{SERVER_PORT}}"), "25565");
        assert_eq!(
            c.resolve_placeholders("ip={{config.docker.interface}}"),
            "ip=0.0.0.0"
        );
    }

    #[test]
    fn parses_find_map_egg_format() {
        let raw = serde_json::json!({
            "server.properties": {
                "parser": "properties",
                "find": {
                    "server-ip": "0.0.0.0",
                    "server-port": "{{server.build.default.port}}"
                }
            }
        });
        let specs = parse_config_file_specs(&raw);
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].parser, "properties");
        assert_eq!(specs[0].replacements.len(), 2);
    }

    #[tokio::test]
    async fn applies_properties_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("server.properties");
        {
            let mut f = std::fs::File::create(&path).unwrap();
            writeln!(f, "# Minecraft server properties").unwrap();
            writeln!(f, "server-port=25565").unwrap();
            writeln!(f, "gamemode=survival").unwrap();
        }
        let reps = vec![
            ConfigReplacement {
                match_key: "server-port".into(),
                if_value: None,
                replace_with: "25566".into(),
            },
            ConfigReplacement {
                match_key: "online-mode".into(),
                if_value: None,
                replace_with: "false".into(),
            },
        ];
        apply_properties(&path, &reps).await.unwrap();
        let out = std::fs::read_to_string(&path).unwrap();
        assert!(out.contains("# Minecraft server properties"));
        assert!(out.contains("server-port=25566"));
        assert!(out.contains("online-mode=false"));
        assert!(out.contains("gamemode=survival"));
    }

    #[tokio::test]
    async fn applies_json_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("http.json");
        std::fs::write(&path, r#"{"ip":"127.0.0.1","port":1}"#).unwrap();
        let reps = vec![
            ConfigReplacement {
                match_key: "ip".into(),
                if_value: None,
                replace_with: "0.0.0.0".into(),
            },
            ConfigReplacement {
                match_key: "port".into(),
                if_value: None,
                replace_with: "443".into(),
            },
        ];
        apply_json(&path, &reps).await.unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["ip"], "0.0.0.0");
        assert_eq!(v["port"], 443);
    }

    #[tokio::test]
    async fn applies_text_file_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("autoexec.cfg");
        std::fs::write(&path, "sv_port 1234\nsv_name old\nbindaddr 127.0.0.1\n").unwrap();
        let reps = vec![
            ConfigReplacement {
                match_key: "sv_port".into(),
                if_value: None,
                replace_with: "sv_port 25565".into(),
            },
            ConfigReplacement {
                match_key: "sv_name".into(),
                if_value: None,
                replace_with: "sv_name TestWorld".into(),
            },
        ];
        apply_text_file(&path, &reps).await.unwrap();
        let out = std::fs::read_to_string(&path).unwrap();
        assert!(out.contains("sv_port 25565"));
        assert!(out.contains("sv_name TestWorld"));
        assert!(out.contains("bindaddr 127.0.0.1"));
    }

    #[tokio::test]
    async fn end_to_end_with_placeholders() {
        let dir = tempfile::tempdir().unwrap();
        let server_dir = dir.path();
        let props = server_dir.join("server.properties");
        std::fs::write(&props, "server-port=1\nquery.port=1\n").unwrap();

        let specs = parse_config_file_specs(&serde_json::json!({
            "server.properties": {
                "parser": "properties",
                "find": {
                    "server-port": "{{server.build.default.port}}",
                    "query.port": "{{server.build.default.port}}",
                    "motd": "{{server.build.env.SERVER_NAME}}"
                }
            }
        }));
        apply_configuration_files(server_dir, &specs, &ctx())
            .await
            .unwrap();
        let out = std::fs::read_to_string(&props).unwrap();
        assert!(out.contains("server-port=25565"));
        assert!(out.contains("query.port=25565"));
        assert!(out.contains("motd=TestWorld"));
    }
}
