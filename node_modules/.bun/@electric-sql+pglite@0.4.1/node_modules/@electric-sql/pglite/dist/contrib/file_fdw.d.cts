import { d as PGliteInterface } from '../pglite-SIPwY9Cm.cjs';

declare const file_fdw: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { file_fdw };
