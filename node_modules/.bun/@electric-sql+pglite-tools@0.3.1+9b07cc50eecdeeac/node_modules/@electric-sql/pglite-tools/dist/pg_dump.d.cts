import { PGlite } from '@electric-sql/pglite';

interface PgDumpOptions {
    pg: PGlite;
    args?: string[];
    database?: string;
    fileName?: string;
    verbose?: boolean;
}
/**
 * Execute pg_dump
 * @param pg - The PGlite instance
 * @param args - The arguments to pass to pg_dump
 * @param fileName - The name of the file to write the dump to (dump.sql by default)
 * @returns The file containing the dump
 */
declare function pgDump({ pg, args, fileName, }: PgDumpOptions): Promise<File>;

export { pgDump };
