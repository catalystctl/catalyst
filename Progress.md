# Progress

## Status
Completed

## Tasks
- [x] Feature 1: Server Transfer (Agent-Side) — Determined no new code needed; backend orchestrates transfers via existing `upload_backup_start/chunk/complete` and `download_backup_start/chunk` message flows
- [x] Feature 2: Auto-Restart on Crash — Added `AutoRestartConfig`, `RestartTracker`, and `handle_container_exit` method with rate-limiting (max 5 restarts in 60s window)
- [x] Feature 3: Health Check Probing — Added `spawn_health_checker` that TCP-probes container ports every 30s with state-change-only emissions
- [x] Feature 4: Backup Encryption — Added `encrypt_backup`/`decrypt_backup` with AES-256-GCM, integrated into `handle_create_backup` and `handle_restore_backup`

## Files Changed
- `catalyst-agent/Cargo.toml` — Added `aes-gcm = "0.10"` and `rand_08 = { package = "rand", version = "0.8" }`
- `catalyst-agent/src/websocket_handler.rs` — All four features implemented

## Notes

### Feature 1: Server Transfer
No agent-side code was needed. The backend already handles server-to-server transfer by orchestrating backup upload from the source agent and backup download/restore on the destination agent. The existing `upload_backup_*` and `download_backup_*` message handlers cover this completely.

### Feature 2: Auto-Restart on Crash
- Added `AutoRestartConfig` struct: `{ enabled, delay_secs, max_restarts, window_secs }`
- Added `RestartTracker` with sliding window to prevent infinite restart loops
- Added `handle_container_exit()` method that checks config before emitting crash
- When enabled: waits `delay_secs`, then re-calls `start_server_with_details` with stored message
- Rate-limited: emits console warning when limit is reached
- Config passed via `autoRestart` field in `start_server` message
- State is cleaned up on intentional `stop_server` calls

### Feature 3: Health Check Probing
- `spawn_health_checker()` runs every 30 seconds (connection-scoped task)
- Iterates tracked `(server_id, container_id, primary_port)` tuples
- Uses `spawn_blocking` with `std::net::TcpStream::connect_timeout` (3s timeout)
- Tracks previous health state to only emit on state changes (healthy↔unhealthy)
- Emits `server_state_update` with `"healthy"` or `"unhealthy"` status

### Feature 4: Backup Encryption
- Added `encrypt_backup(data, key)` and `decrypt_backup(data, key)` functions
- Uses AES-256-GCM with `CATALYST_ENC_V1:` magic header + 96-bit nonce prepended
- Key passed as base64-encoded 32-byte key via `encryptionKey` field
- `handle_create_backup`: reads tar.gz, encrypts in-place if key provided
- `handle_restore_backup`: detects encrypted format, decrypts to temp file, extracts, cleans up
- Encryption failures on create are non-fatal (warns, keeps unencrypted backup)
- `backup_complete` event includes `"encrypted": true/false` field
