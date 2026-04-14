# Catalyst API Automation Guide

## Overview

This guide provides comprehensive examples for automating Catalyst operations via API. These examples are designed for billing panel integrations (WHMCS, Blesta, custom systems), provisioning automation, and user management workflows.

## Table of Contents

1. [Authentication](#authentication)
2. [Server Lifecycle Management](#server-lifecycle-management)
3. [User Management & Access Control](#user-management--access-control)
4. [Billing Panel Integration Examples](#billing-panel-integration-examples)
5. [Monitoring & Status Checks](#monitoring--status-checks)
6. [Backup Management](#backup-management)
7. [Error Handling](#error-handling)
8. [Complete Integration Examples](#complete-integration-examples)

---

## Authentication

All API requests require authentication via API key in the `x-api-key` header.

### Creating an API Key

```bash
# Login as admin
curl -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Create API key for automation (never expires)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -H "Cookie: $(cat cookies.txt)" \
  -d '{
    "name": "Billing Panel Integration",
    "rateLimitEnabled": true,
    "rateLimitMax": 1000,
    "rateLimitTimeWindow": 60000
  }' | jq -r '.data.key'
```

**Note:** Omitting the `expiresIn` field creates a key that never expires, which is recommended for production billing panel integrations.

**Save the returned key securely - it's only shown once!**

### Using the API Key

All subsequent requests use this pattern:

```bash
curl -H "x-api-key: YOUR_API_KEY_HERE" http://localhost:3000/api/endpoint
```

---

## Server Lifecycle Management

### 1. Create a New Server

**Endpoint:** `POST /api/servers`

**Use Case:** Automatically provision a server when a customer purchases a game server package.

```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Customer Server #12345",
    "templateId": "minecraft-template-id",
    "nodeId": "node-1-id",
    "locationId": "location-id",
    "ownerId": "user-id-from-your-system",
    "allocatedMemoryMb": 4096,
    "allocatedCpuCores": 2,
    "allocatedDiskMb": 10240,
    "primaryPort": 25565,
    "networkMode": "bridge"
  }'
```

> **Note:** After creation, the server is in `stopped` state. You must call
> `/install` (to run the install script) and then `/start` to activate it.
> See the [Complete Order Provisioning Flow](#complete-order-provisioning-flow) for the full sequence.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "server-abc123",
    "name": "Customer Server #12345",
    "status": "stopped",
    "uuid": "unique-server-uuid",
    "ownerId": "user-id",
    "nodeId": "node-1-id",
    "templateId": "minecraft-template-id",
    "primaryPort": 25565,
    "createdAt": "2026-02-04T00:00:00.000Z"
  }
}
```

### 2. Start a Server

**Endpoint:** `POST /api/servers/:id/start`

**Use Case:** Activate server after payment received or unsuspension.

```bash
curl -X POST http://localhost:3000/api/servers/server-abc123/start \
  -H "x-api-key: $API_KEY"
```

### 3. Stop a Server

**Endpoint:** `POST /api/servers/:id/stop`

**Use Case:** Graceful shutdown before suspension or maintenance.

```bash
curl -X POST http://localhost:3000/api/servers/server-abc123/stop \
  -H "x-api-key: $API_KEY"
```

### 4. Suspend a Server

**Endpoint:** `POST /api/servers/:id/suspend`

**Use Case:** Suspend server for non-payment or policy violation.

```bash
# Suspend and stop the server
curl -X POST http://localhost:3000/api/servers/server-abc123/suspend \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "reason": "Payment overdue - Invoice #12345",
    "stopServer": true
  }'

# Suspend without stopping (soft suspension)
curl -X POST http://localhost:3000/api/servers/server-abc123/suspend \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "reason": "Account review pending",
    "stopServer": false
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "server-abc123",
    "status": "suspended",
    "suspendedAt": "2026-02-04T00:00:00.000Z",
    "suspensionReason": "Payment overdue - Invoice #12345"
  }
}
```

### 5. Unsuspend a Server

**Endpoint:** `POST /api/servers/:id/unsuspend`

**Use Case:** Restore server after payment received.

```bash
curl -X POST http://localhost:3000/api/servers/server-abc123/unsuspend \
  -H "x-api-key: $API_KEY"
```

### 6. Delete a Server

**Endpoint:** `DELETE /api/servers/:id`

**Use Case:** Terminate server after cancellation or trial expiry.

```bash
curl -X DELETE http://localhost:3000/api/servers/server-abc123 \
  -H "x-api-key: $API_KEY"
```

### 7. Update Server Resources

**Endpoint:** `PUT /api/servers/:id`

**Use Case:** Upgrade/downgrade server resources when customer changes plan.

> **Important:** The server must be in `stopped` state before resource changes.

```bash
curl -X PUT http://localhost:3000/api/servers/server-abc123 \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "allocatedMemoryMb": 8192,
    "allocatedCpuCores": 4,
    "allocatedDiskMb": 20480
  }'
```

### Bulk Operations

For billing panels managing many servers, use the bulk endpoints:

**Bulk Suspend:**
```bash
curl -X POST http://localhost:3000/api/servers/bulk/suspend \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "serverIds": ["server-1", "server-2", "server-3"],
    "reason": "Payment overdue"
  }'
```

**Bulk Unsuspend:**
```bash
curl -X POST http://localhost:3000/api/servers/bulk/unsuspend \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "serverIds": ["server-1", "server-2", "server-3"]
  }'
```

**Bulk Delete:**
```bash
curl -X DELETE http://localhost:3000/api/servers/bulk \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "serverIds": ["server-1", "server-2"]
  }'
```

**Bulk Status Check:**
```bash
curl -X POST http://localhost:3000/api/servers/bulk/status \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "serverIds": ["server-1", "server-2", "server-3"]
  }'
```

### Webhooks

Configure outbound webhooks to receive real-time notifications for server lifecycle events.

**Setup (env var):**
```env
WEBHOOK_URLS=https://your-billing-panel.com/webhooks/catalyst
WEBHOOK_SECRET=your-shared-secret
```

**Events dispatched:**
- `server.created` — New server provisioned
- `server.deleted` — Server terminated
- `server.suspended` — Server suspended (includes reason)
- `server.unsuspended` — Server unsuspended
- `server.bulk_suspended` — Multiple servers suspended
- `server.bulk_deleted` — Multiple servers deleted

**Webhook payload example:**
```json
{
  "event": "server.suspended",
  "serverId": "server-abc123",
  "serverName": "Customer Server",
  "userId": "admin-id",
  "timestamp": "2026-04-14T12:00:00.000Z",
  "data": { "reason": "Payment overdue" }
}
```

**Signature verification:** Each webhook includes an `X-Webhook-Signature` header with an HMAC-SHA256 signature using the `WEBHOOK_SECRET`.

---

## User Management & Access Control

### 1. Create a New User

**Endpoint:** `POST /api/auth/sign-up`

**Use Case:** Automatically create user account when customer registers.

```bash
curl -X POST http://localhost:3000/api/auth/sign-up \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{
    "email": "customer@example.com",
    "password": "SecurePassword123!",
    "username": "customer_12345",
    "name": "John Doe"
  }'
```

### 2. Grant Server Access to User

**Endpoint:** `POST /api/servers/:serverId/access`

**Use Case:** Give additional users access to a server (e.g., team members).

```bash
curl -X POST http://localhost:3000/api/servers/server-abc123/access \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "userId": "user-456",
    "permissions": [
      "server.start",
      "server.stop",
      "server.restart",
      "console.read",
      "console.write",
      "file.read"
    ]
  }'
```

**Common Permission Sets:**

**View-Only Access:**
```json
["server.view", "console.read", "file.read"]
```

**Basic Management:**
```json
["server.start", "server.stop", "server.restart", "console.read", "console.write"]
```

**Full Access (except deletion):**
```json
[
  "server.start", "server.stop", "server.restart",
  "console.read", "console.write",
  "file.read", "file.write", "file.delete",
  "backup.create", "backup.restore"
]
```

### 3. Revoke Server Access

**Endpoint:** `DELETE /api/servers/:serverId/access/:userId`

**Use Case:** Remove user access when they leave team or subscription ends.

```bash
curl -X DELETE http://localhost:3000/api/servers/server-abc123/access/user-456 \
  -H "x-api-key: $API_KEY"
```

### 4. List User's Servers

**Endpoint:** `GET /api/servers?userId=:userId`

**Use Case:** Display customer's servers in billing panel client area.

```bash
curl -H "x-api-key: $API_KEY" \
  "http://localhost:3000/api/servers?userId=user-123"
```

---

## Billing Panel Integration Examples

### Complete Order Provisioning Flow

This example shows a complete workflow for provisioning a game server from order to activation.

#### Step 1: Customer Orders Server

```javascript
// Node.js example - WHMCS/Blesta hook
const axios = require('axios');

const CATALYST_API = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'x-api-key': process.env.CATALYST_API_KEY
  }
});

async function provisionGameServer(order) {
  try {
    // 1. Create the server
    const serverResponse = await CATALYST_API.post('/api/servers', {
      name: `${order.customerName}'s ${order.game} Server`,
      templateId: order.gameTemplateId,
      nodeId: await selectOptimalNode(order.region),
      ownerId: order.customerId,
      allocatedMemoryMb: order.package.memory,
      allocatedCpuCores: order.package.cpu,
      allocatedDiskMb: order.package.disk,
      primaryPort: await allocatePort(order.game),
    });

    const server = serverResponse.data.data;
    
    // 2. Store server ID in your billing system
    await updateOrderInDatabase({
      orderId: order.id,
      catalystServerId: server.id,
      status: 'provisioned'
    });

    // 3. Send welcome email with server details
    await sendWelcomeEmail({
      to: order.customerEmail,
      serverId: server.id,
      serverName: server.name,
      ipAddress: `${server.primaryPort}`,
      loginUrl: `https://panel.example.com/server/${server.id}`
    });

    // 4. Install the server (run install script)
    await CATALYST_API.post(`/api/servers/${server.id}/install`);

    // 5. Start the server
    await CATALYST_API.post(`/api/servers/${server.id}/start`);

    return { success: true, serverId: server.id };
  } catch (error) {
    console.error('Provisioning failed:', error);
    return { success: false, error: error.message };
  }
}

// Helper: Select node with most available resources
async function selectOptimalNode(region) {
  const nodesResponse = await CATALYST_API.get('/api/nodes');
  const nodes = nodesResponse.data.data;
  
  // Filter by region and sort by available resources
  const optimalNode = nodes
    .filter(n => n.region === region && n.status === 'online')
    .sort((a, b) => b.availableMemoryMb - a.availableMemoryMb)[0];
    
  return optimalNode.id;
}

// Helper: Allocate available port for game type
async function allocatePort(gameType) {
  // Implementation depends on your port management strategy
  const defaultPorts = {
    'minecraft': 25565,
    'rust': 28015,
    'ark': 27015,
    'valheim': 2456
  };
  
  return defaultPorts[gameType] || 25565;
}
```

### Suspension/Unsuspension Flow

```javascript
// Handle invoice payment status changes

async function handleInvoiceStatusChange(invoice) {
  const server = await getServerByInvoiceId(invoice.id);
  
  if (invoice.status === 'paid') {
    // Payment received - unsuspend server
    await CATALYST_API.post(`/api/servers/${server.catalystId}/unsuspend`);
    
    // Notify customer
    await sendEmail({
      to: invoice.customerEmail,
      subject: 'Server Reactivated',
      body: `Your server "${server.name}" has been reactivated.`
    });
    
  } else if (invoice.status === 'overdue' && invoice.daysOverdue >= 3) {
    // Payment overdue - suspend server
    await CATALYST_API.post(`/api/servers/${server.catalystId}/suspend`, {
      reason: `Payment overdue - Invoice #${invoice.id}`,
      stopServer: true
    });
    
    // Notify customer
    await sendEmail({
      to: invoice.customerEmail,
      subject: 'Server Suspended - Payment Required',
      body: `Your server has been suspended due to overdue payment. Invoice #${invoice.id}`
    });
  }
}
```

### Package Upgrade/Downgrade Flow

```javascript
async function handlePackageChange(serviceId, newPackage) {
  const service = await getServiceById(serviceId);
  
  // Get current server details
  const serverResponse = await CATALYST_API.get(`/api/servers/${service.catalystServerId}`);
  const server = serverResponse.data.data;
  
  // Stop server before resource change
  if (server.status === 'running') {
    await CATALYST_API.post(`/api/servers/${server.id}/stop`);
    
    // Wait for server to stop
    await waitForStatus(server.id, 'stopped', 30000);
  }
  
  // Update resources
  await CATALYST_API.put(`/api/servers/${server.id}`, {
    allocatedMemoryMb: newPackage.memory,
    allocatedCpuCores: newPackage.cpu,
    allocatedDiskMb: newPackage.disk
  });
  
  // Restart server
  await CATALYST_API.post(`/api/servers/${server.id}/start`);
  
  // Notify customer
  await sendEmail({
    to: service.customerEmail,
    subject: 'Server Resources Updated',
    body: `Your server has been upgraded to ${newPackage.name}.`
  });
}

// Helper function to wait for server status
async function waitForStatus(serverId, expectedStatus, timeout = 30000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const response = await CATALYST_API.get(`/api/servers/${serverId}`);
    const server = response.data.data;
    
    if (server.status === expectedStatus) {
      return true;
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
  }
  
  throw new Error(`Server did not reach status ${expectedStatus} within ${timeout}ms`);
}
```

### Cancellation/Termination Flow

```javascript
async function handleServiceCancellation(serviceId, immediate = false) {
  const service = await getServiceById(serviceId);
  
  if (immediate) {
    // Immediate termination
    
    // 1. Create final backup
    await CATALYST_API.post(`/api/servers/${service.catalystServerId}/backups`, {
      name: `Final backup before termination - ${new Date().toISOString()}`
    });
    
    // 2. Stop server
    await CATALYST_API.post(`/api/servers/${service.catalystServerId}/stop`);
    
    // 3. Wait a moment for any cleanup
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 4. Delete server
    await CATALYST_API.delete(`/api/servers/${service.catalystServerId}`);
    
    // 5. Update billing system
    await updateServiceStatus(serviceId, 'terminated');
    
    // 6. Notify customer
    await sendEmail({
      to: service.customerEmail,
      subject: 'Server Terminated',
      body: 'Your server has been terminated. A final backup is available for 30 days.'
    });
    
  } else {
    // End of billing period termination
    
    // Suspend server until billing period ends
    await CATALYST_API.post(`/api/servers/${service.catalystServerId}/suspend`, {
      reason: 'Service cancelled - will be deleted at end of billing period',
      stopServer: true
    });
    
    // Schedule deletion for end of period
    await scheduleTask({
      executeAt: service.nextDueDate,
      task: 'delete_server',
      serverId: service.catalystServerId
    });
  }
}
```

---

## Monitoring & Status Checks

### Get Server Status

```bash
curl -H "x-api-key: $API_KEY" \
  http://localhost:3000/api/servers/server-abc123
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "server-abc123",
    "name": "Customer Server",
    "status": "running",
    "currentMemoryUsageMb": 2048,
    "currentCpuUsagePercent": 45.2,
    "currentDiskUsageMb": 5120,
    "playerCount": 12,
    "uptime": 3600,
    "lastStartedAt": "2026-02-04T00:00:00.000Z"
  }
}
```

### Bulk Status Check

**Use Case:** Update status for all servers in billing panel.

```javascript
async function updateAllServerStatuses() {
  const serversResponse = await CATALYST_API.get('/api/servers');
  const servers = serversResponse.data.data;
  
  for (const server of servers) {
    await updateServerStatusInBillingPanel({
      serverId: server.id,
      status: server.status,
      playerCount: server.playerCount,
      uptime: server.uptime,
      memoryUsage: server.currentMemoryUsageMb,
      cpuUsage: server.currentCpuUsagePercent
    });
  }
}

// Run every 5 minutes
setInterval(updateAllServerStatuses, 5 * 60 * 1000);
```

### Resource Usage Monitoring

```javascript
async function checkResourceUsage(serverId) {
  const response = await CATALYST_API.get(`/api/servers/${serverId}`);
  const server = response.data.data;
  
  // Check if customer is approaching limits
  const memoryUsagePercent = (server.currentMemoryUsageMb / server.allocatedMemoryMb) * 100;
  const diskUsagePercent = (server.currentDiskUsageMb / server.allocatedDiskMb) * 100;
  
  if (memoryUsagePercent > 90) {
    await sendAlert({
      serverId: server.id,
      type: 'memory_high',
      message: `Server using ${memoryUsagePercent.toFixed(1)}% of allocated memory`,
      suggestion: 'Consider upgrading to a higher tier package'
    });
  }
  
  if (diskUsagePercent > 85) {
    await sendAlert({
      serverId: server.id,
      type: 'disk_high',
      message: `Server using ${diskUsagePercent.toFixed(1)}% of allocated disk space`,
      suggestion: 'Delete old backups or upgrade storage'
    });
  }
  
  return {
    memoryUsagePercent,
    diskUsagePercent,
    cpuUsagePercent: server.currentCpuUsagePercent
  };
}
```

---

## Backup Management

### Create Backup

**Endpoint:** `POST /api/servers/:id/backups`

```bash
curl -X POST http://localhost:3000/api/servers/server-abc123/backups \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "name": "Auto backup - Pre-update",
    "description": "Automatic backup before server update"
  }'
```

### List Backups

```bash
curl -H "x-api-key: $API_KEY" \
  http://localhost:3000/api/servers/server-abc123/backups
```

### Restore Backup

**Endpoint:** `POST /api/backups/:backupId/restore`

```bash
curl -X POST http://localhost:3000/api/backups/backup-123/restore \
  -H "x-api-key: $API_KEY"
```

### Automated Backup Schedule

```javascript
// Create daily backups for all active servers
async function createDailyBackups() {
  const serversResponse = await CATALYST_API.get('/api/servers');
  const activeServers = serversResponse.data.data.filter(s => 
    s.status !== 'suspended' && s.status !== 'terminated'
  );
  
  for (const server of activeServers) {
    try {
      await CATALYST_API.post(`/api/servers/${server.id}/backups`, {
        name: `Daily Backup - ${new Date().toISOString().split('T')[0]}`,
        description: 'Automated daily backup'
      });
      
      console.log(`✓ Created backup for ${server.name}`);
    } catch (error) {
      console.error(`✗ Failed to backup ${server.name}:`, error.message);
    }
  }
  
  // Cleanup old backups (keep last 7 days)
  await cleanupOldBackups(7);
}

// Run daily at 3 AM
const CronJob = require('cron').CronJob;
new CronJob('0 3 * * *', createDailyBackups, null, true);
```

---

## Error Handling

### Proper Error Handling Pattern

```javascript
async function safeApiCall(apiFunction, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await apiFunction();
    } catch (error) {
      // Log the error
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      // Check if it's a rate limit error
      if (error.response?.status === 429) {
        const retryAfter = error.response.data.retryAfter || 60;
        console.log(`Rate limited. Waiting ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      
      // Check if it's a temporary server error
      if (error.response?.status >= 500) {
        console.log('Server error. Retrying in 5s...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      
      // Check if it's an authentication error
      if (error.response?.status === 401) {
        console.error('Authentication failed. Check API key.');
        throw new Error('Invalid API key');
      }
      
      // Check if it's a client error (don't retry)
      if (error.response?.status >= 400 && error.response?.status < 500) {
        throw error;
      }
      
      // Last attempt failed
      if (attempt === retries) {
        throw error;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

// Usage
try {
  const result = await safeApiCall(() => 
    CATALYST_API.post(`/api/servers/${serverId}/start`)
  );
  console.log('Server started successfully');
} catch (error) {
  console.error('Failed to start server after retries:', error.message);
  // Notify admin or log for manual intervention
}
```

### Common Error Codes

| Status | Meaning | Action |
|--------|---------|--------|
| 400 | Bad Request | Check request parameters |
| 401 | Unauthorized | Verify API key |
| 403 | Forbidden | Check permissions |
| 404 | Not Found | Verify server/resource ID |
| 409 | Conflict | Server in wrong state for operation |
| 429 | Rate Limited | Wait and retry (check retryAfter) |
| 500 | Server Error | Retry after delay |

---

## Complete Integration Examples

### WHMCS Module Hook

```php
<?php
// WHMCS provisioning module for Catalyst

function catalyst_CreateAccount($params) {
    $apiKey = $params['configoption1']; // API key from module settings
    $baseUrl = $params['configoption2']; // Catalyst URL
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $baseUrl . '/api/servers');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey
    ]);
    
    $data = [
        'name' => $params['domain'], // Server name from order
        'templateId' => $params['configoption3'],
        'nodeId' => selectOptimalNode($baseUrl, $apiKey),
        'ownerId' => $params['clientsdetails']['userid'],
        'allocatedMemoryMb' => (int)$params['configoption4'],
        'allocatedCpuCores' => (int)$params['configoption5'],
        'allocatedDiskMb' => (int)$params['configoption6'],
        'primaryPort' => 25565,
    ];
    
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200) {
        $result = json_decode($response, true);
        $serverId = $result['data']['id'];
        
        // Store server ID in WHMCS custom fields
        localAPI('UpdateClientProduct', [
            'serviceid' => $params['serviceid'],
            'customfields' => base64_encode(serialize([
                'Catalyst Server ID' => $serverId
            ]))
        ]);
        
        return 'success';
    } else {
        return 'Failed to create server: ' . $response;
    }
}

function catalyst_SuspendAccount($params) {
    $apiKey = $params['configoption1'];
    $baseUrl = $params['configoption2'];
    $serverId = getCatalystServerId($params['serviceid']);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $baseUrl . '/api/servers/' . $serverId . '/suspend');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'reason' => 'Suspended by billing system',
        'stopServer' => true
    ]));
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return ($httpCode === 200) ? 'success' : 'Failed to suspend';
}

function catalyst_UnsuspendAccount($params) {
    $apiKey = $params['configoption1'];
    $baseUrl = $params['configoption2'];
    $serverId = getCatalystServerId($params['serviceid']);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $baseUrl . '/api/servers/' . $serverId . '/unsuspend');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['x-api-key: ' . $apiKey]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return ($httpCode === 200) ? 'success' : 'Failed to unsuspend';
}

function catalyst_TerminateAccount($params) {
    $apiKey = $params['configoption1'];
    $baseUrl = $params['configoption2'];
    $serverId = getCatalystServerId($params['serviceid']);
    
    // Create final backup before deletion
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $baseUrl . '/api/servers/' . $serverId . '/backups');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'name' => 'Final backup before termination'
    ]));
    curl_exec($ch);
    curl_close($ch);
    
    // Delete server
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $baseUrl . '/api/servers/' . $serverId);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['x-api-key: ' . $apiKey]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return ($httpCode === 200) ? 'success' : 'Failed to terminate';
}
?>
```

### Python Billing Integration

```python
import requests
import os
from datetime import datetime
import time

class CatalystBillingIntegration:
    def __init__(self, api_key, base_url):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({'x-api-key': api_key})
    
    def provision_server(self, customer_id, package):
        """Provision a new game server for a customer"""
        
        # Select optimal node
        node_id = self._select_optimal_node(package.get('region'))
        
        # Create server
        response = self.session.post(f'{self.base_url}/api/servers', json={
            'name': f"{customer_id}'s {package['game']} Server",
            'templateId': package['template_id'],
            'nodeId': node_id,
            'ownerId': customer_id,
            'allocatedMemoryMb': package['memory'],
            'allocatedCpuCores': package['cpu'],
            'allocatedDiskMb': package['disk'],
            'primaryPort': self._get_default_port(package['game']),
        })
        
        if response.status_code == 200:
            server = response.json()['data']
            return {'success': True, 'server_id': server['id']}
        else:
            return {'success': False, 'error': response.text}
    
    def suspend_for_nonpayment(self, server_id, invoice_id):
        """Suspend server due to non-payment"""
        
        response = self.session.post(
            f'{self.base_url}/api/servers/{server_id}/suspend',
            json={
                'reason': f'Payment overdue - Invoice #{invoice_id}',
                'stopServer': True
            }
        )
        
        return response.status_code == 200
    
    def unsuspend_after_payment(self, server_id):
        """Unsuspend server after payment received"""
        
        response = self.session.post(
            f'{self.base_url}/api/servers/{server_id}/unsuspend'
        )
        
        if response.status_code == 200:
            # Optionally start the server
            self.session.post(f'{self.base_url}/api/servers/{server_id}/start')
            return True
        
        return False
    
    def upgrade_package(self, server_id, new_package):
        """Upgrade server to new package"""
        
        # Get current server status
        server = self._get_server(server_id)
        
        # Stop server if running
        if server['status'] == 'running':
            self.session.post(f'{self.base_url}/api/servers/{server_id}/stop')
            self._wait_for_status(server_id, 'stopped')
        
        # Update resources
        response = self.session.put(
            f'{self.base_url}/api/servers/{server_id}',
            json={
                'allocatedMemoryMb': new_package['memory'],
                'allocatedCpuCores': new_package['cpu'],
                'allocatedDiskMb': new_package['disk']
            }
        )
        
        # Restart server
        if response.status_code == 200:
            self.session.post(f'{self.base_url}/api/servers/{server_id}/start')
            return True
        
        return False
    
    def terminate_server(self, server_id, create_backup=True):
        """Terminate server, optionally creating final backup"""
        
        if create_backup:
            self.session.post(
                f'{self.base_url}/api/servers/{server_id}/backups',
                json={'name': f'Final backup - {datetime.now().isoformat()}'}
            )
            time.sleep(5)  # Wait for backup to initiate
        
        # Stop and delete
        self.session.post(f'{self.base_url}/api/servers/{server_id}/stop')
        time.sleep(3)
        
        response = self.session.delete(f'{self.base_url}/api/servers/{server_id}')
        return response.status_code == 200
    
    def get_server_metrics(self, server_id):
        """Get current server resource usage"""
        
        response = self.session.get(f'{self.base_url}/api/servers/{server_id}')
        
        if response.status_code == 200:
            server = response.json()['data']
            return {
                'status': server['status'],
                'memory_usage_percent': (server['currentMemoryUsageMb'] / server['allocatedMemoryMb']) * 100,
                'disk_usage_percent': (server['currentDiskUsageMb'] / server['allocatedDiskMb']) * 100,
                'cpu_usage_percent': server['currentCpuUsagePercent'],
                'player_count': server.get('playerCount', 0),
                'uptime': server.get('uptime', 0)
            }
        
        return None
    
    def _select_optimal_node(self, region=None):
        """Select node with most available resources"""
        
        response = self.session.get(f'{self.base_url}/api/nodes')
        nodes = response.json()['data']
        
        # Filter by region if specified
        if region:
            nodes = [n for n in nodes if n.get('region') == region]
        
        # Filter online nodes only
        nodes = [n for n in nodes if n['status'] == 'online']
        
        # Sort by available memory
        nodes.sort(key=lambda n: n['availableMemoryMb'], reverse=True)
        
        return nodes[0]['id'] if nodes else None
    
    def _get_server(self, server_id):
        """Get server details"""
        response = self.session.get(f'{self.base_url}/api/servers/{server_id}')
        return response.json()['data']
    
    def _wait_for_status(self, server_id, expected_status, timeout=30):
        """Wait for server to reach expected status"""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            server = self._get_server(server_id)
            if server['status'] == expected_status:
                return True
            time.sleep(2)
        
        return False
    
    def _get_default_port(self, game):
        """Get default port for game type"""
        ports = {
            'minecraft': 25565,
            'rust': 28015,
            'ark': 27015,
            'valheim': 2456,
            'csgo': 27015
        }
        return ports.get(game, 25565)


# Usage example
if __name__ == '__main__':
    catalyst = CatalystBillingIntegration(
        api_key=os.environ['CATALYST_API_KEY'],
        base_url='http://localhost:3000'
    )
    
    # Provision new server
    result = catalyst.provision_server(
        customer_id='customer-123',
        package={
            'game': 'minecraft',
            'template_id': 'minecraft-vanilla-template',
            'memory': 4096,
            'cpu': 2,
            'disk': 10240,
            'region': 'us-east'
        }
    )
    
    if result['success']:
        print(f"✓ Server provisioned: {result['server_id']}")
    else:
        print(f"✗ Provisioning failed: {result['error']}")
```

---

## Best Practices

### 1. Always Use Retry Logic

Network requests can fail temporarily. Always implement retry logic with exponential backoff.

### 2. Store Server IDs Properly

Store Catalyst server IDs in your billing system database to maintain the relationship between orders and servers.

### 3. Create Backups Before Major Operations

Before upgrades, migrations, or terminations, always create a backup.

### 4. Handle Webhooks (Future)

Consider implementing webhooks for real-time status updates instead of polling.

### 5. Rate Limit Your Integration

Don't exceed the API key rate limits. Batch operations when possible.

### 6. Log All API Calls

Keep detailed logs of all API interactions for troubleshooting and audit purposes.

### 7. Validate Before Deletion

Always confirm server ownership before allowing deletion operations.

### 8. Use Environment Variables

Never hardcode API keys. Use environment variables or secret management systems.

---

## Security Considerations

1. **API Key Storage**: Store API keys securely, never in version control
2. **HTTPS Only**: Always use HTTPS in production
3. **Validate Input**: Sanitize all customer input before passing to API
4. **Audit Logging**: Log all provisioning/termination actions
5. **Rate Limiting**: Respect API rate limits to avoid service disruption
6. **Error Messages**: Don't expose sensitive error details to customers
7. **Access Control**: Ensure users can only manage their own servers

---

## Support & Troubleshooting

### Common Issues

**Server not starting after provisioning:**
- Check node has sufficient resources
- Verify template ID is valid
- Check server logs via console endpoint

**Suspension not working:**
- Verify server is not already in transitional state
- Check user has permission to suspend
- Review audit logs for details

**Resource updates not applying:**
- Ensure server is stopped before updating
- Verify node has capacity for new allocation
- Check for resource limit constraints

### Getting Help

- API Documentation: `docs/api-keys.md`
- Backend Logs: Check Catalyst backend logs for detailed errors
- Test Scripts: Use `test-apikey-complete.sh` to verify API functionality

---

## Changelog

- **v1.0.0** (2026-02-04): Initial automation documentation
  - Complete server lifecycle examples
  - Billing panel integration patterns
  - WHMCS and Python integration examples
  - Error handling best practices

---

**For complete API reference, see:** `docs/api-keys.md`
