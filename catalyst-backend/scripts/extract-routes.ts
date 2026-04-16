#!/usr/bin/env bun
/**
 * Route Schema Annotator
 * 
 * Scans all route files and extracts routes with metadata.
 * Run: bun scripts/extract-routes.ts
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(__dirname, '../src/routes');
const outDir = resolve(__dirname, '../../docs');

// Ensure docs directory exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

interface Route {
  method: string;
  path: string;
  hasSchema: boolean;
  file: string;
  line: number;
}

// Route prefixes mapped from index.ts
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

function parseRoutes() {
  const routes: Route[] = [];
  const files = readdirSync(routesDir).filter(f => f.endsWith('.ts'));
  
  for (const file of files) {
    const content = readFileSync(resolve(routesDir, file), 'utf-8');
    const lines = content.split('\n');
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      
      // Check if this line starts a route definition
      let methodMatch = null;
      for (const method of METHODS) {
        // Pattern: app.method( or await app.method(
        const pattern = new RegExp(`(?:await\\s+)?app\\.${method}\\s*\\(`);
        if (pattern.test(line)) {
          methodMatch = method.toUpperCase();
          break;
        }
      }
      
      if (methodMatch) {
        // Extract path - could be on same line or subsequent lines
        let path = '';
        let j = i;
        
        // Look for path in current line or next few lines
        while (j < Math.min(i + 3, lines.length)) {
          const pathMatch = lines[j].match(/["']([^"']+)["']/);
          if (pathMatch && !pathMatch[1].includes('schema') && !pathMatch[1].includes('description')) {
            path = pathMatch[1];
            break;
          }
          j++;
        }
        
        // Check for schema in next ~15 lines (routes can span multiple lines)
        const context = lines.slice(i, Math.min(i + 15, lines.length)).join('\n');
        const hasSchema = /\bschema\s*:/.test(context) || /\{\s*schema\s*:/.test(context);
        
        if (path && path.startsWith('/')) {
          routes.push({
            method: methodMatch,
            path,
            hasSchema,
            file,
            line: i + 1,
          });
        }
        
        // Move past this route definition
        i = j + 1;
      } else {
        i++;
      }
    }
  }
  
  return routes;
}

// Main execution
const routes = parseRoutes();
const undocumented = routes.filter(r => !r.hasSchema);
const documented = routes.filter(r => r.hasSchema);

// Resolve full paths
const fullRoutes = routes.map(r => ({
  ...r,
  fullPath: `${PREFIXES[r.file] || '/api'}${r.path}`.replace(/\/+/g, '/'),
}));

console.log('\n📋 Route Analysis');
console.log('================\n');
console.log(`Total routes found: ${routes.length}`);
console.log(`✅ With schema: ${documented.length}`);
console.log(`❌ Missing schema: ${undocumented.length}\n`);

// Group by tag/category
const byCategory = fullRoutes.reduce((acc, route) => {
  const category = route.file.replace('.ts', '');
  if (!acc[category]) acc[category] = [];
  acc[category].push(route);
  return acc;
}, {} as Record<string, typeof fullRoutes>);

// Sort by total route count descending
const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length);

console.log('📁 Routes by file:\n');
for (const [category, catRoutes] of sortedCategories) {
  const prefix = PREFIXES[catRoutes[0]?.file] || '/api';
  const docCount = catRoutes.filter(r => r.hasSchema).length;
  console.log(`  ${category} ${prefix} (${docCount}/${catRoutes.length} documented):`);
  for (const route of catRoutes.slice(0, 20)) { // Show first 20
    const status = route.hasSchema ? '✅' : '❌';
    console.log(`    ${status} ${route.method.padEnd(8)} ${route.path}`);
  }
  if (catRoutes.length > 20) {
    console.log(`    ... and ${catRoutes.length - 20} more`);
  }
  console.log();
}

// Generate OpenAPI spec
const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Catalyst API',
    description: 'Catalyst backend API documentation - auto-generated',
    version: '1.0.0',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  paths: fullRoutes.reduce((acc, route) => {
    const basePath = PREFIXES[route.file] || '/api';
    const path = `${basePath}${route.path}`.replace(/:(\w+)/g, '{$1}').replace(/\/+/g, '/');
    
    if (!acc[path]) acc[path] = {};
    acc[path][route.method.toLowerCase()] = {
      summary: route.path,
      tags: [route.file.replace('.ts', '')],
      responses: {
        '200': { description: 'Success' },
        '400': { description: 'Bad Request' },
        '401': { description: 'Unauthorized' },
        '404': { description: 'Not Found' },
      },
    };
    return acc;
  }, {} as Record<string, any>),
};

// Write OpenAPI spec
const specPath = resolve(outDir, 'openapi.json');
writeFileSync(specPath, JSON.stringify(openApiSpec, null, 2));
console.log(`\n✅ OpenAPI spec: ${specPath}`);

// Generate markdown docs
const mdContent = `# Catalyst API Reference

> Auto-generated on ${new Date().toISOString().split('T')[0]}

## Base URL

\`\`\`
http://localhost:3000
\`\`\`

## Authentication

All requests require the \`x-api-key\` header:

\`\`\`bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/endpoint
\`\`\`

---

## Endpoints Summary

| Category | Path | Total | Documented |
|----------|------|-------|------------|
${sortedCategories.map(([category, catRoutes]) => {
  const prefix = PREFIXES[catRoutes[0]?.file] || '/api';
  const docCount = catRoutes.filter(r => r.hasSchema).length;
  return `| ${category} | \`${prefix}\` | ${catRoutes.length} | ${docCount} |`;
}).join('\n')}

---

## Detailed Endpoints

${sortedCategories.map(([category, catRoutes]) => {
  const prefix = PREFIXES[catRoutes[0]?.file] || '/api';
  return `
### ${category.charAt(0).toUpperCase() + category.slice(1)} \`${prefix}\`

| Method | Path | Status |
|--------|------|--------|
${catRoutes.map(r => `| ${r.method} | \`${r.path}\` | ${r.hasSchema ? '✅' : '❌'} |`).join('\n')}
`;
}).join('\n')}

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

## Interactive Documentation

Visit \`http://localhost:3000/docs\` for the Swagger UI with full interactive documentation.

---

## OpenAPI Specification

Full spec available at: \`docs/openapi.json\`
`;

const mdPath = resolve(outDir, 'API-DOCUMENTATION.md');
writeFileSync(mdPath, mdContent);
console.log(`✅ Markdown docs: ${mdPath}`);

console.log('\n📊 Final Summary:');
console.log(`   Total routes: ${routes.length}`);
console.log(`   Documented: ${documented.length}`);
console.log(`   Missing: ${undocumented.length}`);
console.log('\n✨ Done!');
