# Catalyst Plugin System

## Overview

Catalyst now includes a comprehensive plugin system that allows developers to extend the platform with custom features, integrations, and functionality. The system supports hot-loading, dynamic enabling/disabling, and provides rich APIs for both backend and frontend extensions.

## Features

✅ **Backend Plugin System**
- Plugin discovery from filesystem
- Manifest validation with Zod
- Hot-reload capability (file watching with chokidar)
- Lifecycle hooks: onLoad, onEnable, onDisable, onUnload
- Custom API routes with automatic namespacing
- WebSocket message handlers
- Scheduled tasks (cron jobs)
- Event system for plugin communication
- Plugin-scoped configuration
- Database-backed persistent storage
- Middleware registration

✅ **Frontend Plugin System**
- React-based plugin provider
- Zustand state management
- Plugin listing UI in admin panel
- Enable/disable/reload controls
- Plugin hooks for consuming plugin data

✅ **Example Plugin**
- Comprehensive demonstration of all capabilities
- Custom API endpoints (/hello, /echo, /stats)
- WebSocket ping/pong handler
- 5-minute cron job
- Event listeners
- Request counter
- Persistent storage
- Full documentation

## Quick Start

### Creating a Plugin

1. Create a directory in `catalyst-plugins/`:
```bash
mkdir -p catalyst-plugins/my-plugin/backend
```

2. Create `plugin.json`:
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Plugin",
  "description": "Description of what the plugin does",
  "author": "Your Name",
  "catalystVersion": ">=1.0.0",
  "permissions": ["server.read"],
  "backend": {
    "entry": "backend/index.js"
  },
  "config": {
    "someOption": "default value"
  }
}
```

3. Create `backend/index.js`:
```javascript
const plugin = {
  async onLoad(ctx) {
    // Register routes DURING onLoad (before server starts)
    ctx.registerRoute({
      method: 'GET',
      url: '/test',
      handler: async (request, reply) => {
        return { success: true, message: 'Hello from plugin!' };
      },
    });
  },
  
  async onEnable(ctx) {
    // Set up WebSocket handlers, cron jobs, etc.
    ctx.onWebSocketMessage('my_plugin_event', async (data) => {
      ctx.logger.info('Received event:', data);
    });
  },
  
  async onDisable(ctx) {
    // Cleanup resources
  },
};

export default plugin;
```

4. The plugin will be auto-discovered on backend startup

### Plugin API

#### Context Methods

**Route Registration**
```javascript
ctx.registerRoute({
  method: 'GET|POST|PUT|DELETE',
  url: '/your-path',  // Automatically prefixed with /api/plugins/{name}
  handler: async (request, reply) => { ... }
});
```

**WebSocket Handlers**
```javascript
ctx.onWebSocketMessage('message_type', async (data, clientId) => {
  // Handle incoming WebSocket message
});

ctx.sendWebSocketMessage(clientId, { type: 'response', data: ... });
```

**Scheduled Tasks**
```javascript
ctx.scheduleTask('*/5 * * * *', async () => {
  // Runs every 5 minutes
});
```

**Events**
```javascript
ctx.on('event_name', async (data) => {
  // Listen to events
});

ctx.emit('my_event', { some: 'data' });
```

**Configuration**
```javascript
const value = ctx.getConfig('key');
await ctx.setConfig('key', 'new value');
```

**Storage**
```javascript
const data = await ctx.getStorage('my_key');
await ctx.setStorage('my_key', { any: 'data' });
await ctx.deleteStorage('my_key');
```

**Logging**
```javascript
ctx.logger.info('Message');
ctx.logger.error({ error }, 'Error occurred');
```

**Database Access**
```javascript
const servers = await ctx.db.server.findMany();
```

## Admin UI

Navigate to **Admin → Plugins** to:
- View all installed plugins
- Enable/disable plugins
- Reload plugins (hot-reload)
- View plugin status and errors

## API Endpoints

### List Plugins
```
GET /api/plugins
```

### Get Plugin Details
```
GET /api/plugins/:name
```

### Enable/Disable Plugin
```
POST /api/plugins/:name/enable
Body: { "enabled": true }
```

### Reload Plugin
```
POST /api/plugins/:name/reload
```

### Update Config
```
PUT /api/plugins/:name/config
Body: { "config": { "key": "value" } }
```

## Example Plugin

See `catalyst-plugins/example-plugin/` for a complete working example that demonstrates:
- Custom API routes
- WebSocket handlers
- Scheduled tasks
- Event listeners
- Configuration management
- Persistent storage
- Middleware
- All lifecycle hooks

Test the example plugin:
```bash
curl http://localhost:3000/api/plugins/example-plugin/hello
curl http://localhost:3000/api/plugins/example-plugin/stats
curl -X POST http://localhost:3000/api/plugins/example-plugin/echo \
  -H 'Content-Type: application/json' \
  -d '{"test":"data"}'
```

## Technical Details

### Architecture
- **Backend**: TypeScript/JavaScript plugin loader with Fastify integration
- **Frontend**: React context provider with Zustand state management
- **Database**: PostgreSQL with Prisma ORM (Plugin & PluginStorage models)
- **Hot-reload**: Chokidar file watching with automatic reload

### Plugin Lifecycle
1. **Load** - Plugin discovered, manifest validated, routes registered
2. **Enable** - Plugin activated, WebSocket/cron/events registered
3. **Disable** - Plugin deactivated, tasks stopped
4. **Unload** - Plugin removed from memory

### Permissions
Plugins declare required permissions in manifest. Backend validates permissions before allowing operations.

### Isolation
Each plugin runs in its own context with:
- Namespaced routes (`/api/plugins/{name}/...`)
- Isolated storage
- Scoped logging
- Separate configuration

## Future Enhancements
- Frontend dynamic loading
- Plugin marketplace
- Sandboxing/security
- Build system & CLI tools
- Plugin templates

## Documentation

See also:
- `catalyst-plugins/example-plugin/README.md` - Detailed example plugin documentation
- `docs/PLUGIN_DEVELOPMENT.md` - Plugin development guide (coming soon)
