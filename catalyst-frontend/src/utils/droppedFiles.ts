/**
 * Collect files from a browser drop event.
 *
 * `dataTransfer.files` is empty for folder drops in Chromium. Prefer
 * DataTransferItem.webkitGetAsEntry() so a dropped directory is walked
 * and each file keeps a relative directory (uploaded under the current path).
 */

export type DroppedFile = {
  file: File;
  /** Directory relative to the drop target, no leading slash. Empty for a bare file. */
  relativeDir: string;
};

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, err?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      ok: (entries: FileSystemEntryLike[]) => void,
      err?: (error: DOMException) => void,
    ) => void;
  };
};

function hasFilePayload(dt: DataTransfer): boolean {
  const types = dt.types ? Array.from(dt.types as unknown as ArrayLike<string>) : [];
  if (types.includes('Files') || types.includes('application/x-moz-file')) return true;
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      if (dt.items[i]?.kind === 'file') return true;
    }
  }
  return (dt.files?.length ?? 0) > 0;
}

/** True when the drag contains files (used to allow drop + show overlay). */
export function isFileDrag(dt: DataTransfer | null | undefined): boolean {
  return Boolean(dt && hasFilePayload(dt));
}

function readAllEntries(
  reader: NonNullable<FileSystemEntryLike['createReader']> extends () => infer R ? R : never,
): Promise<FileSystemEntryLike[]> {
  const collected: FileSystemEntryLike[] = [];
  return new Promise((resolve, reject) => {
    const next = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(collected);
            return;
          }
          collected.push(...batch);
          next();
        },
        reject,
      );
    };
    next();
  });
}

async function walkEntry(entry: FileSystemEntryLike, prefix: string): Promise<DroppedFile[]> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file!(resolve, reject);
    });
    return [{ file, relativeDir: prefix }];
  }

  if (entry.isDirectory && entry.createReader) {
    const children = await readAllEntries(entry.createReader());
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nested = await Promise.all(children.map((child) => walkEntry(child, nextPrefix)));
    return nested.flat();
  }

  return [];
}

export async function collectDroppedFiles(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = dt.items;
  if (items && items.length) {
    const entries: FileSystemEntryLike[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = (
        item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }
      ).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    if (entries.length) {
      const walked = (await Promise.all(entries.map((entry) => walkEntry(entry, '')))).flat();
      if (walked.length) return walked;
    }

    const fromItems: DroppedFile[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) fromItems.push({ file, relativeDir: '' });
    }
    if (fromItems.length) return fromItems;
  }

  return Array.from(dt.files ?? []).map((file) => ({ file, relativeDir: '' }));
}
