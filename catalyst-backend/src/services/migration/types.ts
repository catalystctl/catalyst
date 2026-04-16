/**
 * Pterodactyl Application API v1.x response types
 * Supports both legacy (data.attributes) and modern response shapes
 */

// ============================================================================
// PAGINATION
// ============================================================================

export interface PterodactylPagination {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  total_pages?: number;
}

export interface PterodactylListResponse<T> {
  object: "list";
  data: PterodactylResource<T>[];
  meta: {
    pagination: PterodactylPagination;
  };
}

export interface PterodactylResource<T> {
  attributes: T;
}

export interface PterodactylSingleResponse<T> {
  object: "server" | "user" | "node" | "location" | "egg" | "nest" | "schedule" | "backup" | "database" | "database_host" | "allocation" | "subuser";
  attributes: T;
  meta?: Record<string, unknown>;
}

// ============================================================================
// ENTITIES
// ============================================================================

export interface PterodactylLocation {
  id: number;
  short: string;
  long: string;
  created_at: string;
  updated_at: string;
}

export interface PterodactylNode {
  id: number;
  name: string;
  description?: string;
  location_id: number;
  fqdn: string;
  scheme: "https" | "http";
  behind_proxy: boolean;
  memory: number;
  memory_overallocate: number;
  disk: number;
  disk_overallocate: number;
  upload_size: number;
  daemon_base: string;
  daemon_sftp: number;
  daemon_listen: number;
  maintenance_mode: boolean;
  maximum_servers?: number;
  current_servers?: number;
  created_at: string;
  updated_at: string;
}

export interface PterodactylNest {
  id: number;
  uuid: string;
  author: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface PterodactylEggVariable {
  id: number;
  name: string;
  description: string;
  env_variable: string;
  default_value: string;
  user_viewable: boolean;
  user_editable: boolean;
  rules: string;
  created_at: string;
  updated_at: string;
}

export interface PterodactylEgg {
  id: number;
  uuid: string;
  name: string;
  nest: number;
  author: string;
  description: string;
  features?: string | string[];
  docker_image: string;
  docker_images?: Record<string, string>;
  config?: {
    files?: Record<string, unknown>;
    startup?: Record<string, unknown> | string;
    stop?: string;
    logs?: unknown;
    file_denylist?: string[];
    extends?: string | null;
  };
  startup: string;
  script?: {
    privileged?: boolean;
    install?: string;
    entry?: string;
    container?: string;
    extends?: string | null;
  };
  copy_script_from?: number;
  created_at: string;
  updated_at: string;
  /** Legacy flat fields from egg export format — may not exist in API response */
  config_files?: string | Record<string, unknown>;
  config_startup?: Record<string, unknown>;
  config_logs?: Record<string, unknown>;
  config_stop?: string;
  stop?: string;
  install_script?: string;
  /** Raw API response fields */
  [key: string]: unknown;
  // Relationships (when included)
  relationships?: {
    variables?: PterodactylResource<PterodactylEggVariable>[];
    nest?: PterodactylResource<PterodactylNest>;
  };
}

export interface PterodactylUser {
  id: number;
  external_id?: string;
  uuid: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  language: string;
  is_root_admin: boolean;
  use_totp: boolean;
  created_at: string;
  updated_at: string;
  relationships?: {
    servers?: PterodactylResource<PterodactylUserServer>[];
  };
  /** Raw API response (may have different field names in some versions) */
  root_admin?: boolean;
  [key: string]: unknown;
}

export interface PterodactylUserServer {
  id: number;
  uuid: string;
  name: string;
  description: string;
}

export interface PterodactylAllocation {
  id: number;
  ip: string;
  port: number;
  ip_alias?: string;
  server_id?: number;
  notes?: string;
}

export interface PterodactylServer {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  suspended: boolean;
  external_id?: string;
  identifier: string;
  node: number;
  nest: number;
  egg: number;
  docker_image?: string;
  startup?: string;
  skip_scripts?: boolean;
  limits: {
    memory: number;
    swap: number;
    disk: number;
    io: number;
    cpu: number;
    threads?: string | null;
    oom_disabled?: boolean;
  };
  feature_limits: {
    databases: number;
    allocations: number;
    backups: number;
  };
  allocation: number | {
    ip: string;
    port: number;
    ip_alias?: string;
  };
  allocations: PterodactylAllocation[] | null;
  environment?: Record<string, string>;
  backups?: number;
  created_at: string;
  updated_at: string;
  /** v1.12.x nests container info */
  container?: {
    startup_command?: string;
    image?: string;
    installed?: number;
    environment?: Record<string, string>;
  };
  relationships?: {
    variables?: PterodactylResource<PterodactylEggVariable>[];
    location?: PterodactylResource<PterodactylLocation>;
    node?: PterodactylResource<PterodactylNode>;
    nest?: PterodactylResource<PterodactylNest>;
    egg?: PterodactylResource<PterodactylEgg>;
  };
}

export interface PterodactylSubuser {
  id: number;
  user_id: number;
  server_id: number;
  permissions: string[];
  relationships?: {
    user?: PterodactylResource<PterodactylUser>;
  };
}

export interface PterodactylDatabaseHost {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  max_connections: number;
  node_id?: number;
  linked_node?: number;
  created_at: string;
  updated_at: string;
}

export interface PterodactylDatabase {
  id: number;
  server_id: number;
  host: number;
  name: string;
  username: string;
  password?: string;
  max_connections: number;
  remote: string;
  created_at: string;
  updated_at: string;
  relationships?: {
    host?: PterodactylResource<PterodactylDatabaseHost>;
  };
}

export interface PterodactylScheduleTask {
  id: number;
  action: "command" | "power" | "backup";
  payload: string;
  time_offset: number;
  sequence_id: number;
  created_at: string;
  updated_at: string;
}

export interface PterodactylSchedule {
  id: number;
  name: string;
  /** v1.12.x: nested cron object */
  cron?: {
    day_of_week?: string;
    day_of_month?: string;
    month?: string;
    hour?: string;
    minute?: string;
  };
  /** Pre-v1.12.x: flat cron fields */
  cron_day_of_week?: string;
  cron_day_of_month?: string;
  cron_hour?: string;
  cron_minute?: string;
  is_active: boolean;
  is_processing?: boolean;
  only_when_online?: boolean;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
  /** v1.12.x client API: tasks wrapped in {object, data[]} */
  relationships?: {
    tasks?: PterodactylResource<PterodactylScheduleTask>[] | { object?: string; data?: PterodactylResource<PterodactylScheduleTask>[] };
  };
}

export interface PterodactylBackup {
  id?: number;
  uuid: string;
  name: string;
  ignored_files?: string | string[];
  checksum?: string;
  checksum_type?: string;
  bytes: number;
  created_at: string;
  completed_at?: string;
  /** v1.x client API field */
  is_successful?: boolean;
  /** v1.x client API field */
  is_locked?: boolean;
  relationships?: {
    server?: PterodactylResource<PterodactylServer>;
  };
}

// ============================================================================
// PERMISSION MAPPING
// ============================================================================

/** Pterodactyl subuser permission → Catalyst permission mapping */
export const PTERODACTYL_PERMISSION_MAP: Record<string, string> = {
  "console": "console.read",
  "console.command": "console.write",
  "console.send": "console.write",
  "console.receive": "console.read",
  "power.start": "server.start",
  "power.stop": "server.stop",
  "power.restart": "server.start",
  "power.kill": "server.stop",
  "backup": "backup.read",
  "backup.create": "backup.create",
  "backup.delete": "backup.delete",
  "backup.download": "backup.read",
  "backup.restore": "backup.restore",
  "files.read": "file.read",
  "files.write": "file.write",
  "files.create": "file.write",
  "files.delete": "file.write",
  "files.download": "file.read",
  "files.upload": "file.write",
  "files.list": "file.read",
  "schedules.read": "server.read",
  "schedules.create": "server.schedule",
  "schedules.edit": "server.schedule",
  "schedules.delete": "server.schedule",
  "databases.read": "database.read",
  "databases.create": "database.create",
  "databases.delete": "database.delete",
  "databases.view_password": "database.read",
  "allocations.read": "server.read",
  "startup.read": "server.read",
  "startup.command": "server.read",
  "startup.docker-image": "server.read",
  "users.read": "server.read",
};

// ============================================================================
// MIGRATION CONFIG
// ============================================================================

export interface MigrationJobConfig {
  nodeMapping: "hybrid" | "create" | "map";
  dryRun?: boolean;
  phases?: string[];
  selectedNodes?: string[];
  /** Client API key (ptlc_*) — required for backup/schedule/subuser migration in Pterodactyl v1.x */
  clientApiKey?: string;
}

export const MIGRATION_PHASES = [
  "validate",
  "locations",
  "templates",
  "users",
  "servers",
  "subusers",
  "databases",
  "schedules",
  "backups",
  "files",
] as const;

export type MigrationPhase = (typeof MIGRATION_PHASES)[number];
