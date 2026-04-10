import { d as PGliteInterface } from '../pglite-SIPwY9Cm.cjs';

declare const btree_gist: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { btree_gist };
