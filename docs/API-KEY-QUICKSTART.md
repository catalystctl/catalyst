# API Key Quick Start Guide

## Test Results ✅

All API key functionality has been tested and verified working:

```bash
✓ Admin login working
✓ API key creation working
✓ API key authentication working (5 endpoints tested)
✓ Invalid key rejection working
✓ Key listing working
✓ Key details retrieval working
✓ Key disable working
✓ Key deletion working
```

## Quick Start

### 1. Run the Complete Test Suite

```bash
./test-apikey-complete.sh
```

This will:
- Create a test API key
- Test authentication on 5 different endpoints
- Verify invalid key rejection
- Test key listing, details, disable, and delete operations

### 2. Create Your Own API Key

Via curl:
```bash
# Login
curl -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Create API key
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -H "Cookie: $(cat cookies.txt)" \
  -d '{
    "name": "My Integration",
    "expiresAt": null,
    "rateLimitEnabled": true,
    "rateLimitMax": 100,
    "rateLimitTimeWindow": 60000
  }' | jq '.data.key'
```

Via Admin UI:
1. Login to http://localhost:5173
2. Navigate to Admin → API Keys
3. Click "Create API Key"
4. Fill in the form and click Create
5. **Copy the key immediately** (it's only shown once!)

### 3. Use Your API Key

```bash
export API_KEY="catalyst_your_key_here"

# List servers
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers

# Get server details
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/servers/{server-id}

# Start a server
curl -X POST -H "x-api-key: $API_KEY" http://localhost:3000/api/servers/{server-id}/start
```

## Important Notes

### Authentication Header

**You MUST use the `x-api-key` header:**

```bash
# ✅ Correct
curl -H "x-api-key: catalyst_xxx" http://localhost:3000/api/servers

# ❌ Wrong (will not work)
curl -H "Authorization: Bearer catalyst_xxx" http://localhost:3000/api/servers
```

This is better-auth's convention. The `x-api-key` header automatically creates a session for the request.

### Rate Limiting

- Default: 100 requests per 60 seconds (1 minute)
- Configurable per key when creating
- Exceeding the limit returns HTTP 429

### Security

- Keys are hashed with bcrypt (never stored in plaintext)
- Keys are only shown once at creation
- Can be disabled instantly via the admin UI
- All operations are audit logged

## Examples

### Node.js

```javascript
const axios = require('axios');

const client = axios.create({
  baseURL: 'http://localhost:3000',
  headers: {
    'x-api-key': process.env.CATALYST_API_KEY
  }
});

// List all servers
const { data } = await client.get('/api/servers');
console.log(`Found ${data.data.length} servers`);

// Start a server
await client.post(`/api/servers/${serverId}/start`);
```

### Python

```python
import requests
import os

API_KEY = os.environ['CATALYST_API_KEY']
BASE_URL = 'http://localhost:3000'

headers = {'x-api-key': API_KEY}

# List servers
response = requests.get(f'{BASE_URL}/api/servers', headers=headers)
servers = response.json()['data']
print(f"Found {len(servers)} servers")

# Start a server
requests.post(f'{BASE_URL}/api/servers/{server_id}/start', headers=headers)
```

### Bash Script

```bash
#!/bin/bash

API_KEY="${CATALYST_API_KEY}"
BASE_URL="http://localhost:3000"

# Function to make authenticated requests
catalyst_api() {
  curl -s -H "x-api-key: $API_KEY" "$BASE_URL$1"
}

# Get all servers
SERVERS=$(catalyst_api "/api/servers")
echo "$SERVERS" | jq '.data[] | {id, name, status}'

# Start a specific server
catalyst_api "/api/servers/server-123/start" | jq .
```

## Troubleshooting

### "Unauthorized" Error

1. Verify you're using the `x-api-key` header (not `Authorization`)
2. Check if the key is enabled in the admin UI
3. Verify the key hasn't expired
4. Ensure you copied the full key (they're quite long)

### "Rate limit exceeded" Error

- Wait for the time window to reset (check `retryAfter` in response)
- Or increase the rate limit for your key in the admin UI

### Key Not Working After Creation

- Make sure you copied the entire key (64 characters after the prefix)
- Keys are case-sensitive
- Check the backend logs for authentication errors

## Complete Documentation

For full documentation, see: `docs/api-keys.md`

## Test Scripts

- `./test-apikey-complete.sh` - Complete test suite (recommended)
- `./test-apikey-auth.sh` - Authentication and rate limit tests

Both scripts will create temporary test keys and clean them up afterward.
