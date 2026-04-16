#!/usr/bin/env bun
/**
 * API Quick Reference Generator
 * 
 * Generates a quick reference markdown document from route definitions.
 * Run: bun scripts/generate-api-docs.ts
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(__dirname, '../src/routes');
const outDir = resolve(__dirname, '../../docs');

interface Route {
  method: string;
  path: string;
  file: string;
}

const PREFIXES: Record<string, string> = {
  'auth.ts': '/api/auth',
  'nodes.ts': '/api/nodes',
  'servers.ts': '/api/servers',
  'templates.ts': '/api/templates',
  'nests.ts': '/api/nests',
  'metrics.ts': '/api',
  'backups.ts': '/api/servers',
  'admin.ts': '/api/admin',
  'roles.ts': '/api/roles',
  'tasks.ts': '/api/servers',
  'bulk-servers.ts': '/api/servers',
  'admin-events.ts': '/api/admin/events',
  'alerts.ts': '/api',
  'dashboard.ts': '/api/dashboard',
  'api-keys.ts': '/api',
  'plugins.ts': '/api/plugins',
  'migration.ts': '/api/admin/migration',
  'console-stream.ts': '/api/servers',
  'sse-events.ts': '/api/servers',
  'metrics-stream.ts': '/api/servers',
  'file-tunnel.ts': '/api/servers',
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function parseRoutes(): Route[] {
  const routes: Route[] = [];
  const files = readdirSync(routesDir).filter(f => f.endsWith('.ts'));
  
  for (const file of files) {
    const content = readFileSync(resolve(routesDir, file), 'utf-8');
    const lines = content.split('\n');
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      
      let methodMatch = null;
      for (const method of METHODS) {
        const pattern = new RegExp(`(?:await\\s+)?app\\.${method}\\s*\\(`);
        if (pattern.test(line)) {
          methodMatch = method.toUpperCase();
          break;
        }
      }
      
      if (methodMatch) {
        let path = '';
        let j = i;
        
        while (j < Math.min(i + 3, lines.length)) {
          const pathMatch = lines[j].match(/["']([^"']+)["']/);
          if (pathMatch && !pathMatch[1].includes('schema') && !pathMatch[1].includes('description')) {
            path = pathMatch[1];
            break;
          }
          j++;
        }
        
        if (path && path.startsWith('/')) {
          routes.push({
            method: methodMatch,
            path,
            file,
          });
        }
        i = j + 1;
      } else {
        i++;
      }
    }
  }
  
  return routes;
}

function getFullPath(file: string, path: string): string {
  return `${PREFIXES[file] || '/api'}${path}`;
}

// Group routes by category
function groupByCategory(routes: Route[]): Record<string, Route[]> {
  return routes.reduce((acc, route) => {
    const category = route.file.replace('.ts', '');
    if (!acc[category]) acc[category] = [];
    acc[category].push(route);
    return acc;
  }, {} as Record<string, Route[]>);
}

// Main execution
const routes = parseRoutes();
const byCategory = groupByCategory(routes);

// Generate markdown
const md = `# Catalyst API Quick Reference

> Auto-generated on ${new Date().toISOString().split('T')[0]}

## Authentication

\`\`\`bash
export API_KEY="your_catalyst_api_key_here"

# All requests
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/endpoint
\`\`\`

---

## Server Management

### List Servers
\`\`\`bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers
\`\`\`

### Create Server
\`\`\`bash
curl -X POST http://localhost:3000/api/servers \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $API_KEY" \\
  -d '{
    "name": "My Server",
    "templateId": "template-id",
    "nodeId": "node-id",
    "locationId": "location-id",
    "allocatedMemoryMb": 4096,
    "allocatedCpuCores": 2,
    "allocatedDiskMb": 10240,
    "primaryPort": 25565
  }'
\`\`\`

### Server Power Actions
\`\`\`bash
# Start
curl -X POST http://localhost:3000/api/servers/:serverId/start \\
  -H "x-api-key: $API_KEY"

# Stop
curl -X POST http://localhost:3000/api/servers/:serverId/stop \\
  -H "x-api-key: $API_KEY"

# Restart
curl -X POST http://localhost:3000/api/servers/:serverId/restart \\
  -H "x-api-key: $API_KEY"
\`\`\`

### Suspend/Unsuspend
\`\`\`bash
# Suspend (for non-payment)
curl -X POST http://localhost:3000/api/servers/:serverId/suspend \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $API_KEY" \\
  -d '{"reason": "Payment overdue", "stopServer": true}'

# Unsuspend
curl -X POST http://localhost:3000/api/servers/:serverId/unsuspend \\
  -H "x-api-key: $API_KEY"
\`\`\`

---

## Node Management

### List Nodes
\`\`\`bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/nodes
\`\`\`

### Create Node
\`\`\`bash
curl -X POST http://localhost:3000/api/nodes \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $API_KEY" \\
  -d '{
    "name": "Node 1",
    "fqdn": "node1.example.com",
    "publicAddress": "1.2.3.4",
    "memoryMb": 32768,
    "cpuCores": 8,
    "diskMb": 512000
  }'
\`\`\`

---

## Templates

### List Templates
\`\`\`bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/templates
\`\`\`

### Create Template
\`\`\`bash
curl -X POST http://localhost:3000/api/templates \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $API_KEY" \\
  -d '{
    "name": "Minecraft",
    "nestId": "nest-id",
    "description": "Minecraft Java server"
  }'
\`\`\`

---

## User Management

### List Users
\`\`\`bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/admin/users
\`\`\`

### Create User
\`\`\`bash
curl -X POST http://localhost:3000/api/admin/users \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $API_KEY" \\
  -d '{
    "email": "user@example.com",
    "username": "username",
    "password": "SecureP@ss123!"
  }'
\`\`\`

---

## Backups

### Create Backup
\`\`\`bash
curl -X POST http://localhost:3000/api/servers/:serverId/backups \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $API_KEY" \\
  -d '{"name": "My Backup"}'
\`\`\`

### List Backups
\`\`\`bash
curl -H "x-api-key: $API_KEY" \\
  http://localhost:3000/api/servers/:serverId/backups
\`\`\`

### Restore Backup
\`\`\`bash
curl -X POST \\
  http://localhost:3000/api/servers/:serverId/backups/:backupId/restore \\
  -H "x-api-key: $API_KEY"
\`\`\`

---

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

---

## All Endpoints

${Object.entries(byCategory).map(([category, catRoutes]) => `
### ${category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, ' ')}

${catRoutes.map(r => `\`${r.method.padEnd(6)} ${getFullPath(r.file, r.path)}\``).join('\n')}
`).join('\n')}

---

*Generated from ${routes.length} API routes*
`;

// Write file
const outputPath = resolve(outDir, 'API-QUICK-REFERENCE-AUTO.md');
writeFileSync(outputPath, md);

console.log(`\n✅ Generated: ${outputPath}`);
console.log(`📊 ${routes.length} endpoints documented\n`);
