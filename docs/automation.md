# Automation & Plugin Guide

Learn how to automate Catalyst operations using scheduled tasks, webhooks, the REST API, and custom plugins.

## Table of Contents

- [Scheduled Tasks](#scheduled-tasks)
  - [Creating Tasks](#creating-tasks)
  - [Supported Actions](#supported-actions)
  - [Cron Expression Reference](#cron-expression-reference)
  - [Managing Tasks](#managing-tasks)
  - [Examples](#scheduled-task-examples)
- [Webhooks](#webhooks)
  - [Configuration](#webhook-configuration)
  - [Event Types](#webhook-event-types)
  - [Payload Format](#webhook-payload-format)
  - [Signature Verification](#webhook-signature-verification)
  - [Receiving Webhooks (Example)](#receiving-webhooks)
- [Real-Time Event Streams](#real-time-event-streams)
  - [SSE Events](#sse-events)
  - [Console Stream (SSE)](#console-stream-sse)
  - [Metrics Stream](#metrics-stream)
  - [Admin Events](#admin-events)
- [API Automation](#api-automation)
  - [cURL Examples](#curl-automation-examples)
  - [Python Automation Script](#python-automation-script)
  - [Node.js Automation](#nodejs-automation)
- [Bulk Server Operations](#bulk-server-operations)
  - [Bulk Suspend/Unsuspend](#bulk-suspendunsuspend)
  - [Bulk Delete](#bulk-delete)
- [Server Template Creation](#server-template-creation)
  - [Template Schema Reference](#template-schema-reference)
  - [Template Fields](#template-fields)
  - [Environment Variables](#environment-variables)
  - [Install Scripts](#install-scripts)
  - [Image Variants](#image-variants)
  - [Features](#template-features)
  - [Template Example: Minecraft Paper](#template-example-minecraft-paper)
  - [Importing Pterodactyl Eggs](#importing-pterodactyl-eggs)
- [Plugin Development](#plugin-development)
  - [Architecture Overview](#plugin-architecture)
  - [Plugin Directory Structure](#plugin-directory-structure)
  - [Plugin Manifest](#plugin-manifest)
  - [Plugin Lifecycle](#plugin-lifecycle)
  - [Plugin Context API](#plugin-context-api)
  - [Plugin Database Access](#plugin-database-access)
  - [Plugin Storage](#plugin-storage)
  - [Example Plugin Walkthrough](#example-plugin-walkthrough)
  - [Real Plugin: Ticketing System](#real-plugin-ticketing-system)
  - [Plugin Configuration](#plugin-configuration)
  - [Hot Reload](#plugin-hot-reload)
  - [Plugin Permissions](#plugin-permissions)
- [Deployment Automation](#deployment-automation)
  - [Docker Compose Deployment](#docker-compose-deployment)
  - [Node Deployment Script](#node-deployment-script)
  - [CI/CD Pipeline Example](#cicd-pipeline-example)

---

## Scheduled Tasks

Catalyst includes a built-in task scheduler that executes server operations on a cron schedule. Tasks run server-side and communicate with agents to perform actions.

### Creating Tasks

```bash
# Create a daily restart task at 3 AM UTC
curl -X POST http://localhost:3000/api/servers/srv_abc/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Daily Restart",
    "description": "Restart server every day at 3 AM",
    "action": "restart",
    "schedule": "0 3 * * *"
  }'

# Create an hourly backup
curl -X POST http://localhost:3000/api/servers/srv_abc/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Hourly Backup",
    "action": "backup",
    "schedule": "0 * * * *"
  }'

# Create a scheduled command
curl -X POST http://localhost:3000/api/servers/srv_abc/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Announce Restart",
    "action": "command",
    "payload": { "command": "say Server restarting in 5 minutes!" },
    "schedule": "55 2 * * *"
  }'
```text

### Supported Actions

| Action | Description | Payload |
|--------|-------------|---------|
| `start` | Start the server | — |
| `stop` | Stop the server gracefully | — |
| `restart` | Restart the server | — |
| `backup` | Create a backup | — |
| `command` | Send a console command | `{ "command": "say Hello" }` |

Tasks are blocked if the server is suspended. Each execution updates `lastRunAt`, `runCount`, `lastStatus`, and `lastError` fields.

### Cron Expression Reference

Catalyst uses standard 5-field cron syntax:

```
┌───────────── minute (0–59)
│ ┌───────────── hour (0–23)
│ │ ┌───────────── day of month (1–31)
│ │ │ ┌───────────── month (1–12)
│ │ │ │ ┌───────────── day of week (0–6, 0=Sunday)
│ │ │ │ │
* * * * *
```text

| Expression | Meaning |
|-----------|---------|
| `0 3 * * *` | Every day at 3:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 */6 * * *` | Every 6 hours |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 0 1 * *` | First day of every month |
| `0 8 * * 1-5` | Weekdays at 8:00 AM |
| `*/15 9-17 * * 1-5` | Every 15 min during business hours |
| `0 0 1 1 *` | January 1st at midnight |

The timezone defaults to `UTC` but can be overridden with the `TZ` environment variable.

### Managing Tasks

```bash
# List all tasks for a server
curl http://localhost:3000/api/servers/srv_abc/tasks \
  -H "Authorization: Bearer $API_KEY"

# Get a specific task
curl http://localhost:3000/api/servers/srv_abc/tasks/task_abc \
  -H "Authorization: Bearer $API_KEY"

# Update a task (change schedule)
curl -X PUT http://localhost:3000/api/servers/srv_abc/tasks/task_abc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "name": "Daily Restart",
    "schedule": "0 4 * * *",
    "enabled": true
  }'

# Disable a task
curl -X PUT http://localhost:3000/api/servers/srv_abc/tasks/task_abc \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"enabled": false}'

# Delete a task
curl -X DELETE http://localhost:3000/api/servers/srv_abc/tasks/task_abc \
  -H "Authorization: Bearer $API_KEY"

# Execute a task immediately (one-time run)
curl -X POST http://localhost:3000/api/servers/srv_abc/tasks/task_abc/execute \
  -H "Authorization: Bearer $API_KEY"
```

### Scheduled Task Examples

#### Automated Maintenance Window

```python
import requests

API = "http://localhost:3000"
HEADERS = {"Authorization": f"Bearer {os.environ['CATALYST_API_KEY']}"}
SERVER_ID = "srv_abc"

# Announce maintenance 5 minutes before
requests.post(f"{API}/api/servers/{SERVER_ID}/tasks", headers=HEADERS, json={
    "name": "Maintenance Warning",
    "action": "command",
    "payload": {"command": "say SERVER MAINTENANCE IN 5 MINUTES"},
    "schedule": "55 2 * * *"
})

# Stop server
requests.post(f"{API}/api/servers/{SERVER_ID}/tasks", headers=HEADERS, json={
    "name": "Maintenance Stop",
    "action": "stop",
    "schedule": "0 3 * * *"
})

# Start server
requests.post(f"{API}/api/servers/{SERVER_ID}/tasks", headers=HEADERS, json={
    "name": "Maintenance Start",
    "action": "start",
    "schedule": "0 4 * * *"
})
```text

---

## Webhooks

Catalyst can send webhook notifications for server lifecycle events. Webhooks are dispatched as JSON POST requests with HMAC-SHA256 signatures.

### Webhook Configuration

Webhooks are configured via environment variable or database:

```bash
# Environment variable (comma-separated URLs)
WEBHOOK_URLS=https://hooks.slack.com/services/xxx,https://discord.com/api/webhooks/yyy

# Or set via admin security settings (stored in DB)
```

The webhook secret is set with `WEBHOOK_SECRET` (auto-generated if not provided).

### Event Types

| Event | Description | When Fired |
|-------|-------------|------------|
| `server.created` | New server created | After server provisioning |
| `server.deleted` | Server deleted | After server removal |
| `server.suspended` | Server suspended | After suspension |
| `server.unsuspended` | Server unsuspended | After unsuspension |
| `server.bulk_suspended` | Multiple servers suspended | Bulk suspend operation |
| `server.bulk_deleted` | Multiple servers deleted | Bulk delete operation |
| `user.deleted` | User account deleted | After user removal |

### Webhook Payload Format

All payloads follow this structure:

```json
{
  "event": "server.created",
  "serverId": "srv_abc123",
  "serverName": "My Minecraft Server",
  "userId": "usr_xyz789",
  "timestamp": "2026-04-18T21:00:00.000Z",
  "data": {
    "ownerId": "usr_xyz789"
  }
}
```text

**Headers included in every webhook:**

| Header | Description |
|--------|-------------|
| `X-Webhook-Signature` | HMAC-SHA256 of payload body |
| `X-Webhook-Event` | Event type (e.g., `server.created`) |
| `X-Webhook-Timestamp` | ISO 8601 timestamp |
| `User-Agent` | `Catalyst-Webhooks/1.0` |

### Webhook Signature Verification

Verify webhooks by computing the HMAC-SHA256 signature:

```python
import hmac
import hashlib

def verify_webhook(payload_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode('utf-8'),
        payload_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

# In your webhook receiver:
# signature = request.headers.get('X-Webhook-Signature')
# payload = request.get_data()
# if verify_webhook(payload, signature, WEBHOOK_SECRET):
#     process_event(request.headers.get('X-Webhook-Event'), json.loads(payload))
```

### Receiving Webhooks

```python
from flask import Flask, request, jsonify

app = Flask(__name__)
WEBHOOK_SECRET = "your-webhook-secret"

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Webhook-Signature', '')
    event = request.headers.get('X-Webhook-Event', '')
    payload = request.get_data()

    if not verify_webhook(payload, signature, WEBHOOK_SECRET):
        return jsonify({"error": "Invalid signature"}), 401

    data = request.get_json()
    print(f"Received event: {event}")
    print(f"Server: {data.get('serverName')}")

    if event == 'server.created':
        send_discord_notification(f"🎮 New server: {data['serverName']}")
    elif event == 'server.suspended':
        send_discord_notification(f"⚠️ Server suspended: {data['serverName']}")

    return jsonify({"ok": True})
```text

---

## Real-Time Event Streams

Catalyst provides several real-time event streams for monitoring and automation. All streams use Server-Sent Events (SSE) for efficient, one-directional data delivery.

### SSE Events

**Endpoint:** `GET /api/servers/:serverId/events`

Per-server event stream that delivers real-time updates about server state changes, console output, and system events.

**Event types:**

| Event | Description | Data Payload |
|-------|-------------|--------------|
| `server.started` | Server power-on completed | `{ serverId, timestamp }` |
| `server.stopped` | Server power-off completed | `{ serverId, timestamp }` |
| `server.restarting` | Server is restarting | `{ serverId, reason }` |
| `server.installing` | Server installation started | `{ serverId, progress }` |
| `server.installComplete` | Server installation finished | `{ serverId, timestamp }` |
| `server.suspended` | Server was suspended by admin | `{ serverId, reason }` |
| `server.resumed` | Server was resumed by admin | `{ serverId }` |
| `console` | Console output line | `{ serverId, line, timestamp }` |
| `alert` | Alert triggered for server | `{ serverId, alertId, message, level }` |
| `backup.started` | Backup process started | `{ serverId, backupId }` |
| `backup.complete` | Backup completed | `{ serverId, backupId, size }` |
| `backup.failed` | Backup failed | `{ serverId, backupId, error }` |

**Example client (JavaScript):**

```javascript
const evtSource = new EventSource('http://localhost:3000/api/servers/srv_abc/events');

evtSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Event: ${data.type}`, data);
};

evtSource.onerror = (error) => {
  console.error('SSE connection error:', error);
  // SSE auto-reconnects automatically
};
```

**Rate limits:** SSE streams are exempt from the global rate limiter. Maximum 100 concurrent SSE events per server.

### Console Stream (SSE)

**Endpoint:** `GET /api/servers/:serverId/console/stream`

Real-time console output stream. Falls back to WebSocket if SSE is unavailable. Used by the panel's server console UI.

**How it works:**

1. Client connects to `/api/servers/:serverId/console/stream`
2. Server opens an SSE connection with proper CORS headers
3. Console output from the game server is pushed to the client
4. Heartbeats are sent every 30 seconds to keep the connection alive
5. If the connection drops, the client auto-reconnects

**SSE message format:**

```
event: connected
data: {"serverId": "srv_abc", "timestamp": "2026-05-04T12:00:00.000Z"}

event: console
data: {"serverId": "srv_abc", "line": "[INFO] Starting server...", "timestamp": "2026-05-04T12:00:01.000Z"}

event: heartbeat
data: null
```

**Maximum concurrent streams:** 50 per server. If the cap is reached, new connections are rejected until existing ones close.

**Sending commands:**

```bash
curl -X POST http://localhost:3000/api/servers/srv_abc/console/command \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "say Hello from API"}'
```

**Nginx configuration for SSE:**

```nginx
location /ws {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}

# SSE streams should NOT be buffered
location ~ ^/api/servers/.*/console/stream {
    proxy_pass http://backend:3000;
    proxy_set_header X-Accel-Buffering no;
    proxy_buffering off;
    proxy_cache off;
}
```

### Metrics Stream

**Endpoint:** `GET /api/metrics/stream`

WebSocket-based real-time metrics stream for server resource monitoring (CPU, memory, disk, network).

**Metrics sent:**

| Metric | Description | Source |
|--------|-------------|--------|
| `cpuUsage` | CPU usage percentage | Agent → Backend → Client |
| `memoryUsed` | Memory used (MB) | Container stats |
| `memoryTotal` | Total memory (MB) | Container config |
| `diskUsed` | Disk used (MB) | Container stats |
| `diskTotal` | Total disk (MB) | Container config |
| `networkIn` | Network incoming (KB/s) | Container stats |
| `networkOut` | Network outgoing (KB/s) | Container stats |
| `processCount` | Number of running processes | Agent → Backend |
| `status` | Server status | Internal state |

**Rate limit:** `60` server metrics per second (configurable via `serverMetricsMax`)

**Example client (JavaScript):**

```javascript
const ws = new WebSocket('ws://localhost:3000/api/metrics/stream');

ws.onmessage = (event) => {
  const metrics = JSON.parse(event.data);
  console.log(`CPU: ${metrics.cpuUsage}%`, `RAM: ${metrics.memoryUsed}/${metrics.memoryTotal} MB`);
};

ws.onerror = (error) => {
  console.error('Metrics stream error:', error);
};
```

### Admin Events

**Endpoint:** `GET /api/admin/events`

Admin activity feed stream. Shows system-wide events for administrators to monitor panel activity.

**Event types:**

| Event | Description | Data Payload |
|-------|-------------|--------------|
| `user.created` | New user registered | `{ userId, email, source }` |
| `user.deleted` | User account deleted | `{ userId, email, ownedServers }` |
| `user.banned` | User was banned | `{ userId, email, reason }` |
| `server.created` | Server created | `{ serverId, name, templateId }` |
| `server.deleted` | Server deleted | `{ serverId, name, ownerId }` |
| `server.suspended` | Server suspended | `{ serverId, name, reason, adminId }` |
| `node.offline` | Node went offline | `{ nodeId, lastSeen }` |
| `node.online` | Node came back online | `{ nodeId }` |
| `backup.started` | Backup initiated | `{ backupId, serverId }` |
| `backup.complete` | Backup completed | `{ backupId, serverId, size }` |
| `backup.failed` | Backup failed | `{ backupId, serverId, error }` |
| `alert.triggered` | Alert triggered | `{ alertId, serverId, message }` |

**Example client (JavaScript):**

```javascript
const evtSource = new EventSource('http://localhost:3000/api/admin/events');

evtSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`[Admin] ${data.type}:`, data);
};
```

**Rate limits:** Admin events stream is exempt from the global rate limiter. Maximum 1 concurrent subscriber per admin.

---
## API Automation

### cURL Automation Examples

```bash
#!/bin/bash
# catalyst-automation.sh — Common server management operations

BASE="http://localhost:3000"
API_KEY="catalyst_your_key_here"

api() {
  curl -s -H "Authorization: Bearer $API_KEY" \
       -H "Content-Type: application/json" "$BASE$1" "${@:2}"
}

# List all servers and their statuses
echo "=== Server Status ==="
api /api/servers | jq -r '.data[] | "\(.name) (\(.status))"'

# Start all stopped servers
echo "=== Starting stopped servers ==="
api /api/servers | jq -r '.data[] | select(.status=="stopped") | .id' | while read id; do
  echo "Starting $id..."
  api /api/servers/$id/start -X POST > /dev/null
done

# Create backups for all running servers
echo "=== Creating backups ==="
api /api/servers | jq -r '.data[] | select(.status=="running") | .id' | while read id; do
  name=$(api /api/servers/$id | jq -r '.data.name')
  echo "Backing up $name ($id)..."
  api /api/servers/$id/backups -X POST -d "{\"name\":\"auto-$(date +%Y%m%d)\"}"
done

# Get dashboard stats
echo "=== Dashboard ==="
api /api/dashboard/stats | jq .
```

### Python Automation Script

```python
#!/usr/bin/env python3
"""catalyst-manager.py — Python automation for Catalyst game servers."""

import os
import sys
import requests
import json

BASE_URL = os.environ.get("CATALYST_URL", "http://localhost:3000")
API_KEY = os.environ.get("CATALYST_API_KEY")

session = requests.Session()
session.headers.update({
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
})


def api(method, path, **kwargs):
    """Make an authenticated API request."""
    resp = session.request(method, f"{BASE_URL}{path}", **kwargs)
    resp.raise_for_status()
    return resp.json()


def list_servers(status=None):
    """List servers, optionally filtered by status."""
    params = {}
    if status:
        params["status"] = status
    data = api("GET", "/api/servers", params=params)
    return data.get("data", [])


def start_server(server_id):
    return api("POST", f"/api/servers/{server_id}/start")


def stop_server(server_id):
    return api("POST", f"/api/servers/{server_id}/stop")


def restart_server(server_id):
    return api("POST", f"/api/servers/{server_id}/restart")


def send_command(server_id, command):
    return api("POST", f"/api/servers/{server_id}/console/command",
               json={"command": command})


def create_backup(server_id, name=None):
    body = {}
    if name:
        body["name"] = name
    return api("POST", f"/api/servers/{server_id}/backups", json=body)


def create_server(name, template_id, node_id, **kwargs):
    """Create a new game server."""
    body = {
        "name": name,
        "templateId": template_id,
        "nodeId": node_id,
        "locationId": kwargs.get("location_id", "default"),
        "allocatedMemoryMb": kwargs.get("memory_mb", 1024),
        "allocatedCpuCores": kwargs.get("cpu_cores", 1),
        "allocatedDiskMb": kwargs.get("disk_mb", 5000),
        "primaryPort": kwargs.get("port", 25565),
        "environment": kwargs.get("environment", {}),
    }
    return api("POST", "/api/servers", json=body)


def schedule_task(server_id, name, action, schedule, payload=None):
    """Create a scheduled task."""
    body = {
        "name": name,
        "action": action,
        "schedule": schedule,
    }
    if payload:
        body["payload"] = payload
    return api("POST", f"/api/servers/{server_id}/tasks", json=body)


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "status"

    if command == "status":
        servers = list_servers()
        print(f"{'Name':<30} {'Status':<12} {'Node'}")
        print("-" * 60)
        for s in servers:
            print(f"{s['name']:<30} {s['status']:<12} {s.get('node', {}).get('name', 'N/A')}")

    elif command == "start-all":
        for s in list_servers(status="stopped"):
            start_server(s["id"])
            print(f"Started {s['name']}")

    elif command == "stop-all":
        for s in list_servers(status="running"):
            stop_server(s["id"])
            print(f"Stopped {s['name']}")

    elif command == "restart-all":
        for s in list_servers(status="running"):
            restart_server(s["id"])
            print(f"Restarted {s['name']}")

    elif command == "backup-all":
        from datetime import datetime
        tag = datetime.now().strftime("%Y%m%d-%H%M")
        for s in list_servers(status="running"):
            create_backup(s["id"], f"auto-{tag}")
            print(f"Backup created for {s['name']}")

    elif command == "schedule-restart":
        server_id = sys.argv[2]
        hour = sys.argv[3] if len(sys.argv) > 3 else "3"
        schedule_task(server_id, "Daily Restart", "restart", f"0 {hour} * * *")
        print(f"Scheduled daily restart at {hour}:00 AM for {server_id}")

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
```text

### Node.js Automation

```javascript
// automation.js — Node.js automation examples
const BASE = process.env.CATALYST_URL || "http://localhost:3000";

const api = async (path, options = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CATALYST_API_KEY}`,
    },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json();
};

// Batch operations
async function startAllStopped() {
  const { data: servers } = await api("/api/servers");
  const stopped = servers.filter(s => s.status === "stopped");
  await Promise.all(stopped.map(s =>
    api(`/api/servers/${s.id}/start`, { method: "POST" })
  ));
  console.log(`Started ${stopped.length} servers`);
}

// Create server with schedule
async function createWithSchedule(name, templateId, nodeId) {
  const server = await api("/api/servers", {
    method: "POST",
    body: JSON.stringify({
      name, templateId, nodeId,
      locationId: "default",
      allocatedMemoryMb: 2048,
      allocatedCpuCores: 2,
      allocatedDiskMb: 10000,
      primaryPort: 25565,
    }),
  });
  const serverId = server.data.id;

  // Schedule daily backup at midnight
  await api(`/api/servers/${serverId}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      name: "Daily Backup",
      action: "backup",
      schedule: "0 0 * * *",
    }),
  });

  // Schedule restart at 3 AM
  await api(`/api/servers/${serverId}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      name: "Daily Restart",
      action: "restart",
      schedule: "0 3 * * *",
    }),
  });

  console.log(`Created ${name} (${serverId}) with backup and restart schedules`);
}
```

---

## Bulk Server Operations

Catalyst provides bulk endpoints for managing multiple servers at once — useful for billing integrations and mass administration.

### Bulk Suspend/Unsuspend

```bash
# Suspend multiple servers (billing overdue)
curl -X POST http://localhost:3000/api/servers/bulk/suspend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "serverIds": ["srv_1", "srv_2", "srv_3"],
    "reason": "Payment overdue"
  }'

# Unsuspend multiple servers
curl -X POST http://localhost:3000/api/servers/bulk/unsuspend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "serverIds": ["srv_1", "srv_2", "srv_3"]
  }'
```text

### Bulk Delete

```bash
# Delete multiple stopped servers
curl -X POST http://localhost:3000/api/servers/bulk/delete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "serverIds": ["srv_1", "srv_2"]
  }'
```

Bulk operations return per-server results:

```json
{
  "success": true,
  "results": [
    { "serverId": "srv_1", "status": "success" },
    { "serverId": "srv_2", "status": "skipped", "error": "Server is not suspended" }
  ],
  "summary": { "success": 1, "skipped": 1, "failed": 0 }
}
```text

---

## Server Template Creation

Templates define everything needed to provision a game server: container image, startup command, environment variables, install scripts, and features.

### Template Schema Reference

The full JSON Schema is available at `templates/schema.template`. Key points:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique kebab-case identifier |
| `name` | string | ✅ | Human-readable name |
| `description` | string | ❌ | Description |
| `author` | string | ✅ | Author/maintainer |
| `version` | string | ✅ | Target software version |
| `image` | string | ✅ | Default container image |
| `images` | array | ❌ | Alternative image options |
| `defaultImage` | string | ❌ | Default image variant |
| `installImage` | string | ❌ | Image for install script |
| `startup` | string | ✅ | Startup command with `{{VAR}}` interpolation |
| `stopCommand` | string | ✅ | Graceful shutdown command |
| `sendSignalTo` | string | ✅ | Fallback signal: `SIGTERM`, `SIGINT`, `SIGKILL` |
| `variables` | array | ✅ | Environment variable definitions |
| `installScript` | string | ❌ | Installation shell script |
| `supportedPorts` | number[] | ✅ | Ports used by the server |
| `allocatedMemoryMb` | number | ✅ | Default RAM allocation |
| `allocatedCpuCores` | number | ✅ | Default CPU allocation |
| `features` | object | ❌ | Feature flags |

### Template Fields

#### Environment Variables

Each variable in the `variables` array defines a user-configurable option:

```json
{
  "name": "MEMORY",
  "description": "Amount of RAM in MB",
  "default": "1024",
  "required": true,
  "input": "number",
  "rules": ["between:512,16384"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Variable name (UPPER_SNAKE_CASE) |
| `description` | string | User-facing description |
| `default` | string | Default value (always string) |
| `required` | boolean | Must be provided by user |
| `input` | string | UI input type: `text`, `number`, `password`, `checkbox`, `select`, `textarea` |
| `rules` | string[] | Validation rules (Laravel-style syntax) |

**Available rules:** `required`, `min:n`, `max:n`, `between:n,m`, `in:a,b,c`, `not_in:a,b,c`, `email`, `url`.

#### Install Scripts

Install scripts are shell scripts that run in the `installImage` container during server provisioning. They support variable interpolation:

```bash
#!/bin/sh
set -e

# Built-in variables:
# {{SERVER_DIR}}  — absolute path to server data directory
# {{VARIABLE}}   — any template variable

mkdir -p {{SERVER_DIR}}
cd {{SERVER_DIR}}

# Download server files
curl -sL -o server.jar "https://example.com/server-{{VERSION}}.jar"

# Create default config
cat > server.properties << 'EOF'
server-port={{PORT}}
max-players=20
EOF
```text

#### Image Variants

Offer multiple container images for users to choose from:

```json
{
  "image": "eclipse-temurin:21-jre",
  "images": [
    { "name": "temurin-21", "label": "Eclipse Temurin 21 JRE", "image": "eclipse-temurin:21-jre" },
    { "name": "temurin-17", "label": "Eclipse Temurin 17 JRE", "image": "eclipse-temurin:17-jre" }
  ],
  "defaultImage": "eclipse-temurin:21-jre"
}
```

The selected image is determined by the `IMAGE_VARIANT` environment variable. Users can select the variant during server creation or in server settings.

#### Features

Templates can declare optional features:

```json
{
  "features": {
    "restartOnExit": true,
    "configFile": "server.properties",
    "modManager": {
      "providers": ["curseforge", "modrinth"],
      "paths": { "mods": "/mods", "datapacks": "/world/datapacks" }
    },
    "pluginManager": {
      "providers": ["spigot", "paper", "modrinth"],
      "paths": { "plugins": "/plugins" }
    },
    "backupPaths": ["/world", "/plugins", "/server.properties"]
  }
}
```text

| Feature | Description |
|---------|-------------|
| `restartOnExit` | Auto-restart on unexpected exit |
| `maxInstances` | Max servers from this template |
| `configFile` | Primary config file for the editor |
| `configFiles` | Additional config files |
| `modManager` | Enable mod management with providers |
| `pluginManager` | Enable plugin management |
| `backupPaths` | Paths to include in backups |
| `fileEditor` | File editing configuration |

### Template Example: Minecraft Paper

```json
{
  "id": "minecraft-paper",
  "name": "Minecraft Server (Paper)",
  "description": "High-performance Minecraft server running Paper",
  "author": "Catalyst Maintainer",
  "version": "1.21.11",
  "image": "eclipse-temurin:21-jre",
  "images": [
    { "name": "temurin-21", "label": "Eclipse Temurin 21 JRE", "image": "eclipse-temurin:21-jre" },
    { "name": "temurin-17", "label": "Eclipse Temurin 17 JRE", "image": "eclipse-temurin:17-jre" }
  ],
  "defaultImage": "eclipse-temurin:21-jre",
  "installImage": "alpine:3.19",
  "startup": "java -Xms{{MEMORY_XMS}}M -Xmx{{MEMORY}}M -jar paper.jar nogui",
  "stopCommand": "stop",
  "sendSignalTo": "SIGTERM",
  "variables": [
    { "name": "MEMORY", "description": "RAM in MB", "default": "1024", "required": true, "input": "number", "rules": ["between:512,16384"] },
    { "name": "PORT", "description": "Server port", "default": "25565", "required": true, "input": "number", "rules": ["between:1024,65535"] },
    { "name": "VERSION", "description": "Minecraft version", "default": "1.21.11", "required": true, "input": "select" }
  ],
  "supportedPorts": [25565],
  "allocatedMemoryMb": 1024,
  "allocatedCpuCores": 2,
  "features": {
    "restartOnExit": true,
    "configFile": "server.properties",
    "pluginManager": {
      "providers": ["spigot", "paper", "modrinth"],
      "paths": { "plugins": "/plugins" }
    }
  }
}
```

### Importing Pterodactyl Eggs

Catalyst can import Pterodactyl egg JSON directly:

```bash
curl -X POST http://localhost:3000/api/templates/import-pterodactyl \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d @pterodactyl-egg.json
```text

The import maps Pterodactyl variables, images, install scripts, and config files to Catalyst format automatically.

---

## Plugin Development

Catalyst has a built-in plugin system that allows extending the panel with custom API routes, WebSocket handlers, scheduled tasks, and event listeners.

### Plugin Architecture

```
┌─────────────────────────────────────────────────┐
│                 Catalyst Backend                 │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Fastify   │  │ WebSocket│  │ Task         │  │
│  │ Routes    │  │ Gateway  │  │ Scheduler    │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│  ┌────┴──────────────┴───────────────┴───────┐  │
│  │            Plugin Context                  │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────┐ │  │
│  │  │ Scoped  │ │ Config   │ │ Key-Value  │ │  │
│  │  │ DB      │ │ Manager  │ │ Storage    │ │  │
│  │  └─────────┘ └──────────┘ └────────────┘ │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │            Plugin Loader                     │ │
│  │  Discover → Validate → Load → Enable         │ │
│  │  (hot-reload via chokidar file watcher)     │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```text

### Plugin Directory Structure

```
catalyst-plugins/
└── my-plugin/
    ├── plugin.json          # Manifest (required)
    ├── backend/
    │   └── index.js         # Backend entry point
    └── frontend/
        └── index.ts         # Frontend entry point
```text

### Plugin Manifest

Every plugin requires a `plugin.json` manifest:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "description": "What this plugin does",
  "author": "Your Name",
  "catalystVersion": ">=1.0.0",
  "permissions": ["server.read", "admin.read"],
  "backend": {
    "entry": "backend/index.js"
  },
  "frontend": {
    "entry": "frontend/index.ts"
  },
  "config": {
    "apiKey": {
      "type": "string",
      "default": "",
      "description": "External API key"
    },
    "enabled": {
      "type": "boolean",
      "default": true,
      "description": "Enable the feature"
    }
  },
  "dependencies": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique plugin identifier (kebab-case) |
| `version` | string | ✅ | Semver version |
| `displayName` | string | ✅ | Human-readable name |
| `description` | string | ✅ | Plugin description |
| `author` | string | ✅ | Author name |
| `catalystVersion` | string | ✅ | Compatible Catalyst version range |
| `permissions` | string[] | ✅ | Required permissions |
| `backend.entry` | string | ❌ | Backend module path |
| `frontend.entry` | string | ❌ | Frontend module path |
| `config` | object | ❌ | Configuration schema |
| `dependencies` | object | ❌ | Plugin dependencies |

### Plugin Lifecycle

Plugins go through these lifecycle stages:

1. **Discover** — PluginLoader scans the plugins directory
2. **Validate** — Manifest is validated against the schema
3. **Load** — Backend module is imported, `onLoad()` is called
4. **Enable** — `onEnable()` is called, routes become active
5. **Disable** — `onDisable()` is called, tasks are stopped
6. **Unload** — `onUnload()` is called, event listeners removed

### Plugin Context API

The plugin context (`ctx`) provides access to Catalyst services:

```javascript
module.exports = {
  async onLoad(ctx) {
    // ctx.manifest    — Plugin manifest
    // ctx.db          — Scoped database client
    // ctx.logger      — Named logger instance
    // ctx.wsGateway   — WebSocket gateway

    // Route registration
    ctx.registerRoute({
      method: 'GET',
      url: '/my-endpoint',
      handler: async (request, reply) => {
        return { data: 'Hello from plugin!' };
      },
    });

    // WebSocket
    ctx.onWebSocketMessage('my_event', async (data, clientId) => {
      console.log('Received:', data);
    });

    // Scheduled tasks
    ctx.scheduleTask('*/5 * * * *', async () => {
      ctx.logger.info('Running 5-minute task');
    });

    // Events
    ctx.on('server.started', async (data) => {
      ctx.logger.info(`Server ${data.serverId} started`);
    });

    // Configuration
    const apiKey = ctx.getConfig('apiKey');
    await ctx.setConfig('lastRun', new Date().toISOString());

    // Persistent storage (plugin-scoped key-value)
    await ctx.setStorage('counter', 42);
    const counter = await ctx.getStorage('counter');
    await ctx.deleteStorage('temp');
  },
};
```text

### Plugin Database Access

Plugins get a scoped database client that only exposes tables matching their declared permissions:

```javascript
// Plugin declares: "permissions": ["server.read"]
module.exports = {
  async onLoad(ctx) {
    // Read-only access to server table
    const servers = await ctx.db.servers.findMany({
      where: { status: 'running' },
    });

    // Access denied — plugin didn't declare "user.read"
    // await ctx.db.users.findMany(); // throws Error
  },
};
```

The scoped client automatically:
- Strips sensitive fields (passwords, API keys, tokens)
- Enforces read-only access
- Limits returned columns to safe defaults

### Plugin Storage

Each plugin has a persistent key-value store backed by the database:

```javascript
// Store plugin state
await ctx.setStorage('installDate', new Date().toISOString());
await ctx.setStorage('config', { theme: 'dark', lang: 'en' });
await ctx.setStorage('stats', { requests: 1000, errors: 5 });

// Retrieve
const date = await ctx.getStorage('installDate');
const config = await ctx.getStorage('config');

// Delete
await ctx.deleteStorage('temp_cache');
```text

### Example Plugin Walkthrough

Here's the example plugin included with Catalyst (`catalyst-plugins/example-plugin/`):

**plugin.json:**

```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "displayName": "Example Plugin",
  "description": "Comprehensive showcase of Catalyst plugin capabilities",
  "author": "Catalyst Team",
  "catalystVersion": ">=1.0.0",
  "permissions": ["server.read", "server.write", "admin.read", "console.read"],
  "backend": { "entry": "backend/index.js" },
  "frontend": { "entry": "frontend/index.ts" },
  "config": {
    "greeting": {
      "type": "string",
      "default": "Hello from Example Plugin!",
      "description": "Greeting message"
    }
  }
}
```

**backend/index.js:**

```javascript
let context;
let requestCount = 0;

module.exports = {
  async onLoad(ctx) {
    context = ctx;

    // Initialize storage
    const initialized = await ctx.getStorage('initialized');
    if (!initialized) {
      await ctx.setStorage('initialized', true);
      await ctx.setStorage('installDate', new Date().toISOString());
    }

    // Register API routes
    ctx.registerRoute({
      method: 'GET',
      url: '/hello',
      handler: async (request) => ({
        message: ctx.getConfig('greeting') || 'Hello!',
        requestCount: ++requestCount,
      }),
    });

    ctx.registerRoute({
      method: 'POST',
      url: '/echo',
      handler: async (request) => ({ echoed: request.body }),
    });

    ctx.registerRoute({
      method: 'GET',
      url: '/stats',
      handler: async () => ({
        requestCount,
        installDate: await ctx.getStorage('installDate'),
        taskRunCount: (await ctx.getStorage('taskRunCount')) || 0,
      }),
    });
  },

  async onEnable(ctx) {
    // Register WebSocket handler
    ctx.onWebSocketMessage('plugin_example_ping', async (data, clientId) => {
      ctx.sendWebSocketMessage(clientId, {
        type: 'plugin_example_pong',
        timestamp: Date.now(),
      });
    });

    // Schedule a recurring task (every 5 minutes)
    ctx.scheduleTask('*/5 * * * *', async () => {
      const count = (await ctx.getStorage('taskRunCount')) || 0;
      await ctx.setStorage('taskRunCount', count + 1);
      ctx.logger.info(`Task executed (run #${count + 1})`);
    });
  },

  async onDisable(ctx) {
    ctx.logger.info('Plugin disabled');
  },

  async onUnload(ctx) {
    ctx.logger.info('Plugin unloaded');
  },
};
```text

### Real Plugin: Ticketing System

Catalyst ships with a full-featured ticketing plugin that demonstrates advanced usage:

```json
{
  "name": "ticketing-plugin",
  "version": "1.0.0",
  "displayName": "Ticketing System",
  "description": "Full-featured ticketing system with server/user linking",
  "config": {
    "autoCloseDays": { "type": "number", "default": 30 },
    "maxOpenTicketsPerUser": { "type": "number", "default": 20 },
    "defaultPriority": { "type": "string", "default": "medium" },
    "notifyOnAssignment": { "type": "boolean", "default": true }
  }
}
```

This plugin registers custom API routes for CRUD operations on tickets, uses WebSocket for real-time notifications, and stores all data in the plugin's key-value storage.

### Plugin Configuration

Plugins can be configured at runtime via the API:

```bash
# Update plugin configuration
curl -X PUT http://localhost:3000/api/plugins/example-plugin/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "config": {
      "greeting": "Custom greeting!",
      "cronEnabled": false
    }
  }'
```text

Configuration values are persisted to the database and survive plugin reloads.

### Hot Reload

When `PLUGIN_HOT_RELOAD` is not set to `false`, the plugin loader watches the plugins directory with chokidar. When a file changes:

1. The plugin is unloaded (`onUnload`)
2. The module cache is cleared
3. The plugin is reloaded (`onLoad`)
4. If it was previously enabled, it's re-enabled (`onEnable`)

```bash
# Force reload via API
curl -X POST http://localhost:3000/api/plugins/example-plugin/reload \
  -H "Authorization: Bearer $API_KEY"
```

### Plugin Permissions

Plugins declare required permissions in their manifest. The scoped database client enforces these at runtime:

| Permission | Access Granted |
|-----------|---------------|
| `server.read` | Read server list (id, name, status) |
| `server.write` | Write server data |
| `admin.read` | Read admin data |
| `admin.write` | Write admin data |
| `user.read` | Read user list (id, username, email) |

---

## Deployment Automation

### Docker Compose Deployment

```yaml
# docker-compose.yml
version: '3.8'

services:
  catalyst-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: catalyst
      POSTGRES_USER: catalyst
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U catalyst"]
      interval: 10s
      timeout: 5s
      retries: 5

  catalyst-redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - redisdata:/data

  catalyst-backend:
    build: ./catalyst-backend
    environment:
      DATABASE_URL: postgresql://catalyst:${DB_PASSWORD}@catalyst-db:5432/catalyst
      REDIS_URL: redis://catalyst-redis:6379
      FRONTEND_URL: ${FRONTEND_URL:-http://localhost:5173}
      BACKEND_URL: ${BACKEND_URL:-http://localhost:3000}
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost:5173}
      PORT: "3000"
      NODE_ENV: production
      BETTER_AUTH_SECRET: ${AUTH_SECRET}
      WEBHOOK_SECRET: ${WEBHOOK_SECRET}
      SFTP_ENABLED: "true"
      SFTP_PORT: "2022"
    ports:
      - "3000:3000"
      - "2022:2022"
    depends_on:
      catalyst-db:
        condition: service_healthy
      catalyst-redis:
        condition: service_started
    restart: unless-stopped

  catalyst-frontend:
    build: ./catalyst-frontend
    environment:
      VITE_API_URL: ${BACKEND_URL:-http://localhost:3000}
    ports:
      - "5173:80"
    depends_on:
      - catalyst-backend
    restart: unless-stopped

volumes:
  pgdata:
  redisdata:
```text

### Node Deployment Script

Catalyst provides a one-click node deployment system:

1. **Admin generates a deployment token** via `POST /api/nodes/:nodeId/deployment-token`
2. **Admin gets a deploy URL** — `GET /api/deploy/:token?apiKey=...`
3. **Script runs on the node** — installs containerd, downloads the agent, and configures it

```bash
# On the node, run the deploy script
curl -sSL "http://your-catalyst-panel:3000/api/deploy/TOKEN?apiKey=KEY" | bash
```

The deploy script automatically:
- Installs containerd if not present
- Downloads the pre-built agent binary (x86_64 or aarch64)
- Generates `config.toml` with the correct node ID and API key
- Sets up systemd service for the agent

### CI/CD Pipeline Example

```yaml
# .github/workflows/deploy.yml
name: Deploy Catalyst

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy backend
        run: |
          ssh deploy@server << 'EOF'
          cd /opt/catalyst
          docker compose pull catalyst-backend
          docker compose up -d catalyst-backend
          EOF

      - name: Run health check
        run: |
          for i in $(seq 1 30); do
            if curl -sf http://server:3000/health | grep -q '"ok"'; then
              echo "Backend is healthy"
              exit 0
            fi
            sleep 2
          done
          echo "Health check failed"
          exit 1

      - name: Deploy agents
        run: |
          # Deploy to all nodes via API
          API_KEY="${{ secrets.CATALYST_API_KEY }}"
          for NODE_ID in node-1 node-2; do
            echo "Deploying agent to $NODE_ID..."
            # Agent auto-updates on next connection
            curl -sf "http://server:3000/api/nodes/$NODE_ID" \
              -H "Authorization: Bearer $API_KEY" | jq -r '.isOnline'
          done
```text
