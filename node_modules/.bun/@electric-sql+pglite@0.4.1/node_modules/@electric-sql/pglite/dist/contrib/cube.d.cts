import { d as PGliteInterface } from '../pglite-SIPwY9Cm.cjs';

declare const cube: {
    name: string;
    setup: (_pg: PGliteInterface, _emscriptenOpts: any) => Promise<{
        bundlePath: URL;
    }>;
};

export { cube };
