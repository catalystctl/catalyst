import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/util/ds_error.ts
import { TaggedError } from "better-result";

class DurableStreamsError extends TaggedError("DurableStreamsError")() {
}
function dsError(message, opts) {
  return new DurableStreamsError({
    message,
    ...opts?.cause !== undefined ? { cause: opts.cause } : {},
    ...opts?.code !== undefined ? { code: opts.code } : {}
  });
}

// src/local/common.ts
function readOptionValue(args, flag) {
  const idx = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (idx === -1)
    return { found: false };
  const raw = args[idx];
  if (raw.includes("="))
    return { found: true, value: raw.split("=", 2)[1] };
  const next = args[idx + 1];
  if (!next || next.startsWith("--"))
    return { found: true };
  return { found: true, value: next };
}
function readFirstPositionalArg(args) {
  for (let i = 0;i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--name" || arg === "--hostname" || arg === "--port") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--name=") || arg.startsWith("--hostname=") || arg.startsWith("--port=")) {
      continue;
    }
    if (!arg.startsWith("--"))
      return arg;
  }
  return;
}
function parseLocalProcessOptions(args, opts = {}) {
  const out = {};
  const name = readOptionValue(args, "--name");
  if (name.found)
    out.name = name.value ?? "default";
  else if (opts.allowPositionalName) {
    out.name = readFirstPositionalArg(args) ?? opts.defaultNameWhenMissing;
  } else if (opts.defaultNameWhenMissing != null) {
    out.name = opts.defaultNameWhenMissing;
  }
  const hostname = readOptionValue(args, "--hostname");
  if (hostname.found)
    out.hostname = hostname.value ?? "127.0.0.1";
  else if (opts.defaultHostnameWhenMissing != null)
    out.hostname = opts.defaultHostnameWhenMissing;
  const port = readOptionValue(args, "--port");
  if (port.found)
    out.port = parsePortValue(port.value ?? "0");
  else if (opts.defaultPortWhenMissing != null)
    out.port = opts.defaultPortWhenMissing;
  return out;
}
function parsePortValue(raw, flag = "--port") {
  const port = Number(raw);
  if (!Number.isFinite(port) || port < 0) {
    throw dsError(`invalid ${flag}: ${raw}`);
  }
  return Math.floor(port);
}

// src/app_core.ts
import { mkdirSync } from "node:fs";

// src/db/schema.ts
var SCHEMA_VERSION = 11;
var DEFAULT_PRAGMAS_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
`;
var CREATE_TABLES_V4_SQL = `
CREATE TABLE IF NOT EXISTS streams (
  stream TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,

  content_type TEXT NOT NULL,
  stream_seq TEXT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  closed_producer_id TEXT NULL,
  closed_producer_epoch INTEGER NULL,
  closed_producer_seq INTEGER NULL,
  ttl_seconds INTEGER NULL,

  epoch INTEGER NOT NULL,
  next_offset INTEGER NOT NULL,
  sealed_through INTEGER NOT NULL,
  uploaded_through INTEGER NOT NULL,
  uploaded_segment_count INTEGER NOT NULL DEFAULT 0,

  pending_rows INTEGER NOT NULL,
  pending_bytes INTEGER NOT NULL,

  -- Logical size of retained rows in the wal table for this stream (payload-only bytes).
  -- This is explicitly tracked because SQLite file size is high-water and does not shrink
  -- deterministically after DELETE-based GC/retention trimming.
  wal_rows INTEGER NOT NULL DEFAULT 0,
  wal_bytes INTEGER NOT NULL DEFAULT 0,

  last_append_ms INTEGER NOT NULL,
  last_segment_cut_ms INTEGER NOT NULL,
  segment_in_progress INTEGER NOT NULL,

  expires_at_ms INTEGER NULL,
  stream_flags INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS streams_pending_bytes_idx ON streams(pending_bytes);
CREATE INDEX IF NOT EXISTS streams_last_cut_idx ON streams(last_segment_cut_ms);
CREATE INDEX IF NOT EXISTS streams_inprog_pending_idx ON streams(segment_in_progress, pending_bytes, last_segment_cut_ms);

CREATE TABLE IF NOT EXISTS wal (
  id INTEGER PRIMARY KEY,
  stream TEXT NOT NULL,
  offset INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  payload BLOB NOT NULL,
  payload_len INTEGER NOT NULL,
  routing_key BLOB NULL,
  content_type TEXT NULL,
  flags INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS wal_stream_offset_uniq ON wal(stream, offset);
CREATE INDEX IF NOT EXISTS wal_stream_offset_idx ON wal(stream, offset);
CREATE INDEX IF NOT EXISTS wal_ts_idx ON wal(ts_ms);

CREATE TABLE IF NOT EXISTS segments (
  segment_id TEXT PRIMARY KEY,
  stream TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  block_count INTEGER NOT NULL,
  last_append_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  local_path TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  uploaded_at_ms INTEGER NULL,
  r2_etag TEXT NULL
);

CREATE TABLE IF NOT EXISTS stream_segment_meta (
  stream TEXT PRIMARY KEY,
  segment_count INTEGER NOT NULL,
  segment_offsets BLOB NOT NULL,
  segment_blocks BLOB NOT NULL,
  segment_last_ts BLOB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS segments_stream_index_uniq ON segments(stream, segment_index);
CREATE INDEX IF NOT EXISTS segments_stream_start_idx ON segments(stream, start_offset);
CREATE INDEX IF NOT EXISTS segments_pending_upload_idx ON segments(uploaded_at_ms);

CREATE TABLE IF NOT EXISTS manifests (
  stream TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  uploaded_generation INTEGER NOT NULL,
  last_uploaded_at_ms INTEGER NULL,
  last_uploaded_etag TEXT NULL
);

CREATE TABLE IF NOT EXISTS schemas (
  stream TEXT PRIMARY KEY,
  schema_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS producer_state (
  stream TEXT NOT NULL,
  producer_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (stream, producer_id)
);

CREATE TABLE IF NOT EXISTS stream_interpreters (
  stream TEXT PRIMARY KEY,
  interpreted_through INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

-- Live dynamic template registry (per base stream).
CREATE TABLE IF NOT EXISTS live_templates (
  stream TEXT NOT NULL,
  template_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  encodings_json TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  inactivity_ttl_ms INTEGER NOT NULL,
  active_from_source_offset INTEGER NOT NULL,
  retired_at_ms INTEGER NULL,
  retired_reason TEXT NULL,
  PRIMARY KEY (stream, template_id)
);

CREATE INDEX IF NOT EXISTS live_templates_stream_entity_state_last_seen_idx
  ON live_templates(stream, entity, state, last_seen_at_ms);
CREATE INDEX IF NOT EXISTS live_templates_stream_state_last_seen_idx
  ON live_templates(stream, state, last_seen_at_ms);
`;
var CREATE_INDEX_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS index_state (
  stream TEXT PRIMARY KEY,
  index_secret BLOB NOT NULL,
  indexed_through INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS index_runs (
  run_id TEXT PRIMARY KEY,
  stream TEXT NOT NULL,
  level INTEGER NOT NULL,
  start_segment INTEGER NOT NULL,
  end_segment INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  filter_len INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  retired_gen INTEGER NULL,
  retired_at_ms INTEGER NULL
);

CREATE INDEX IF NOT EXISTS index_runs_stream_idx ON index_runs(stream, level, start_segment);
`;
var CREATE_TABLES_V4_SUFFIX_SQL = (suffix) => `
CREATE TABLE streams_${suffix} (
  stream TEXT PRIMARY KEY,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,

  content_type TEXT NOT NULL,
  stream_seq TEXT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  closed_producer_id TEXT NULL,
  closed_producer_epoch INTEGER NULL,
  closed_producer_seq INTEGER NULL,
  ttl_seconds INTEGER NULL,

  epoch INTEGER NOT NULL,
  next_offset INTEGER NOT NULL,
  sealed_through INTEGER NOT NULL,
  uploaded_through INTEGER NOT NULL,
  uploaded_segment_count INTEGER NOT NULL DEFAULT 0,

  pending_rows INTEGER NOT NULL,
  pending_bytes INTEGER NOT NULL,

  last_append_ms INTEGER NOT NULL,
  last_segment_cut_ms INTEGER NOT NULL,
  segment_in_progress INTEGER NOT NULL,

  expires_at_ms INTEGER NULL,
  stream_flags INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE wal_${suffix} (
  id INTEGER PRIMARY KEY,
  stream TEXT NOT NULL,
  offset INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  payload BLOB NOT NULL,
  payload_len INTEGER NOT NULL,
  routing_key BLOB NULL,
  content_type TEXT NULL,
  flags INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE segments_${suffix} (
  segment_id TEXT PRIMARY KEY,
  stream TEXT NOT NULL,
  segment_index INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  block_count INTEGER NOT NULL,
  last_append_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  local_path TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  uploaded_at_ms INTEGER NULL,
  r2_etag TEXT NULL
);

CREATE TABLE manifests_${suffix} (
  stream TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  uploaded_generation INTEGER NOT NULL,
  last_uploaded_at_ms INTEGER NULL,
  last_uploaded_etag TEXT NULL
);

CREATE TABLE schemas_${suffix} (
  stream TEXT PRIMARY KEY,
  schema_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE producer_state_${suffix} (
  stream TEXT NOT NULL,
  producer_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  last_seq INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (stream, producer_id)
);
`;
var CREATE_INDEXES_V4_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS wal_stream_offset_uniq ON wal(stream, offset);
CREATE INDEX IF NOT EXISTS wal_stream_offset_idx ON wal(stream, offset);
CREATE INDEX IF NOT EXISTS wal_ts_idx ON wal(ts_ms);

CREATE INDEX IF NOT EXISTS streams_pending_bytes_idx ON streams(pending_bytes);
CREATE INDEX IF NOT EXISTS streams_last_cut_idx ON streams(last_segment_cut_ms);
CREATE INDEX IF NOT EXISTS streams_inprog_pending_idx ON streams(segment_in_progress, pending_bytes, last_segment_cut_ms);

CREATE UNIQUE INDEX IF NOT EXISTS segments_stream_index_uniq ON segments(stream, segment_index);
CREATE INDEX IF NOT EXISTS segments_stream_start_idx ON segments(stream, start_offset);
CREATE INDEX IF NOT EXISTS segments_pending_upload_idx ON segments(uploaded_at_ms);
`;
function initSchema(db, opts = {}) {
  db.exec(DEFAULT_PRAGMAS_SQL);
  if (opts.skipMigrations)
    return;
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`);
  const readSchemaVersion = () => {
    const row = db.query("SELECT version FROM schema_version LIMIT 1;").get();
    if (!row)
      return null;
    const raw = row.version;
    if (typeof raw === "bigint")
      return Number(raw);
    if (typeof raw === "number")
      return raw;
    return Number(raw);
  };
  const version0 = readSchemaVersion();
  if (version0 == null) {
    db.exec(CREATE_TABLES_V4_SQL);
    db.exec(CREATE_INDEX_TABLES_SQL);
    db.query("INSERT INTO schema_version(version) VALUES (?);").run(SCHEMA_VERSION);
    return;
  }
  if (version0 === SCHEMA_VERSION)
    return;
  let version = version0;
  while (version !== SCHEMA_VERSION) {
    if (version === 1) {
      migrateV1ToV4(db);
    } else if (version === 2) {
      migrateV2ToV4(db);
    } else if (version === 3) {
      migrateV3ToV4(db);
    } else if (version === 4) {
      migrateV4ToV5(db);
    } else if (version === 5) {
      migrateV5ToV6(db);
    } else if (version === 6) {
      migrateV6ToV7(db);
    } else if (version === 7) {
      migrateV7ToV8(db);
    } else if (version === 8) {
      migrateV8ToV9(db);
    } else if (version === 9) {
      migrateV9ToV10(db);
    } else if (version === 10) {
      migrateV10ToV11(db);
    } else {
      throw dsError(`unexpected schema version: ${version} (expected ${SCHEMA_VERSION})`);
    }
    const next = readSchemaVersion();
    if (next == null)
      throw dsError("schema_version row missing after migration");
    version = next;
  }
}
function migrateV1ToV4(db) {
  const tx = db.transaction(() => {
    db.exec(CREATE_TABLES_V4_SUFFIX_SQL("v4"));
    db.exec(`
      INSERT INTO streams_v4(
        stream, created_at_ms, updated_at_ms,
        content_type, stream_seq, closed, closed_producer_id, closed_producer_epoch, closed_producer_seq, ttl_seconds,
        epoch,
        next_offset, sealed_through, uploaded_through,
        pending_rows, pending_bytes,
        last_append_ms, last_segment_cut_ms, segment_in_progress,
        expires_at_ms, stream_flags
      )
      SELECT
        stream,
        CAST(created_at_ns / 1000000 AS INTEGER),
        CAST(updated_at_ns / 1000000 AS INTEGER),
        'application/octet-stream',
        NULL,
        0,
        NULL,
        NULL,
        NULL,
        NULL,
        epoch,
        next_seq,
        sealed_through_seq,
        uploaded_through_seq,
        pending_rows,
        pending_bytes,
        CAST(last_append_ns / 1000000 AS INTEGER),
        CAST(last_segment_cut_ns / 1000000 AS INTEGER),
        segment_in_progress,
        CASE WHEN expires_at_ns IS NULL THEN NULL ELSE CAST(expires_at_ns / 1000000 AS INTEGER) END,
        CASE WHEN deleted != 0 THEN 1 ELSE 0 END
      FROM streams;
    `);
    db.exec(`
      INSERT INTO wal_v4(
        stream, offset, ts_ms, payload, payload_len, routing_key, content_type, flags
      )
      SELECT
        stream,
        seq,
        CAST(append_ns / 1000000 AS INTEGER),
        payload,
        payload_len,
        CASE WHEN routing_key IS NULL THEN NULL ELSE CAST(routing_key AS BLOB) END,
        CASE WHEN is_json != 0 THEN 'application/json' ELSE NULL END,
        0
      FROM wal;
    `);
    db.exec(`
      INSERT INTO segments_v4(
        segment_id, stream, segment_index, start_offset, end_offset, block_count,
        last_append_ms, size_bytes, local_path, created_at_ms, uploaded_at_ms, r2_etag
      )
      SELECT
        segment_id,
        stream,
        segment_index,
        start_seq,
        end_seq,
        block_count,
        CAST(last_append_ns / 1000000 AS INTEGER),
        size_bytes,
        local_path,
        CAST(created_at_ns / 1000000 AS INTEGER),
        CASE WHEN uploaded_at_ns IS NULL THEN NULL ELSE CAST(uploaded_at_ns / 1000000 AS INTEGER) END,
        NULL
      FROM segments;
    `);
    db.exec(`
      INSERT INTO manifests_v4(
        stream, generation, uploaded_generation, last_uploaded_at_ms, last_uploaded_etag
      )
      SELECT
        stream,
        generation,
        uploaded_generation,
        CASE WHEN last_uploaded_at_ns IS NULL THEN NULL ELSE CAST(last_uploaded_at_ns / 1000000 AS INTEGER) END,
        last_uploaded_etag
      FROM manifests;
    `);
    db.exec(`
      INSERT INTO schemas_v4(stream, schema_json, updated_at_ms)
      SELECT stream, schema_json, CAST(updated_at_ns / 1000000 AS INTEGER)
      FROM schemas;
    `);
    db.exec(`DROP TABLE wal;`);
    db.exec(`DROP TABLE streams;`);
    db.exec(`DROP TABLE segments;`);
    db.exec(`DROP TABLE manifests;`);
    db.exec(`DROP TABLE schemas;`);
    db.exec(`ALTER TABLE streams_v4 RENAME TO streams;`);
    db.exec(`ALTER TABLE wal_v4 RENAME TO wal;`);
    db.exec(`ALTER TABLE segments_v4 RENAME TO segments;`);
    db.exec(`ALTER TABLE manifests_v4 RENAME TO manifests;`);
    db.exec(`ALTER TABLE schemas_v4 RENAME TO schemas;`);
    db.exec(`ALTER TABLE producer_state_v4 RENAME TO producer_state;`);
    db.exec(CREATE_INDEXES_V4_SQL);
    db.exec(CREATE_INDEX_TABLES_SQL);
    db.exec(`UPDATE schema_version SET version = 4;`);
  });
  tx();
}
function migrateV2ToV4(db) {
  const tx = db.transaction(() => {
    db.exec(`ALTER TABLE segments ADD COLUMN block_count INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`ALTER TABLE segments ADD COLUMN last_append_ms INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`ALTER TABLE streams ADD COLUMN content_type TEXT NOT NULL DEFAULT 'application/octet-stream';`);
    db.exec(`ALTER TABLE streams ADD COLUMN stream_seq TEXT NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed_producer_id TEXT NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed_producer_epoch INTEGER NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed_producer_seq INTEGER NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN ttl_seconds INTEGER NULL;`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS producer_state (
        stream TEXT NOT NULL,
        producer_id TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        last_seq INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (stream, producer_id)
      );
    `);
    db.exec(CREATE_INDEX_TABLES_SQL);
    db.exec(`UPDATE schema_version SET version = 4;`);
  });
  tx();
}
function migrateV3ToV4(db) {
  const tx = db.transaction(() => {
    db.exec(`ALTER TABLE streams ADD COLUMN content_type TEXT NOT NULL DEFAULT 'application/octet-stream';`);
    db.exec(`ALTER TABLE streams ADD COLUMN stream_seq TEXT NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed_producer_id TEXT NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed_producer_epoch INTEGER NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN closed_producer_seq INTEGER NULL;`);
    db.exec(`ALTER TABLE streams ADD COLUMN ttl_seconds INTEGER NULL;`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS producer_state (
        stream TEXT NOT NULL,
        producer_id TEXT NOT NULL,
        epoch INTEGER NOT NULL,
        last_seq INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (stream, producer_id)
      );
    `);
    db.exec(CREATE_INDEX_TABLES_SQL);
    db.exec(`UPDATE schema_version SET version = 4;`);
  });
  tx();
}
function migrateV4ToV5(db) {
  const tx = db.transaction(() => {
    db.exec(CREATE_INDEX_TABLES_SQL);
    db.exec(`UPDATE schema_version SET version = 5;`);
  });
  tx();
}
function migrateV5ToV6(db) {
  const tx = db.transaction(() => {
    db.exec(`ALTER TABLE streams ADD COLUMN uploaded_segment_count INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS stream_segment_meta (
        stream TEXT PRIMARY KEY,
        segment_count INTEGER NOT NULL,
        segment_offsets BLOB NOT NULL,
        segment_blocks BLOB NOT NULL,
        segment_last_ts BLOB NOT NULL
      );
    `);
    db.exec(`UPDATE schema_version SET version = 6;`);
  });
  tx();
}
function migrateV6ToV7(db) {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS stream_interpreters (
        stream TEXT PRIMARY KEY,
        interpreted_through INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `);
    db.exec(`UPDATE schema_version SET version = 7;`);
  });
  tx();
}
function migrateV7ToV8(db) {
  const tx = db.transaction(() => {
    db.exec(`UPDATE schema_version SET version = 8;`);
  });
  tx();
}
function migrateV8ToV9(db) {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS live_templates (
        stream TEXT NOT NULL,
        template_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        encodings_json TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        inactivity_ttl_ms INTEGER NOT NULL,
        active_from_source_offset INTEGER NOT NULL,
        retired_at_ms INTEGER NULL,
        retired_reason TEXT NULL,
        PRIMARY KEY (stream, template_id)
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS live_templates_stream_entity_state_last_seen_idx
        ON live_templates(stream, entity, state, last_seen_at_ms);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS live_templates_stream_state_last_seen_idx
        ON live_templates(stream, state, last_seen_at_ms);
    `);
    db.exec(`UPDATE schema_version SET version = 9;`);
  });
  tx();
}
function migrateV9ToV10(db) {
  const tx = db.transaction(() => {
    db.exec(`ALTER TABLE streams ADD COLUMN wal_rows INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`ALTER TABLE streams ADD COLUMN wal_bytes INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`DROP TABLE IF EXISTS temp.wal_stats;`);
    db.exec(`
      CREATE TEMP TABLE wal_stats AS
      SELECT stream, COUNT(*) as rows, COALESCE(SUM(payload_len), 0) as bytes
      FROM wal
      GROUP BY stream;
    `);
    db.exec(`
      UPDATE streams
      SET wal_rows = COALESCE((SELECT rows FROM wal_stats WHERE wal_stats.stream = streams.stream), 0),
          wal_bytes = COALESCE((SELECT bytes FROM wal_stats WHERE wal_stats.stream = streams.stream), 0);
    `);
    db.exec(`DROP TABLE wal_stats;`);
    db.exec(`UPDATE schema_version SET version = 10;`);
  });
  tx();
}
function migrateV10ToV11(db) {
  const tx = db.transaction(() => {
    db.exec(`DROP INDEX IF EXISTS wal_touch_stream_rk_offset_idx;`);
    db.exec(`UPDATE schema_version SET version = ${SCHEMA_VERSION};`);
  });
  tx();
}

// src/sqlite/adapter.ts
import { createRequire as createRequire2 } from "node:module";

// src/runtime/host_runtime.ts
function detectHostRuntime() {
  return typeof globalThis.Bun !== "undefined" || Boolean(process.versions?.bun) ? "bun" : "node";
}

// src/sqlite/adapter.ts
class BunStatementAdapter {
  stmt;
  constructor(stmt) {
    this.stmt = stmt;
  }
  get(...params) {
    return this.stmt.get(...params);
  }
  all(...params) {
    return this.stmt.all(...params);
  }
  run(...params) {
    return this.stmt.run(...params);
  }
  iterate(...params) {
    return this.stmt.iterate(...params);
  }
  finalize() {
    if (typeof this.stmt.finalize === "function")
      this.stmt.finalize();
  }
}

class BunDatabaseAdapter {
  db;
  constructor(db) {
    this.db = db;
  }
  exec(sql) {
    this.db.exec(sql);
  }
  query(sql) {
    return new BunStatementAdapter(this.db.query(sql));
  }
  transaction(fn) {
    return this.db.transaction(fn);
  }
  close() {
    this.db.close();
  }
}

class NodeStatementAdapter {
  stmt;
  constructor(stmt) {
    this.stmt = stmt;
  }
  get(...params) {
    return this.stmt.get(...params);
  }
  all(...params) {
    return this.stmt.all(...params);
  }
  run(...params) {
    return this.stmt.run(...params);
  }
  iterate(...params) {
    return this.stmt.iterate(...params);
  }
  finalize() {
    if (typeof this.stmt.finalize === "function")
      this.stmt.finalize();
  }
}

class NodeDatabaseAdapter {
  txDepth = 0;
  txCounter = 0;
  db;
  constructor(db) {
    this.db = db;
  }
  exec(sql) {
    this.db.exec(sql);
  }
  query(sql) {
    const stmt = this.db.prepare(sql);
    if (typeof stmt?.setReadBigInts === "function")
      stmt.setReadBigInts(true);
    return new NodeStatementAdapter(stmt);
  }
  transaction(fn) {
    return () => {
      const nested = this.txDepth > 0;
      const savepoint = `ds_tx_${++this.txCounter}`;
      this.txDepth += 1;
      try {
        if (nested)
          this.db.exec(`SAVEPOINT ${savepoint};`);
        else
          this.db.exec("BEGIN;");
        const out = fn();
        if (nested)
          this.db.exec(`RELEASE SAVEPOINT ${savepoint};`);
        else
          this.db.exec("COMMIT;");
        return out;
      } catch (err) {
        try {
          if (nested) {
            this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
            this.db.exec(`RELEASE SAVEPOINT ${savepoint};`);
          } else {
            this.db.exec("ROLLBACK;");
          }
        } catch {}
        throw err;
      } finally {
        this.txDepth = Math.max(0, this.txDepth - 1);
      }
    };
  }
  close() {
    this.db.close();
  }
}
var openImpl = null;
var openImplRuntime = null;
var runtimeOverride = null;
var require2 = createRequire2(import.meta.url);
function selectedRuntime() {
  return runtimeOverride ?? detectHostRuntime();
}
function buildOpenImpl(runtime) {
  if (runtime === "bun") {
    const { Database } = require2("bun:sqlite");
    return (path) => new BunDatabaseAdapter(new Database(path));
  }
  const { DatabaseSync } = require2("node:sqlite");
  return (path) => new NodeDatabaseAdapter(new DatabaseSync(path));
}
function openSqliteDatabase(path) {
  const runtime = selectedRuntime();
  if (!openImpl || openImplRuntime !== runtime) {
    openImpl = buildOpenImpl(runtime);
    openImplRuntime = runtime;
  }
  if (!openImpl)
    throw dsError("sqlite adapter not initialized");
  return openImpl(path);
}

// src/db/db.ts
import { Result } from "better-result";
var STREAM_FLAG_DELETED = 1 << 0;
var STREAM_FLAG_TOUCH = 1 << 1;
var BASE_WAL_GC_CHUNK_OFFSETS = (() => {
  const raw = process.env.DS_BASE_WAL_GC_CHUNK_OFFSETS;
  if (raw == null || raw.trim() === "")
    return 1e5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0)
    return 1e5;
  return Math.floor(n);
})();

class SqliteDurableStore {
  db;
  dbstatReady = null;
  stmts;
  constructor(path, opts = {}) {
    this.db = openSqliteDatabase(path);
    initSchema(this.db, { skipMigrations: opts.skipMigrations });
    if (opts.cacheBytes && opts.cacheBytes > 0) {
      const kb = Math.max(1, Math.floor(opts.cacheBytes / 1024));
      this.db.exec(`PRAGMA cache_size = -${kb};`);
    }
    this.stmts = {
      getStream: this.db.query(`SELECT stream, created_at_ms, updated_at_ms,
                content_type, stream_seq, closed, closed_producer_id, closed_producer_epoch, closed_producer_seq, ttl_seconds,
                epoch, next_offset, sealed_through, uploaded_through, uploaded_segment_count,
                pending_rows, pending_bytes, wal_rows, wal_bytes, last_append_ms, last_segment_cut_ms, segment_in_progress,
                expires_at_ms, stream_flags
         FROM streams WHERE stream = ? LIMIT 1;`),
      upsertStream: this.db.query(`INSERT INTO streams(stream, created_at_ms, updated_at_ms,
                             content_type, stream_seq, closed, closed_producer_id, closed_producer_epoch, closed_producer_seq, ttl_seconds,
                             epoch, next_offset, sealed_through, uploaded_through, uploaded_segment_count,
                             pending_rows, pending_bytes, wal_rows, wal_bytes, last_append_ms, last_segment_cut_ms, segment_in_progress,
                             expires_at_ms, stream_flags)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(stream) DO UPDATE SET
           updated_at_ms=excluded.updated_at_ms,
           expires_at_ms=excluded.expires_at_ms,
           ttl_seconds=excluded.ttl_seconds,
           content_type=excluded.content_type,
           stream_flags=excluded.stream_flags;`),
      listStreams: this.db.query(`SELECT stream, created_at_ms, updated_at_ms,
                content_type, stream_seq, closed, closed_producer_id, closed_producer_epoch, closed_producer_seq, ttl_seconds,
                epoch, next_offset, sealed_through, uploaded_through, uploaded_segment_count,
                pending_rows, pending_bytes, wal_rows, wal_bytes, last_append_ms, last_segment_cut_ms, segment_in_progress,
                expires_at_ms, stream_flags
         FROM streams
         WHERE (stream_flags & ?) = 0
           AND (expires_at_ms IS NULL OR expires_at_ms > ?)
         ORDER BY stream
         LIMIT ? OFFSET ?;`),
      setDeleted: this.db.query(`UPDATE streams SET stream_flags = (stream_flags | ?), updated_at_ms=? WHERE stream=?;`),
      insertWal: this.db.query(`INSERT INTO wal(stream, offset, ts_ms, payload, payload_len, routing_key, content_type, flags)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?);`),
      updateStreamAppend: this.db.query(`UPDATE streams
         SET next_offset = ?, updated_at_ms = ?, last_append_ms = ?,
             pending_rows = pending_rows + ?, pending_bytes = pending_bytes + ?,
             wal_rows = wal_rows + ?, wal_bytes = wal_bytes + ?
         WHERE stream = ? AND (stream_flags & ?) = 0;`),
      updateStreamAppendSeqCheck: this.db.query(`UPDATE streams
         SET next_offset = ?, updated_at_ms = ?, last_append_ms = ?,
             pending_rows = pending_rows + ?, pending_bytes = pending_bytes + ?,
             wal_rows = wal_rows + ?, wal_bytes = wal_bytes + ?
         WHERE stream = ? AND (stream_flags & ?) = 0 AND next_offset = ?;`),
      candidateStreams: this.db.query(`SELECT stream, pending_bytes, pending_rows, last_segment_cut_ms, sealed_through, next_offset, epoch
         FROM streams
         WHERE (stream_flags & ?) = 0
           AND segment_in_progress = 0
           AND (pending_bytes >= ? OR pending_rows >= ? OR (? - last_segment_cut_ms) >= ?)
         ORDER BY pending_bytes DESC
         LIMIT ?;`),
      candidateStreamsNoInterval: this.db.query(`SELECT stream, pending_bytes, pending_rows, last_segment_cut_ms, sealed_through, next_offset, epoch
         FROM streams
         WHERE (stream_flags & ?) = 0
           AND segment_in_progress = 0
           AND (pending_bytes >= ? OR pending_rows >= ?)
         ORDER BY pending_bytes DESC
         LIMIT ?;`),
      listExpiredStreams: this.db.query(`SELECT stream
         FROM streams
         WHERE (stream_flags & ?) = 0
           AND expires_at_ms IS NOT NULL
           AND expires_at_ms <= ?
         ORDER BY expires_at_ms ASC
         LIMIT ?;`),
      streamWalRange: this.db.query(`SELECT offset, ts_ms, routing_key, content_type, payload
         FROM wal
         WHERE stream = ? AND offset >= ? AND offset <= ?
         ORDER BY offset ASC;`),
      streamWalRangeByKey: this.db.query(`SELECT offset, ts_ms, routing_key, content_type, payload
         FROM wal
         WHERE stream = ? AND offset >= ? AND offset <= ? AND routing_key = ?
         ORDER BY offset ASC;`),
      createSegment: this.db.query(`INSERT INTO segments(segment_id, stream, segment_index, start_offset, end_offset, block_count,
                              last_append_ms, size_bytes, local_path, created_at_ms, uploaded_at_ms, r2_etag)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL);`),
      listSegmentsForStream: this.db.query(`SELECT segment_id, stream, segment_index, start_offset, end_offset, block_count, last_append_ms, size_bytes,
                local_path, created_at_ms, uploaded_at_ms, r2_etag
         FROM segments WHERE stream=? ORDER BY segment_index ASC;`),
      getSegmentByIndex: this.db.query(`SELECT segment_id, stream, segment_index, start_offset, end_offset, block_count, last_append_ms, size_bytes,
                local_path, created_at_ms, uploaded_at_ms, r2_etag
         FROM segments WHERE stream=? AND segment_index=? LIMIT 1;`),
      findSegmentForOffset: this.db.query(`SELECT segment_id, stream, segment_index, start_offset, end_offset, block_count, last_append_ms, size_bytes,
                local_path, created_at_ms, uploaded_at_ms, r2_etag
         FROM segments
         WHERE stream=? AND start_offset <= ? AND end_offset >= ?
         ORDER BY segment_index DESC
         LIMIT 1;`),
      nextSegmentIndex: this.db.query(`SELECT COALESCE(MAX(segment_index)+1, 0) as next_idx FROM segments WHERE stream=?;`),
      markSegmentUploaded: this.db.query(`UPDATE segments SET r2_etag=?, uploaded_at_ms=? WHERE segment_id=?;`),
      pendingUploadSegments: this.db.query(`SELECT segment_id, stream, segment_index, start_offset, end_offset, block_count, last_append_ms, size_bytes,
                local_path, created_at_ms, uploaded_at_ms, r2_etag
         FROM segments WHERE uploaded_at_ms IS NULL ORDER BY created_at_ms ASC LIMIT ?;`),
      countPendingSegments: this.db.query(`SELECT COUNT(*) as cnt FROM segments WHERE uploaded_at_ms IS NULL;`),
      countSegmentsForStream: this.db.query(`SELECT COUNT(*) as cnt FROM segments WHERE stream=?;`),
      tryClaimSegment: this.db.query(`UPDATE streams SET segment_in_progress=1, updated_at_ms=? WHERE stream=? AND segment_in_progress=0;`),
      getManifest: this.db.query(`SELECT stream, generation, uploaded_generation, last_uploaded_at_ms, last_uploaded_etag FROM manifests WHERE stream=? LIMIT 1;`),
      upsertManifest: this.db.query(`INSERT INTO manifests(stream, generation, uploaded_generation, last_uploaded_at_ms, last_uploaded_etag)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(stream) DO UPDATE SET
           generation=excluded.generation,
           uploaded_generation=excluded.uploaded_generation,
           last_uploaded_at_ms=excluded.last_uploaded_at_ms,
           last_uploaded_etag=excluded.last_uploaded_etag;`),
      getIndexState: this.db.query(`SELECT stream, index_secret, indexed_through, updated_at_ms
         FROM index_state WHERE stream=? LIMIT 1;`),
      upsertIndexState: this.db.query(`INSERT INTO index_state(stream, index_secret, indexed_through, updated_at_ms)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(stream) DO UPDATE SET
           index_secret=excluded.index_secret,
           indexed_through=excluded.indexed_through,
           updated_at_ms=excluded.updated_at_ms;`),
      updateIndexedThrough: this.db.query(`UPDATE index_state SET indexed_through=?, updated_at_ms=? WHERE stream=?;`),
      listIndexRuns: this.db.query(`SELECT run_id, stream, level, start_segment, end_segment, object_key, filter_len, record_count, retired_gen, retired_at_ms
         FROM index_runs WHERE stream=? AND retired_gen IS NULL
         ORDER BY start_segment ASC, level ASC;`),
      listIndexRunsAll: this.db.query(`SELECT run_id, stream, level, start_segment, end_segment, object_key, filter_len, record_count, retired_gen, retired_at_ms
         FROM index_runs WHERE stream=?
         ORDER BY start_segment ASC, level ASC;`),
      listRetiredIndexRuns: this.db.query(`SELECT run_id, stream, level, start_segment, end_segment, object_key, filter_len, record_count, retired_gen, retired_at_ms
         FROM index_runs WHERE stream=? AND retired_gen IS NOT NULL
         ORDER BY retired_at_ms ASC;`),
      insertIndexRun: this.db.query(`INSERT OR IGNORE INTO index_runs(run_id, stream, level, start_segment, end_segment, object_key, filter_len, record_count, retired_gen, retired_at_ms)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL);`),
      retireIndexRun: this.db.query(`UPDATE index_runs SET retired_gen=?, retired_at_ms=? WHERE run_id=?;`),
      deleteIndexRun: this.db.query(`DELETE FROM index_runs WHERE run_id=?;`),
      countUploadedSegments: this.db.query(`SELECT COALESCE(MAX(segment_index), -1) as max_idx
         FROM segments WHERE stream=? AND r2_etag IS NOT NULL;`),
      getSegmentMeta: this.db.query(`SELECT stream, segment_count, segment_offsets, segment_blocks, segment_last_ts
         FROM stream_segment_meta WHERE stream=? LIMIT 1;`),
      ensureSegmentMeta: this.db.query(`INSERT INTO stream_segment_meta(stream, segment_count, segment_offsets, segment_blocks, segment_last_ts)
         VALUES(?, 0, x'', x'', x'')
         ON CONFLICT(stream) DO NOTHING;`),
      appendSegmentMeta: this.db.query(`UPDATE stream_segment_meta
         SET segment_count = segment_count + 1,
             segment_offsets = segment_offsets || ?,
             segment_blocks = segment_blocks || ?,
             segment_last_ts = segment_last_ts || ?
         WHERE stream = ?;`),
      upsertSegmentMeta: this.db.query(`INSERT INTO stream_segment_meta(stream, segment_count, segment_offsets, segment_blocks, segment_last_ts)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(stream) DO UPDATE SET
           segment_count=excluded.segment_count,
           segment_offsets=excluded.segment_offsets,
           segment_blocks=excluded.segment_blocks,
           segment_last_ts=excluded.segment_last_ts;`),
      setUploadedSegmentCount: this.db.query(`UPDATE streams SET uploaded_segment_count=?, updated_at_ms=? WHERE stream=?;`),
      advanceUploadedThrough: this.db.query(`UPDATE streams SET uploaded_through=?, updated_at_ms=? WHERE stream=?;`),
      deleteWalBeforeOffset: this.db.query(`DELETE FROM wal WHERE stream=? AND offset <= ?;`),
      getSchemaRegistry: this.db.query(`SELECT stream, schema_json, updated_at_ms FROM schemas WHERE stream=? LIMIT 1;`),
      upsertSchemaRegistry: this.db.query(`INSERT INTO schemas(stream, schema_json, updated_at_ms) VALUES(?, ?, ?)
         ON CONFLICT(stream) DO UPDATE SET schema_json=excluded.schema_json, updated_at_ms=excluded.updated_at_ms;`),
      getStreamInterpreter: this.db.query(`SELECT stream, interpreted_through, updated_at_ms
         FROM stream_interpreters WHERE stream=? LIMIT 1;`),
      upsertStreamInterpreter: this.db.query(`INSERT INTO stream_interpreters(stream, interpreted_through, updated_at_ms)
         VALUES(?, ?, ?)
         ON CONFLICT(stream) DO UPDATE SET
           interpreted_through=excluded.interpreted_through,
           updated_at_ms=excluded.updated_at_ms;`),
      deleteStreamInterpreter: this.db.query(`DELETE FROM stream_interpreters WHERE stream=?;`),
      listStreamInterpreters: this.db.query(`SELECT stream, interpreted_through, updated_at_ms
         FROM stream_interpreters
         ORDER BY stream ASC;`),
      countStreams: this.db.query(`SELECT COUNT(*) as cnt FROM streams WHERE (stream_flags & ?) = 0;`),
      sumPendingBytes: this.db.query(`SELECT COALESCE(SUM(pending_bytes), 0) as total FROM streams;`),
      sumPendingSegmentBytes: this.db.query(`SELECT COALESCE(SUM(size_bytes), 0) as total FROM segments WHERE uploaded_at_ms IS NULL;`)
    };
  }
  toBigInt(v) {
    return typeof v === "bigint" ? v : BigInt(v);
  }
  bindInt(v) {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (v <= max && v >= min)
      return Number(v);
    return v.toString();
  }
  encodeU64Le(value) {
    const buf = new Uint8Array(8);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    dv.setBigUint64(0, value, true);
    return buf;
  }
  encodeU32Le(value) {
    const buf = new Uint8Array(4);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    dv.setUint32(0, value >>> 0, true);
    return buf;
  }
  coerceStreamRow(row) {
    return {
      stream: String(row.stream),
      created_at_ms: this.toBigInt(row.created_at_ms),
      updated_at_ms: this.toBigInt(row.updated_at_ms),
      content_type: String(row.content_type),
      stream_seq: row.stream_seq == null ? null : String(row.stream_seq),
      closed: Number(row.closed),
      closed_producer_id: row.closed_producer_id == null ? null : String(row.closed_producer_id),
      closed_producer_epoch: row.closed_producer_epoch == null ? null : Number(row.closed_producer_epoch),
      closed_producer_seq: row.closed_producer_seq == null ? null : Number(row.closed_producer_seq),
      ttl_seconds: row.ttl_seconds == null ? null : Number(row.ttl_seconds),
      epoch: Number(row.epoch),
      next_offset: this.toBigInt(row.next_offset),
      sealed_through: this.toBigInt(row.sealed_through),
      uploaded_through: this.toBigInt(row.uploaded_through),
      uploaded_segment_count: Number(row.uploaded_segment_count ?? 0),
      pending_rows: this.toBigInt(row.pending_rows),
      pending_bytes: this.toBigInt(row.pending_bytes),
      wal_rows: this.toBigInt(row.wal_rows ?? 0),
      wal_bytes: this.toBigInt(row.wal_bytes ?? 0),
      last_append_ms: this.toBigInt(row.last_append_ms),
      last_segment_cut_ms: this.toBigInt(row.last_segment_cut_ms),
      segment_in_progress: Number(row.segment_in_progress),
      expires_at_ms: row.expires_at_ms == null ? null : this.toBigInt(row.expires_at_ms),
      stream_flags: Number(row.stream_flags)
    };
  }
  coerceSegmentRow(row) {
    return {
      segment_id: String(row.segment_id),
      stream: String(row.stream),
      segment_index: Number(row.segment_index),
      start_offset: this.toBigInt(row.start_offset),
      end_offset: this.toBigInt(row.end_offset),
      block_count: Number(row.block_count),
      last_append_ms: this.toBigInt(row.last_append_ms),
      size_bytes: Number(row.size_bytes),
      local_path: String(row.local_path),
      created_at_ms: this.toBigInt(row.created_at_ms),
      uploaded_at_ms: row.uploaded_at_ms == null ? null : this.toBigInt(row.uploaded_at_ms),
      r2_etag: row.r2_etag == null ? null : String(row.r2_etag)
    };
  }
  close() {
    this.db.close();
  }
  nowMs() {
    return BigInt(Date.now());
  }
  isDeleted(row) {
    return (row.stream_flags & STREAM_FLAG_DELETED) !== 0;
  }
  getStream(stream) {
    const row = this.stmts.getStream.get(stream);
    return row ? this.coerceStreamRow(row) : null;
  }
  ensureStream(stream, opts) {
    const existing = this.getStream(stream);
    if (existing)
      return existing;
    const now = this.nowMs();
    const epoch = 0;
    const nextOffset = 0n;
    const contentType = opts?.contentType ?? "application/octet-stream";
    const closed = opts?.closed ? 1 : 0;
    const closedProducer = opts?.closedProducer ?? null;
    const expiresAtMs = opts?.expiresAtMs ?? null;
    const ttlSeconds = opts?.ttlSeconds ?? null;
    const streamFlags = opts?.streamFlags ?? 0;
    this.db.query(`INSERT INTO streams(
          stream, created_at_ms, updated_at_ms,
          content_type, stream_seq, closed, closed_producer_id, closed_producer_epoch, closed_producer_seq, ttl_seconds,
          epoch, next_offset, sealed_through, uploaded_through, uploaded_segment_count,
          pending_rows, pending_bytes, last_append_ms, last_segment_cut_ms, segment_in_progress,
          expires_at_ms, stream_flags
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`).run(stream, now, now, contentType, null, closed, closedProducer ? closedProducer.id : null, closedProducer ? closedProducer.epoch : null, closedProducer ? closedProducer.seq : null, ttlSeconds, epoch, nextOffset, -1n, -1n, 0, 0n, 0n, now, now, 0, expiresAtMs, streamFlags);
    this.stmts.upsertManifest.run(stream, 0, 0, null, null);
    this.ensureSegmentMeta(stream);
    return this.getStream(stream);
  }
  restoreStreamRow(row) {
    this.stmts.upsertStream.run(row.stream, row.created_at_ms, row.updated_at_ms, row.content_type, row.stream_seq, row.closed, row.closed_producer_id, row.closed_producer_epoch, row.closed_producer_seq, row.ttl_seconds, row.epoch, row.next_offset, row.sealed_through, row.uploaded_through, row.uploaded_segment_count, row.pending_rows, row.pending_bytes, row.wal_rows, row.wal_bytes, row.last_append_ms, row.last_segment_cut_ms, row.segment_in_progress, row.expires_at_ms, row.stream_flags);
  }
  listStreams(limit, offset) {
    const now = this.nowMs();
    const rows = this.stmts.listStreams.all(STREAM_FLAG_DELETED | STREAM_FLAG_TOUCH, now, limit, offset);
    return rows.map((r) => this.coerceStreamRow(r));
  }
  listExpiredStreams(limit) {
    const now = this.nowMs();
    const rows = this.stmts.listExpiredStreams.all(STREAM_FLAG_DELETED | STREAM_FLAG_TOUCH, now, limit);
    return rows.map((r) => String(r.stream));
  }
  deleteStream(stream) {
    const existing = this.getStream(stream);
    if (!existing)
      return false;
    const now = this.nowMs();
    this.stmts.setDeleted.run(STREAM_FLAG_DELETED, now, stream);
    return true;
  }
  hardDeleteStream(stream) {
    const tx = this.db.transaction(() => {
      const existing = this.getStream(stream);
      if (!existing)
        return false;
      this.db.query(`DELETE FROM wal WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM segments WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM manifests WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM schemas WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM stream_interpreters WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM live_templates WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM producer_state WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM index_state WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM index_runs WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM stream_segment_meta WHERE stream=?;`).run(stream);
      this.db.query(`DELETE FROM streams WHERE stream=?;`).run(stream);
      return true;
    });
    return tx();
  }
  getSchemaRegistry(stream) {
    const row = this.stmts.getSchemaRegistry.get(stream);
    if (!row)
      return null;
    return { stream: String(row.stream), registry_json: String(row.schema_json), updated_at_ms: this.toBigInt(row.updated_at_ms) };
  }
  upsertSchemaRegistry(stream, registryJson) {
    this.stmts.upsertSchemaRegistry.run(stream, registryJson, this.nowMs());
  }
  getStreamInterpreter(stream) {
    const row = this.stmts.getStreamInterpreter.get(stream);
    if (!row)
      return null;
    return {
      stream: String(row.stream),
      interpreted_through: this.toBigInt(row.interpreted_through),
      updated_at_ms: this.toBigInt(row.updated_at_ms)
    };
  }
  listStreamInterpreters() {
    const rows = this.stmts.listStreamInterpreters.all();
    return rows.map((row) => ({
      stream: String(row.stream),
      interpreted_through: this.toBigInt(row.interpreted_through),
      updated_at_ms: this.toBigInt(row.updated_at_ms)
    }));
  }
  ensureStreamInterpreter(stream) {
    const existing = this.getStreamInterpreter(stream);
    if (existing)
      return;
    const srow = this.getStream(stream);
    const initialThrough = srow ? srow.next_offset - 1n : -1n;
    this.stmts.upsertStreamInterpreter.run(stream, this.bindInt(initialThrough), this.nowMs());
  }
  updateStreamInterpreterThrough(stream, interpretedThrough) {
    this.stmts.upsertStreamInterpreter.run(stream, this.bindInt(interpretedThrough), this.nowMs());
  }
  deleteStreamInterpreter(stream) {
    this.stmts.deleteStreamInterpreter.run(stream);
  }
  addStreamFlags(stream, flags) {
    if (!Number.isFinite(flags) || flags <= 0)
      return;
    this.db.query(`UPDATE streams SET stream_flags = (stream_flags | ?), updated_at_ms=? WHERE stream=?;`).run(flags, this.nowMs(), stream);
  }
  getWalOldestOffset(stream) {
    const row = this.db.query(`SELECT MIN(offset) as min_off FROM wal WHERE stream=?;`).get(stream);
    if (!row || row.min_off == null)
      return null;
    return this.toBigInt(row.min_off);
  }
  trimWalByAge(stream, maxAgeMs) {
    const ageMs = Math.max(0, Math.floor(maxAgeMs));
    if (!Number.isFinite(ageMs))
      return { trimmedRows: 0, trimmedBytes: 0, keptFromOffset: null };
    const tx = this.db.transaction(() => {
      const lastRow = this.db.query(`SELECT offset, ts_ms FROM wal WHERE stream=? ORDER BY offset DESC LIMIT 1;`).get(stream);
      if (!lastRow || lastRow.offset == null)
        return { trimmedRows: 0, trimmedBytes: 0, keptFromOffset: null };
      const lastOffset = this.toBigInt(lastRow.offset);
      let keepFromOffset;
      if (ageMs === 0) {
        keepFromOffset = lastOffset;
      } else {
        const cutoff = this.nowMs() - BigInt(ageMs);
        const keepRow = this.db.query(`SELECT offset FROM wal WHERE stream=? AND ts_ms >= ? ORDER BY offset ASC LIMIT 1;`).get(stream, this.bindInt(cutoff));
        keepFromOffset = keepRow && keepRow.offset != null ? this.toBigInt(keepRow.offset) : lastOffset;
      }
      if (keepFromOffset <= 0n)
        return { trimmedRows: 0, trimmedBytes: 0, keptFromOffset: keepFromOffset };
      const stats = this.db.query(`SELECT COALESCE(SUM(payload_len), 0) as bytes, COUNT(*) as rows
           FROM wal WHERE stream=? AND offset < ?;`).get(stream, this.bindInt(keepFromOffset));
      const bytes = this.toBigInt(stats?.bytes ?? 0);
      const rows = this.toBigInt(stats?.rows ?? 0);
      if (rows <= 0n)
        return { trimmedRows: 0, trimmedBytes: 0, keptFromOffset: keepFromOffset };
      this.db.query(`DELETE FROM wal WHERE stream=? AND offset < ?;`).run(stream, this.bindInt(keepFromOffset));
      const now = this.nowMs();
      this.db.query(`UPDATE streams
         SET pending_bytes = CASE WHEN pending_bytes >= ? THEN pending_bytes - ? ELSE 0 END,
             pending_rows = CASE WHEN pending_rows >= ? THEN pending_rows - ? ELSE 0 END,
             wal_bytes = CASE WHEN wal_bytes >= ? THEN wal_bytes - ? ELSE 0 END,
             wal_rows = CASE WHEN wal_rows >= ? THEN wal_rows - ? ELSE 0 END,
             updated_at_ms = ?
         WHERE stream = ?;`).run(bytes, bytes, rows, rows, bytes, bytes, rows, rows, now, stream);
      const trimmedBytes = bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : Number.MAX_SAFE_INTEGER;
      const trimmedRows = rows <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rows) : Number.MAX_SAFE_INTEGER;
      return { trimmedRows, trimmedBytes, keptFromOffset: keepFromOffset };
    });
    return tx();
  }
  countStreams() {
    const row = this.stmts.countStreams.get(STREAM_FLAG_DELETED | STREAM_FLAG_TOUCH);
    return row ? Number(row.cnt) : 0;
  }
  sumPendingBytes() {
    const row = this.stmts.sumPendingBytes.get();
    const total = row?.total ?? 0;
    return Number(this.toBigInt(total));
  }
  sumPendingSegmentBytes() {
    const row = this.stmts.sumPendingSegmentBytes.get();
    const total = row?.total ?? 0;
    return Number(this.toBigInt(total));
  }
  ensureDbStat() {
    if (this.dbstatReady != null)
      return this.dbstatReady;
    try {
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.dbstat USING dbstat;");
      this.dbstatReady = true;
    } catch {
      this.dbstatReady = false;
    }
    return this.dbstatReady;
  }
  estimateWalBytes() {
    try {
      const row = this.db.query(`SELECT
           COALESCE(SUM(payload_len), 0) as payload,
           COALESCE(SUM(LENGTH(routing_key)), 0) as rk,
           COALESCE(SUM(LENGTH(content_type)), 0) as ct
         FROM wal;`).get();
      return Number(row?.payload ?? 0) + Number(row?.rk ?? 0) + Number(row?.ct ?? 0);
    } catch {
      return 0;
    }
  }
  estimateMetaBytes() {
    try {
      const streams = this.db.query(`SELECT
           COALESCE(SUM(LENGTH(stream)), 0) as stream,
           COALESCE(SUM(LENGTH(content_type)), 0) as content_type,
           COALESCE(SUM(LENGTH(stream_seq)), 0) as stream_seq,
           COALESCE(SUM(LENGTH(closed_producer_id)), 0) as closed_producer_id
         FROM streams;`).get();
      const segments = this.db.query(`SELECT
           COALESCE(SUM(LENGTH(segment_id)), 0) as segment_id,
           COALESCE(SUM(LENGTH(stream)), 0) as stream,
           COALESCE(SUM(LENGTH(local_path)), 0) as local_path,
           COALESCE(SUM(LENGTH(r2_etag)), 0) as r2_etag
         FROM segments;`).get();
      const manifests = this.db.query(`SELECT
           COALESCE(SUM(LENGTH(stream)), 0) as stream,
           COALESCE(SUM(LENGTH(last_uploaded_etag)), 0) as last_uploaded_etag
         FROM manifests;`).get();
      const schemas = this.db.query(`SELECT COALESCE(SUM(LENGTH(schema_json)), 0) as schema_json FROM schemas;`).get();
      const producers = this.db.query(`SELECT
           COALESCE(SUM(LENGTH(stream)), 0) as stream,
           COALESCE(SUM(LENGTH(producer_id)), 0) as producer_id
         FROM producer_state;`).get();
      const total = Number(streams?.stream ?? 0) + Number(streams?.content_type ?? 0) + Number(streams?.stream_seq ?? 0) + Number(streams?.closed_producer_id ?? 0) + Number(segments?.segment_id ?? 0) + Number(segments?.stream ?? 0) + Number(segments?.local_path ?? 0) + Number(segments?.r2_etag ?? 0) + Number(manifests?.stream ?? 0) + Number(manifests?.last_uploaded_etag ?? 0) + Number(schemas?.schema_json ?? 0) + Number(producers?.stream ?? 0) + Number(producers?.producer_id ?? 0);
      return total;
    } catch {
      return 0;
    }
  }
  getWalDbSizeBytes() {
    if (this.ensureDbStat()) {
      try {
        const row = this.db.query(`SELECT COALESCE(SUM(pgsize), 0) as total FROM temp.dbstat WHERE name = 'wal';`).get();
        return Number(row?.total ?? 0);
      } catch {}
    }
    return this.estimateWalBytes();
  }
  getMetaDbSizeBytes() {
    if (this.ensureDbStat()) {
      try {
        const row = this.db.query(`SELECT COALESCE(SUM(pgsize), 0) as total FROM temp.dbstat WHERE name != 'wal';`).get();
        return Number(row?.total ?? 0);
      } catch {}
    }
    return this.estimateMetaBytes();
  }
  appendWalRows(args) {
    const { stream, startOffset, expectedOffset, rows } = args;
    if (rows.length === 0)
      return Result.err({ kind: "no_rows" });
    const tx = this.db.transaction(() => {
      const st = this.getStream(stream);
      if (!st || this.isDeleted(st))
        return Result.err({ kind: "stream_missing" });
      if (st.expires_at_ms != null && this.nowMs() > st.expires_at_ms)
        return Result.err({ kind: "stream_expired" });
      if (expectedOffset !== undefined && st.next_offset !== expectedOffset) {
        return Result.err({ kind: "seq_mismatch", expectedNext: st.next_offset });
      }
      let totalBytes = 0n;
      let offset = startOffset;
      for (const r of rows) {
        const payloadLen = r.payload.byteLength;
        totalBytes += BigInt(payloadLen);
        this.stmts.insertWal.run(stream, offset, r.appendMs, r.payload, payloadLen, r.routingKey, r.contentType, 0);
        offset += 1n;
      }
      const lastOffset = offset - 1n;
      const newNextOffset = lastOffset + 1n;
      const now = this.nowMs();
      const pendingRows = BigInt(rows.length);
      const lastAppend = rows[rows.length - 1].appendMs;
      this.stmts.updateStreamAppend.run(newNextOffset, now, lastAppend, pendingRows, totalBytes, pendingRows, totalBytes, stream, STREAM_FLAG_DELETED);
      return Result.ok({ lastOffset });
    });
    return tx();
  }
  *iterWalRange(stream, startOffset, endOffset, routingKey) {
    const start = this.bindInt(startOffset);
    const end = this.bindInt(endOffset);
    const stmt = routingKey ? this.db.query(`SELECT offset, ts_ms, routing_key, content_type, payload
           FROM wal
           WHERE stream = ? AND offset >= ? AND offset <= ? AND routing_key = ?
           ORDER BY offset ASC;`) : this.db.query(`SELECT offset, ts_ms, routing_key, content_type, payload
           FROM wal
           WHERE stream = ? AND offset >= ? AND offset <= ?
           ORDER BY offset ASC;`);
    try {
      const it = routingKey ? stmt.iterate(stream, start, end, routingKey) : stmt.iterate(stream, start, end);
      for (const row of it) {
        yield row;
      }
    } finally {
      try {
        stmt.finalize?.();
      } catch {}
    }
  }
  nextSegmentIndexForStream(stream) {
    const row = this.stmts.nextSegmentIndex.get(stream);
    return Number(row?.next_idx ?? 0);
  }
  createSegmentRow(row) {
    this.stmts.createSegment.run(row.segmentId, row.stream, row.segmentIndex, row.startOffset, row.endOffset, row.blockCount, row.lastAppendMs, row.sizeBytes, row.localPath, this.nowMs());
  }
  commitSealedSegment(row) {
    const tx = this.db.transaction(() => {
      this.createSegmentRow(row);
      this.appendSegmentMeta(row.stream, row.endOffset + 1n, row.blockCount, row.lastAppendMs * 1000000n);
      this.setStreamSealedThrough(row.stream, row.endOffset, row.payloadBytes, row.rowsSealed);
    });
    tx();
  }
  listSegmentsForStream(stream) {
    const rows = this.stmts.listSegmentsForStream.all(stream);
    return rows.map((r) => this.coerceSegmentRow(r));
  }
  getSegmentByIndex(stream, segmentIndex) {
    const row = this.stmts.getSegmentByIndex.get(stream, segmentIndex);
    return row ? this.coerceSegmentRow(row) : null;
  }
  findSegmentForOffset(stream, offset) {
    const bound = this.bindInt(offset);
    const row = this.stmts.findSegmentForOffset.get(stream, bound, bound);
    return row ? this.coerceSegmentRow(row) : null;
  }
  pendingUploadSegments(limit) {
    const rows = this.stmts.pendingUploadSegments.all(limit);
    return rows.map((r) => this.coerceSegmentRow(r));
  }
  countPendingSegments() {
    const row = this.stmts.countPendingSegments.get();
    return row ? Number(row.cnt) : 0;
  }
  countSegmentsForStream(stream) {
    const row = this.stmts.countSegmentsForStream.get(stream);
    return row ? Number(row.cnt) : 0;
  }
  getSegmentMeta(stream) {
    const row = this.stmts.getSegmentMeta.get(stream);
    if (!row)
      return null;
    const offsets = row.segment_offsets instanceof Uint8Array ? row.segment_offsets : new Uint8Array(row.segment_offsets);
    const blocks = row.segment_blocks instanceof Uint8Array ? row.segment_blocks : new Uint8Array(row.segment_blocks);
    const lastTs = row.segment_last_ts instanceof Uint8Array ? row.segment_last_ts : new Uint8Array(row.segment_last_ts);
    return {
      stream: String(row.stream),
      segment_count: Number(row.segment_count),
      segment_offsets: offsets,
      segment_blocks: blocks,
      segment_last_ts: lastTs
    };
  }
  ensureSegmentMeta(stream) {
    this.stmts.ensureSegmentMeta.run(stream);
  }
  appendSegmentMeta(stream, offsetPlusOne, blockCount, lastAppendNs) {
    this.ensureSegmentMeta(stream);
    const offsetBytes = this.encodeU64Le(offsetPlusOne);
    const blockBytes = this.encodeU32Le(blockCount);
    const tsBytes = this.encodeU64Le(lastAppendNs);
    this.stmts.appendSegmentMeta.run(offsetBytes, blockBytes, tsBytes, stream);
  }
  upsertSegmentMeta(stream, count, offsets, blocks, lastTs) {
    this.stmts.upsertSegmentMeta.run(stream, count, offsets, blocks, lastTs);
  }
  rebuildSegmentMeta(stream) {
    const rows = this.db.query(`SELECT end_offset, block_count, last_append_ms
         FROM segments WHERE stream=? ORDER BY segment_index ASC;`).all(stream);
    const count = rows.length;
    const offsets = new Uint8Array(count * 8);
    const blocks = new Uint8Array(count * 4);
    const lastTs = new Uint8Array(count * 8);
    const dvOffsets = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength);
    const dvBlocks = new DataView(blocks.buffer, blocks.byteOffset, blocks.byteLength);
    const dvLastTs = new DataView(lastTs.buffer, lastTs.byteOffset, lastTs.byteLength);
    for (let i = 0;i < rows.length; i++) {
      const endOffset = this.toBigInt(rows[i].end_offset);
      const blockCount = Number(rows[i].block_count);
      const lastAppendMs = this.toBigInt(rows[i].last_append_ms);
      dvOffsets.setBigUint64(i * 8, endOffset + 1n, true);
      dvBlocks.setUint32(i * 4, blockCount >>> 0, true);
      dvLastTs.setBigUint64(i * 8, lastAppendMs * 1000000n, true);
    }
    this.upsertSegmentMeta(stream, count, offsets, blocks, lastTs);
    return { stream, segment_count: count, segment_offsets: offsets, segment_blocks: blocks, segment_last_ts: lastTs };
  }
  setUploadedSegmentCount(stream, count) {
    this.stmts.setUploadedSegmentCount.run(count, this.nowMs(), stream);
  }
  advanceUploadedSegmentCount(stream) {
    const row = this.getStream(stream);
    if (!row)
      return 0;
    let count = row.uploaded_segment_count ?? 0;
    for (;; ) {
      const seg = this.getSegmentByIndex(stream, count);
      if (!seg || !seg.r2_etag)
        break;
      count += 1;
    }
    if (count !== row.uploaded_segment_count) {
      this.stmts.setUploadedSegmentCount.run(count, this.nowMs(), stream);
    }
    return count;
  }
  markSegmentUploaded(segmentId, etag, uploadedAtMs) {
    this.stmts.markSegmentUploaded.run(etag, uploadedAtMs, segmentId);
  }
  setStreamSealedThrough(stream, sealedThrough, bytesSealed, rowsSealed) {
    const now = this.nowMs();
    this.db.query(`UPDATE streams
       SET sealed_through = ?,
           pending_bytes = CASE WHEN pending_bytes >= ? THEN pending_bytes - ? ELSE 0 END,
           pending_rows = CASE WHEN pending_rows >= ? THEN pending_rows - ? ELSE 0 END,
           last_segment_cut_ms = ?,
           updated_at_ms = ?
       WHERE stream = ?;`).run(sealedThrough, bytesSealed, bytesSealed, rowsSealed, rowsSealed, now, now, stream);
  }
  setSegmentInProgress(stream, inProgress) {
    this.db.query(`UPDATE streams SET segment_in_progress=?, updated_at_ms=? WHERE stream=?;`).run(inProgress, this.nowMs(), stream);
  }
  tryClaimSegment(stream) {
    const res = this.stmts.tryClaimSegment.run(this.nowMs(), stream);
    const changes = typeof res?.changes === "bigint" ? res.changes : BigInt(Number(res?.changes ?? 0));
    return changes > 0n;
  }
  resetSegmentInProgress() {
    this.db.query(`UPDATE streams SET segment_in_progress=0 WHERE segment_in_progress != 0;`).run();
  }
  advanceUploadedThrough(stream, uploadedThrough) {
    this.stmts.advanceUploadedThrough.run(uploadedThrough, this.nowMs(), stream);
  }
  deleteWalThrough(stream, uploadedThrough) {
    const through = this.bindInt(uploadedThrough);
    const tx = this.db.transaction(() => {
      const stats = this.db.query(`SELECT COALESCE(SUM(payload_len), 0) as bytes, COUNT(*) as rows
           FROM wal WHERE stream=? AND offset <= ?;`).get(stream, through);
      const bytes = this.toBigInt(stats?.bytes ?? 0);
      const rows = this.toBigInt(stats?.rows ?? 0);
      if (rows <= 0n)
        return { deletedRows: 0, deletedBytes: 0 };
      this.stmts.deleteWalBeforeOffset.run(stream, through);
      const now = this.nowMs();
      this.db.query(`UPDATE streams
         SET wal_bytes = CASE WHEN wal_bytes >= ? THEN wal_bytes - ? ELSE 0 END,
             wal_rows = CASE WHEN wal_rows >= ? THEN wal_rows - ? ELSE 0 END,
             updated_at_ms = ?
         WHERE stream = ?;`).run(bytes, bytes, rows, rows, now, stream);
      const deletedBytes = bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : Number.MAX_SAFE_INTEGER;
      const deletedRows = rows <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rows) : Number.MAX_SAFE_INTEGER;
      return { deletedRows, deletedBytes };
    });
    return tx();
  }
  getManifestRow(stream) {
    const row = this.stmts.getManifest.get(stream);
    if (!row) {
      this.stmts.upsertManifest.run(stream, 0, 0, null, null);
      const fresh = this.stmts.getManifest.get(stream);
      return {
        stream: String(fresh.stream),
        generation: Number(fresh.generation),
        uploaded_generation: Number(fresh.uploaded_generation),
        last_uploaded_at_ms: fresh.last_uploaded_at_ms == null ? null : this.toBigInt(fresh.last_uploaded_at_ms),
        last_uploaded_etag: fresh.last_uploaded_etag == null ? null : String(fresh.last_uploaded_etag)
      };
    }
    return {
      stream: String(row.stream),
      generation: Number(row.generation),
      uploaded_generation: Number(row.uploaded_generation),
      last_uploaded_at_ms: row.last_uploaded_at_ms == null ? null : this.toBigInt(row.last_uploaded_at_ms),
      last_uploaded_etag: row.last_uploaded_etag == null ? null : String(row.last_uploaded_etag)
    };
  }
  upsertManifestRow(stream, generation, uploadedGeneration, uploadedAtMs, etag) {
    this.stmts.upsertManifest.run(stream, generation, uploadedGeneration, uploadedAtMs, etag);
  }
  getIndexState(stream) {
    const row = this.stmts.getIndexState.get(stream);
    if (!row)
      return null;
    return {
      stream: String(row.stream),
      index_secret: row.index_secret instanceof Uint8Array ? row.index_secret : new Uint8Array(row.index_secret),
      indexed_through: Number(row.indexed_through),
      updated_at_ms: this.toBigInt(row.updated_at_ms)
    };
  }
  upsertIndexState(stream, indexSecret, indexedThrough) {
    this.stmts.upsertIndexState.run(stream, indexSecret, indexedThrough, this.nowMs());
  }
  updateIndexedThrough(stream, indexedThrough) {
    this.stmts.updateIndexedThrough.run(indexedThrough, this.nowMs(), stream);
  }
  listIndexRuns(stream) {
    const rows = this.stmts.listIndexRuns.all(stream);
    return rows.map((r) => ({
      run_id: String(r.run_id),
      stream: String(r.stream),
      level: Number(r.level),
      start_segment: Number(r.start_segment),
      end_segment: Number(r.end_segment),
      object_key: String(r.object_key),
      filter_len: Number(r.filter_len),
      record_count: Number(r.record_count),
      retired_gen: r.retired_gen == null ? null : Number(r.retired_gen),
      retired_at_ms: r.retired_at_ms == null ? null : this.toBigInt(r.retired_at_ms)
    }));
  }
  listIndexRunsAll(stream) {
    const rows = this.stmts.listIndexRunsAll.all(stream);
    return rows.map((r) => ({
      run_id: String(r.run_id),
      stream: String(r.stream),
      level: Number(r.level),
      start_segment: Number(r.start_segment),
      end_segment: Number(r.end_segment),
      object_key: String(r.object_key),
      filter_len: Number(r.filter_len),
      record_count: Number(r.record_count),
      retired_gen: r.retired_gen == null ? null : Number(r.retired_gen),
      retired_at_ms: r.retired_at_ms == null ? null : this.toBigInt(r.retired_at_ms)
    }));
  }
  listRetiredIndexRuns(stream) {
    const rows = this.stmts.listRetiredIndexRuns.all(stream);
    return rows.map((r) => ({
      run_id: String(r.run_id),
      stream: String(r.stream),
      level: Number(r.level),
      start_segment: Number(r.start_segment),
      end_segment: Number(r.end_segment),
      object_key: String(r.object_key),
      filter_len: Number(r.filter_len),
      record_count: Number(r.record_count),
      retired_gen: r.retired_gen == null ? null : Number(r.retired_gen),
      retired_at_ms: r.retired_at_ms == null ? null : this.toBigInt(r.retired_at_ms)
    }));
  }
  insertIndexRun(row) {
    this.stmts.insertIndexRun.run(row.run_id, row.stream, row.level, row.start_segment, row.end_segment, row.object_key, row.filter_len, row.record_count);
  }
  retireIndexRuns(runIds, retiredGen, retiredAtMs) {
    if (runIds.length === 0)
      return;
    const tx = this.db.transaction(() => {
      for (const runId of runIds) {
        this.stmts.retireIndexRun.run(retiredGen, retiredAtMs, runId);
      }
    });
    tx();
  }
  deleteIndexRuns(runIds) {
    if (runIds.length === 0)
      return;
    const tx = this.db.transaction(() => {
      for (const runId of runIds) {
        this.stmts.deleteIndexRun.run(runId);
      }
    });
    tx();
  }
  countUploadedSegments(stream) {
    const row = this.stmts.countUploadedSegments.get(stream);
    const maxIdx = row ? Number(row.max_idx) : -1;
    return maxIdx >= 0 ? maxIdx + 1 : 0;
  }
  commitManifest(stream, generation, etag, uploadedAtMs, uploadedThrough) {
    const tx = this.db.transaction(() => {
      this.stmts.upsertManifest.run(stream, generation, generation, uploadedAtMs, etag);
      this.stmts.advanceUploadedThrough.run(uploadedThrough, this.nowMs(), stream);
      let gcThrough = uploadedThrough;
      const interp = this.stmts.getStreamInterpreter.get(stream);
      if (interp) {
        const interpretedThrough = this.toBigInt(interp.interpreted_through);
        gcThrough = interpretedThrough < gcThrough ? interpretedThrough : gcThrough;
      }
      if (gcThrough < 0n)
        return;
      let deleteThrough = gcThrough;
      if (BASE_WAL_GC_CHUNK_OFFSETS > 0) {
        const oldest = this.getWalOldestOffset(stream);
        if (oldest != null) {
          const maxThrough = oldest + BigInt(BASE_WAL_GC_CHUNK_OFFSETS) - 1n;
          if (deleteThrough > maxThrough)
            deleteThrough = maxThrough;
        }
      }
      if (deleteThrough < 0n)
        return;
      const bound = this.bindInt(deleteThrough);
      const stats = this.db.query(`SELECT COALESCE(SUM(payload_len), 0) as bytes, COUNT(*) as rows
           FROM wal WHERE stream=? AND offset <= ?;`).get(stream, bound);
      const bytes = this.toBigInt(stats?.bytes ?? 0);
      const rows = this.toBigInt(stats?.rows ?? 0);
      if (rows <= 0n)
        return;
      this.stmts.deleteWalBeforeOffset.run(stream, bound);
      const now = this.nowMs();
      this.db.query(`UPDATE streams
         SET wal_bytes = CASE WHEN wal_bytes >= ? THEN wal_bytes - ? ELSE 0 END,
             wal_rows = CASE WHEN wal_rows >= ? THEN wal_rows - ? ELSE 0 END,
             updated_at_ms = ?
         WHERE stream = ?;`).run(bytes, bytes, rows, rows, now, stream);
    });
    tx();
  }
  candidates(minPendingBytes, minPendingRows, maxIntervalMs, limit) {
    if (maxIntervalMs <= 0n) {
      return this.stmts.candidateStreamsNoInterval.all(STREAM_FLAG_DELETED | STREAM_FLAG_TOUCH, minPendingBytes, minPendingRows, limit);
    }
    const now = this.nowMs();
    return this.stmts.candidateStreams.all(STREAM_FLAG_DELETED | STREAM_FLAG_TOUCH, minPendingBytes, minPendingRows, now, maxIntervalMs, limit);
  }
}

// src/ingest.ts
import { Result as Result2 } from "better-result";

class IngestQueue {
  cfg;
  db;
  stats;
  gate;
  memory;
  metrics;
  q = [];
  timer = null;
  scheduled = false;
  queuedBytes = 0;
  lastBacklogWarnMs = 0;
  stmts;
  constructor(cfg, db, stats, gate, memory, metrics) {
    this.cfg = cfg;
    this.db = db;
    this.stats = stats;
    this.gate = gate;
    this.memory = memory;
    this.metrics = metrics;
    this.stmts = {
      getStream: this.db.db.query(`SELECT stream, epoch, next_offset, last_append_ms, expires_at_ms, stream_flags,
                content_type, stream_seq, closed, closed_producer_id, closed_producer_epoch, closed_producer_seq
         FROM streams WHERE stream=? LIMIT 1;`),
      insertWal: this.db.db.query(`INSERT INTO wal(stream, offset, ts_ms, payload, payload_len, routing_key, content_type, flags)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?);`),
      updateStreamAppend: this.db.db.query(`UPDATE streams
         SET next_offset=?, updated_at_ms=?, last_append_ms=?,
             pending_rows=pending_rows+?, pending_bytes=pending_bytes+?,
             wal_rows=wal_rows+?, wal_bytes=wal_bytes+?,
             stream_seq=?,
             closed=CASE WHEN ? THEN 1 ELSE closed END,
             closed_producer_id=CASE WHEN ? THEN ? ELSE closed_producer_id END,
             closed_producer_epoch=CASE WHEN ? THEN ? ELSE closed_producer_epoch END,
             closed_producer_seq=CASE WHEN ? THEN ? ELSE closed_producer_seq END
         WHERE stream=? AND (stream_flags & ?) = 0;`),
      updateStreamCloseOnly: this.db.db.query(`UPDATE streams
         SET closed=1,
             closed_producer_id=?,
             closed_producer_epoch=?,
             closed_producer_seq=?,
             updated_at_ms=?,
             stream_seq=?
         WHERE stream=? AND (stream_flags & ?) = 0;`),
      getProducerState: this.db.db.query(`SELECT epoch, last_seq FROM producer_state WHERE stream=? AND producer_id=? LIMIT 1;`),
      upsertProducerState: this.db.db.query(`INSERT INTO producer_state(stream, producer_id, epoch, last_seq, updated_at_ms)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(stream, producer_id) DO UPDATE SET
           epoch=excluded.epoch,
           last_seq=excluded.last_seq,
           updated_at_ms=excluded.updated_at_ms;`)
    };
    this.timer = setInterval(() => {
      this.flush();
    }, this.cfg.ingestFlushIntervalMs);
  }
  stop() {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = null;
  }
  append(args, opts) {
    const bytes = args.rows.reduce((acc, r) => acc + r.payload.byteLength, 0);
    if (this.memory && !this.memory.shouldAllow()) {
      this.memory.maybeGc("memory limit");
      if (!opts?.bypassBackpressure) {
        this.memory.maybeHeapSnapshot("memory limit");
        if (this.metrics)
          this.metrics.record("tieredstore.backpressure.over_limit", 1, "count", { reason: "memory" });
        return Promise.resolve(Result2.err({ kind: "overloaded" }));
      }
    }
    if (!opts?.bypassBackpressure) {
      if (this.q.length >= this.cfg.ingestMaxQueueRequests || this.queuedBytes + bytes > this.cfg.ingestMaxQueueBytes) {
        if (this.metrics)
          this.metrics.record("tieredstore.backpressure.over_limit", 1, "count", { reason: "queue" });
        return Promise.resolve(Result2.err({ kind: "overloaded" }));
      }
      if (this.gate && !this.gate.reserve(bytes)) {
        if (this.metrics)
          this.metrics.record("tieredstore.backpressure.over_limit", 1, "count", { reason: "backlog" });
        this.warnBacklog();
        return Promise.resolve(Result2.err({ kind: "overloaded" }));
      }
    }
    this.queuedBytes += bytes;
    return new Promise((resolve) => {
      const task = {
        stream: args.stream,
        baseAppendMs: args.baseAppendMs,
        rows: args.rows,
        contentType: args.contentType ?? null,
        streamSeq: args.streamSeq ?? null,
        producer: args.producer ?? null,
        close: args.close ?? false,
        reservedBytes: opts?.bypassBackpressure ? 0 : bytes,
        enqueuedAtMs: this.stats ? Date.now() : undefined,
        resolve
      };
      if (opts?.priority === "high")
        this.q.unshift(task);
      else
        this.q.push(task);
      if (!this.scheduled && this.q.length >= this.cfg.ingestMaxBatchRequests) {
        this.scheduled = true;
        setTimeout(() => {
          this.scheduled = false;
          this.flush();
        }, 0);
      }
    });
  }
  appendInternal(args) {
    return this.append(args, { bypassBackpressure: true, priority: "high" });
  }
  getQueueStats() {
    return { requests: this.q.length, bytes: this.queuedBytes };
  }
  isQueueFull() {
    return this.q.length >= this.cfg.ingestMaxQueueRequests || this.queuedBytes >= this.cfg.ingestMaxQueueBytes;
  }
  warnBacklog() {
    if (!this.gate)
      return;
    const now = Date.now();
    if (now - this.lastBacklogWarnMs < 1e4)
      return;
    this.lastBacklogWarnMs = now;
    const current = this.gate.getCurrentBytes();
    const max = this.gate.getMaxBytes();
    const msg = `[backpressure] local backlog ${formatBytes(current)} exceeds limit ${formatBytes(max)}; rejecting appends (DS_LOCAL_BACKLOG_MAX_BYTES)`;
    console.warn(msg);
  }
  async flush() {
    if (this.q.length === 0)
      return;
    const flushStartMs = Date.now();
    let busyWaitMs = 0;
    const batch = [];
    let batchBytes = 0;
    let batchReservedBytes = 0;
    let drainCount = 0;
    while (drainCount < this.q.length && batch.length < this.cfg.ingestMaxBatchRequests && batchBytes < this.cfg.ingestMaxBatchBytes) {
      const t = this.q[drainCount];
      batch.push(t);
      drainCount += 1;
      for (const r of t.rows)
        batchBytes += r.payload.byteLength;
      batchReservedBytes += t.reservedBytes;
    }
    if (drainCount > 0) {
      this.q.splice(0, drainCount);
    }
    this.queuedBytes = Math.max(0, this.queuedBytes - batchBytes);
    let bpOverMs = 0;
    if (this.stats) {
      const budgetMs = this.stats.getBackpressureBudgetMs();
      const nowMs2 = Date.now();
      for (const t of batch) {
        if (t.enqueuedAtMs == null)
          continue;
        const waitMs = Math.max(0, nowMs2 - t.enqueuedAtMs);
        if (waitMs > budgetMs) {
          bpOverMs += waitMs - budgetMs;
        }
      }
    }
    const nowMs = this.db.nowMs();
    let perStream = new Map;
    let perProducer = new Map;
    let walBytesCommitted = 0;
    let results = [];
    const resetAttempt = () => {
      perStream = new Map;
      perProducer = new Map;
      walBytesCommitted = 0;
      results = new Array(batch.length);
    };
    const tx = this.db.db.transaction(() => {
      const loadStream = (stream) => {
        const cached = perStream.get(stream);
        if (cached)
          return cached;
        const row = this.stmts.getStream.get(stream);
        if (!row || (Number(row.stream_flags) & STREAM_FLAG_DELETED) !== 0)
          return null;
        const st = {
          epoch: Number(row.epoch),
          nextOffset: BigInt(row.next_offset),
          lastAppendMs: BigInt(row.last_append_ms),
          expiresAtMs: row.expires_at_ms == null ? null : BigInt(row.expires_at_ms),
          streamFlags: Number(row.stream_flags),
          contentType: String(row.content_type),
          streamSeq: row.stream_seq == null ? null : String(row.stream_seq),
          closed: Number(row.closed) !== 0,
          closedProducerId: row.closed_producer_id == null ? null : String(row.closed_producer_id),
          closedProducerEpoch: row.closed_producer_epoch == null ? null : Number(row.closed_producer_epoch),
          closedProducerSeq: row.closed_producer_seq == null ? null : Number(row.closed_producer_seq)
        };
        perStream.set(stream, st);
        return st;
      };
      const loadProducerState = (stream, producerId) => {
        const key = `${stream}\x00${producerId}`;
        if (perProducer.has(key))
          return perProducer.get(key);
        const row = this.stmts.getProducerState.get(stream, producerId);
        const state = row ? { epoch: Number(row.epoch), lastSeq: Number(row.last_seq) } : null;
        perProducer.set(key, state);
        return state;
      };
      const checkProducer = (task) => {
        const producer = task.producer;
        const key = `${task.stream}\x00${producer.id}`;
        const state = loadProducerState(task.stream, producer.id);
        if (!state) {
          if (producer.seq !== 0) {
            return Result2.err({ kind: "producer_epoch_seq" });
          }
          const next = { epoch: producer.epoch, lastSeq: producer.seq };
          perProducer.set(key, next);
          return Result2.ok({ duplicate: false, update: true, epoch: producer.epoch, seq: producer.seq });
        }
        if (producer.epoch < state.epoch) {
          return Result2.err({ kind: "producer_stale_epoch", producerEpoch: state.epoch });
        }
        if (producer.epoch > state.epoch) {
          if (producer.seq !== 0) {
            return Result2.err({ kind: "producer_epoch_seq" });
          }
          const next = { epoch: producer.epoch, lastSeq: producer.seq };
          perProducer.set(key, next);
          return Result2.ok({ duplicate: false, update: true, epoch: producer.epoch, seq: producer.seq });
        }
        if (producer.seq <= state.lastSeq) {
          return Result2.ok({ duplicate: true, update: false, epoch: state.epoch, seq: state.lastSeq });
        }
        if (producer.seq === state.lastSeq + 1) {
          const next = { epoch: state.epoch, lastSeq: producer.seq };
          perProducer.set(key, next);
          return Result2.ok({ duplicate: false, update: true, epoch: state.epoch, seq: producer.seq });
        }
        return Result2.err({ kind: "producer_gap", expected: state.lastSeq + 1, received: producer.seq });
      };
      const checkStreamSeq = (task, st) => {
        if (task.streamSeq == null)
          return Result2.ok({ nextSeq: st.streamSeq });
        if (st.streamSeq != null && task.streamSeq <= st.streamSeq) {
          return Result2.err({
            kind: "stream_seq",
            expected: st.streamSeq,
            received: task.streamSeq
          });
        }
        return Result2.ok({ nextSeq: task.streamSeq });
      };
      for (let idx = 0;idx < batch.length; idx++) {
        const task = batch[idx];
        const st = loadStream(task.stream);
        if (!st) {
          results[idx] = Result2.err({ kind: "not_found" });
          continue;
        }
        if (st.expiresAtMs != null && nowMs > st.expiresAtMs) {
          results[idx] = Result2.err({ kind: "gone" });
          continue;
        }
        const tailOffset = st.nextOffset - 1n;
        const isCloseOnly = task.close && task.rows.length === 0;
        if (st.closed) {
          if (isCloseOnly) {
            results[idx] = Result2.ok({
              lastOffset: tailOffset,
              appendedRows: 0,
              closed: true,
              duplicate: true
            });
            continue;
          }
          if (task.producer && task.close && st.closedProducerId != null && st.closedProducerEpoch != null && st.closedProducerSeq != null && st.closedProducerId === task.producer.id && st.closedProducerEpoch === task.producer.epoch && st.closedProducerSeq === task.producer.seq) {
            results[idx] = Result2.ok({
              lastOffset: tailOffset,
              appendedRows: 0,
              closed: true,
              duplicate: true,
              producer: { epoch: st.closedProducerEpoch, seq: st.closedProducerSeq }
            });
            continue;
          }
          results[idx] = Result2.err({ kind: "closed", lastOffset: tailOffset });
          continue;
        }
        if (isCloseOnly) {
          let producerInfo2;
          let duplicate = false;
          if (task.producer) {
            const prodCheck = checkProducer(task);
            if (Result2.isError(prodCheck)) {
              results[idx] = Result2.err(prodCheck.error);
              continue;
            }
            duplicate = prodCheck.value.duplicate;
            producerInfo2 = { epoch: prodCheck.value.epoch, seq: prodCheck.value.seq };
            if (prodCheck.value.update) {
              this.stmts.upsertProducerState.run(task.stream, task.producer.id, prodCheck.value.epoch, prodCheck.value.seq, nowMs);
            }
          }
          if (!duplicate) {
            const seqCheck2 = checkStreamSeq(task, st);
            if (Result2.isError(seqCheck2)) {
              results[idx] = Result2.err(seqCheck2.error);
              continue;
            }
            st.streamSeq = seqCheck2.value.nextSeq;
            const closedProducer2 = task.producer ?? null;
            this.stmts.updateStreamCloseOnly.run(closedProducer2 ? closedProducer2.id : null, closedProducer2 ? closedProducer2.epoch : null, closedProducer2 ? closedProducer2.seq : null, nowMs, st.streamSeq, task.stream, STREAM_FLAG_DELETED);
            st.closed = true;
            st.closedProducerId = closedProducer2 ? closedProducer2.id : null;
            st.closedProducerEpoch = closedProducer2 ? closedProducer2.epoch : null;
            st.closedProducerSeq = closedProducer2 ? closedProducer2.seq : null;
          }
          results[idx] = Result2.ok({
            lastOffset: tailOffset,
            appendedRows: 0,
            closed: st.closed,
            duplicate,
            producer: producerInfo2
          });
          continue;
        }
        if (!task.contentType || task.contentType !== st.contentType) {
          results[idx] = Result2.err({ kind: "content_type_mismatch" });
          continue;
        }
        let producerInfo;
        if (task.producer) {
          const prodCheck = checkProducer(task);
          if (Result2.isError(prodCheck)) {
            results[idx] = Result2.err(prodCheck.error);
            continue;
          }
          if (prodCheck.value.duplicate) {
            results[idx] = Result2.ok({
              lastOffset: tailOffset,
              appendedRows: 0,
              closed: false,
              duplicate: true,
              producer: { epoch: prodCheck.value.epoch, seq: prodCheck.value.seq }
            });
            continue;
          }
          producerInfo = { epoch: prodCheck.value.epoch, seq: prodCheck.value.seq };
          if (prodCheck.value.update) {
            this.stmts.upsertProducerState.run(task.stream, task.producer.id, prodCheck.value.epoch, prodCheck.value.seq, nowMs);
          }
        }
        const seqCheck = checkStreamSeq(task, st);
        if (Result2.isError(seqCheck)) {
          results[idx] = Result2.err(seqCheck.error);
          continue;
        }
        st.streamSeq = seqCheck.value.nextSeq;
        let appendMs = task.baseAppendMs;
        if (appendMs <= st.lastAppendMs)
          appendMs = st.lastAppendMs + 1n;
        let offset = st.nextOffset;
        let totalBytes = 0n;
        for (let i = 0;i < task.rows.length; i++) {
          const r = task.rows[i];
          const rowAppendMs = appendMs;
          const payloadLen = r.payload.byteLength;
          totalBytes += BigInt(payloadLen);
          this.stmts.insertWal.run(task.stream, offset, rowAppendMs, r.payload, payloadLen, r.routingKey, r.contentType, 0);
          offset += 1n;
        }
        const lastOffset = offset - 1n;
        st.nextOffset = offset;
        st.lastAppendMs = appendMs;
        if (task.close) {
          st.closed = true;
          if (task.producer) {
            st.closedProducerId = task.producer.id;
            st.closedProducerEpoch = task.producer.epoch;
            st.closedProducerSeq = task.producer.seq;
          } else {
            st.closedProducerId = null;
            st.closedProducerEpoch = null;
            st.closedProducerSeq = null;
          }
        }
        const closedProducer = task.close && task.producer ? task.producer : null;
        const closeFlag = task.close ? 1 : 0;
        this.stmts.updateStreamAppend.run(st.nextOffset, nowMs, st.lastAppendMs, BigInt(task.rows.length), totalBytes, BigInt(task.rows.length), totalBytes, st.streamSeq, closeFlag, closeFlag, closedProducer ? closedProducer.id : null, closeFlag, closedProducer ? closedProducer.epoch : null, closeFlag, closedProducer ? closedProducer.seq : null, task.stream, STREAM_FLAG_DELETED);
        walBytesCommitted += Number(totalBytes);
        results[idx] = Result2.ok({
          lastOffset,
          appendedRows: task.rows.length,
          closed: task.close,
          duplicate: false,
          producer: producerInfo
        });
      }
    });
    const isSqliteBusy = (e) => {
      const code = String(e?.code ?? "");
      const errno = Number(e?.errno ?? -1);
      return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || errno === 5 || errno === 517;
    };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    try {
      const maxBusyMs = Math.max(0, this.cfg.ingestBusyTimeoutMs);
      const startMs = Date.now();
      let attempt = 0;
      while (true) {
        resetAttempt();
        try {
          tx();
          break;
        } catch (e) {
          if (!isSqliteBusy(e))
            throw e;
          if (maxBusyMs <= 0)
            throw e;
          const elapsed = Date.now() - startMs;
          if (elapsed >= maxBusyMs)
            throw e;
          const delay = Math.min(200, 5 * 2 ** attempt);
          attempt += 1;
          busyWaitMs += delay;
          await sleep(delay);
        }
      }
      if (this.gate) {
        const reservedCommitted = Math.min(batchReservedBytes, walBytesCommitted);
        this.gate.commit(walBytesCommitted, reservedCommitted);
        const extra = batchReservedBytes - walBytesCommitted;
        if (extra > 0)
          this.gate.release(extra);
      }
      if (this.stats && walBytesCommitted > 0)
        this.stats.recordWalCommitBytes(walBytesCommitted);
      if (this.stats && bpOverMs > 0)
        this.stats.recordBackpressureOverMs(bpOverMs);
      for (let i = 0;i < batch.length; i++)
        batch[i].resolve(results[i] ?? Result2.err({ kind: "internal" }));
      const elapsedNs = (Date.now() - flushStartMs) * 1e6;
      if (this.metrics) {
        this.metrics.record("tieredstore.ingest.flush.latency", elapsedNs, "ns");
        if (busyWaitMs > 0)
          this.metrics.record("tieredstore.ingest.sqlite_busy.wait", busyWaitMs * 1e6, "ns");
      }
    } catch (e) {
      console.error("ingest tx failed", e);
      if (this.gate && batchReservedBytes > 0)
        this.gate.release(batchReservedBytes);
      for (const t of batch)
        t.resolve(Result2.err({ kind: "internal" }));
      const elapsedNs = (Date.now() - flushStartMs) * 1e6;
      if (this.metrics) {
        this.metrics.record("tieredstore.ingest.flush.latency", elapsedNs, "ns");
        if (busyWaitMs > 0)
          this.metrics.record("tieredstore.ingest.sqlite_busy.wait", busyWaitMs * 1e6, "ns");
      }
    }
  }
}
function formatBytes(bytes) {
  const units = ["b", "kb", "mb", "gb"];
  let value = Math.max(0, bytes);
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const digits = idx === 0 ? 0 : 1;
  return `${value.toFixed(digits)}${units[idx]}`;
}

// src/notifier.ts
class StreamNotifier {
  waiters = new Map;
  latestSeq = new Map;
  notify(stream, newEndSeq) {
    this.latestSeq.set(stream, newEndSeq);
    const set = this.waiters.get(stream);
    if (!set || set.size === 0)
      return;
    for (const w of Array.from(set)) {
      if (newEndSeq > w.afterSeq) {
        set.delete(w);
        w.resolve();
      }
    }
    if (set.size === 0)
      this.waiters.delete(stream);
  }
  waitFor(stream, afterSeq, timeoutMs, signal) {
    if (signal?.aborted)
      return Promise.resolve();
    const latest = this.latestSeq.get(stream);
    if (latest != null && latest > afterSeq)
      return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const set = this.waiters.get(stream) ?? new Set;
      const cleanup = () => {
        if (done)
          return;
        done = true;
        const s = this.waiters.get(stream);
        if (s) {
          s.delete(waiter);
          if (s.size === 0)
            this.waiters.delete(stream);
        }
        if (timeoutId)
          clearTimeout(timeoutId);
        if (signal)
          signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const waiter = { afterSeq, resolve: cleanup };
      set.add(waiter);
      this.waiters.set(stream, set);
      const onAbort = () => cleanup();
      if (signal)
        signal.addEventListener("abort", onAbort, { once: true });
      let timeoutId = null;
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          cleanup();
        }, timeoutMs);
      }
    });
  }
  notifyClose(stream) {
    const set = this.waiters.get(stream);
    if (!set || set.size === 0)
      return;
    for (const w of Array.from(set)) {
      set.delete(w);
      w.resolve();
    }
    if (set.size === 0)
      this.waiters.delete(stream);
  }
}

// src/util/base32_crockford.ts
import { Result as Result3 } from "better-result";
var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var DECODE_MAP = (() => {
  const m = {};
  for (let i = 0;i < ALPHABET.length; i++) {
    m[ALPHABET[i]] = i;
    m[ALPHABET[i].toLowerCase()] = i;
  }
  m["O"] = m["o"] = 0;
  m["I"] = m["i"] = 1;
  m["L"] = m["l"] = 1;
  return m;
})();
function invalidBase32(message) {
  return Result3.err({ kind: "invalid_base32", message });
}
function encodeCrockfordBase32Fixed26Result(bytes16) {
  if (bytes16.byteLength !== 16)
    return invalidBase32(`expected 16 bytes, got ${bytes16.byteLength}`);
  let n = 0n;
  for (const b of bytes16)
    n = n << 8n | BigInt(b);
  n = n << 2n;
  let out = "";
  for (let i = 0;i < 26; i++) {
    const shift = 5n * BigInt(25 - i);
    const idx = Number(n >> shift & 31n);
    out += ALPHABET[idx];
  }
  return Result3.ok(out);
}
function decodeCrockfordBase32Fixed26Result(s) {
  if (s === "-1")
    return invalidBase32("-1 is a sentinel offset and cannot be decoded as base32");
  if (s.length !== 26)
    return invalidBase32(`expected 26 chars, got ${s.length}`);
  let n = 0n;
  for (const ch of s) {
    const v = DECODE_MAP[ch];
    if (v === undefined)
      return invalidBase32(`invalid base32 char: ${ch}`);
    n = n << 5n | BigInt(v);
  }
  n = n >> 2n;
  const out = new Uint8Array(16);
  for (let i = 15;i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n = n >> 8n;
  }
  return Result3.ok(out);
}

// src/util/endian.ts
function writeU32BE(dst, offset, value) {
  const dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
  dv.setUint32(offset, value >>> 0, false);
}
function readU32BE(src, offset) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return dv.getUint32(offset, false);
}
function readU64BE(src, offset) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return dv.getBigUint64(offset, false);
}

// src/offset.ts
import { Result as Result4 } from "better-result";
var DEFAULT_EPOCH = 0;
function parseOffsetResult(input) {
  if (input == null || input === "") {
    return Result4.err({ kind: "invalid_offset", message: "missing offset" });
  }
  if (input === "-1")
    return Result4.ok({ kind: "start" });
  if (input.length !== 26) {
    return Result4.err({ kind: "invalid_offset", message: `invalid offset length: ${input.length}` });
  }
  const bytesRes = decodeCrockfordBase32Fixed26Result(input);
  if (Result4.isError(bytesRes))
    return Result4.err({ kind: "invalid_offset", message: bytesRes.error.message });
  const bytes = bytesRes.value;
  const epoch = readU32BE(bytes, 0);
  const hi = readU32BE(bytes, 4);
  const lo = readU32BE(bytes, 8);
  const inBlock = readU32BE(bytes, 12);
  const rawSeq = BigInt(hi) << 32n | BigInt(lo);
  const seq = rawSeq - 1n;
  return Result4.ok({ kind: "seq", epoch, seq, inBlock });
}
function parseOffset(input) {
  const res = parseOffsetResult(input);
  if (Result4.isError(res))
    throw dsError(res.error.message);
  return res.value;
}
function encodeOffsetResult(epoch, seq, inBlock = 0) {
  if (seq < -1n)
    return Result4.err({ kind: "invalid_offset", message: "invalid offset" });
  const bytes = new Uint8Array(16);
  writeU32BE(bytes, 0, epoch >>> 0);
  const rawSeq = seq + 1n;
  const hi = Number(rawSeq >> 32n & 0xffffffffn);
  const lo = Number(rawSeq & 0xffffffffn);
  writeU32BE(bytes, 4, hi);
  writeU32BE(bytes, 8, lo);
  writeU32BE(bytes, 12, inBlock >>> 0);
  const encodedRes = encodeCrockfordBase32Fixed26Result(bytes);
  if (Result4.isError(encodedRes))
    return Result4.err({ kind: "invalid_offset", message: encodedRes.error.message });
  return Result4.ok(encodedRes.value);
}
function encodeOffset(epoch, seq, inBlock = 0) {
  const res = encodeOffsetResult(epoch, seq, inBlock);
  if (Result4.isError(res))
    throw dsError(res.error.message);
  return res.value;
}
function canonicalizeOffset(input) {
  const p = parseOffset(input);
  if (p.kind === "start")
    return encodeOffset(DEFAULT_EPOCH, -1n, 0);
  return encodeOffset(p.epoch, p.seq, p.inBlock);
}
function offsetToSeqOrNeg1(p) {
  return p.kind === "start" ? -1n : p.seq;
}

// src/util/duration.ts
import { Result as Result5 } from "better-result";
function parseDurationMsResult(s) {
  const m = /^([0-9]+)(ms|s|m|h|d)$/.exec(s.trim());
  if (!m)
    return Result5.err({ kind: "invalid_duration", message: `invalid duration: ${s}` });
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case "ms":
      return Result5.ok(n);
    case "s":
      return Result5.ok(n * 1000);
    case "m":
      return Result5.ok(n * 60 * 1000);
    case "h":
      return Result5.ok(n * 60 * 60 * 1000);
    case "d":
      return Result5.ok(n * 24 * 60 * 60 * 1000);
    default:
      return Result5.err({ kind: "invalid_duration", message: `invalid unit: ${unit}` });
  }
}

// src/metrics.ts
class Histogram {
  maxSamples;
  samples = [];
  count = 0;
  sum = 0;
  min = Number.POSITIVE_INFINITY;
  max = Number.NEGATIVE_INFINITY;
  buckets = {};
  constructor(maxSamples = 1024) {
    this.maxSamples = maxSamples;
  }
  add(value) {
    this.count++;
    this.sum += value;
    if (value < this.min)
      this.min = value;
    if (value > this.max)
      this.max = value;
    const bucket = Math.floor(Math.log2(Math.max(1, value)));
    const key = String(1 << bucket);
    this.buckets[key] = (this.buckets[key] ?? 0) + 1;
    if (this.samples.length < this.maxSamples) {
      this.samples.push(value);
    } else {
      const idx = Math.floor(Math.random() * this.count);
      if (idx < this.maxSamples)
        this.samples[idx] = value;
    }
  }
  snapshotAndReset() {
    const count = this.count;
    const sum = this.sum;
    const min = count === 0 ? 0 : this.min;
    const max = count === 0 ? 0 : this.max;
    const avg = count === 0 ? 0 : sum / count;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const p = (q) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
    const p50 = p(0.5);
    const p95 = p(0.95);
    const p99 = p(0.99);
    const buckets = { ...this.buckets };
    this.samples = [];
    this.count = 0;
    this.sum = 0;
    this.min = Number.POSITIVE_INFINITY;
    this.max = Number.NEGATIVE_INFINITY;
    this.buckets = {};
    return { count, sum, min, max, avg, p50, p95, p99, buckets };
  }
}

class MetricSeries {
  metric;
  unit;
  stream;
  tags;
  hist = new Histogram;
  constructor(metric, unit, stream, tags) {
    this.metric = metric;
    this.unit = unit;
    this.stream = stream;
    this.tags = tags;
  }
}
function keyFor(metric, unit, stream, tags) {
  const tagStr = tags ? JSON.stringify(tags) : "";
  return `${metric}|${unit}|${stream ?? ""}|${tagStr}`;
}
function instanceId() {
  const host = typeof process !== "undefined" ? process.pid.toString() : "node";
  const rand = Math.random().toString(16).slice(2, 8);
  return `${host}-${rand}`;
}

class Metrics {
  startMs = Date.now();
  windowStartMs = Date.now();
  series = new Map;
  instance = instanceId();
  record(metric, value, unit, tags, stream) {
    const key = keyFor(metric, unit, stream, tags);
    let s = this.series.get(key);
    if (!s) {
      s = new MetricSeries(metric, unit, stream, tags);
      this.series.set(key, s);
    }
    s.hist.add(value);
  }
  recordAppend(bytes, entries) {
    this.record("tieredstore.append.bytes", bytes, "bytes");
    this.record("tieredstore.append.entries", entries, "count");
  }
  recordRead(bytes, entries) {
    this.record("tieredstore.read.bytes", bytes, "bytes");
    this.record("tieredstore.read.entries", entries, "count");
  }
  snapshot() {
    return {
      uptime_ms: Date.now() - this.startMs,
      series: this.series.size
    };
  }
  flushInterval() {
    const windowEnd = Date.now();
    const intervalMs = windowEnd - this.windowStartMs;
    const events = [];
    for (const s of this.series.values()) {
      const snap = s.hist.snapshotAndReset();
      if (snap.count === 0)
        continue;
      events.push({
        apiVersion: "durable.streams/metrics/v1",
        kind: "interval",
        metric: s.metric,
        unit: s.unit,
        windowStart: this.windowStartMs,
        windowEnd,
        intervalMs,
        instance: this.instance,
        stream: s.stream,
        tags: s.tags,
        ...snap
      });
    }
    this.windowStartMs = windowEnd;
    return events;
  }
}

// src/util/time.ts
import { Result as Result6 } from "better-result";
function parseTimestampMsResult(input) {
  const s = input.trim();
  if (s === "")
    return Result6.err({ kind: "empty_timestamp", message: "empty timestamp" });
  if (/^[0-9]+$/.test(s)) {
    return Result6.ok(BigInt(s) / 1000000n);
  }
  const d = new Date(s);
  const ms = d.getTime();
  if (Number.isNaN(ms))
    return Result6.err({ kind: "invalid_timestamp", message: `invalid timestamp: ${input}` });
  return Result6.ok(BigInt(ms));
}

// src/util/cleanup.ts
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
function cleanupTempSegments(rootDir) {
  const base = join(rootDir, "local");
  if (!existsSync(base))
    return;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".tmp")) {
        try {
          unlinkSync(full);
        } catch {}
      }
    }
  };
  walk(base);
}

// src/metrics_emitter.ts
class MetricsEmitter {
  metrics;
  ingest;
  intervalMs;
  timer = null;
  constructor(metrics, ingest, intervalMs) {
    this.metrics = metrics;
    this.ingest = ingest;
    this.intervalMs = intervalMs;
  }
  start() {
    if (this.intervalMs <= 0 || this.timer)
      return;
    this.timer = setInterval(() => {
      this.flush();
    }, this.intervalMs);
  }
  stop() {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = null;
  }
  async flush() {
    const queue = this.ingest.getQueueStats();
    this.metrics.record("tieredstore.ingest.queue.bytes", queue.bytes, "bytes");
    this.metrics.record("tieredstore.ingest.queue.requests", queue.requests, "count");
    const events = this.metrics.flushInterval();
    if (events.length === 0)
      return;
    const rows = events.map((e) => ({
      routingKey: e.stream ? new TextEncoder().encode(e.stream) : null,
      contentType: "application/json",
      payload: new TextEncoder().encode(JSON.stringify(e))
    }));
    try {
      await this.ingest.appendInternal({
        stream: "__stream_metrics__",
        baseAppendMs: BigInt(Date.now()),
        rows,
        contentType: "application/json"
      });
    } catch {}
  }
}

// src/schema/registry.ts
import Ajv from "ajv";
import { createHash } from "node:crypto";
import { Result as Result11 } from "better-result";

// src/util/lru.ts
class LruCache {
  maxEntries;
  map = new Map;
  constructor(maxEntries) {
    if (maxEntries <= 0)
      throw dsError("maxEntries must be > 0");
    this.maxEntries = maxEntries;
  }
  get size() {
    return this.map.size;
  }
  get(key) {
    const value = this.map.get(key);
    if (value === undefined)
      return;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.map.has(key))
      this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done)
        break;
      this.map.delete(oldest.value);
    }
  }
  has(key) {
    return this.map.has(key);
  }
  delete(key) {
    return this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

// src/schema/lens_schema.ts
var DURABLE_LENS_V1_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://example.com/schemas/durable-lens-v1.schema.json",
  title: "Durable Stream Lens Spec",
  type: "object",
  additionalProperties: false,
  required: ["apiVersion", "schema", "from", "to", "ops"],
  properties: {
    apiVersion: {
      type: "string",
      const: "durable.lens/v1"
    },
    schema: {
      type: "string",
      minLength: 1,
      description: "Logical stream schema/type name (e.g., 'Task')."
    },
    from: {
      type: "integer",
      minimum: 0,
      description: "Source schema version."
    },
    to: {
      type: "integer",
      minimum: 0,
      description: "Target schema version."
    },
    description: {
      type: "string"
    },
    ops: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/op" }
    }
  },
  $defs: {
    jsonPointer: {
      type: "string",
      description: "RFC 6901 JSON Pointer. Empty string refers to the document root.",
      pattern: "^(?:/(?:[^~/]|~0|~1)*)*$"
    },
    jsonScalar: {
      description: "JSON scalar value.",
      type: ["string", "number", "integer", "boolean", "null"]
    },
    embeddedJsonSchema: {
      description: "An embedded JSON Schema fragment (object or boolean).",
      anyOf: [{ type: "object" }, { type: "boolean" }]
    },
    mapTransform: {
      type: "object",
      additionalProperties: false,
      required: ["map"],
      properties: {
        map: {
          type: "object",
          description: "Mapping table for values. Keys must be strings; values are JSON scalars.",
          additionalProperties: { $ref: "#/$defs/jsonScalar" }
        },
        default: {
          $ref: "#/$defs/jsonScalar",
          description: "Default output value used when input is not found in map."
        }
      }
    },
    builtinTransform: {
      type: "object",
      additionalProperties: false,
      required: ["builtin"],
      properties: {
        builtin: {
          type: "string",
          minLength: 1,
          description: "Name of a built-in, version-stable transform implemented by the system."
        }
      }
    },
    convertTransform: {
      description: "Restricted conversion: either a total mapping table (+ optional default) or a built-in transform.",
      oneOf: [{ $ref: "#/$defs/mapTransform" }, { $ref: "#/$defs/builtinTransform" }]
    },
    opRename: {
      type: "object",
      additionalProperties: false,
      required: ["op", "from", "to"],
      properties: {
        op: { const: "rename" },
        from: { $ref: "#/$defs/jsonPointer" },
        to: { $ref: "#/$defs/jsonPointer" }
      }
    },
    opCopy: {
      type: "object",
      additionalProperties: false,
      required: ["op", "from", "to"],
      properties: {
        op: { const: "copy" },
        from: { $ref: "#/$defs/jsonPointer" },
        to: { $ref: "#/$defs/jsonPointer" }
      }
    },
    opAdd: {
      type: "object",
      additionalProperties: false,
      required: ["op", "path", "schema"],
      properties: {
        op: { const: "add" },
        path: { $ref: "#/$defs/jsonPointer" },
        schema: { $ref: "#/$defs/embeddedJsonSchema" },
        default: {
          description: "Default value to insert if the field is missing. If omitted, the runtime may derive a default when possible.",
          type: ["object", "array", "string", "number", "integer", "boolean", "null"]
        }
      }
    },
    opRemove: {
      type: "object",
      additionalProperties: false,
      required: ["op", "path", "schema"],
      properties: {
        op: { const: "remove" },
        path: { $ref: "#/$defs/jsonPointer" },
        schema: {
          $ref: "#/$defs/embeddedJsonSchema",
          description: "Schema of the removed field (required so the transformation remains declarative and reversible/validatable)."
        },
        default: {
          description: "Default to use when reconstructing the field (e.g., during backward reasoning/validation).",
          type: ["object", "array", "string", "number", "integer", "boolean", "null"]
        }
      }
    },
    opHoist: {
      type: "object",
      additionalProperties: false,
      required: ["op", "host", "name", "to"],
      properties: {
        op: { const: "hoist" },
        host: {
          $ref: "#/$defs/jsonPointer",
          description: "Pointer to an object field that contains the nested value."
        },
        name: {
          type: "string",
          minLength: 1,
          description: "Field name inside host to move outward."
        },
        to: {
          $ref: "#/$defs/jsonPointer",
          description: "Destination pointer for the hoisted value."
        },
        removeFromHost: {
          type: "boolean",
          default: true,
          description: "If true, remove the nested field from the host after hoisting."
        }
      }
    },
    opPlunge: {
      type: "object",
      additionalProperties: false,
      required: ["op", "from", "host", "name"],
      properties: {
        op: { const: "plunge" },
        from: {
          $ref: "#/$defs/jsonPointer",
          description: "Pointer to the source field to move inward."
        },
        host: {
          $ref: "#/$defs/jsonPointer",
          description: "Pointer to the destination object field."
        },
        name: {
          type: "string",
          minLength: 1,
          description: "Field name inside host to receive the value."
        },
        createHost: {
          type: "boolean",
          default: true,
          description: "If true, create the destination host object if missing."
        },
        removeFromSource: {
          type: "boolean",
          default: true,
          description: "If true, remove the source field after plunging."
        }
      }
    },
    opWrap: {
      type: "object",
      additionalProperties: false,
      required: ["op", "path", "mode"],
      properties: {
        op: { const: "wrap" },
        path: { $ref: "#/$defs/jsonPointer" },
        mode: {
          type: "string",
          enum: ["singleton"],
          description: "singleton: x -> [x]"
        },
        reverseMode: {
          type: "string",
          enum: ["first"],
          default: "first",
          description: "When reversing array->scalar, choose 'first'."
        }
      }
    },
    opHead: {
      type: "object",
      additionalProperties: false,
      required: ["op", "path"],
      properties: {
        op: { const: "head" },
        path: { $ref: "#/$defs/jsonPointer" },
        reverseMode: {
          type: "string",
          enum: ["singleton"],
          default: "singleton",
          description: "When reversing scalar->array, wrap as [scalar]."
        }
      }
    },
    opConvert: {
      type: "object",
      additionalProperties: false,
      required: ["op", "path", "fromType", "toType", "forward", "backward"],
      properties: {
        op: { const: "convert" },
        path: { $ref: "#/$defs/jsonPointer" },
        fromType: {
          type: "string",
          enum: ["string", "number", "integer", "boolean", "null", "object", "array"]
        },
        toType: {
          type: "string",
          enum: ["string", "number", "integer", "boolean", "null", "object", "array"]
        },
        forward: { $ref: "#/$defs/convertTransform" },
        backward: { $ref: "#/$defs/convertTransform" }
      }
    },
    opIn: {
      type: "object",
      additionalProperties: false,
      required: ["op", "path", "ops"],
      properties: {
        op: { const: "in" },
        path: { $ref: "#/$defs/jsonPointer" },
        ops: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/op" }
        }
      }
    },
    opMap: {
      type: "object",
      additionalProperties: false,
      required: ["op", "path", "ops"],
      properties: {
        op: { const: "map" },
        path: { $ref: "#/$defs/jsonPointer" },
        ops: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/op" }
        }
      }
    },
    op: {
      description: "A single lens operation.",
      oneOf: [
        { $ref: "#/$defs/opRename" },
        { $ref: "#/$defs/opCopy" },
        { $ref: "#/$defs/opAdd" },
        { $ref: "#/$defs/opRemove" },
        { $ref: "#/$defs/opHoist" },
        { $ref: "#/$defs/opPlunge" },
        { $ref: "#/$defs/opWrap" },
        { $ref: "#/$defs/opHead" },
        { $ref: "#/$defs/opConvert" },
        { $ref: "#/$defs/opIn" },
        { $ref: "#/$defs/opMap" }
      ]
    }
  }
};

// src/lens/lens.ts
import { Result as Result8 } from "better-result";

// src/util/json_pointer.ts
import { Result as Result7 } from "better-result";
function parseJsonPointerResult(ptr) {
  if (ptr === "")
    return Result7.ok([]);
  if (!ptr.startsWith("/"))
    return Result7.err({ kind: "invalid_json_pointer", message: "invalid json pointer" });
  return Result7.ok(ptr.split("/").slice(1).map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~")));
}
function isArrayIndex(seg) {
  return seg !== "" && /^[0-9]+$/.test(seg);
}
function getChild(container, seg) {
  if (Array.isArray(container) && isArrayIndex(seg)) {
    return container[Number(seg)];
  }
  if (container && typeof container === "object") {
    return container[seg];
  }
  return;
}
function resolvePointerResult(doc, ptr) {
  const segmentsRes = parseJsonPointerResult(ptr);
  if (Result7.isError(segmentsRes))
    return Result7.err(segmentsRes.error);
  const segments = segmentsRes.value;
  if (segments.length === 0) {
    return Result7.ok({ parent: null, key: null, value: doc, exists: true });
  }
  let cur = doc;
  for (let i = 0;i < segments.length - 1; i++) {
    cur = getChild(cur, segments[i]);
    if (cur === undefined)
      return Result7.ok({ parent: null, key: null, value: undefined, exists: false });
  }
  const key = segments[segments.length - 1];
  const value = cur === undefined ? undefined : getChild(cur, key);
  return Result7.ok({ parent: cur, key, value, exists: value !== undefined });
}

// src/lens/lens.ts
function invalidLensApply(message) {
  return Result8.err({ kind: "invalid_lens_ops", message });
}
function resolveSegments(doc, segments) {
  if (segments.length === 0)
    return { parent: null, key: null, value: doc, exists: true };
  let cur = doc;
  for (let i = 0;i < segments.length - 1; i++) {
    cur = getChild2(cur, segments[i]);
    if (cur === undefined)
      return { parent: null, key: null, value: undefined, exists: false };
  }
  const key = segments[segments.length - 1];
  const value = cur === undefined ? undefined : getChild2(cur, key);
  return { parent: cur, key, value, exists: value !== undefined };
}
function getChild2(container, seg) {
  if (Array.isArray(container)) {
    const idx = Number(seg);
    if (!Number.isInteger(idx))
      return;
    return container[idx];
  }
  if (container && typeof container === "object")
    return container[seg];
  return;
}
function setChildResult(container, seg, value) {
  if (Array.isArray(container)) {
    const idx = Number(seg);
    if (!Number.isInteger(idx) || idx < 0 || idx >= container.length)
      return invalidLensApply("array index out of bounds");
    container[idx] = value;
    return Result8.ok(undefined);
  }
  if (container && typeof container === "object") {
    container[seg] = value;
    return Result8.ok(undefined);
  }
  return invalidLensApply("invalid parent");
}
function deleteChildResult(container, seg) {
  if (Array.isArray(container)) {
    const idx = Number(seg);
    if (!Number.isInteger(idx) || idx < 0 || idx >= container.length)
      return invalidLensApply("array index out of bounds");
    container.splice(idx, 1);
    return Result8.ok(undefined);
  }
  if (container && typeof container === "object") {
    delete container[seg];
    return Result8.ok(undefined);
  }
  return invalidLensApply("invalid parent");
}
function setAtResult(doc, segments, value, opts) {
  if (segments.length === 0)
    return Result8.ok(value);
  let cur = doc;
  for (let i = 0;i < segments.length - 1; i++) {
    const seg = segments[i];
    let next = getChild2(cur, seg);
    if (next === undefined) {
      if (!opts?.createParents)
        return invalidLensApply("missing parent");
      next = {};
      const setRes = setChildResult(cur, seg, next);
      if (Result8.isError(setRes))
        return setRes;
    }
    cur = next;
  }
  const setLeafRes = setChildResult(cur, segments[segments.length - 1], value);
  if (Result8.isError(setLeafRes))
    return setLeafRes;
  return Result8.ok(doc);
}
function deleteAtResult(doc, segments) {
  if (segments.length === 0)
    return invalidLensApply("cannot delete document root");
  let cur = doc;
  for (let i = 0;i < segments.length - 1; i++) {
    cur = getChild2(cur, segments[i]);
    if (cur === undefined)
      return invalidLensApply("missing parent");
  }
  const deleteRes = deleteChildResult(cur, segments[segments.length - 1]);
  if (Result8.isError(deleteRes))
    return deleteRes;
  return Result8.ok(doc);
}
function coerceTypeNameResult(value) {
  if (value === null)
    return Result8.ok("null");
  if (Array.isArray(value))
    return Result8.ok("array");
  switch (typeof value) {
    case "string":
      return Result8.ok("string");
    case "number":
      return Result8.ok(Number.isInteger(value) ? "integer" : "number");
    case "boolean":
      return Result8.ok("boolean");
    case "object":
      return Result8.ok("object");
    default:
      return invalidLensApply("invalid json type");
  }
}
function ensureTypeResult(value, expected) {
  const actualRes = coerceTypeNameResult(value);
  if (Result8.isError(actualRes))
    return actualRes;
  const actual = actualRes.value;
  if (expected === "number" && (actual === "number" || actual === "integer"))
    return Result8.ok(undefined);
  if (actual !== expected)
    return invalidLensApply(`type mismatch: expected ${expected}, got ${actual}`);
  return Result8.ok(undefined);
}
function applyTransformResult(transform, value) {
  if (transform.builtin) {
    const name = transform.builtin;
    return applyBuiltinResult(name, value);
  }
  const t = transform;
  const key = String(value);
  if (Object.prototype.hasOwnProperty.call(t.map, key))
    return Result8.ok(t.map[key]);
  if (Object.prototype.hasOwnProperty.call(t, "default"))
    return Result8.ok(t.default);
  return invalidLensApply("convert map missing key and default");
}
function applyBuiltinResult(name, value) {
  switch (name) {
    case "lowercase":
      if (typeof value !== "string")
        return invalidLensApply("builtin lowercase expects string");
      return Result8.ok(value.toLowerCase());
    case "uppercase":
      if (typeof value !== "string")
        return invalidLensApply("builtin uppercase expects string");
      return Result8.ok(value.toUpperCase());
    case "string_to_int": {
      if (typeof value !== "string")
        return invalidLensApply("builtin string_to_int expects string");
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n))
        return invalidLensApply("builtin string_to_int invalid");
      return Result8.ok(n);
    }
    case "int_to_string":
      if (typeof value !== "number" || !Number.isInteger(value))
        return invalidLensApply("builtin int_to_string expects integer");
      return Result8.ok(String(value));
    case "rfc3339_to_unix_millis": {
      if (typeof value !== "string")
        return invalidLensApply("builtin rfc3339_to_unix_millis expects string");
      const ms = new Date(value).getTime();
      if (Number.isNaN(ms))
        return invalidLensApply("builtin rfc3339_to_unix_millis invalid");
      return Result8.ok(ms);
    }
    case "unix_millis_to_rfc3339":
      if (typeof value !== "number" || !Number.isFinite(value))
        return invalidLensApply("builtin unix_millis_to_rfc3339 expects number");
      return Result8.ok(new Date(value).toISOString());
    default:
      return invalidLensApply(`unknown builtin: ${name}`);
  }
}
function compileLensResult(lens) {
  const opsRes = compileOpsResult(lens.ops);
  if (Result8.isError(opsRes))
    return opsRes;
  return Result8.ok({
    schema: lens.schema,
    from: lens.from,
    to: lens.to,
    ops: opsRes.value
  });
}
function invalidLens(message) {
  return Result8.err({ kind: "invalid_lens", message });
}
function parsePointer(pointer, field) {
  const res = parseJsonPointerResult(pointer);
  if (Result8.isError(res))
    return invalidLens(`${field} ${res.error.message}`);
  return Result8.ok(res.value);
}
function compileOpsResult(ops) {
  const compiled = [];
  for (const op of ops) {
    switch (op.op) {
      case "rename": {
        const fromRes = parsePointer(op.from, "rename.from:");
        if (Result8.isError(fromRes))
          return fromRes;
        const toRes = parsePointer(op.to, "rename.to:");
        if (Result8.isError(toRes))
          return toRes;
        compiled.push({ op: "rename", from: fromRes.value, to: toRes.value });
        break;
      }
      case "copy": {
        const fromRes = parsePointer(op.from, "copy.from:");
        if (Result8.isError(fromRes))
          return fromRes;
        const toRes = parsePointer(op.to, "copy.to:");
        if (Result8.isError(toRes))
          return toRes;
        compiled.push({ op: "copy", from: fromRes.value, to: toRes.value });
        break;
      }
      case "add": {
        const pathRes = parsePointer(op.path, "add.path:");
        if (Result8.isError(pathRes))
          return pathRes;
        compiled.push({ op: "add", path: pathRes.value, default: op.default });
        break;
      }
      case "remove": {
        const pathRes = parsePointer(op.path, "remove.path:");
        if (Result8.isError(pathRes))
          return pathRes;
        compiled.push({ op: "remove", path: pathRes.value });
        break;
      }
      case "hoist": {
        const hostRes = parsePointer(op.host, "hoist.host:");
        if (Result8.isError(hostRes))
          return hostRes;
        const toRes = parsePointer(op.to, "hoist.to:");
        if (Result8.isError(toRes))
          return toRes;
        compiled.push({
          op: "hoist",
          host: hostRes.value,
          name: op.name,
          to: toRes.value,
          removeFromHost: op.removeFromHost !== false
        });
        break;
      }
      case "plunge": {
        const fromRes = parsePointer(op.from, "plunge.from:");
        if (Result8.isError(fromRes))
          return fromRes;
        const hostRes = parsePointer(op.host, "plunge.host:");
        if (Result8.isError(hostRes))
          return hostRes;
        compiled.push({
          op: "plunge",
          from: fromRes.value,
          host: hostRes.value,
          name: op.name,
          createHost: op.createHost !== false,
          removeFromSource: op.removeFromSource !== false
        });
        break;
      }
      case "wrap": {
        const pathRes = parsePointer(op.path, "wrap.path:");
        if (Result8.isError(pathRes))
          return pathRes;
        compiled.push({ op: "wrap", path: pathRes.value });
        break;
      }
      case "head": {
        const pathRes = parsePointer(op.path, "head.path:");
        if (Result8.isError(pathRes))
          return pathRes;
        compiled.push({ op: "head", path: pathRes.value });
        break;
      }
      case "convert": {
        const pathRes = parsePointer(op.path, "convert.path:");
        if (Result8.isError(pathRes))
          return pathRes;
        compiled.push({
          op: "convert",
          path: pathRes.value,
          fromType: op.fromType,
          toType: op.toType,
          forward: op.forward
        });
        break;
      }
      case "in": {
        const pathRes = parsePointer(op.path, "in.path:");
        if (Result8.isError(pathRes))
          return pathRes;
        const nestedRes = compileOpsResult(op.ops);
        if (Result8.isError(nestedRes))
          return nestedRes;
        compiled.push({ op: "in", path: pathRes.value, ops: nestedRes.value });
        break;
      }
      case "map": {
        const pathRes = parsePointer(op.path, "map.path:");
        if (Result8.isError(pathRes))
          return pathRes;
        const nestedRes = compileOpsResult(op.ops);
        if (Result8.isError(nestedRes))
          return nestedRes;
        compiled.push({ op: "map", path: pathRes.value, ops: nestedRes.value });
        break;
      }
      default: {
        return invalidLens(`unknown op: ${op.op}`);
      }
    }
  }
  return Result8.ok(compiled);
}
function applyCompiledLensResult(lens, doc) {
  return applyOpsResult(doc, lens.ops);
}
function applyLensChainResult(lenses, doc) {
  let cur = doc;
  for (const l of lenses) {
    const stepRes = applyCompiledLensResult(l, cur);
    if (Result8.isError(stepRes))
      return stepRes;
    cur = stepRes.value;
  }
  return Result8.ok(cur);
}
function applyOpsResult(doc, ops) {
  let root = doc;
  for (const op of ops) {
    switch (op.op) {
      case "rename": {
        const src = resolveSegments(root, op.from);
        if (!src.exists)
          return invalidLensApply("rename missing source");
        const setRes = setAtResult(root, op.to, src.value);
        if (Result8.isError(setRes))
          return setRes;
        const deleteRes = deleteAtResult(setRes.value, op.from);
        if (Result8.isError(deleteRes))
          return deleteRes;
        root = deleteRes.value;
        break;
      }
      case "copy": {
        const src = resolveSegments(root, op.from);
        if (!src.exists)
          return invalidLensApply("copy missing source");
        const setRes = setAtResult(root, op.to, src.value);
        if (Result8.isError(setRes))
          return setRes;
        root = setRes.value;
        break;
      }
      case "add": {
        const setRes = setAtResult(root, op.path, op.default);
        if (Result8.isError(setRes))
          return setRes;
        root = setRes.value;
        break;
      }
      case "remove": {
        const dst = resolveSegments(root, op.path);
        if (!dst.exists)
          return invalidLensApply("remove missing path");
        const deleteRes = deleteAtResult(root, op.path);
        if (Result8.isError(deleteRes))
          return deleteRes;
        root = deleteRes.value;
        break;
      }
      case "hoist": {
        const host = resolveSegments(root, op.host);
        if (!host.exists || !host.value || typeof host.value !== "object" || Array.isArray(host.value)) {
          return invalidLensApply("hoist host missing or not object");
        }
        if (!(op.name in host.value))
          return invalidLensApply("hoist missing name");
        const value = host.value[op.name];
        const setRes = setAtResult(root, op.to, value);
        if (Result8.isError(setRes))
          return setRes;
        root = setRes.value;
        if (op.removeFromHost)
          delete host.value[op.name];
        break;
      }
      case "plunge": {
        const src = resolveSegments(root, op.from);
        if (!src.exists)
          return invalidLensApply("plunge missing source");
        let host = resolveSegments(root, op.host);
        if (!host.exists) {
          if (!op.createHost)
            return invalidLensApply("plunge host missing");
          const setHostRes = setAtResult(root, op.host, {}, { createParents: true });
          if (Result8.isError(setHostRes))
            return setHostRes;
          root = setHostRes.value;
          host = resolveSegments(root, op.host);
        }
        if (!host.value || typeof host.value !== "object" || Array.isArray(host.value)) {
          return invalidLensApply("plunge host not object");
        }
        host.value[op.name] = src.value;
        if (op.removeFromSource) {
          const deleteRes = deleteAtResult(root, op.from);
          if (Result8.isError(deleteRes))
            return deleteRes;
          root = deleteRes.value;
        }
        break;
      }
      case "wrap": {
        const dst = resolveSegments(root, op.path);
        if (!dst.exists)
          return invalidLensApply("wrap missing path");
        const setRes = setAtResult(root, op.path, [dst.value]);
        if (Result8.isError(setRes))
          return setRes;
        root = setRes.value;
        break;
      }
      case "head": {
        const dst = resolveSegments(root, op.path);
        if (!dst.exists)
          return invalidLensApply("head missing path");
        if (!Array.isArray(dst.value) || dst.value.length === 0)
          return invalidLensApply("head expects non-empty array");
        const setRes = setAtResult(root, op.path, dst.value[0]);
        if (Result8.isError(setRes))
          return setRes;
        root = setRes.value;
        break;
      }
      case "convert": {
        const dst = resolveSegments(root, op.path);
        if (!dst.exists)
          return invalidLensApply("convert missing path");
        const ensureFromRes = ensureTypeResult(dst.value, op.fromType);
        if (Result8.isError(ensureFromRes))
          return ensureFromRes;
        const outRes = applyTransformResult(op.forward, dst.value);
        if (Result8.isError(outRes))
          return outRes;
        const ensureToRes = ensureTypeResult(outRes.value, op.toType);
        if (Result8.isError(ensureToRes))
          return ensureToRes;
        const setRes = setAtResult(root, op.path, outRes.value);
        if (Result8.isError(setRes))
          return setRes;
        root = setRes.value;
        break;
      }
      case "in": {
        const dst = resolveSegments(root, op.path);
        if (!dst.exists)
          return invalidLensApply("in missing path");
        if (!dst.value || typeof dst.value !== "object" || Array.isArray(dst.value))
          return invalidLensApply("in expects object");
        const nestedRes = applyOpsResult(dst.value, op.ops);
        if (Result8.isError(nestedRes))
          return nestedRes;
        break;
      }
      case "map": {
        const dst = resolveSegments(root, op.path);
        if (!dst.exists)
          return invalidLensApply("map missing path");
        if (!Array.isArray(dst.value))
          return invalidLensApply("map expects array");
        for (const item of dst.value) {
          const nestedRes = applyOpsResult(item, op.ops);
          if (Result8.isError(nestedRes))
            return nestedRes;
        }
        break;
      }
      default:
        return invalidLensApply(`unknown op: ${op.op}`);
    }
  }
  return Result8.ok(root);
}
function lensFromJson(raw) {
  return raw;
}

// src/schema/proof.ts
import { Result as Result9 } from "better-result";
function invalidLensProof(message) {
  return Result9.err({ kind: "invalid_lens_proof", message });
}
function invalidLensDefaults(message) {
  return Result9.err({ kind: "invalid_lens_defaults", message });
}
function parsePointerResult(ptr, kind) {
  const res = parseJsonPointerResult(ptr);
  if (Result9.isError(res)) {
    return Result9.err({ kind, message: res.error.message });
  }
  return Result9.ok(res.value);
}
function isObjectSchema(schema) {
  if (schema === true)
    return true;
  if (schema === false || schema == null)
    return false;
  const t = schema.type;
  if (t === undefined)
    return true;
  if (Array.isArray(t))
    return t.includes("object");
  return t === "object";
}
function isArraySchema(schema) {
  if (schema === true)
    return true;
  if (schema === false || schema == null)
    return false;
  const t = schema.type;
  if (t === undefined)
    return true;
  if (Array.isArray(t))
    return t.includes("array");
  return t === "array";
}
function getTypeSet(schema) {
  if (schema === true)
    return null;
  if (schema === false || schema == null)
    return new Set;
  if (schema.const !== undefined)
    return new Set([inferType(schema.const)]);
  if (schema.enum)
    return new Set(schema.enum.map((v) => inferType(v)));
  const t = schema.type;
  if (t === undefined)
    return null;
  if (Array.isArray(t))
    return new Set(t);
  return new Set([t]);
}
function inferType(value) {
  if (value === null)
    return "null";
  if (Array.isArray(value))
    return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}
function typeSubset(src, dest) {
  if (src === dest)
    return true;
  if (src === "integer" && dest === "number")
    return true;
  return false;
}
function isSchemaCompatible(src, dest) {
  if (dest === true)
    return true;
  if (dest === false || dest == null)
    return false;
  if (src && src.const !== undefined) {
    return valueConformsToSchema(src.const, dest);
  }
  if (src && Array.isArray(src.enum)) {
    return src.enum.every((v) => valueConformsToSchema(v, dest));
  }
  const srcTypes = getTypeSet(src);
  const destTypes = getTypeSet(dest);
  if (srcTypes && destTypes) {
    for (const t of srcTypes) {
      let ok = false;
      for (const d of destTypes) {
        if (typeSubset(t, d)) {
          ok = true;
          break;
        }
      }
      if (!ok)
        return false;
    }
    return true;
  }
  if (dest.const !== undefined || Array.isArray(dest.enum))
    return false;
  return true;
}
function valueConformsToSchema(value, schema) {
  if (schema === true)
    return true;
  if (schema === false || schema == null)
    return false;
  if (schema.const !== undefined)
    return deepEqual(value, schema.const);
  if (Array.isArray(schema.enum))
    return schema.enum.some((v) => deepEqual(v, value));
  const t = getTypeSet(schema);
  if (t) {
    const vt = inferType(value);
    for (const allowed of t) {
      if (typeSubset(vt, allowed))
        return true;
    }
    return false;
  }
  return true;
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function getPropertySchema(schema, prop, requireExplicit) {
  if (!schema || schema === false)
    return { schema, required: false, exists: false, explicit: false };
  if (!isObjectSchema(schema))
    return { schema, required: false, exists: false, explicit: false };
  const props = schema.properties ?? {};
  const required = Array.isArray(schema.required) && schema.required.includes(prop);
  if (Object.prototype.hasOwnProperty.call(props, prop)) {
    return { schema: props[prop], required, exists: true, explicit: true };
  }
  if (requireExplicit)
    return { schema, required, exists: false, explicit: false };
  if (schema.additionalProperties === false)
    return { schema, required, exists: false, explicit: false };
  if (schema.additionalProperties && schema.additionalProperties !== true) {
    return { schema: schema.additionalProperties, required, exists: true, explicit: false };
  }
  return { schema: true, required, exists: true, explicit: false };
}
function getItemsSchema(schema) {
  if (!schema || schema === false)
    return schema;
  if (!isArraySchema(schema))
    return schema;
  if (schema.items !== undefined)
    return schema.items;
  return true;
}
function getPathInfo(schema, segments, requireExplicit) {
  if (segments.length === 0)
    return { schema, required: true, exists: true, explicit: true };
  let cur = schema;
  let required = true;
  for (let i = 0;i < segments.length; i++) {
    const seg = segments[i];
    if (/^[0-9]+$/.test(seg)) {
      if (!isArraySchema(cur))
        return { schema: cur, required: false, exists: false, explicit: false };
      cur = getItemsSchema(cur);
      continue;
    }
    const info = getPropertySchema(cur, seg, requireExplicit);
    if (!info.exists)
      return info;
    required = required && info.required;
    cur = info.schema;
  }
  return { schema: cur, required, exists: true, explicit: true };
}
function ensureParentRequiredResult(schema, segments, requireExplicit, kind) {
  if (segments.length === 0)
    return Result9.ok(undefined);
  let cur = schema;
  for (let i = 0;i < segments.length - 1; i++) {
    const seg = segments[i];
    const info = getPropertySchema(cur, seg, requireExplicit);
    if (!info.exists || !info.required) {
      return Result9.err({ kind, message: "parent path not required" });
    }
    if (!isObjectSchema(info.schema)) {
      return Result9.err({ kind, message: "parent path not object" });
    }
    cur = info.schema;
  }
  return Result9.ok(undefined);
}
function isPathRequired(schema, segments) {
  const info = getPathInfo(schema, segments, false);
  return info.exists && info.required;
}
function deriveDefault(schema) {
  if (schema === false || schema == null)
    return;
  if (schema.default !== undefined)
    return schema.default;
  const types = getTypeSet(schema);
  if (types) {
    if (types.has("object"))
      return {};
    if (types.has("array"))
      return [];
  }
  return;
}
function ensureEnumOrConstResult(kind, schema) {
  if (schema && (schema.const !== undefined || Array.isArray(schema.enum)))
    return Result9.ok(undefined);
  return Result9.err({ kind, message: "schema must be enum/const for non-total transform" });
}
function samePointer(a, b) {
  if (a.length !== b.length)
    return false;
  for (let i = 0;i < a.length; i++)
    if (a[i] !== b[i])
      return false;
  return true;
}
function hasWrapAfterResult(ops, pathSeg) {
  for (const op of ops) {
    if (op.op !== "wrap")
      continue;
    const wrapPathRes = parsePointerResult(op.path, "invalid_lens_proof");
    if (Result9.isError(wrapPathRes))
      return wrapPathRes;
    if (samePointer(wrapPathRes.value, pathSeg))
      return Result9.ok(true);
  }
  return Result9.ok(false);
}
function findRenameToResult(priorOps, pathSeg) {
  for (let i = priorOps.length - 1;i >= 0; i--) {
    const op = priorOps[i];
    if (op.op !== "rename")
      continue;
    const toRes = parsePointerResult(op.to, "invalid_lens_proof");
    if (Result9.isError(toRes))
      return toRes;
    if (samePointer(toRes.value, pathSeg))
      return Result9.ok(op);
  }
  return Result9.ok(null);
}
function validateOpResult(oldSchema, newSchema, op, priorOps, remainingOps) {
  switch (op.op) {
    case "rename": {
      const fromSegRes = parsePointerResult(op.from, "invalid_lens_proof");
      if (Result9.isError(fromSegRes))
        return fromSegRes;
      const toSegRes = parsePointerResult(op.to, "invalid_lens_proof");
      if (Result9.isError(toSegRes))
        return toSegRes;
      const fromSeg = fromSegRes.value;
      const toSeg = toSegRes.value;
      const src = getPathInfo(oldSchema, fromSeg, false);
      if (!src.exists || !src.required)
        return invalidLensProof("rename source not required");
      const parentRes = ensureParentRequiredResult(oldSchema, toSeg, false, "invalid_lens_proof");
      if (Result9.isError(parentRes))
        return parentRes;
      const dest = getPathInfo(newSchema, toSeg, false);
      if (!dest.exists)
        return invalidLensProof("rename dest missing in new schema");
      if (!isSchemaCompatible(src.schema, dest.schema)) {
        if (isArraySchema(dest.schema)) {
          const hasWrapRes = hasWrapAfterResult(remainingOps, toSeg);
          if (Result9.isError(hasWrapRes))
            return hasWrapRes;
          if (hasWrapRes.value) {
            const items = getItemsSchema(dest.schema);
            if (!isSchemaCompatible(src.schema, items)) {
              return invalidLensProof("rename schema incompatible");
            }
            return Result9.ok(undefined);
          }
        }
        return invalidLensProof("rename schema incompatible");
      }
      return Result9.ok(undefined);
    }
    case "copy": {
      const fromSegRes = parsePointerResult(op.from, "invalid_lens_proof");
      if (Result9.isError(fromSegRes))
        return fromSegRes;
      const toSegRes = parsePointerResult(op.to, "invalid_lens_proof");
      if (Result9.isError(toSegRes))
        return toSegRes;
      const fromSeg = fromSegRes.value;
      const toSeg = toSegRes.value;
      const src = getPathInfo(oldSchema, fromSeg, false);
      if (!src.exists || !src.required)
        return invalidLensProof("copy source not required");
      const parentRes = ensureParentRequiredResult(oldSchema, toSeg, false, "invalid_lens_proof");
      if (Result9.isError(parentRes))
        return parentRes;
      const dest = getPathInfo(newSchema, toSeg, false);
      if (!dest.exists)
        return invalidLensProof("copy dest missing in new schema");
      if (!isSchemaCompatible(src.schema, dest.schema))
        return invalidLensProof("copy schema incompatible");
      return Result9.ok(undefined);
    }
    case "add": {
      const pathSegRes = parsePointerResult(op.path, "invalid_lens_proof");
      if (Result9.isError(pathSegRes))
        return pathSegRes;
      const pathSeg = pathSegRes.value;
      const parentRes = ensureParentRequiredResult(oldSchema, pathSeg, true, "invalid_lens_proof");
      if (Result9.isError(parentRes))
        return parentRes;
      const dest = getPathInfo(newSchema, pathSeg, true);
      if (!dest.exists)
        return invalidLensProof("add dest missing in new schema");
      const def = op.default ?? deriveDefault(dest.schema);
      if (def === undefined)
        return invalidLensProof("add missing default");
      if (!valueConformsToSchema(def, dest.schema))
        return invalidLensProof("add default invalid");
      return Result9.ok(undefined);
    }
    case "remove": {
      const pathSegRes = parsePointerResult(op.path, "invalid_lens_proof");
      if (Result9.isError(pathSegRes))
        return pathSegRes;
      const pathSeg = pathSegRes.value;
      const src = getPathInfo(oldSchema, pathSeg, true);
      if (!src.exists || !src.required)
        return invalidLensProof("remove path not required");
      if (isPathRequired(newSchema, pathSeg))
        return invalidLensProof("remove path still required in new schema");
      return Result9.ok(undefined);
    }
    case "hoist": {
      const hostSegRes = parsePointerResult(op.host, "invalid_lens_proof");
      if (Result9.isError(hostSegRes))
        return hostSegRes;
      const toSegRes = parsePointerResult(op.to, "invalid_lens_proof");
      if (Result9.isError(toSegRes))
        return toSegRes;
      const hostSeg = hostSegRes.value;
      const toSeg = toSegRes.value;
      const host = getPathInfo(oldSchema, hostSeg, true);
      if (!host.exists || !host.required || !isObjectSchema(host.schema))
        return invalidLensProof("hoist host invalid");
      const child = getPropertySchema(host.schema, op.name, true);
      if (!child.exists || !child.required)
        return invalidLensProof("hoist name missing/optional");
      const parentRes = ensureParentRequiredResult(oldSchema, toSeg, true, "invalid_lens_proof");
      if (Result9.isError(parentRes))
        return parentRes;
      const dest = getPathInfo(newSchema, toSeg, true);
      if (!dest.exists)
        return invalidLensProof("hoist dest missing in new schema");
      if (!isSchemaCompatible(child.schema, dest.schema))
        return invalidLensProof("hoist schema incompatible");
      if (op.removeFromHost !== false) {
        const hostNew = getPathInfo(newSchema, hostSeg, true);
        if (hostNew.exists && hostNew.required && isPathRequired(hostNew.schema, [op.name])) {
          return invalidLensProof("hoist removed field still required");
        }
      }
      return Result9.ok(undefined);
    }
    case "plunge": {
      const fromSegRes = parsePointerResult(op.from, "invalid_lens_proof");
      if (Result9.isError(fromSegRes))
        return fromSegRes;
      const hostSegRes = parsePointerResult(op.host, "invalid_lens_proof");
      if (Result9.isError(hostSegRes))
        return hostSegRes;
      const fromSeg = fromSegRes.value;
      const hostSeg = hostSegRes.value;
      const src = getPathInfo(oldSchema, fromSeg, true);
      if (!src.exists || !src.required)
        return invalidLensProof("plunge source not required");
      if (op.createHost !== false) {
        const parentRes = ensureParentRequiredResult(oldSchema, hostSeg, true, "invalid_lens_proof");
        if (Result9.isError(parentRes))
          return parentRes;
      } else {
        const host = getPathInfo(oldSchema, hostSeg, true);
        if (!host.exists || !host.required || !isObjectSchema(host.schema))
          return invalidLensProof("plunge host invalid");
      }
      const hostNew = getPathInfo(newSchema, hostSeg, true);
      if (!hostNew.exists || !isObjectSchema(hostNew.schema))
        return invalidLensProof("plunge host missing in new schema");
      const child = getPropertySchema(hostNew.schema, op.name, true);
      if (!child.exists)
        return invalidLensProof("plunge name missing in new schema");
      if (!isSchemaCompatible(src.schema, child.schema))
        return invalidLensProof("plunge schema incompatible");
      if (op.removeFromSource !== false && isPathRequired(newSchema, fromSeg)) {
        return invalidLensProof("plunge removed field still required");
      }
      return Result9.ok(undefined);
    }
    case "wrap": {
      const pathSegRes = parsePointerResult(op.path, "invalid_lens_proof");
      if (Result9.isError(pathSegRes))
        return pathSegRes;
      const pathSeg = pathSegRes.value;
      let src = getPathInfo(oldSchema, pathSeg, true);
      if (!src.exists || !src.required) {
        const renameRes = findRenameToResult(priorOps, pathSeg);
        if (Result9.isError(renameRes))
          return renameRes;
        if (renameRes.value) {
          const fromRes = parsePointerResult(renameRes.value.from, "invalid_lens_proof");
          if (Result9.isError(fromRes))
            return fromRes;
          src = getPathInfo(oldSchema, fromRes.value, true);
        }
      }
      if (!src.exists || !src.required)
        return invalidLensProof("wrap path not required");
      const dest = getPathInfo(newSchema, pathSeg, true);
      if (!dest.exists || !isArraySchema(dest.schema))
        return invalidLensProof("wrap dest not array");
      const items = getItemsSchema(dest.schema);
      if (!isSchemaCompatible(src.schema, items))
        return invalidLensProof("wrap items incompatible");
      return Result9.ok(undefined);
    }
    case "head": {
      const pathSegRes = parsePointerResult(op.path, "invalid_lens_proof");
      if (Result9.isError(pathSegRes))
        return pathSegRes;
      const pathSeg = pathSegRes.value;
      const src = getPathInfo(oldSchema, pathSeg, true);
      if (!src.exists || !src.required || !isArraySchema(src.schema))
        return invalidLensProof("head path not required array");
      const hasEnum = src.schema && Array.isArray(src.schema.enum);
      if (hasEnum) {
        const ok = src.schema.enum.every((v) => Array.isArray(v) && v.length > 0);
        if (!ok)
          return invalidLensProof("head requires enum non-empty");
      }
      const minItems = src.schema?.minItems;
      if (!hasEnum && (minItems === undefined || minItems < 1)) {
        return invalidLensProof("head requires minItems");
      }
      if (minItems !== undefined && minItems < 1)
        return invalidLensProof("head requires non-empty array");
      const dest = getPathInfo(newSchema, pathSeg, true);
      if (!dest.exists)
        return invalidLensProof("head dest missing");
      const items = getItemsSchema(src.schema);
      if (!isSchemaCompatible(items, dest.schema))
        return invalidLensProof("head schema incompatible");
      return Result9.ok(undefined);
    }
    case "convert": {
      const pathSegRes = parsePointerResult(op.path, "invalid_lens_proof");
      if (Result9.isError(pathSegRes))
        return pathSegRes;
      const pathSeg = pathSegRes.value;
      const src = getPathInfo(oldSchema, pathSeg, true);
      if (!src.exists || !src.required)
        return invalidLensProof("convert path not required");
      if (op.forward.map && !op.forward.default) {
        const enumRes = ensureEnumOrConstResult("invalid_lens_proof", src.schema);
        if (Result9.isError(enumRes))
          return enumRes;
      }
      const builtin = op.forward.builtin;
      if (builtin === "string_to_int" || builtin === "rfc3339_to_unix_millis") {
        const enumRes = ensureEnumOrConstResult("invalid_lens_proof", src.schema);
        if (Result9.isError(enumRes))
          return enumRes;
      }
      const dest = getPathInfo(newSchema, pathSeg, true);
      if (!dest.exists)
        return invalidLensProof("convert dest missing");
      const outType = { type: op.toType };
      if (!isSchemaCompatible(outType, dest.schema))
        return invalidLensProof("convert dest incompatible");
      return Result9.ok(undefined);
    }
    case "in": {
      const pathSegRes = parsePointerResult(op.path, "invalid_lens_proof");
      if (Result9.isError(pathSegRes))
        return pathSegRes;
      const pathSeg = pathSegRes.value;
      const src = getPathInfo(oldSchema, pathSeg, true);
      const dest = getPathInfo(newSchema, pathSeg, true);
      if (!src.exists || !src.required || !isObjectSchema(src.schema))
        return invalidLensProof("in path invalid");
      if (!dest.exists || !isObjectSchema(dest.schema))
        return invalidLensProof("in dest invalid");
      return validateOpsResult(src.schema, dest.schema, op.ops);
    }
    case "map": {
      const pathSegRes = parsePointerResult(op.path, "invalid_lens_proof");
      if (Result9.isError(pathSegRes))
        return pathSegRes;
      const pathSeg = pathSegRes.value;
      const src = getPathInfo(oldSchema, pathSeg, true);
      const dest = getPathInfo(newSchema, pathSeg, true);
      if (!src.exists || !src.required || !isArraySchema(src.schema))
        return invalidLensProof("map path invalid");
      if (!dest.exists || !isArraySchema(dest.schema))
        return invalidLensProof("map dest invalid");
      const srcItems = getItemsSchema(src.schema);
      const destItems = getItemsSchema(dest.schema);
      return validateOpsResult(srcItems, destItems, op.ops);
    }
    default:
      return invalidLensProof(`unknown op: ${op.op}`);
  }
}
function validateOpsResult(oldSchema, newSchema, ops) {
  for (let i = 0;i < ops.length; i++) {
    const res = validateOpResult(oldSchema, newSchema, ops[i], ops.slice(0, i), ops.slice(i + 1));
    if (Result9.isError(res))
      return res;
  }
  return Result9.ok(undefined);
}
function validateLensAgainstSchemasResult(oldSchema, newSchema, lens) {
  return validateOpsResult(oldSchema, newSchema, lens.ops);
}
function fillOpsDefaultsResult(ops, newSchema) {
  for (const op of ops) {
    if (op.op === "add") {
      if (op.default === undefined) {
        const pathRes = parsePointerResult(op.path, "invalid_lens_defaults");
        if (Result9.isError(pathRes))
          return pathRes;
        const info = getPathInfo(newSchema, pathRes.value, true);
        if (!info.exists)
          return invalidLensDefaults("add dest missing in new schema");
        const def = deriveDefault(info.schema);
        if (def === undefined)
          return invalidLensDefaults("add missing default");
        op.default = def;
      }
      continue;
    }
    if (op.op === "in") {
      const pathRes = parsePointerResult(op.path, "invalid_lens_defaults");
      if (Result9.isError(pathRes))
        return pathRes;
      const info = getPathInfo(newSchema, pathRes.value, true);
      if (!info.exists)
        return invalidLensDefaults("in dest missing in new schema");
      const nestedRes = fillOpsDefaultsResult(op.ops, info.schema);
      if (Result9.isError(nestedRes))
        return nestedRes;
      continue;
    }
    if (op.op === "map") {
      const pathRes = parsePointerResult(op.path, "invalid_lens_defaults");
      if (Result9.isError(pathRes))
        return pathRes;
      const info = getPathInfo(newSchema, pathRes.value, true);
      if (!info.exists)
        return invalidLensDefaults("map dest missing in new schema");
      const items = getItemsSchema(info.schema);
      const nestedRes = fillOpsDefaultsResult(op.ops, items);
      if (Result9.isError(nestedRes))
        return nestedRes;
    }
  }
  return Result9.ok(undefined);
}
function cloneLensForDefaultsResult(lens) {
  try {
    return Result9.ok(JSON.parse(JSON.stringify(lens)));
  } catch (e) {
    return invalidLensDefaults(String(e?.message ?? e));
  }
}
function fillLensDefaultsResult(lens, newSchema) {
  const copyRes = cloneLensForDefaultsResult(lens);
  if (Result9.isError(copyRes))
    return copyRes;
  const fillRes = fillOpsDefaultsResult(copyRes.value.ops, newSchema);
  if (Result9.isError(fillRes))
    return fillRes;
  return Result9.ok(copyRes.value);
}

// src/touch/spec.ts
import { Result as Result10 } from "better-result";
function invalidInterpreter(message) {
  return Result10.err({ kind: "invalid_interpreter", message });
}
function parseNumberField(value, defaultValue, message, predicate) {
  const n = value === undefined ? defaultValue : Number(value);
  if (!Number.isFinite(n) || !predicate(n))
    return invalidInterpreter(message);
  return Result10.ok(n);
}
function parseIntegerField(value, defaultValue, message, predicate) {
  const n = value === undefined ? defaultValue : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || !predicate(n))
    return invalidInterpreter(message);
  return Result10.ok(n);
}
function validateTouchConfigResult(raw) {
  if (!raw || typeof raw !== "object")
    return invalidInterpreter("interpreter.touch must be an object");
  const enabled = !!raw.enabled;
  if (!enabled) {
    return Result10.ok({ enabled: false });
  }
  if (raw.storage !== undefined) {
    return invalidInterpreter("interpreter.touch.storage is no longer supported; touch always uses the in-memory journal");
  }
  if (raw.derivedStream !== undefined) {
    return invalidInterpreter("interpreter.touch.derivedStream is no longer supported");
  }
  if (raw.retention !== undefined) {
    return invalidInterpreter("interpreter.touch.retention is no longer supported");
  }
  const coarseIntervalMsRes = parseNumberField(raw.coarseIntervalMs, 100, "interpreter.touch.coarseIntervalMs must be > 0", (n) => n > 0);
  if (Result10.isError(coarseIntervalMsRes))
    return coarseIntervalMsRes;
  const touchCoalesceWindowMsRes = parseNumberField(raw.touchCoalesceWindowMs, 100, "interpreter.touch.touchCoalesceWindowMs must be > 0", (n) => n > 0);
  if (Result10.isError(touchCoalesceWindowMsRes))
    return touchCoalesceWindowMsRes;
  const onMissingBefore = raw.onMissingBefore === undefined ? "coarse" : raw.onMissingBefore;
  if (onMissingBefore !== "coarse" && onMissingBefore !== "skipBefore" && onMissingBefore !== "error") {
    return invalidInterpreter("interpreter.touch.onMissingBefore must be coarse|skipBefore|error");
  }
  const templates = raw.templates && typeof raw.templates === "object" ? raw.templates : {};
  const defaultInactivityTtlMsRes = parseNumberField(templates.defaultInactivityTtlMs, 60 * 60 * 1000, "interpreter.touch.templates.defaultInactivityTtlMs must be >= 0", (n) => n >= 0);
  if (Result10.isError(defaultInactivityTtlMsRes))
    return defaultInactivityTtlMsRes;
  const lastSeenPersistIntervalMsRes = parseNumberField(templates.lastSeenPersistIntervalMs, 5 * 60 * 1000, "interpreter.touch.templates.lastSeenPersistIntervalMs must be > 0", (n) => n > 0);
  if (Result10.isError(lastSeenPersistIntervalMsRes))
    return lastSeenPersistIntervalMsRes;
  const gcIntervalMsRes = parseNumberField(templates.gcIntervalMs, 60000, "interpreter.touch.templates.gcIntervalMs must be > 0", (n) => n > 0);
  if (Result10.isError(gcIntervalMsRes))
    return gcIntervalMsRes;
  const maxActiveTemplatesPerEntityRes = parseNumberField(templates.maxActiveTemplatesPerEntity, 256, "interpreter.touch.templates.maxActiveTemplatesPerEntity must be > 0", (n) => n > 0);
  if (Result10.isError(maxActiveTemplatesPerEntityRes))
    return maxActiveTemplatesPerEntityRes;
  const maxActiveTemplatesPerStreamRes = parseNumberField(templates.maxActiveTemplatesPerStream, 2048, "interpreter.touch.templates.maxActiveTemplatesPerStream must be > 0", (n) => n > 0);
  if (Result10.isError(maxActiveTemplatesPerStreamRes))
    return maxActiveTemplatesPerStreamRes;
  const activationRateLimitPerMinuteRes = parseNumberField(templates.activationRateLimitPerMinute, 100, "interpreter.touch.templates.activationRateLimitPerMinute must be >= 0", (n) => n >= 0);
  if (Result10.isError(activationRateLimitPerMinuteRes))
    return activationRateLimitPerMinuteRes;
  if (raw.metrics !== undefined) {
    return invalidInterpreter("interpreter.touch.metrics is not supported; live metrics are a global server feature");
  }
  const memoryRaw = raw.memory && typeof raw.memory === "object" ? raw.memory : {};
  const bucketMsRes = parseIntegerField(memoryRaw.bucketMs, 100, "interpreter.touch.memory.bucketMs must be an integer > 0", (n) => n > 0);
  if (Result10.isError(bucketMsRes))
    return bucketMsRes;
  const filterPow2Res = parseIntegerField(memoryRaw.filterPow2, 22, "interpreter.touch.memory.filterPow2 must be an integer in [10,30]", (n) => n >= 10 && n <= 30);
  if (Result10.isError(filterPow2Res))
    return filterPow2Res;
  const kRes = parseIntegerField(memoryRaw.k, 4, "interpreter.touch.memory.k must be an integer in [1,8]", (n) => n >= 1 && n <= 8);
  if (Result10.isError(kRes))
    return kRes;
  const pendingMaxKeysRes = parseIntegerField(memoryRaw.pendingMaxKeys, 1e5, "interpreter.touch.memory.pendingMaxKeys must be an integer > 0", (n) => n > 0);
  if (Result10.isError(pendingMaxKeysRes))
    return pendingMaxKeysRes;
  const keyIndexMaxKeysRes = parseIntegerField(memoryRaw.keyIndexMaxKeys, 32, "interpreter.touch.memory.keyIndexMaxKeys must be an integer in [1,1024]", (n) => n >= 1 && n <= 1024);
  if (Result10.isError(keyIndexMaxKeysRes))
    return keyIndexMaxKeysRes;
  const hotKeyTtlMsRes = parseIntegerField(memoryRaw.hotKeyTtlMs, 1e4, "interpreter.touch.memory.hotKeyTtlMs must be an integer > 0", (n) => n > 0);
  if (Result10.isError(hotKeyTtlMsRes))
    return hotKeyTtlMsRes;
  const hotTemplateTtlMsRes = parseIntegerField(memoryRaw.hotTemplateTtlMs, 1e4, "interpreter.touch.memory.hotTemplateTtlMs must be an integer > 0", (n) => n > 0);
  if (Result10.isError(hotTemplateTtlMsRes))
    return hotTemplateTtlMsRes;
  const hotMaxKeysRes = parseIntegerField(memoryRaw.hotMaxKeys, 1e6, "interpreter.touch.memory.hotMaxKeys must be an integer > 0", (n) => n > 0);
  if (Result10.isError(hotMaxKeysRes))
    return hotMaxKeysRes;
  const hotMaxTemplatesRes = parseIntegerField(memoryRaw.hotMaxTemplates, 4096, "interpreter.touch.memory.hotMaxTemplates must be an integer > 0", (n) => n > 0);
  if (Result10.isError(hotMaxTemplatesRes))
    return hotMaxTemplatesRes;
  const lagDegradeFineTouchesAtSourceOffsetsRes = parseIntegerField(raw.lagDegradeFineTouchesAtSourceOffsets, 5000, "interpreter.touch.lagDegradeFineTouchesAtSourceOffsets must be an integer >= 0", (n) => n >= 0);
  if (Result10.isError(lagDegradeFineTouchesAtSourceOffsetsRes))
    return lagDegradeFineTouchesAtSourceOffsetsRes;
  const lagRecoverFineTouchesAtSourceOffsetsRes = parseIntegerField(raw.lagRecoverFineTouchesAtSourceOffsets, 1000, "interpreter.touch.lagRecoverFineTouchesAtSourceOffsets must be an integer >= 0", (n) => n >= 0);
  if (Result10.isError(lagRecoverFineTouchesAtSourceOffsetsRes))
    return lagRecoverFineTouchesAtSourceOffsetsRes;
  const fineTouchBudgetPerBatchRes = parseIntegerField(raw.fineTouchBudgetPerBatch, 2000, "interpreter.touch.fineTouchBudgetPerBatch must be an integer >= 0", (n) => n >= 0);
  if (Result10.isError(fineTouchBudgetPerBatchRes))
    return fineTouchBudgetPerBatchRes;
  const fineTokensPerSecondRes = parseIntegerField(raw.fineTokensPerSecond, 200000, "interpreter.touch.fineTokensPerSecond must be an integer >= 0", (n) => n >= 0);
  if (Result10.isError(fineTokensPerSecondRes))
    return fineTokensPerSecondRes;
  const fineBurstTokensRes = parseIntegerField(raw.fineBurstTokens, 400000, "interpreter.touch.fineBurstTokens must be an integer >= 0", (n) => n >= 0);
  if (Result10.isError(fineBurstTokensRes))
    return fineBurstTokensRes;
  const lagReservedFineTouchBudgetPerBatchRes = parseIntegerField(raw.lagReservedFineTouchBudgetPerBatch, 200, "interpreter.touch.lagReservedFineTouchBudgetPerBatch must be an integer >= 0", (n) => n >= 0);
  if (Result10.isError(lagReservedFineTouchBudgetPerBatchRes))
    return lagReservedFineTouchBudgetPerBatchRes;
  return Result10.ok({
    enabled: true,
    coarseIntervalMs: coarseIntervalMsRes.value,
    touchCoalesceWindowMs: touchCoalesceWindowMsRes.value,
    onMissingBefore,
    lagDegradeFineTouchesAtSourceOffsets: lagDegradeFineTouchesAtSourceOffsetsRes.value,
    lagRecoverFineTouchesAtSourceOffsets: lagRecoverFineTouchesAtSourceOffsetsRes.value,
    fineTouchBudgetPerBatch: fineTouchBudgetPerBatchRes.value,
    fineTokensPerSecond: fineTokensPerSecondRes.value,
    fineBurstTokens: fineBurstTokensRes.value,
    lagReservedFineTouchBudgetPerBatch: lagReservedFineTouchBudgetPerBatchRes.value,
    memory: {
      bucketMs: bucketMsRes.value,
      filterPow2: filterPow2Res.value,
      k: kRes.value,
      pendingMaxKeys: pendingMaxKeysRes.value,
      keyIndexMaxKeys: keyIndexMaxKeysRes.value,
      hotKeyTtlMs: hotKeyTtlMsRes.value,
      hotTemplateTtlMs: hotTemplateTtlMsRes.value,
      hotMaxKeys: hotMaxKeysRes.value,
      hotMaxTemplates: hotMaxTemplatesRes.value
    },
    templates: {
      defaultInactivityTtlMs: defaultInactivityTtlMsRes.value,
      lastSeenPersistIntervalMs: lastSeenPersistIntervalMsRes.value,
      gcIntervalMs: gcIntervalMsRes.value,
      maxActiveTemplatesPerEntity: maxActiveTemplatesPerEntityRes.value,
      maxActiveTemplatesPerStream: maxActiveTemplatesPerStreamRes.value,
      activationRateLimitPerMinute: activationRateLimitPerMinuteRes.value
    }
  });
}
function validateStreamInterpreterConfigResult(raw) {
  if (!raw || typeof raw !== "object")
    return invalidInterpreter("interpreter must be an object");
  if (raw.apiVersion !== "durable.streams/stream-interpreter/v1") {
    return invalidInterpreter("invalid interpreter apiVersion");
  }
  const formatRaw = raw.format === undefined ? undefined : raw.format;
  if (formatRaw !== undefined && formatRaw !== "durable.streams/state-protocol/v1") {
    return invalidInterpreter("interpreter.format must be durable.streams/state-protocol/v1");
  }
  if (raw.variants !== undefined) {
    return invalidInterpreter("interpreter.variants is not supported (State Protocol is the only supported format)");
  }
  let touch;
  if (raw.touch !== undefined) {
    const touchRes = validateTouchConfigResult(raw.touch);
    if (Result10.isError(touchRes))
      return invalidInterpreter(touchRes.error.message);
    touch = touchRes.value;
  }
  return Result10.ok({
    apiVersion: "durable.streams/stream-interpreter/v1",
    format: "durable.streams/state-protocol/v1",
    touch
  });
}
function isTouchEnabled(cfg) {
  return !!cfg?.touch?.enabled;
}

// src/schema/registry.ts
var AJV = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  validateSchema: false
});
var LENS_VALIDATOR = AJV.compile(DURABLE_LENS_V1_SCHEMA);
function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}
function defaultRegistry(stream) {
  return {
    apiVersion: "durable.streams/schema-registry/v1",
    schema: stream,
    currentVersion: 0,
    boundaries: [],
    schemas: {},
    lenses: {}
  };
}
function ensureNoRefResult(schema) {
  const stack = [schema];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object")
      continue;
    if (Object.prototype.hasOwnProperty.call(cur, "$ref")) {
      return Result11.err({ message: "external $ref is not supported" });
    }
    for (const v of Object.values(cur)) {
      if (v && typeof v === "object")
        stack.push(v);
    }
  }
  return Result11.ok(undefined);
}
function validateJsonSchemaResult(schema) {
  const noRefRes = ensureNoRefResult(schema);
  if (Result11.isError(noRefRes))
    return noRefRes;
  try {
    const validate = AJV.compile(schema);
    if (!validate)
      return Result11.err({ message: "schema validation failed" });
  } catch (e) {
    return Result11.err({ message: String(e?.message ?? e) });
  }
  return Result11.ok(undefined);
}
function parseRegistryResult(stream, json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return Result11.err({ message: String(e?.message ?? e) });
  }
  if (!raw || typeof raw !== "object")
    return Result11.err({ message: "invalid schema registry" });
  const reg = raw;
  if (reg.apiVersion !== "durable.streams/schema-registry/v1")
    return Result11.err({ message: "invalid registry apiVersion" });
  if (!reg.schema)
    reg.schema = stream;
  if (!Array.isArray(reg.boundaries))
    reg.boundaries = [];
  if (!reg.schemas || typeof reg.schemas !== "object")
    reg.schemas = {};
  if (!reg.lenses || typeof reg.lenses !== "object")
    reg.lenses = {};
  if (typeof reg.currentVersion !== "number")
    reg.currentVersion = 0;
  if (reg.interpreter === null)
    delete reg.interpreter;
  return Result11.ok(reg);
}
function serializeRegistry(reg) {
  return JSON.stringify(reg);
}
function validateLensResult(raw) {
  const ok = LENS_VALIDATOR(raw);
  if (!ok) {
    const msg = AJV.errorsText(LENS_VALIDATOR.errors || undefined);
    return Result11.err({ message: `invalid lens: ${msg}` });
  }
  return Result11.ok(raw);
}
function bigintToNumberSafeResult(v) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (v > max)
    return Result11.err({ message: "offset exceeds MAX_SAFE_INTEGER" });
  return Result11.ok(Number(v));
}

class SchemaRegistryStore {
  db;
  registryCache;
  validatorCache;
  lensCache;
  lensChainCache;
  constructor(db, opts) {
    this.db = db;
    this.registryCache = new LruCache(opts?.registryCacheEntries ?? 1024);
    this.validatorCache = new LruCache(opts?.validatorCacheEntries ?? 256);
    this.lensCache = new LruCache(opts?.lensCacheEntries ?? 256);
    this.lensChainCache = new LruCache(opts?.lensCacheEntries ?? 256);
  }
  loadRow(stream) {
    return this.db.getSchemaRegistry(stream);
  }
  getRegistry(stream) {
    const res = this.getRegistryResult(stream);
    if (Result11.isError(res))
      throw dsError(res.error.message, { code: res.error.code });
    return res.value;
  }
  getRegistryResult(stream) {
    const row = this.loadRow(stream);
    if (!row)
      return Result11.ok(defaultRegistry(stream));
    const cached = this.registryCache.get(stream);
    if (cached && cached.updatedAtMs === row.updated_at_ms)
      return Result11.ok(cached.reg);
    const parseRes = parseRegistryResult(stream, row.registry_json);
    if (Result11.isError(parseRes)) {
      return Result11.err({ kind: "invalid_registry", message: parseRes.error.message });
    }
    const reg = parseRes.value;
    this.registryCache.set(stream, { reg, updatedAtMs: row.updated_at_ms });
    return Result11.ok(reg);
  }
  updateRegistry(stream, streamRow, update) {
    const res = this.updateRegistryResult(stream, streamRow, update);
    if (Result11.isError(res))
      throw dsError(res.error.message, { code: res.error.code });
    return res.value;
  }
  updateRegistryResult(stream, streamRow, update) {
    let validatedInterpreter = undefined;
    if (update.routingKey) {
      const pointerRes = parseJsonPointerResult(update.routingKey.jsonPointer);
      if (Result11.isError(pointerRes)) {
        return Result11.err({ kind: "bad_request", message: pointerRes.error.message });
      }
      if (typeof update.routingKey.required !== "boolean") {
        return Result11.err({ kind: "bad_request", message: "routingKey.required must be boolean" });
      }
    }
    if (update.interpreter !== undefined) {
      if (update.interpreter === null) {
        validatedInterpreter = null;
      } else {
        const interpreterRes = validateStreamInterpreterConfigResult(update.interpreter);
        if (Result11.isError(interpreterRes)) {
          return Result11.err({ kind: "bad_request", message: interpreterRes.error.message });
        }
        validatedInterpreter = interpreterRes.value;
      }
    }
    if (update.schema === undefined)
      return Result11.err({ kind: "bad_request", message: "missing schema" });
    const schemaRes = validateJsonSchemaResult(update.schema);
    if (Result11.isError(schemaRes))
      return Result11.err({ kind: "bad_request", message: schemaRes.error.message });
    const regRes = this.getRegistryResult(stream);
    if (Result11.isError(regRes))
      return Result11.err({ kind: "bad_request", message: regRes.error.message, code: regRes.error.code });
    const reg = regRes.value;
    const currentVersion = reg.currentVersion ?? 0;
    const streamEmpty = streamRow.next_offset === 0n;
    if (currentVersion === 0) {
      if (!streamEmpty)
        return Result11.err({ kind: "bad_request", message: "first schema requires empty stream" });
      if (update.lens) {
        const lensRes2 = validateLensResult(update.lens);
        if (Result11.isError(lensRes2))
          return Result11.err({ kind: "bad_request", message: lensRes2.error.message });
        if (lensRes2.value.from !== 0 || lensRes2.value.to !== 1) {
          return Result11.err({
            kind: "version_mismatch",
            message: "lens version mismatch",
            code: "schema_lens_version_mismatch"
          });
        }
      }
      const nextReg2 = {
        apiVersion: "durable.streams/schema-registry/v1",
        schema: stream,
        currentVersion: 1,
        routingKey: update.routingKey,
        interpreter: update.interpreter === undefined ? reg.interpreter : validatedInterpreter ?? undefined,
        boundaries: [{ offset: 0, version: 1 }],
        schemas: { ...reg.schemas, ["1"]: update.schema },
        lenses: { ...reg.lenses }
      };
      this.persist(stream, nextReg2);
      this.syncInterpreterState(stream, nextReg2);
      return Result11.ok(nextReg2);
    }
    if (!update.lens)
      return Result11.err({ kind: "bad_request", message: "lens required" });
    const lensRes = validateLensResult(update.lens);
    if (Result11.isError(lensRes))
      return Result11.err({ kind: "bad_request", message: lensRes.error.message });
    const lens = lensRes.value;
    if (lens.from !== currentVersion || lens.to !== currentVersion + 1) {
      return Result11.err({
        kind: "version_mismatch",
        message: "lens version mismatch",
        code: "schema_lens_version_mismatch"
      });
    }
    if (lens.schema && lens.schema !== reg.schema)
      return Result11.err({ kind: "bad_request", message: "lens schema mismatch" });
    const oldSchema = reg.schemas[String(currentVersion)];
    if (!oldSchema)
      return Result11.err({ kind: "bad_request", message: "missing current schema" });
    const proofRes = validateLensAgainstSchemasResult(oldSchema, update.schema, lens);
    if (Result11.isError(proofRes))
      return Result11.err({ kind: "bad_request", message: proofRes.error.message });
    const defaultsRes = fillLensDefaultsResult(lens, update.schema);
    if (Result11.isError(defaultsRes))
      return Result11.err({ kind: "bad_request", message: defaultsRes.error.message });
    const boundaryRes = bigintToNumberSafeResult(streamRow.next_offset);
    if (Result11.isError(boundaryRes))
      return Result11.err({ kind: "bad_request", message: boundaryRes.error.message });
    const nextVersion = currentVersion + 1;
    const nextReg = {
      apiVersion: "durable.streams/schema-registry/v1",
      schema: reg.schema ?? stream,
      currentVersion: nextVersion,
      routingKey: update.routingKey ?? reg.routingKey,
      interpreter: update.interpreter === undefined ? reg.interpreter : validatedInterpreter ?? undefined,
      boundaries: [...reg.boundaries, { offset: boundaryRes.value, version: nextVersion }],
      schemas: { ...reg.schemas, [String(nextVersion)]: update.schema },
      lenses: { ...reg.lenses, [String(currentVersion)]: defaultsRes.value }
    };
    this.persist(stream, nextReg);
    this.syncInterpreterState(stream, nextReg);
    return Result11.ok(nextReg);
  }
  updateRoutingKey(stream, routingKey) {
    const res = this.updateRoutingKeyResult(stream, routingKey);
    if (Result11.isError(res))
      throw dsError(res.error.message, { code: res.error.code });
    return res.value;
  }
  updateRoutingKeyResult(stream, routingKey) {
    if (routingKey) {
      const pointerRes = parseJsonPointerResult(routingKey.jsonPointer);
      if (Result11.isError(pointerRes)) {
        return Result11.err({ kind: "bad_request", message: pointerRes.error.message });
      }
      if (typeof routingKey.required !== "boolean") {
        return Result11.err({ kind: "bad_request", message: "routingKey.required must be boolean" });
      }
    }
    const regRes = this.getRegistryResult(stream);
    if (Result11.isError(regRes))
      return Result11.err({ kind: "bad_request", message: regRes.error.message, code: regRes.error.code });
    const nextReg = {
      ...regRes.value,
      routingKey: routingKey ?? undefined
    };
    this.persist(stream, nextReg);
    this.syncInterpreterState(stream, nextReg);
    return Result11.ok(nextReg);
  }
  updateInterpreter(stream, interpreter) {
    const res = this.updateInterpreterResult(stream, interpreter);
    if (Result11.isError(res))
      throw dsError(res.error.message, { code: res.error.code });
    return res.value;
  }
  updateInterpreterResult(stream, interpreter) {
    let validatedInterpreter = interpreter;
    if (interpreter) {
      const interpreterRes = validateStreamInterpreterConfigResult(interpreter);
      if (Result11.isError(interpreterRes)) {
        return Result11.err({ kind: "bad_request", message: interpreterRes.error.message });
      }
      validatedInterpreter = interpreterRes.value;
    }
    const regRes = this.getRegistryResult(stream);
    if (Result11.isError(regRes))
      return Result11.err({ kind: "bad_request", message: regRes.error.message, code: regRes.error.code });
    const nextReg = {
      ...regRes.value,
      interpreter: validatedInterpreter ?? undefined
    };
    this.persist(stream, nextReg);
    this.syncInterpreterState(stream, nextReg);
    return Result11.ok(nextReg);
  }
  persist(stream, reg) {
    const json = serializeRegistry(reg);
    this.db.upsertSchemaRegistry(stream, json);
    this.registryCache.set(stream, { reg, updatedAtMs: this.db.nowMs() });
  }
  syncInterpreterState(stream, reg) {
    if (isTouchEnabled(reg.interpreter)) {
      this.db.ensureStreamInterpreter(stream);
    } else {
      this.db.deleteStreamInterpreter(stream);
    }
  }
  getValidatorForVersion(reg, version) {
    const schema = reg.schemas[String(version)];
    if (!schema)
      return null;
    const hash = sha256Hex(JSON.stringify(schema));
    const cached = this.validatorCache.get(hash);
    if (cached)
      return cached;
    const validate = AJV.compile(schema);
    this.validatorCache.set(hash, validate);
    return validate;
  }
  getLensChain(reg, fromVersion, toVersion) {
    const res = this.getLensChainResult(reg, fromVersion, toVersion);
    if (Result11.isError(res))
      throw dsError(res.error.message, { code: res.error.code });
    return res.value;
  }
  getLensChainResult(reg, fromVersion, toVersion) {
    const key = `${reg.schema}:${fromVersion}->${toVersion}`;
    const cached = this.lensChainCache.get(key);
    if (cached)
      return Result11.ok(cached);
    const chain = [];
    for (let v = fromVersion;v < toVersion; v++) {
      const lensRaw = reg.lenses[String(v)];
      if (!lensRaw) {
        return Result11.err({
          kind: "invalid_lens_chain",
          message: `missing lens v${v}->v${v + 1}`
        });
      }
      const hash = sha256Hex(JSON.stringify(lensRaw));
      let compiled = this.lensCache.get(hash);
      if (!compiled) {
        const compiledRes = compileLensResult(lensFromJson(lensRaw));
        if (Result11.isError(compiledRes)) {
          return Result11.err({
            kind: "invalid_lens_chain",
            message: compiledRes.error.message
          });
        }
        compiled = compiledRes.value;
        this.lensCache.set(hash, compiled);
      }
      chain.push(compiled);
    }
    this.lensChainCache.set(key, chain);
    return Result11.ok(chain);
  }
}

// src/expiry_sweeper.ts
class ExpirySweeper {
  cfg;
  db;
  timer = null;
  running = false;
  constructor(cfg, db) {
    this.cfg = cfg;
    this.db = db;
  }
  start() {
    if (this.timer || this.cfg.expirySweepIntervalMs <= 0)
      return;
    this.timer = setInterval(() => {
      this.tick();
    }, this.cfg.expirySweepIntervalMs);
  }
  stop() {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = null;
  }
  async tick() {
    if (this.running)
      return;
    this.running = true;
    try {
      const expired = this.db.listExpiredStreams(this.cfg.expirySweepBatchLimit);
      if (expired.length === 0)
        return;
      for (const stream of expired) {
        try {
          this.db.deleteStream(stream);
        } catch {}
      }
    } finally {
      this.running = false;
    }
  }
}

// src/backpressure.ts
class BackpressureGate {
  maxBytes;
  currentBytes;
  reservedBytes;
  constructor(maxBytes, initialBytes) {
    this.maxBytes = maxBytes;
    this.currentBytes = Math.max(0, initialBytes);
    this.reservedBytes = 0;
  }
  enabled() {
    return this.maxBytes > 0;
  }
  reserve(bytes) {
    if (this.maxBytes <= 0)
      return true;
    if (bytes <= 0)
      return true;
    if (this.currentBytes + this.reservedBytes + bytes > this.maxBytes)
      return false;
    this.reservedBytes += bytes;
    return true;
  }
  commit(bytes, reservedBytes = bytes) {
    if (this.maxBytes <= 0)
      return;
    if (bytes <= 0)
      return;
    if (reservedBytes > 0)
      this.reservedBytes = Math.max(0, this.reservedBytes - reservedBytes);
    this.currentBytes += bytes;
  }
  release(bytes) {
    if (this.maxBytes <= 0)
      return;
    if (bytes <= 0)
      return;
    this.reservedBytes = Math.max(0, this.reservedBytes - bytes);
  }
  adjustOnSeal(payloadBytes, segmentBytes) {
    if (this.maxBytes <= 0)
      return;
    const delta = segmentBytes - payloadBytes;
    this.currentBytes = Math.max(0, this.currentBytes + delta);
  }
  adjustOnUpload(segmentBytes) {
    if (this.maxBytes <= 0)
      return;
    this.currentBytes = Math.max(0, this.currentBytes - segmentBytes);
  }
  adjustOnWalTrim(payloadBytes) {
    if (this.maxBytes <= 0)
      return;
    if (payloadBytes <= 0)
      return;
    this.currentBytes = Math.max(0, this.currentBytes - payloadBytes);
  }
  getCurrentBytes() {
    return this.currentBytes;
  }
  getMaxBytes() {
    return this.maxBytes;
  }
  isOverLimit() {
    if (this.maxBytes <= 0)
      return false;
    return this.currentBytes + this.reservedBytes >= this.maxBytes;
  }
}

// src/memory.ts
class MemoryGuard {
  limitBytes;
  resumeBytes;
  intervalMs;
  onSample;
  heapSnapshotPath;
  heapSnapshotMinIntervalMs;
  timer = null;
  overLimit = false;
  maxRssBytes = 0;
  lastRssBytes = 0;
  lastGcMs = 0;
  lastSnapshotMs = 0;
  constructor(limitBytes, opts = {}) {
    this.limitBytes = Math.max(0, limitBytes);
    const resumeFraction = Math.min(1, Math.max(0.5, opts.resumeFraction ?? 1));
    this.resumeBytes = Math.floor(this.limitBytes * resumeFraction);
    this.intervalMs = Math.max(50, opts.intervalMs ?? 1000);
    this.onSample = opts.onSample;
    this.heapSnapshotPath = opts.heapSnapshotPath;
    this.heapSnapshotMinIntervalMs = Math.max(1000, opts.heapSnapshotMinIntervalMs ?? 60000);
  }
  start() {
    if (this.timer)
      return;
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
  }
  stop() {
    if (this.timer)
      clearInterval(this.timer);
    this.timer = null;
  }
  sample() {
    const rss = process.memoryUsage().rss;
    this.lastRssBytes = rss;
    if (rss > this.maxRssBytes)
      this.maxRssBytes = rss;
    if (this.onSample) {
      const overLimit = this.limitBytes > 0 && rss > this.limitBytes;
      try {
        this.onSample(rss, overLimit, this.limitBytes);
      } catch {}
    }
    if (this.limitBytes <= 0)
      return;
    if (this.overLimit) {
      if (rss <= this.resumeBytes)
        this.overLimit = false;
    } else if (rss > this.limitBytes) {
      this.overLimit = true;
    }
  }
  shouldAllow() {
    if (this.limitBytes <= 0)
      return true;
    return !this.overLimit;
  }
  isOverLimit() {
    return this.overLimit;
  }
  getMaxRssBytes() {
    return this.maxRssBytes;
  }
  snapshotMaxRssBytes(reset = true) {
    const max = this.maxRssBytes;
    if (reset)
      this.maxRssBytes = this.lastRssBytes;
    return max;
  }
  getLastRssBytes() {
    return this.lastRssBytes;
  }
  getLimitBytes() {
    return this.limitBytes;
  }
  maybeGc(reason) {
    const gcFn = globalThis?.Bun?.gc;
    if (typeof gcFn !== "function")
      return;
    const now = Date.now();
    if (now - this.lastGcMs < 1e4)
      return;
    this.lastGcMs = now;
    const before = process.memoryUsage().rss;
    try {
      gcFn(true);
    } catch {
      try {
        gcFn();
      } catch {
        return;
      }
    }
    const after = process.memoryUsage().rss;
    console.warn(`[gc] forced GC (${reason}) rss ${formatBytes2(before)} -> ${formatBytes2(after)}`);
  }
  maybeHeapSnapshot(reason) {
    if (!this.heapSnapshotPath)
      return;
    const now = Date.now();
    if (now - this.lastSnapshotMs < this.heapSnapshotMinIntervalMs)
      return;
    this.lastSnapshotMs = now;
    this.writeHeapSnapshot(reason);
  }
  async writeHeapSnapshot(reason) {
    try {
      const v8 = await import("v8");
      if (typeof v8.writeHeapSnapshot !== "function")
        return;
      const fs = await import("node:fs");
      try {
        fs.unlinkSync(this.heapSnapshotPath);
      } catch {}
      const before = process.memoryUsage().rss;
      v8.writeHeapSnapshot(this.heapSnapshotPath);
      const after = process.memoryUsage().rss;
      console.warn(`[heap] snapshot (${reason}) rss ${formatBytes2(before)} -> ${formatBytes2(after)} path=${this.heapSnapshotPath}`);
    } catch (err) {
      console.warn(`[heap] snapshot failed (${reason}): ${String(err)}`);
    }
  }
}
function formatBytes2(bytes) {
  const units = ["b", "kb", "mb", "gb"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const digits = idx === 0 ? 0 : 1;
  return `${value.toFixed(digits)}${units[idx]}`;
}

// src/touch/worker_pool.ts
import { existsSync as existsSync2 } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { Result as Result12 } from "better-result";
class TouchInterpreterWorkerPool {
  cfg;
  workerCount;
  workers = [];
  started = false;
  generation = 0;
  nextId = 1;
  pending = new Map;
  queue = [];
  constructor(cfg, workerCount) {
    this.cfg = cfg;
    this.workerCount = Math.max(0, Math.floor(workerCount));
  }
  start() {
    if (this.started)
      return;
    this.started = true;
    this.generation += 1;
    const generation = this.generation;
    for (let i = 0;i < this.workerCount; i++)
      this.spawnWorker(i, generation);
  }
  stop() {
    if (!this.started)
      return;
    this.started = false;
    this.generation += 1;
    for (const w of this.workers) {
      try {
        w.worker.postMessage({ type: "stop" });
      } catch {}
      w.worker.terminate();
    }
    this.workers.length = 0;
    this.queue.length = 0;
    for (const [id, p] of this.pending.entries()) {
      p.resolve(Result12.err({ kind: "worker_pool_failure", message: "worker pool stopped" }));
      this.pending.delete(id);
    }
  }
  restart() {
    this.stop();
    this.start();
  }
  async processResult(req) {
    if (!this.started) {
      return Result12.err({ kind: "worker_pool_unavailable", message: "worker pool not started" });
    }
    if (this.workerCount === 0) {
      return Result12.err({ kind: "worker_pool_unavailable", message: "worker pool disabled" });
    }
    const id = this.nextId++;
    const queued = { ...req, id };
    const value = await new Promise((resolve2) => {
      this.pending.set(id, { resolve: resolve2 });
      this.queue.push(queued);
      this.pump();
    });
    return value;
  }
  async process(req) {
    const res = await this.processResult(req);
    if (Result12.isError(res))
      throw dsError(res.error.message);
    return res.value;
  }
  pump() {
    if (!this.started)
      return;
    if (this.queue.length === 0)
      return;
    const slot = this.workers.find((w) => !w.busy);
    if (!slot)
      return;
    const next = this.queue.shift();
    if (!next)
      return;
    slot.busy = true;
    slot.currentId = next.id;
    slot.worker.postMessage({
      type: "process",
      id: next.id,
      stream: next.stream,
      fromOffset: next.fromOffset,
      toOffset: next.toOffset,
      interpreter: next.interpreter,
      maxRows: next.maxRows,
      maxBytes: next.maxBytes,
      emitFineTouches: next.emitFineTouches,
      fineTouchBudget: next.fineTouchBudget,
      fineGranularity: next.fineGranularity,
      interpretMode: next.interpretMode,
      filterHotTemplates: next.filterHotTemplates,
      hotTemplateIds: next.hotTemplateIds
    });
  }
  spawnWorker(idx, generation = this.generation) {
    const workerUrl = new URL("../touch/interpreter_worker.js", import.meta.url);
    let workerSpec = fileURLToPath(workerUrl);
    if (!existsSync2(workerSpec)) {
      const fallback = resolve(process.cwd(), "src/touch/interpreter_worker.ts");
      if (existsSync2(fallback))
        workerSpec = fallback;
    }
    const worker = new Worker(workerSpec, {
      workerData: { config: this.cfg, hostRuntime: detectHostRuntime() },
      type: "module",
      smol: true
    });
    const slot = { worker, busy: false, currentId: null };
    this.workers.push(slot);
    worker.on("message", (msg) => {
      if (generation !== this.generation)
        return;
      if (!msg || typeof msg !== "object")
        return;
      if (msg.type === "result") {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          slot.busy = false;
          slot.currentId = null;
          p.resolve(Result12.ok(msg));
        }
        this.pump();
        return;
      }
      if (msg.type === "error") {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          slot.busy = false;
          slot.currentId = null;
          p.resolve(Result12.err({ kind: "worker_pool_failure", message: msg.message }));
        }
        this.pump();
      }
    });
    worker.on("error", (err) => {
      if (generation !== this.generation)
        return;
      console.error(`touch interpreter worker ${idx} error`, err);
    });
    worker.on("exit", (code) => {
      if (generation !== this.generation || !this.started)
        return;
      console.error(`touch interpreter worker ${idx} exited with code ${code}, respawning`);
      if (slot.currentId != null) {
        const p = this.pending.get(slot.currentId);
        if (p) {
          this.pending.delete(slot.currentId);
          p.resolve(Result12.err({ kind: "worker_pool_failure", message: "worker exited" }));
        }
      }
      slot.busy = false;
      slot.currentId = null;
      try {
        const widx = this.workers.indexOf(slot);
        if (widx >= 0)
          this.workers.splice(widx, 1);
      } catch {}
      this.spawnWorker(idx, generation);
      this.pump();
    });
  }
}

// src/runtime/hash.ts
import { Result as Result13 } from "better-result";
import { createRequire as createRequire3 } from "node:module";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var xxh3Hasher = null;
var xxh64Hasher = null;
var xxh32Hasher = null;
var isBunRuntime = typeof globalThis.Bun !== "undefined";
var require3 = createRequire3(import.meta.url);
function loadVendoredModule(name) {
  const path = fileURLToPath2(new URL(`./hash_vendor/${name}`, import.meta.url));
  return require3(path);
}
if (!isBunRuntime) {
  const xxh3Module = loadVendoredModule("xxhash3.umd.min.cjs");
  const xxh64Module = loadVendoredModule("xxhash64.umd.min.cjs");
  const xxh32Module = loadVendoredModule("xxhash32.umd.min.cjs");
  xxh3Hasher = await xxh3Module.createXXHash3();
  xxh64Hasher = await xxh64Module.createXXHash64();
  xxh32Hasher = await xxh32Module.createXXHash32();
}
function toBigIntDigest(value) {
  if (typeof value === "bigint")
    return value;
  if (typeof value === "number")
    return BigInt(value >>> 0);
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length === 0)
    return 0n;
  return BigInt(`0x${hex}`);
}
function toHex16(value) {
  const masked = value & 0xffff_ffff_ffff_ffffn;
  return masked.toString(16).padStart(16, "0");
}
function bunHash64(input, fn) {
  return fn(input);
}
function nodeHash64Result(input, hasher, label) {
  if (!hasher)
    return Result13.err({ kind: "hasher_not_initialized", message: `${label} hasher not initialized` });
  hasher.init();
  hasher.update(input);
  const digest = hasher.digest("hex");
  return Result13.ok(toBigIntDigest(digest));
}
function nodeHash32Result(input) {
  if (!xxh32Hasher)
    return Result13.err({ kind: "hasher_not_initialized", message: "xxh32 hasher not initialized" });
  xxh32Hasher.init();
  xxh32Hasher.update(input);
  const digest = xxh32Hasher.digest("hex");
  if (typeof digest === "number")
    return Result13.ok(digest >>> 0);
  const asBigInt = toBigIntDigest(digest);
  return Result13.ok(Number(asBigInt & 0xffff_ffffn) >>> 0);
}
function xxh3BigIntResult(input) {
  if (isBunRuntime)
    return Result13.ok(bunHash64(input, (x) => Bun.hash.xxHash3(x)));
  return nodeHash64Result(input, xxh3Hasher, "xxh3");
}
function xxh3HexResult(input) {
  const res = xxh3BigIntResult(input);
  if (Result13.isError(res))
    return res;
  return Result13.ok(toHex16(res.value));
}
function xxh32Result(input) {
  if (isBunRuntime)
    return Result13.ok(Bun.hash.xxHash32(input) >>> 0);
  return nodeHash32Result(input);
}
function xxh3BigInt(input) {
  const res = xxh3BigIntResult(input);
  if (Result13.isError(res))
    throw dsError(res.error.message);
  return res.value;
}
function xxh3Hex(input) {
  const res = xxh3HexResult(input);
  if (Result13.isError(res))
    throw dsError(res.error.message);
  return res.value;
}

// src/touch/live_keys.ts
function utf8(s) {
  return new TextEncoder().encode(s);
}
function encodeU64Be(v) {
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 7;i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
function xxh3Low32(bytes) {
  const h = xxh3BigInt(bytes);
  return Number(h & 0xffffffffn) >>> 0;
}
function canonicalizeTemplateFields(fields) {
  const out = [...fields].map((f) => ({ name: f.name, encoding: f.encoding }));
  out.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return out;
}
function templateIdFor(entity, fieldNamesSorted) {
  const parts = [utf8("tpl\x00"), utf8(entity), utf8("\x00")];
  for (let i = 0;i < fieldNamesSorted.length; i++) {
    if (i > 0)
      parts.push(utf8("\x00"));
    parts.push(utf8(fieldNamesSorted[i]));
  }
  return xxh3Hex(concat(parts));
}
function tableKeyIdFor(entity) {
  return xxh3Low32(concat([utf8("tbl\x00"), utf8(entity)]));
}
function templateKeyIdFor(templateIdHex16) {
  const tplBytes = encodeU64Be(BigInt(`0x${templateIdHex16}`));
  return xxh3Low32(concat([utf8("tpl\x00"), tplBytes]));
}
function concat(parts) {
  let total = 0;
  for (const p of parts)
    total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

// src/touch/live_templates.ts
function nowIso(ms) {
  return new Date(ms).toISOString();
}
function parseTemplateRow(row) {
  return {
    stream: String(row.stream),
    template_id: String(row.template_id),
    entity: String(row.entity),
    fields_json: String(row.fields_json),
    encodings_json: String(row.encodings_json),
    state: String(row.state),
    created_at_ms: typeof row.created_at_ms === "bigint" ? row.created_at_ms : BigInt(row.created_at_ms),
    last_seen_at_ms: typeof row.last_seen_at_ms === "bigint" ? row.last_seen_at_ms : BigInt(row.last_seen_at_ms),
    inactivity_ttl_ms: typeof row.inactivity_ttl_ms === "bigint" ? row.inactivity_ttl_ms : BigInt(row.inactivity_ttl_ms),
    active_from_source_offset: typeof row.active_from_source_offset === "bigint" ? row.active_from_source_offset : BigInt(row.active_from_source_offset),
    retired_at_ms: row.retired_at_ms == null ? null : typeof row.retired_at_ms === "bigint" ? row.retired_at_ms : BigInt(row.retired_at_ms),
    retired_reason: row.retired_reason == null ? null : String(row.retired_reason)
  };
}

class LiveTemplateRegistry {
  db;
  lastSeenMem = new Map;
  dirtyLastSeen = new Set;
  rate = new Map;
  constructor(db) {
    this.db = db;
  }
  key(stream, templateId) {
    return `${stream}
${templateId}`;
  }
  allowActivation(stream, nowMs, limitPerMinute) {
    if (limitPerMinute <= 0)
      return true;
    const ratePerMs = limitPerMinute / 60000;
    const st = this.rate.get(stream) ?? { tokens: limitPerMinute, lastRefillMs: nowMs };
    const elapsed = Math.max(0, nowMs - st.lastRefillMs);
    st.tokens = Math.min(limitPerMinute, st.tokens + elapsed * ratePerMs);
    st.lastRefillMs = nowMs;
    if (st.tokens < 1) {
      this.rate.set(stream, st);
      return false;
    }
    st.tokens -= 1;
    this.rate.set(stream, st);
    return true;
  }
  getActiveTemplateCount(stream) {
    try {
      const row = this.db.db.query(`SELECT COUNT(*) as cnt FROM live_templates WHERE stream=? AND state='active';`).get(stream);
      return Number(row?.cnt ?? 0);
    } catch {
      return 0;
    }
  }
  listActiveTemplates(stream) {
    try {
      const rows = this.db.db.query(`SELECT template_id, entity, fields_json, encodings_json, last_seen_at_ms
           FROM live_templates
           WHERE stream=? AND state='active'
           ORDER BY entity ASC, template_id ASC;`).all(stream);
      const out = [];
      for (const row of rows) {
        const templateId = String(row.template_id);
        const entity = String(row.entity);
        const fields = JSON.parse(String(row.fields_json));
        const encodings = JSON.parse(String(row.encodings_json));
        if (!Array.isArray(fields) || !Array.isArray(encodings) || fields.length !== encodings.length)
          continue;
        const lastSeenAtMs = Number(row.last_seen_at_ms);
        out.push({ templateId, entity, fields: fields.map(String), encodings: encodings.map(String), lastSeenAtMs });
      }
      return out;
    } catch {
      return [];
    }
  }
  activate(args) {
    const { stream, templates, inactivityTtlMs, nowMs } = args;
    const { maxActiveTemplatesPerStream, maxActiveTemplatesPerEntity, activationRateLimitPerMinute } = args.limits;
    const activated = [];
    const denied = [];
    const lifecycle = [];
    const protectedIds = new Set;
    for (const t of templates) {
      const entity = typeof t?.entity === "string" ? t.entity.trim() : "";
      if (entity === "") {
        denied.push({ templateId: "0000000000000000", reason: "invalid" });
        continue;
      }
      if (!Array.isArray(t.fields) || t.fields.length === 0 || t.fields.length > 3) {
        denied.push({ templateId: "0000000000000000", reason: "invalid" });
        continue;
      }
      const rawFields = [];
      for (const f of t.fields) {
        const name = typeof f?.name === "string" ? String(f.name).trim() : "";
        const encoding = f?.encoding;
        if (name === "")
          continue;
        if (encoding !== "string" && encoding !== "int64" && encoding !== "bool" && encoding !== "datetime" && encoding !== "bytes")
          continue;
        rawFields.push({ name, encoding });
      }
      if (rawFields.length !== t.fields.length) {
        denied.push({ templateId: "0000000000000000", reason: "invalid" });
        continue;
      }
      {
        const seen = new Set;
        let ok = true;
        for (const f of rawFields) {
          if (seen.has(f.name))
            ok = false;
          seen.add(f.name);
        }
        if (!ok) {
          denied.push({ templateId: "0000000000000000", reason: "invalid" });
          continue;
        }
      }
      const fields = canonicalizeTemplateFields(rawFields);
      const fieldNames = fields.map((f) => f.name);
      const encodings = fields.map((f) => f.encoding);
      const templateId = templateIdFor(entity, fieldNames);
      const existing = this.db.db.query(`SELECT stream, template_id, entity, fields_json, encodings_json, state, created_at_ms, last_seen_at_ms,
                  inactivity_ttl_ms, active_from_source_offset, retired_at_ms, retired_reason
           FROM live_templates
           WHERE stream=? AND template_id=? LIMIT 1;`).get(stream, templateId);
      const alreadyActive = existing && String(existing.state) === "active";
      const needsToken = !alreadyActive;
      if (needsToken && !this.allowActivation(stream, nowMs, activationRateLimitPerMinute)) {
        denied.push({ templateId, reason: "rate_limited" });
        continue;
      }
      if (existing) {
        const row = parseTemplateRow(existing);
        if (row.entity !== entity) {
          denied.push({ templateId, reason: "invalid" });
          continue;
        }
        let storedFields;
        let storedEnc;
        try {
          storedFields = JSON.parse(row.fields_json);
          storedEnc = JSON.parse(row.encodings_json);
        } catch {
          denied.push({ templateId, reason: "invalid" });
          continue;
        }
        if (!Array.isArray(storedFields) || !Array.isArray(storedEnc) || storedFields.length !== storedEnc.length) {
          denied.push({ templateId, reason: "invalid" });
          continue;
        }
        const sf = storedFields.map(String);
        const se = storedEnc.map(String);
        if (sf.join("\x00") !== fieldNames.join("\x00")) {
          denied.push({ templateId, reason: "invalid" });
          continue;
        }
        if (se.join("\x00") !== encodings.join("\x00")) {
          denied.push({ templateId, reason: "invalid" });
          continue;
        }
        if (row.state === "active") {
          this.db.db.query(`UPDATE live_templates
               SET last_seen_at_ms=?, inactivity_ttl_ms=?
               WHERE stream=? AND template_id=?;`).run(nowMs, inactivityTtlMs, stream, templateId);
        } else {
          this.db.db.query(`UPDATE live_templates
               SET state='active',
                   last_seen_at_ms=?,
                   inactivity_ttl_ms=?,
                   active_from_source_offset=?,
                   retired_at_ms=NULL,
                   retired_reason=NULL
               WHERE stream=? AND template_id=?;`).run(nowMs, inactivityTtlMs, args.baseStreamNextOffset, stream, templateId);
        }
      } else {
        this.db.db.query(`INSERT INTO live_templates(
               stream, template_id, entity, fields_json, encodings_json,
               state, created_at_ms, last_seen_at_ms, inactivity_ttl_ms, active_from_source_offset,
               retired_at_ms, retired_reason
             ) VALUES(?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, NULL);`).run(stream, templateId, entity, JSON.stringify(fieldNames), JSON.stringify(encodings), nowMs, nowMs, inactivityTtlMs, args.baseStreamNextOffset);
      }
      protectedIds.add(templateId);
      activated.push({ templateId, state: "active", activeFromTouchOffset: args.activeFromTouchOffset });
      lifecycle.push({
        type: "live.template_activated",
        ts: nowIso(nowMs),
        stream,
        templateId,
        entity,
        fields: fieldNames,
        encodings,
        reason: "declared",
        activeFromTouchOffset: args.activeFromTouchOffset,
        inactivityTtlMs
      });
      this.markSeen(stream, templateId, nowMs);
    }
    const evicted = this.evictToCaps(stream, nowMs, { maxActiveTemplatesPerStream, maxActiveTemplatesPerEntity }, protectedIds);
    for (const e of evicted)
      lifecycle.push(e);
    return { activated, denied, lifecycle };
  }
  heartbeat(stream, templateIdsUsed, nowMs) {
    for (const id of templateIdsUsed) {
      const templateId = typeof id === "string" ? id.trim() : "";
      if (!/^[0-9a-f]{16}$/.test(templateId))
        continue;
      this.markSeen(stream, templateId, nowMs);
    }
  }
  flushLastSeen(nowMs, persistIntervalMs) {
    if (this.dirtyLastSeen.size === 0)
      return;
    const stmt = this.db.db.query(`UPDATE live_templates
       SET last_seen_at_ms=?
       WHERE stream=? AND template_id=? AND state='active';`);
    try {
      for (const k of this.dirtyLastSeen) {
        const item = this.lastSeenMem.get(k);
        if (!item) {
          this.dirtyLastSeen.delete(k);
          continue;
        }
        if (nowMs - item.lastPersistMs < persistIntervalMs)
          continue;
        const [stream, templateId] = k.split(`
`);
        stmt.run(item.lastSeenMs, stream, templateId);
        item.lastPersistMs = nowMs;
        this.dirtyLastSeen.delete(k);
      }
    } finally {
      try {
        stmt.finalize?.();
      } catch {}
    }
  }
  gcRetireExpired(stream, nowMs) {
    const expired = [];
    try {
      const rows = this.db.db.query(`SELECT template_id, entity, fields_json, encodings_json, last_seen_at_ms, inactivity_ttl_ms
           FROM live_templates
           WHERE stream=? AND state='active' AND (last_seen_at_ms + inactivity_ttl_ms) < ?
           ORDER BY last_seen_at_ms ASC
           LIMIT 1000;`).all(stream, nowMs);
      expired.push(...rows);
    } catch {
      return { retired: [] };
    }
    if (expired.length === 0)
      return { retired: [] };
    const effectiveExpired = [];
    const refreshLastSeen = this.db.db.query(`UPDATE live_templates
       SET last_seen_at_ms=?
       WHERE stream=? AND template_id=? AND state='active';`);
    try {
      for (const row of expired) {
        const templateId = String(row.template_id);
        const dbLastSeenAtMs = Number(row.last_seen_at_ms);
        const ttlMs = Number(row.inactivity_ttl_ms);
        const mem = this.lastSeenMem.get(this.key(stream, templateId));
        const memLastSeen = mem ? mem.lastSeenMs : 0;
        const lastSeenAtMs = Math.max(dbLastSeenAtMs, memLastSeen);
        if (lastSeenAtMs + ttlMs >= nowMs) {
          if (mem && memLastSeen > dbLastSeenAtMs) {
            refreshLastSeen.run(memLastSeen, stream, templateId);
            mem.lastPersistMs = nowMs;
            this.dirtyLastSeen.delete(this.key(stream, templateId));
          }
          continue;
        }
        effectiveExpired.push(row);
      }
    } finally {
      try {
        refreshLastSeen.finalize?.();
      } catch {}
    }
    if (effectiveExpired.length === 0)
      return { retired: [] };
    const retired = [];
    const update = this.db.db.query(`UPDATE live_templates
       SET state='retired', retired_reason='inactivity', retired_at_ms=?
       WHERE stream=? AND template_id=? AND state='active';`);
    try {
      for (const row of effectiveExpired) {
        const templateId = String(row.template_id);
        const entity = String(row.entity);
        let fields = [];
        let encodings = [];
        try {
          const f = JSON.parse(String(row.fields_json));
          const e = JSON.parse(String(row.encodings_json));
          if (Array.isArray(f))
            fields = f.map(String);
          if (Array.isArray(e))
            encodings = e.map(String);
        } catch {}
        const dbLastSeenAtMs = Number(row.last_seen_at_ms);
        const mem = this.lastSeenMem.get(this.key(stream, templateId));
        const memLastSeen = mem ? mem.lastSeenMs : 0;
        const lastSeenAtMs = Math.max(dbLastSeenAtMs, memLastSeen);
        const inactiveForMs = Math.max(0, nowMs - lastSeenAtMs);
        update.run(nowMs, stream, templateId);
        retired.push({
          type: "live.template_retired",
          ts: nowIso(nowMs),
          stream,
          templateId,
          entity,
          fields,
          encodings,
          lastSeenAt: nowIso(lastSeenAtMs),
          inactiveForMs,
          reason: "inactivity"
        });
        this.lastSeenMem.delete(this.key(stream, templateId));
        this.dirtyLastSeen.delete(this.key(stream, templateId));
      }
    } finally {
      try {
        update.finalize?.();
      } catch {}
    }
    return { retired };
  }
  markSeen(stream, templateId, nowMs) {
    const k = this.key(stream, templateId);
    const item = this.lastSeenMem.get(k) ?? { lastSeenMs: 0, lastPersistMs: 0 };
    if (nowMs > item.lastSeenMs)
      item.lastSeenMs = nowMs;
    this.lastSeenMem.set(k, item);
    this.dirtyLastSeen.add(k);
  }
  evictToCaps(stream, nowMs, caps, protectedIds) {
    const out = [];
    const { maxActiveTemplatesPerStream, maxActiveTemplatesPerEntity } = caps;
    let entities = [];
    try {
      const rows = this.db.db.query(`SELECT entity, COUNT(*) as cnt
           FROM live_templates
           WHERE stream=? AND state='active'
           GROUP BY entity;`).all(stream);
      entities = rows.map((r) => ({ entity: String(r.entity), cnt: Number(r.cnt) }));
    } catch {}
    for (const e of entities) {
      if (e.cnt <= maxActiveTemplatesPerEntity)
        continue;
      const extra = e.cnt - maxActiveTemplatesPerEntity;
      const evicted = this.evictLru(stream, nowMs, extra, { entity: e.entity, cap: maxActiveTemplatesPerEntity }, protectedIds);
      out.push(...evicted);
    }
    let activeCount = 0;
    try {
      const row = this.db.db.query(`SELECT COUNT(*) as cnt FROM live_templates WHERE stream=? AND state='active';`).get(stream);
      activeCount = Number(row?.cnt ?? 0);
    } catch {
      activeCount = 0;
    }
    if (activeCount > maxActiveTemplatesPerStream) {
      const extra = activeCount - maxActiveTemplatesPerStream;
      const evicted = this.evictLru(stream, nowMs, extra, { cap: maxActiveTemplatesPerStream }, protectedIds);
      out.push(...evicted);
    }
    return out;
  }
  evictLru(stream, nowMs, count, scope, protectedIds) {
    if (count <= 0)
      return [];
    const out = [];
    const pick = (excludeProtected) => {
      const params = [stream];
      let where = `stream=? AND state='active'`;
      if (scope.entity) {
        where += ` AND entity=?`;
        params.push(scope.entity);
      }
      if (excludeProtected && protectedIds.size > 0) {
        const placeholders = Array.from(protectedIds).map(() => "?").join(", ");
        where += ` AND template_id NOT IN (${placeholders})`;
        params.push(...Array.from(protectedIds));
      }
      const q = `SELECT template_id FROM live_templates WHERE ${where} ORDER BY last_seen_at_ms ASC, template_id ASC LIMIT ?;`;
      params.push(count);
      try {
        const rows = this.db.db.query(q).all(...params);
        return rows.map((r) => String(r.template_id));
      } catch {
        return [];
      }
    };
    let ids = pick(true);
    if (ids.length < count) {
      const extra = pick(false);
      const merged = [];
      const seen = new Set;
      for (const id of [...ids, ...extra]) {
        if (seen.has(id))
          continue;
        seen.add(id);
        merged.push(id);
        if (merged.length >= count)
          break;
      }
      ids = merged;
    }
    if (ids.length === 0)
      return [];
    const update = this.db.db.query(`UPDATE live_templates
       SET state='retired', retired_reason='cap_exceeded', retired_at_ms=?
       WHERE stream=? AND template_id=? AND state='active';`);
    try {
      for (const id of ids) {
        update.run(nowMs, stream, id);
        out.push({
          type: "live.template_evicted",
          ts: nowIso(nowMs),
          stream,
          templateId: id,
          reason: "cap_exceeded",
          cap: scope.cap
        });
        this.lastSeenMem.delete(this.key(stream, id));
        this.dirtyLastSeen.delete(this.key(stream, id));
      }
    } finally {
      try {
        update.finalize?.();
      } catch {}
    }
    return out;
  }
}

// src/touch/live_metrics.ts
import { Result as Result14 } from "better-result";
function makeLatencyHistogram() {
  const bounds = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 1e4, 30000, 120000];
  const counts = new Array(bounds.length + 1).fill(0);
  const record = (ms) => {
    const x = Math.max(0, Math.floor(ms));
    let i = 0;
    while (i < bounds.length && x > bounds[i])
      i++;
    counts[i] += 1;
  };
  const quantile = (q) => {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0)
      return 0;
    const target = Math.ceil(total * q);
    let acc = 0;
    for (let i = 0;i < counts.length; i++) {
      acc += counts[i];
      if (acc >= target) {
        return i < bounds.length ? bounds[i] : bounds[bounds.length - 1];
      }
    }
    return bounds[bounds.length - 1];
  };
  const reset = () => {
    for (let i = 0;i < counts.length; i++)
      counts[i] = 0;
  };
  return { bounds, counts, record, p50: () => quantile(0.5), p95: () => quantile(0.95), p99: () => quantile(0.99), reset };
}
function nowIso2(ms) {
  return new Date(ms).toISOString();
}
function envString(name) {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : null;
}
function getInstanceId() {
  return envString("DS_INSTANCE_ID") ?? envString("HOSTNAME") ?? "local";
}
function getRegion() {
  return envString("DS_REGION") ?? "local";
}
function defaultCounters(touchCfg) {
  return {
    touch: {
      coarseIntervalMs: touchCfg.coarseIntervalMs ?? 100,
      coalesceWindowMs: touchCfg.touchCoalesceWindowMs ?? 100,
      mode: "idle",
      hotFineKeys: 0,
      hotTemplates: 0,
      hotFineKeysActive: 0,
      hotFineKeysGrace: 0,
      hotTemplatesActive: 0,
      hotTemplatesGrace: 0,
      fineWaitersActive: 0,
      coarseWaitersActive: 0,
      broadFineWaitersActive: 0,
      touchesEmitted: 0,
      uniqueKeysTouched: 0,
      tableTouchesEmitted: 0,
      templateTouchesEmitted: 0,
      staleResponses: 0,
      fineTouchesDroppedDueToBudget: 0,
      fineTouchesSkippedColdTemplate: 0,
      fineTouchesSkippedColdKey: 0,
      fineTouchesSkippedTemplateBucket: 0,
      fineTouchesSuppressedBatchesDueToLag: 0,
      fineTouchesSuppressedMsDueToLag: 0,
      fineTouchesSuppressedBatchesDueToBudget: 0
    },
    gc: {
      baseWalGcCalls: 0,
      baseWalGcDeletedRows: 0,
      baseWalGcDeletedBytes: 0,
      baseWalGcMsSum: 0,
      baseWalGcMsMax: 0
    },
    templates: { activated: 0, retired: 0, evicted: 0, activationDenied: 0 },
    wait: { calls: 0, keysWatchedTotal: 0, touched: 0, timeout: 0, stale: 0, latencySumMs: 0, latencyHist: makeLatencyHistogram() },
    interpreter: {
      eventsIn: 0,
      changesOut: 0,
      errors: 0,
      lagSourceOffsets: 0,
      scannedBatches: 0,
      scannedButEmitted0Batches: 0,
      noInterestFastForwardBatches: 0,
      interpretedThroughDelta: 0,
      touchesEmittedDelta: 0,
      commitLagSamples: 0,
      commitLagMsSum: 0,
      commitLagHist: makeLatencyHistogram()
    }
  };
}

class LiveMetricsV2 {
  db;
  ingest;
  metricsStream;
  enabled;
  intervalMs;
  snapshotIntervalMs;
  snapshotChunkSize;
  retentionMs;
  getTouchJournal;
  timer = null;
  snapshotTimer = null;
  retentionTimer = null;
  lagTimer = null;
  instanceId = getInstanceId();
  region = getRegion();
  counters = new Map;
  lagExpectedMs = 0;
  lagMaxMs = 0;
  lagSumMs = 0;
  lagSamples = 0;
  constructor(db, ingest, opts) {
    this.db = db;
    this.ingest = ingest;
    this.enabled = opts?.enabled !== false;
    this.metricsStream = opts?.stream ?? "live.metrics";
    this.intervalMs = opts?.intervalMs ?? 1000;
    this.snapshotIntervalMs = opts?.snapshotIntervalMs ?? 60000;
    this.snapshotChunkSize = opts?.snapshotChunkSize ?? 200;
    this.retentionMs = opts?.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
    this.getTouchJournal = opts?.getTouchJournal;
  }
  start() {
    if (!this.enabled)
      return;
    if (this.timer)
      return;
    this.timer = setInterval(() => {
      this.flushTick();
    }, this.intervalMs);
    this.snapshotTimer = setInterval(() => {
      this.emitSnapshots();
    }, this.snapshotIntervalMs);
    this.retentionTimer = setInterval(() => {
      try {
        this.db.trimWalByAge(this.metricsStream, this.retentionMs);
      } catch {}
    }, 60000);
    const lagIntervalMs = 100;
    this.lagExpectedMs = Date.now() + lagIntervalMs;
    this.lagMaxMs = 0;
    this.lagSumMs = 0;
    this.lagSamples = 0;
    this.lagTimer = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - this.lagExpectedMs);
      this.lagMaxMs = Math.max(this.lagMaxMs, lag);
      this.lagSumMs += lag;
      this.lagSamples += 1;
      this.lagExpectedMs += lagIntervalMs;
      if (this.lagExpectedMs < now - 5 * lagIntervalMs)
        this.lagExpectedMs = now + lagIntervalMs;
    }, lagIntervalMs);
  }
  stop() {
    if (this.timer)
      clearInterval(this.timer);
    if (this.snapshotTimer)
      clearInterval(this.snapshotTimer);
    if (this.retentionTimer)
      clearInterval(this.retentionTimer);
    if (this.lagTimer)
      clearInterval(this.lagTimer);
    this.timer = null;
    this.snapshotTimer = null;
    this.retentionTimer = null;
    this.lagTimer = null;
  }
  ensureStreamResult() {
    if (!this.enabled)
      return Result14.ok(undefined);
    const existing = this.db.getStream(this.metricsStream);
    if (existing) {
      if (String(existing.content_type) !== "application/json") {
        return Result14.err({
          kind: "live_metrics_stream_content_type_mismatch",
          message: `live metrics stream content-type mismatch: ${existing.content_type}`
        });
      }
      if ((existing.stream_flags & STREAM_FLAG_TOUCH) === 0)
        this.db.addStreamFlags(this.metricsStream, STREAM_FLAG_TOUCH);
      return Result14.ok(undefined);
    }
    this.db.ensureStream(this.metricsStream, { contentType: "application/json", streamFlags: STREAM_FLAG_TOUCH });
    return Result14.ok(undefined);
  }
  get(stream, touchCfg) {
    const existing = this.counters.get(stream);
    if (existing)
      return existing;
    const c = defaultCounters(touchCfg);
    this.counters.set(stream, c);
    return c;
  }
  ensure(stream) {
    const existing = this.counters.get(stream);
    if (existing)
      return existing;
    const c = defaultCounters({ enabled: true });
    this.counters.set(stream, c);
    return c;
  }
  recordInterpreterError(stream, touchCfg) {
    const c = this.get(stream, touchCfg);
    c.interpreter.errors += 1;
  }
  recordInterpreterBatch(args) {
    const c = this.get(args.stream, args.touchCfg);
    c.touch.coarseIntervalMs = args.touchCfg.coarseIntervalMs ?? c.touch.coarseIntervalMs;
    c.touch.coalesceWindowMs = args.touchCfg.touchCoalesceWindowMs ?? c.touch.coalesceWindowMs;
    c.touch.mode = args.touchMode;
    c.touch.hotFineKeys = Math.max(c.touch.hotFineKeys, Math.max(0, Math.floor(args.hotFineKeys ?? 0)));
    c.touch.hotTemplates = Math.max(c.touch.hotTemplates, Math.max(0, Math.floor(args.hotTemplates ?? 0)));
    c.touch.hotFineKeysActive = Math.max(c.touch.hotFineKeysActive, Math.max(0, Math.floor(args.hotFineKeysActive ?? 0)));
    c.touch.hotFineKeysGrace = Math.max(c.touch.hotFineKeysGrace, Math.max(0, Math.floor(args.hotFineKeysGrace ?? 0)));
    c.touch.hotTemplatesActive = Math.max(c.touch.hotTemplatesActive, Math.max(0, Math.floor(args.hotTemplatesActive ?? 0)));
    c.touch.hotTemplatesGrace = Math.max(c.touch.hotTemplatesGrace, Math.max(0, Math.floor(args.hotTemplatesGrace ?? 0)));
    c.touch.fineWaitersActive = Math.max(c.touch.fineWaitersActive, Math.max(0, Math.floor(args.fineWaitersActive ?? 0)));
    c.touch.coarseWaitersActive = Math.max(c.touch.coarseWaitersActive, Math.max(0, Math.floor(args.coarseWaitersActive ?? 0)));
    c.touch.broadFineWaitersActive = Math.max(c.touch.broadFineWaitersActive, Math.max(0, Math.floor(args.broadFineWaitersActive ?? 0)));
    c.interpreter.eventsIn += Math.max(0, args.rowsRead);
    c.interpreter.changesOut += Math.max(0, args.changes);
    c.interpreter.lagSourceOffsets = Math.max(c.interpreter.lagSourceOffsets, Math.max(0, args.lagSourceOffsets));
    c.interpreter.scannedBatches += 1;
    if (args.scannedButEmitted0)
      c.interpreter.scannedButEmitted0Batches += 1;
    if (args.noInterestFastForward)
      c.interpreter.noInterestFastForwardBatches += 1;
    c.interpreter.interpretedThroughDelta += Math.max(0, Math.floor(args.interpretedThroughDelta ?? 0));
    c.interpreter.touchesEmittedDelta += Math.max(0, Math.floor(args.touchesEmittedDelta ?? 0));
    if (args.commitLagMs != null && Number.isFinite(args.commitLagMs) && args.commitLagMs >= 0) {
      c.interpreter.commitLagSamples += 1;
      c.interpreter.commitLagMsSum += args.commitLagMs;
      c.interpreter.commitLagHist.record(args.commitLagMs);
    }
    c.touch.fineTouchesDroppedDueToBudget += Math.max(0, args.fineTouchesDroppedDueToBudget ?? 0);
    c.touch.fineTouchesSkippedColdTemplate += Math.max(0, args.fineTouchesSkippedColdTemplate ?? 0);
    c.touch.fineTouchesSkippedColdKey += Math.max(0, args.fineTouchesSkippedColdKey ?? 0);
    c.touch.fineTouchesSkippedTemplateBucket += Math.max(0, args.fineTouchesSkippedTemplateBucket ?? 0);
    if (args.fineTouchesSuppressedDueToLag)
      c.touch.fineTouchesSuppressedBatchesDueToLag += 1;
    c.touch.fineTouchesSuppressedMsDueToLag += Math.max(0, args.fineTouchesSuppressedDueToLagMs ?? 0);
    if (args.fineTouchesSuppressedDueToBudget)
      c.touch.fineTouchesSuppressedBatchesDueToBudget += 1;
    const unique = new Set;
    let table = 0;
    let tpl = 0;
    for (const t of args.touches) {
      unique.add(t.keyId >>> 0);
      if (t.kind === "table")
        table++;
      else
        tpl++;
    }
    c.touch.touchesEmitted += args.touches.length;
    c.touch.uniqueKeysTouched += unique.size;
    c.touch.tableTouchesEmitted += table;
    c.touch.templateTouchesEmitted += tpl;
  }
  recordWait(stream, touchCfg, keysCount, outcome, latencyMs) {
    const c = this.get(stream, touchCfg);
    c.wait.calls += 1;
    c.wait.keysWatchedTotal += Math.max(0, keysCount);
    c.wait.latencySumMs += Math.max(0, latencyMs);
    c.wait.latencyHist.record(latencyMs);
    if (outcome === "touched")
      c.wait.touched += 1;
    else if (outcome === "timeout")
      c.wait.timeout += 1;
    else
      c.wait.stale += 1;
    if (outcome === "stale")
      c.touch.staleResponses += 1;
  }
  recordBaseWalGc(stream, args) {
    const c = this.ensure(stream);
    c.gc.baseWalGcCalls += 1;
    c.gc.baseWalGcDeletedRows += Math.max(0, args.deletedRows);
    c.gc.baseWalGcDeletedBytes += Math.max(0, args.deletedBytes);
    c.gc.baseWalGcMsSum += Math.max(0, args.durationMs);
    c.gc.baseWalGcMsMax = Math.max(c.gc.baseWalGcMsMax, Math.max(0, args.durationMs));
  }
  async emitLifecycle(events) {
    if (!this.enabled)
      return;
    if (events.length === 0)
      return;
    const rows = events.map((e) => ({
      routingKey: new TextEncoder().encode(`${e.stream}|${e.type}`),
      contentType: "application/json",
      payload: new TextEncoder().encode(JSON.stringify({
        ...e,
        liveSystemVersion: "v2",
        instanceId: this.instanceId,
        region: this.region
      }))
    }));
    for (const e of events) {
      const c = this.ensure(e.stream);
      if (e.type === "live.template_activated")
        c.templates.activated += 1;
      else if (e.type === "live.template_retired")
        c.templates.retired += 1;
      else if (e.type === "live.template_evicted")
        c.templates.evicted += 1;
    }
    try {
      await this.ingest.appendInternal({
        stream: this.metricsStream,
        baseAppendMs: BigInt(Date.now()),
        rows,
        contentType: "application/json"
      });
    } catch {}
  }
  recordActivationDenied(stream, touchCfg, n = 1) {
    const c = this.get(stream, touchCfg);
    c.templates.activationDenied += Math.max(0, n);
  }
  async flushTick() {
    if (!this.enabled)
      return;
    const nowMs = Date.now();
    const clampBigInt = (v) => {
      if (v <= 0n)
        return 0;
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      return v > max ? Number.MAX_SAFE_INTEGER : Number(v);
    };
    const states = this.db.listStreamInterpreters();
    if (states.length === 0)
      return;
    const rows = [];
    const encoder = new TextEncoder;
    const loopLagMax = this.lagMaxMs;
    const loopLagAvg = this.lagSamples > 0 ? this.lagSumMs / this.lagSamples : 0;
    this.lagMaxMs = 0;
    this.lagSumMs = 0;
    this.lagSamples = 0;
    for (const st of states) {
      const stream = st.stream;
      const regRow = this.db.getStream(stream);
      if (!regRow)
        continue;
      const touchCfg = (() => {
        try {
          const row = this.db.getSchemaRegistry(stream);
          if (!row)
            return null;
          const raw = JSON.parse(row.registry_json);
          const cfg = raw?.interpreter?.touch;
          if (!cfg || !cfg.enabled)
            return null;
          return cfg;
        } catch {
          return null;
        }
      })();
      if (!touchCfg)
        continue;
      const c = this.get(stream, touchCfg);
      const journal = this.getTouchJournal?.(stream) ?? null;
      const waitActive = journal?.meta.activeWaiters ?? 0;
      const tailSeq = regRow.next_offset > 0n ? regRow.next_offset - 1n : -1n;
      const interpretedThrough = st.interpreted_through;
      const gcThrough = interpretedThrough < regRow.uploaded_through ? interpretedThrough : regRow.uploaded_through;
      const backlog = tailSeq >= interpretedThrough ? tailSeq - interpretedThrough : 0n;
      const backlogNum = backlog > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(backlog);
      let walOldestOffset = null;
      try {
        const oldest = this.db.getWalOldestOffset(stream);
        walOldestOffset = oldest == null ? null : encodeOffset(regRow.epoch, oldest);
      } catch {
        walOldestOffset = null;
      }
      const activeTemplates = (() => {
        try {
          const row = this.db.db.query(`SELECT COUNT(*) as cnt FROM live_templates WHERE stream=? AND state='active';`).get(stream);
          return Number(row?.cnt ?? 0);
        } catch {
          return 0;
        }
      })();
      const tick = {
        type: "live.tick",
        ts: nowIso2(nowMs),
        stream,
        liveSystemVersion: "v2",
        instanceId: this.instanceId,
        region: this.region,
        touch: {
          coarseIntervalMs: c.touch.coarseIntervalMs,
          coalesceWindowMs: c.touch.coalesceWindowMs,
          mode: c.touch.mode,
          hotFineKeys: c.touch.hotFineKeys,
          hotTemplates: c.touch.hotTemplates,
          hotFineKeysActive: c.touch.hotFineKeysActive,
          hotFineKeysGrace: c.touch.hotFineKeysGrace,
          hotTemplatesActive: c.touch.hotTemplatesActive,
          hotTemplatesGrace: c.touch.hotTemplatesGrace,
          fineWaitersActive: c.touch.fineWaitersActive,
          coarseWaitersActive: c.touch.coarseWaitersActive,
          broadFineWaitersActive: c.touch.broadFineWaitersActive,
          touchesEmitted: c.touch.touchesEmitted,
          uniqueKeysTouched: c.touch.uniqueKeysTouched,
          tableTouchesEmitted: c.touch.tableTouchesEmitted,
          templateTouchesEmitted: c.touch.templateTouchesEmitted,
          staleResponses: c.touch.staleResponses,
          fineTouchesDroppedDueToBudget: c.touch.fineTouchesDroppedDueToBudget,
          fineTouchesSkippedColdTemplate: c.touch.fineTouchesSkippedColdTemplate,
          fineTouchesSkippedColdKey: c.touch.fineTouchesSkippedColdKey,
          fineTouchesSkippedTemplateBucket: c.touch.fineTouchesSkippedTemplateBucket,
          fineTouchesSuppressedBatchesDueToLag: c.touch.fineTouchesSuppressedBatchesDueToLag,
          fineTouchesSuppressedSecondsDueToLag: c.touch.fineTouchesSuppressedMsDueToLag / 1000,
          fineTouchesSuppressedBatchesDueToBudget: c.touch.fineTouchesSuppressedBatchesDueToBudget,
          cursor: journal?.meta.cursor ?? null,
          epoch: journal?.meta.epoch ?? null,
          generation: journal?.meta.generation ?? null,
          pendingKeys: journal?.meta.pendingKeys ?? 0,
          overflowBuckets: journal?.meta.overflowBuckets ?? 0
        },
        templates: {
          active: activeTemplates,
          activated: c.templates.activated,
          retired: c.templates.retired,
          evicted: c.templates.evicted,
          activationDenied: c.templates.activationDenied
        },
        wait: {
          calls: c.wait.calls,
          keysWatchedTotal: c.wait.keysWatchedTotal,
          avgKeysPerCall: c.wait.calls > 0 ? c.wait.keysWatchedTotal / c.wait.calls : 0,
          touched: c.wait.touched,
          timeout: c.wait.timeout,
          stale: c.wait.stale,
          avgLatencyMs: c.wait.calls > 0 ? c.wait.latencySumMs / c.wait.calls : 0,
          p95LatencyMs: c.wait.latencyHist.p95(),
          activeWaiters: waitActive,
          timeoutsFired: journal?.interval.timeoutsFired ?? 0,
          timeoutSweeps: journal?.interval.timeoutSweeps ?? 0,
          timeoutSweepMsSum: journal?.interval.timeoutSweepMsSum ?? 0,
          timeoutSweepMsMax: journal?.interval.timeoutSweepMsMax ?? 0,
          notifyWakeups: journal?.interval.notifyWakeups ?? 0,
          notifyFlushes: journal?.interval.notifyFlushes ?? 0,
          notifyWakeMsSum: journal?.interval.notifyWakeMsSum ?? 0,
          notifyWakeMsMax: journal?.interval.notifyWakeMsMax ?? 0,
          timeoutHeapSize: journal?.interval.heapSize ?? 0
        },
        interpreter: {
          eventsIn: c.interpreter.eventsIn,
          changesOut: c.interpreter.changesOut,
          errors: c.interpreter.errors,
          lagSourceOffsets: c.interpreter.lagSourceOffsets,
          scannedBatches: c.interpreter.scannedBatches,
          scannedButEmitted0Batches: c.interpreter.scannedButEmitted0Batches,
          noInterestFastForwardBatches: c.interpreter.noInterestFastForwardBatches,
          interpretedThroughDelta: c.interpreter.interpretedThroughDelta,
          touchesEmittedDelta: c.interpreter.touchesEmittedDelta,
          commitLagMsAvg: c.interpreter.commitLagSamples > 0 ? c.interpreter.commitLagMsSum / c.interpreter.commitLagSamples : 0,
          commitLagMsP50: c.interpreter.commitLagHist.p50(),
          commitLagMsP95: c.interpreter.commitLagHist.p95(),
          commitLagMsP99: c.interpreter.commitLagHist.p99()
        },
        base: {
          tailOffset: encodeOffset(regRow.epoch, tailSeq),
          nextOffset: encodeOffset(regRow.epoch, regRow.next_offset),
          sealedThrough: encodeOffset(regRow.epoch, regRow.sealed_through),
          uploadedThrough: encodeOffset(regRow.epoch, regRow.uploaded_through),
          interpretedThrough: encodeOffset(regRow.epoch, interpretedThrough),
          gcThrough: encodeOffset(regRow.epoch, gcThrough),
          walOldestOffset,
          walRetainedRows: clampBigInt(regRow.wal_rows),
          walRetainedBytes: clampBigInt(regRow.wal_bytes),
          gc: {
            calls: c.gc.baseWalGcCalls,
            deletedRows: c.gc.baseWalGcDeletedRows,
            deletedBytes: c.gc.baseWalGcDeletedBytes,
            msSum: c.gc.baseWalGcMsSum,
            msMax: c.gc.baseWalGcMsMax
          },
          backlogSourceOffsets: backlogNum
        },
        process: {
          eventLoopLagMsMax: loopLagMax,
          eventLoopLagMsAvg: loopLagAvg
        }
      };
      rows.push({
        routingKey: encoder.encode(`${stream}|live.tick`),
        contentType: "application/json",
        payload: encoder.encode(JSON.stringify(tick))
      });
      c.touch.hotFineKeys = 0;
      c.touch.hotTemplates = 0;
      c.touch.hotFineKeysActive = 0;
      c.touch.hotFineKeysGrace = 0;
      c.touch.hotTemplatesActive = 0;
      c.touch.hotTemplatesGrace = 0;
      c.touch.fineWaitersActive = 0;
      c.touch.coarseWaitersActive = 0;
      c.touch.broadFineWaitersActive = 0;
      c.touch.touchesEmitted = 0;
      c.touch.uniqueKeysTouched = 0;
      c.touch.tableTouchesEmitted = 0;
      c.touch.templateTouchesEmitted = 0;
      c.touch.staleResponses = 0;
      c.touch.fineTouchesDroppedDueToBudget = 0;
      c.touch.fineTouchesSkippedColdTemplate = 0;
      c.touch.fineTouchesSkippedColdKey = 0;
      c.touch.fineTouchesSkippedTemplateBucket = 0;
      c.touch.fineTouchesSuppressedBatchesDueToLag = 0;
      c.touch.fineTouchesSuppressedMsDueToLag = 0;
      c.touch.fineTouchesSuppressedBatchesDueToBudget = 0;
      c.touch.mode = "idle";
      c.templates.activated = 0;
      c.templates.retired = 0;
      c.templates.evicted = 0;
      c.templates.activationDenied = 0;
      c.wait.calls = 0;
      c.wait.keysWatchedTotal = 0;
      c.wait.touched = 0;
      c.wait.timeout = 0;
      c.wait.stale = 0;
      c.wait.latencySumMs = 0;
      c.wait.latencyHist.reset();
      c.interpreter.eventsIn = 0;
      c.interpreter.changesOut = 0;
      c.interpreter.errors = 0;
      c.interpreter.lagSourceOffsets = 0;
      c.interpreter.scannedBatches = 0;
      c.interpreter.scannedButEmitted0Batches = 0;
      c.interpreter.noInterestFastForwardBatches = 0;
      c.interpreter.interpretedThroughDelta = 0;
      c.interpreter.touchesEmittedDelta = 0;
      c.interpreter.commitLagSamples = 0;
      c.interpreter.commitLagMsSum = 0;
      c.interpreter.commitLagHist.reset();
      c.gc.baseWalGcCalls = 0;
      c.gc.baseWalGcDeletedRows = 0;
      c.gc.baseWalGcDeletedBytes = 0;
      c.gc.baseWalGcMsSum = 0;
      c.gc.baseWalGcMsMax = 0;
    }
    if (rows.length === 0)
      return;
    try {
      await this.ingest.appendInternal({
        stream: this.metricsStream,
        baseAppendMs: BigInt(nowMs),
        rows,
        contentType: "application/json"
      });
    } catch {}
  }
  async emitSnapshots() {
    if (!this.enabled)
      return;
    const nowMs = Date.now();
    const streams = this.db.listStreamInterpreters().map((r) => r.stream);
    if (streams.length === 0)
      return;
    const encoder = new TextEncoder;
    const rows = [];
    for (const stream of streams) {
      let templates = [];
      try {
        templates = this.db.db.query(`SELECT template_id, entity, fields_json, last_seen_at_ms, state
             FROM live_templates
             WHERE stream=? AND state='active'
             ORDER BY entity ASC, template_id ASC;`).all(stream);
      } catch {
        continue;
      }
      const snapshotId = `s-${stream}-${nowMs}`;
      const activeTemplates = templates.length;
      rows.push({
        routingKey: encoder.encode(`${stream}|live.templates_snapshot_start`),
        contentType: "application/json",
        payload: encoder.encode(JSON.stringify({
          type: "live.templates_snapshot_start",
          ts: nowIso2(nowMs),
          stream,
          liveSystemVersion: "v2",
          instanceId: this.instanceId,
          region: this.region,
          snapshotId,
          activeTemplates,
          chunkSize: this.snapshotChunkSize
        }))
      });
      let chunkIndex = 0;
      for (let i = 0;i < templates.length; i += this.snapshotChunkSize) {
        const slice = templates.slice(i, i + this.snapshotChunkSize);
        const payloadTemplates = slice.map((t) => {
          const templateId = String(t.template_id);
          const entity = String(t.entity);
          let fields = [];
          try {
            const f = JSON.parse(String(t.fields_json));
            if (Array.isArray(f))
              fields = f.map(String);
          } catch {}
          const lastSeenAgoMs = Math.max(0, nowMs - Number(t.last_seen_at_ms));
          return { templateId, entity, fields, lastSeenAgoMs, state: "active" };
        });
        rows.push({
          routingKey: encoder.encode(`${stream}|live.templates_snapshot_chunk`),
          contentType: "application/json",
          payload: encoder.encode(JSON.stringify({
            type: "live.templates_snapshot_chunk",
            ts: nowIso2(nowMs),
            stream,
            liveSystemVersion: "v2",
            instanceId: this.instanceId,
            region: this.region,
            snapshotId,
            chunkIndex,
            templates: payloadTemplates
          }))
        });
        chunkIndex++;
      }
      rows.push({
        routingKey: encoder.encode(`${stream}|live.templates_snapshot_end`),
        contentType: "application/json",
        payload: encoder.encode(JSON.stringify({
          type: "live.templates_snapshot_end",
          ts: nowIso2(nowMs),
          stream,
          liveSystemVersion: "v2",
          instanceId: this.instanceId,
          region: this.region,
          snapshotId
        }))
      });
    }
    if (rows.length === 0)
      return;
    try {
      await this.ingest.appendInternal({
        stream: this.metricsStream,
        baseAppendMs: BigInt(nowMs),
        rows,
        contentType: "application/json"
      });
    } catch {}
  }
}

// src/touch/touch_journal.ts
function u32(x) {
  return x >>> 0;
}
function mix32(x) {
  let y = u32(x);
  y ^= y >>> 16;
  y = Math.imul(y, 2246822507) >>> 0;
  y ^= y >>> 13;
  y = Math.imul(y, 3266489909) >>> 0;
  y ^= y >>> 16;
  return y >>> 0;
}
function newEpochHex16() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return buf[0].toString(16).padStart(8, "0") + buf[1].toString(16).padStart(8, "0");
}
function parseTouchCursor(raw) {
  const s = raw.trim();
  if (s === "")
    return null;
  const idx = s.indexOf(":");
  if (idx <= 0)
    return null;
  const epoch = s.slice(0, idx);
  const genRaw = s.slice(idx + 1);
  if (!/^[0-9a-f]{16}$/i.test(epoch))
    return null;
  if (!/^[0-9]+$/.test(genRaw))
    return null;
  const gen = Number(genRaw);
  if (!Number.isFinite(gen) || gen < 0)
    return null;
  return { epoch: epoch.toLowerCase(), generation: Math.floor(gen) };
}
function formatTouchCursor(epoch, generation) {
  return `${epoch}:${Math.max(0, Math.floor(generation))}`;
}

class TouchJournal {
  epoch;
  generation;
  bucketMs;
  coalesceMs;
  k;
  mask;
  lastSet;
  pending = new Set;
  pendingBucketStartMs = 0;
  pendingMaxSourceOffsetSeq = -1n;
  lastFlushedSourceOffsetSeq = -1n;
  overflow = false;
  overflowBuckets = 0;
  lastOverflowGeneration = 0;
  lastFlushAtMs = 0;
  lastBucketStartMs = 0;
  flushIntervalsLast10s = [];
  flushTimer = null;
  byKey = new Map;
  broad = new Set;
  activeWaiters = 0;
  deadlineHeap = [];
  timeoutTimer = null;
  scheduledDeadlineMs = null;
  interval = {
    timeoutsFired: 0,
    timeoutSweeps: 0,
    timeoutSweepMsSum: 0,
    timeoutSweepMsMax: 0,
    notifyWakeups: 0,
    notifyFlushes: 0,
    notifyWakeMsSum: 0,
    notifyWakeMsMax: 0,
    heapSize: 0
  };
  totals = {
    timeoutsFired: 0,
    timeoutSweeps: 0,
    timeoutSweepMsSum: 0,
    timeoutSweepMsMax: 0,
    notifyWakeups: 0,
    notifyFlushes: 0,
    notifyWakeMsSum: 0,
    notifyWakeMsMax: 0,
    flushes: 0
  };
  pendingMaxKeys;
  keyIndexMaxKeys;
  constructor(opts) {
    this.epoch = newEpochHex16();
    this.generation = 0;
    this.bucketMs = Math.max(1, Math.floor(opts.bucketMs));
    this.coalesceMs = this.bucketMs;
    const pow2 = Math.max(10, Math.min(30, Math.floor(opts.filterPow2)));
    const size = 1 << pow2;
    this.k = Math.max(1, Math.min(8, Math.floor(opts.k)));
    this.mask = size - 1;
    this.lastSet = new Uint32Array(size);
    this.pendingMaxKeys = Math.max(1, Math.floor(opts.pendingMaxKeys));
    this.keyIndexMaxKeys = Math.max(1, Math.floor(opts.keyIndexMaxKeys));
  }
  stop() {
    if (this.flushTimer)
      clearTimeout(this.flushTimer);
    if (this.timeoutTimer)
      clearTimeout(this.timeoutTimer);
    this.flushTimer = null;
    this.timeoutTimer = null;
    this.scheduledDeadlineMs = null;
    this.pending.clear();
    this.pendingBucketStartMs = 0;
    this.pendingMaxSourceOffsetSeq = -1n;
    this.lastFlushedSourceOffsetSeq = -1n;
    this.lastFlushAtMs = 0;
    this.lastBucketStartMs = 0;
    this.flushIntervalsLast10s.length = 0;
    this.byKey.clear();
    this.broad.clear();
    this.deadlineHeap.length = 0;
    this.activeWaiters = 0;
  }
  getEpoch() {
    return this.epoch;
  }
  getGeneration() {
    return this.generation >>> 0;
  }
  getCursor() {
    return formatTouchCursor(this.epoch, this.getGeneration());
  }
  getLastFlushedSourceOffsetSeq() {
    return this.lastFlushedSourceOffsetSeq;
  }
  getActiveWaiters() {
    return this.activeWaiters;
  }
  snapshotAndResetIntervalStats() {
    const out = { ...this.interval, heapSize: this.deadlineHeap.length };
    this.interval = {
      timeoutsFired: 0,
      timeoutSweeps: 0,
      timeoutSweepMsSum: 0,
      timeoutSweepMsMax: 0,
      notifyWakeups: 0,
      notifyFlushes: 0,
      notifyWakeMsSum: 0,
      notifyWakeMsMax: 0,
      heapSize: 0
    };
    return out;
  }
  getTotalStats() {
    return { ...this.totals };
  }
  getMeta() {
    const nowMs = Date.now();
    this.pruneFlushIntervals(nowMs);
    const intervals = this.flushIntervalsLast10s.map((x) => x.intervalMs);
    return {
      mode: "memory",
      cursor: this.getCursor(),
      epoch: this.epoch,
      generation: this.getGeneration(),
      bucketMs: this.bucketMs,
      coalesceMs: this.coalesceMs,
      filterSize: this.lastSet.length,
      k: this.k,
      pendingKeys: this.pending.size,
      overflowBuckets: this.overflowBuckets,
      activeWaiters: this.activeWaiters,
      bucketMaxSourceOffsetSeq: this.lastFlushedSourceOffsetSeq.toString(),
      lastFlushAtMs: this.lastFlushAtMs,
      flushIntervalMsMaxLast10s: intervals.length > 0 ? Math.max(...intervals) : 0,
      flushIntervalMsP95Last10s: percentile(intervals, 0.95)
    };
  }
  touch(keyId, sourceOffsetSeq) {
    if (this.pending.size === 0 && !this.overflow && this.pendingBucketStartMs <= 0) {
      this.pendingBucketStartMs = Date.now();
    }
    if (this.pending.size >= this.pendingMaxKeys) {
      this.overflow = true;
    } else {
      this.pending.add(u32(keyId));
    }
    if (typeof sourceOffsetSeq === "bigint" && sourceOffsetSeq > this.pendingMaxSourceOffsetSeq) {
      this.pendingMaxSourceOffsetSeq = sourceOffsetSeq;
    }
    this.ensureFlushScheduled();
  }
  setCoalesceMs(ms) {
    const next = Math.max(1, Math.min(this.bucketMs, Math.floor(ms)));
    this.coalesceMs = next;
  }
  maybeTouchedSince(keyId, sinceGeneration) {
    const since = u32(sinceGeneration);
    if (since < u32(this.lastOverflowGeneration))
      return true;
    const h1 = u32(keyId);
    let h2 = mix32(h1);
    if (h2 === 0)
      h2 = 2654435769;
    let min = 4294967295;
    for (let i = 0;i < this.k; i++) {
      const pos = u32(h1 + Math.imul(i, h2)) & this.mask;
      const g = this.lastSet[pos];
      if (g < min)
        min = g;
    }
    return u32(min) > since;
  }
  maybeTouchedSinceAny(keyIds, sinceGeneration) {
    const since = u32(sinceGeneration);
    if (since < u32(this.lastOverflowGeneration))
      return true;
    for (let i = 0;i < keyIds.length; i++) {
      if (this.maybeTouchedSince(keyIds[i], since))
        return true;
    }
    return false;
  }
  waitForAny(args) {
    if (args.keys.length === 0)
      return Promise.resolve(null);
    if (args.signal?.aborted)
      return Promise.resolve(null);
    const timeoutMs = Math.max(0, Math.floor(args.timeoutMs));
    if (timeoutMs <= 0)
      return Promise.resolve(null);
    const keys = Array.from(new Set(args.keys.map(u32)));
    const broad = keys.length > this.keyIndexMaxKeys;
    return new Promise((resolve2) => {
      const waiter = {
        afterGeneration: u32(args.afterGeneration),
        keys,
        broad,
        deadlineMs: Date.now() + timeoutMs,
        heapIndex: -1,
        done: false,
        cleanup: (hit) => {
          if (waiter.done)
            return;
          waiter.done = true;
          if (waiter.broad) {
            this.broad.delete(waiter);
          } else {
            for (const k of waiter.keys) {
              const s = this.byKey.get(k);
              if (!s)
                continue;
              s.delete(waiter);
              if (s.size === 0)
                this.byKey.delete(k);
            }
          }
          this.activeWaiters = Math.max(0, this.activeWaiters - 1);
          const removedRoot = this.heapRemove(waiter);
          if (args.signal)
            args.signal.removeEventListener("abort", onAbort);
          if (removedRoot)
            this.rescheduleTimeoutTimer();
          resolve2(hit);
        }
      };
      if (waiter.broad) {
        this.broad.add(waiter);
      } else {
        for (const k of waiter.keys) {
          const set = this.byKey.get(k) ?? new Set;
          set.add(waiter);
          this.byKey.set(k, set);
        }
      }
      this.activeWaiters += 1;
      const onAbort = () => waiter.cleanup(null);
      if (args.signal)
        args.signal.addEventListener("abort", onAbort, { once: true });
      this.heapPush(waiter);
      this.rescheduleTimeoutTimer();
    });
  }
  ensureFlushScheduled() {
    if (this.flushTimer)
      return;
    this.flushTimer = setTimeout(() => this.flushBucket(), this.coalesceMs);
  }
  flushBucket() {
    this.flushTimer = null;
    const hasTouches = this.pending.size > 0 || this.overflow;
    if (!hasTouches)
      return;
    this.generation = u32(this.generation + 1);
    const gen = this.getGeneration();
    const bucketMaxSourceOffsetSeq = this.pendingMaxSourceOffsetSeq;
    if (bucketMaxSourceOffsetSeq > this.lastFlushedSourceOffsetSeq)
      this.lastFlushedSourceOffsetSeq = bucketMaxSourceOffsetSeq;
    const flushAtMs = Date.now();
    const bucketStartMs = this.pendingBucketStartMs > 0 ? this.pendingBucketStartMs : flushAtMs;
    if (this.lastFlushAtMs > 0 && flushAtMs >= this.lastFlushAtMs) {
      this.flushIntervalsLast10s.push({ atMs: flushAtMs, intervalMs: flushAtMs - this.lastFlushAtMs });
      this.pruneFlushIntervals(flushAtMs);
    }
    this.lastFlushAtMs = flushAtMs;
    this.lastBucketStartMs = bucketStartMs;
    this.totals.flushes += 1;
    if (this.overflow) {
      this.overflowBuckets += 1;
      this.lastOverflowGeneration = gen;
    }
    for (const keyId of this.pending) {
      const h1 = u32(keyId);
      let h2 = mix32(h1);
      if (h2 === 0)
        h2 = 2654435769;
      for (let i = 0;i < this.k; i++) {
        const pos = u32(h1 + Math.imul(i, h2)) & this.mask;
        this.lastSet[pos] = gen;
      }
    }
    if (this.overflow) {
      const wakeStartMs = Date.now();
      let wakeups = 0;
      const all = [];
      for (const s of this.byKey.values())
        for (const w of s)
          all.push(w);
      for (const w of this.broad)
        all.push(w);
      for (const w of all) {
        if (w.done)
          continue;
        if (gen > w.afterGeneration) {
          wakeups += 1;
          w.cleanup({ generation: gen, keyId: 0, bucketMaxSourceOffsetSeq, flushAtMs, bucketStartMs });
        }
      }
      if (wakeups > 0) {
        const wakeMs = Date.now() - wakeStartMs;
        this.interval.notifyWakeups += wakeups;
        this.interval.notifyFlushes += 1;
        this.interval.notifyWakeMsSum += wakeMs;
        this.interval.notifyWakeMsMax = Math.max(this.interval.notifyWakeMsMax, wakeMs);
        this.totals.notifyWakeups += wakeups;
        this.totals.notifyFlushes += 1;
        this.totals.notifyWakeMsSum += wakeMs;
        this.totals.notifyWakeMsMax = Math.max(this.totals.notifyWakeMsMax, wakeMs);
      }
    } else {
      const wakeStartMs = Date.now();
      let wakeups = 0;
      for (const keyId of this.pending) {
        const set = this.byKey.get(keyId);
        if (!set || set.size === 0)
          continue;
        for (const w of set) {
          if (w.done)
            continue;
          if (gen > w.afterGeneration) {
            wakeups += 1;
            w.cleanup({ generation: gen, keyId, bucketMaxSourceOffsetSeq, flushAtMs, bucketStartMs });
          }
        }
      }
      if (this.broad.size > 0) {
        for (const w of this.broad) {
          if (w.done)
            continue;
          if (gen <= w.afterGeneration)
            continue;
          let hit = false;
          for (let i = 0;i < w.keys.length; i++) {
            if (this.maybeTouchedSince(w.keys[i], w.afterGeneration)) {
              hit = true;
              break;
            }
          }
          if (hit) {
            wakeups += 1;
            w.cleanup({ generation: gen, keyId: 0, bucketMaxSourceOffsetSeq, flushAtMs, bucketStartMs });
          }
        }
      }
      if (wakeups > 0) {
        const wakeMs = Date.now() - wakeStartMs;
        this.interval.notifyWakeups += wakeups;
        this.interval.notifyFlushes += 1;
        this.interval.notifyWakeMsSum += wakeMs;
        this.interval.notifyWakeMsMax = Math.max(this.interval.notifyWakeMsMax, wakeMs);
        this.totals.notifyWakeups += wakeups;
        this.totals.notifyFlushes += 1;
        this.totals.notifyWakeMsSum += wakeMs;
        this.totals.notifyWakeMsMax = Math.max(this.totals.notifyWakeMsMax, wakeMs);
      }
    }
    this.pending.clear();
    this.pendingBucketStartMs = 0;
    this.pendingMaxSourceOffsetSeq = -1n;
    this.overflow = false;
  }
  getLastFlushAtMs() {
    return this.lastFlushAtMs;
  }
  getLastBucketStartMs() {
    return this.lastBucketStartMs;
  }
  pruneFlushIntervals(nowMs) {
    const cutoff = nowMs - 1e4;
    while (this.flushIntervalsLast10s.length > 0 && this.flushIntervalsLast10s[0].atMs < cutoff) {
      this.flushIntervalsLast10s.shift();
    }
  }
  rescheduleTimeoutTimer() {
    const next = this.deadlineHeap[0];
    if (!next) {
      if (this.timeoutTimer)
        clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
      this.scheduledDeadlineMs = null;
      return;
    }
    if (this.timeoutTimer && this.scheduledDeadlineMs != null && this.scheduledDeadlineMs === next.deadlineMs)
      return;
    if (this.timeoutTimer)
      clearTimeout(this.timeoutTimer);
    this.scheduledDeadlineMs = next.deadlineMs;
    const delayMs = Math.max(0, next.deadlineMs - Date.now());
    this.timeoutTimer = setTimeout(() => this.expireDueWaiters(), delayMs);
  }
  expireDueWaiters() {
    this.timeoutTimer = null;
    this.scheduledDeadlineMs = null;
    const start = Date.now();
    const now = start;
    let expired = 0;
    for (;; ) {
      const head = this.deadlineHeap[0];
      if (!head)
        break;
      if (head.deadlineMs > now)
        break;
      const w = this.heapPopMin();
      if (!w)
        break;
      if (w.done)
        continue;
      expired += 1;
      w.cleanup(null);
    }
    if (expired > 0) {
      const sweepMs = Date.now() - start;
      this.interval.timeoutsFired += expired;
      this.interval.timeoutSweeps += 1;
      this.interval.timeoutSweepMsSum += sweepMs;
      this.interval.timeoutSweepMsMax = Math.max(this.interval.timeoutSweepMsMax, sweepMs);
      this.totals.timeoutsFired += expired;
      this.totals.timeoutSweeps += 1;
      this.totals.timeoutSweepMsSum += sweepMs;
      this.totals.timeoutSweepMsMax = Math.max(this.totals.timeoutSweepMsMax, sweepMs);
    }
    this.rescheduleTimeoutTimer();
  }
  heapSwap(i, j) {
    const a = this.deadlineHeap[i];
    const b = this.deadlineHeap[j];
    this.deadlineHeap[i] = b;
    this.deadlineHeap[j] = a;
    a.heapIndex = j;
    b.heapIndex = i;
  }
  heapLess(i, j) {
    const a = this.deadlineHeap[i];
    const b = this.deadlineHeap[j];
    return a.deadlineMs < b.deadlineMs;
  }
  heapSiftUp(i) {
    let idx = i;
    while (idx > 0) {
      const parent = idx - 1 >> 1;
      if (!this.heapLess(idx, parent))
        break;
      this.heapSwap(idx, parent);
      idx = parent;
    }
  }
  heapSiftDown(i) {
    let idx = i;
    for (;; ) {
      const left = idx * 2 + 1;
      const right = left + 1;
      if (left >= this.deadlineHeap.length)
        break;
      let smallest = left;
      if (right < this.deadlineHeap.length && this.heapLess(right, left))
        smallest = right;
      if (!this.heapLess(smallest, idx))
        break;
      this.heapSwap(idx, smallest);
      idx = smallest;
    }
  }
  heapPush(w) {
    if (w.heapIndex >= 0)
      return;
    w.heapIndex = this.deadlineHeap.length;
    this.deadlineHeap.push(w);
    this.heapSiftUp(w.heapIndex);
  }
  heapRemove(w) {
    const idx = w.heapIndex;
    if (idx < 0)
      return false;
    const lastIdx = this.deadlineHeap.length - 1;
    const removedRoot = idx === 0;
    if (idx !== lastIdx)
      this.heapSwap(idx, lastIdx);
    this.deadlineHeap.pop();
    w.heapIndex = -1;
    if (idx < this.deadlineHeap.length) {
      this.heapSiftDown(idx);
      this.heapSiftUp(idx);
    }
    return removedRoot;
  }
  heapPopMin() {
    if (this.deadlineHeap.length === 0)
      return null;
    const w = this.deadlineHeap[0];
    const last = this.deadlineHeap.length - 1;
    if (last === 0) {
      this.deadlineHeap.pop();
      w.heapIndex = -1;
      return w;
    }
    this.heapSwap(0, last);
    this.deadlineHeap.pop();
    w.heapIndex = -1;
    this.heapSiftDown(0);
    return w;
  }
}
function percentile(values, p) {
  if (values.length === 0)
    return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 0;
}

// src/touch/manager.ts
import { Result as Result15 } from "better-result";
var BASE_WAL_GC_INTERVAL_MS = (() => {
  const raw = process.env.DS_BASE_WAL_GC_INTERVAL_MS;
  if (raw == null || raw.trim() === "")
    return 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`invalid DS_BASE_WAL_GC_INTERVAL_MS: ${raw}`);
    return 1000;
  }
  return Math.floor(n);
})();
var BASE_WAL_GC_CHUNK_OFFSETS2 = (() => {
  const raw = process.env.DS_BASE_WAL_GC_CHUNK_OFFSETS;
  if (raw == null || raw.trim() === "")
    return 1e5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`invalid DS_BASE_WAL_GC_CHUNK_OFFSETS: ${raw}`);
    return 1e5;
  }
  return Math.floor(n);
})();
var HOT_INTEREST_MAX_KEYS = 64;

class TouchInterpreterManager {
  cfg;
  db;
  registry;
  pool;
  timer = null;
  running = false;
  stopping = false;
  dirty = new Set;
  failures = new FailureTracker(1024);
  lastBaseWalGc = new LruCache(1024);
  templates;
  liveMetrics;
  lastTemplateGcMsByStream = new LruCache(1024);
  journals = new Map;
  fineLagCoarseOnlyByStream = new Map;
  touchModeByStream = new Map;
  fineTokenBucketsByStream = new Map;
  hotFineByStream = new Map;
  lagSourceOffsetsByStream = new Map;
  restrictedTemplateBucketStateByStream = new Map;
  runtimeTotalsByStream = new Map;
  zeroRowBacklogStreakByStream = new Map;
  streamScanCursor = 0;
  restartWorkerPoolRequested = false;
  lastWorkerPoolRestartAtMs = 0;
  constructor(cfg, db, ingest, notifier, registry, backpressure) {
    this.cfg = cfg;
    this.db = db;
    this.registry = registry;
    this.pool = new TouchInterpreterWorkerPool(cfg, cfg.interpreterWorkers);
    this.templates = new LiveTemplateRegistry(db);
    this.liveMetrics = new LiveMetricsV2(db, ingest, {
      getTouchJournal: (stream) => {
        const j = this.journals.get(stream);
        if (!j)
          return null;
        return { meta: j.getMeta(), interval: j.snapshotAndResetIntervalStats() };
      }
    });
  }
  start() {
    if (this.timer)
      return;
    this.stopping = false;
    this.pool.start();
    this.seedInterpretersFromRegistry();
    const liveMetricsRes = this.liveMetrics.ensureStreamResult();
    if (Result15.isError(liveMetricsRes)) {
      console.error("touch live metrics stream validation failed", liveMetricsRes.error.message);
    } else {
      this.liveMetrics.start();
    }
    if (this.cfg.interpreterCheckIntervalMs > 0) {
      this.timer = setInterval(() => {
        this.tick();
      }, this.cfg.interpreterCheckIntervalMs);
    }
  }
  stop() {
    this.stopping = true;
    if (this.timer)
      clearInterval(this.timer);
    this.timer = null;
    this.pool.stop();
    this.liveMetrics.stop();
    for (const j of this.journals.values())
      j.stop();
    this.journals.clear();
    this.fineLagCoarseOnlyByStream.clear();
    this.touchModeByStream.clear();
    this.fineTokenBucketsByStream.clear();
    this.hotFineByStream.clear();
    this.lagSourceOffsetsByStream.clear();
    this.restrictedTemplateBucketStateByStream.clear();
    this.runtimeTotalsByStream.clear();
    this.zeroRowBacklogStreakByStream.clear();
    this.restartWorkerPoolRequested = false;
    this.lastWorkerPoolRestartAtMs = 0;
  }
  notify(stream) {
    this.dirty.add(stream);
  }
  async tick() {
    if (this.stopping)
      return;
    if (this.running)
      return;
    if (this.cfg.interpreterWorkers <= 0)
      return;
    this.running = true;
    try {
      const nowMs = Date.now();
      const dirtyNow = new Set(this.dirty);
      this.dirty.clear();
      const states = this.db.listStreamInterpreters();
      if (states.length === 0)
        return;
      const stateByStream = new Map(states.map((s) => [s.stream, s]));
      const ordered = [];
      for (const s of dirtyNow)
        if (stateByStream.has(s))
          ordered.push(s);
      for (const s of stateByStream.keys())
        if (!dirtyNow.has(s))
          ordered.push(s);
      const prioritized = this.prioritizeStreamsForProcessing(ordered, nowMs);
      const maxConcurrent = Math.max(1, this.cfg.interpreterWorkers);
      const tasks = [];
      if (prioritized.length > 0) {
        const total = prioritized.length;
        const start = this.streamScanCursor % total;
        for (let i = 0;i < total && tasks.length < maxConcurrent; i++) {
          if (this.stopping)
            break;
          const stream = prioritized[(start + i) % total];
          if (this.failures.shouldSkip(stream))
            continue;
          const st = stateByStream.get(stream);
          if (!st)
            continue;
          const p = this.processOne(stream, st.interpreted_through).catch((e) => {
            this.failures.recordFailure(stream);
            console.error("touch interpreter failed", stream, e);
          });
          tasks.push(p);
        }
        this.streamScanCursor = (start + Math.max(1, tasks.length)) % total;
      }
      await Promise.all(tasks);
      if (this.restartWorkerPoolRequested) {
        this.restartWorkerPoolRequested = false;
        try {
          this.pool.restart();
          this.lastWorkerPoolRestartAtMs = Date.now();
        } catch (e) {
          console.error("touch interpreter worker-pool restart failed", e);
        }
      }
      for (const stream of stateByStream.keys()) {
        if (this.stopping)
          break;
        const srow = this.db.getStream(stream);
        if (!srow || this.db.isDeleted(srow))
          continue;
        const interp = this.db.getStreamInterpreter(stream);
        if (!interp)
          continue;
        this.maybeGcBaseWal(stream, srow.uploaded_through, interp.interpreted_through);
      }
      const touchCfgByStream = new Map;
      let persistIntervalMin = Number.POSITIVE_INFINITY;
      for (const stream of stateByStream.keys()) {
        if (this.stopping)
          break;
        const regRes = this.registry.getRegistryResult(stream);
        if (Result15.isError(regRes)) {
          console.error("touch registry read failed", stream, regRes.error.message);
          continue;
        }
        const reg = regRes.value;
        if (!isTouchEnabled(reg.interpreter))
          continue;
        const touchCfg = reg.interpreter.touch;
        touchCfgByStream.set(stream, touchCfg);
        const persistInterval = touchCfg.templates?.lastSeenPersistIntervalMs ?? 5 * 60 * 1000;
        if (persistInterval < persistIntervalMin)
          persistIntervalMin = persistInterval;
      }
      if (touchCfgByStream.size > 0 && Number.isFinite(persistIntervalMin)) {
        this.templates.flushLastSeen(nowMs, persistIntervalMin);
      }
      for (const [stream, touchCfg] of touchCfgByStream.entries()) {
        if (this.stopping)
          break;
        const gcInterval = touchCfg.templates?.gcIntervalMs ?? 60000;
        const last = this.lastTemplateGcMsByStream.get(stream) ?? 0;
        if (nowMs - last < gcInterval)
          continue;
        this.lastTemplateGcMsByStream.set(stream, nowMs);
        const retired = this.templates.gcRetireExpired(stream, nowMs);
        if (retired.retired.length > 0) {
          this.liveMetrics.emitLifecycle(retired.retired);
        }
      }
    } finally {
      this.running = false;
    }
  }
  async processOne(stream, interpretedThrough) {
    const srow = this.db.getStream(stream);
    if (!srow || this.db.isDeleted(srow)) {
      this.db.deleteStreamInterpreter(stream);
      return;
    }
    const next = srow.next_offset;
    if (next <= 0n)
      return;
    const fromOffset = interpretedThrough + 1n;
    const toOffset = next - 1n;
    if (fromOffset > toOffset)
      return;
    const regRes = this.registry.getRegistryResult(stream);
    if (Result15.isError(regRes)) {
      console.error("touch registry read failed", stream, regRes.error.message);
      this.db.deleteStreamInterpreter(stream);
      return;
    }
    const reg = regRes.value;
    if (!isTouchEnabled(reg.interpreter)) {
      this.db.deleteStreamInterpreter(stream);
      return;
    }
    const touchCfg = reg.interpreter.touch;
    const failProcessing = (message) => {
      this.failures.recordFailure(stream);
      this.liveMetrics.recordInterpreterError(stream, touchCfg);
      console.error("touch interpreter failed", stream, message);
    };
    const nowMs = Date.now();
    const hotFine = this.getHotFineSnapshot(stream, touchCfg, nowMs);
    const fineWaitersActive = hotFine?.fineWaitersActive ?? 0;
    const coarseWaitersActive = hotFine?.coarseWaitersActive ?? 0;
    const hasAnyWaiters = fineWaitersActive + coarseWaitersActive > 0;
    const hasFineDemand = fineWaitersActive > 0 || (hotFine?.broadFineWaitersActive ?? 0) > 0 || (hotFine?.hotKeyCount ?? 0) > 0 || (hotFine?.hotTemplateCount ?? 0) > 0;
    const lagAtStart = toOffset >= interpretedThrough ? toOffset - interpretedThrough : 0n;
    const suppressFineDueToLag = this.computeSuppressFineDueToLag(stream, touchCfg, lagAtStart, hasFineDemand);
    const j = this.getOrCreateJournal(stream, touchCfg);
    j.setCoalesceMs(this.computeAdaptiveCoalesceMs(touchCfg, lagAtStart, hasAnyWaiters));
    const fineBudgetPerBatch = Math.max(0, Math.floor(touchCfg.fineTouchBudgetPerBatch ?? 2000));
    const lagReservedFineBudgetPerBatch = Math.max(0, Math.floor(touchCfg.lagReservedFineTouchBudgetPerBatch ?? 200));
    let fineBudget = !hasFineDemand ? 0 : suppressFineDueToLag ? lagReservedFineBudgetPerBatch : fineBudgetPerBatch;
    let tokenLimited = false;
    let refundFineTokens = null;
    if (fineBudget > 0) {
      const tokenGrant = this.reserveFineTokens(stream, touchCfg, fineBudget, nowMs);
      fineBudget = tokenGrant.granted;
      tokenLimited = tokenGrant.tokenLimited;
      refundFineTokens = tokenGrant.refund;
    }
    let emitFineTouches = hasFineDemand && fineBudget > 0;
    let fineGranularity = "key";
    const batchStartMs = Date.now();
    if (emitFineTouches && hotFine && hotFine.hotKeyCount === 0 && hotFine.hotTemplateCount === 0 && hotFine.broadFineWaitersActive === 0 && hotFine.keyFilteringEnabled && !hotFine.templateFilteringEnabled) {
      emitFineTouches = false;
    }
    if (emitFineTouches && suppressFineDueToLag)
      fineGranularity = "template";
    if (fineGranularity !== "template") {
      this.restrictedTemplateBucketStateByStream.delete(stream);
    }
    const interpretMode = fineGranularity === "template" ? "hotTemplatesOnly" : "full";
    const touchMode = !hasAnyWaiters ? "idle" : emitFineTouches ? suppressFineDueToLag ? "restricted" : "fine" : "coarseOnly";
    this.touchModeByStream.set(stream, touchMode);
    const processRes = await this.pool.processResult({
      stream,
      fromOffset,
      toOffset,
      interpreter: reg.interpreter,
      maxRows: Math.max(1, this.cfg.interpreterMaxBatchRows),
      maxBytes: Math.max(1, this.cfg.interpreterMaxBatchBytes),
      emitFineTouches,
      fineTouchBudget: emitFineTouches ? fineBudget : 0,
      fineGranularity,
      interpretMode,
      filterHotTemplates: !!(hotFine && hotFine.templateFilteringEnabled),
      hotTemplateIds: hotFine?.hotTemplateIdsForWorker ?? null
    });
    if (Result15.isError(processRes)) {
      failProcessing(processRes.error.message);
      return;
    }
    const res = processRes.value;
    if (res.stats.rowsRead === 0 && toOffset >= fromOffset && this.rangeLikelyHasRows(stream, fromOffset, toOffset)) {
      const nextStreak = (this.zeroRowBacklogStreakByStream.get(stream) ?? 0) + 1;
      this.zeroRowBacklogStreakByStream.set(stream, nextStreak);
      if (nextStreak >= 5) {
        const now = Date.now();
        if (now - this.lastWorkerPoolRestartAtMs >= 30000) {
          this.restartWorkerPoolRequested = true;
          console.error("touch interpreter produced zero-row batch despite WAL backlog; scheduling worker-pool restart", stream, `from=${fromOffset.toString()}`, `to=${toOffset.toString()}`);
        }
      }
    } else {
      this.zeroRowBacklogStreakByStream.delete(stream);
    }
    if (refundFineTokens) {
      refundFineTokens(Math.max(0, res.stats.templateTouchesEmitted ?? 0));
    }
    const batchDurationMs = Math.max(0, Date.now() - batchStartMs);
    let touches = res.touches;
    const fineDroppedDueToBudget = Math.max(0, res.stats.fineTouchesDroppedDueToBudget ?? 0);
    let fineSkippedColdKey = 0;
    let fineSkippedTemplateBucket = 0;
    if (hotFine && hotFine.keyFilteringEnabled && fineGranularity !== "template") {
      const keyActiveSet = hotFine.hotKeyActiveSet;
      const keyGraceSet = hotFine.hotKeyGraceSet;
      const keyCount = (keyActiveSet?.size ?? 0) + (keyGraceSet?.size ?? 0);
      if (keyCount === 0) {
        for (const t of touches)
          if (t.kind === "template")
            fineSkippedColdKey += 1;
        touches = touches.filter((t) => t.kind === "table");
      } else {
        const filtered = [];
        for (const t of touches) {
          if (t.kind !== "template") {
            filtered.push(t);
            continue;
          }
          const keyId = t.keyId >>> 0;
          if (keyActiveSet && keyActiveSet.has(keyId) || keyGraceSet && keyGraceSet.has(keyId)) {
            filtered.push(t);
          } else
            fineSkippedColdKey += 1;
        }
        touches = filtered;
      }
    }
    if (fineGranularity === "template" && touches.length > 0) {
      const coalesced = this.coalesceRestrictedTemplateTouches(stream, touchCfg, touches);
      touches = coalesced.touches;
      fineSkippedTemplateBucket = coalesced.dropped;
    }
    if (touches.length > 0) {
      const j2 = this.getOrCreateJournal(stream, touchCfg);
      for (const t of touches) {
        let sourceOffsetSeq;
        try {
          sourceOffsetSeq = BigInt(t.watermark);
        } catch {
          sourceOffsetSeq = undefined;
        }
        j2.touch(t.keyId >>> 0, sourceOffsetSeq);
      }
    }
    try {
      const lag = toOffset >= res.processedThrough ? toOffset - res.processedThrough : 0n;
      const lagNum = lag > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(lag);
      const effectiveLag = hasFineDemand ? lagNum : 0;
      this.lagSourceOffsetsByStream.set(stream, effectiveLag);
      const maxSourceTsMs = Number(res.stats.maxSourceTsMs ?? 0);
      const commitLagMs = maxSourceTsMs > 0 ? Math.max(0, Date.now() - maxSourceTsMs) : undefined;
      this.liveMetrics.recordInterpreterBatch({
        stream,
        touchCfg,
        rowsRead: res.stats.rowsRead,
        changes: res.stats.changes,
        touches: touches.map((t) => ({ keyId: t.keyId >>> 0, kind: t.kind })),
        lagSourceOffsets: effectiveLag,
        commitLagMs,
        fineTouchesDroppedDueToBudget: fineDroppedDueToBudget,
        fineTouchesSkippedColdTemplate: Math.max(0, res.stats.fineTouchesSkippedColdTemplate ?? 0),
        fineTouchesSkippedColdKey: fineSkippedColdKey,
        fineTouchesSkippedTemplateBucket: fineSkippedTemplateBucket,
        fineTouchesSuppressedDueToLag: suppressFineDueToLag,
        fineTouchesSuppressedDueToLagMs: suppressFineDueToLag ? batchDurationMs : 0,
        fineTouchesSuppressedDueToBudget: !!res.stats.fineTouchesSuppressedDueToBudget || tokenLimited,
        touchMode,
        hotFineKeys: hotFine?.hotKeyCount ?? 0,
        hotTemplates: hotFine?.hotTemplateCount ?? 0,
        hotFineKeysActive: hotFine?.hotKeyActiveCount ?? 0,
        hotFineKeysGrace: hotFine?.hotKeyGraceCount ?? 0,
        hotTemplatesActive: hotFine?.hotTemplateActiveCount ?? 0,
        hotTemplatesGrace: hotFine?.hotTemplateGraceCount ?? 0,
        fineWaitersActive,
        coarseWaitersActive,
        broadFineWaitersActive: hotFine?.broadFineWaitersActive ?? 0,
        scannedButEmitted0: res.stats.rowsRead > 0 && touches.length === 0,
        noInterestFastForward: false,
        interpretedThroughDelta: res.processedThrough >= interpretedThrough ? Number(res.processedThrough - interpretedThrough > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : res.processedThrough - interpretedThrough) : 0,
        touchesEmittedDelta: touches.length
      });
    } catch {}
    const interpretedDelta = res.processedThrough >= interpretedThrough ? Number(res.processedThrough - interpretedThrough > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : res.processedThrough - interpretedThrough) : 0;
    const totals = this.getOrCreateRuntimeTotals(stream);
    totals.scanBatchesTotal += 1;
    totals.scanRowsTotal += Math.max(0, res.stats.rowsRead);
    if (res.stats.rowsRead > 0 && touches.length === 0)
      totals.scannedButEmitted0BatchesTotal += 1;
    totals.interpretedThroughDeltaTotal += interpretedDelta;
    totals.touchesEmittedTotal += touches.length;
    let tableTouches = 0;
    let templateTouches = 0;
    for (const t of touches) {
      if (t.kind === "table")
        tableTouches += 1;
      else
        templateTouches += 1;
    }
    totals.touchesTableTotal += tableTouches;
    totals.touchesTemplateTotal += templateTouches;
    totals.fineTouchesDroppedDueToBudgetTotal += fineDroppedDueToBudget;
    totals.fineTouchesSkippedColdTemplateTotal += Math.max(0, res.stats.fineTouchesSkippedColdTemplate ?? 0);
    totals.fineTouchesSkippedColdKeyTotal += fineSkippedColdKey;
    totals.fineTouchesSkippedTemplateBucketTotal += fineSkippedTemplateBucket;
    this.db.updateStreamInterpreterThrough(stream, res.processedThrough);
    if (res.processedThrough < toOffset)
      this.dirty.add(stream);
    this.failures.recordSuccess(stream);
  }
  maybeGcBaseWal(stream, uploadedThrough, interpretedThrough) {
    const gcTargetThrough = interpretedThrough < uploadedThrough ? interpretedThrough : uploadedThrough;
    if (gcTargetThrough < 0n)
      return;
    const now = Date.now();
    const last = this.lastBaseWalGc.get(stream) ?? { atMs: 0, through: -1n };
    if (now - last.atMs < BASE_WAL_GC_INTERVAL_MS)
      return;
    if (gcTargetThrough <= last.through) {
      this.lastBaseWalGc.set(stream, { atMs: now, through: last.through });
      return;
    }
    const chunk = BigInt(BASE_WAL_GC_CHUNK_OFFSETS2);
    const maxThroughThisSweep = chunk > 0n ? last.through + chunk : gcTargetThrough;
    const gcThrough = gcTargetThrough > maxThroughThisSweep ? maxThroughThisSweep : gcTargetThrough;
    try {
      const start = Date.now();
      const res = this.db.deleteWalThrough(stream, gcThrough);
      const durationMs = Date.now() - start;
      if (res.deletedRows > 0 || res.deletedBytes > 0) {
        this.liveMetrics.recordBaseWalGc(stream, { deletedRows: res.deletedRows, deletedBytes: res.deletedBytes, durationMs });
      }
      this.lastBaseWalGc.set(stream, { atMs: now, through: gcThrough });
    } catch (e) {
      console.error("base WAL gc failed", stream, e);
      this.lastBaseWalGc.set(stream, { atMs: now, through: last.through });
    }
  }
  seedInterpretersFromRegistry() {
    try {
      const rows = this.db.db.query(`SELECT stream, schema_json FROM schemas;`).all();
      for (const row of rows) {
        const stream = String(row.stream);
        const json = String(row.schema_json ?? "");
        let raw;
        try {
          raw = JSON.parse(json);
        } catch {
          continue;
        }
        const enabled = !!raw?.interpreter?.touch?.enabled;
        if (enabled)
          this.db.ensureStreamInterpreter(stream);
        else
          this.db.deleteStreamInterpreter(stream);
      }
    } catch {}
  }
  activateTemplates(args) {
    const nowMs = Date.now();
    const limits = {
      maxActiveTemplatesPerStream: args.touchCfg.templates?.maxActiveTemplatesPerStream ?? 2048,
      maxActiveTemplatesPerEntity: args.touchCfg.templates?.maxActiveTemplatesPerEntity ?? 256,
      activationRateLimitPerMinute: args.touchCfg.templates?.activationRateLimitPerMinute ?? 100
    };
    const res = this.templates.activate({
      stream: args.stream,
      activeFromTouchOffset: args.activeFromTouchOffset,
      baseStreamNextOffset: args.baseStreamNextOffset,
      templates: args.templates,
      inactivityTtlMs: args.inactivityTtlMs,
      limits,
      nowMs
    });
    const deniedRate = res.denied.filter((d) => d.reason === "rate_limited").length;
    if (deniedRate > 0)
      this.liveMetrics.recordActivationDenied(args.stream, args.touchCfg, deniedRate);
    if (res.lifecycle.length > 0)
      this.liveMetrics.emitLifecycle(res.lifecycle);
    return { activated: res.activated, denied: res.denied };
  }
  heartbeatTemplates(args) {
    const nowMs = Date.now();
    this.templates.heartbeat(args.stream, args.templateIdsUsed, nowMs);
    const persistInterval = args.touchCfg.templates?.lastSeenPersistIntervalMs ?? 5 * 60 * 1000;
    this.templates.flushLastSeen(nowMs, persistInterval);
  }
  beginHotWaitInterest(args) {
    const nowMs = Date.now();
    const limits = this.getHotFineLimits(args.touchCfg);
    const state = this.getOrCreateHotFineState(args.stream);
    const isFine = args.interestMode === "fine";
    if (isFine)
      state.fineWaitersActive += 1;
    else
      state.coarseWaitersActive += 1;
    const trackedKeyIds = [];
    const trackedTemplateIds = [];
    const broad = isFine && args.keyIds.length > HOT_INTEREST_MAX_KEYS;
    if (!isFine) {} else if (broad) {
      state.broadFineWaitersActive += 1;
    } else {
      const uniqueKeys = new Set(args.keyIds.map((raw) => Number(raw) >>> 0));
      for (const keyId of uniqueKeys) {
        if (this.acquireHotKey(state, keyId, limits.maxKeys))
          trackedKeyIds.push(keyId);
      }
    }
    if (isFine) {
      const uniqueTemplates = new Set;
      for (const raw of args.templateIdsUsed) {
        const templateId = String(raw).trim();
        if (!/^[0-9a-f]{16}$/.test(templateId))
          continue;
        uniqueTemplates.add(templateId);
      }
      for (const templateId of uniqueTemplates) {
        if (this.acquireHotTemplate(state, templateId, limits.maxTemplates))
          trackedTemplateIds.push(templateId);
      }
    }
    this.sweepHotFineState(args.stream, args.touchCfg, nowMs, true);
    let released = false;
    return () => {
      if (released)
        return;
      released = true;
      const st = this.hotFineByStream.get(args.stream);
      if (!st)
        return;
      const releaseNowMs = Date.now();
      if (isFine)
        st.fineWaitersActive = Math.max(0, st.fineWaitersActive - 1);
      else
        st.coarseWaitersActive = Math.max(0, st.coarseWaitersActive - 1);
      if (broad)
        st.broadFineWaitersActive = Math.max(0, st.broadFineWaitersActive - 1);
      for (const keyId of trackedKeyIds) {
        this.releaseHotKey(st, keyId, releaseNowMs, limits.keyGraceMs, limits.maxKeys);
      }
      for (const templateId of trackedTemplateIds) {
        this.releaseHotTemplate(st, templateId, releaseNowMs, limits.templateGraceMs, limits.maxTemplates);
      }
      this.sweepHotFineState(args.stream, args.touchCfg, releaseNowMs, true);
    };
  }
  getTouchRuntimeSnapshot(args) {
    const nowMs = Date.now();
    const hot = this.getHotFineSnapshot(args.stream, args.touchCfg, nowMs);
    const totals = this.getOrCreateRuntimeTotals(args.stream);
    const journal = this.journals.get(args.stream) ?? null;
    const journalTotals = journal?.getTotalStats();
    return {
      lagSourceOffsets: this.lagSourceOffsetsByStream.get(args.stream) ?? 0,
      touchMode: this.touchModeByStream.get(args.stream) ?? (this.fineLagCoarseOnlyByStream.get(args.stream) ? "coarseOnly" : "fine"),
      hotFineKeys: hot?.hotKeyCount ?? 0,
      hotTemplates: hot?.hotTemplateCount ?? 0,
      hotFineKeysActive: hot?.hotKeyActiveCount ?? 0,
      hotFineKeysGrace: hot?.hotKeyGraceCount ?? 0,
      hotTemplatesActive: hot?.hotTemplateActiveCount ?? 0,
      hotTemplatesGrace: hot?.hotTemplateGraceCount ?? 0,
      fineWaitersActive: hot?.fineWaitersActive ?? 0,
      coarseWaitersActive: hot?.coarseWaitersActive ?? 0,
      broadFineWaitersActive: hot?.broadFineWaitersActive ?? 0,
      hotKeyFilteringEnabled: hot?.keyFilteringEnabled ?? false,
      hotTemplateFilteringEnabled: hot?.templateFilteringEnabled ?? false,
      scanRowsTotal: totals.scanRowsTotal,
      scanBatchesTotal: totals.scanBatchesTotal,
      scannedButEmitted0BatchesTotal: totals.scannedButEmitted0BatchesTotal,
      interpretedThroughDeltaTotal: totals.interpretedThroughDeltaTotal,
      touchesEmittedTotal: totals.touchesEmittedTotal,
      touchesTableTotal: totals.touchesTableTotal,
      touchesTemplateTotal: totals.touchesTemplateTotal,
      fineTouchesDroppedDueToBudgetTotal: totals.fineTouchesDroppedDueToBudgetTotal,
      fineTouchesSkippedColdTemplateTotal: totals.fineTouchesSkippedColdTemplateTotal,
      fineTouchesSkippedColdKeyTotal: totals.fineTouchesSkippedColdKeyTotal,
      fineTouchesSkippedTemplateBucketTotal: totals.fineTouchesSkippedTemplateBucketTotal,
      waitTouchedTotal: totals.waitTouchedTotal,
      waitTimeoutTotal: totals.waitTimeoutTotal,
      waitStaleTotal: totals.waitStaleTotal,
      journalFlushesTotal: journalTotals?.flushes ?? 0,
      journalNotifyWakeupsTotal: journalTotals?.notifyWakeups ?? 0,
      journalNotifyWakeMsTotal: journalTotals?.notifyWakeMsSum ?? 0,
      journalNotifyWakeMsMax: journalTotals?.notifyWakeMsMax ?? 0,
      journalTimeoutsFiredTotal: journalTotals?.timeoutsFired ?? 0,
      journalTimeoutSweepMsTotal: journalTotals?.timeoutSweepMsSum ?? 0
    };
  }
  recordWaitMetrics(args) {
    this.liveMetrics.recordWait(args.stream, args.touchCfg, args.keysCount, args.outcome, args.latencyMs);
    const totals = this.getOrCreateRuntimeTotals(args.stream);
    if (args.outcome === "touched")
      totals.waitTouchedTotal += 1;
    else if (args.outcome === "timeout")
      totals.waitTimeoutTotal += 1;
    else
      totals.waitStaleTotal += 1;
  }
  resolveTemplateEntitiesForWait(args) {
    const ids = Array.from(new Set(args.templateIdsUsed.map((x) => String(x).trim()).filter((x) => /^[0-9a-f]{16}$/.test(x))));
    if (ids.length === 0)
      return [];
    const entities = new Set;
    const chunkSize = 200;
    for (let i = 0;i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db.db.query(`SELECT DISTINCT entity
           FROM live_templates
           WHERE stream=? AND state='active' AND template_id IN (${placeholders});`).all(args.stream, ...chunk);
      for (const row of rows) {
        const entity = String(row?.entity ?? "").trim();
        if (entity !== "")
          entities.add(entity);
      }
    }
    return Array.from(entities);
  }
  getOrCreateJournal(stream, touchCfg) {
    const existing = this.journals.get(stream);
    if (existing)
      return existing;
    const mem = touchCfg.memory ?? {};
    const j = new TouchJournal({
      bucketMs: mem.bucketMs ?? 100,
      filterPow2: mem.filterPow2 ?? 22,
      k: mem.k ?? 4,
      pendingMaxKeys: mem.pendingMaxKeys ?? 1e5,
      keyIndexMaxKeys: mem.keyIndexMaxKeys ?? 32
    });
    this.journals.set(stream, j);
    return j;
  }
  computeAdaptiveCoalesceMs(touchCfg, lagAtStart, hasAnyWaiters) {
    const maxCoalesceMs = Math.max(1, Math.floor(touchCfg.memory?.bucketMs ?? 100));
    if (!hasAnyWaiters)
      return maxCoalesceMs;
    const lagNum = lagAtStart > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(lagAtStart);
    if (lagNum <= 0)
      return Math.min(maxCoalesceMs, 10);
    if (lagNum <= 5000)
      return Math.min(maxCoalesceMs, 50);
    return maxCoalesceMs;
  }
  getJournalIfExists(stream) {
    return this.journals.get(stream) ?? null;
  }
  computeSuppressFineDueToLag(stream, touchCfg, lagAtStart, hasFineDemand) {
    if (!hasFineDemand) {
      this.fineLagCoarseOnlyByStream.set(stream, false);
      return false;
    }
    const degradeRaw = Math.max(0, Math.floor(touchCfg.lagDegradeFineTouchesAtSourceOffsets ?? 5000));
    if (degradeRaw <= 0) {
      this.fineLagCoarseOnlyByStream.set(stream, false);
      return false;
    }
    const recoverRaw = Math.max(0, Math.floor(touchCfg.lagRecoverFineTouchesAtSourceOffsets ?? 1000));
    const recover = Math.min(degradeRaw, recoverRaw);
    const lag = lagAtStart > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(lagAtStart);
    const prev = this.fineLagCoarseOnlyByStream.get(stream) ?? false;
    let next = prev;
    if (!prev && lag >= degradeRaw)
      next = true;
    else if (prev && lag <= recover)
      next = false;
    this.fineLagCoarseOnlyByStream.set(stream, next);
    return next;
  }
  prioritizeStreamsForProcessing(ordered, nowMs) {
    if (ordered.length <= 1)
      return ordered;
    const hot = [];
    const cold = [];
    for (const stream of ordered) {
      let hasActiveWaiters = false;
      const regRes = this.registry.getRegistryResult(stream);
      if (Result15.isError(regRes)) {
        hasActiveWaiters = false;
      } else {
        const reg = regRes.value;
        if (isTouchEnabled(reg.interpreter)) {
          const snap = this.getHotFineSnapshot(stream, reg.interpreter.touch, nowMs);
          hasActiveWaiters = snap.fineWaitersActive + snap.coarseWaitersActive > 0;
        }
      }
      if (hasActiveWaiters)
        hot.push(stream);
      else
        cold.push(stream);
    }
    if (hot.length === 0)
      return ordered;
    return hot.concat(cold);
  }
  coalesceRestrictedTemplateTouches(stream, touchCfg, touches) {
    const bucketMs = Math.max(1, Math.floor(touchCfg.memory?.bucketMs ?? 100));
    const bucketId = Math.floor(Date.now() / bucketMs);
    let state = this.restrictedTemplateBucketStateByStream.get(stream);
    if (!state || state.bucketId !== bucketId) {
      state = { bucketId, templateKeyIds: new Set };
      this.restrictedTemplateBucketStateByStream.set(stream, state);
    }
    const out = [];
    let dropped = 0;
    for (const touch of touches) {
      if (touch.kind !== "template") {
        out.push(touch);
        continue;
      }
      const keyId = touch.keyId >>> 0;
      if (state.templateKeyIds.has(keyId)) {
        dropped += 1;
        continue;
      }
      state.templateKeyIds.add(keyId);
      out.push(touch);
    }
    return { touches: out, dropped };
  }
  getHotFineSnapshot(stream, touchCfg, nowMs) {
    const state = this.sweepHotFineState(stream, touchCfg, nowMs, false);
    if (!state) {
      return {
        hotTemplateIdsForWorker: null,
        hotKeyActiveSet: null,
        hotKeyGraceSet: null,
        hotTemplateActiveCount: 0,
        hotTemplateGraceCount: 0,
        hotKeyActiveCount: 0,
        hotKeyGraceCount: 0,
        hotTemplateCount: 0,
        hotKeyCount: 0,
        fineWaitersActive: 0,
        coarseWaitersActive: 0,
        broadFineWaitersActive: 0,
        templateFilteringEnabled: false,
        keyFilteringEnabled: true
      };
    }
    const hotTemplateActiveCount = state.templateActiveCountsById.size;
    const hotTemplateGraceCount = state.templateGraceExpiryMsById.size;
    const hotKeyActiveCount = state.keyActiveCountsById.size;
    const hotKeyGraceCount = state.keyGraceExpiryMsById.size;
    const hotTemplateCount = hotTemplateActiveCount + hotTemplateGraceCount;
    const hotKeyCount = hotKeyActiveCount + hotKeyGraceCount;
    const templateFilteringEnabled = !state.templatesOverCapacity && hotTemplateCount > 0;
    const keyFilteringEnabled = !state.keysOverCapacity && state.broadFineWaitersActive === 0;
    const hotTemplateIdsForWorker = templateFilteringEnabled ? Array.from(new Set([...state.templateActiveCountsById.keys(), ...state.templateGraceExpiryMsById.keys()])) : null;
    return {
      hotTemplateIdsForWorker,
      hotKeyActiveSet: keyFilteringEnabled ? state.keyActiveCountsById : null,
      hotKeyGraceSet: keyFilteringEnabled ? state.keyGraceExpiryMsById : null,
      hotTemplateActiveCount,
      hotTemplateGraceCount,
      hotKeyActiveCount,
      hotKeyGraceCount,
      hotTemplateCount,
      hotKeyCount,
      fineWaitersActive: state.fineWaitersActive,
      coarseWaitersActive: state.coarseWaitersActive,
      broadFineWaitersActive: state.broadFineWaitersActive,
      templateFilteringEnabled,
      keyFilteringEnabled
    };
  }
  getOrCreateHotFineState(stream) {
    const existing = this.hotFineByStream.get(stream);
    if (existing)
      return existing;
    const created = {
      keyActiveCountsById: new Map,
      keyGraceExpiryMsById: new Map,
      templateActiveCountsById: new Map,
      templateGraceExpiryMsById: new Map,
      fineWaitersActive: 0,
      coarseWaitersActive: 0,
      broadFineWaitersActive: 0,
      nextSweepAtMs: 0,
      keysOverCapacity: false,
      templatesOverCapacity: false
    };
    this.hotFineByStream.set(stream, created);
    return created;
  }
  sweepHotFineState(stream, touchCfg, nowMs, force) {
    const state = this.hotFineByStream.get(stream);
    if (!state)
      return null;
    if (!force && nowMs < state.nextSweepAtMs)
      return state;
    const limits = this.getHotFineLimits(touchCfg);
    for (const [k, exp] of state.keyGraceExpiryMsById.entries()) {
      if (exp <= nowMs)
        state.keyGraceExpiryMsById.delete(k);
    }
    for (const [tpl, exp] of state.templateGraceExpiryMsById.entries()) {
      if (exp <= nowMs)
        state.templateGraceExpiryMsById.delete(tpl);
    }
    if (state.keyActiveCountsById.size + state.keyGraceExpiryMsById.size < limits.maxKeys)
      state.keysOverCapacity = false;
    if (state.templateActiveCountsById.size + state.templateGraceExpiryMsById.size < limits.maxTemplates)
      state.templatesOverCapacity = false;
    if (state.keyActiveCountsById.size === 0 && state.keyGraceExpiryMsById.size === 0 && state.templateActiveCountsById.size === 0 && state.templateGraceExpiryMsById.size === 0 && state.fineWaitersActive <= 0 && state.coarseWaitersActive <= 0 && state.broadFineWaitersActive <= 0) {
      this.hotFineByStream.delete(stream);
      return null;
    }
    const sweepEveryMs = Math.max(250, Math.min(limits.keyGraceMs, limits.templateGraceMs, 2000));
    state.nextSweepAtMs = nowMs + sweepEveryMs;
    return state;
  }
  getHotFineLimits(touchCfg) {
    const mem = touchCfg.memory ?? {};
    return {
      keyGraceMs: Math.max(1, Math.floor(mem.hotKeyTtlMs ?? 1e4)),
      templateGraceMs: Math.max(1, Math.floor(mem.hotTemplateTtlMs ?? 1e4)),
      maxKeys: Math.max(1, Math.floor(mem.hotMaxKeys ?? 1e6)),
      maxTemplates: Math.max(1, Math.floor(mem.hotMaxTemplates ?? 4096))
    };
  }
  acquireHotKey(state, keyId, maxKeys) {
    const prev = state.keyActiveCountsById.get(keyId);
    if (prev != null) {
      state.keyActiveCountsById.set(keyId, prev + 1);
      state.keyGraceExpiryMsById.delete(keyId);
      return true;
    }
    if (state.keyActiveCountsById.size + state.keyGraceExpiryMsById.size >= maxKeys) {
      state.keysOverCapacity = true;
      return false;
    }
    state.keyActiveCountsById.set(keyId, 1);
    state.keyGraceExpiryMsById.delete(keyId);
    return true;
  }
  acquireHotTemplate(state, templateId, maxTemplates) {
    const prev = state.templateActiveCountsById.get(templateId);
    if (prev != null) {
      state.templateActiveCountsById.set(templateId, prev + 1);
      state.templateGraceExpiryMsById.delete(templateId);
      return true;
    }
    if (state.templateActiveCountsById.size + state.templateGraceExpiryMsById.size >= maxTemplates) {
      state.templatesOverCapacity = true;
      return false;
    }
    state.templateActiveCountsById.set(templateId, 1);
    state.templateGraceExpiryMsById.delete(templateId);
    return true;
  }
  releaseHotKey(state, keyId, nowMs, keyGraceMs, maxKeys) {
    const prev = state.keyActiveCountsById.get(keyId);
    if (prev == null)
      return;
    if (prev > 1) {
      state.keyActiveCountsById.set(keyId, prev - 1);
      return;
    }
    state.keyActiveCountsById.delete(keyId);
    if (keyGraceMs <= 0) {
      state.keyGraceExpiryMsById.delete(keyId);
      return;
    }
    if (state.keyActiveCountsById.size + state.keyGraceExpiryMsById.size >= maxKeys) {
      state.keysOverCapacity = true;
      return;
    }
    state.keyGraceExpiryMsById.set(keyId, nowMs + keyGraceMs);
  }
  releaseHotTemplate(state, templateId, nowMs, templateGraceMs, maxTemplates) {
    const prev = state.templateActiveCountsById.get(templateId);
    if (prev == null)
      return;
    if (prev > 1) {
      state.templateActiveCountsById.set(templateId, prev - 1);
      return;
    }
    state.templateActiveCountsById.delete(templateId);
    if (templateGraceMs <= 0) {
      state.templateGraceExpiryMsById.delete(templateId);
      return;
    }
    if (state.templateActiveCountsById.size + state.templateGraceExpiryMsById.size >= maxTemplates) {
      state.templatesOverCapacity = true;
      return;
    }
    state.templateGraceExpiryMsById.set(templateId, nowMs + templateGraceMs);
  }
  reserveFineTokens(stream, touchCfg, wanted, nowMs) {
    const rate = Math.max(0, Math.floor(touchCfg.fineTokensPerSecond ?? 200000));
    const burst = Math.max(0, Math.floor(touchCfg.fineBurstTokens ?? 400000));
    if (wanted <= 0)
      return { granted: 0, tokenLimited: false, refund: () => {} };
    if (rate <= 0 || burst <= 0)
      return { granted: 0, tokenLimited: true, refund: () => {} };
    const b = this.fineTokenBucketsByStream.get(stream) ?? { tokens: burst, lastRefillMs: nowMs };
    const elapsedMs = Math.max(0, nowMs - b.lastRefillMs);
    if (elapsedMs > 0) {
      const refill = elapsedMs * rate / 1000;
      b.tokens = Math.min(burst, b.tokens + refill);
      b.lastRefillMs = nowMs;
    }
    const granted = Math.max(0, Math.min(wanted, Math.floor(b.tokens)));
    b.tokens = Math.max(0, b.tokens - granted);
    this.fineTokenBucketsByStream.set(stream, b);
    return {
      granted,
      tokenLimited: granted < wanted,
      refund: (used) => {
        const u = Math.max(0, Math.floor(used));
        if (u >= granted)
          return;
        const addBack = granted - u;
        const cur = this.fineTokenBucketsByStream.get(stream);
        if (!cur)
          return;
        cur.tokens = Math.min(burst, cur.tokens + addBack);
        this.fineTokenBucketsByStream.set(stream, cur);
      }
    };
  }
  getOrCreateRuntimeTotals(stream) {
    const existing = this.runtimeTotalsByStream.get(stream);
    if (existing)
      return existing;
    const created = {
      scanRowsTotal: 0,
      scanBatchesTotal: 0,
      scannedButEmitted0BatchesTotal: 0,
      interpretedThroughDeltaTotal: 0,
      touchesEmittedTotal: 0,
      touchesTableTotal: 0,
      touchesTemplateTotal: 0,
      fineTouchesDroppedDueToBudgetTotal: 0,
      fineTouchesSkippedColdTemplateTotal: 0,
      fineTouchesSkippedColdKeyTotal: 0,
      fineTouchesSkippedTemplateBucketTotal: 0,
      waitTouchedTotal: 0,
      waitTimeoutTotal: 0,
      waitStaleTotal: 0
    };
    this.runtimeTotalsByStream.set(stream, created);
    return created;
  }
  rangeLikelyHasRows(stream, fromOffset, toOffset) {
    try {
      const it = this.db.iterWalRange(stream, fromOffset, toOffset);
      const first = it.next();
      return !first.done;
    } catch {
      return false;
    }
  }
}

class FailureTracker {
  cache;
  constructor(maxEntries) {
    this.cache = new LruCache(maxEntries);
  }
  shouldSkip(stream) {
    const item = this.cache.get(stream);
    if (!item)
      return false;
    if (Date.now() >= item.untilMs) {
      this.cache.delete(stream);
      return false;
    }
    return true;
  }
  recordFailure(stream) {
    const now = Date.now();
    const item = this.cache.get(stream) ?? { attempts: 0, untilMs: now };
    item.attempts += 1;
    const backoff = Math.min(60000, 500 * 2 ** (item.attempts - 1));
    item.untilMs = now + backoff;
    this.cache.set(stream, item);
  }
  recordSuccess(stream) {
    this.cache.delete(stream);
  }
}

// src/touch/touch_key_id.ts
import { Result as Result16 } from "better-result";
function touchKeyIdFromRoutingKeyResult(key) {
  const s = key.trim().toLowerCase();
  if (/^[0-9a-f]{16}$/.test(s)) {
    return Result16.ok(Number.parseInt(s.slice(8), 16) >>> 0);
  }
  return xxh32Result(s);
}

// src/app_core.ts
import { Result as Result17 } from "better-result";
function withNosniff(headers = {}) {
  return {
    "x-content-type-options": "nosniff",
    ...headers
  };
}
function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...withNosniff(headers)
    }
  });
}
function internalError(message = "internal server error") {
  return json(500, { error: { code: "internal", message } });
}
function badRequest(msg) {
  return json(400, { error: { code: "bad_request", message: msg } });
}
function notFound(msg = "not_found") {
  return json(404, { error: { code: "not_found", message: msg } });
}
function readerErrorResponse(err) {
  if (err.kind === "not_found")
    return notFound();
  if (err.kind === "gone")
    return notFound("stream expired");
  if (err.kind === "internal")
    return internalError();
  return badRequest(err.message);
}
function schemaMutationErrorResponse(err) {
  if (err.kind === "version_mismatch")
    return conflict(err.message);
  return badRequest(err.message);
}
function schemaReadErrorResponse(_err) {
  return internalError();
}
function conflict(msg, headers = {}) {
  return json(409, { error: { code: "conflict", message: msg } }, headers);
}
function tooLarge(msg) {
  return json(413, { error: { code: "payload_too_large", message: msg } });
}
function normalizeContentType(value) {
  if (!value)
    return null;
  const base = value.split(";")[0]?.trim().toLowerCase();
  return base ? base : null;
}
function isJsonContentType(value) {
  return normalizeContentType(value) === "application/json";
}
function isTextContentType(value) {
  const norm = normalizeContentType(value);
  return norm === "application/json" || norm != null && norm.startsWith("text/");
}
function parseStreamClosedHeader(value) {
  return value != null && value.trim().toLowerCase() === "true";
}
function parseStreamSeqHeader(value) {
  if (value == null)
    return Result17.ok(null);
  const v = value.trim();
  if (v.length === 0)
    return Result17.err({ message: "invalid Stream-Seq" });
  return Result17.ok(v);
}
function parseStreamTtlSeconds(value) {
  const s = value.trim();
  if (/^(0|[1-9][0-9]*)$/.test(s))
    return Result17.ok(Number(s));
  if (/^(0|[1-9][0-9]*)(ms|s|m|h|d)$/.test(s)) {
    const msRes = parseDurationMsResult(s);
    if (Result17.isError(msRes))
      return Result17.err({ message: msRes.error.message });
    const ms = msRes.value;
    if (ms % 1000 !== 0)
      return Result17.err({ message: "invalid Stream-TTL" });
    return Result17.ok(Math.floor(ms / 1000));
  }
  return Result17.err({ message: "invalid Stream-TTL" });
}
function parseNonNegativeInt(value) {
  if (!/^[0-9]+$/.test(value))
    return null;
  const n = Number(value);
  if (!Number.isFinite(n))
    return null;
  return n;
}
function splitSseLines(data) {
  if (data === "")
    return [""];
  return data.split(/\r\n|\r|\n/);
}
function encodeSseEvent(eventType, data) {
  const lines = splitSseLines(data);
  let out = `event: ${eventType}
`;
  for (const line of lines) {
    out += `data:${line}
`;
  }
  out += `
`;
  return out;
}
function computeCursor(nowMs, provided) {
  let cursor = Math.floor(nowMs / 1000);
  if (provided && /^[0-9]+$/.test(provided)) {
    const n = Number(provided);
    if (Number.isFinite(n) && n >= cursor)
      cursor = n + 1;
  }
  return String(cursor);
}
function concatPayloads(parts) {
  let total = 0;
  for (const p of parts)
    total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}
function keyBytesFromString(s) {
  if (s == null)
    return null;
  return new TextEncoder().encode(s);
}
function extractRoutingKey(reg, value) {
  if (!reg.routingKey)
    return Result17.ok(null);
  const { jsonPointer, required } = reg.routingKey;
  const resolvedRes = resolvePointerResult(value, jsonPointer);
  if (Result17.isError(resolvedRes))
    return Result17.err({ message: resolvedRes.error.message });
  const resolved = resolvedRes.value;
  if (!resolved.exists) {
    if (required)
      return Result17.err({ message: "routing key missing" });
    return Result17.ok(null);
  }
  if (typeof resolved.value !== "string")
    return Result17.err({ message: "routing key must be string" });
  return Result17.ok(keyBytesFromString(resolved.value));
}
function schemaVersionForOffset(reg, offset) {
  if (!reg.boundaries || reg.boundaries.length === 0)
    return 0;
  const off = Number(offset);
  let version = 0;
  for (const b of reg.boundaries) {
    if (b.offset <= off)
      version = b.version;
    else
      break;
  }
  return version;
}
function createAppCore(cfg, opts) {
  mkdirSync(cfg.rootDir, { recursive: true });
  cleanupTempSegments(cfg.rootDir);
  const db = new SqliteDurableStore(cfg.dbPath, { cacheBytes: cfg.sqliteCacheBytes });
  db.resetSegmentInProgress();
  const stats = opts.stats;
  const backpressure = cfg.localBacklogMaxBytes > 0 ? new BackpressureGate(cfg.localBacklogMaxBytes, db.sumPendingBytes() + db.sumPendingSegmentBytes()) : undefined;
  const memory = new MemoryGuard(cfg.memoryLimitBytes, {
    onSample: (rss, overLimit) => {
      metrics.record("process.rss.bytes", rss, "bytes");
      if (overLimit)
        metrics.record("process.rss.over_limit", 1, "count");
    },
    heapSnapshotPath: `${cfg.rootDir}/heap.heapsnapshot`
  });
  memory.start();
  const metrics = new Metrics;
  const ingest = new IngestQueue(cfg, db, stats, backpressure, memory, metrics);
  const notifier = new StreamNotifier;
  const registry = new SchemaRegistryStore(db);
  const touch = new TouchInterpreterManager(cfg, db, ingest, notifier, registry, backpressure);
  const runtime = opts.createRuntime({
    config: cfg,
    db,
    ingest,
    notifier,
    registry,
    touch,
    stats,
    backpressure,
    memory,
    metrics
  });
  const { store, reader, segmenter, uploader, indexer, uploadSchemaRegistry } = runtime;
  const metricsEmitter = new MetricsEmitter(metrics, ingest, cfg.metricsFlushIntervalMs);
  const expirySweeper = new ExpirySweeper(cfg, db);
  db.ensureStream("__stream_metrics__", { contentType: "application/json" });
  runtime.start();
  metricsEmitter.start();
  expirySweeper.start();
  touch.start();
  const buildJsonRows = (stream, bodyBytes, routingKeyHeader, allowEmptyArray) => {
    const regRes = registry.getRegistryResult(stream);
    if (Result17.isError(regRes)) {
      return Result17.err({ status: 500, message: regRes.error.message });
    }
    const reg = regRes.value;
    const text = new TextDecoder().decode(bodyBytes);
    let arr;
    try {
      arr = JSON.parse(text);
    } catch {
      return Result17.err({ status: 400, message: "invalid JSON" });
    }
    if (!Array.isArray(arr))
      arr = [arr];
    if (arr.length === 0 && !allowEmptyArray)
      return Result17.err({ status: 400, message: "empty JSON array" });
    if (reg.routingKey && routingKeyHeader) {
      return Result17.err({ status: 400, message: "Stream-Key not allowed when routingKey is configured" });
    }
    const validator = reg.currentVersion > 0 ? registry.getValidatorForVersion(reg, reg.currentVersion) : null;
    if (reg.currentVersion > 0 && !validator) {
      return Result17.err({ status: 500, message: "schema validator missing" });
    }
    const rows = [];
    for (const v of arr) {
      if (validator && !validator(v)) {
        const msg = validator.errors ? validator.errors.map((e) => e.message).join("; ") : "schema validation failed";
        return Result17.err({ status: 400, message: msg });
      }
      const rkRes = reg.routingKey ? extractRoutingKey(reg, v) : Result17.ok(keyBytesFromString(routingKeyHeader));
      if (Result17.isError(rkRes))
        return Result17.err({ status: 400, message: rkRes.error.message });
      rows.push({
        routingKey: rkRes.value,
        contentType: "application/json",
        payload: new TextEncoder().encode(JSON.stringify(v))
      });
    }
    return Result17.ok({ rows });
  };
  const buildAppendRowsResult = (stream, bodyBytes, contentType, routingKeyHeader, allowEmptyJsonArray) => {
    if (isJsonContentType(contentType)) {
      return buildJsonRows(stream, bodyBytes, routingKeyHeader, allowEmptyJsonArray);
    }
    const regRes = registry.getRegistryResult(stream);
    if (Result17.isError(regRes))
      return Result17.err({ status: 500, message: regRes.error.message });
    const reg = regRes.value;
    if (reg.currentVersion > 0)
      return Result17.err({ status: 400, message: "stream requires JSON" });
    return Result17.ok({
      rows: [
        {
          routingKey: keyBytesFromString(routingKeyHeader),
          contentType,
          payload: bodyBytes
        }
      ]
    });
  };
  const enqueueAppend = (args) => ingest.append({
    stream: args.stream,
    baseAppendMs: args.baseAppendMs,
    rows: args.rows,
    contentType: args.contentType,
    streamSeq: args.streamSeq,
    producer: args.producer,
    close: args.close
  });
  const recordAppendOutcome = (args) => {
    if (args.appendedRows > 0) {
      metrics.recordAppend(args.metricsBytes, args.appendedRows);
      notifier.notify(args.stream, args.lastOffset);
      touch.notify(args.stream);
    }
    if (stats) {
      if (args.touched)
        stats.recordStreamTouched(args.stream);
      if (args.appendedRows > 0)
        stats.recordIngested(args.ingestedBytes);
    }
    if (args.closed)
      notifier.notifyClose(args.stream);
  };
  const decodeJsonRecords = (stream, records) => {
    const regRes = registry.getRegistryResult(stream);
    if (Result17.isError(regRes))
      return Result17.err({ status: 500, message: regRes.error.message });
    const reg = regRes.value;
    const values = [];
    for (const r of records) {
      try {
        const s = new TextDecoder().decode(r.payload);
        let value = JSON.parse(s);
        if (reg.currentVersion > 0) {
          const version = schemaVersionForOffset(reg, r.offset);
          if (version < reg.currentVersion) {
            const chainRes = registry.getLensChainResult(reg, version, reg.currentVersion);
            if (Result17.isError(chainRes))
              return Result17.err({ status: 500, message: chainRes.error.message });
            const chain = chainRes.value;
            const transformedRes = applyLensChainResult(chain, value);
            if (Result17.isError(transformedRes))
              return Result17.err({ status: 400, message: transformedRes.error.message });
            value = transformedRes.value;
          }
        }
        values.push(value);
      } catch (e) {
        return Result17.err({ status: 400, message: String(e?.message ?? e) });
      }
    }
    return Result17.ok({ values });
  };
  let closing = false;
  const fetch2 = async (req) => {
    if (closing) {
      return json(503, { error: { code: "unavailable", message: "server shutting down" } });
    }
    try {
      let url;
      try {
        url = new URL(req.url, "http://localhost");
      } catch {
        return badRequest("invalid url");
      }
      const path = url.pathname;
      if (path === "/health") {
        return json(200, { ok: true });
      }
      if (path === "/metrics") {
        return json(200, metrics.snapshot());
      }
      const rejectIfMemoryLimited = () => {
        if (!memory || memory.shouldAllow())
          return null;
        memory.maybeGc("memory limit");
        memory.maybeHeapSnapshot("memory limit");
        metrics.record("tieredstore.backpressure.over_limit", 1, "count", { reason: "memory" });
        return json(429, { error: { code: "overloaded", message: "ingest queue full" } });
      };
      if (req.method === "GET" && path === "/v1/streams") {
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const rows = db.listStreams(Math.max(0, Math.min(limit, 1000)), Math.max(0, offset));
        const out = rows.map((r) => ({
          name: r.stream,
          created_at: new Date(Number(r.created_at_ms)).toISOString(),
          expires_at: r.expires_at_ms == null ? null : new Date(Number(r.expires_at_ms)).toISOString(),
          epoch: r.epoch,
          next_offset: r.next_offset.toString(),
          sealed_through: r.sealed_through.toString(),
          uploaded_through: r.uploaded_through.toString()
        }));
        return json(200, out);
      }
      const streamPrefix = "/v1/stream/";
      if (path.startsWith(streamPrefix)) {
        const rawRest = path.slice(streamPrefix.length);
        const rest = rawRest.replace(/\/+$/, "");
        if (rest.length === 0)
          return badRequest("missing stream name");
        const segments = rest.split("/");
        let isSchema = false;
        let pathKeyParam = null;
        let touchMode = null;
        if (segments[segments.length - 1] === "_schema") {
          isSchema = true;
          segments.pop();
        } else if (segments.length >= 3 && segments[segments.length - 3] === "touch" && segments[segments.length - 2] === "templates" && segments[segments.length - 1] === "activate") {
          touchMode = { kind: "templates_activate" };
          segments.splice(segments.length - 3, 3);
        } else if (segments.length >= 2 && segments[segments.length - 2] === "touch" && segments[segments.length - 1] === "meta") {
          touchMode = { kind: "meta" };
          segments.splice(segments.length - 2, 2);
        } else if (segments.length >= 2 && segments[segments.length - 2] === "touch" && segments[segments.length - 1] === "wait") {
          touchMode = { kind: "wait" };
          segments.splice(segments.length - 2, 2);
        } else if (segments.length >= 2 && segments[segments.length - 2] === "pk") {
          pathKeyParam = decodeURIComponent(segments[segments.length - 1]);
          segments.splice(segments.length - 2, 2);
        }
        const streamPart = segments.join("/");
        if (streamPart.length === 0)
          return badRequest("missing stream name");
        const stream = decodeURIComponent(streamPart);
        if (isSchema) {
          const srow = db.getStream(stream);
          if (!srow || db.isDeleted(srow))
            return notFound();
          if (srow.expires_at_ms != null && db.nowMs() > srow.expires_at_ms)
            return notFound("stream expired");
          if (req.method === "GET") {
            const regRes = registry.getRegistryResult(stream);
            if (Result17.isError(regRes))
              return schemaReadErrorResponse(regRes.error);
            return json(200, regRes.value);
          }
          if (req.method === "POST") {
            let body;
            try {
              body = await req.json();
            } catch {
              return badRequest("schema update must be valid JSON");
            }
            let update = body;
            const isSchemaObject = update && (update.schema === true || update.schema === false || typeof update.schema === "object" && update.schema !== null && !Array.isArray(update.schema));
            if (!isSchemaObject && update && typeof update === "object" && update.schemas && typeof update.schemas === "object") {
              const versions = Object.keys(update.schemas).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0);
              const currentVersion = typeof update.currentVersion === "number" && Number.isFinite(update.currentVersion) ? update.currentVersion : versions.length > 0 ? Math.max(...versions) : null;
              if (currentVersion != null) {
                const schema = update.schemas[String(currentVersion)];
                const lens = update.lens ?? (update.lenses && typeof update.lenses === "object" ? update.lenses[String(currentVersion - 1)] : undefined);
                update = {
                  schema,
                  lens,
                  routingKey: update.routingKey,
                  interpreter: update.interpreter
                };
              }
            }
            if (update && typeof update === "object") {
              if (update.schema === null) {
                delete update.schema;
              }
              if (update.routingKey === undefined) {
                const raw = update;
                const candidate = raw.routing_key ?? raw.routingKeyPointer ?? raw.routing_key_pointer ?? raw.routingKey;
                if (typeof candidate === "string") {
                  update.routingKey = { jsonPointer: candidate, required: true };
                } else if (candidate && typeof candidate === "object") {
                  const jsonPointer = candidate.jsonPointer ?? candidate.json_pointer;
                  if (typeof jsonPointer === "string") {
                    update.routingKey = {
                      jsonPointer,
                      required: typeof candidate.required === "boolean" ? candidate.required : true
                    };
                  }
                }
              } else if (update.routingKey && typeof update.routingKey === "object") {
                const rk = update.routingKey;
                if (rk.jsonPointer === undefined && typeof rk.json_pointer === "string") {
                  update.routingKey = {
                    jsonPointer: rk.json_pointer,
                    required: typeof rk.required === "boolean" ? rk.required : true
                  };
                }
              }
            }
            if (update.schema === undefined && update.routingKey !== undefined && update.interpreter === undefined) {
              const regRes2 = registry.updateRoutingKeyResult(stream, update.routingKey ?? null);
              if (Result17.isError(regRes2))
                return schemaMutationErrorResponse(regRes2.error);
              try {
                await uploadSchemaRegistry(stream, regRes2.value);
              } catch {
                return json(500, { error: { code: "internal", message: "schema upload failed" } });
              }
              return json(200, regRes2.value);
            }
            if (update.schema === undefined && update.interpreter !== undefined && update.routingKey === undefined) {
              const regRes2 = registry.updateInterpreterResult(stream, update.interpreter ?? null);
              if (Result17.isError(regRes2))
                return schemaMutationErrorResponse(regRes2.error);
              try {
                await uploadSchemaRegistry(stream, regRes2.value);
              } catch {
                return json(500, { error: { code: "internal", message: "schema upload failed" } });
              }
              return json(200, regRes2.value);
            }
            if (update.schema === undefined && update.routingKey !== undefined && update.interpreter !== undefined) {
              const routingRes = registry.updateRoutingKeyResult(stream, update.routingKey ?? null);
              if (Result17.isError(routingRes))
                return schemaMutationErrorResponse(routingRes.error);
              const interpreterRes = registry.updateInterpreterResult(stream, update.interpreter ?? null);
              if (Result17.isError(interpreterRes))
                return schemaMutationErrorResponse(interpreterRes.error);
              try {
                await uploadSchemaRegistry(stream, interpreterRes.value);
              } catch {
                return json(500, { error: { code: "internal", message: "schema upload failed" } });
              }
              return json(200, interpreterRes.value);
            }
            const regRes = registry.updateRegistryResult(stream, srow, update);
            if (Result17.isError(regRes))
              return schemaMutationErrorResponse(regRes.error);
            try {
              await uploadSchemaRegistry(stream, regRes.value);
            } catch {
              return json(500, { error: { code: "internal", message: "schema upload failed" } });
            }
            return json(200, regRes.value);
          }
          return badRequest("unsupported method");
        }
        if (touchMode) {
          const srow = db.getStream(stream);
          if (!srow || db.isDeleted(srow))
            return notFound();
          if (srow.expires_at_ms != null && db.nowMs() > srow.expires_at_ms)
            return notFound("stream expired");
          const regRes = registry.getRegistryResult(stream);
          if (Result17.isError(regRes))
            return schemaReadErrorResponse(regRes.error);
          const reg = regRes.value;
          if (!isTouchEnabled(reg.interpreter))
            return notFound("touch not enabled");
          const touchCfg = reg.interpreter.touch;
          if (touchMode.kind === "templates_activate") {
            if (req.method !== "POST")
              return badRequest("unsupported method");
            let body;
            try {
              body = await req.json();
            } catch {
              return badRequest("activate body must be valid JSON");
            }
            const templatesRaw = body?.templates;
            if (!Array.isArray(templatesRaw) || templatesRaw.length === 0) {
              return badRequest("activate.templates must be a non-empty array");
            }
            if (templatesRaw.length > 256)
              return badRequest("activate.templates too large (max 256)");
            const ttlRaw = body?.inactivityTtlMs;
            const inactivityTtlMs = ttlRaw === undefined ? touchCfg.templates?.defaultInactivityTtlMs ?? 60 * 60 * 1000 : typeof ttlRaw === "number" && Number.isFinite(ttlRaw) && ttlRaw >= 0 ? Math.floor(ttlRaw) : null;
            if (inactivityTtlMs == null)
              return badRequest("activate.inactivityTtlMs must be a non-negative number (ms)");
            const templates = [];
            for (const t of templatesRaw) {
              const entity = typeof t?.entity === "string" ? t.entity.trim() : "";
              const fieldsRaw = t?.fields;
              if (entity === "" || !Array.isArray(fieldsRaw) || fieldsRaw.length === 0 || fieldsRaw.length > 3)
                continue;
              const fields = [];
              for (const f of fieldsRaw) {
                const name = typeof f?.name === "string" ? f.name.trim() : "";
                const encoding = f?.encoding;
                if (name === "")
                  continue;
                fields.push({ name, encoding });
              }
              if (fields.length !== fieldsRaw.length)
                continue;
              templates.push({ entity, fields });
            }
            if (templates.length !== templatesRaw.length)
              return badRequest("activate.templates contains invalid template definitions");
            const limits = {
              maxActiveTemplatesPerStream: touchCfg.templates?.maxActiveTemplatesPerStream ?? 2048,
              maxActiveTemplatesPerEntity: touchCfg.templates?.maxActiveTemplatesPerEntity ?? 256
            };
            const activeFromTouchOffset = touch.getOrCreateJournal(stream, touchCfg).getCursor();
            const res = touch.activateTemplates({
              stream,
              touchCfg,
              baseStreamNextOffset: srow.next_offset,
              activeFromTouchOffset,
              templates,
              inactivityTtlMs
            });
            return json(200, { activated: res.activated, denied: res.denied, limits });
          }
          if (touchMode.kind === "meta") {
            if (req.method !== "GET")
              return badRequest("unsupported method");
            let activeTemplates = 0;
            try {
              const row = db.db.query(`SELECT COUNT(*) as cnt FROM live_templates WHERE stream=? AND state='active';`).get(stream);
              activeTemplates = Number(row?.cnt ?? 0);
            } catch {
              activeTemplates = 0;
            }
            const meta = touch.getOrCreateJournal(stream, touchCfg).getMeta();
            const runtime2 = touch.getTouchRuntimeSnapshot({ stream, touchCfg });
            const interp = db.getStreamInterpreter(stream);
            return json(200, {
              ...meta,
              coarseIntervalMs: touchCfg.coarseIntervalMs ?? 100,
              touchCoalesceWindowMs: touchCfg.touchCoalesceWindowMs ?? 100,
              activeTemplates,
              lagSourceOffsets: runtime2.lagSourceOffsets,
              touchMode: runtime2.touchMode,
              walScannedThrough: interp ? encodeOffset(srow.epoch, interp.interpreted_through) : null,
              bucketMaxSourceOffsetSeq: meta.bucketMaxSourceOffsetSeq,
              hotFineKeys: runtime2.hotFineKeys,
              hotTemplates: runtime2.hotTemplates,
              hotFineKeysActive: runtime2.hotFineKeysActive,
              hotFineKeysGrace: runtime2.hotFineKeysGrace,
              hotTemplatesActive: runtime2.hotTemplatesActive,
              hotTemplatesGrace: runtime2.hotTemplatesGrace,
              fineWaitersActive: runtime2.fineWaitersActive,
              coarseWaitersActive: runtime2.coarseWaitersActive,
              broadFineWaitersActive: runtime2.broadFineWaitersActive,
              hotKeyFilteringEnabled: runtime2.hotKeyFilteringEnabled,
              hotTemplateFilteringEnabled: runtime2.hotTemplateFilteringEnabled,
              scanRowsTotal: runtime2.scanRowsTotal,
              scanBatchesTotal: runtime2.scanBatchesTotal,
              scannedButEmitted0BatchesTotal: runtime2.scannedButEmitted0BatchesTotal,
              interpretedThroughDeltaTotal: runtime2.interpretedThroughDeltaTotal,
              touchesEmittedTotal: runtime2.touchesEmittedTotal,
              touchesTableTotal: runtime2.touchesTableTotal,
              touchesTemplateTotal: runtime2.touchesTemplateTotal,
              fineTouchesDroppedDueToBudgetTotal: runtime2.fineTouchesDroppedDueToBudgetTotal,
              fineTouchesSkippedColdTemplateTotal: runtime2.fineTouchesSkippedColdTemplateTotal,
              fineTouchesSkippedColdKeyTotal: runtime2.fineTouchesSkippedColdKeyTotal,
              fineTouchesSkippedTemplateBucketTotal: runtime2.fineTouchesSkippedTemplateBucketTotal,
              waitTouchedTotal: runtime2.waitTouchedTotal,
              waitTimeoutTotal: runtime2.waitTimeoutTotal,
              waitStaleTotal: runtime2.waitStaleTotal,
              journalFlushesTotal: runtime2.journalFlushesTotal,
              journalNotifyWakeupsTotal: runtime2.journalNotifyWakeupsTotal,
              journalNotifyWakeMsTotal: runtime2.journalNotifyWakeMsTotal,
              journalNotifyWakeMsMax: runtime2.journalNotifyWakeMsMax,
              journalTimeoutsFiredTotal: runtime2.journalTimeoutsFiredTotal,
              journalTimeoutSweepMsTotal: runtime2.journalTimeoutSweepMsTotal
            });
          }
          if (touchMode.kind === "wait") {
            if (req.method !== "POST")
              return badRequest("unsupported method");
            const waitStartMs = Date.now();
            let body;
            try {
              body = await req.json();
            } catch {
              return badRequest("wait body must be valid JSON");
            }
            const keysRaw = body?.keys;
            const cursorRaw = body?.cursor;
            const timeoutMsRaw = body?.timeoutMs;
            if (keysRaw !== undefined && (!Array.isArray(keysRaw) || !keysRaw.every((k) => typeof k === "string" && k.trim() !== ""))) {
              return badRequest("wait.keys must be a non-empty string array when provided");
            }
            const keys = Array.isArray(keysRaw) ? Array.from(new Set(keysRaw.map((k) => k.trim()))) : [];
            if (keys.length > 1024)
              return badRequest("wait.keys too large (max 1024)");
            const keyIdsRaw = body?.keyIds;
            const keyIds = Array.isArray(keyIdsRaw) && keyIdsRaw.length > 0 ? Array.from(new Set(keyIdsRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 4294967295))).map((n) => n >>> 0) : [];
            if (Array.isArray(keyIdsRaw) && keyIds.length !== keyIdsRaw.length) {
              return badRequest("wait.keyIds must be a non-empty uint32 array when provided");
            }
            if (keys.length === 0 && keyIds.length === 0)
              return badRequest("wait requires keys or keyIds");
            if (keyIds.length > 1024)
              return badRequest("wait.keyIds too large (max 1024)");
            if (typeof cursorRaw !== "string" || cursorRaw.trim() === "")
              return badRequest("wait.cursor must be a non-empty string");
            const cursor = cursorRaw.trim();
            const timeoutMs = timeoutMsRaw === undefined ? 30000 : typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw) ? Math.max(0, Math.min(120000, timeoutMsRaw)) : null;
            if (timeoutMs == null)
              return badRequest("wait.timeoutMs must be a number (ms)");
            const templateIdsUsedRaw = body?.templateIdsUsed;
            if (Array.isArray(templateIdsUsedRaw) && !templateIdsUsedRaw.every((x) => typeof x === "string" && x.trim() !== "")) {
              return badRequest("wait.templateIdsUsed must be a string array");
            }
            const templateIdsUsed = Array.isArray(templateIdsUsedRaw) && templateIdsUsedRaw.length > 0 ? Array.from(new Set(templateIdsUsedRaw.map((s) => typeof s === "string" ? s.trim() : "").filter((s) => s !== ""))) : [];
            const interestModeRaw = body?.interestMode;
            if (interestModeRaw !== undefined && interestModeRaw !== "fine" && interestModeRaw !== "coarse") {
              return badRequest("wait.interestMode must be 'fine' or 'coarse'");
            }
            const interestMode = interestModeRaw === "coarse" ? "coarse" : "fine";
            if (interestMode === "fine" && templateIdsUsed.length > 0) {
              touch.heartbeatTemplates({ stream, touchCfg, templateIdsUsed });
            }
            const declareTemplatesRaw = body?.declareTemplates;
            if (Array.isArray(declareTemplatesRaw) && declareTemplatesRaw.length > 0) {
              if (declareTemplatesRaw.length > 256)
                return badRequest("wait.declareTemplates too large (max 256)");
              const ttlRaw = body?.inactivityTtlMs;
              const inactivityTtlMs = ttlRaw === undefined ? touchCfg.templates?.defaultInactivityTtlMs ?? 60 * 60 * 1000 : typeof ttlRaw === "number" && Number.isFinite(ttlRaw) && ttlRaw >= 0 ? Math.floor(ttlRaw) : null;
              if (inactivityTtlMs == null)
                return badRequest("wait.inactivityTtlMs must be a non-negative number (ms)");
              const templates = [];
              for (const t of declareTemplatesRaw) {
                const entity = typeof t?.entity === "string" ? t.entity.trim() : "";
                const fieldsRaw = t?.fields;
                if (entity === "" || !Array.isArray(fieldsRaw) || fieldsRaw.length === 0 || fieldsRaw.length > 3)
                  continue;
                const fields = [];
                for (const f of fieldsRaw) {
                  const name = typeof f?.name === "string" ? f.name.trim() : "";
                  const encoding = f?.encoding;
                  if (name === "")
                    continue;
                  fields.push({ name, encoding });
                }
                if (fields.length !== fieldsRaw.length)
                  continue;
                templates.push({ entity, fields });
              }
              if (templates.length !== declareTemplatesRaw.length)
                return badRequest("wait.declareTemplates contains invalid template definitions");
              const activeFromTouchOffset = touch.getOrCreateJournal(stream, touchCfg).getCursor();
              touch.activateTemplates({
                stream,
                touchCfg,
                baseStreamNextOffset: srow.next_offset,
                activeFromTouchOffset,
                templates,
                inactivityTtlMs
              });
            }
            const j = touch.getOrCreateJournal(stream, touchCfg);
            const runtime2 = touch.getTouchRuntimeSnapshot({ stream, touchCfg });
            let rawFineKeyIds = keyIds;
            if (keyIds.length === 0) {
              const parsedKeyIds = [];
              for (const key of keys) {
                const keyIdRes = touchKeyIdFromRoutingKeyResult(key);
                if (Result17.isError(keyIdRes))
                  return internalError();
                parsedKeyIds.push(keyIdRes.value);
              }
              rawFineKeyIds = parsedKeyIds;
            }
            const templateWaitKeyIds = templateIdsUsed.length > 0 ? Array.from(new Set(templateIdsUsed.map((templateId) => templateKeyIdFor(templateId) >>> 0))) : [];
            let waitKeyIds = rawFineKeyIds;
            let effectiveWaitKind = "fineKey";
            if (interestMode === "coarse") {
              effectiveWaitKind = "tableKey";
            } else if (runtime2.touchMode === "restricted" && templateIdsUsed.length > 0) {
              effectiveWaitKind = "templateKey";
            } else if (runtime2.touchMode === "coarseOnly" && templateIdsUsed.length > 0) {
              effectiveWaitKind = "tableKey";
            }
            if (effectiveWaitKind === "templateKey") {
              waitKeyIds = templateWaitKeyIds;
            } else if (effectiveWaitKind === "tableKey" && templateIdsUsed.length > 0) {
              const entities = touch.resolveTemplateEntitiesForWait({ stream, templateIdsUsed });
              waitKeyIds = Array.from(new Set(entities.map((entity) => tableKeyIdFor(entity) >>> 0)));
            }
            if (interestMode === "fine" && effectiveWaitKind === "fineKey" && templateWaitKeyIds.length > 0) {
              const merged = new Set;
              for (const keyId of waitKeyIds)
                merged.add(keyId >>> 0);
              for (const keyId of templateWaitKeyIds)
                merged.add(keyId >>> 0);
              waitKeyIds = Array.from(merged);
            }
            if (waitKeyIds.length === 0) {
              waitKeyIds = rawFineKeyIds;
              effectiveWaitKind = "fineKey";
            }
            const hotInterestKeyIds = interestMode === "fine" ? rawFineKeyIds : waitKeyIds;
            const releaseHotInterest = touch.beginHotWaitInterest({
              stream,
              touchCfg,
              keyIds: hotInterestKeyIds,
              templateIdsUsed,
              interestMode
            });
            try {
              let sinceGen;
              if (cursor === "now") {
                sinceGen = j.getGeneration();
              } else {
                const parsed = parseTouchCursor(cursor);
                if (!parsed)
                  return badRequest("wait.cursor must be in the form <epochHex>:<generation> or 'now'");
                if (parsed.epoch !== j.getEpoch()) {
                  const latencyMs2 = Date.now() - waitStartMs;
                  touch.recordWaitMetrics({ stream, touchCfg, keysCount: waitKeyIds.length, outcome: "stale", latencyMs: latencyMs2 });
                  return json(200, {
                    stale: true,
                    cursor: j.getCursor(),
                    epoch: j.getEpoch(),
                    generation: j.getGeneration(),
                    effectiveWaitKind,
                    bucketMaxSourceOffsetSeq: j.getLastFlushedSourceOffsetSeq().toString(),
                    flushAtMs: j.getLastFlushAtMs(),
                    bucketStartMs: j.getLastBucketStartMs(),
                    error: { code: "stale", message: "cursor epoch mismatch; rerun/re-subscribe and start from cursor" }
                  });
                }
                sinceGen = parsed.generation;
              }
              const nowGen = j.getGeneration();
              if (sinceGen > nowGen)
                sinceGen = nowGen;
              if (j.maybeTouchedSinceAny(waitKeyIds, sinceGen)) {
                const latencyMs2 = Date.now() - waitStartMs;
                touch.recordWaitMetrics({ stream, touchCfg, keysCount: waitKeyIds.length, outcome: "touched", latencyMs: latencyMs2 });
                return json(200, {
                  touched: true,
                  cursor: j.getCursor(),
                  effectiveWaitKind,
                  bucketMaxSourceOffsetSeq: j.getLastFlushedSourceOffsetSeq().toString(),
                  flushAtMs: j.getLastFlushAtMs(),
                  bucketStartMs: j.getLastBucketStartMs()
                });
              }
              const deadline = Date.now() + timeoutMs;
              const remaining = deadline - Date.now();
              if (remaining <= 0) {
                const latencyMs2 = Date.now() - waitStartMs;
                touch.recordWaitMetrics({ stream, touchCfg, keysCount: waitKeyIds.length, outcome: "timeout", latencyMs: latencyMs2 });
                return json(200, {
                  touched: false,
                  cursor: j.getCursor(),
                  effectiveWaitKind,
                  bucketMaxSourceOffsetSeq: j.getLastFlushedSourceOffsetSeq().toString(),
                  flushAtMs: j.getLastFlushAtMs(),
                  bucketStartMs: j.getLastBucketStartMs()
                });
              }
              const afterGen = j.getGeneration();
              const hit = await j.waitForAny({ keys: waitKeyIds, afterGeneration: afterGen, timeoutMs: remaining, signal: req.signal });
              if (req.signal.aborted)
                return new Response(null, { status: 204 });
              if (hit == null) {
                const latencyMs2 = Date.now() - waitStartMs;
                touch.recordWaitMetrics({ stream, touchCfg, keysCount: waitKeyIds.length, outcome: "timeout", latencyMs: latencyMs2 });
                return json(200, {
                  touched: false,
                  cursor: j.getCursor(),
                  effectiveWaitKind,
                  bucketMaxSourceOffsetSeq: j.getLastFlushedSourceOffsetSeq().toString(),
                  flushAtMs: j.getLastFlushAtMs(),
                  bucketStartMs: j.getLastBucketStartMs()
                });
              }
              const latencyMs = Date.now() - waitStartMs;
              touch.recordWaitMetrics({ stream, touchCfg, keysCount: waitKeyIds.length, outcome: "touched", latencyMs });
              return json(200, {
                touched: true,
                cursor: j.getCursor(),
                effectiveWaitKind,
                bucketMaxSourceOffsetSeq: hit.bucketMaxSourceOffsetSeq.toString(),
                flushAtMs: hit.flushAtMs,
                bucketStartMs: hit.bucketStartMs
              });
            } finally {
              releaseHotInterest();
            }
          }
        }
        if (req.method === "PUT") {
          const streamClosed = parseStreamClosedHeader(req.headers.get("stream-closed"));
          const ttlHeader = req.headers.get("stream-ttl");
          const expiresHeader = req.headers.get("stream-expires-at");
          if (ttlHeader && expiresHeader)
            return badRequest("only one of Stream-TTL or Stream-Expires-At is allowed");
          let ttlSeconds = null;
          let expiresAtMs = null;
          if (ttlHeader) {
            const ttlRes = parseStreamTtlSeconds(ttlHeader);
            if (Result17.isError(ttlRes))
              return badRequest(ttlRes.error.message);
            ttlSeconds = ttlRes.value;
            expiresAtMs = db.nowMs() + BigInt(ttlSeconds) * 1000n;
          } else if (expiresHeader) {
            const expiresRes = parseTimestampMsResult(expiresHeader);
            if (Result17.isError(expiresRes))
              return badRequest(expiresRes.error.message);
            expiresAtMs = expiresRes.value;
          }
          const contentType = normalizeContentType(req.headers.get("content-type")) ?? "application/octet-stream";
          const routingKeyHeader = req.headers.get("stream-key");
          const memReject = rejectIfMemoryLimited();
          if (memReject)
            return memReject;
          const ab = await req.arrayBuffer();
          if (ab.byteLength > cfg.appendMaxBodyBytes)
            return tooLarge(`body too large (max ${cfg.appendMaxBodyBytes})`);
          const bodyBytes = new Uint8Array(ab);
          let srow = db.getStream(stream);
          if (srow && db.isDeleted(srow)) {
            db.hardDeleteStream(stream);
            srow = null;
          }
          if (srow && srow.expires_at_ms != null && db.nowMs() > srow.expires_at_ms) {
            db.hardDeleteStream(stream);
            srow = null;
          }
          if (srow) {
            const existingClosed = srow.closed !== 0;
            const existingContentType = normalizeContentType(srow.content_type) ?? srow.content_type;
            const ttlMatch = ttlSeconds != null ? srow.ttl_seconds != null && srow.ttl_seconds === ttlSeconds : expiresAtMs != null ? srow.ttl_seconds == null && srow.expires_at_ms != null && srow.expires_at_ms === expiresAtMs : srow.ttl_seconds == null && srow.expires_at_ms == null;
            if (existingContentType !== contentType || existingClosed !== streamClosed || !ttlMatch) {
              return conflict("stream config mismatch");
            }
            const tailOffset2 = encodeOffset(srow.epoch, srow.next_offset - 1n);
            const headers2 = {
              "content-type": existingContentType,
              "stream-next-offset": tailOffset2
            };
            if (existingClosed)
              headers2["stream-closed"] = "true";
            if (srow.expires_at_ms != null)
              headers2["stream-expires-at"] = new Date(Number(srow.expires_at_ms)).toISOString();
            return new Response(null, { status: 200, headers: withNosniff(headers2) });
          }
          db.ensureStream(stream, { contentType, expiresAtMs, ttlSeconds, closed: false });
          let lastOffset = -1n;
          let appendedRows = 0;
          let closedNow = false;
          if (bodyBytes.byteLength > 0) {
            const rowsRes = buildAppendRowsResult(stream, bodyBytes, contentType, routingKeyHeader, true);
            if (Result17.isError(rowsRes)) {
              if (rowsRes.error.status === 500)
                return internalError();
              return badRequest(rowsRes.error.message);
            }
            const rows = rowsRes.value.rows;
            appendedRows = rows.length;
            if (rows.length > 0 || streamClosed) {
              const appendRes = await enqueueAppend({
                stream,
                baseAppendMs: db.nowMs(),
                rows,
                contentType,
                close: streamClosed
              });
              if (Result17.isError(appendRes)) {
                if (appendRes.error.kind === "overloaded")
                  return json(429, { error: { code: "overloaded", message: "ingest queue full" } });
                return json(500, { error: { code: "internal", message: "append failed" } });
              }
              lastOffset = appendRes.value.lastOffset;
              closedNow = appendRes.value.closed;
            }
          } else if (streamClosed) {
            const appendRes = await enqueueAppend({
              stream,
              baseAppendMs: db.nowMs(),
              rows: [],
              contentType,
              close: true
            });
            if (Result17.isError(appendRes)) {
              if (appendRes.error.kind === "overloaded")
                return json(429, { error: { code: "overloaded", message: "ingest queue full" } });
              return json(500, { error: { code: "internal", message: "close failed" } });
            }
            lastOffset = appendRes.value.lastOffset;
            closedNow = appendRes.value.closed;
          }
          recordAppendOutcome({
            stream,
            lastOffset,
            appendedRows,
            metricsBytes: bodyBytes.byteLength,
            ingestedBytes: bodyBytes.byteLength,
            touched: bodyBytes.byteLength > 0 || streamClosed,
            closed: closedNow
          });
          const createdRow = db.getStream(stream);
          const tailOffset = encodeOffset(createdRow.epoch, createdRow.next_offset - 1n);
          const headers = {
            "content-type": contentType,
            "stream-next-offset": appendedRows > 0 || streamClosed ? encodeOffset(createdRow.epoch, lastOffset) : tailOffset,
            location: req.url
          };
          if (streamClosed || closedNow)
            headers["stream-closed"] = "true";
          if (createdRow.expires_at_ms != null)
            headers["stream-expires-at"] = new Date(Number(createdRow.expires_at_ms)).toISOString();
          return new Response(null, { status: 201, headers: withNosniff(headers) });
        }
        if (req.method === "DELETE") {
          const deleted = db.deleteStream(stream);
          if (!deleted)
            return notFound();
          await uploader.publishManifest(stream);
          return new Response(null, { status: 204, headers: withNosniff() });
        }
        if (req.method === "HEAD") {
          const srow = db.getStream(stream);
          if (!srow || db.isDeleted(srow))
            return notFound();
          if (srow.expires_at_ms != null && db.nowMs() > srow.expires_at_ms)
            return notFound("stream expired");
          const tailOffset = encodeOffset(srow.epoch, srow.next_offset - 1n);
          const headers = {
            "content-type": normalizeContentType(srow.content_type) ?? srow.content_type,
            "stream-next-offset": tailOffset,
            "stream-end-offset": tailOffset,
            "cache-control": "no-store"
          };
          if (srow.closed !== 0)
            headers["stream-closed"] = "true";
          if (srow.ttl_seconds != null && srow.expires_at_ms != null) {
            const remainingMs = Number(srow.expires_at_ms - db.nowMs());
            const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
            headers["stream-ttl"] = String(remaining);
          }
          if (srow.expires_at_ms != null)
            headers["stream-expires-at"] = new Date(Number(srow.expires_at_ms)).toISOString();
          return new Response(null, { status: 200, headers: withNosniff(headers) });
        }
        if (req.method === "POST") {
          const srow = db.getStream(stream);
          if (!srow || db.isDeleted(srow))
            return notFound();
          if (srow.expires_at_ms != null && db.nowMs() > srow.expires_at_ms)
            return notFound("stream expired");
          const streamClosed = parseStreamClosedHeader(req.headers.get("stream-closed"));
          const streamContentType = normalizeContentType(srow.content_type) ?? srow.content_type;
          const producerId = req.headers.get("producer-id");
          const producerEpochHeader = req.headers.get("producer-epoch");
          const producerSeqHeader = req.headers.get("producer-seq");
          let producer = null;
          if (producerId != null || producerEpochHeader != null || producerSeqHeader != null) {
            if (!producerId || producerId.trim() === "")
              return badRequest("invalid Producer-Id");
            if (!producerEpochHeader || !producerSeqHeader)
              return badRequest("missing producer headers");
            const epoch = parseNonNegativeInt(producerEpochHeader);
            const seq = parseNonNegativeInt(producerSeqHeader);
            if (epoch == null || seq == null)
              return badRequest("invalid producer headers");
            producer = { id: producerId, epoch, seq };
          }
          let streamSeq = null;
          const streamSeqRes = parseStreamSeqHeader(req.headers.get("stream-seq"));
          if (Result17.isError(streamSeqRes))
            return badRequest(streamSeqRes.error.message);
          streamSeq = streamSeqRes.value;
          const tsHdr = req.headers.get("stream-timestamp");
          let baseAppendMs = db.nowMs();
          if (tsHdr) {
            const tsRes = parseTimestampMsResult(tsHdr);
            if (Result17.isError(tsRes))
              return badRequest(tsRes.error.message);
            baseAppendMs = tsRes.value;
          }
          const memReject = rejectIfMemoryLimited();
          if (memReject)
            return memReject;
          const ab = await req.arrayBuffer();
          if (ab.byteLength > cfg.appendMaxBodyBytes)
            return tooLarge(`body too large (max ${cfg.appendMaxBodyBytes})`);
          const bodyBytes = new Uint8Array(ab);
          const isCloseOnly = streamClosed && bodyBytes.byteLength === 0;
          if (bodyBytes.byteLength === 0 && !streamClosed)
            return badRequest("empty body");
          let reqContentType = normalizeContentType(req.headers.get("content-type"));
          if (!isCloseOnly && !reqContentType)
            return badRequest("missing content-type");
          const routingKeyHeader = req.headers.get("stream-key");
          let rows = [];
          if (!isCloseOnly) {
            const rowsRes = buildAppendRowsResult(stream, bodyBytes, reqContentType, routingKeyHeader, false);
            if (Result17.isError(rowsRes)) {
              if (rowsRes.error.status === 500)
                return internalError();
              return badRequest(rowsRes.error.message);
            }
            rows = rowsRes.value.rows;
          }
          const appendRes = await enqueueAppend({
            stream,
            baseAppendMs,
            rows,
            contentType: reqContentType ?? streamContentType,
            streamSeq,
            producer,
            close: streamClosed
          });
          if (Result17.isError(appendRes)) {
            const err = appendRes.error;
            if (err.kind === "overloaded")
              return json(429, { error: { code: "overloaded", message: "ingest queue full" } });
            if (err.kind === "gone")
              return notFound("stream expired");
            if (err.kind === "not_found")
              return notFound();
            if (err.kind === "content_type_mismatch")
              return conflict("content-type mismatch");
            if (err.kind === "stream_seq") {
              return conflict("sequence mismatch", {
                "stream-expected-seq": err.expected,
                "stream-received-seq": err.received
              });
            }
            if (err.kind === "closed") {
              const headers2 = {
                "stream-next-offset": encodeOffset(srow.epoch, err.lastOffset),
                "stream-closed": "true"
              };
              return new Response(null, { status: 409, headers: withNosniff(headers2) });
            }
            if (err.kind === "producer_stale_epoch") {
              return new Response(null, {
                status: 403,
                headers: withNosniff({ "producer-epoch": String(err.producerEpoch) })
              });
            }
            if (err.kind === "producer_gap") {
              return new Response(null, {
                status: 409,
                headers: withNosniff({
                  "producer-expected-seq": String(err.expected),
                  "producer-received-seq": String(err.received)
                })
              });
            }
            if (err.kind === "producer_epoch_seq")
              return badRequest("invalid producer sequence");
            return json(500, { error: { code: "internal", message: "append failed" } });
          }
          const res = appendRes.value;
          const appendBytes = rows.reduce((acc, r) => acc + r.payload.byteLength, 0);
          recordAppendOutcome({
            stream,
            lastOffset: res.lastOffset,
            appendedRows: res.appendedRows,
            metricsBytes: appendBytes,
            ingestedBytes: bodyBytes.byteLength,
            touched: true,
            closed: res.closed
          });
          const headers = {
            "stream-next-offset": encodeOffset(srow.epoch, res.lastOffset)
          };
          if (res.closed)
            headers["stream-closed"] = "true";
          if (producer && res.producer) {
            headers["producer-epoch"] = String(res.producer.epoch);
            headers["producer-seq"] = String(res.producer.seq);
          }
          const status = producer && res.appendedRows > 0 ? 200 : 204;
          return new Response(null, { status, headers: withNosniff(headers) });
        }
        if (req.method === "GET") {
          const srow = db.getStream(stream);
          if (!srow || db.isDeleted(srow))
            return notFound();
          if (srow.expires_at_ms != null && db.nowMs() > srow.expires_at_ms)
            return notFound("stream expired");
          const streamContentType = normalizeContentType(srow.content_type) ?? srow.content_type;
          const isJsonStream = streamContentType === "application/json";
          const fmtParam = url.searchParams.get("format");
          let format = isJsonStream ? "json" : "raw";
          if (fmtParam) {
            if (fmtParam !== "raw" && fmtParam !== "json")
              return badRequest("invalid format");
            format = fmtParam;
          }
          if (format === "json" && !isJsonStream)
            return badRequest("invalid format");
          const pathKey = pathKeyParam ?? null;
          const key = pathKey ?? url.searchParams.get("key");
          const liveParam = url.searchParams.get("live") ?? "";
          const cursorParam = url.searchParams.get("cursor");
          let mode;
          if (liveParam === "" || liveParam === "false" || liveParam === "0")
            mode = "catchup";
          else if (liveParam === "long-poll" || liveParam === "true" || liveParam === "1")
            mode = "long-poll";
          else if (liveParam === "sse")
            mode = "sse";
          else
            return badRequest("invalid live mode");
          const timeout = url.searchParams.get("timeout") ?? url.searchParams.get("timeout_ms");
          let timeoutMs = null;
          if (timeout) {
            if (/^[0-9]+$/.test(timeout)) {
              timeoutMs = Number(timeout);
            } else {
              const timeoutRes = parseDurationMsResult(timeout);
              if (Result17.isError(timeoutRes))
                return badRequest("invalid timeout");
              timeoutMs = timeoutRes.value;
            }
          }
          const hasOffsetParam = url.searchParams.has("offset");
          let offset = url.searchParams.get("offset");
          if (hasOffsetParam && (!offset || offset.trim() === ""))
            return badRequest("missing offset");
          const sinceParam = url.searchParams.get("since");
          if (!offset && sinceParam) {
            const sinceRes = parseTimestampMsResult(sinceParam);
            if (Result17.isError(sinceRes))
              return badRequest(sinceRes.error.message);
            const seekRes = await reader.seekOffsetByTimestampResult(stream, sinceRes.value, key ?? null);
            if (Result17.isError(seekRes))
              return readerErrorResponse(seekRes.error);
            offset = seekRes.value;
          }
          if (!offset) {
            if (mode === "catchup")
              offset = "-1";
            else
              return badRequest("missing offset");
          }
          let parsedOffset = null;
          if (offset !== "now") {
            const offsetRes = parseOffsetResult(offset);
            if (Result17.isError(offsetRes))
              return badRequest(offsetRes.error.message);
            parsedOffset = offsetRes.value;
          }
          const ifNoneMatch = req.headers.get("if-none-match");
          const sendBatch = async (batch2, cacheControl2, includeEtag) => {
            const upToDate = batch2.nextOffsetSeq === batch2.endOffsetSeq;
            const closedAtTail = srow.closed !== 0 && upToDate;
            const etag = includeEtag ? `W/"slice:${canonicalizeOffset(offset)}:${batch2.nextOffset}:key=${key ?? ""}:fmt=${format}"` : null;
            const baseHeaders = {
              "stream-next-offset": batch2.nextOffset,
              "stream-end-offset": batch2.endOffset,
              "cross-origin-resource-policy": "cross-origin"
            };
            if (upToDate)
              baseHeaders["stream-up-to-date"] = "true";
            if (closedAtTail)
              baseHeaders["stream-closed"] = "true";
            if (cacheControl2)
              baseHeaders["cache-control"] = cacheControl2;
            if (etag)
              baseHeaders["etag"] = etag;
            if (srow.expires_at_ms != null)
              baseHeaders["stream-expires-at"] = new Date(Number(srow.expires_at_ms)).toISOString();
            if (etag && ifNoneMatch && ifNoneMatch === etag) {
              return new Response(null, { status: 304, headers: withNosniff(baseHeaders) });
            }
            if (format === "json") {
              const decoded = decodeJsonRecords(stream, batch2.records);
              if (Result17.isError(decoded)) {
                if (decoded.error.status === 500)
                  return internalError();
                return badRequest(decoded.error.message);
              }
              const body = JSON.stringify(decoded.value.values);
              metrics.recordRead(body.length, decoded.value.values.length);
              const headers2 = {
                "content-type": "application/json",
                ...baseHeaders
              };
              return new Response(body, { status: 200, headers: withNosniff(headers2) });
            }
            const outBytes = concatPayloads(batch2.records.map((r) => r.payload));
            metrics.recordRead(outBytes.byteLength, batch2.records.length);
            const headers = {
              "content-type": streamContentType,
              ...baseHeaders
            };
            const outBody = new Uint8Array(outBytes.byteLength);
            outBody.set(outBytes);
            return new Response(outBody, { status: 200, headers: withNosniff(headers) });
          };
          if (mode === "sse") {
            const baseCursor = srow.closed !== 0 ? null : computeCursor(Date.now(), cursorParam);
            const dataEncoding = isTextContentType(streamContentType) ? "text" : "base64";
            const startOffsetSeq = offset === "now" ? srow.next_offset - 1n : offsetToSeqOrNeg1(parsedOffset);
            const startOffset = offset === "now" ? encodeOffset(srow.epoch, startOffsetSeq) : canonicalizeOffset(offset);
            const encoder = new TextEncoder;
            let aborted = false;
            const abortController = new AbortController;
            const streamBody = new ReadableStream({
              start(controller) {
                (async () => {
                  const fail = (message) => {
                    if (aborted)
                      return;
                    aborted = true;
                    abortController.abort();
                    controller.error(new Error(message));
                  };
                  let currentOffset = startOffset;
                  let currentSeq = startOffsetSeq;
                  let first = true;
                  while (!aborted) {
                    let batch2;
                    if (offset === "now" && first) {
                      batch2 = {
                        stream,
                        format,
                        key: key ?? null,
                        requestOffset: startOffset,
                        endOffset: startOffset,
                        nextOffset: startOffset,
                        endOffsetSeq: currentSeq,
                        nextOffsetSeq: currentSeq,
                        records: []
                      };
                    } else {
                      const batchRes2 = await reader.readResult({ stream, offset: currentOffset, key: key ?? null, format });
                      if (Result17.isError(batchRes2)) {
                        fail(batchRes2.error.message);
                        return;
                      }
                      batch2 = batchRes2.value;
                    }
                    first = false;
                    let ssePayload = "";
                    if (batch2.records.length > 0) {
                      let dataPayload = "";
                      if (format === "json") {
                        const decoded = decodeJsonRecords(stream, batch2.records);
                        if (Result17.isError(decoded)) {
                          fail(decoded.error.message);
                          return;
                        }
                        dataPayload = JSON.stringify(decoded.value.values);
                      } else {
                        const outBytes = concatPayloads(batch2.records.map((r) => r.payload));
                        dataPayload = dataEncoding === "base64" ? Buffer.from(outBytes).toString("base64") : new TextDecoder().decode(outBytes);
                      }
                      ssePayload += encodeSseEvent("data", dataPayload);
                    }
                    const upToDate = batch2.nextOffsetSeq === batch2.endOffsetSeq;
                    const latest = db.getStream(stream);
                    const closedNow = !!latest && latest.closed !== 0 && upToDate;
                    const control = { streamNextOffset: batch2.nextOffset };
                    if (upToDate)
                      control.upToDate = true;
                    if (closedNow)
                      control.streamClosed = true;
                    if (!closedNow && baseCursor)
                      control.streamCursor = baseCursor;
                    ssePayload += encodeSseEvent("control", JSON.stringify(control));
                    controller.enqueue(encoder.encode(ssePayload));
                    if (closedNow)
                      break;
                    currentOffset = batch2.nextOffset;
                    currentSeq = batch2.nextOffsetSeq;
                    if (!upToDate)
                      continue;
                    const sseWaitMs = timeoutMs == null ? 30000 : timeoutMs;
                    await notifier.waitFor(stream, currentSeq, sseWaitMs, abortController.signal);
                  }
                  if (!aborted)
                    controller.close();
                })().catch((err) => {
                  if (!aborted)
                    controller.error(err);
                });
              },
              cancel() {
                aborted = true;
                abortController.abort();
              }
            });
            const headers = {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              "cross-origin-resource-policy": "cross-origin",
              "stream-next-offset": startOffset,
              "stream-end-offset": encodeOffset(srow.epoch, srow.next_offset - 1n)
            };
            if (dataEncoding === "base64")
              headers["stream-sse-data-encoding"] = "base64";
            return new Response(streamBody, { status: 200, headers: withNosniff(headers) });
          }
          const defaultLongPollTimeoutMs = 3000;
          if (offset === "now") {
            const tailOffset = encodeOffset(srow.epoch, srow.next_offset - 1n);
            if (srow.closed !== 0) {
              if (mode === "long-poll") {
                const headers3 = {
                  "stream-next-offset": tailOffset,
                  "stream-end-offset": tailOffset,
                  "stream-up-to-date": "true",
                  "stream-closed": "true",
                  "cache-control": "no-store"
                };
                if (srow.expires_at_ms != null)
                  headers3["stream-expires-at"] = new Date(Number(srow.expires_at_ms)).toISOString();
                return new Response(null, { status: 204, headers: withNosniff(headers3) });
              }
              const headers2 = {
                "content-type": streamContentType,
                "stream-next-offset": tailOffset,
                "stream-end-offset": tailOffset,
                "stream-up-to-date": "true",
                "stream-closed": "true",
                "cache-control": "no-store",
                "cross-origin-resource-policy": "cross-origin"
              };
              if (srow.expires_at_ms != null)
                headers2["stream-expires-at"] = new Date(Number(srow.expires_at_ms)).toISOString();
              const body2 = format === "json" ? "[]" : "";
              return new Response(body2, { status: 200, headers: withNosniff(headers2) });
            }
            if (mode === "long-poll") {
              const deadline = Date.now() + (timeoutMs ?? defaultLongPollTimeoutMs);
              let currentOffset = tailOffset;
              while (true) {
                const batchRes2 = await reader.readResult({ stream, offset: currentOffset, key: key ?? null, format });
                if (Result17.isError(batchRes2))
                  return readerErrorResponse(batchRes2.error);
                const batch2 = batchRes2.value;
                if (batch2.records.length > 0) {
                  const cursor = computeCursor(Date.now(), cursorParam);
                  const resp = await sendBatch(batch2, "no-store", false);
                  const headers3 = new Headers(resp.headers);
                  headers3.set("stream-cursor", cursor);
                  return new Response(resp.body, { status: resp.status, headers: headers3 });
                }
                const latest2 = db.getStream(stream);
                if (latest2 && latest2.closed !== 0 && batch2.nextOffsetSeq === batch2.endOffsetSeq) {
                  const latestTail2 = encodeOffset(latest2.epoch, latest2.next_offset - 1n);
                  const headers3 = {
                    "stream-next-offset": latestTail2,
                    "stream-end-offset": latestTail2,
                    "stream-up-to-date": "true",
                    "stream-closed": "true",
                    "cache-control": "no-store"
                  };
                  if (latest2.expires_at_ms != null)
                    headers3["stream-expires-at"] = new Date(Number(latest2.expires_at_ms)).toISOString();
                  return new Response(null, { status: 204, headers: withNosniff(headers3) });
                }
                const remaining = deadline - Date.now();
                if (remaining <= 0)
                  break;
                currentOffset = batch2.nextOffset;
                await notifier.waitFor(stream, batch2.endOffsetSeq, remaining, req.signal);
                if (req.signal.aborted)
                  return new Response(null, { status: 204 });
              }
              const latest = db.getStream(stream);
              const latestTail = latest ? encodeOffset(latest.epoch, latest.next_offset - 1n) : tailOffset;
              const headers2 = {
                "stream-next-offset": latestTail,
                "stream-end-offset": latestTail,
                "stream-up-to-date": "true",
                "cache-control": "no-store"
              };
              if (latest && latest.closed !== 0)
                headers2["stream-closed"] = "true";
              else
                headers2["stream-cursor"] = computeCursor(Date.now(), cursorParam);
              if (latest && latest.expires_at_ms != null)
                headers2["stream-expires-at"] = new Date(Number(latest.expires_at_ms)).toISOString();
              return new Response(null, { status: 204, headers: withNosniff(headers2) });
            }
            const headers = {
              "content-type": streamContentType,
              "stream-next-offset": tailOffset,
              "stream-end-offset": tailOffset,
              "stream-up-to-date": "true",
              "cache-control": "no-store",
              "cross-origin-resource-policy": "cross-origin"
            };
            const body = format === "json" ? "[]" : "";
            return new Response(body, { status: 200, headers: withNosniff(headers) });
          }
          if (mode === "long-poll") {
            const deadline = Date.now() + (timeoutMs ?? defaultLongPollTimeoutMs);
            let currentOffset = offset;
            while (true) {
              const batchRes2 = await reader.readResult({ stream, offset: currentOffset, key: key ?? null, format });
              if (Result17.isError(batchRes2))
                return readerErrorResponse(batchRes2.error);
              const batch2 = batchRes2.value;
              if (batch2.records.length > 0) {
                const cursor = computeCursor(Date.now(), cursorParam);
                const resp = await sendBatch(batch2, "no-store", false);
                const headers2 = new Headers(resp.headers);
                headers2.set("stream-cursor", cursor);
                return new Response(resp.body, { status: resp.status, headers: headers2 });
              }
              const latest2 = db.getStream(stream);
              if (latest2 && latest2.closed !== 0 && batch2.nextOffsetSeq === batch2.endOffsetSeq) {
                const latestTail2 = encodeOffset(latest2.epoch, latest2.next_offset - 1n);
                const headers2 = {
                  "stream-next-offset": latestTail2,
                  "stream-end-offset": latestTail2,
                  "stream-up-to-date": "true",
                  "stream-closed": "true",
                  "cache-control": "no-store"
                };
                if (latest2.expires_at_ms != null)
                  headers2["stream-expires-at"] = new Date(Number(latest2.expires_at_ms)).toISOString();
                return new Response(null, { status: 204, headers: withNosniff(headers2) });
              }
              const remaining = deadline - Date.now();
              if (remaining <= 0)
                break;
              currentOffset = batch2.nextOffset;
              await notifier.waitFor(stream, batch2.endOffsetSeq, remaining, req.signal);
              if (req.signal.aborted)
                return new Response(null, { status: 204 });
            }
            const latest = db.getStream(stream);
            const latestTail = latest ? encodeOffset(latest.epoch, latest.next_offset - 1n) : currentOffset;
            const headers = {
              "stream-next-offset": latestTail,
              "stream-end-offset": latestTail,
              "stream-up-to-date": "true",
              "cache-control": "no-store"
            };
            if (latest && latest.closed !== 0)
              headers["stream-closed"] = "true";
            else
              headers["stream-cursor"] = computeCursor(Date.now(), cursorParam);
            if (latest && latest.expires_at_ms != null)
              headers["stream-expires-at"] = new Date(Number(latest.expires_at_ms)).toISOString();
            return new Response(null, { status: 204, headers: withNosniff(headers) });
          }
          const batchRes = await reader.readResult({ stream, offset, key: key ?? null, format });
          if (Result17.isError(batchRes))
            return readerErrorResponse(batchRes.error);
          const batch = batchRes.value;
          const cacheControl = "immutable, max-age=31536000";
          return sendBatch(batch, cacheControl, true);
        }
        return badRequest("unsupported method");
      }
      return notFound();
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (!closing && !msg.includes("Statement has finalized")) {
        console.error("request failed", e);
      }
      return internalError();
    }
  };
  const close = () => {
    closing = true;
    touch.stop();
    uploader.stop(true);
    indexer?.stop();
    segmenter.stop(true);
    metricsEmitter.stop();
    expirySweeper.stop();
    ingest.stop();
    memory.stop();
    db.close();
  };
  return {
    fetch: fetch2,
    close,
    deps: {
      config: cfg,
      db,
      os: store,
      ingest,
      notifier,
      reader,
      segmenter,
      uploader,
      indexer,
      metrics,
      registry,
      touch,
      stats,
      backpressure,
      memory
    }
  };
}

// src/objectstore/null.ts
function disabled(op, key) {
  throw dsError(`object store disabled in local mode (${op}${key ? `: ${key}` : ""})`);
}

class NullObjectStore {
  async put(key, _data, _opts) {
    return disabled("put", key);
  }
  async putFile(key, _path, _size, _opts) {
    return disabled("putFile", key);
  }
  async get(key, _opts) {
    return disabled("get", key);
  }
  async head(key) {
    return disabled("head", key);
  }
  async delete(key) {
    return disabled("delete", key);
  }
  async list(prefix) {
    return disabled("list", prefix);
  }
}

// src/reader.ts
import { existsSync as existsSync3, openSync, readSync, closeSync } from "node:fs";

// src/segment/format.ts
import { Result as Result18 } from "better-result";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

// src/util/bloom256.ts
var BITS = 2048n;
var MASK64 = (1n << 64n) - 1n;
function fnv1a64(data) {
  let h = 14695981039346656037n;
  for (const b of data) {
    h ^= BigInt(b);
    h = h * 1099511628211n & MASK64;
  }
  return h;
}
function mix64(x) {
  x = x + 0x9e3779b97f4a7c15n & MASK64;
  x = (x ^ x >> 30n) * 0xbf58476d1ce4e5b9n & MASK64;
  x = (x ^ x >> 27n) * 0x94d049bb133111ebn & MASK64;
  x = x ^ x >> 31n;
  return x & MASK64;
}

class Bloom256 {
  bits;
  constructor(bits) {
    if (bits && bits.byteLength !== 32)
      throw dsError("bloom must be 32 bytes");
    this.bits = bits ? new Uint8Array(bits) : new Uint8Array(32);
  }
  toBytes() {
    return new Uint8Array(this.bits);
  }
  add(keyUtf8) {
    if (keyUtf8.byteLength === 0)
      return;
    const h1 = fnv1a64(keyUtf8);
    const h2 = mix64(h1 ^ 0xa0761d6478bd642fn);
    for (let i = 0;i < 3; i++) {
      const idx = Number((h1 + BigInt(i) * h2) % BITS);
      const byte = idx >> 3;
      const bit = idx & 7;
      this.bits[byte] |= 1 << bit;
    }
  }
  maybeHas(keyUtf8) {
    if (keyUtf8.byteLength === 0)
      return true;
    const h1 = fnv1a64(keyUtf8);
    const h2 = mix64(h1 ^ 0xa0761d6478bd642fn);
    for (let i = 0;i < 3; i++) {
      const idx = Number((h1 + BigInt(i) * h2) % BITS);
      const byte = idx >> 3;
      const bit = idx & 7;
      if ((this.bits[byte] & 1 << bit) === 0)
        return false;
    }
    return true;
  }
}

// src/util/crc32c.ts
var POLY = 2197175160;
var TABLE = null;
function makeTable() {
  const t = new Uint32Array(256);
  for (let i = 0;i < 256; i++) {
    let c = i;
    for (let k = 0;k < 8; k++) {
      c = c & 1 ? POLY ^ c >>> 1 : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
}
function crc32c(buf) {
  if (!TABLE)
    TABLE = makeTable();
  let c = 4294967295;
  for (const b of buf) {
    c = TABLE[(c ^ b) & 255] ^ c >>> 8;
  }
  return (c ^ 4294967295) >>> 0;
}

// src/segment/format.ts
function invalidSegment(message) {
  return Result18.err({ kind: "invalid_segment_format", message });
}
var DSB3_HEADER_BYTES = 68;
var FOOTER_MAGIC = "DSF1";
var FOOTER_ENTRY_BYTES = 40;
var FOOTER_TRAILER_BYTES = 8;
function decodeBlockResult(blockBytes) {
  if (blockBytes.byteLength < DSB3_HEADER_BYTES)
    return invalidSegment("block too small");
  if (blockBytes[0] !== 68 || blockBytes[1] !== 83 || blockBytes[2] !== 66 || blockBytes[3] !== 51) {
    return invalidSegment("bad block magic");
  }
  const uncompressedLen = readU32BE(blockBytes, 4);
  const compressedLen = readU32BE(blockBytes, 8);
  const recordCount = readU32BE(blockBytes, 12);
  const bloom = blockBytes.slice(16, 48);
  const firstAppendNs = readU64BE(blockBytes, 48);
  const lastAppendNs = readU64BE(blockBytes, 56);
  const expectedCrc = readU32BE(blockBytes, 64);
  const payload = blockBytes.slice(DSB3_HEADER_BYTES, DSB3_HEADER_BYTES + compressedLen);
  if (payload.byteLength !== compressedLen)
    return invalidSegment("truncated block");
  const actualCrc = crc32c(payload);
  if (actualCrc !== expectedCrc)
    return invalidSegment("crc mismatch");
  let uncompressed;
  try {
    uncompressed = new Uint8Array(zstdDecompressSync(payload));
  } catch (e) {
    return invalidSegment(String(e?.message ?? e));
  }
  if (uncompressed.byteLength !== uncompressedLen) {
    return invalidSegment(`bad uncompressed len: got=${uncompressed.byteLength} expected=${uncompressedLen}`);
  }
  const records = [];
  let off = 0;
  for (let i = 0;i < recordCount; i++) {
    if (off + 8 + 4 > uncompressed.byteLength)
      return invalidSegment("truncated record");
    const appendNs = readU64BE(uncompressed, off);
    off += 8;
    const keyLen = readU32BE(uncompressed, off);
    off += 4;
    if (off + keyLen + 4 > uncompressed.byteLength)
      return invalidSegment("truncated key");
    const routingKey = uncompressed.slice(off, off + keyLen);
    off += keyLen;
    const dataLen = readU32BE(uncompressed, off);
    off += 4;
    if (off + dataLen > uncompressed.byteLength)
      return invalidSegment("truncated payload");
    const payload2 = uncompressed.slice(off, off + dataLen);
    off += dataLen;
    records.push({ appendNs, routingKey, payload: payload2 });
  }
  return Result18.ok({ recordCount, firstAppendNs, lastAppendNs, bloom, records });
}
function parseFooter(segmentBytes) {
  if (segmentBytes.byteLength < FOOTER_TRAILER_BYTES)
    return null;
  const tail = segmentBytes.slice(segmentBytes.byteLength - 4);
  const tailMagic = String.fromCharCode(tail[0], tail[1], tail[2], tail[3]);
  if (tailMagic !== FOOTER_MAGIC)
    return null;
  const footerLen = readU32BE(segmentBytes, segmentBytes.byteLength - 8);
  if (footerLen <= 0 || footerLen + FOOTER_TRAILER_BYTES > segmentBytes.byteLength)
    return null;
  const footerStart = segmentBytes.byteLength - FOOTER_TRAILER_BYTES - footerLen;
  if (footerStart < 0)
    return null;
  const footer = segmentBytes.slice(footerStart, footerStart + footerLen);
  const parsed = parseFooterBytes(footer);
  return { footer: parsed, footerStart };
}
function* iterateBlocksResult(segmentBytes) {
  const parsed = parseFooter(segmentBytes);
  const limit = parsed ? parsed.footerStart : segmentBytes.byteLength;
  let off = 0;
  while (off < limit) {
    if (off + DSB3_HEADER_BYTES > limit) {
      yield invalidSegment("truncated segment (block header)");
      return;
    }
    const header = segmentBytes.slice(off, off + DSB3_HEADER_BYTES);
    const compressedLen = readU32BE(header, 8);
    const totalLen = DSB3_HEADER_BYTES + compressedLen;
    if (off + totalLen > limit) {
      yield invalidSegment("truncated segment (block payload)");
      return;
    }
    const blockBytes = segmentBytes.slice(off, off + totalLen);
    const decodedRes = decodeBlockResult(blockBytes);
    if (Result18.isError(decodedRes)) {
      yield decodedRes;
      return;
    }
    yield Result18.ok({ blockOffset: off, blockBytes, decoded: decodedRes.value });
    off += totalLen;
  }
}
function parseFooterBytes(footer) {
  if (footer.byteLength < 12)
    return null;
  const magic = String.fromCharCode(footer[0], footer[1], footer[2], footer[3]);
  if (magic !== FOOTER_MAGIC)
    return null;
  const version = readU32BE(footer, 4);
  const blockCount = readU32BE(footer, 8);
  const expectedLen = 12 + blockCount * FOOTER_ENTRY_BYTES;
  if (footer.byteLength !== expectedLen)
    return null;
  const blocks = [];
  let off = 12;
  for (let i = 0;i < blockCount; i++) {
    const blockOffset = Number(readU64BE(footer, off));
    off += 8;
    const firstOffset = readU64BE(footer, off);
    off += 8;
    const recordCount = readU32BE(footer, off);
    off += 4;
    const compressedLen = readU32BE(footer, off);
    off += 4;
    const firstAppendNs = readU64BE(footer, off);
    off += 8;
    const lastAppendNs = readU64BE(footer, off);
    off += 8;
    blocks.push({ blockOffset, firstOffset, recordCount, compressedLen, firstAppendNs, lastAppendNs });
  }
  return { version, blocks };
}
function parseBlockHeaderResult(header) {
  if (header.byteLength < DSB3_HEADER_BYTES)
    return invalidSegment("block header too small");
  if (header[0] !== 68 || header[1] !== 83 || header[2] !== 66 || header[3] !== 51) {
    return invalidSegment("bad block magic");
  }
  const uncompressedLen = readU32BE(header, 4);
  const compressedLen = readU32BE(header, 8);
  const recordCount = readU32BE(header, 12);
  const bloom = header.slice(16, 48);
  const firstAppendNs = readU64BE(header, 48);
  const lastAppendNs = readU64BE(header, 56);
  const crc32cVal = readU32BE(header, 64);
  return Result18.ok({
    uncompressedLen,
    compressedLen,
    recordCount,
    bloom,
    firstAppendNs,
    lastAppendNs,
    crc32c: crc32cVal
  });
}

// src/util/stream_paths.ts
import { createHash as createHash2 } from "node:crypto";
function streamHash16Hex(stream) {
  const full = createHash2("sha256").update(stream).digest();
  return full.subarray(0, 16).toString("hex");
}
function pad16(n) {
  const s = String(n);
  return s.padStart(16, "0");
}
function segmentObjectKey(streamHash, segmentIndex) {
  return `streams/${streamHash}/segments/${pad16(segmentIndex)}.bin`;
}

// src/util/retry.ts
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function withTimeout(p, ms) {
  if (ms <= 0)
    return p;
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(dsError("timeout")), ms))
  ]);
}
async function retry(fn, opts) {
  let attempt = 0;
  let delay = opts.baseDelayMs;
  for (;; ) {
    try {
      return await withTimeout(fn(), opts.timeoutMs);
    } catch (e) {
      attempt++;
      if (attempt > opts.retries)
        throw e;
      const jitter = Math.random() * 0.2 + 0.9;
      await sleep(Math.min(opts.maxDelayMs, Math.floor(delay * jitter)));
      delay = Math.min(opts.maxDelayMs, delay * 2);
    }
  }
}

// src/reader.ts
import { Result as Result19 } from "better-result";
function errorMessage(e) {
  return String(e?.message ?? e);
}
function utf8Bytes(s) {
  return new TextEncoder().encode(s);
}
function objectKeyForSegment(seg) {
  const streamHash = streamHash16Hex(seg.stream);
  return segmentObjectKey(streamHash, seg.segment_index);
}
function readRangeFromFile(path, start, end) {
  const len = end - start + 1;
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(len);
    const bytesRead = readSync(fd, buf, 0, len, start);
    if (bytesRead !== len)
      throw dsError("short read");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } finally {
    closeSync(fd);
  }
}
async function readSegmentRange(os, seg, start, end, diskCache, retryOpts) {
  const local = seg.local_path;
  if (existsSync3(local))
    return readRangeFromFile(local, start, end);
  const objectKey = objectKeyForSegment(seg);
  if (diskCache && diskCache.has(objectKey)) {
    diskCache.recordHit();
    diskCache.touch(objectKey);
    return readRangeFromFile(diskCache.getPath(objectKey), start, end);
  }
  if (diskCache)
    diskCache.recordMiss();
  const bytes = await retry(async () => {
    const res = await os.get(objectKey, { range: { start, end } });
    if (!res)
      throw dsError(`object store missing segment: ${objectKey}`);
    return res;
  }, retryOpts ?? { retries: 0, baseDelayMs: 0, maxDelayMs: 0, timeoutMs: 0 });
  if (diskCache && start === 0 && end === seg.size_bytes - 1) {
    diskCache.put(objectKey, bytes);
  }
  return bytes;
}
async function loadSegmentBytes(os, seg, diskCache, retryOpts) {
  return readSegmentRange(os, seg, 0, seg.size_bytes - 1, diskCache, retryOpts);
}
async function loadSegmentFooter(os, seg, diskCache, retryOpts, footerCache) {
  const cacheKey = seg.segment_id;
  if (footerCache) {
    const cached = footerCache.get(cacheKey);
    if (cached)
      return cached;
  }
  if (seg.size_bytes < 8)
    return null;
  const tail = await readSegmentRange(os, seg, seg.size_bytes - 8, seg.size_bytes - 1, diskCache, retryOpts);
  const magic = String.fromCharCode(tail[4], tail[5], tail[6], tail[7]);
  if (magic !== "DSF1")
    return null;
  const footerLen = readU32BE(tail, 0);
  const footerStart = seg.size_bytes - 8 - footerLen;
  if (footerStart < 0)
    return null;
  const footerBytes = await readSegmentRange(os, seg, footerStart, footerStart + footerLen - 1, diskCache, retryOpts);
  const footer = parseFooterBytes(footerBytes);
  const result = { footer, footerStart };
  if (footerCache)
    footerCache.set(cacheKey, result);
  return result;
}

class StreamReader {
  config;
  db;
  os;
  diskCache;
  footerCache;
  index;
  constructor(config, db, os, diskCache, index) {
    this.config = config;
    this.db = db;
    this.os = os;
    this.diskCache = diskCache;
    this.index = index;
    if (config.segmentFooterCacheEntries > 0) {
      this.footerCache = new LruCache(config.segmentFooterCacheEntries);
    }
  }
  cacheStats() {
    return this.diskCache ? this.diskCache.stats() : null;
  }
  retryOpts() {
    return {
      retries: this.config.objectStoreRetries,
      baseDelayMs: this.config.objectStoreBaseDelayMs,
      maxDelayMs: this.config.objectStoreMaxDelayMs,
      timeoutMs: this.config.objectStoreTimeoutMs
    };
  }
  async seekOffsetByTimestampResult(stream, sinceMs, key) {
    const srow = this.db.getStream(stream);
    if (!srow || this.db.isDeleted(srow))
      return Result19.err({ kind: "not_found", message: "not_found" });
    if (srow.expires_at_ms != null && this.db.nowMs() > srow.expires_at_ms) {
      return Result19.err({ kind: "gone", message: "stream expired" });
    }
    try {
      const sinceNs = sinceMs * 1000000n;
      const keyBytes = key ? utf8Bytes(key) : null;
      const segments = this.db.listSegmentsForStream(stream);
      for (const seg of segments) {
        const segBytes = await loadSegmentBytes(this.os, seg, this.diskCache, this.retryOpts());
        let curOffset = seg.start_offset;
        for (const blockRes of iterateBlocksResult(segBytes)) {
          if (Result19.isError(blockRes))
            return Result19.err({ kind: "internal", message: blockRes.error.message });
          const { decoded } = blockRes.value;
          if (decoded.lastAppendNs < sinceNs) {
            curOffset += BigInt(decoded.recordCount);
            continue;
          }
          for (const r of decoded.records) {
            if (keyBytes && !bytesEqual(r.routingKey, keyBytes)) {
              curOffset += 1n;
              continue;
            }
            if (r.appendNs >= sinceNs) {
              const prev = curOffset - 1n;
              return Result19.ok(encodeOffset(srow.epoch, prev));
            }
            curOffset += 1n;
          }
        }
      }
      const start = srow.sealed_through + 1n;
      const end = srow.next_offset - 1n;
      if (start <= end) {
        for (const rec of this.db.iterWalRange(stream, start, end, keyBytes ?? undefined)) {
          const tsNs = BigInt(rec.ts_ms) * 1000000n;
          if (tsNs >= sinceNs) {
            const off = BigInt(rec.offset) - 1n;
            return Result19.ok(encodeOffset(srow.epoch, off));
          }
        }
      }
      const endOffsetNum = srow.next_offset - 1n;
      return Result19.ok(encodeOffset(srow.epoch, endOffsetNum));
    } catch (e) {
      return Result19.err({ kind: "internal", message: errorMessage(e) });
    }
  }
  async seekOffsetByTimestamp(stream, sinceMs, key) {
    const res = await this.seekOffsetByTimestampResult(stream, sinceMs, key);
    if (Result19.isError(res))
      throw dsError(res.error.message);
    return res.value;
  }
  async readResult(args) {
    const { stream, offset, key, format } = args;
    const srow = this.db.getStream(stream);
    if (!srow || this.db.isDeleted(srow))
      return Result19.err({ kind: "not_found", message: "not_found" });
    if (srow.expires_at_ms != null && this.db.nowMs() > srow.expires_at_ms) {
      return Result19.err({ kind: "gone", message: "stream expired" });
    }
    const epoch = srow.epoch;
    try {
      let finalize = function() {
        const scannedThrough = seq - 1n;
        const nextOffset = encodeOffset(epoch, scannedThrough);
        return {
          stream,
          format,
          key,
          requestOffset: offset,
          endOffset,
          nextOffset,
          endOffsetSeq: endOffsetNum,
          nextOffsetSeq: scannedThrough,
          records: results
        };
      };
      const parsed = parseOffsetResult(offset);
      if (Result19.isError(parsed)) {
        return Result19.err({ kind: "invalid_offset", message: parsed.error.message });
      }
      const startOffsetExclusive = offsetToSeqOrNeg1(parsed.value);
      const desiredOffset = startOffsetExclusive + 1n;
      const endOffsetNum = srow.next_offset - 1n;
      const endOffset = encodeOffset(srow.epoch, endOffsetNum);
      const results = [];
      let bytesOut = 0;
      if (desiredOffset > endOffsetNum) {
        return Result19.ok({
          stream,
          format,
          key,
          requestOffset: offset,
          endOffset,
          nextOffset: encodeOffset(srow.epoch, startOffsetExclusive),
          endOffsetSeq: endOffsetNum,
          nextOffsetSeq: startOffsetExclusive,
          records: []
        });
      }
      let seq = desiredOffset;
      const keyBytes = key ? utf8Bytes(key) : null;
      const indexInfo = keyBytes && this.index ? await this.index.candidateSegments(stream, keyBytes) : null;
      const candidateSegments = indexInfo?.segments ?? null;
      const indexedThrough = indexInfo?.indexedThrough ?? 0;
      const scanSegmentBytes = async (segBytes, seg) => {
        let curOffset = seg.start_offset;
        for (const blockRes of iterateBlocksResult(segBytes)) {
          if (Result19.isError(blockRes))
            return Result19.err({ kind: "internal", message: blockRes.error.message });
          const { decoded } = blockRes.value;
          if (keyBytes) {
            const bloom = new Bloom256(decoded.bloom);
            if (!bloom.maybeHas(keyBytes)) {
              curOffset += BigInt(decoded.recordCount);
              continue;
            }
          }
          for (const r of decoded.records) {
            if (curOffset < seq) {
              curOffset += 1n;
              continue;
            }
            if (curOffset > endOffsetNum)
              break;
            if (keyBytes && !bytesEqual(r.routingKey, keyBytes)) {
              curOffset += 1n;
              continue;
            }
            results.push({ offset: curOffset, payload: r.payload });
            bytesOut += r.payload.byteLength;
            curOffset += 1n;
            if (results.length >= this.config.readMaxRecords || bytesOut >= this.config.readMaxBytes) {
              seq = curOffset;
              return Result19.ok(undefined);
            }
          }
        }
        return Result19.ok(undefined);
      };
      while (seq <= endOffsetNum && seq <= srow.sealed_through) {
        const seg = this.db.findSegmentForOffset(stream, seq);
        if (!seg) {
          break;
        }
        if (keyBytes && candidateSegments && seg.segment_index < indexedThrough && !candidateSegments.has(seg.segment_index)) {
          seq = seg.end_offset + 1n;
          continue;
        }
        const preferFull = !keyBytes && this.config.readMaxBytes >= seg.size_bytes;
        if (preferFull) {
          const segBytes = await loadSegmentBytes(this.os, seg, this.diskCache, this.retryOpts());
          const scanRes = await scanSegmentBytes(segBytes, seg);
          if (Result19.isError(scanRes))
            return scanRes;
          if (results.length >= this.config.readMaxRecords || bytesOut >= this.config.readMaxBytes)
            return Result19.ok(finalize());
        } else {
          const footerInfo = await loadSegmentFooter(this.os, seg, this.diskCache, this.retryOpts(), this.footerCache);
          if (!footerInfo || !footerInfo.footer) {
            const segBytes = await loadSegmentBytes(this.os, seg, this.diskCache, this.retryOpts());
            const scanRes = await scanSegmentBytes(segBytes, seg);
            if (Result19.isError(scanRes))
              return scanRes;
            if (results.length >= this.config.readMaxRecords || bytesOut >= this.config.readMaxBytes)
              return Result19.ok(finalize());
          } else {
            const footer = footerInfo.footer;
            for (const entry of footer.blocks) {
              const blockStart = entry.firstOffset;
              const blockEnd = entry.firstOffset + BigInt(entry.recordCount) - 1n;
              if (blockEnd < seq)
                continue;
              if (blockStart > endOffsetNum)
                break;
              if (keyBytes) {
                const headerBytes = await readSegmentRange(this.os, seg, entry.blockOffset, entry.blockOffset + DSB3_HEADER_BYTES - 1, this.diskCache, this.retryOpts());
                const headerRes = parseBlockHeaderResult(headerBytes);
                if (Result19.isError(headerRes))
                  return Result19.err({ kind: "internal", message: headerRes.error.message });
                const header = headerRes.value;
                const bloom = new Bloom256(header.bloom);
                if (!bloom.maybeHas(keyBytes))
                  continue;
              }
              const totalLen = DSB3_HEADER_BYTES + entry.compressedLen;
              const blockBytes = await readSegmentRange(this.os, seg, entry.blockOffset, entry.blockOffset + totalLen - 1, this.diskCache, this.retryOpts());
              const decodedRes = decodeBlockResult(blockBytes);
              if (Result19.isError(decodedRes))
                return Result19.err({ kind: "internal", message: decodedRes.error.message });
              const decoded = decodedRes.value;
              let curOffset = entry.firstOffset;
              for (const r of decoded.records) {
                if (curOffset < seq) {
                  curOffset += 1n;
                  continue;
                }
                if (curOffset > endOffsetNum)
                  break;
                if (keyBytes && !bytesEqual(r.routingKey, keyBytes)) {
                  curOffset += 1n;
                  continue;
                }
                results.push({ offset: curOffset, payload: r.payload });
                bytesOut += r.payload.byteLength;
                curOffset += 1n;
                if (results.length >= this.config.readMaxRecords || bytesOut >= this.config.readMaxBytes) {
                  seq = curOffset;
                  return Result19.ok(finalize());
                }
              }
            }
          }
        }
        seq = seg.end_offset + 1n;
      }
      if (seq <= endOffsetNum) {
        let hitLimit = false;
        for (const rec of this.db.iterWalRange(stream, seq, endOffsetNum, keyBytes ?? undefined)) {
          const s = BigInt(rec.offset);
          const payload = rec.payload;
          results.push({ offset: s, payload });
          bytesOut += payload.byteLength;
          if (results.length >= this.config.readMaxRecords || bytesOut >= this.config.readMaxBytes) {
            hitLimit = true;
            seq = s + 1n;
            break;
          }
        }
        if (!hitLimit) {
          seq = endOffsetNum + 1n;
        }
      }
      return Result19.ok(finalize());
    } catch (e) {
      return Result19.err({ kind: "internal", message: errorMessage(e) });
    }
  }
  async read(args) {
    const res = await this.readResult(args);
    if (Result19.isError(res))
      throw dsError(res.error.message);
    return res.value;
  }
}
function bytesEqual(a, b) {
  if (a.byteLength !== b.byteLength)
    return false;
  for (let i = 0;i < a.byteLength; i++)
    if (a[i] !== b[i])
      return false;
  return true;
}

// src/app_local.ts
class NoopUploader {
  start() {}
  stop(_hard) {}
  countSegmentsWaiting() {
    return 0;
  }
  setHooks(_hooks) {}
  async publishManifest(_stream) {}
}
var noopSegmenter = {
  start() {},
  stop(_hard) {}
};
function createLocalApp(cfg, os, opts = {}) {
  return createAppCore(cfg, {
    stats: opts.stats,
    createRuntime: ({ config, db }) => {
      const store = os ?? new NullObjectStore;
      const reader = new StreamReader(config, db, store);
      return {
        store,
        reader,
        segmenter: noopSegmenter,
        uploader: new NoopUploader,
        uploadSchemaRegistry: async () => {},
        start: () => {}
      };
    }
  });
}

// src/config.ts
var KNOWN_DS_ENVS = new Set([
  "DS_ROOT",
  "DS_HOST",
  "DS_DB_PATH",
  "DS_SEGMENT_MAX_BYTES",
  "DS_BLOCK_MAX_BYTES",
  "DS_SEGMENT_TARGET_ROWS",
  "DS_SEGMENT_MAX_INTERVAL_MS",
  "DS_SEGMENT_CHECK_MS",
  "DS_SEGMENTER_WORKERS",
  "DS_UPLOAD_CHECK_MS",
  "DS_UPLOAD_CONCURRENCY",
  "DS_SEGMENT_CACHE_MAX_BYTES",
  "DS_SEGMENT_FOOTER_CACHE_ENTRIES",
  "DS_INDEX_RUN_CACHE_MAX_BYTES",
  "DS_INDEX_RUN_MEM_CACHE_BYTES",
  "DS_INDEX_L0_SPAN",
  "DS_INDEX_BUILD_CONCURRENCY",
  "DS_INDEX_CHECK_MS",
  "DS_INDEX_COMPACTION_FANOUT",
  "DS_INDEX_MAX_LEVEL",
  "DS_INDEX_COMPACT_CONCURRENCY",
  "DS_INDEX_RETIRE_GEN_WINDOW",
  "DS_INDEX_RETIRE_MIN_MS",
  "DS_READ_MAX_BYTES",
  "DS_READ_MAX_RECORDS",
  "DS_APPEND_MAX_BODY_BYTES",
  "DS_INGEST_FLUSH_MS",
  "DS_INGEST_MAX_BATCH_REQS",
  "DS_INGEST_MAX_BATCH_BYTES",
  "DS_INGEST_MAX_QUEUE_REQS",
  "DS_INGEST_MAX_QUEUE_BYTES",
  "DS_INGEST_BUSY_MS",
  "DS_LOCAL_BACKLOG_MAX_BYTES",
  "DS_MEMORY_LIMIT_BYTES",
  "DS_MEMORY_LIMIT_MB",
  "DS_SQLITE_CACHE_BYTES",
  "DS_SQLITE_CACHE_MB",
  "DS_OBJECTSTORE_TIMEOUT_MS",
  "DS_OBJECTSTORE_RETRIES",
  "DS_OBJECTSTORE_RETRY_BASE_MS",
  "DS_OBJECTSTORE_RETRY_MAX_MS",
  "DS_LOCAL_DATA_ROOT",
  "DS_EXPIRY_SWEEP_MS",
  "DS_EXPIRY_SWEEP_LIMIT",
  "DS_METRICS_FLUSH_MS",
  "DS_INTERPRETER_WORKERS",
  "DS_INTERPRETER_CHECK_MS",
  "DS_INTERPRETER_MAX_BATCH_ROWS",
  "DS_INTERPRETER_MAX_BATCH_BYTES",
  "DS_STATS_INTERVAL_MS",
  "DS_BACKPRESSURE_BUDGET_MS",
  "DS_MOCK_R2_MAX_INMEM_BYTES",
  "DS_MOCK_R2_MAX_INMEM_MB",
  "DS_MOCK_R2_SPILL_DIR",
  "DS_BENCH_URL",
  "DS_BENCH_DURATION_MS",
  "DS_BENCH_INTERVAL_MS",
  "DS_BENCH_PAYLOAD_BYTES",
  "DS_BENCH_CONCURRENCY",
  "DS_BENCH_REQUEST_TIMEOUT_MS",
  "DS_BENCH_DRAIN_TIMEOUT_MS",
  "DS_BENCH_PAUSE_BACKGROUND",
  "DS_BENCH_YIELD_EVERY",
  "DS_BENCH_DEBUG",
  "DS_BENCH_SCENARIOS",
  "DS_MEMORY_STRESS_LIMITS_MB",
  "DS_MEMORY_STRESS_STATS_MS",
  "DS_MEMORY_STRESS_PORT_BASE",
  "DS_RK_EVENTS_MAX",
  "DS_RK_EVENTS_STEP",
  "DS_RK_PAYLOAD_BYTES",
  "DS_RK_APPEND_BATCH",
  "DS_RK_KEYS",
  "DS_RK_HOT_KEYS",
  "DS_RK_HOT_PCT",
  "DS_RK_PAYLOAD_POOL",
  "DS_RK_READ_ENTRIES",
  "DS_RK_WARM_READS",
  "DS_RK_SEGMENT_BYTES",
  "DS_RK_BLOCK_BYTES",
  "DS_RK_SEED",
  "DS_RK_R2_GET_DELAY_MS"
]);
var warnedUnknownEnv = false;
function warnUnknownEnv() {
  if (warnedUnknownEnv)
    return;
  warnedUnknownEnv = true;
  const unknown = [];
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith("DS_"))
      continue;
    if (KNOWN_DS_ENVS.has(key))
      continue;
    unknown.push(key);
  }
  if (unknown.length > 0) {
    unknown.sort();
    console.warn(`[config] unknown DS_* environment variables: ${unknown.join(", ")}`);
  }
}
function envNum(name, def) {
  const v = process.env[name];
  if (!v)
    return def;
  const n = Number(v);
  if (!Number.isFinite(n))
    throw dsError(`invalid ${name}: ${v}`);
  return n;
}
function envBytes(name) {
  const v = process.env[name];
  if (!v)
    return null;
  const n = Number(v);
  if (!Number.isFinite(n))
    throw dsError(`invalid ${name}: ${v}`);
  return Math.max(0, Math.floor(n));
}
function clampBytes(value, min, max) {
  if (!Number.isFinite(value))
    return min;
  if (value < min)
    return min;
  if (value > max)
    return max;
  return value;
}
function loadConfig() {
  warnUnknownEnv();
  const rootDir = process.env.DS_ROOT ?? "./ds-data";
  const host = process.env.DS_HOST?.trim() || "127.0.0.1";
  const bytesOverride = envBytes("DS_MEMORY_LIMIT_BYTES");
  const mbOverride = envBytes("DS_MEMORY_LIMIT_MB");
  const memoryLimitBytes = bytesOverride ?? (mbOverride != null ? mbOverride * 1024 * 1024 : 0);
  const backlogOverride = envBytes("DS_LOCAL_BACKLOG_MAX_BYTES");
  const sqliteCacheBytesOverride = envBytes("DS_SQLITE_CACHE_BYTES");
  const sqliteCacheMbOverride = envBytes("DS_SQLITE_CACHE_MB");
  const indexMemOverride = envBytes("DS_INDEX_RUN_MEM_CACHE_BYTES");
  const indexDiskOverride = envBytes("DS_INDEX_RUN_CACHE_MAX_BYTES");
  const localBacklogMaxBytes = backlogOverride ?? 10 * 1024 * 1024 * 1024;
  const sqliteCacheBytes = sqliteCacheBytesOverride ?? (sqliteCacheMbOverride != null ? sqliteCacheMbOverride * 1024 * 1024 : memoryLimitBytes > 0 ? Math.floor(memoryLimitBytes * 0.25) : 0);
  const tunedIndexMem = indexMemOverride ?? (memoryLimitBytes > 0 ? clampBytes(Math.floor(memoryLimitBytes * 0.05), 8 * 1024 * 1024, 128 * 1024 * 1024) : 64 * 1024 * 1024);
  return {
    host,
    rootDir,
    dbPath: process.env.DS_DB_PATH ?? `${rootDir}/wal.sqlite`,
    segmentMaxBytes: envNum("DS_SEGMENT_MAX_BYTES", 16 * 1024 * 1024),
    blockMaxBytes: envNum("DS_BLOCK_MAX_BYTES", 256 * 1024),
    segmentTargetRows: envNum("DS_SEGMENT_TARGET_ROWS", 50000),
    segmentMaxIntervalMs: envNum("DS_SEGMENT_MAX_INTERVAL_MS", 0),
    segmentCheckIntervalMs: envNum("DS_SEGMENT_CHECK_MS", 250),
    segmenterWorkers: envNum("DS_SEGMENTER_WORKERS", 0),
    uploadIntervalMs: envNum("DS_UPLOAD_CHECK_MS", 250),
    uploadConcurrency: envNum("DS_UPLOAD_CONCURRENCY", 4),
    segmentCacheMaxBytes: envNum("DS_SEGMENT_CACHE_MAX_BYTES", 256 * 1024 * 1024),
    segmentFooterCacheEntries: envNum("DS_SEGMENT_FOOTER_CACHE_ENTRIES", 2048),
    indexRunCacheMaxBytes: indexDiskOverride ?? 256 * 1024 * 1024,
    indexRunMemoryCacheBytes: tunedIndexMem,
    indexL0SpanSegments: envNum("DS_INDEX_L0_SPAN", 16),
    indexBuildConcurrency: envNum("DS_INDEX_BUILD_CONCURRENCY", 4),
    indexCheckIntervalMs: envNum("DS_INDEX_CHECK_MS", 1000),
    indexCompactionFanout: envNum("DS_INDEX_COMPACTION_FANOUT", 16),
    indexMaxLevel: envNum("DS_INDEX_MAX_LEVEL", 4),
    indexCompactionConcurrency: envNum("DS_INDEX_COMPACT_CONCURRENCY", 4),
    indexRetireGenWindow: envNum("DS_INDEX_RETIRE_GEN_WINDOW", 2),
    indexRetireMinMs: envNum("DS_INDEX_RETIRE_MIN_MS", 5 * 60 * 1000),
    readMaxBytes: envNum("DS_READ_MAX_BYTES", 1 * 1024 * 1024),
    readMaxRecords: envNum("DS_READ_MAX_RECORDS", 1000),
    appendMaxBodyBytes: envNum("DS_APPEND_MAX_BODY_BYTES", 10 * 1024 * 1024),
    ingestFlushIntervalMs: envNum("DS_INGEST_FLUSH_MS", 10),
    ingestMaxBatchRequests: envNum("DS_INGEST_MAX_BATCH_REQS", 200),
    ingestMaxBatchBytes: envNum("DS_INGEST_MAX_BATCH_BYTES", 8 * 1024 * 1024),
    ingestMaxQueueRequests: envNum("DS_INGEST_MAX_QUEUE_REQS", 50000),
    ingestMaxQueueBytes: envNum("DS_INGEST_MAX_QUEUE_BYTES", 64 * 1024 * 1024),
    ingestBusyTimeoutMs: envNum("DS_INGEST_BUSY_MS", 5000),
    localBacklogMaxBytes,
    memoryLimitBytes,
    sqliteCacheBytes,
    objectStoreTimeoutMs: envNum("DS_OBJECTSTORE_TIMEOUT_MS", 5000),
    objectStoreRetries: envNum("DS_OBJECTSTORE_RETRIES", 3),
    objectStoreBaseDelayMs: envNum("DS_OBJECTSTORE_RETRY_BASE_MS", 50),
    objectStoreMaxDelayMs: envNum("DS_OBJECTSTORE_RETRY_MAX_MS", 2000),
    expirySweepIntervalMs: envNum("DS_EXPIRY_SWEEP_MS", 60000),
    expirySweepBatchLimit: envNum("DS_EXPIRY_SWEEP_LIMIT", 100),
    metricsFlushIntervalMs: envNum("DS_METRICS_FLUSH_MS", 1e4),
    interpreterWorkers: envNum("DS_INTERPRETER_WORKERS", 1),
    interpreterCheckIntervalMs: envNum("DS_INTERPRETER_CHECK_MS", 250),
    interpreterMaxBatchRows: envNum("DS_INTERPRETER_MAX_BATCH_ROWS", 500),
    interpreterMaxBatchBytes: envNum("DS_INTERPRETER_MAX_BATCH_BYTES", 4 * 1024 * 1024),
    port: envNum("PORT", 8080)
  };
}

// src/local/state.ts
import { closeSync as closeSync2, existsSync as existsSync4, mkdirSync as mkdirSync2, openSync as openSync2, readFileSync, readdirSync as readdirSync2, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";
import lockfile from "proper-lockfile";

// src/local/paths.ts
import envPaths from "env-paths";
import { join as join2, resolve as resolve2 } from "node:path";
function normalizeServerName(name) {
  const trimmed = (name ?? "default").trim();
  if (trimmed.length === 0)
    return "default";
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw dsError(`invalid server name: ${name}`);
  }
  return trimmed;
}
function getDurableStreamsDataRoot() {
  const override = process.env.DS_LOCAL_DATA_ROOT;
  if (override && override.trim().length > 0)
    return resolve2(override);
  const root = envPaths("prisma-dev").data;
  return join2(root, "durable-streams");
}
function getServerDataDir(name) {
  return join2(getDurableStreamsDataRoot(), normalizeServerName(name));
}

// src/local/state.ts
function getDataDir(name) {
  return getServerDataDir(name);
}
function getDbPath(name) {
  return join3(getDataDir(name), "durable-streams.sqlite");
}
function getServerDumpPath(name) {
  return join3(getDataDir(name), "server.json");
}
function getLockPath(name) {
  return join3(getDataDir(name), "server.lock");
}
function ensureFile(path) {
  const fd = openSync2(path, "a");
  closeSync2(fd);
}
async function acquireLock(name) {
  const normalized = normalizeServerName(name);
  const dataDir = getDataDir(normalized);
  mkdirSync2(dataDir, { recursive: true });
  const lockPath = getLockPath(normalized);
  ensureFile(lockPath);
  const release = await lockfile.lock(lockPath, {
    realpath: false,
    stale: 30000,
    retries: { retries: 0 }
  });
  return async () => {
    try {
      await release();
    } catch {}
  };
}
function writeServerDump(name, dump) {
  const normalized = normalizeServerName(name);
  const dataDir = getDataDir(normalized);
  mkdirSync2(dataDir, { recursive: true });
  writeFileSync(getServerDumpPath(normalized), `${JSON.stringify(dump, null, 2)}
`, "utf8");
}

// src/local/config.ts
function buildLocalConfig(args) {
  const name = normalizeServerName(args.name);
  const dataDir = getDataDir(name);
  const dbPath = getDbPath(name);
  const base = loadConfig();
  const port = args.port == null ? 0 : Math.max(0, Math.floor(args.port));
  return {
    ...base,
    rootDir: dataDir,
    dbPath,
    port,
    segmentCacheMaxBytes: 0,
    segmenterWorkers: 0,
    interpreterCheckIntervalMs: Math.min(base.interpreterCheckIntervalMs, 5)
  };
}

// src/local/http.ts
import { createServer } from "node:http";
import { Readable } from "node:stream";
function hasBody(method) {
  const upper = method.toUpperCase();
  return upper !== "GET" && upper !== "HEAD";
}
function requestFromNode(req, opts) {
  const method = (req.method ?? "GET").toUpperCase();
  const host = req.headers.host ?? `${opts.hostname ?? "127.0.0.1"}:${opts.port}`;
  const url = `http://${host}${req.url ?? "/"}`;
  const init = {
    method,
    headers: req.headers
  };
  if (hasBody(method)) {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}
async function writeNodeResponse(req, res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body || req.method?.toUpperCase() === "HEAD") {
    res.end();
    return;
  }
  const body = Readable.fromWeb(response.body);
  await new Promise((resolve3, reject) => {
    body.on("error", reject);
    res.on("error", reject);
    res.on("finish", () => resolve3());
    body.pipe(res);
  });
}
async function serveFetchHandler(fetchHandler, opts) {
  if (typeof globalThis.Bun !== "undefined") {
    const server2 = Bun.serve({
      hostname: opts.hostname,
      port: opts.port,
      idleTimeout: 65,
      fetch: fetchHandler
    });
    return {
      port: server2.port ?? opts.port,
      close: async () => {
        server2.stop(true);
      }
    };
  }
  const hostname = opts.hostname ?? "127.0.0.1";
  const server = createServer(async (req, res) => {
    try {
      const request = requestFromNode(req, { hostname, port: opts.port });
      const response = await fetchHandler(request);
      await writeNodeResponse(req, res, response);
    } catch (err) {
      console.error("local fetch handler failed", err);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "internal", message: "internal server error" } }));
    }
  });
  await new Promise((resolve3, reject) => {
    server.once("error", reject);
    server.listen(opts.port, hostname, () => {
      server.off("error", reject);
      resolve3();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  return {
    port,
    close: async () => {
      await new Promise((resolve3, reject) => {
        server.close((err) => err ? reject(err) : resolve3());
      });
    }
  };
}

// src/local/server.ts
async function startLocalDurableStreamsServer(opts = {}) {
  const name = normalizeServerName(opts.name);
  const hostname = opts.hostname ?? "127.0.0.1";
  const releaseLock = await acquireLock(name);
  let app = null;
  let http = null;
  let closed = false;
  try {
    const cfg = buildLocalConfig({ name, port: opts.port });
    app = createLocalApp(cfg);
    http = await serveFetchHandler(app.fetch, { hostname, port: cfg.port });
    const exportsPayload = {
      name,
      pid: process.pid,
      http: {
        port: http.port,
        url: `http://${hostname}:${http.port}`
      },
      sqlite: {
        path: getDbPath(name)
      }
    };
    const dump = {
      version: 1,
      name,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      http: exportsPayload.http,
      sqlite: exportsPayload.sqlite
    };
    writeServerDump(name, dump);
    return {
      exports: exportsPayload,
      close: async () => {
        if (closed)
          return;
        closed = true;
        try {
          if (http)
            await http.close();
        } finally {
          try {
            app?.close();
          } finally {
            await releaseLock();
          }
        }
      }
    };
  } catch (err) {
    try {
      if (http)
        await http.close();
    } catch {}
    try {
      app?.close();
    } catch {}
    await releaseLock();
    throw err;
  }
}

export { parseLocalProcessOptions, startLocalDurableStreamsServer };
