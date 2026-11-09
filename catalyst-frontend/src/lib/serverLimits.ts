/**
 * Server resource bounds the panel enforces in its forms.
 *
 * These mirror the backend contract in
 * `catalyst-backend/src/lib/validation.ts` (`serverCreateSchema` /
 * `serverUpdateSchema`). They are duplicated rather than fetched because the
 * forms need them before any request; a mismatch shows up as the API rejecting
 * a value the form offered, which surfaced as an opaque "Invalid request body".
 * Keep them in sync with the backend, and with the MCP tool descriptions.
 */
export const MIN_MEMORY_MB = 512;
export const MAX_MEMORY_MB = 131072;
export const MIN_CPU_CORES = 1;
export const MAX_CPU_CORES = 128;
export const MIN_DISK_MB = 1024;
export const MAX_DISK_MB = 1048576;
/** Database quota a server may be granted (server_update/create/clone agree). */
export const MAX_DATABASE_ALLOCATION = 1024;
export const MAX_BACKUP_ALLOCATION_MB = 1048576;

/**
 * Characters a server name may contain. The backend `serverNameSchema` is the
 * authority; the forms validate with the same pattern so a rejected name is
 * reported next to the input instead of as a failed request.
 */
export const SERVER_NAME_PATTERN = /^[a-zA-Z0-9\-_ .()&']+$/;
export const MAX_SERVER_NAME_LENGTH = 100;
