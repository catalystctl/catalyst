# RBAC Security Fix Implementation Plan

## Executive Summary

The Catalyst RBAC system audit identified 8 security issues ranging from Critical to Low severity. The core architecture is sound, but specific edge cases allow privilege escalation, inconsistent permission checks, and missing validation. This plan prioritizes fixes by severity, groups related changes by file, and provides exact implementation details.

**Approach**: Fix critical/high issues first with minimal changes. Medium/low issues follow. All changes maintain backward compatibility.

---

## Priority 1: Critical Issues

### Fix 1.1: API Key Permission Escalation (CRITICAL)

**Problem**: API keys with specific permissions (not `allPermissions`) store those permissions at creation time. If the user's roles are later revoked, the API key continues to work with stale permissions. Conversely, keys with `allPermissions` resolve live permissions, which is correct but the reverse case is dangerous.

**Root Cause**: In `/catalyst-backend/src/index.ts` lines 396-405, when `allPermissions` is false, stored permissions are used without re-validation against the user's current permissions.

**Fix**: Add runtime validation in the API key authentication flow to ensure API key permissions never exceed the user's current permissions.

**File**: `catalyst-backend/src/index.ts`

**Changes**:
1. In the `authenticate` function (around line 350-420), after resolving API key permissions, add a validation step:

```typescript
// After resolving permissions from API key...
let permissions: string[];
if (verification.key.allPermissions) {
  const { resolveUserPermissions } = await import("./lib/permissions-catalog");
  permissions = await resolveUserPermissions(verification.key.userId);
} else {
  permissions = verification.key.permissions;
}

// NEW: Validate API key permissions don't exceed user's current permissions
const { resolveUserPermissions } = await import("./lib/permissions-catalog");
const currentUserPermissions = await resolveUserPermissions(verification.key.userId);
const hasWildcard = currentUserPermissions.includes('*');

if (!hasWildcard && !verification.key.allPermissions) {
  // For keys with specific permissions, ensure user still has those permissions
  const stalePermissions = permissions.filter(
    (p) => !currentUserPermissions.includes(p)
  );
  if (stalePermissions.length > 0) {
    reply.status(403).send({ 
      error: "API key permissions revoked - user no longer has required permissions" 
    });
    return;
  }
}
```

**Acceptance**: 
- Create API key with specific permissions → revoke user's role → API key request should fail with 403
- Create API key with `allPermissions` → revoke user's role → API key should reflect reduced permissions
- Existing valid API keys continue working

---

## Priority 2: High Severity Issues

### Fix 2.1: Network Route Permission Checks (HIGH)

**Problem**: POST `/api/servers/:serverId/allocations`, DELETE `/api/servers/:serverId/allocations/:containerPort`, and POST `/api/servers/:serverId/allocations/primary` only verify ownership or ANY access entry. A user with read-only access can modify allocations.

**File**: `catalyst-backend/src/routes/servers/network.ts`

**Changes**:
Replace the generic access check in all three modification routes with a permission-specific check.

1. **POST `/api/servers/:serverId/allocations`** (around line 71):
Replace:
```typescript
const hasAccess =
  server.ownerId === userId ||
  server.access.some((access) => access.userId === userId);
```
With:
```typescript
const isAdmin = checkIsAdmin(request, 'admin.read');
const hasWriteAccess = server.access.some(
  (access) => access.userId === userId && 
    (access.permissions.includes('server.update') || access.permissions.includes('server.delete'))
);
const hasAccess = server.ownerId === userId || hasWriteAccess || isAdmin;
```

2. **DELETE `/api/servers/:serverId/allocations/:containerPort`** (around line 177):
Apply the same change.

3. **POST `/api/servers/:serverId/allocations/primary`** (around line 251):
Apply the same change.

**Acceptance**: 
- User with only `server.read` permission gets 403 on POST/DELETE allocations
- User with `server.update` permission can modify allocations
- Owner and admin can still modify allocations

---

## Priority 3: Medium Severity Issues

### Fix 3.1: Standardize Console Stream Authentication (MEDIUM)

**Problem**: `/catalyst-backend/src/routes/console-stream.ts` manually calls `auth.api.getSession()` instead of using the standardized `app.authenticate` middleware. This:
- Doesn't support API key authentication
- Creates inconsistency with other routes
- Risks divergence if session validation logic changes

**File**: `catalyst-backend/src/routes/console-stream.ts`

**Changes**:
1. Replace manual session auth with `app.authenticate` in both routes.

2. For GET `/:serverId/console/stream`:
```typescript
// Replace the manual auth block (lines 42-58) with:
{ onRequest: [app.authenticate] }
```
Then use `request.user.userId` directly instead of the local `userId` variable.

3. For POST `/:serverId/console/command`:
```typescript
// Replace the preHandler auth block with:
{ onRequest: [app.authenticate] }
```
Remove the `authUserId` attachment and use `request.user.userId`.

**Acceptance**:
- Console stream works with session auth
- Console stream works with API key auth
- All existing tests pass

---

### Fix 3.2: Add Permission Validation to Role Updates (MEDIUM)

**Problem**: When updating role permissions, there's no validation that the user has all permissions they're granting. A user with `role.update` could grant `*` to a role, escalating privileges of all users with that role.

**File**: `catalyst-backend/src/routes/roles.ts`

**Changes**:
1. In POST `/` (create role, around line 145), add validation after permission array check:
```typescript
if (!Array.isArray(permissions)) {
  return reply.status(400).send({ error: 'Permissions must be an array' });
}

// NEW: Validate user can grant these permissions
const userPerms: string[] = request.user?.permissions ?? [];
const hasWildcard = userPerms.includes('*');
if (!hasWildcard) {
  const cantGrant = permissions.filter(
    (p) => !userPerms.includes(p)
  );
  if (cantGrant.length > 0) {
    return reply.status(403).send({
      error: `Cannot grant permissions you don't have: ${cantGrant.join(', ')}`,
    });
  }
}
```

2. In PUT `/:roleId` (update role, around line 215), add same validation:
```typescript
if (permissions !== undefined) {
  if (!Array.isArray(permissions)) {
    return reply.status(400).send({ error: 'Permissions must be an array' });
  }
  
  // NEW: Validate user can grant these permissions
  const userPerms: string[] = request.user?.permissions ?? [];
  const hasWildcard = userPerms.includes('*');
  if (!hasWildcard) {
    const cantGrant = permissions.filter(
      (p) => !userPerms.includes(p)
    );
    if (cantGrant.length > 0) {
      return reply.status(403).send({
        error: `Cannot grant permissions you don't have: ${cantGrant.join(', ')}`,
      });
    }
  }
  
  updateData.permissions = permissions;
}
```

3. In POST `/:roleId/permissions` (add single permission, around line 315), add validation:
```typescript
const { permission } = request.body as { permission: string };

if (!permission || typeof permission !== 'string') {
  return reply.status(400).send({ error: 'Permission is required' });
}

// NEW: Validate user can grant this permission
const userPerms: string[] = request.user?.permissions ?? [];
const hasWildcard = userPerms.includes('*');
if (!hasWildcard && !userPerms.includes(permission)) {
  return reply.status(403).send({
    error: `Cannot grant permission you don't have: ${permission}`,
  });
}
```

**Acceptance**:
- User with `role.update` but not `server.delete` cannot grant `server.delete` to a role
- Admin (`*`) can grant any permissions
- Existing roles can be updated within user's permission scope

---

### Fix 3.3: Add Server Access Validation to Admin User Management (MEDIUM)

**Problem**: In `admin.ts`, when creating/updating a user with `serverIds`, the code only validates that servers exist, not that the requesting user has permission to grant access to those servers.

**File**: `catalyst-backend/src/routes/admin.ts`

**Changes**:
1. In POST `/users` (around line 230), after server validation, add access check:
```typescript
if (serverIds?.length) {
  const uniqueServerIds = Array.from(new Set(serverIds));
  const existingServers = await prisma.server.findMany({
    where: { id: { in: uniqueServerIds } },
    select: { id: true, ownerId: true, nodeId: true },
  });

  if (existingServers.length !== uniqueServerIds.length) {
    return reply.status(400).send({ error: 'One or more servers are invalid' });
  }

  // NEW: Validate requesting user can grant access to these servers
  const isAdmin = checkPerm(request, 'admin.write');
  if (!isAdmin) {
    for (const server of existingServers) {
      const canGrant = server.ownerId === user.userId || 
        await hasNodeAccess(prisma, user.userId, server.nodeId);
      if (!canGrant) {
        return reply.status(403).send({ 
          error: `Cannot grant access to server ${server.id}` 
        });
      }
    }
  }
  
  serverAccessIds = uniqueServerIds;
  // ... rest of existing code
}
```

2. In PUT `/users/:userId` (around line 420), add same validation in the `serverIds` block.

**Acceptance**:
- Admin can assign any servers
- Server owner can assign their own servers
- Node-assigned user can assign servers on their nodes
- User without access gets 403

---

### Fix 3.4: Add Per-Server Validation to Bulk Actions (MEDIUM)

**Problem**: The bulk server actions endpoint checks global permission but not per-server access. A user with `server.start` could start servers they don't own or have access to.

**File**: `catalyst-backend/src/routes/admin.ts`

**Changes**:
In POST `/servers/actions` (around line 600), after loading servers, add per-server access check before processing:

```typescript
const servers = await prisma.server.findMany({
  where: { id: { in: uniqueServerIds } },
  include: { node: true, template: true },
});

// NEW: Validate per-server access for non-admin users
const isAdmin = checkPerm(request, 'admin.write');
if (!isAdmin) {
  for (const server of servers) {
    const canAccess = server.ownerId === user.userId ||
      await hasNodeAccess(prisma, user.userId, server.nodeId);
    if (!canAccess) {
      return reply.status(403).send({
        error: `Cannot perform ${action} on server ${server.id}: access denied`,
      });
    }
  }
}
```

**Acceptance**:
- Admin can perform bulk actions on any servers
- Owner can bulk-action their own servers
- Node-assigned user can bulk-action servers on their nodes
- Unauthorized user gets 403 before any action is taken

---

## Priority 4: Low Severity Issues

### Fix 4.1: Unify Permission Catalog (LOW)

**Problem**: Two `PERMISSION_CATEGORIES` definitions exist - one in `permissions.ts` and one in `permissions-catalog.ts`. They have slight differences causing maintenance issues.

**Files**: 
- `catalyst-backend/src/lib/permissions.ts`
- `catalyst-backend/src/lib/permissions-catalog.ts`

**Changes**:
1. Export `PERMISSION_CATEGORIES` from `permissions-catalog.ts` as the single source of truth.
2. In `permissions.ts`, remove the local `PERMISSION_CATEGORIES` definition and re-export from `permissions-catalog.ts`.
3. Update any imports in other files that reference `permissions.ts` for `PERMISSION_CATEGORIES`.

**Acceptance**:
- Only one `PERMISSION_CATEGORIES` definition exists
- All imports work correctly
- No functional changes

---

### Fix 4.2: Add Permission Check to Console Stream Access (LOW)

**Problem**: The console stream GET route checks if user is in allowedUsers list but doesn't check specific `console.read` permission from server access entries. Node-assigned users should also be checked properly.

**File**: `catalyst-backend/src/routes/console-stream.ts`

**Changes**:
After standardizing auth (Fix 3.1), update the access check to use `hasNodeAccess` for node-assigned users:

```typescript
const server = await prisma.server.findUnique({
  where: { id: serverId },
  include: {
    access: { select: { userId: true, permissions: true } },
  },
});

const access = server.access.find((a) => a.userId === userId);
const hasConsoleRead = access?.permissions?.includes('console.read');
const isOwner = server.ownerId === userId;
const isAdmin = checkIsAdmin(request, 'admin.read');
const hasNodeAccessResult = await hasNodeAccess(prisma, userId, server.nodeId);

if (!isOwner && !hasConsoleRead && !isAdmin && !hasNodeAccessResult) {
  reply.status(403).send({ error: 'Access denied' });
  return;
}
```

**Acceptance**:
- Owner can access console
- User with `console.read` permission can access
- Admin can access
- Node-assigned user can access
- Others get 403

---

## Files to Modify

| File | Changes |
|------|---------|
| `catalyst-backend/src/index.ts` | Add API key permission re-validation (Fix 1.1) |
| `catalyst-backend/src/routes/servers/network.ts` | Add `server.update` checks to POST/DELETE/primary routes (Fix 2.1) |
| `catalyst-backend/src/routes/console-stream.ts` | Standardize auth to `app.authenticate`, add permission checks (Fix 3.1, 4.2) |
| `catalyst-backend/src/routes/roles.ts` | Add permission validation on role create/update (Fix 3.2) |
| `catalyst-backend/src/routes/admin.ts` | Add server access validation to user mgmt and bulk actions (Fix 3.3, 3.4) |
| `catalyst-backend/src/lib/permissions.ts` | Re-export PERMISSION_CATEGORIES from catalog (Fix 4.1) |
| `catalyst-backend/src/lib/permissions-catalog.ts` | Export as canonical source (Fix 4.1) |

---

## Testing Plan

### New Tests to Add

1. **API Key Permission Re-validation Test**
   - File: `catalyst-backend/src/__tests__/rbac-api.test.ts`
   - Test: Create API key with specific permissions → revoke role → verify 403 on API key use

2. **Network Route Permission Test**
   - File: `catalyst-backend/src/__tests__/rbac-api.test.ts`
   - Test: User with `server.read` only gets 403 on allocation POST/DELETE
   - Test: User with `server.update` can modify allocations

3. **Role Permission Escalation Test**
   - File: `catalyst-backend/src/__tests__/rbac.test.ts`
   - Test: User without `server.delete` cannot grant it to a role
   - Test: Admin can grant any permission

4. **Bulk Action Per-Server Test**
   - File: New or existing admin test file
   - Test: User can only bulk-action servers they own/have node access to

5. **Console Stream Auth Test**
   - File: `catalyst-backend/src/__tests__/rbac-api.test.ts`
   - Test: Console stream works with API key auth
   - Test: Console stream respects `console.read` permission

### Existing Tests to Update

1. `catalyst-backend/src/__tests__/rbac.test.ts`
   - Update role tests to include permission validation scenarios

2. `catalyst-backend/src/__tests__/rbac-api.test.ts`
   - Add tests for API key permission revocation

---

## Implementation Order

1. **Phase 1 (Critical)**: Fix 1.1 - API Key validation
2. **Phase 2 (High)**: Fix 2.1 - Network route permissions
3. **Phase 3 (Medium)**: 
   - Fix 3.1 - Console stream auth
   - Fix 3.2 - Role permission validation
   - Fix 3.3 - Admin user server access validation
   - Fix 3.4 - Bulk action per-server validation
4. **Phase 4 (Low)**:
   - Fix 4.1 - Unify permission catalog
   - Fix 4.2 - Console stream permission check
5. **Phase 5 (Testing)**: Add/update all tests

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Breaking existing API keys | Only reject keys where user has LOST permissions, not where they gained new ones |
| Performance impact of permission re-validation | Cache resolved permissions for 30 seconds (existing cache in permissions-catalog.ts) |
| Console stream SSE format change | Keep SSE response format identical, only change auth mechanism |
| Bulk action breaking for non-admin users | Add check only for non-admin; admin behavior unchanged |
| Role update rejection breaking admin workflows | Admin with `*` bypasses all validation |

---

## Dependencies

- Fix 3.1 (Console stream auth) must be done before Fix 4.2 (Console stream permissions)
- Fix 4.1 (Permission catalog) can be done independently
- All other fixes are independent of each other
