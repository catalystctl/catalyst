# Usage Examples

Quick-start copy-paste examples for common Catalyst operations. For deep-dive guides, see [automation.md](./automation.md).

---

## Table of Contents

- [Authentication](#authentication)
  - [API Key Auth](#api-key-auth)
  - [Session Cookie Auth](#session-cookie-auth)
  - [Agent Token Auth](#agent-token-auth)
- [Server Operations](#server-operations)
  - [Create a Server](#create-a-server)
  - [List Servers](#list-servers)
  - [Server Details](#server-details)
  - [Power Operations](#power-operations)
  - [Delete a Server](#delete-a-server)
- [Console & WebSockets](#console--websockets)
  - [Terminal Commands](#terminal-commands)
  - [Console Stream (SSE)](#console-stream-sse)
  - [WebSocket Console](#websocket-console)
- [Backups](#backups)
  - [Create a Backup](#create-a-backup)
  - [List Backups](#list-backups)
  - [Restore a Backup](#restore-a-backup)
  - [Delete a Backup](#delete-a-backup)
- [SFTP Access](#sftp-access)
- [Scheduled Tasks](#scheduled-tasks)
- [Webhooks](#webhooks)
  - [Create a Webhook](#create-a-webhook)
  - [Webhook Receiver Examples](#webhook-receiver-examples)
- [File Operations](#file-operations)
  - [Read Files](#read-files)
  - [Write/Update Files](#writeupdate-files)
  - [List Directory](#list-directory)
- [Admin Operations](#admin-operations)
  - [List Users](#list-users)
  - [Create a User](#create-a-user)
  - [List Nodes](#list-nodes)
  - [Deploy a Node](#deploy-a-node)
  - [Server Templates](#server-templates)
- [Full Scripts](#full-scripts)
  - [Python: Bulk Server Deployment](#python-bulk-server-deployment)
  - [Node.js: Server Health Monitor](#nodejs-server-health-monitor)
  - [Bash: Quick Deployment Script](#bash-quick-deployment-script)
- [Error Handling & Rate Limiting](#error-handling--rate-limiting)

---

## Authentication

All API requests require authentication via API key. The same key authenticates REST and WebSocket connections.

### API Key Auth

```bash
# All requests include the API key in the Authorization header
curl -X GET http://localhost:3000/api/servers \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```text

API keys follow the format `catalyst_<base64-encoded-uuid>`.

**Scope:** `catalyst-backend/src/routes/auth.ts`

### Session Cookie Auth

For browser-based or cookie-sensitive integrations:

```bash
# Login and capture the session cookie
curl -c cookies.txt -X POST http://localhost:3000/api/auth/signin/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"securepassword"}'

# Subsequent requests use the cookie
curl -b cookies.txt http://localhost:3000/api/servers
```

### Agent Token Auth

Rust agents authenticate with a long-lived token distinct from user API keys:

```bash
# Agent authentication (used internally by the Rust agent binary)
# Token is configured via AGENT_TOKEN environment variable
curl -X POST http://localhost:3000/api/agent/report \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nodeId":"node_abc","status":"online","cpu":45.2}'
```text

For full agent details, see [agent.md](./agent.md).

---

## Server Operations

### Create a Server

```bash
# Basic server creation
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "name": "my-minecraft-server",
    "description": "Survival server for friends",
    "ownerEmail": "player@example.com",
    "nodeId": "node_abc123",
    "templateId": "tpl_minecraft_paper",
    "containerImage": "ghcr.io/catalystctl/pterodactyl-images-mc-paper:1.21",
    "limits": {
      "cpu": 200,
      "memory": 1024,
      "disk": 5120,
      "swap": 512,
      "io": 500
    }
  }'
```

**Response:**

```json
{
  "id": "srv_xyz789",
  "name": "my-minecraft-server",
  "status": "installing",
  "ownerEmail": "player@example.com",
  "createdAt": "2025-04-01T12:00:00.000Z"
}
```text

### List Servers

```bash
# List all servers for the current user
curl http://localhost:3000/api/servers \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"

# List with pagination
curl "http://localhost:3000/api/servers?page=1&limit=20" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```

### Server Details

```bash
# Get full server details including console, settings, and resources
curl http://localhost:3000/api/servers/srv_xyz789 \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```text

### Power Operations

```bash
# Start
curl -X POST http://localhost:3000/api/servers/srv_xyz789/power \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"signal":"start"}'

# Stop
curl -X POST http://localhost:3000/api/servers/srv_xyz789/power \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"signal":"stop"}'

# Restart
curl -X POST http://localhost:3000/api/servers/srv_xyz789/power \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"signal":"restart"}'

# Kill (force stop)
curl -X POST http://localhost:3000/api/servers/srv_xyz789/power \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"signal":"kill"}'
```

### Delete a Server

```bash
# Delete with confirmation
curl -X DELETE http://localhost:3000/api/servers/srv_xyz789 \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```text

---

## Console & WebSockets

### Terminal Commands

Send a command to the server console:

```bash
curl -X POST http://localhost:3000/api/servers/srv_xyz789/command \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"command":"say Hello from API!"}'
```

### Console Stream (SSE)

Stream real-time console output via Server-Sent Events:

```bash
curl -N http://localhost:3000/api/servers/srv_xyz789/console-stream \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```text

Example output:

```
data: {"type":"output","data":"[12:00:00] [Server thread/INFO]: Starting minecraft server version 1.21\n"}
data: {"type":"output","data":"[12:00:01] [Server thread/INFO]: Preparing level \"world\"\n"}
data: {"type":"output","data":"[12:00:05] [Server thread/INFO]: Done (5.123s)!\n"}
```text

For WebSocket-based console, see [api-reference.md](./api-reference.md).

### WebSocket Console

Connect a WebSocket client for bidirectional console interaction:

```bash
# Example with websocat (install: https://github.com/vi/websocat)
websocat "wss://your-catalyst.example.com/ws?token=catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```

WebSocket message types:

| Type | Direction | Purpose |
|------|-----------|---------|
| `server_control` | Client → Server | Power operations (start, stop, restart, kill) |
| `console_input` | Client → Server | Send console commands |
| `resource_stats` | Server → Client | CPU/memory/disk usage updates |
| `console_output` | Server → Client | Console log lines |

> **Note:** WebSocket connections require TLS. The WebSocket gateway runs at `/ws`.

---

## Backups

### Create a Backup

```bash
curl -X POST http://localhost:3000/api/servers/srv_xyz789/backups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "name": "pre-update-backup",
    "description": "Backup before applying config changes"
  }'
```text

### List Backups

```bash
curl http://localhost:3000/api/servers/srv_xyz789/backups \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```

### Restore a Backup

```bash
curl -X POST http://localhost:3000/api/servers/srv_xyz789/backups/bkp_abc/restore \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"backupId":"bkp_abc"}'
```text

### Delete a Backup

```bash
curl -X DELETE http://localhost:3000/api/servers/srv_xyz789/backups/bkp_abc \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```

For scheduled backup tasks, see [automation.md](./automation.md).

---

## SFTP Access

Access server files via SFTP using the server's SFTP credentials:

```bash
# Connect via SFTP
sftp -P 2022 user_srv_xyz789@your-server.example.com

# Typical session
sftp> ls
Documents  Downloads  config  logs  plugins  world  backup  data

sftp> cd config
sftp> get server.properties

sftp> put my-custom-config.yml

# Upload multiple files
sftp> mput *.yml plugins/
```text

SFTP credentials are available per-server in the admin panel or via the API. For SFTP configuration details, see [admin-guide.md](./admin-guide.md).

---

## Scheduled Tasks

Create a recurring task:

```bash
# Daily restart at 3 AM UTC
curl -X POST http://localhost:3000/api/servers/srv_xyz789/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "name": "Daily Restart",
    "action": "restart",
    "schedule": "0 3 * * *"
  }'

# Hourly backup
curl -X POST http://localhost:3000/api/servers/srv_xyz789/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "name": "Hourly Backup",
    "action": "backup",
    "schedule": "0 * * * *"
  }'
```

For more examples and supported actions, see [automation.md](./automation.md).

---

## Webhooks

### Create a Webhook

```bash
curl -X POST http://localhost:3000/api/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "name": "Server Monitor",
    "url": "https://your-endpoint.example.com/webhook",
    "events": ["server.created", "server.deleted", "server.suspended"],
    "secret": "whsec_your_secret_key"
  }'
```text

### Webhook Receiver Examples

**Python (Flask):**

```python
from flask import Flask, request
import hashlib, hmac, json

app = Flask(__name__)
WEBHOOK_SECRET = "whsec_your_secret_key"

def verify_signature(payload, signature, secret):
    expected = hmac.new(
        secret.encode(), payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

@app.route("/webhook", methods=["POST"])
def handle_webhook():
    signature = request.headers.get("X-Webhook-Signature", "")
    body = request.get_data()

    if not verify_signature(body, signature, WEBHOOK_SECRET):
        return "Invalid signature", 403

    event = json.loads(body)
    event_type = event["event"]

    if event_type == "server.created":
        server_id = event["data"]["id"]
        print(f"New server created: {server_id}")

    elif event_type == "server.deleted":
        server_id = event["data"]["id"]
        print(f"Server deleted: {server_id}")

    elif event_type == "server.suspended":
        server_id = event["data"]["id"]
        print(f"Server suspended: {server_id}")

    return "OK", 200

if __name__ == "__main__":
    app.run(port=8080)
```

**Node.js (Express):**

```javascript
const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.raw({ type: 'application/json' }));

const WEBHOOK_SECRET = 'whsec_your_secret_key';

function verifySignature(payload, signature) {
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const body = req.body;

  if (!verifySignature(body, signature)) {
    return res.status(403).send('Invalid signature');
  }

  const event = JSON.parse(body.toString());

  switch (event.event) {
    case 'server.created':
      console.log(`New server: ${event.data.id}`);
      break;
    case 'server.deleted':
      console.log(`Server deleted: ${event.data.id}`);
      break;
    case 'server.suspended':
      console.log(`Server suspended: ${event.data.id}`);
      break;
  }

  res.sendStatus(200);
});

app.listen(8080);
```text

All available webhook events: `server.created`, `server.deleted`, `server.suspended`, `server.unsuspended`, `server.bulk_suspended`, `server.bulk_deleted`, `user.deleted`. For the full event payload schema, see [api-reference.md](./api-reference.md).

---

## File Operations

### Read Files

```bash
# Read a single file (returns base64-encoded content)
curl http://localhost:3000/api/servers/srv_xyz789/files/read \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"path":"server.properties"}'
```

### Write/Update Files

```bash
# Create or overwrite a file
curl -X POST http://localhost:3000/api/servers/srv_xyz789/files/write \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "path": "config.yml",
    "content": "server-name: My Server\nmax-players: 20"
  }'
```text

### List Directory

```bash
# List files in a directory
curl http://localhost:3000/api/servers/srv_xyz789/files/list \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{"path":"/"}'
```

---

## Admin Operations

> **Scope:** Admin-only endpoints require `admin` role or the `allPermissions` flag. See [admin-guide.md](./admin-guide.md).

### List Users

```bash
# Paginated user list
curl "http://localhost:3000/api/admin/users?page=1&limit=20" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```text

### Create a User

```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "email": "newuser@example.com",
    "username": "newuser",
    "password": "tempPassword123!",
    "role": "user",
    "permissions": ["server.create", "server.manage", "server.console"]
  }'
```

### List Nodes

```bash
curl http://localhost:3000/api/admin/nodes \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
```text

### Deploy a Node

```bash
curl -X POST http://localhost:3000/api/admin/nodes/deploy \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "name": "game-node-03",
    "host": "192.168.1.100",
    "port": 2022,
    "token": "node_token_abc123",
    "labels": {"region": "us-east", "tier": "standard"}
  }'
```

### Server Templates

```bash
# List templates
curl http://localhost:3000/api/admin/templates \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"

# Create a template
curl -X POST http://localhost:3000/api/admin/templates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6" \
  -d '{
    "name": "my-modded-server",
    "dockerImage": "ghcr.io/catalystctl/pterodactyl-images-modded:1.20",
    "startup": "java -Xmx1024M -jar forgeserver.jar",
    "configFiles": {
      "server.properties": "server-port=25565"
    },
    "startCommand": "start",
    "stopCommand": "stop",
    "fileStartupLocation": ".",
    "userFiles": []
  }'
```text

---

## Full Scripts

### Python: Bulk Server Deployment

```python
"""
Deploy multiple server instances from a configuration file.
Usage: python deploy.py servers.json
"""
import json
import requests
import sys
import time

CATALYST_URL = "http://localhost:3000"
API_KEY = "catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

def create_server(name, node_id, template_id, owner_email, limits=None):
    """Create a single server instance."""
    payload = {
        "name": name,
        "nodeId": node_id,
        "templateId": template_id,
        "ownerEmail": owner_email,
        "limits": limits or {
            "cpu": 200, "memory": 1024, "disk": 5120,
            "swap": 512, "io": 500
        }
    }
    resp = requests.post(f"{CATALYST_URL}/api/servers", headers=HEADERS, json=payload)
    if resp.status_code == 201:
        server = resp.json()
        print(f"✅ Created: {name} (id: {server['id']}, status: {server['status']})")
        return server
    else:
        print(f"❌ Failed to create {name}: {resp.status_code} — {resp.text}")
        return None

def main():
    config_file = sys.argv[1]
    with open(config_file) as f:
        servers = json.load(f)

    results = []
    for s in servers:
        result = create_server(
            name=s["name"],
            node_id=s["nodeId"],
            template_id=s["templateId"],
            owner_email=s["ownerEmail"],
            limits=s.get("limits")
        )
        if result:
            results.append(result)
        time.sleep(0.5)  # Rate limit spacing

    print(f"\n📊 Deployed {len(results)}/{len(servers)} servers")

if __name__ == "__main__":
    main()
```

`servers.json` example:

```json
[
  {"name": "mc-survival-1", "nodeId": "node_abc", "templateId": "tpl_mc_paper", "ownerEmail": "user1@example.com"},
  {"name": "mc-survival-2", "nodeId": "node_abc", "templateId": "tpl_mc_paper", "ownerEmail": "user2@example.com"},
  {"name": "creative-1", "nodeId": "node_def", "templateId": "tpl_mc_paper", "ownerEmail": "user3@example.com"}
]
```text

### Node.js: Server Health Monitor

```javascript
/**
 * Monitor server health and alert on anomalies.
 * Polls the servers endpoint and checks for servers stuck in error states.
 */
const https = require('https');

const CATALYST_URL = 'http://localhost:3000';
const API_KEY = 'catalyst_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6';
const POLL_INTERVAL_MS = 30000; // 30 seconds

function listServers() {
  return new Promise((resolve, reject) => {
    const req = https.request(`${CATALYST_URL}/api/servers`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

function monitor() {
  listServers()
    .then(servers => {
      const problemServers = servers.filter(s =>
        ['error', 'install_failed', 'suspended'].includes(s.status)
      );

      if (problemServers.length > 0) {
        console.warn(`⚠️  ${problemServers.length} server(s) in problematic state:`);
        problemServers.forEach(s => {
          console.warn(`   ${s.name}: ${s.status} (node: ${s.nodeId})`);
        });
      } else {
        console.log(`✅ All ${servers.length} servers healthy`);
      }
    })
    .catch(err => console.error('Monitor error:', err.message));
}

// Start monitoring loop
monitor();
setInterval(monitor, POLL_INTERVAL_MS);
```

### Bash: Quick Deployment Script

```bash
#!/usr/bin/env bash
# Quick-deploy multiple servers from stdin (JSONL format)
# Usage: cat servers.jsonl | ./quick-deploy.sh

set -euo pipefail

API_KEY="${CATALYST_API_KEY:?Set CATALYST_API_KEY env variable}"
BASE_URL="${CATALYST_URL:-http://localhost:3000}"
DEPLOY_DELAY=0.5  # seconds between requests

deploy_server() {
  local payload="$1"
  local name
  name=$(echo "$payload" | jq -r '.name')

  local resp
  resp=$(curl -sf -X POST "${BASE_URL}/api/servers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${API_KEY}" \
    -d "$payload")

  local id
  id=$(echo "$resp" | jq -r '.id')
  echo "✅ Deployed: ${name} (${id})"
}

# Read JSONL from stdin, one server per line
while IFS= read -r line; do
  deploy_server "$line"
  sleep "$DEPLOY_DELAY"
done
```text

`servers.jsonl` example (one JSON object per line):

```
{"name":"test-1","nodeId":"node_abc","templateId":"tpl_mc_paper","ownerEmail":"a@example.com","limits":{"cpu":200,"memory":1024,"disk":5120}}
{"name":"test-2","nodeId":"node_abc","templateId":"tpl_mc_paper","ownerEmail":"b@example.com","limits":{"cpu":400,"memory":2048,"disk":10240}}
```text

---

## Error Handling & Rate Limiting

### Common Error Responses

| Status | Meaning | Action |
|--------|---------|--------|
| `401` | Unauthorized — invalid or expired API key | Check key format and validity |
| `403` | Forbidden — insufficient permissions | Verify role/permissions with admin |
| `404` | Not found — server, user, or resource doesn't exist | Check ID/path |
| `409` | Conflict — name already exists or resource in use | Use a different name |
| `422` | Validation error — missing/invalid fields | Check request body against API spec |
| `429` | Rate limited — too many requests | Back off and retry with exponential delay |
| `500` | Internal server error | Check logs, open a GitHub issue |

### Rate Limiting

Rate limits are applied per-API-key. Limits vary by endpoint category:

| Endpoint | Rate Limit | Window |
|----------|-----------|--------|
| Auth (signin/signup) | 5 requests | 60 seconds |
| Server CRUD | 30 requests | 60 seconds |
| Console/Power ops | 20 requests | 60 seconds |
| Admin operations | 60 requests | 60 seconds |

Rate limit headers are returned on every response:

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 27
X-RateLimit-Reset: 1712000060
```text

For complete API details and all endpoints, see [api-reference.md](./api-reference.md).

---

## Plugin Development

### Scaffold a New Plugin

```bash
cd packages/plugin-sdk
npx @catalyst/plugin-sdk create my-plugin --template fullstack
```

### Backend Plugin Example

```javascript
// backend/index.js
export default {
  /**
   * Called when the plugin is loaded (before the server starts).
   * Register your routes here.
   */
  async onLoad(ctx) {
    ctx.logger.info('My plugin loaded');

    // Register a simple GET endpoint
    ctx.registerRoute({
      method: 'GET',
      url: '/hello',
      handler: async (request, reply) => {
        return {
          success: true,
          message: 'Hello from my plugin!',
          timestamp: new Date().toISOString(),
        };
      },
    });

    // Register a POST endpoint that echoes the body
    ctx.registerRoute({
      method: 'POST',
      url: '/echo',
      handler: async (request, reply) => {
        return {
          success: true,
          echoed: request.body,
          timestamp: new Date().toISOString(),
        };
      },
    });

    // Register a route that uses persistent storage
    ctx.registerRoute({
      method: 'GET',
      url: '/stats',
      handler: async (request, reply) => {
        const installed = await ctx.getStorage('installDate');
        const count = (await ctx.getStorage('requestCount')) || 0;
        return {
          success: true,
          stats: {
            installedSince: installed,
            totalRequests: count,
          },
        };
      },
    });
  },

  /**
   * Called when the plugin is enabled.
   * Start scheduled tasks, register WebSocket handlers, etc.
   */
  async onEnable(ctx) {
    ctx.logger.info('My plugin enabled');

    // Register a WebSocket message handler
    ctx.onWebSocketMessage('ping', async (data, clientId) => {
      ctx.sendWebSocketMessage(clientId, {
        type: 'pong',
        timestamp: new Date().toISOString(),
      });
    });

    // Schedule a task that runs every 5 minutes
    ctx.scheduleTask('*/5 * * * *', async () => {
      const count = (await ctx.getStorage('requestCount')) || 0;
      await ctx.setStorage('requestCount', count + 1);
      ctx.logger.info('Scheduled task executed');
    });

    // Listen to Catalyst events
    ctx.on('server:started', async (data) => {
      ctx.logger.info(`Server ${data.serverId} started`);
    });

    ctx.on('server:stopped', async (data) => {
      ctx.logger.info(`Server ${data.serverId} stopped`);
    });
  },

  /**
   * Called when the plugin is disabled.
   * Clean up resources.
   */
  async onDisable(ctx) {
    ctx.logger.info('My plugin disabled');
  },

  /**
   * Called when the plugin is unloaded.
   * Final cleanup.
   */
  async onUnload(ctx) {
    ctx.logger.info('My plugin unloaded');
  },
};
```

### Frontend Plugin Example

```typescript
// frontend/index.ts
import { AdminTab, ServerTab } from './components';

export const tabs = [
  {
    id: 'my-plugin-admin',
    label: 'My Plugin',
    icon: 'Puzzle',
    component: AdminTab,
    location: 'admin',
    order: 100,
    requiredPermissions: ['admin.read'],
  },
  {
    id: 'my-plugin-server',
    label: 'Plugin Panel',
    icon: 'Zap',
    component: ServerTab,
    location: 'server',
    order: 100,
    requiredPermissions: ['server.read'],
  },
];
```

```tsx
// frontend/components.tsx
import React from 'react';

export function AdminTab() {
  const [stats, setStats] = React.useState<any>(null);

  React.useEffect(() => {
    fetch('/api/plugins/my-plugin/stats')
      .then(r => r.json())
      .then(data => setStats(data.stats));
  }, []);

  return (
    <div>
      <h2>My Plugin Admin Tab</h2>
      {stats && (
        <div>
          <p>Installed since: {stats.installedSince}</p>
          <p>Total requests: {stats.totalRequests}</p>
        </div>
      )}
    </div>
  );
}

export function ServerTab({ serverId }: { serverId: string }) {
  const [message, setMessage] = React.useState('');

  const handleEcho = async () => {
    const res = await fetch('/api/plugins/my-plugin/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverId, message }),
    });
    const data = await res.json();
    alert(JSON.stringify(data.echoed, null, 2));
  };

  return (
    <div>
      <h2>Server: {serverId}</h2>
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type a message"
      />
      <button onClick={handleEcho}>Echo</button>
    </div>
  );
}
```

### Plugin Manifest

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "description": "A demonstration plugin",
  "author": "Your Name",
  "catalystVersion": ">=1.0.0",
  "permissions": [
    "server.read",
    "admin.read"
  ],
  "backend": {
    "entry": "backend/index.js"
  },
  "frontend": {
    "entry": "frontend/index.ts"
  },
  "config": {
    "greeting": {
      "type": "string",
      "default": "Hello!",
      "description": "Greeting message"
    }
  }
}
```

### SDK Typed Collections

```typescript
// Using the SDK's typed collection helper
import { createTypedCollection } from '@catalyst/plugin-sdk';

interface MyData {
  _id?: string;
  _createdAt?: string;
  _updatedAt?: string;
  serverId: string;
  value: number;
}

// In onLoad or onEnable:
const rawCollection = ctx.collection('my_data');
const myData = createTypedCollection<MyData>('my_data', rawCollection);

// Type-safe operations
await myData.insert({ serverId: 'srv_123', value: 42 });
const results = await myData.find({ serverId: 'srv_123' });
await myData.update({ _id: results[0]._id }, { $set: { value: 100 } });
```

### SDK Config Definitions

```typescript
import { defineConfig, configField } from '@catalyst/plugin-sdk/config';

const config = defineConfig({
  apiKey: configField({
    type: 'string',
    default: '',
    description: 'API key for external service',
  }),
  maxItems: configField({
    type: 'number',
    default: 100,
    min: 1,
    max: 1000,
    description: 'Maximum number of items to process',
  }),
  priority: configField({
    type: 'select',
    default: 'medium',
    options: [
      { label: 'Critical', value: 'critical' },
      { label: 'High', value: 'high' },
      { label: 'Medium', value: 'medium' },
      { label: 'Low', value: 'low' },
    ],
  }),
});
```

### Testing Plugins

```typescript
import { createTestPlugin, createMockContext } from '@catalyst/plugin-sdk/testing';

// Create a mock context
const mockContext = createMockContext();

// Create a test harness
const harness = createTestPlugin(myPlugin, manifest, config);
const loaded = await harness.load();

// Test lifecycle
await harness.enable();
await harness.disable();
await harness.unload();
```

---

> **See also:** [automation.md](./automation.md) for deep-dive automation, webhook patterns, and bulk operations. [plugins.md](./plugins.md) for comprehensive plugin documentation. For initial server setup, see [getting-started.md](./getting-started.md).
