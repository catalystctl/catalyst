import{c as P}from"./chunk-62DM64XC.js";import{g as _}from"./chunk-X3G665AK.js";import{f as b}from"./chunk-DWY47FQV.js";import{filename as K}from"pathe/utils";import{protocol as L}from"@electric-sql/pglite";var u="_prisma_dev_wal",T="events",D="install_all_triggers",y="capture_event",A="prisma_dev_wal_capture",p=new WeakMap,F=new Set(["ALTER","COMMIT","COPY","CREATE","DELETE","DROP","INSERT","MERGE","TRUNCATE","UPDATE"]);async function R(e,t){let a=p.get(e);if(a&&!a.closed)return a.bridge;let r=e.execProtocolRaw.bind(e),n=e.execProtocolRawStream.bind(e),o={bridge:{close:async()=>{o.closed||(o.closed=!0,o.subscribers.clear(),e.execProtocolRaw===E&&(e.execProtocolRaw=r),e.execProtocolRawStream===m&&(e.execProtocolRawStream=n),await o.pollPromise,p.delete(e))},poll:async()=>{await w(o,e)},subscribe:i=>(o.subscribers.add(i),()=>{o.subscribers.delete(i)})},closed:!1,ensureInfrastructurePromise:null,pendingPoll:!1,pollPromise:null,subscribers:new Set,suppressDepth:0},E=async(i,s)=>{let l=await r(i,s);return!o.closed&&o.suppressDepth===0&&I(l)&&w(o,e),l},m=async(i,s)=>{let l=[],d=new L.Parser,g=s?.onRawData;await n(i,{...s,onRawData:f=>{d.parse(f,M=>{l.push(M)}),g?.(f)}}),!o.closed&&o.suppressDepth===0&&N(l)&&w(o,e)};return e.execProtocolRaw=E,e.execProtocolRawStream=m,p.set(e,o),await v(o,e),o.bridge}async function O(e){let t=p.get(e);t&&await t.bridge.close()}function N(e){for(let t of e){if(t.name!=="commandComplete"||typeof t.text!="string")continue;let a=t.text.split(/\s+/,1)[0]?.toUpperCase();if(a&&F.has(a))return!0}return!1}function I(e){if(e.length===0)return!1;let t=[];return new L.Parser().parse(e,r=>{t.push(r)}),N(t)}async function v(e,t){e.ensureInfrastructurePromise??=S(e,t,async()=>{await t.exec(`CREATE SCHEMA IF NOT EXISTS "${u}"`),await t.exec(`
      CREATE TABLE IF NOT EXISTS "${u}"."${T}" (
        id BIGSERIAL PRIMARY KEY,
        txid BIGINT NOT NULL DEFAULT txid_current(),
        schema_name TEXT NOT NULL,
        table_name TEXT NOT NULL,
        op TEXT NOT NULL,
        row_data JSONB,
        old_row_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `),await t.exec(`
      CREATE OR REPLACE FUNCTION "${u}"."${y}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_TABLE_SCHEMA = '${u}' THEN
          RETURN COALESCE(NEW, OLD);
        END IF;

        INSERT INTO "${u}"."${T}" (
          txid,
          schema_name,
          table_name,
          op,
          row_data,
          old_row_data
        )
        VALUES (
          txid_current(),
          TG_TABLE_SCHEMA,
          TG_TABLE_NAME,
          lower(TG_OP),
          CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
          CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END
        );

        RETURN COALESCE(NEW, OLD);
      END;
      $$;
    `),await t.exec(`
      CREATE OR REPLACE FUNCTION "${u}"."${D}"()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      DECLARE
        target REGCLASS;
      BEGIN
        FOR target IN
          SELECT c.oid::regclass
          FROM pg_class AS c
          JOIN pg_namespace AS n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p')
            AND n.nspname NOT IN ('${u}', 'information_schema', 'pg_catalog')
            AND n.nspname NOT LIKE 'pg_temp_%'
            AND n.nspname NOT LIKE 'pg_toast%'
        LOOP
          IF EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgrelid = target
              AND tgname = '${A}'
          ) THEN
            CONTINUE;
          END IF;

          EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION "${u}"."${y}"()',
            '${A}',
            target::text
          );
        END LOOP;
      END;
      $$;
    `),await h(e,t)}),await e.ensureInfrastructurePromise}async function h(e,t){await S(e,t,async()=>{await t.query(`SELECT "${u}"."${D}"()`)})}async function H(e,t){await v(e,t),await h(e,t);let a=await S(e,t,async()=>await t.query(`
      WITH drained AS (
        DELETE FROM "${u}"."${T}"
        RETURNING txid, schema_name, table_name, op, row_data, old_row_data, id
      )
      SELECT txid, schema_name, table_name, op, row_data, old_row_data
      FROM drained
      ORDER BY id
    `));if(a.rows.length===0||e.subscribers.size===0)return;let r=a.rows.map(q);for(let n of e.subscribers)queueMicrotask(()=>{if(!e.closed&&e.subscribers.has(n))try{n(r)}catch(o){console.error("[WAL bridge] subscriber failed",o)}})}async function w(e,t){if(!e.closed){if(e.pollPromise){e.pendingPoll=!0,await e.pollPromise;return}e.pollPromise=(async()=>{do e.pendingPoll=!1,await H(e,t);while(e.pendingPoll&&!e.closed)})().finally(()=>{e.pollPromise=null}),await e.pollPromise}}async function S(e,t,a){e.suppressDepth+=1;try{return await a()}finally{e.suppressDepth-=1,e.suppressDepth===0&&!e.closed&&p.get(t)!==e&&(e.closed=!0)}}function q(e){return{oldRecord:e.old_row_data,record:e.row_data,schema:e.schema_name,table:e.table_name,txid:String(e.txid),type:X(e.op)}}function X(e){switch(e.toLowerCase()){case"delete":return"delete";case"insert":return"insert";case"update":return"update";default:throw new Error(`Unsupported WAL bridge operation: ${e}`)}}var J=10,c={connectionLimit:J,connectTimeout:0,database:"template1",maxIdleConnectionLifetime:0,password:"postgres",poolTimeout:0,socketTimeout:0,sslMode:"disable",username:"postgres"},Y=`postgres://${c.username}:${c.password}@localhost`,B=new URLSearchParams({sslmode:c.sslMode}),Q=new URLSearchParams({...Object.fromEntries(B.entries()),connection_limit:String(c.connectionLimit),connect_timeout:String(c.connectTimeout),max_idle_connection_lifetime:String(c.maxIdleConnectionLifetime),pool_timeout:String(c.poolTimeout),socket_timeout:String(c.socketTimeout)});async function G(e){let{rows:t}=await e.query("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'postgres') AS exists");t[0]?.exists?await e.exec(`ALTER ROLE ${c.username} WITH LOGIN SUPERUSER PASSWORD '${c.password}'`):await e.exec(`CREATE ROLE ${c.username} WITH LOGIN SUPERUSER PASSWORD '${c.password}'`),await e.exec(`SET ROLE ${c.username}`)}async function se(e,t){let a=e==="database"?t.databasePort:t.shadowDatabasePort;if(t.dryRun)return $(e,t,{db:null,port:a,server:null});let{debug:r}=t,o=await(e==="shadow_database"?j:W)(t.pgliteDataDirPath,r);r&&o.onNotification((l,d)=>{console.debug(`[${e}][${l}] ${d}`)});let{PGLiteSocketServer:E}=await import("@electric-sql/pglite-socket"),m=e==="shadow_database"?t.shadowDatabaseIdleTimeoutMillis:t.databaseIdleTimeoutMillis,i=new E({db:o,debug:r,idleTimeout:Number.isFinite(m)?m:0,inspect:r,maxConnections:c.connectionLimit,port:a});r&&(i.addEventListener("listening",l=>{let{detail:d}=l;console.debug(`[${e}] server listening on ${JSON.stringify(d)}`)}),i.addEventListener("connection",l=>{let{clientAddress:d,clientPort:g}=l.detail;console.debug(`[${e}] client connected from ${d}:${g}`)}),i.addEventListener("error",l=>{let{detail:d}=l;console.error(`[${e}] server error:`,d)}));try{await i.start()}catch(l){throw l instanceof Error&&"code"in l&&l.code==="EADDRINUSE"?new _(a):l}let s=Number(i.getServerConn().split(":").at(1));return t[e==="database"?"databasePort":"shadowDatabasePort"]=s,$(e,t,{db:o,port:s,server:i})}function $(e,t,a){let{debug:r}=t,{db:n,port:o,server:E}=a||{},m=new Map;return r&&console.debug(`[${e}] server started on port ${o}`),{...c,attachWalEventBridge:async()=>{if(e!=="database"||!n)throw new Error("WAL bridge is only available for the primary database server");return await R(n)},close:async()=>{let i=[];try{await E?.stop(),r&&console.debug(`[${e}] server stopped on port ${o}`)}catch(s){console.error(`[${e}] server stop error`,s),i.push(s)}if(e==="database"){try{n&&await O(n),r&&console.debug(`[${e}] closed WAL bridge`)}catch(s){console.error(`[${e}] WAL bridge close error`,s),i.push(s)}try{await n?.syncToFs(),r&&console.debug(`[${e}] synced to filesystem`)}catch(s){console.error(`[${e}] sync error`,s),i.push(s)}}try{await n?.close(),r&&console.debug(`[${e}] closed`)}catch(s){console.error(`[${e}] close error`,s),i.push(s)}if(i.length>0)throw new AggregateError(i,`Failed to close ${e} properly`)},connectionString:x(o,B),dump:async i=>{e==="shadow_database"||!n||await V({db:n,debug:r,destinationPath:i})},getPrimaryKeyColumns:async(i,s)=>{if(e==="shadow_database"||!n)throw new Error("Primary key resolution is only available for the primary database server");let l=`${i}.${s}`,d=m.get(l);return d||(d=z(n,i,s).catch(g=>{throw m.delete(l),g}),m.set(l,d)),await d},port:o,prismaORMConnectionString:x(o,Q),terminalCommand:`PGPASSWORD=${c.password} PGSSLMODE=${c.sslMode} psql -h localhost -p ${o} -U ${c.username} -d ${c.database}`}}function x(e,t){return`${Y}:${e}/${c.database}?${t.toString()}`}async function W(e,t){let{PGlite:a}=await import("@electric-sql/pglite"),r=await P(),n=await a.create({database:c.database,dataDir:e,debug:t?5:void 0,extensions:r.extensions,fsBundle:r.fsBundle,relaxedDurability:!1,wasmModule:r.wasmModule});return await G(n),n}async function j(e,t){let{PGlite:a}=await import("@electric-sql/pglite"),r=await P(),n=await a.create({database:c.database,dataDir:"memory://",debug:t?5:void 0,extensions:r.extensions,fsBundle:r.fsBundle,relaxedDurability:!1,wasmModule:r.wasmModule});return await G(n),n}async function z(e,t,a){let{rows:r}=await e.query(`
    SELECT attribute.attname AS column_name
    FROM pg_constraint pk_constraint
    INNER JOIN pg_class relation
      ON relation.oid = pk_constraint.conrelid
    INNER JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    INNER JOIN unnest(pk_constraint.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
      ON TRUE
    INNER JOIN pg_attribute attribute
      ON attribute.attrelid = relation.oid
      AND attribute.attnum = keys.attnum
    WHERE pk_constraint.contype = 'p'
      AND namespace.nspname = ${C(t)}
      AND relation.relname = ${C(a)}
    ORDER BY keys.ordinality
  `);return r.map(n=>n.column_name)}function C(e){return`'${e.replaceAll("'","''")}'`}async function V(e){let{dataDir:t,db:a,debug:r,destinationPath:n}=e,o=a||await W(t,r),{pgDump:E}=await import("@electric-sql/pglite-tools/pg_dump"),m=await E({args:["--schema-only","--no-owner"],fileName:n?K(n):void 0,pg:await o.clone()});return n?(r&&console.debug(`[DB] Dumping database to ${n}`),await b(m,n)):(r&&console.debug("[DB] Dumping database to memory"),await m.text())}export{R as a,N as b,I as c,se as d,V as e};
