import { d as PGliteInterface } from '../pglite-SIPwY9Cm.js';

declare const pg_textsearch: {
    name: string;
    setup: (_pg: PGliteInterface, emscriptenOpts: any) => Promise<{
        emscriptenOpts: any;
        bundlePath: URL;
    }>;
};

export { pg_textsearch };
