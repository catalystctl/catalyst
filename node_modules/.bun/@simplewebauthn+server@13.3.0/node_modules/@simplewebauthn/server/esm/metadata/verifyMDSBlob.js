import { parseJWT } from './parseJWT.js';
import { verifyJWT } from './verifyJWT.js';
import { validateCertificatePath } from '../helpers/validateCertificatePath.js';
import { convertCertBufferToPEM } from '../helpers/convertCertBufferToPEM.js';
import { convertPEMToBytes } from '../helpers/convertPEMToBytes.js';
import { SettingsService } from '../services/settingsService.js';
/**
 * Perform authenticity and integrity verification of a
 * [FIDO Metadata Service (MDS)](https://fidoalliance.org/metadata/)-compatible blob, and then
 * extract the FIDO2 metadata statements included within. This method will make network requests
 * for things like CRL checks.
 *
 * @param blob - A JWT downloaded from an MDS server (e.g. https://mds3.fidoalliance.org)
 */
export async function verifyMDSBlob(blob) {
    // Parse the JWT
    const parsedJWT = parseJWT(blob);
    const header = parsedJWT[0];
    const payload = parsedJWT[1];
    const headerCertsPEM = header.x5c.map(convertCertBufferToPEM);
    try {
        // Validate the certificate chain
        const rootCerts = SettingsService.getRootCertificates({
            identifier: 'mds',
        });
        await validateCertificatePath(headerCertsPEM, rootCerts);
    }
    catch (error) {
        const _error = error;
        // From FIDO MDS docs: "ignore the file if the chain cannot be verified or if one of the
        // chain certificates is revoked"
        throw new Error('BLOB certificate path could not be validated', { cause: _error });
    }
    // Verify the BLOB JWT signature
    const leafCert = headerCertsPEM[0];
    const verified = await verifyJWT(blob, convertPEMToBytes(leafCert));
    if (!verified) {
        // From FIDO MDS docs: "The FIDO Server SHOULD ignore the file if the signature is invalid."
        throw new Error('BLOB signature could not be verified');
    }
    // Cache statements for FIDO2 devices
    const statements = [];
    for (const entry of payload.entries) {
        // Only cache entries with an `aaguid`
        if (entry.aaguid && entry.metadataStatement) {
            statements.push(entry.metadataStatement);
        }
    }
    // Convert the nextUpdate property into a Date so we can determine when to re-download
    const [year, month, day] = payload.nextUpdate.split('-');
    const parsedNextUpdate = new Date(parseInt(year, 10), 
    // Months need to be zero-indexed
    parseInt(month, 10) - 1, parseInt(day, 10));
    return {
        statements,
        parsedNextUpdate,
        payload,
    };
}
