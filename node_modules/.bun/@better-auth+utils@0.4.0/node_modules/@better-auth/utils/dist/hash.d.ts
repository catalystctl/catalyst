import { E as EncodingFormat, S as SHAFamily, T as TypedArray } from './shared/utils.ecd028f7.js';

declare function createHash<Encoding extends EncodingFormat = "none">(algorithm: SHAFamily, encoding?: Encoding): {
    digest: (input: string | ArrayBuffer | TypedArray) => Promise<Encoding extends "none" ? ArrayBuffer : string>;
};

export { createHash };
