import type { MDSJWTPayload, MetadataStatement } from './mdsTypes.js';
/**
 * Perform authenticity and integrity verification of a
 * [FIDO Metadata Service (MDS)](https://fidoalliance.org/metadata/)-compatible blob, and then
 * extract the FIDO2 metadata statements included within. This method will make network requests
 * for things like CRL checks.
 *
 * @param blob - A JWT downloaded from an MDS server (e.g. https://mds3.fidoalliance.org)
 */
export declare function verifyMDSBlob(blob: string): Promise<{
    /** MetadataStatement entries within the verified blob */
    statements: MetadataStatement[];
    /** A JS `Date` instance of the verified blob's `payload.nextUpdate` string */
    parsedNextUpdate: Date;
    /** The verified blob's `payload` value */
    payload: MDSJWTPayload;
}>;
//# sourceMappingURL=verifyMDSBlob.d.ts.map