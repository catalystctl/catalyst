/**
 * bzip2 twin generation for FastDL.
 *
 * HL1-family engines request `file.bz2` next to `file` and decompress
 * client-side. bzip2 (not gzip) is required — zlib cannot produce it, so this
 * module shells out to the `bzip2` CLI, which is present on standard
 * Debian/Ubuntu hosts and in the backend image.
 *
 * Pure-JS alternatives (compressjs) are GPL and unmaintained; a subprocess
 * keeps licensing simple and uses the system's fast C implementation.
 */
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Compress a buffer with bzip2 -9.
 * @param {Buffer} input
 * @returns {Promise<Buffer>} .bz2 payload
 */
export async function bzip2Compress(input) {
  const dir = await mkdtemp(join(tmpdir(), 'fastdl-'));
  try {
    const src = join(dir, 'in');
    await writeFile(src, input);
    // bzip2 -k keeps the source; output lands at <src>.bz2
    await new Promise((resolve, reject) => {
      execFile('bzip2', ['-9', '-k', src], { maxBuffer: 0 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`bzip2 failed: ${stderr || err.message}`));
        else resolve();
      });
    });
    return await readFile(`${src}.bz2`);
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
