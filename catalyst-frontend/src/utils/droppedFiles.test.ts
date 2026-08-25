import { describe, expect, it, vi } from 'vitest';
import { collectDroppedFiles, isFileDrag } from './droppedFiles';

function fileItem(file: File, entry?: { isFile?: boolean; isDirectory?: boolean; name?: string }) {
  return {
    kind: 'file' as const,
    type: file.type,
    getAsFile: () => file,
    webkitGetAsEntry: entry
      ? () => ({
          isFile: Boolean(entry.isFile),
          isDirectory: Boolean(entry.isDirectory),
          name: entry.name ?? file.name,
          file: (ok: (f: File) => void) => ok(file),
        })
      : () => null,
  };
}

describe('isFileDrag', () => {
  it('is true when types include Files', () => {
    expect(isFileDrag({ types: ['Files'], items: [], files: [] } as unknown as DataTransfer)).toBe(
      true,
    );
  });

  it('is true for Firefox application/x-moz-file drags', () => {
    expect(
      isFileDrag({
        types: ['application/x-moz-file'],
        items: [],
        files: [],
      } as unknown as DataTransfer),
    ).toBe(true);
  });

  it('is false for non-file drags', () => {
    expect(
      isFileDrag({ types: ['text/plain'], items: [], files: [] } as unknown as DataTransfer),
    ).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });
});

describe('collectDroppedFiles', () => {
  it('reads files from dataTransfer.files when items are empty', async () => {
    const file = new File(['hello'], 'server.properties');
    const dt = { items: [], files: [file] } as unknown as DataTransfer;
    await expect(collectDroppedFiles(dt)).resolves.toEqual([{ file, relativeDir: '' }]);
  });

  it('prefers webkitGetAsEntry file entries', async () => {
    const file = new File(['jar'], 'plugin.jar');
    const dt = {
      items: [fileItem(file, { isFile: true, name: 'plugin.jar' })],
      files: [],
    } as unknown as DataTransfer;
    await expect(collectDroppedFiles(dt)).resolves.toEqual([{ file, relativeDir: '' }]);
  });

  it('walks a dropped directory and keeps the relative folder', async () => {
    const nested = new File(['mod'], 'fabric.jar');
    const reader = {
      readEntries: vi
        .fn()
        .mockImplementationOnce((ok: (entries: unknown[]) => void) =>
          ok([
            {
              isFile: true,
              isDirectory: false,
              name: 'fabric.jar',
              file: (done: (f: File) => void) => done(nested),
            },
          ]),
        )
        .mockImplementationOnce((ok: (entries: unknown[]) => void) => ok([])),
    };
    const dt = {
      items: [
        {
          kind: 'file',
          getAsFile: () => null,
          webkitGetAsEntry: () => ({
            isFile: false,
            isDirectory: true,
            name: 'mods',
            createReader: () => reader,
          }),
        },
      ],
      files: [],
    } as unknown as DataTransfer;

    await expect(collectDroppedFiles(dt)).resolves.toEqual([
      { file: nested, relativeDir: 'mods' },
    ]);
  });

  it('falls back to getAsFile when entries are unavailable', async () => {
    const file = new File(['x'], 'eula.txt');
    const dt = {
      items: [fileItem(file)],
      files: [],
    } as unknown as DataTransfer;
    await expect(collectDroppedFiles(dt)).resolves.toEqual([{ file, relativeDir: '' }]);
  });
});
