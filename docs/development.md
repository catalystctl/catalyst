# Development Guide

## Environment Configuration

Catalyst uses centralized environment variable access through `src/config.ts`. This provides:

- **Type safety**: All env vars are validated at startup with Zod schemas
- **Clear documentation**: Config object structure shows all available settings
- **Fast failure**: Invalid or missing required env vars fail at startup, not at runtime

### Using Config

Import the config object instead of accessing `process.env` directly:

```typescript
import { config } from './config.js';

// ✅ Good - typed and validated
const dbUrl = config.database.url;
const port = config.server.port;
const isRedisEnabled = config.redis.enabled;

// ❌ Bad - no validation, type is always string | undefined
const dbUrl = process.env.DATABASE_URL;
const port = process.env.PORT;
```

### Config Structure

The config object is organized by domain:

- `config.server` - Server settings (port, host, nodeEnv, workers)
- `config.database` - Database connection (url, timeouts)
- `config.redis` - Redis settings (url, enabled flag)
- `config.auth` - Authentication secrets (betterAuthSecret, apiKeySecret)
- `config.backend` - Backend URLs (externalAddress, publicUrl, frontendUrl)
- `config.cors` - CORS configuration (origin, devExtraOrigins)
- `config.suspension` - Suspension enforcement (enforced, deletePolicy)
- `config.backup` - Backup paths and credentials
- `config.serverData` - Server data directory
- `config.rateLimit` - Rate limiting flags
- `config.webhook` - Webhook configuration
- `config.plugin` - Plugin marketplace settings
- `config.autoUpdate` - Auto-update settings
- `config.deploy` - Deployment settings
- `config.timezone` - Timezone configuration
- `config.cluster` - Cluster/worker settings

### Adding New Config Values

1. Add a schema in `src/config.ts`:
   ```typescript
   const myFeatureSchema = z.object({
     enabled: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
     endpoint: z.string().optional(),
   });
   ```

2. Add to the root schema:
   ```typescript
   const configSchema = z.object({
     // ... existing schemas
     myFeature: myFeatureSchema,
   });
   ```

3. Load the env vars in `loadConfig()`:
   ```typescript
   const raw = {
     // ... existing
     myFeature: {
       enabled: process.env.MY_FEATURE_ENABLED,
       endpoint: process.env.MY_FEATURE_ENDPOINT,
     },
   };
   ```

4. Use in your code:
   ```typescript
   if (config.myFeature.enabled) {
     await fetch(config.myFeature.endpoint);
   }
   ```

## Running Tests

```bash
# Backend tests
pnpm --filter catalyst-backend run test

# Frontend tests  
pnpm --filter catalyst-frontend run test

# With coverage
pnpm --filter catalyst-backend run test:coverage
```

## Type Checking

```bash
# Backend
pnpm --filter catalyst-backend run typecheck

# Frontend
cd catalyst-frontend && npx tsc --noEmit
```

## Linting

```bash
# Backend
pnpm --filter catalyst-backend run lint

# Frontend
pnpm --filter catalyst-frontend run lint
```

## Local Development

1. Start infrastructure:
   ```bash
   pnpm run dev:infra  # Starts PostgreSQL and Redis
   ```

2. Run migrations:
   ```bash
   pnpm --filter catalyst-backend run db:migrate
   ```

3. Seed admin account:
   ```bash
   pnpm run db:seed:admin
   ```

4. Start dev servers:
   ```bash
   pnpm run dev  # Backend on :3000, frontend on :5173
   ```

See the main [AGENTS.md](../AGENTS.md) for complete development workflow and CI/CD information.
