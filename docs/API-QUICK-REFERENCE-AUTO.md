# Catalyst API Quick Reference

> Auto-generated on 2026-04-16

## Base URL
`http://localhost:3000`

## Authentication
```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/endpoint
```

## Common Operations

### Servers
```bash
# List servers
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers

# Create server
curl -X POST http://localhost:3000/api/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"name":"My Server","templateId":"...","nodeId":"...","locationId":"...","allocatedMemoryMb":4096,"allocatedCpuCores":2,"allocatedDiskMb":10240,"primaryPort":25565}'

# Start/Stop/Restart
curl -X POST http://localhost:3000/api/servers/:serverId/start -H "x-api-key: $API_KEY"
curl -X POST http://localhost:3000/api/servers/:serverId/stop -H "x-api-key: $API_KEY"
curl -X POST http://localhost:3000/api/servers/:serverId/restart -H "x-api-key: $API_KEY"

# Suspend/Unsuspend
curl -X POST http://localhost:3000/api/servers/:serverId/suspend \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"reason":"Payment overdue","stopServer":true}'
curl -X POST http://localhost:3000/api/servers/:serverId/unsuspend -H "x-api-key: $API_KEY"
```

### Backups
```bash
# List backups
curl http://localhost:3000/api/servers/:serverId/backups -H "x-api-key: $API_KEY"

# Create backup
curl -X POST http://localhost:3000/api/servers/:serverId/backups \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"name":"My Backup"}'

# Restore backup
curl -X POST http://localhost:3000/api/servers/:serverId/backups/:backupId/restore \
  -H "x-api-key: $API_KEY"
```

### Files
```bash
# List files
curl http://localhost:3000/api/servers/:serverId/files?path=/ -H "x-api-key: $API_KEY"

# Write file
curl -X POST http://localhost:3000/api/servers/:serverId/files/write \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"path":"/server.properties","content":"server-port=25565"}'
```

### Nodes
```bash
# List nodes
curl http://localhost:3000/api/nodes -H "x-api-key: $API_KEY"

# Create node
curl -X POST http://localhost:3000/api/nodes \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"name":"Node 1","fqdn":"node1.example.com","publicAddress":"1.2.3.4","memoryMb":32768,"cpuCores":8,"diskMb":512000}'
```

### Users
```bash
# List users
curl http://localhost:3000/api/admin/users -H "x-api-key: $API_KEY"

# Create user
curl -X POST http://localhost:3000/api/admin/users \
  -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
  -d '{"email":"user@example.com","username":"username","password":"SecureP@ss123!"}'
```

## Error Codes
| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 429 | Rate Limited |
| 500 | Server Error |

## Permissions
| Permission | Description |
|------------|-------------|
| server.read | View servers |
| server.write | Modify servers |
| server.delete | Delete servers |
| server.start | Start servers |
| server.stop | Stop servers |
| file.read | Read files |
| file.write | Write files |
| backup.read | View backups |
| backup.create | Create backups |
| backup.restore | Restore backups |
| console.read | Read console |
| console.write | Send commands |
| admin | Full admin access |

---

*See docs/API-DOCUMENTATION.md for full API reference*
