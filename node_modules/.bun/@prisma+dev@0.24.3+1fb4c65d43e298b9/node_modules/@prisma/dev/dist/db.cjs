"use strict";var Ee=Object.create;var A=Object.defineProperty;var ye=Object.getOwnPropertyDescriptor;var we=Object.getOwnPropertyNames;var Re=Object.getPrototypeOf,Se=Object.prototype.hasOwnProperty;var he=(e,t)=>{for(var r in t)A(e,r,{get:t[r],enumerable:!0})},q=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of we(t))!Se.call(e,o)&&o!==r&&A(e,o,{get:()=>t[o],enumerable:!(n=ye(t,o))||n.enumerable});return e};var g=(e,t,r)=>(r=e!=null?Ee(Re(e)):{},q(t||!e||!e.__esModule?A(r,"default",{value:e,enumerable:!0}):r,e)),Te=e=>q(A({},"__esModule",{value:!0}),e);var et={};he(et,{attachWalEventBridge:()=>O,dumpDB:()=>Pe,shouldPollWalAfterMessages:()=>x,shouldPollWalAfterResponse:()=>F,startDBServer:()=>Ve});module.exports=Te(et);var Ae=()=>typeof document>"u"?new URL(`file:${__filename}`).href:document.currentScript&&document.currentScript.tagName.toUpperCase()==="SCRIPT"?document.currentScript.src:new URL("main.js",document.baseURI).href,f=Ae();var me=require("pathe/utils");var v=require("fs"),E=require("fs/promises"),H=require("util"),K=require("zlib");var a=g(require("path"),1),U=g(require("os"),1),_=g(require("process"),1),b=U.default.homedir(),B=U.default.tmpdir(),{env:R}=_.default,_e=e=>{let t=a.default.join(b,"Library");return{data:a.default.join(t,"Application Support",e),config:a.default.join(t,"Preferences",e),cache:a.default.join(t,"Caches",e),log:a.default.join(t,"Logs",e),temp:a.default.join(B,e)}},ve=e=>{let t=R.APPDATA||a.default.join(b,"AppData","Roaming"),r=R.LOCALAPPDATA||a.default.join(b,"AppData","Local");return{data:a.default.join(r,e,"Data"),config:a.default.join(t,e,"Config"),cache:a.default.join(r,e,"Cache"),log:a.default.join(r,e,"Log"),temp:a.default.join(B,e)}},Le=e=>{let t=a.default.basename(b);return{data:a.default.join(R.XDG_DATA_HOME||a.default.join(b,".local","share"),e),config:a.default.join(R.XDG_CONFIG_HOME||a.default.join(b,".config"),e),cache:a.default.join(R.XDG_CACHE_HOME||a.default.join(b,".cache"),e),log:a.default.join(R.XDG_STATE_HOME||a.default.join(b,".local","state"),e),temp:a.default.join(B,t,e)}};function I(e,{suffix:t="nodejs"}={}){if(typeof e!="string")throw new TypeError(`Expected a string, got ${typeof e}`);return t&&(e+=`-${t}`),_.default.platform==="darwin"?_e(e):_.default.platform==="win32"?ve(e):Le(e)}var Ne=g(require("zeptomatch"),1),it=I("prisma-dev"),at=(0,H.promisify)(K.unzip);async function X(e,t){await e.stream().pipeTo(v.WriteStream.toWeb((0,v.createWriteStream)(t,{encoding:"utf8"})))}var $=require("get-port-please"),J=require("remeda");var L=class extends Error{constructor(r){super(`Port \`${r}\` is not available.`);this.port=r}name="PortNotAvailableError"};var S=require("fs"),y=require("fs/promises"),Q=require("module"),Z=require("path"),w=require("url"),De=(0,Q.createRequire)(f),Oe=["initdb.wasm","pglite.data","pglite.wasm"],ee={amcheck:"amcheck.tar.gz",bloom:"bloom.tar.gz",btree_gin:"btree_gin.tar.gz",btree_gist:"btree_gist.tar.gz",citext:"citext.tar.gz",cube:"cube.tar.gz",dict_int:"dict_int.tar.gz",dict_xsyn:"dict_xsyn.tar.gz",earthdistance:"earthdistance.tar.gz",file_fdw:"file_fdw.tar.gz",fuzzystrmatch:"fuzzystrmatch.tar.gz",hstore:"hstore.tar.gz",intarray:"intarray.tar.gz",isn:"isn.tar.gz",lo:"lo.tar.gz",ltree:"ltree.tar.gz",pageinspect:"pageinspect.tar.gz",pg_buffercache:"pg_buffercache.tar.gz",pg_freespacemap:"pg_freespacemap.tar.gz",pg_surgery:"pg_surgery.tar.gz",pg_trgm:"pg_trgm.tar.gz",pg_visibility:"pg_visibility.tar.gz",pg_walinspect:"pg_walinspect.tar.gz",seg:"seg.tar.gz",tablefunc:"tablefunc.tar.gz",tcn:"tcn.tar.gz",tsm_system_rows:"tsm_system_rows.tar.gz",tsm_system_time:"tsm_system_time.tar.gz",unaccent:"unaccent.tar.gz",uuid_ossp:"uuid-ossp.tar.gz",vector:"vector.tar.gz"},xe=[...Oe.map(e=>({fileName:e,kind:"core",name:e})),...Object.entries(ee).map(([e,t])=>({fileName:t,kind:"extension",name:e}))],D=new Map,Ue=Symbol.for("@prisma/dev/bundled-pglite-runtime-asset-sources"),N=null;async function G(){await ke();let e=te();if(e)return await Ge(e),await Be(e);let t=Me(),r=t.href,n=D.get(r);return n||(n=Ie(t),D.set(r,n)),await n}async function Be(e){let t=`bundled:${e.wasmModule.href}:${e.fsBundle.href}`,r=D.get(t);return r||(r=$e(e),D.set(t,r)),await r}async function Ie(e){let[t,r]=await Promise.all([(0,y.readFile)(new URL("pglite.data",e)),(0,y.readFile)(new URL("pglite.wasm",e))]),n=re();return{extensions:Object.fromEntries(Object.entries(ee).map(([o,s])=>[o,new URL(s,e)])),fsBundle:new Blob([Uint8Array.from(t)]),wasmModule:await n.compile(r)}}async function $e(e){let[t,r]=await Promise.all([V(e.fsBundle),V(e.wasmModule)]),n=re();return{extensions:e.extensions,fsBundle:new Blob([Uint8Array.from(t)]),wasmModule:await n.compile(r)}}async function Ge(e){if(e.initdbWasm.protocol!=="file:")return;let t=new URL("initdb.wasm",C(new URL("./",e.initdbWasm))),r=(0,w.fileURLToPath)(t);(0,S.existsSync)(r)||await(0,y.copyFile)((0,w.fileURLToPath)(e.initdbWasm),r)}function C(e){return e instanceof URL?Y(e):Y((0,w.pathToFileURL)(e))}function Y(e){return e.href.endsWith("/")?e:new URL(`${e.href}/`)}function Ce(){let e=De.resolve("@electric-sql/pglite");return C((0,Z.dirname)(e))}function Me(){let e=C(new URL("./",f));if(We(e))return e;if(Fe())return Ce();throw new Error("Unable to locate PGlite runtime assets. If you bundled @prisma/dev, copy them next to the bundle with copyPrismaDevRuntimeAssets().")}function We(e){return xe.every(t=>(0,S.existsSync)((0,w.fileURLToPath)(new URL(t.fileName,e))))}function te(){return globalThis[Ue]??null}async function ke(){!je()||te()||(N||(N=import("./runtime-assets-manifest.bun.js").then(()=>{}).catch(e=>{throw N=null,e})),await N)}function Fe(){let e=(0,w.fileURLToPath)(new URL("../package.json",f));if(!(0,S.existsSync)(e))return!1;try{return JSON.parse((0,S.readFileSync)(e,"utf8")).name==="@prisma/dev"}catch{return!1}}function je(){return typeof globalThis.Bun<"u"}function re(){let e=globalThis.WebAssembly;if(!e)throw new Error("WebAssembly is not available in this runtime.");return e}async function V(e){if(e.protocol==="file:")return await(0,y.readFile)(e);let t=await fetch(e);if(!t.ok)throw new Error(`Failed to fetch runtime asset ${e.href}: ${t.status} ${t.statusText}`);return new Uint8Array(await t.arrayBuffer())}var k=require("@electric-sql/pglite"),p="_prisma_dev_wal",W="events",se="install_all_triggers",ne="capture_event",oe="prisma_dev_wal_capture",T=new WeakMap,ze=new Set(["ALTER","COMMIT","COPY","CREATE","DELETE","DROP","INSERT","MERGE","TRUNCATE","UPDATE"]);async function O(e,t){let r=T.get(e);if(r&&!r.closed)return r.bridge;let n=e.execProtocolRaw.bind(e),o=e.execProtocolRawStream.bind(e),s={bridge:{close:async()=>{s.closed||(s.closed=!0,s.subscribers.clear(),e.execProtocolRaw===P&&(e.execProtocolRaw=n),e.execProtocolRawStream===m&&(e.execProtocolRawStream=o),await s.pollPromise,T.delete(e))},poll:async()=>{await M(s,e)},subscribe:i=>(s.subscribers.add(i),()=>{s.subscribers.delete(i)})},closed:!1,ensureInfrastructurePromise:null,pendingPoll:!1,pollPromise:null,subscribers:new Set,suppressDepth:0},P=async(i,c)=>{let l=await n(i,c);return!s.closed&&s.suppressDepth===0&&F(l)&&M(s,e),l},m=async(i,c)=>{let l=[],d=new k.protocol.Parser,h=c?.onRawData;await o(i,{...c,onRawData:z=>{d.parse(z,be=>{l.push(be)}),h?.(z)}}),!s.closed&&s.suppressDepth===0&&x(l)&&M(s,e)};return e.execProtocolRaw=P,e.execProtocolRawStream=m,T.set(e,s),await ae(s,e),s.bridge}async function ie(e){let t=T.get(e);t&&await t.bridge.close()}function x(e){for(let t of e){if(t.name!=="commandComplete"||typeof t.text!="string")continue;let r=t.text.split(/\s+/,1)[0]?.toUpperCase();if(r&&ze.has(r))return!0}return!1}function F(e){if(e.length===0)return!1;let t=[];return new k.protocol.Parser().parse(e,n=>{t.push(n)}),x(t)}async function ae(e,t){e.ensureInfrastructurePromise??=j(e,t,async()=>{await t.exec(`CREATE SCHEMA IF NOT EXISTS "${p}"`),await t.exec(`
      CREATE TABLE IF NOT EXISTS "${p}"."${W}" (
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
      CREATE OR REPLACE FUNCTION "${p}"."${ne}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_TABLE_SCHEMA = '${p}' THEN
          RETURN COALESCE(NEW, OLD);
        END IF;

        INSERT INTO "${p}"."${W}" (
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
      CREATE OR REPLACE FUNCTION "${p}"."${se}"()
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
            AND n.nspname NOT IN ('${p}', 'information_schema', 'pg_catalog')
            AND n.nspname NOT LIKE 'pg_temp_%'
            AND n.nspname NOT LIKE 'pg_toast%'
        LOOP
          IF EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgrelid = target
              AND tgname = '${oe}'
          ) THEN
            CONTINUE;
          END IF;

          EXECUTE format(
            'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION "${p}"."${ne}"()',
            '${oe}',
            target::text
          );
        END LOOP;
      END;
      $$;
    `),await ce(e,t)}),await e.ensureInfrastructurePromise}async function ce(e,t){await j(e,t,async()=>{await t.query(`SELECT "${p}"."${se}"()`)})}async function qe(e,t){await ae(e,t),await ce(e,t);let r=await j(e,t,async()=>await t.query(`
      WITH drained AS (
        DELETE FROM "${p}"."${W}"
        RETURNING txid, schema_name, table_name, op, row_data, old_row_data, id
      )
      SELECT txid, schema_name, table_name, op, row_data, old_row_data
      FROM drained
      ORDER BY id
    `));if(r.rows.length===0||e.subscribers.size===0)return;let n=r.rows.map(He);for(let o of e.subscribers)queueMicrotask(()=>{if(!e.closed&&e.subscribers.has(o))try{o(n)}catch(s){console.error("[WAL bridge] subscriber failed",s)}})}async function M(e,t){if(!e.closed){if(e.pollPromise){e.pendingPoll=!0,await e.pollPromise;return}e.pollPromise=(async()=>{do e.pendingPoll=!1,await qe(e,t);while(e.pendingPoll&&!e.closed)})().finally(()=>{e.pollPromise=null}),await e.pollPromise}}async function j(e,t,r){e.suppressDepth+=1;try{return await r()}finally{e.suppressDepth-=1,e.suppressDepth===0&&!e.closed&&T.get(t)!==e&&(e.closed=!0)}}function He(e){return{oldRecord:e.old_row_data,record:e.row_data,schema:e.schema_name,table:e.table_name,txid:String(e.txid),type:Ke(e.op)}}function Ke(e){switch(e.toLowerCase()){case"delete":return"delete";case"insert":return"insert";case"update":return"update";default:throw new Error(`Unsupported WAL bridge operation: ${e}`)}}var Xe=10,u={connectionLimit:Xe,connectTimeout:0,database:"template1",maxIdleConnectionLifetime:0,password:"postgres",poolTimeout:0,socketTimeout:0,sslMode:"disable",username:"postgres"},Je=`postgres://${u.username}:${u.password}@localhost`,pe=new URLSearchParams({sslmode:u.sslMode}),Ye=new URLSearchParams({...Object.fromEntries(pe.entries()),connection_limit:String(u.connectionLimit),connect_timeout:String(u.connectTimeout),max_idle_connection_lifetime:String(u.maxIdleConnectionLifetime),pool_timeout:String(u.poolTimeout),socket_timeout:String(u.socketTimeout)});async function ge(e){let{rows:t}=await e.query("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'postgres') AS exists");t[0]?.exists?await e.exec(`ALTER ROLE ${u.username} WITH LOGIN SUPERUSER PASSWORD '${u.password}'`):await e.exec(`CREATE ROLE ${u.username} WITH LOGIN SUPERUSER PASSWORD '${u.password}'`),await e.exec(`SET ROLE ${u.username}`)}async function Ve(e,t){let r=e==="database"?t.databasePort:t.shadowDatabasePort;if(t.dryRun)return le(e,t,{db:null,port:r,server:null});let{debug:n}=t,s=await(e==="shadow_database"?Qe:fe)(t.pgliteDataDirPath,n);n&&s.onNotification((l,d)=>{console.debug(`[${e}][${l}] ${d}`)});let{PGLiteSocketServer:P}=await import("@electric-sql/pglite-socket"),m=e==="shadow_database"?t.shadowDatabaseIdleTimeoutMillis:t.databaseIdleTimeoutMillis,i=new P({db:s,debug:n,idleTimeout:Number.isFinite(m)?m:0,inspect:n,maxConnections:u.connectionLimit,port:r});n&&(i.addEventListener("listening",l=>{let{detail:d}=l;console.debug(`[${e}] server listening on ${JSON.stringify(d)}`)}),i.addEventListener("connection",l=>{let{clientAddress:d,clientPort:h}=l.detail;console.debug(`[${e}] client connected from ${d}:${h}`)}),i.addEventListener("error",l=>{let{detail:d}=l;console.error(`[${e}] server error:`,d)}));try{await i.start()}catch(l){throw l instanceof Error&&"code"in l&&l.code==="EADDRINUSE"?new L(r):l}let c=Number(i.getServerConn().split(":").at(1));return t[e==="database"?"databasePort":"shadowDatabasePort"]=c,le(e,t,{db:s,port:c,server:i})}function le(e,t,r){let{debug:n}=t,{db:o,port:s,server:P}=r||{},m=new Map;return n&&console.debug(`[${e}] server started on port ${s}`),{...u,attachWalEventBridge:async()=>{if(e!=="database"||!o)throw new Error("WAL bridge is only available for the primary database server");return await O(o)},close:async()=>{let i=[];try{await P?.stop(),n&&console.debug(`[${e}] server stopped on port ${s}`)}catch(c){console.error(`[${e}] server stop error`,c),i.push(c)}if(e==="database"){try{o&&await ie(o),n&&console.debug(`[${e}] closed WAL bridge`)}catch(c){console.error(`[${e}] WAL bridge close error`,c),i.push(c)}try{await o?.syncToFs(),n&&console.debug(`[${e}] synced to filesystem`)}catch(c){console.error(`[${e}] sync error`,c),i.push(c)}}try{await o?.close(),n&&console.debug(`[${e}] closed`)}catch(c){console.error(`[${e}] close error`,c),i.push(c)}if(i.length>0)throw new AggregateError(i,`Failed to close ${e} properly`)},connectionString:ue(s,pe),dump:async i=>{e==="shadow_database"||!o||await Pe({db:o,debug:n,destinationPath:i})},getPrimaryKeyColumns:async(i,c)=>{if(e==="shadow_database"||!o)throw new Error("Primary key resolution is only available for the primary database server");let l=`${i}.${c}`,d=m.get(l);return d||(d=Ze(o,i,c).catch(h=>{throw m.delete(l),h}),m.set(l,d)),await d},port:s,prismaORMConnectionString:ue(s,Ye),terminalCommand:`PGPASSWORD=${u.password} PGSSLMODE=${u.sslMode} psql -h localhost -p ${s} -U ${u.username} -d ${u.database}`}}function ue(e,t){return`${Je}:${e}/${u.database}?${t.toString()}`}async function fe(e,t){let{PGlite:r}=await import("@electric-sql/pglite"),n=await G(),o=await r.create({database:u.database,dataDir:e,debug:t?5:void 0,extensions:n.extensions,fsBundle:n.fsBundle,relaxedDurability:!1,wasmModule:n.wasmModule});return await ge(o),o}async function Qe(e,t){let{PGlite:r}=await import("@electric-sql/pglite"),n=await G(),o=await r.create({database:u.database,dataDir:"memory://",debug:t?5:void 0,extensions:n.extensions,fsBundle:n.fsBundle,relaxedDurability:!1,wasmModule:n.wasmModule});return await ge(o),o}async function Ze(e,t,r){let{rows:n}=await e.query(`
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
      AND namespace.nspname = ${de(t)}
      AND relation.relname = ${de(r)}
    ORDER BY keys.ordinality
  `);return n.map(o=>o.column_name)}function de(e){return`'${e.replaceAll("'","''")}'`}async function Pe(e){let{dataDir:t,db:r,debug:n,destinationPath:o}=e,s=r||await fe(t,n),{pgDump:P}=await import("@electric-sql/pglite-tools/pg_dump"),m=await P({args:["--schema-only","--no-owner"],fileName:o?(0,me.filename)(o):void 0,pg:await s.clone()});return o?(n&&console.debug(`[DB] Dumping database to ${o}`),await X(m,o)):(n&&console.debug("[DB] Dumping database to memory"),await m.text())}0&&(module.exports={attachWalEventBridge,dumpDB,shouldPollWalAfterMessages,shouldPollWalAfterResponse,startDBServer});
