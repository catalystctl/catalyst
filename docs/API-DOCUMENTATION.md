# Catalyst API Reference

> Auto-generated on 2026-04-16

## Base URL

```
http://localhost:3000
```

## Authentication

All requests require the `x-api-key` header:

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/endpoint
```

---

## Endpoints


### `/register`


#### POST

**Register new user**

Create a new user account with email and password

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string",
      "format": "email"
    },
    "username": {
      "type": "string"
    },
    "password": {
      "type": "string",
      "minLength": 12
    }
  },
  "required": [
    "email",
    "username",
    "password"
  ]
}
```



**Responses:**
- `201`: Created
- `400`: Bad Request
- `409`: Conflict


### `/login`


#### POST

**User login**

Authenticate user with email/password. Supports 2FA and passkeys.

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    },
    "password": {
      "type": "string"
    },
    "rememberMe": {
      "type": "boolean"
    }
  },
  "required": [
    "email",
    "password"
  ]
}
```



**Responses:**
- `200`: Success
- `401`: Unauthorized


### `/sign-out`


#### POST

**Logout**

Sign out the current session





**Responses:**
- `200`: Success


### `/me`


#### GET

**Get current user**

Get the currently authenticated user





**Responses:**
- `200`: Success
- `401`: Unauthorized


### `/profile`


#### GET

**Get profile**

Get detailed user profile including permissions





**Responses:**
- `200`: Success
- `401`: Unauthorized


### `/profile/change-password`


#### POST

**Change password**

Change the authenticated user password

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "currentPassword": {
      "type": "string"
    },
    "newPassword": {
      "type": "string"
    }
  },
  "required": [
    "currentPassword",
    "newPassword"
  ]
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request
- `401`: Unauthorized


### `/profile/set-password`


#### POST

**Set password**

Set password for SSO accounts without password

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "password": {
      "type": "string"
    }
  },
  "required": [
    "password"
  ]
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request


### `/profile/two-factor`


#### GET

**Get 2FA status**

Get two-factor authentication status





**Responses:**
- `200`: Success


### `/profile/two-factor/enable`


#### POST

**Enable 2FA**

Enable two-factor authentication





**Responses:**
- `200`: Success
- `400`: Bad Request


### `/profile/two-factor/disable`


#### POST

**Disable 2FA**

Disable two-factor authentication

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string"
    }
  },
  "required": [
    "code"
  ]
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request


### `/profile/two-factor/generate-backup-codes`


#### POST

**Generate backup codes**

Generate new backup codes for 2FA





**Responses:**
- `200`: Success


### `/profile/passkeys`


#### GET

**List passkeys**

List all registered passkeys





**Responses:**
- `200`: Success

#### POST

**Create passkey**

Create registration options for a new passkey





**Responses:**
- `200`: Success


### `/profile/passkeys/verify`


#### POST

**Verify passkey**

Verify and save a new passkey

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "credential": {
      "type": "object"
    }
  }
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request


### `/profile/passkeys/{id}`


#### DELETE

**Delete passkey**

Delete a registered passkey



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| id | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found

#### PATCH

**Update passkey**

Update passkey name

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| id | string |  |


**Responses:**
- `200`: Success


### `/profile/sso/accounts`


#### GET

**List SSO accounts**

List linked SSO provider accounts





**Responses:**
- `200`: Success


### `/profile/sso/link`


#### POST

**Link SSO**

Link an SSO provider account

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "provider": {
      "type": "string"
    }
  }
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request


### `/profile/sso/unlink`


#### POST

**Unlink SSO**

Unlink an SSO provider account

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "provider": {
      "type": "string"
    }
  }
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request


### `/forgot-password`


#### POST

**Request password reset**

Request a password reset email

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    }
  },
  "required": [
    "email"
  ]
}
```



**Responses:**
- `200`: Success


### `/reset-password/validate`


#### GET

**Validate reset token**

Validate if a password reset token is valid





**Responses:**
- `200`: Success
- `400`: Bad Request


### `/reset-password`


#### POST

**Reset password**

Reset password using a token

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "token": {
      "type": "string"
    },
    "password": {
      "type": "string"
    }
  },
  "required": [
    "token",
    "password"
  ]
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request


### `/profile/delete`


#### POST

**Delete account**

Delete the authenticated user account

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "confirm": {
      "type": "string"
    }
  },
  "required": [
    "confirm"
  ]
}
```



**Responses:**
- `200`: Success
- `400`: Bad Request


### `/`


#### POST

**Create nest**

Create a new nest [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    }
  },
  "required": [
    "name"
  ]
}
```



**Responses:**
- `201`: Created

#### GET

**SSE events stream**

Server-Sent Events stream for admin events





**Responses:**
- `200`: Success


### `/{serverId}`


#### GET

**Get server**

Get details of a specific server [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found

#### PUT

**Update server**

Update server configuration [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "allocatedMemoryMb": {
      "type": "number"
    },
    "allocatedCpuCores": {
      "type": "number"
    },
    "allocatedDiskMb": {
      "type": "number"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request

#### DELETE

**Delete server**

Delete a server and all associated data [Requires: server.delete]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found


### `/{serverId}/start`


#### POST

**Start server**

Start the game server [Requires: server.start]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request
- `404`: Not Found


### `/{serverId}/stop`


#### POST

**Stop server**

Stop the game server gracefully [Requires: server.stop]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request
- `404`: Not Found


### `/{serverId}/restart`


#### POST

**Restart server**

Restart the game server [Requires: server.restart]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request
- `404`: Not Found


### `/{serverId}/kill`


#### POST

**Kill server**

Force kill the game server [Requires: server.stop]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request
- `404`: Not Found


### `/{serverId}/suspend`


#### POST

**Suspend server**

Suspend a server (non-payment) [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string"
    },
    "stopServer": {
      "type": "boolean"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/unsuspend`


#### POST

**Unsuspend server**

Unsuspend a server [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/install`


#### POST

**Install server**

Run the install script for a server [Requires: server.install]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request
- `404`: Not Found


### `/{serverId}/reinstall`


#### POST

**Reinstall server**

Reinstall the server [Requires: server.reinstall]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/rebuild`


#### POST

**Rebuild server**

Rebuild the server container [Requires: server.rebuild]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/transfer`


#### POST

**Transfer server**

Transfer server to another node [Requires: server.transfer]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "targetNodeId": {
      "type": "string"
    }
  },
  "required": [
    "targetNodeId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/stats/history`


#### GET

**Get stats history**

Get historical stats for a server [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/storage/resize`


#### PUT

**Resize storage**

Resize server storage allocation [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "allocatedDiskMb": {
      "type": "number"
    }
  },
  "required": [
    "allocatedDiskMb"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/files`


#### GET

**List files**

List server files [Requires: file.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/files/download`


#### GET

**Download file**

Download a server file [Requires: file.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found


### `/{serverId}/files/upload`


#### POST

**Upload file**

Upload a file to the server [Requires: file.write]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/files/create`


#### POST

**Create file/directory**

Create a new file or directory [Requires: file.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "directory": {
      "type": "boolean"
    }
  },
  "required": [
    "path"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/files/write`


#### POST

**Write file**

Write content to a file [Requires: file.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "content": {
      "type": "string"
    }
  },
  "required": [
    "path",
    "content"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success
- `400`: Bad Request


### `/{serverId}/files/compress`


#### POST

**Compress files**

Compress files into an archive [Requires: file.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "name": {
      "type": "string"
    }
  },
  "required": [
    "files",
    "name"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/files/decompress`


#### POST

**Decompress archive**

Decompress an archive file [Requires: file.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "file": {
      "type": "string"
    }
  },
  "required": [
    "file"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/logs`


#### GET

**Get logs**

Get server logs [Requires: console.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/files/delete`


#### DELETE

**Delete files**

Delete server files [Requires: file.delete]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "files"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/files/rename`


#### POST

**Rename file**

Rename a file or directory [Requires: file.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "from": {
      "type": "string"
    },
    "to": {
      "type": "string"
    }
  },
  "required": [
    "from",
    "to"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/backups`


#### GET

**List backups**

Get all backups for a server [Requires: backup.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success

#### POST

**Create backup**

Create a new backup [Requires: backup.create]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    }
  },
  "required": [
    "name"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `201`: Created


### `/{serverId}/backups/{backupId}`


#### GET

**Get backup**

Get backup details [Requires: backup.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| backupId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete backup**

Delete a backup [Requires: backup.delete]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| backupId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/backups/{backupId}/restore`


#### POST

**Restore backup**

Restore a backup [Requires: backup.restore]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| backupId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/databases`


#### GET

**List databases**

Get server databases [Requires: database.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success

#### POST

**Create database**

Create a new database [Requires: database.create]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    }
  },
  "required": [
    "name"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `201`: Created


### `/{serverId}/databases/{databaseId}/rotate`


#### POST

**Rotate password**

Rotate database password [Requires: database.rotate]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| databaseId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/databases/{databaseId}`


#### DELETE

**Delete database**

Delete a database [Requires: database.delete]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| databaseId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/access`


#### GET

**List access**

List all users with server access [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success

#### POST

**Grant access**

Grant a user access to the server [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "userId": {
      "type": "string"
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "userId",
    "permissions"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `201`: Created


### `/{serverId}/access/{targetUserId}`


#### DELETE

**Revoke access**

Revoke user access to the server [Requires: server.write]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| targetUserId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/tasks`


#### POST

**Create task**

Create a scheduled task [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "action": {
      "type": "string"
    },
    "cron": {
      "type": "string"
    },
    "payload": {
      "type": "object"
    }
  },
  "required": [
    "name",
    "action",
    "cron"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `201`: Created

#### GET

**List tasks**

Get scheduled tasks for server [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/tasks/{taskId}`


#### GET

**Get task**

Get task details [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| taskId | string |  |


**Responses:**
- `200`: Success

#### PUT

**Update task**

Update a scheduled task [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "action": {
      "type": "string"
    },
    "cron": {
      "type": "string"
    },
    "enabled": {
      "type": "boolean"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| taskId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete task**

Delete a scheduled task [Requires: server.write]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| taskId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/tasks/{taskId}/execute`


#### POST

**Execute task**

Execute a task immediately [Requires: server.write]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| taskId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/mod-manager/search`


#### GET

**Search mods**

Search for mods [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/mod-manager/versions`


#### GET

**Get mod versions**

Get available versions for a mod [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/mod-manager/install`


#### POST

**Install mod**

Install a mod [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "modId": {
      "type": "string"
    },
    "version": {
      "type": "string"
    }
  },
  "required": [
    "modId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/mod-manager/installed`


#### GET

**List installed mods**

Get installed mods [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/mod-manager/uninstall`


#### POST

**Uninstall mod**

Uninstall a mod [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "modId": {
      "type": "string"
    }
  },
  "required": [
    "modId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/mod-manager/check-updates`


#### POST

**Check mod updates**

Check for mod updates [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/mod-manager/update`


#### POST

**Update mod**

Update a mod [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "modId": {
      "type": "string"
    }
  },
  "required": [
    "modId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/plugin-manager/search`


#### GET

**Search plugins**

Search for plugins [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/plugin-manager/install`


#### POST

**Install plugin**

Install a plugin [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string"
    },
    "version": {
      "type": "string"
    }
  },
  "required": [
    "pluginId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/plugin-manager/installed`


#### GET

**List installed plugins**

Get installed plugins [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/plugin-manager/uninstall`


#### POST

**Uninstall plugin**

Uninstall a plugin [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string"
    }
  },
  "required": [
    "pluginId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/plugin-manager/check-updates`


#### POST

**Check plugin updates**

Check for plugin updates [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/plugin-manager/update`


#### POST

**Update plugin**

Update a plugin [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string"
    }
  },
  "required": [
    "pluginId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/invites`


#### GET

**List invites**

List pending server invites [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success

#### POST

**Create invite**

Create a server invite [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "permissions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `201`: Created


### `/{serverId}/invites/{inviteId}`


#### DELETE

**Delete invite**

Delete a server invite [Requires: server.write]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| inviteId | string |  |


**Responses:**
- `200`: Success


### `/invites/accept`


#### POST

**Accept invite**

Accept a server invite

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "token": {
      "type": "string"
    }
  },
  "required": [
    "token"
  ]
}
```



**Responses:**
- `200`: Success


### `/invites/register`


#### POST

**Register via invite**

Register and join a server via invite

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "token": {
      "type": "string"
    },
    "email": {
      "type": "string"
    },
    "username": {
      "type": "string"
    },
    "password": {
      "type": "string"
    }
  },
  "required": [
    "token",
    "email",
    "username",
    "password"
  ]
}
```



**Responses:**
- `201`: Created


### `/invites/{token}`


#### GET

**Get invite**

Get invite details



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| token | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/archive`


#### POST

**Archive server**

Create an archive of the server [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "includeBackups": {
      "type": "boolean"
    }
  },
  "required": [
    "name"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `201`: Created


### `/{serverId}/restore`


#### POST

**Restore server**

Restore server from an archive [Requires: server.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "archiveId": {
      "type": "string"
    }
  },
  "required": [
    "archiveId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}`


#### GET

**Get node**

Get node details [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found

#### PUT

**Update node**

Update node configuration [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "fqdn": {
      "type": "string"
    },
    "publicAddress": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete node**

Delete a node [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found


### `/{nodeId}/stats`


#### GET

**Get node stats**

Get node resource statistics [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/heartbeat`


#### POST

**Node heartbeat**

Record node heartbeat

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "cpuUsage": {
      "type": "number"
    },
    "memoryUsageMb": {
      "type": "number"
    },
    "diskUsageMb": {
      "type": "number"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/allocations`


#### GET

**List allocations**

Get node IP allocations [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success

#### POST

**Create allocation**

Create a new IP allocation [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "ip": {
      "type": "string"
    },
    "port": {
      "type": "number"
    },
    "alias": {
      "type": "string"
    }
  },
  "required": [
    "ip",
    "port"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `201`: Created


### `/{nodeId}/allocations/{allocationId}`


#### PATCH

**Update allocation**

Update an allocation [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "alias": {
      "type": "string"
    },
    "assignedTo": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |
| allocationId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete allocation**

Delete an allocation [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |
| allocationId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/assignments`


#### GET

**List assignments**

Get server assignments [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/assign`


#### POST

**Assign server**

Assign a server to an allocation [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "serverId": {
      "type": "string"
    },
    "allocationId": {
      "type": "string"
    }
  },
  "required": [
    "serverId",
    "allocationId"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/assignments/{assignmentId}`


#### DELETE

**Unassign server**

Remove server from allocation [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |
| assignmentId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/api-key`


#### GET

**Get node API key**

Get the API key for a node [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success

#### POST

**Regenerate node API key**

Regenerate the API key for a node [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/deployment-token`


#### POST

**Create deployment token**

Generate a deployment token [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "expiresIn": {
      "type": "number"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `201`: Created


### `/{nodeId}/ip-pools`


#### GET

**List IP pools**

Get IP pools for a node [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/{nodeId}/ip-availability`


#### GET

**IP availability**

Get IP availability information [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/accessible`


#### GET

**List accessible nodes**

Get nodes accessible to the current user





**Responses:**
- `200`: Success


### `/{roleId}`


#### GET

**Get role**

Get role details [Requires: role.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found

#### PUT

**Update role**

Update a role [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete role**

Delete a role [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |


**Responses:**
- `200`: Success


### `/{roleId}/permissions`


#### POST

**Add permissions**

Add permissions to a role [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "permissions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "permissions"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |


**Responses:**
- `200`: Success


### `/{roleId}/permissions/*`


#### DELETE

**Remove permissions**

Remove permissions from a role [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |


**Responses:**
- `200`: Success


### `/{roleId}/users/{userId}`


#### POST

**Assign role**

Assign a role to a user [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |
| userId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Remove role**

Remove a role from a user [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |
| userId | string |  |


**Responses:**
- `200`: Success


### `/users/{userId}/roles`


#### GET

**Get user roles**

Get roles for a user [Requires: role.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| userId | string |  |


**Responses:**
- `200`: Success


### `/presets`


#### GET

**Get role presets**

Get predefined role presets





**Responses:**
- `200`: Success


### `/{roleId}/nodes`


#### GET

**Get role nodes**

Get nodes assigned to a role [Requires: role.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| roleId | string |  |


**Responses:**
- `200`: Success


### `/users/{userId}/nodes`


#### GET

**Get user nodes**

Get nodes accessible to a user [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| userId | string |  |


**Responses:**
- `200`: Success


### `/{templateId}`


#### GET

**Get template**

Get template details [Requires: template.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| templateId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found

#### PUT

**Update template**

Update a template [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "dockerImage": {
      "type": "string"
    },
    "startup": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| templateId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete template**

Delete a template [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| templateId | string |  |


**Responses:**
- `200`: Success


### `/import-pterodactyl`


#### POST

**Import Pterodactyl egg**

Import a Pterodactyl egg [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "nestId": {
      "type": "string"
    },
    "data": {
      "type": "object"
    }
  },
  "required": [
    "nestId",
    "data"
  ]
}
```



**Responses:**
- `201`: Created


### `/{nestId}`


#### GET

**Get nest**

Get nest details [Requires: nest.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nestId | string |  |


**Responses:**
- `200`: Success
- `404`: Not Found

#### PUT

**Update nest**

Update a nest [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nestId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete nest**

Delete a nest [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nestId | string |  |


**Responses:**
- `200`: Success


### `/users`


#### GET

**List users**

Get all users [Requires: admin]





**Responses:**
- `200`: Success

#### POST

**Create user**

Create a new user [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    },
    "username": {
      "type": "string"
    },
    "password": {
      "type": "string"
    },
    "roleIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "email",
    "username",
    "password"
  ]
}
```



**Responses:**
- `201`: Created


### `/users/{userId}`


#### GET

**Get user**

Get user details [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| userId | string |  |


**Responses:**
- `200`: Success

#### PUT

**Update user**

Update user details [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string"
    },
    "username": {
      "type": "string"
    },
    "password": {
      "type": "string"
    },
    "roleIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| userId | string |  |


**Responses:**
- `200`: Success


### `/users/{userId}/delete`


#### POST

**Delete user**

Delete a user [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "force": {
      "type": "boolean"
    },
    "transferToUserId": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| userId | string |  |


**Responses:**
- `200`: Success


### `/users/{userId}/servers`


#### GET

**Get user servers**

Get servers owned by a user [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| userId | string |  |


**Responses:**
- `200`: Success


### `/nodes`


#### GET

**List all nodes**

Get all nodes [Requires: admin]





**Responses:**
- `200`: Success


### `/servers`


#### GET

**List all servers**

Get all servers [Requires: admin]





**Responses:**
- `200`: Success


### `/servers/actions`


#### POST

**Bulk server actions**

Perform bulk actions on servers [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "action": {
      "type": "string",
      "enum": [
        "start",
        "stop",
        "restart",
        "suspend",
        "unsuspend",
        "delete"
      ]
    },
    "reason": {
      "type": "string"
    }
  },
  "required": [
    "serverIds",
    "action"
  ]
}
```



**Responses:**
- `200`: Success


### `/roles`


#### GET

**List all roles**

Get all roles [Requires: admin]





**Responses:**
- `200`: Success


### `/audit-logs`


#### GET

**Audit logs**

Get audit logs [Requires: admin]





**Responses:**
- `200`: Success


### `/audit-logs/export`


#### GET

**Export audit logs**

Export audit logs [Requires: admin]





**Responses:**
- `200`: Success


### `/security-settings`


#### GET

**Get security settings**

Get security configuration [Requires: admin]





**Responses:**
- `200`: Success

#### PUT

**Update security settings**

Update security configuration [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "rateLimitMax": {
      "type": "number"
    },
    "rateLimitTimeWindow": {
      "type": "number"
    },
    "authRateLimitMax": {
      "type": "number"
    },
    "allowedFileExtensions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```



**Responses:**
- `200`: Success


### `/health`


#### GET

**System health**

Get system health status





**Responses:**
- `200`: Success


### `/ip-pools`


#### GET

**List IP pools**

Get all IP pools [Requires: admin]





**Responses:**
- `200`: Success

#### POST

**Create IP pool**

Create a new IP pool [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string"
    },
    "networkName": {
      "type": "string"
    },
    "cidr": {
      "type": "string"
    },
    "gateway": {
      "type": "string"
    },
    "startIp": {
      "type": "string"
    },
    "endIp": {
      "type": "string"
    }
  },
  "required": [
    "nodeId",
    "networkName",
    "cidr"
  ]
}
```



**Responses:**
- `201`: Created


### `/ip-pools/{poolId}`


#### PUT

**Update IP pool**

Update an IP pool [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "cidr": {
      "type": "string"
    },
    "gateway": {
      "type": "string"
    },
    "startIp": {
      "type": "string"
    },
    "endIp": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| poolId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete IP pool**

Delete an IP pool [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| poolId | string |  |


**Responses:**
- `200`: Success


### `/database-hosts`


#### GET

**List database hosts**

Get all database hosts [Requires: admin]





**Responses:**
- `200`: Success

#### POST

**Create database host**

Create a new database host [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "host": {
      "type": "string"
    },
    "port": {
      "type": "number"
    },
    "username": {
      "type": "string"
    },
    "password": {
      "type": "string"
    }
  },
  "required": [
    "name",
    "host",
    "port",
    "username",
    "password"
  ]
}
```



**Responses:**
- `201`: Created


### `/database-hosts/{hostId}`


#### PUT

**Update database host**

Update a database host [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "host": {
      "type": "string"
    },
    "port": {
      "type": "number"
    },
    "username": {
      "type": "string"
    },
    "password": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| hostId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete database host**

Delete a database host [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| hostId | string |  |


**Responses:**
- `200`: Success


### `/stats`


#### GET

**Dashboard stats**

Get dashboard statistics





**Responses:**
- `200`: Success


### `/alert-rules`


#### GET

**List alert rules**

Get all alert rules [Requires: alert.read]





**Responses:**
- `200`: Success

#### POST

**Create alert rule**

Create a new alert rule [Requires: alert.create]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "condition": {
      "type": "string"
    },
    "threshold": {
      "type": "number"
    },
    "action": {
      "type": "string"
    },
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "name",
    "condition",
    "threshold",
    "action"
  ]
}
```



**Responses:**
- `201`: Created


### `/alert-rules/{ruleId}`


#### GET

**Get alert rule**

Get alert rule details [Requires: alert.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| ruleId | string |  |


**Responses:**
- `200`: Success

#### PUT

**Update alert rule**

Update an alert rule [Requires: alert.update]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "condition": {
      "type": "string"
    },
    "threshold": {
      "type": "number"
    },
    "action": {
      "type": "string"
    },
    "enabled": {
      "type": "boolean"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| ruleId | string |  |


**Responses:**
- `200`: Success

#### DELETE

**Delete alert rule**

Delete an alert rule [Requires: alert.delete]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| ruleId | string |  |


**Responses:**
- `200`: Success


### `/alerts`


#### GET

**List alerts**

Get all alerts [Requires: alert.read]





**Responses:**
- `200`: Success


### `/alerts/{alertId}`


#### GET

**Get alert**

Get alert details [Requires: alert.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| alertId | string |  |


**Responses:**
- `200`: Success


### `/alerts/{alertId}/resolve`


#### POST

**Resolve alert**

Mark an alert as resolved [Requires: alert.update]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "note": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| alertId | string |  |


**Responses:**
- `200`: Success


### `/alerts/bulk-resolve`


#### POST

**Bulk resolve alerts**

Mark multiple alerts as resolved [Requires: alert.update]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "alertIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "note": {
      "type": "string"
    }
  },
  "required": [
    "alertIds"
  ]
}
```



**Responses:**
- `200`: Success


### `/alerts/{alertId}/deliveries`


#### GET

**Get alert deliveries**

Get delivery history for an alert [Requires: alert.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| alertId | string |  |


**Responses:**
- `200`: Success


### `/alerts/stats`


#### GET

**Alert statistics**

Get alert statistics [Requires: admin]





**Responses:**
- `200`: Success


### `/activity`


#### GET

**Recent activity**

Get recent activity





**Responses:**
- `200`: Success


### `/resources`


#### GET

**Resource summary**

Get resource usage summary





**Responses:**
- `200`: Success


### `/servers/{serverId}/metrics`


#### GET

**Server metrics**

Get metrics for a server [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/servers/{serverId}/stats`


#### GET

**Server stats**

Get current stats for a server [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/nodes/{nodeId}/metrics`


#### GET

**Node metrics**

Get metrics for a node [Requires: node.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| nodeId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/backups/{backupId}/download`


#### GET

**Download backup**

Download a backup [Requires: backup.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |
| backupId | string |  |


**Responses:**
- `200`: Success


### `/bulk/suspend`


#### POST

**Bulk suspend**

Suspend multiple servers [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "reason": {
      "type": "string"
    }
  },
  "required": [
    "serverIds"
  ]
}
```



**Responses:**
- `200`: Success


### `/bulk/unsuspend`


#### POST

**Bulk unsuspend**

Unsuspend multiple servers [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "serverIds"
  ]
}
```



**Responses:**
- `200`: Success


### `/bulk`


#### DELETE

**Bulk delete**

Delete multiple servers [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "serverIds"
  ]
}
```



**Responses:**
- `200`: Success


### `/bulk/status`


#### POST

**Bulk status**

Update status of multiple servers [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "status": {
      "type": "string"
    }
  },
  "required": [
    "serverIds",
    "status"
  ]
}
```



**Responses:**
- `200`: Success


### `/api-keys`


#### GET

**List API keys**

Get all API keys





**Responses:**
- `200`: Success

#### POST

**Create API key**

Create a new API key

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "expiresIn": {
      "type": "number"
    },
    "rateLimitEnabled": {
      "type": "boolean"
    },
    "rateLimitMax": {
      "type": "number"
    },
    "rateLimitTimeWindow": {
      "type": "number"
    }
  },
  "required": [
    "name"
  ]
}
```



**Responses:**
- `201`: Created


### `/api-keys/{keyId}`


#### DELETE

**Delete API key**

Delete an API key



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| keyId | string |  |


**Responses:**
- `200`: Success


### `/plugins`


#### GET

**List plugins**

Get all installed plugins [Requires: admin]





**Responses:**
- `200`: Success


### `/plugins/{name}`


#### GET

**Get plugin**

Get plugin details [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| name | string |  |


**Responses:**
- `200`: Success


### `/plugins/{name}/enable`


#### POST

**Enable plugin**

Enable a plugin [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| name | string |  |


**Responses:**
- `200`: Success


### `/plugins/{name}/reload`


#### POST

**Reload plugin**

Reload a plugin [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| name | string |  |


**Responses:**
- `200`: Success


### `/plugins/{name}/config`


#### PUT

**Update plugin config**

Update plugin configuration [Requires: admin]

**Request Body:**
```json
{
  "type": "object"
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| name | string |  |


**Responses:**
- `200`: Success


### `/plugins/{name}/frontend-manifest`


#### GET

**Plugin manifest**

Get plugin frontend manifest



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| name | string |  |


**Responses:**
- `200`: Success


### `/admin/migration/catalyst-nodes`


#### GET

**Get Pterodactyl nodes**

Get nodes from Pterodactyl for migration [Requires: admin]





**Responses:**
- `200`: Success


### `/admin/migration/test`


#### POST

**Test migration**

Test migration connection [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "host": {
      "type": "string"
    },
    "apiKey": {
      "type": "string"
    }
  },
  "required": [
    "host",
    "apiKey"
  ]
}
```



**Responses:**
- `200`: Success


### `/admin/migration/start`


#### POST

**Start migration**

Start a Pterodactyl to Catalyst migration [Requires: admin]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "host": {
      "type": "string"
    },
    "apiKey": {
      "type": "string"
    },
    "nodeId": {
      "type": "string"
    },
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "host",
    "apiKey",
    "nodeId"
  ]
}
```



**Responses:**
- `201`: Created


### `/admin/migration`


#### GET

**List migrations**

Get all migration jobs [Requires: admin]





**Responses:**
- `200`: Success


### `/admin/migration/{jobId}`


#### GET

**Get migration job**

Get migration job status [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| jobId | string |  |


**Responses:**
- `200`: Success


### `/admin/migration/{jobId}/pause`


#### POST

**Pause migration**

Pause a running migration [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| jobId | string |  |


**Responses:**
- `200`: Success


### `/admin/migration/{jobId}/resume`


#### POST

**Resume migration**

Resume a paused migration [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| jobId | string |  |


**Responses:**
- `200`: Success


### `/admin/migration/{jobId}/cancel`


#### POST

**Cancel migration**

Cancel a migration job [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| jobId | string |  |


**Responses:**
- `200`: Success


### `/admin/migration/{jobId}/steps`


#### GET

**Get migration steps**

Get steps for a migration job [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| jobId | string |  |


**Responses:**
- `200`: Success


### `/admin/migration/{jobId}/retry/{stepId}`


#### POST

**Retry migration step**

Retry a failed migration step [Requires: admin]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| jobId | string |  |
| stepId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/console`


#### GET

**Console stream**

SSE stream for server console output [Requires: console.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/console/command`


#### POST

**Send console command**

Send a command to the server console [Requires: console.write]

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string"
    }
  },
  "required": [
    "command"
  ]
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/events`


#### GET

**Server events stream**

SSE stream for server events



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/{serverId}/metrics/stream`


#### GET

**Metrics stream**

SSE stream for real-time server metrics [Requires: server.read]



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| serverId | string |  |


**Responses:**
- `200`: Success


### `/internal/file-tunnel/poll`


#### GET

**Poll file tunnel**

Poll for file tunnel requests





**Responses:**
- `200`: Success


### `/internal/file-tunnel/response/{requestId}`


#### POST

**File tunnel response**

Send file tunnel response

**Request Body:**
```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "string"
    },
    "error": {
      "type": "string"
    }
  }
}
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| requestId | string |  |


**Responses:**
- `200`: Success


### `/internal/file-tunnel/response/{requestId}/stream`


#### POST

**File tunnel stream**

Stream file tunnel response



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| requestId | string |  |


**Responses:**
- `200`: Success


### `/internal/file-tunnel/upload/{requestId}`


#### GET

**File tunnel upload**

Upload file via tunnel



**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| requestId | string |  |


**Responses:**
- `200`: Success


