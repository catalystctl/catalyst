import { d as PGliteInterface } from '../pglite-SIPwY9Cm.js';

declare const pgcrypto: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { pgcrypto };
