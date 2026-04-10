import { d as PGliteInterface } from '../pglite-SIPwY9Cm.cjs';

declare const pg_trgm: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { pg_trgm };
