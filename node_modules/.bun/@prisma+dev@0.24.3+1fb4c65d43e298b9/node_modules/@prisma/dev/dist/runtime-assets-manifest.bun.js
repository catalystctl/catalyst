import {
  registerBundledPGliteRuntimeAssetSources,
  resolveBundledRuntimeAssetSource,
} from "./runtime-assets.js";
import initdbWasmAsset from "./runtime-assets/initdb.wasm";
import fsBundleAsset from "./runtime-assets/pglite.data";
import wasmModuleAsset from "./runtime-assets/pglite.wasm";
import amcheckAsset from "./runtime-assets/amcheck.tar.gz";
import bloomAsset from "./runtime-assets/bloom.tar.gz";
import btree_ginAsset from "./runtime-assets/btree_gin.tar.gz";
import btree_gistAsset from "./runtime-assets/btree_gist.tar.gz";
import citextAsset from "./runtime-assets/citext.tar.gz";
import cubeAsset from "./runtime-assets/cube.tar.gz";
import dict_intAsset from "./runtime-assets/dict_int.tar.gz";
import dict_xsynAsset from "./runtime-assets/dict_xsyn.tar.gz";
import earthdistanceAsset from "./runtime-assets/earthdistance.tar.gz";
import file_fdwAsset from "./runtime-assets/file_fdw.tar.gz";
import fuzzystrmatchAsset from "./runtime-assets/fuzzystrmatch.tar.gz";
import hstoreAsset from "./runtime-assets/hstore.tar.gz";
import intarrayAsset from "./runtime-assets/intarray.tar.gz";
import isnAsset from "./runtime-assets/isn.tar.gz";
import loAsset from "./runtime-assets/lo.tar.gz";
import ltreeAsset from "./runtime-assets/ltree.tar.gz";
import pageinspectAsset from "./runtime-assets/pageinspect.tar.gz";
import pg_buffercacheAsset from "./runtime-assets/pg_buffercache.tar.gz";
import pg_freespacemapAsset from "./runtime-assets/pg_freespacemap.tar.gz";
import pg_surgeryAsset from "./runtime-assets/pg_surgery.tar.gz";
import pg_trgmAsset from "./runtime-assets/pg_trgm.tar.gz";
import pg_visibilityAsset from "./runtime-assets/pg_visibility.tar.gz";
import pg_walinspectAsset from "./runtime-assets/pg_walinspect.tar.gz";
import segAsset from "./runtime-assets/seg.tar.gz";
import tablefuncAsset from "./runtime-assets/tablefunc.tar.gz";
import tcnAsset from "./runtime-assets/tcn.tar.gz";
import tsm_system_rowsAsset from "./runtime-assets/tsm_system_rows.tar.gz";
import tsm_system_timeAsset from "./runtime-assets/tsm_system_time.tar.gz";
import unaccentAsset from "./runtime-assets/unaccent.tar.gz";
import uuid_osspAsset from "./runtime-assets/uuid-ossp.tar.gz";
import vectorAsset from "./runtime-assets/vector.tar.gz";

registerBundledPGliteRuntimeAssetSources({
  fsBundle: resolveBundledRuntimeAssetSource(fsBundleAsset, import.meta.url),
  initdbWasm: resolveBundledRuntimeAssetSource(initdbWasmAsset, import.meta.url),
  wasmModule: resolveBundledRuntimeAssetSource(wasmModuleAsset, import.meta.url),
  extensions: {
    "amcheck": resolveBundledRuntimeAssetSource(amcheckAsset, import.meta.url),
    "bloom": resolveBundledRuntimeAssetSource(bloomAsset, import.meta.url),
    "btree_gin": resolveBundledRuntimeAssetSource(btree_ginAsset, import.meta.url),
    "btree_gist": resolveBundledRuntimeAssetSource(btree_gistAsset, import.meta.url),
    "citext": resolveBundledRuntimeAssetSource(citextAsset, import.meta.url),
    "cube": resolveBundledRuntimeAssetSource(cubeAsset, import.meta.url),
    "dict_int": resolveBundledRuntimeAssetSource(dict_intAsset, import.meta.url),
    "dict_xsyn": resolveBundledRuntimeAssetSource(dict_xsynAsset, import.meta.url),
    "earthdistance": resolveBundledRuntimeAssetSource(earthdistanceAsset, import.meta.url),
    "file_fdw": resolveBundledRuntimeAssetSource(file_fdwAsset, import.meta.url),
    "fuzzystrmatch": resolveBundledRuntimeAssetSource(fuzzystrmatchAsset, import.meta.url),
    "hstore": resolveBundledRuntimeAssetSource(hstoreAsset, import.meta.url),
    "intarray": resolveBundledRuntimeAssetSource(intarrayAsset, import.meta.url),
    "isn": resolveBundledRuntimeAssetSource(isnAsset, import.meta.url),
    "lo": resolveBundledRuntimeAssetSource(loAsset, import.meta.url),
    "ltree": resolveBundledRuntimeAssetSource(ltreeAsset, import.meta.url),
    "pageinspect": resolveBundledRuntimeAssetSource(pageinspectAsset, import.meta.url),
    "pg_buffercache": resolveBundledRuntimeAssetSource(pg_buffercacheAsset, import.meta.url),
    "pg_freespacemap": resolveBundledRuntimeAssetSource(pg_freespacemapAsset, import.meta.url),
    "pg_surgery": resolveBundledRuntimeAssetSource(pg_surgeryAsset, import.meta.url),
    "pg_trgm": resolveBundledRuntimeAssetSource(pg_trgmAsset, import.meta.url),
    "pg_visibility": resolveBundledRuntimeAssetSource(pg_visibilityAsset, import.meta.url),
    "pg_walinspect": resolveBundledRuntimeAssetSource(pg_walinspectAsset, import.meta.url),
    "seg": resolveBundledRuntimeAssetSource(segAsset, import.meta.url),
    "tablefunc": resolveBundledRuntimeAssetSource(tablefuncAsset, import.meta.url),
    "tcn": resolveBundledRuntimeAssetSource(tcnAsset, import.meta.url),
    "tsm_system_rows": resolveBundledRuntimeAssetSource(tsm_system_rowsAsset, import.meta.url),
    "tsm_system_time": resolveBundledRuntimeAssetSource(tsm_system_timeAsset, import.meta.url),
    "unaccent": resolveBundledRuntimeAssetSource(unaccentAsset, import.meta.url),
    "uuid_ossp": resolveBundledRuntimeAssetSource(uuid_osspAsset, import.meta.url),
    "vector": resolveBundledRuntimeAssetSource(vectorAsset, import.meta.url),
  },
});
