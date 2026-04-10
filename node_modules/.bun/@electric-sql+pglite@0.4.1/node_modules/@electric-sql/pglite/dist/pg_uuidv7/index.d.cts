import { d as PGliteInterface } from '../pglite-SIPwY9Cm.cjs';

declare const pg_uuidv7: {
    name: string;
    setup: (_pg: PGliteInterface, emscriptenOpts: any) => Promise<{
        emscriptenOpts: any;
        bundlePath: URL;
    }>;
};

export { pg_uuidv7 };
