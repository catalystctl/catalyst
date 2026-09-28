import { ZipArchive } from "archiver";
import type { Readable } from "node:stream";
import type { DiagnosticsEntry } from "./collect.js";

/**
 * Build the ZIP in memory-free fashion: entries are appended to a streaming
 * archiver so the response does not need the whole bundle buffered twice.
 * Entries are already byte-capped by the collector.
 */
export function createDiagnosticsArchive(entries: DiagnosticsEntry[]): Readable {
	const archive = new ZipArchive({ zlib: { level: 6 } });
	for (const entry of entries) {
		archive.append(entry.content, { name: entry.path });
	}
	// `finalize` rejects only if the archive already emitted an error; the
	// route attaches the error handler that surfaces it.
	void archive.finalize().catch(() => {});
	return archive;
}
