# Plugin Tab System - Testing Guide

## ✅ Implementation Complete

The plugin system now supports dynamic tab injection for both admin and server pages!

### What Was Added

1. **Frontend Tab Components**
   - `ExampleAdminTab` - Admin interface with plugin stats and API testing
   - `ExampleServerTab` - Server-specific interface with echo functionality

2. **Tab Registration System**
   - Plugin tabs defined in `frontend/index.ts`
   - Auto-loaded by `PluginProvider`
   - Injected into appropriate pages

3. **Routing**
   - Admin tabs: `/admin/plugin/:pluginTabId`
   - Server tabs: `/servers/:id/plugin/:pluginTabId` (future)
   - Automatic route generation

4. **UI Integration**
   - Admin tabs appear in `AdminTabs` navigation
   - Plugin tabs sorted by order property
   - Memoized to prevent render loops

### How to Test

**Step 1: Enable the Example Plugin**
```bash
# Backend should be running on port 3000
curl http://localhost:3000/api/plugins
```

**Step 2: View Admin Tab**
1. Navigate to http://localhost:5173/admin
2. Look for "Example Plugin" tab in the navigation
3. Click it to see the plugin's admin interface
4. Features:
   - Plugin statistics display
   - Request count tracking
   - API testing button
   - Real-time data fetching

**Step 3: Test Admin Tab Functionality**
```bash
# The admin tab calls this endpoint
curl http://localhost:3000/api/plugins/example-plugin/hello
# Should return: {"message": "Hello from Example Plugin!", "requestCount": X}

# Get stats
curl http://localhost:3000/api/plugins/example-plugin/stats
```

**Step 4: View Server Tab (when implemented)**
- Navigate to any server details page
- Look for "Plugin Demo" tab
- Features echo functionality and server-specific context

### Architecture

**File Structure:**
```
catalyst-frontend/src/
├── plugins/
│   ├── example-plugin/
│   │   └── components.tsx       # Plugin UI components
│   ├── hooks.ts                 # usePluginTabs(), etc.
│   ├── loader.ts                # Loads plugin frontend
│   └── PluginProvider.tsx       # React context
├── pages/
│   └── PluginTabPage.tsx        # Generic tab renderer
└── components/admin/
    └── AdminTabs.tsx            # Injects plugin tabs
```

**Tab Configuration:**
```typescript
{
  id: 'example-admin',
  label: 'Example Plugin',
  component: ExampleAdminTab,
  location: 'admin',
  order: 100,
  requiredPermissions: ['admin.read'],
}
```

### Expected Behavior

✅ Admin tabs appear in admin navigation  
✅ Clicking tab navigates to plugin page  
✅ Components receive correct props  
✅ Server tabs get `serverId` prop  
✅ Hot-reload updates tabs  
✅ Disabled plugins hide tabs  

### Troubleshooting

**Tab not showing?**
- Check plugin is enabled: GET /api/plugins
- Check browser console for errors
- Verify plugin has `hasFrontend: true` in manifest

**Infinite render loop?**
- Fixed: hooks use `useMemo` to prevent re-renders
- Admin tabs memoize plugin routes

**Components not loading?**
- Plugin components must be in `catalyst-frontend/src/plugins/example-plugin/`
- Vite cannot import from outside the frontend directory
