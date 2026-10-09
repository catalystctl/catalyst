# Database Migration Guide

Emergency procedures and best practices for managing Catalyst database migrations in production.

## Table of Contents

- [Migration Overview](#migration-overview)
- [Pre-Deployment Testing](#pre-deployment-testing)
- [Emergency Rollback Procedures](#emergency-rollback-procedures)
- [Manual Migration Revert](#manual-migration-revert)
- [Backup and Restore](#backup-and-restore)
- [Common Failure Scenarios](#common-failure-scenarios)
- [Safe Migration Practices](#safe-migration-practices)

---

## Migration Overview

Catalyst uses Prisma migrations to manage database schema changes. Migrations are applied automatically during container startup via `prisma migrate deploy` in `catalyst-backend/docker-entrypoint.sh`.

**Critical facts:**

- Migrations run **automatically** on backend container start
- Failed migrations prevent the backend from starting
- `prisma migrate deploy` only applies committed migration files (never generates new ones)
- Schema changes without migrations are invisible to production databases

---

## Pre-Deployment Testing

### Test Migrations in Staging

**Always test migrations in a staging environment with production-like data before deploying to production.**

```bash
# 1. Copy production data to staging (sanitize sensitive data)
pg_dump -h prod-host -U catalyst catalyst_db \
  | psql -h staging-host -U catalyst catalyst_db

# 2. Apply migrations in staging
docker compose exec backend npx prisma migrate deploy \
  --config prisma/prisma.config.ts

# 3. Verify application starts and critical flows work
# - User login
# - Server operations
# - Backup operations
```

### Dry-Run Migration Check

Before deploying, verify what Prisma will execute:

```bash
# Generate SQL for pending migrations (development only)
cd catalyst-backend
pnpm run db:migrate -- --create-only

# Review the generated SQL in prisma/migrations/<timestamp>_<name>/migration.sql
# Check for:
# - Data loss (DROP TABLE, DROP COLUMN)
# - Long-running operations (ALTER TABLE on large tables)
# - Missing indexes that could cause performance issues
```

### Validate Migration Files

```bash
# Ensure all migrations are committed
git status prisma/migrations/

# Check migration history integrity
npx prisma migrate status --config prisma/prisma.config.ts
```

---

## Emergency Rollback Procedures

### Scenario 1: Migration Failed, Backend Won't Start

**Symptoms:** Backend container crash-loops with Prisma migration errors in logs.

**Immediate Response:**

```bash
# 1. Check backend logs for the specific migration failure
docker compose logs backend | grep -A 20 "Migration failed"

# 2. Restore the previous Docker image version
docker compose down
docker compose pull  # pulls previous tagged version
docker compose up -d

# 3. If using :latest tag, explicitly specify the last working version
docker compose down
# Edit docker-compose.yml or set IMAGE_TAG in .env
docker compose up -d backend
```

**Root Cause Investigation:**

```bash
# Connect to the database and check migration state
docker compose exec postgres psql -U catalyst catalyst_db

# Inside psql:
SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5;

# Look for failed migrations (failed_at IS NOT NULL)
```

### Scenario 2: Migration Applied, Application Broken

**Symptoms:** Backend started successfully, but critical features fail at runtime.

**Immediate Response:**

```bash
# 1. Stop the backend to prevent further damage
docker compose stop backend

# 2. Restore from the most recent pre-migration backup
# (See "Backup and Restore" section below)

# 3. Deploy the previous application version
git log --oneline prisma/schema.prisma  # find last working commit
git checkout <commit-hash> catalyst-backend/
docker compose build backend
docker compose up -d backend
```

### Scenario 3: Rollback After Successful Deployment

**When a migration introduces issues discovered hours/days later.**

**Procedure:**

1. **Create a reverse migration** (preferred for data-preserving rollbacks)
2. **Restore from backup** (faster but loses recent data)

See sections below for detailed steps.

---

## Manual Migration Revert

### Step 1: Mark Failed Migration as Rolled Back

Connect to the database and update the migration record:

```bash
docker compose exec postgres psql -U catalyst catalyst_db
```

```sql
-- Find the failed migration
SELECT migration_name, finished_at, rolled_back_at 
FROM "_prisma_migrations" 
ORDER BY finished_at DESC 
LIMIT 5;

-- Mark it as rolled back (replace with actual migration name)
UPDATE "_prisma_migrations"
SET rolled_back_at = NOW()
WHERE migration_name = '20241009120000_failed_migration';
```

### Step 2: Manually Revert Database Changes

**For additive changes (safe):**

```sql
-- Example: Revert a new column
ALTER TABLE "User" DROP COLUMN "newField";

-- Example: Revert a new table
DROP TABLE "NewFeature";

-- Example: Revert an index
DROP INDEX "User_email_newField_idx";
```

**For destructive changes (data at risk):**

```sql
-- Example: Restore a dropped column (data lost unless backed up)
ALTER TABLE "User" ADD COLUMN "deletedField" TEXT;
-- Restore data from backup if available

-- Example: Restore dropped table from backup
-- (see Backup and Restore section)
```

### Step 3: Remove Migration from Codebase

```bash
cd catalyst-backend/prisma/migrations

# Remove the failed migration directory
rm -rf 20241009120000_failed_migration/

# Revert schema.prisma to the previous state
git checkout HEAD~1 schema.prisma

# Regenerate Prisma Client
pnpm run db:generate
```

### Step 4: Verify and Redeploy

```bash
# Verify migration status
npx prisma migrate status --config prisma/prisma.config.ts

# Run tests
pnpm run test

# Rebuild and deploy
docker compose build backend
docker compose up -d backend
```

---

## Backup and Restore

### Pre-Migration Backup Procedure

**Critical: Always back up before applying migrations in production.**

```bash
# 1. Create a timestamped backup
export BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
export POSTGRES_HOST=localhost  # or your host
export POSTGRES_USER=catalyst
export POSTGRES_DB=catalyst_db

# 2. Dump database
docker compose exec -T postgres pg_dump \
  -U $POSTGRES_USER \
  -d $POSTGRES_DB \
  --format=custom \
  --file=/tmp/pre_migration_${BACKUP_DATE}.dump

# 3. Copy backup out of container
docker compose cp postgres:/tmp/pre_migration_${BACKUP_DATE}.dump \
  ./backups/pre_migration_${BACKUP_DATE}.dump

# 4. Verify backup integrity
pg_restore --list ./backups/pre_migration_${BACKUP_DATE}.dump | head -20
```

### Restore from Backup

**Restoring overwrites the current database. All data after the backup is lost.**

```bash
# 1. Stop the backend to prevent writes during restore
docker compose stop backend

# 2. Copy backup into container
docker compose cp \
  ./backups/pre_migration_20241009_100000.dump \
  postgres:/tmp/restore.dump

# 3. Drop and recreate the database
docker compose exec postgres psql -U catalyst -d postgres -c \
  "DROP DATABASE IF EXISTS catalyst_db;"
  
docker compose exec postgres psql -U catalyst -d postgres -c \
  "CREATE DATABASE catalyst_db OWNER catalyst;"

# 4. Restore the backup
docker compose exec postgres pg_restore \
  -U catalyst \
  -d catalyst_db \
  --no-owner \
  --no-acl \
  /tmp/restore.dump

# 5. Verify restore
docker compose exec postgres psql -U catalyst -d catalyst_db -c \
  "SELECT COUNT(*) FROM \"User\";"

# 6. Restart backend
docker compose up -d backend
```

### Automated Pre-Migration Backup Script

Add to deployment workflow:

```bash
#!/bin/bash
# scripts/pre-migration-backup.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups/migrations}"
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/pre_migration_${BACKUP_DATE}.dump"

mkdir -p "$BACKUP_DIR"

echo "Creating pre-migration backup: $BACKUP_FILE"

docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-catalyst}" \
  -d "${POSTGRES_DB:-catalyst_db}" \
  --format=custom \
  --file=/tmp/backup.dump

docker compose cp postgres:/tmp/backup.dump "$BACKUP_FILE"

echo "✓ Backup created: $BACKUP_FILE"
echo "  Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Keep only last 10 migration backups
ls -t "$BACKUP_DIR"/pre_migration_*.dump | tail -n +11 | xargs -r rm

echo "✓ Old backups cleaned (keeping 10 most recent)"
```

Usage in deployment:

```bash
# Before deploying new version
./scripts/pre-migration-backup.sh
docker compose pull
docker compose up -d
```

---

## Common Failure Scenarios

### Migration Timeout on Large Tables

**Problem:** `ALTER TABLE` on a table with millions of rows takes too long and times out.

**Prevention:**

- Test with production-sized data in staging
- Use `CREATE INDEX CONCURRENTLY` for indexes (requires raw SQL migrations)
- Break large migrations into smaller steps

**Recovery:**

```bash
# If migration timed out but partially applied:
# 1. Check what was completed
docker compose exec postgres psql -U catalyst catalyst_db
\d "LargeTable"  -- check if column/index exists

# 2. Manually complete or rollback
# 3. Mark migration as completed or rolled back
UPDATE "_prisma_migrations" SET finished_at = NOW() 
WHERE migration_name = '<name>';
```

### Missing Column Runtime Errors

**Problem:** Application expects a column that doesn't exist (migration wasn't applied).

**Diagnosis:**

```sql
-- Check if column exists
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'User' AND column_name = 'expectedField';

-- Check migration status
SELECT * FROM "_prisma_migrations" 
WHERE migration_name LIKE '%expected_migration%';
```

**Resolution:**

```bash
# Manually apply the missing migration
docker compose exec backend npx prisma migrate deploy \
  --config prisma/prisma.config.ts
```

### Foreign Key Constraint Violations

**Problem:** Migration tries to add a foreign key, but existing data violates it.

**Prevention:**

```sql
-- In the migration, clean up invalid data first:
DELETE FROM "ServerAccess" 
WHERE "userId" NOT IN (SELECT "id" FROM "User");

-- Then add the constraint:
ALTER TABLE "ServerAccess" 
ADD CONSTRAINT "ServerAccess_userId_fkey" 
FOREIGN KEY ("userId") REFERENCES "User"("id");
```

---

## Safe Migration Practices

### Development Workflow

```bash
# 1. Make schema changes in schema.prisma
# 2. Generate migration
pnpm --filter catalyst-backend run db:migrate

# 3. Review generated SQL
cat catalyst-backend/prisma/migrations/<timestamp>_<name>/migration.sql

# 4. Test locally
pnpm --filter catalyst-backend run test

# 5. Commit migration with code changes
git add catalyst-backend/prisma/
git commit -m "feat: add user preferences field"
```

### Safe Migration Patterns

**✅ Additive changes (safe):**

- Add nullable columns
- Add new tables
- Add indexes
- Add new enums

**⚠️ Potentially breaking changes (test thoroughly):**

- Add non-nullable columns (provide default or backfill first)
- Rename columns/tables (requires code changes in the same deploy)
- Change column types (may fail if data incompatible)
- Add unique constraints (may fail if duplicates exist)

**❌ Destructive changes (require manual steps):**

- Drop columns/tables (backup data first)
- Remove enum values (ensure no rows use them)
- Reduce column size (may truncate data)

### Multi-Step Migrations for Breaking Changes

**Example: Renaming a column safely**

Step 1 (deploy): Add new column, backfill data

```prisma
model User {
  oldName String?
  newName String?
}
```

```sql
-- In migration.sql:
ALTER TABLE "User" ADD COLUMN "newName" TEXT;
UPDATE "User" SET "newName" = "oldName";
```

Step 2 (deploy): Update code to use new column

Step 3 (deploy): Drop old column

```prisma
model User {
  newName String
}
```

### Testing Checklist

Before merging a migration:

- [ ] Migration tested in development
- [ ] Migration tested in staging with production-like data
- [ ] Verified no N+1 queries introduced
- [ ] Verified indexes added for new foreign keys
- [ ] Backend tests pass
- [ ] Rollback procedure documented (if destructive)
- [ ] Pre-migration backup plan confirmed

---

## Production Deployment Checklist

```bash
# 1. Announce maintenance window (if downtime expected)
# 2. Create pre-migration backup
./scripts/pre-migration-backup.sh

# 3. Test migration in staging
# 4. Deploy with automatic rollback plan
docker compose pull
docker compose up -d

# 5. Monitor backend logs for migration errors
docker compose logs -f backend | grep -i migration

# 6. Verify application health
curl http://localhost/health
# Test critical user flows in UI

# 7. Monitor application metrics for 1 hour
# - Error rates
# - Response times
# - Database query performance

# 8. If issues detected, execute rollback procedure
```

---

## Additional Resources

- [Prisma Migrate Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [PostgreSQL Backup/Restore Guide](https://www.postgresql.org/docs/current/backup.html)
- [Catalyst Development Guide](development.md)
- [Catalyst Architecture](architecture.md)

---

## Getting Help

If you encounter a migration issue:

1. Check backend logs: `docker compose logs backend | grep -i migration`
2. Check database migration status: `SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 10;`
3. Review this guide's [Common Failure Scenarios](#common-failure-scenarios)
4. Join the [Catalyst Discord](https://discord.gg/mybxhmru3y) for community support
5. Report issues at https://github.com/catalystctl/catalyst/issues
