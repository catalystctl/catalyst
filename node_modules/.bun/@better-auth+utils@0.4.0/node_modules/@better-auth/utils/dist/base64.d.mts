import { T as TypedArray } from './shared/utils.ecd028f7.mjs';

declare const base64: {
    encode(data: ArrayBuffer | TypedArray | string, options?: {
        padding?: boolean;
    }): string;
    decode(data: string | ArrayBuffer | TypedArray): Uint8Array<ArrayBuffer>;
};
declare const base64Url: {
    encode(data: ArrayBuffer | TypedArray | string, options?: {
        padding?: boolean;
    }): string;
    decode(data: string): Uint8Array<ArrayBuffer>;
};

export { base64, base64Url };
