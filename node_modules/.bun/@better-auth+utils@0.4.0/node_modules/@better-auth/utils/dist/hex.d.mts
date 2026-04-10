import { T as TypedArray } from './shared/utils.ecd028f7.mjs';

declare const hex: {
    encode: (data: string | ArrayBuffer | TypedArray) => string;
    decode: (data: string | ArrayBuffer | TypedArray) => string;
};

export { hex };
