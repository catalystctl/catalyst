---
title: Resumable File Uploads
description: Chunked / resumable file upload protocol for large server files (server JARs, world saves, mod packs) on Catalyst.
---

# Resumable File Uploads

Catalyst panel supports uploading large files (server JARs, world saves, mod packs) in chunks. Uploads can be resumed after connection drops and report real-time progress per file.

## Overview

The legacy single-shot `POST /api/servers/:serverId/files/upload` endpoint is still available and is used for small files (under 8 MB by default). For files above that threshold, the client automatically switches to the chunked protocol.

The chunked protocol has four phases:

1. **Init** — the client declares the file size and filename and receives an `uploadId` and chunk size.
2. **Chunks** — the client uploads each chunk in sequence. Chunks can be re-sent on failure.
3. **Status** (optional) — at any point the client can ask the backend which chunks have been received, enabling resume.
4. **Complete** — the client confirms upload, the backend assembles the chunks and streams the final file to the agent.

## Protocol

### 1. Init

```http
POST /api/servers/:serverId/files/upload/init
Content-Type: application/json

{
  "path": "/world",
  "filename": "level.dat",
  "totalSize": 4294967296,
  "chunkSize": 8388608
}
```

| Field        | Type    | Required | Description |
|--------------|---------|----------|-------------|
| `path`       | string  | no       | Destination directory on the server (default `/`). |
| `filename`   | string  | yes      | Target filename. Path separators are rejected. |
| `totalSize`  | number  | yes      | Total file size in bytes. |
| `chunkSize`  | number  | no       | Chunk size in bytes (1 MB – 128 MB). Default from server config. |
| `totalChunks`| number  | no       | Optional hint; backend will compute it from `totalSize / chunkSize`. |
| `expectedSha256` | string | no    | Optional integrity check. |

Response (200):

```json
{
  "success": true,
  "data": {
    "uploadId": "5f0c…",
    "chunkSize": 8388608,
    "maxFileSize": 5368709120,
    "expiresAt": 1717000000000
  }
}
```

Errors:

| Status | Meaning |
|--------|---------|
| 400    | Invalid input (e.g. `totalSize <= 0`, `filename` contains a separator, `chunkSize` out of range). |
| 403    | User lacks `file.write` on the server. |
| 404    | Server not found. |
| 413    | `totalSize` exceeds `maxFileSize` (admin-configurable). |

### 2. Upload chunks

```http
POST /api/servers/:serverId/files/upload/:uploadId/chunk
Content-Type: application/octet-stream
X-Chunk-Index: 0

<raw bytes>
```

- `X-Chunk-Index` is the zero-based chunk index.
- The request body is the raw chunk bytes (no encoding, no envelope).
- Chunks can be uploaded sequentially. Parallel upload is supported in principle but not recommended for a single file (the backend expects strictly increasing or any-order arrival as long as each index appears at most once).

Response (200):

```json
{
  "success": true,
  "data": { "received": 1, "total": 512, "receivedBytes": 8388608 }
}
```

Errors:

| Status | Meaning |
|--------|---------|
| 400    | `X-Chunk-Index` missing or out of range; chunk size does not match expected size. |
| 404    | Unknown or expired `uploadId`. |
| 409    | Chunk already received for this index. |
| 413    | Chunk body exceeded expected size. |

### 3. Status (resume)

```http
GET /api/servers/:serverId/files/upload/:uploadId/status
```

Response (200):

```json
{
  "success": true,
  "data": {
    "uploadId": "5f0c…",
    "status": "uploading",
    "totalChunks": 512,
    "totalSize": 4294967296,
    "receivedChunks": [0, 1, 2, 5, 6],
    "receivedBytes": 41943040,
    "filename": "level.dat",
    "targetDir": "/world",
    "expiresAt": 1717000000000
  }
}
```

The client should compute `missing = [0..totalChunks] - receivedChunks` and re-upload only those.

### 4. Complete

```http
POST /api/servers/:serverId/files/upload/:uploadId/complete
```

Response (200):

```json
{
  "success": true,
  "data": { "path": "/world/level.dat", "size": 4294967296 }
}
```

Errors:

| Status | Meaning |
|--------|---------|
| 400    | One or more chunks missing. The error message lists the first 20 missing indices. |
| 404    | Unknown or expired `uploadId`. |
| 409    | Upload was already completed. |
| 410    | Upload was cancelled. |
| 502    | Backend failed to deliver the assembled file to the agent. |
| 504    | Agent file operation timed out. |

### 5. Cancel (optional)

```http
DELETE /api/servers/:serverId/files/upload/:uploadId
```

Cancels an in-progress upload and releases its server-side resources. Returns 404 if the session is unknown or already completed.

## Admin settings

Three new settings are available under **Admin → Security → File Tunnel Settings**:

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `chunkedUploadMaxFileMb` | 5120 (5 GB) | 1 – 51200 (50 GB) | Maximum size of a single chunked upload. Files larger than this are rejected at the `init` step. |
| `chunkedUploadChunkMb`  | 8            | 1 – 128            | Default chunk size. Clients may request a different size at init. |
| `chunkedUploadSessionTtlMs` | 3600000 (1 h) | ≥ 60000 (1 min) ≤ 86400000 (24 h) | How long an idle upload session is retained before being garbage-collected. |

Existing `fileTunnelMaxUploadMb` still applies to the legacy single-shot upload path.

## Resume behavior

If a connection drops mid-upload:

1. The client saves the `uploadId` it received at init.
2. After reconnecting, the client calls `GET /status` to discover which chunks were already stored on the backend.
3. The client uploads only the missing indices.
4. The client calls `POST /complete` to finalize.

The backend does not deduplicate on the file name — each `uploadId` is a unique session. If the client wants to start over, it can call `DELETE /:uploadId` and then re-init.

## Backward compatibility

The legacy single-shot route `POST /api/servers/:serverId/files/upload` is unchanged and remains the default for small files. The frontend client picks the chunked path automatically once the file exceeds 8 MB (or whatever the server's `chunkedUploadChunkMb` is set to). External integrators can keep using the legacy route or opt in to the new one.

## Garbage collection

The backend runs a periodic sweep (every 60 s) that removes sessions whose `lastActivity` is older than `2 × chunkedUploadSessionTtlMs`. Cancelling or completing a session also triggers immediate cleanup of its on-disk chunks. Disk usage is bounded by:

```
disk = sum(session.totalSize) across all in-flight sessions
```

which is naturally limited by the per-user session cap (100) and the per-session `maxFileSize`.
