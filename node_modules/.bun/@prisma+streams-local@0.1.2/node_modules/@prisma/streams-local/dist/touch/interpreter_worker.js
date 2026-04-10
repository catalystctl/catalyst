// src/touch/interpreter_worker.ts
import { parentPort, workerData } from "node:worker_threads";
import { Result as Result4 } from "better-result";

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
import { createRequire } from "node:module";

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
var require2 = createRequire(import.meta.url);
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
function setSqliteRuntimeOverride(runtime) {
  runtimeOverride = runtime;
  if (runtimeOverride && openImplRuntime && runtimeOverride !== openImplRuntime) {
    openImpl = null;
    openImplRuntime = null;
  }
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

// src/util/log.ts
var patched = false;
function wrapConsole(orig, level) {
  return (...args) => {
    const prefix = `[${new Date().toISOString()}] [${level}]`;
    if (args.length === 0)
      return orig(prefix);
    return orig(prefix, ...args);
  };
}
function initConsoleLogging() {
  if (patched)
    return;
  patched = true;
  const globalAny = globalThis;
  if (globalAny.__ds_console_patched)
    return;
  globalAny.__ds_console_patched = true;
  console.log = wrapConsole(console.log.bind(console), "INFO");
  console.info = wrapConsole(console.info.bind(console), "INFO");
  console.warn = wrapConsole(console.warn.bind(console), "WARN");
  console.error = wrapConsole(console.error.bind(console), "ERROR");
  if (console.debug)
    console.debug = wrapConsole(console.debug.bind(console), "DEBUG");
}

// src/touch/engine.ts
function interpretRecordToChanges(record, _cfg) {
  return interpretStateProtocolRecord(record);
}
function interpretStateProtocolRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return [];
  const headers = record.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers))
    return [];
  if (typeof headers.control === "string")
    return [];
  const opRaw = headers.operation;
  if (typeof opRaw !== "string")
    return [];
  const op = opRaw;
  if (op !== "insert" && op !== "update" && op !== "delete")
    return [];
  const type = record.type;
  const key = record.key;
  if (typeof type !== "string" || type.trim() === "")
    return [];
  if (typeof key !== "string" || key.trim() === "")
    return [];
  const before = Object.prototype.hasOwnProperty.call(record, "oldValue") ? record.oldValue : Object.prototype.hasOwnProperty.call(record, "old_value") ? record.old_value : undefined;
  const after = Object.prototype.hasOwnProperty.call(record, "value") ? record.value : undefined;
  return [{ entity: type, key, op, before, after }];
}

// src/runtime/hash.ts
import { Result as Result2 } from "better-result";
import { createRequire as createRequire2 } from "node:module";
import { fileURLToPath } from "node:url";
var xxh3Hasher = null;
var xxh64Hasher = null;
var xxh32Hasher = null;
var isBunRuntime = typeof globalThis.Bun !== "undefined";
var require3 = createRequire2(import.meta.url);
function loadVendoredModule(name) {
  const path = fileURLToPath(new URL(`./hash_vendor/${name}`, import.meta.url));
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
function bunHash64(input, fn) {
  return fn(input);
}
function nodeHash64Result(input, hasher, label) {
  if (!hasher)
    return Result2.err({ kind: "hasher_not_initialized", message: `${label} hasher not initialized` });
  hasher.init();
  hasher.update(input);
  const digest = hasher.digest("hex");
  return Result2.ok(toBigIntDigest(digest));
}
function xxh3BigIntResult(input) {
  if (isBunRuntime)
    return Result2.ok(bunHash64(input, (x) => Bun.hash.xxHash3(x)));
  return nodeHash64Result(input, xxh3Hasher, "xxh3");
}
function xxh3BigInt(input) {
  const res = xxh3BigIntResult(input);
  if (Result2.isError(res))
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
function tableKeyIdFor(entity) {
  return xxh3Low32(concat([utf8("tbl\x00"), utf8(entity)]));
}
function templateKeyIdFor(templateIdHex16) {
  const tplBytes = encodeU64Be(BigInt(`0x${templateIdHex16}`));
  return xxh3Low32(concat([utf8("tpl\x00"), tplBytes]));
}
function watchKeyIdFor(templateIdHex16, encodedArgs) {
  const tplBytes = encodeU64Be(BigInt(`0x${templateIdHex16}`));
  const parts = [utf8("key\x00"), tplBytes];
  for (const a of encodedArgs) {
    parts.push(utf8("\x00"));
    parts.push(utf8(a));
  }
  return xxh3Low32(concat(parts));
}
function encodeTemplateArg(value, encoding) {
  if (value === null || value === undefined)
    return null;
  switch (encoding) {
    case "string": {
      if (typeof value === "string")
        return value;
      if (typeof value === "number" && Number.isFinite(value))
        return String(value);
      if (typeof value === "boolean")
        return value ? "true" : "false";
      return null;
    }
    case "int64": {
      if (typeof value === "bigint")
        return value.toString();
      if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value))
        return String(value);
      if (typeof value === "string" && /^-?(0|[1-9][0-9]*)$/.test(value.trim()))
        return value.trim();
      return null;
    }
    case "bool": {
      if (typeof value !== "boolean")
        return null;
      return value ? "1" : "0";
    }
    case "datetime": {
      if (typeof value !== "string")
        return null;
      const d = new Date(value);
      if (!Number.isFinite(d.getTime()))
        return null;
      return d.toISOString();
    }
    case "bytes": {
      if (typeof value !== "string")
        return null;
      return value;
    }
  }
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

// src/touch/spec.ts
import { Result as Result3 } from "better-result";
function isTouchEnabled(cfg) {
  return !!cfg?.touch?.enabled;
}

// src/touch/interpreter_worker.ts
initConsoleLogging();
var data = workerData;
var cfg = data.config;
setSqliteRuntimeOverride(data.hostRuntime ?? null);
var db = new SqliteDurableStore(cfg.dbPath, { cacheBytes: cfg.sqliteCacheBytes, skipMigrations: true });
var decoder = new TextDecoder;
async function handleProcess(msg) {
  const { stream, fromOffset, toOffset, interpreter, maxRows, maxBytes } = msg;
  const failProcess = (message) => {
    const err = Result4.err({ kind: "missing_old_value", message });
    parentPort?.postMessage({
      type: "error",
      id: msg.id,
      stream,
      message: err.error.message
    });
  };
  if (!isTouchEnabled(interpreter)) {
    parentPort?.postMessage({
      type: "error",
      id: msg.id,
      stream,
      message: "touch not enabled for interpreter"
    });
    return;
  }
  const touch = interpreter.touch;
  const fineBudgetRaw = msg.fineTouchBudget ?? touch.fineTouchBudgetPerBatch;
  const fineBudget = fineBudgetRaw == null ? null : Math.max(0, Math.floor(fineBudgetRaw));
  const fineGranularity = msg.fineGranularity === "template" ? "template" : "key";
  const interpretMode = msg.interpretMode === "hotTemplatesOnly" ? "hotTemplatesOnly" : "full";
  const hotTemplatesOnly = fineGranularity === "template" && interpretMode === "hotTemplatesOnly";
  const emitFineTouches = msg.emitFineTouches !== false && fineBudget !== 0;
  let fineBudgetExhausted = fineBudget != null && fineBudget <= 0;
  let fineKeysBudgetRemaining = fineBudget;
  let fineTouchesSuppressedDueToBudget = false;
  const filterHotTemplates = msg.filterHotTemplates === true;
  const hotTemplateIdsRaw = filterHotTemplates ? msg.hotTemplateIds ?? [] : [];
  const hotTemplateIds = filterHotTemplates ? new Set(hotTemplateIdsRaw.filter((x) => typeof x === "string" && /^[0-9a-f]{16}$/.test(x))) : null;
  const coarseIntervalMs = Math.max(1, Math.floor(touch.coarseIntervalMs ?? 100));
  const coalesceWindowMs = Math.max(1, Math.floor(touch.touchCoalesceWindowMs ?? 100));
  const onMissingBefore = touch.onMissingBefore ?? "coarse";
  const templatesByEntity = new Map;
  const coldTemplateCountByEntity = new Map;
  if (emitFineTouches) {
    try {
      const rows = db.db.query(`SELECT template_id, entity, fields_json, encodings_json, active_from_source_offset
           FROM live_templates
           WHERE stream=? AND state='active';`).all(stream);
      for (const row of rows) {
        const templateId = String(row.template_id ?? "");
        if (!/^[0-9a-f]{16}$/.test(templateId))
          continue;
        const entity = String(row.entity ?? "");
        if (entity.trim() === "")
          continue;
        let fields;
        let encodings;
        try {
          fields = JSON.parse(String(row.fields_json ?? "[]"));
          encodings = JSON.parse(String(row.encodings_json ?? "[]"));
        } catch {
          continue;
        }
        if (!Array.isArray(fields) || !Array.isArray(encodings) || fields.length !== encodings.length)
          continue;
        const f = fields.map(String);
        const e = encodings.map(String);
        if (f.length === 0 || f.length > 3)
          continue;
        if (!e.every((x) => x === "string" || x === "int64" || x === "bool" || x === "datetime" || x === "bytes"))
          continue;
        if (hotTemplateIds && !hotTemplateIds.has(templateId)) {
          coldTemplateCountByEntity.set(entity, (coldTemplateCountByEntity.get(entity) ?? 0) + 1);
          continue;
        }
        const activeFromSourceOffset = typeof row.active_from_source_offset === "bigint" ? row.active_from_source_offset : BigInt(row.active_from_source_offset ?? 0);
        const tpl = { templateId, entity, fields: f, encodings: e, activeFromSourceOffset };
        const arr = templatesByEntity.get(entity) ?? [];
        arr.push(tpl);
        templatesByEntity.set(entity, arr);
      }
    } catch {}
  }
  let rowsRead = 0;
  let bytesRead = 0;
  let changes = 0;
  let maxSourceTsMs = 0;
  let processedThrough = fromOffset - 1n;
  const pending = new Map;
  const templateOnlyEntityTouch = new Map;
  const touches = [];
  let fineTouchesDroppedDueToBudget = 0;
  let fineTouchesSkippedColdTemplate = 0;
  const flush = (_mapKey, p) => {
    touches.push({ keyId: p.keyId >>> 0, watermark: p.watermark, entity: p.entity, kind: p.kind, templateId: p.templateId });
  };
  const queueTouch = (args) => {
    const mapKey = `i:${args.keyId >>> 0}`;
    const prev = pending.get(mapKey);
    if (args.kind !== "table" && fineBudget != null && !fineBudgetExhausted && !prev) {
      const remaining = fineKeysBudgetRemaining ?? 0;
      if (remaining <= 0) {
        fineBudgetExhausted = true;
        fineTouchesSuppressedDueToBudget = true;
        fineTouchesDroppedDueToBudget += 1;
        return;
      }
      fineKeysBudgetRemaining = remaining - 1;
    } else if (args.kind !== "table" && fineBudget != null && !prev && fineBudgetExhausted) {
      fineTouchesSuppressedDueToBudget = true;
      fineTouchesDroppedDueToBudget += 1;
      return;
    }
    if (!prev) {
      pending.set(mapKey, {
        keyId: args.keyId >>> 0,
        windowStartMs: args.tsMs,
        watermark: args.watermark,
        entity: args.entity,
        kind: args.kind,
        templateId: args.templateId
      });
      return;
    }
    if (args.tsMs - prev.windowStartMs < args.windowMs) {
      prev.watermark = args.watermark;
      return;
    }
    flush(mapKey, prev);
    pending.set(mapKey, {
      keyId: args.keyId >>> 0,
      windowStartMs: args.tsMs,
      watermark: args.watermark,
      entity: args.entity,
      kind: args.kind,
      templateId: args.templateId
    });
  };
  for (const row of db.iterWalRange(stream, fromOffset, toOffset)) {
    const payload = row.payload;
    const payloadLen = payload.byteLength;
    if (rowsRead > 0 && (rowsRead >= maxRows || bytesRead + payloadLen > maxBytes))
      break;
    rowsRead++;
    bytesRead += payloadLen;
    const offset = typeof row.offset === "bigint" ? row.offset : BigInt(row.offset);
    processedThrough = offset;
    const tsMsRaw = row.ts_ms;
    const tsMs = typeof tsMsRaw === "bigint" ? Number(tsMsRaw) : Number(tsMsRaw);
    if (!Number.isFinite(tsMs))
      continue;
    if (tsMs > maxSourceTsMs)
      maxSourceTsMs = tsMs;
    let value;
    try {
      value = JSON.parse(decoder.decode(payload));
    } catch {
      continue;
    }
    const canonical = interpretRecordToChanges(value, interpreter);
    changes += canonical.length;
    if (canonical.length === 0)
      continue;
    const watermark = offset.toString();
    for (const ch of canonical) {
      const entity = ch.entity;
      const coarseKeyId = tableKeyIdFor(entity);
      queueTouch({
        keyId: coarseKeyId,
        tsMs,
        watermark,
        entity,
        kind: "table",
        windowMs: coarseIntervalMs
      });
      if (!emitFineTouches)
        continue;
      if (fineBudgetExhausted)
        continue;
      const tpls = templatesByEntity.get(entity);
      if (filterHotTemplates) {
        fineTouchesSkippedColdTemplate += coldTemplateCountByEntity.get(entity) ?? 0;
      }
      if (!tpls || tpls.length === 0)
        continue;
      if (hotTemplatesOnly) {
        const prev = templateOnlyEntityTouch.get(entity);
        if (!prev || offset > prev.offset)
          templateOnlyEntityTouch.set(entity, { offset, tsMs, watermark });
        continue;
      }
      for (const tpl of tpls) {
        if (fineBudgetExhausted)
          break;
        if (offset < tpl.activeFromSourceOffset)
          continue;
        if (fineGranularity === "template") {
          queueTouch({
            keyId: templateKeyIdFor(tpl.templateId) >>> 0,
            tsMs,
            watermark,
            entity,
            kind: "template",
            templateId: tpl.templateId,
            windowMs: coalesceWindowMs
          });
          if (fineBudgetExhausted)
            break;
          continue;
        }
        const afterObj = ch.after;
        const beforeObj = ch.before;
        const watchKeyIds = new Set;
        const compute = (obj) => {
          if (!obj || typeof obj !== "object" || Array.isArray(obj))
            return null;
          const args = [];
          for (let i = 0;i < tpl.fields.length; i++) {
            const name = tpl.fields[i];
            const enc = tpl.encodings[i];
            const v = obj[name];
            const encoded = encodeTemplateArg(v, enc);
            if (encoded == null)
              return null;
            args.push(encoded);
          }
          return watchKeyIdFor(tpl.templateId, args) >>> 0;
        };
        if (ch.op === "insert") {
          const k = compute(afterObj);
          if (k != null)
            watchKeyIds.add(k >>> 0);
        } else if (ch.op === "delete") {
          const k = compute(beforeObj);
          if (k != null)
            watchKeyIds.add(k >>> 0);
        } else {
          const kAfter = compute(afterObj);
          const kBefore = compute(beforeObj);
          if (kBefore != null) {
            watchKeyIds.add(kBefore >>> 0);
            if (kAfter != null)
              watchKeyIds.add(kAfter >>> 0);
          } else {
            if (beforeObj === undefined) {
              if (onMissingBefore === "error") {
                failProcess(`missing oldValue for update (entity=${entity}, templateId=${tpl.templateId})`);
                return;
              }
            } else {
              if (onMissingBefore === "error") {
                failProcess(`oldValue missing required fields for update (entity=${entity}, templateId=${tpl.templateId})`);
                return;
              }
            }
            if (onMissingBefore === "skipBefore") {
              if (kAfter != null)
                watchKeyIds.add(kAfter >>> 0);
            } else {}
          }
        }
        for (const watchKeyId of watchKeyIds) {
          queueTouch({
            keyId: watchKeyId >>> 0,
            tsMs,
            watermark,
            entity,
            kind: "template",
            templateId: tpl.templateId,
            windowMs: coalesceWindowMs
          });
          if (fineBudgetExhausted)
            break;
        }
      }
    }
  }
  if (emitFineTouches && hotTemplatesOnly && !fineBudgetExhausted && templateOnlyEntityTouch.size > 0) {
    for (const [entity, agg] of templateOnlyEntityTouch.entries()) {
      if (fineBudgetExhausted)
        break;
      const tpls = templatesByEntity.get(entity);
      if (!tpls || tpls.length === 0)
        continue;
      for (const tpl of tpls) {
        if (fineBudgetExhausted)
          break;
        if (agg.offset < tpl.activeFromSourceOffset)
          continue;
        queueTouch({
          keyId: templateKeyIdFor(tpl.templateId) >>> 0,
          tsMs: agg.tsMs,
          watermark: agg.watermark,
          entity,
          kind: "template",
          templateId: tpl.templateId,
          windowMs: coalesceWindowMs
        });
      }
    }
  }
  for (const [key, p] of pending.entries()) {
    flush(key, p);
  }
  touches.sort((a, b) => {
    const ak = a.keyId >>> 0;
    const bk = b.keyId >>> 0;
    if (ak < bk)
      return -1;
    if (ak > bk)
      return 1;
    const aw = BigInt(a.watermark);
    const bw = BigInt(b.watermark);
    if (aw < bw)
      return -1;
    if (aw > bw)
      return 1;
    return 0;
  });
  let tableTouchesEmitted = 0;
  let templateTouchesEmitted = 0;
  for (const t of touches) {
    if (t.kind === "table")
      tableTouchesEmitted++;
    else
      templateTouchesEmitted++;
  }
  parentPort?.postMessage({
    type: "result",
    id: msg.id,
    stream,
    processedThrough,
    touches,
    stats: {
      rowsRead,
      bytesRead,
      changes,
      touchesEmitted: touches.length,
      tableTouchesEmitted,
      templateTouchesEmitted,
      maxSourceTsMs,
      fineTouchesDroppedDueToBudget,
      fineTouchesSuppressedDueToBudget,
      fineTouchesSkippedColdTemplate
    }
  });
}
parentPort?.on("message", (msg) => {
  if (!msg || typeof msg !== "object")
    return;
  if (msg.type === "stop") {
    try {
      db.close();
    } catch {}
    try {
      parentPort?.postMessage({ type: "stopped" });
    } catch {}
    return;
  }
  if (msg.type === "process") {
    handleProcess(msg).catch((e) => {
      try {
        parentPort?.postMessage({
          type: "error",
          id: msg.id,
          stream: msg.stream,
          message: String(e?.message ?? e),
          stack: e?.stack ? String(e.stack) : undefined
        });
      } catch {}
    });
  }
});
