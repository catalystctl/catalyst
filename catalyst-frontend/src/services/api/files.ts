import type { FileEntry, FileListing } from '../../types/file';
import { joinPath, normalizePath } from '../../utils/filePaths';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

type FileListingPayload =
  | Array<{
      name: string;
      size?: number;
      isDirectory?: boolean;
      type?: string;
      modified?: string;
      mode?: number | string;
    }>
  | {
      path?: string;
      files?: Array<{
        name: string;
        size?: number;
        isDirectory?: boolean;
        type?: string;
        modified?: string;
        mode?: number | string;
      }>;
      message?: string;
    };

// ── Normalization helpers ──

const normalizeModified = (value: unknown) => {
  if (!value) return undefined;
  const parsed = new Date(typeof value === 'number' ? value : String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const normalizeMode = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^[0-7]{3,4}$/.test(trimmed)) {
      const parsed = parseInt(trimmed, 8);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const normalizeEntry = (
  entry: {
    name: string;
    size?: number;
    isDirectory?: boolean;
    type?: string;
    modified?: string;
    mode?: number | string;
  },
  basePath: string,
): FileEntry => {
  const name = entry.name ?? 'unknown';
  const numericSize = Number(entry.size);
  const size = Number.isFinite(numericSize) ? numericSize : 0;
  const typeValue = entry.type ?? '';
  const isDirectory = Boolean(
    entry.isDirectory ?? ['directory', 'dir', 'folder'].includes(typeValue),
  );
  return {
    name,
    path: joinPath(basePath, name),
    size,
    isDirectory,
    mode: normalizeMode(entry.mode),
    modified: normalizeModified(entry.modified),
  };
};

const normalizeListing = (payload: FileListingPayload | undefined, requestedPath: string): FileListing => {
  const normalizedPath = normalizePath(requestedPath);
  if (!payload) {
    return { path: normalizedPath, files: [] };
  }

  if (Array.isArray(payload)) {
    return {
      path: normalizedPath,
      files: payload.map((entry) => normalizeEntry(entry, normalizedPath)),
    };
  }

  const basePath = normalizePath(payload.path ?? normalizedPath);
  const files = payload.files ? payload.files.map((entry) => normalizeEntry(entry, basePath)) : [];
  return {
    path: basePath,
    files,
    message: payload.message,
  };
};

// ── Error handling ──

/**
 * Extracts the error message from a non-2xx fetch response.
 * Tries to parse the response body as JSON and use the `error` field.
 * Falls back to status text or a generic message.
 */
async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body?.error) return body.error;
    if (body?.message) return body.message;
  } catch {
    // Response body is not JSON — fall through
  }
  return response.statusText || `Request failed (${response.status})`;
}

/**
 * Throws an error with the backend's error message for non-2xx responses.
 * The thrown error has a `.status` property for status-code-specific handling.
 */
async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const message = await extractErrorMessage(response);
  const error = new Error(message);
  (error as any).status = response.status;
  throw error;
}

// ── Fetch helpers ──

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: 'include' });
  await assertOk(res);
  return res.json() as Promise<T>;
}

// ── API ──

export const filesApi = {
  list: async (serverId: string, path = '/') => {
    const normalizedPath = normalizePath(path);
    const data = await fetchJson<ApiResponse<FileListingPayload>>(
      `/api/servers/${serverId}/files?path=${encodeURIComponent(normalizedPath)}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
    return normalizeListing(data.data, normalizedPath);
  },

  download: async (serverId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    const res = await fetch(
      `/api/servers/${serverId}/files/download?path=${encodeURIComponent(normalizedPath)}`,
      { method: 'GET', credentials: 'include' },
    );
    await assertOk(res);
    return res.blob();
  },

  readText: async (serverId: string, path: string) => {
    const blob = await filesApi.download(serverId, path);
    return blob.text();
  },

  upload: async (
    serverId: string,
    path: string,
    files: File[],
    onProgress?: (fileIndex: number, progress: number) => void,
  ) => {
    const normalizedPath = normalizePath(path);
    await Promise.all(
      files.map((file, index) =>
        new Promise<void>((resolve, reject) => {
          const formData = new FormData();
          formData.append('path', normalizedPath);
          formData.append('file', file);

          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && onProgress) {
              onProgress(index, Math.round((e.loaded / e.total) * 100));
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          });

          xhr.addEventListener('error', () => reject(new Error('Upload failed')));
          xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

          xhr.open('POST', `/api/servers/${serverId}/files/upload`);
          xhr.withCredentials = true;
          xhr.send(formData);
        }),
      ),
    );
  },

  create: async (
    serverId: string,
    payload: { path: string; isDirectory: boolean; content?: string },
  ) => {
    const normalizedPath = normalizePath(payload.path);
    return fetchJson<ApiResponse<void>>(
      `/api/servers/${serverId}/files/create`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, path: normalizedPath }),
      },
    );
  },

  write: async (serverId: string, path: string, content: string) => {
    const normalizedPath = normalizePath(path);
    return fetchJson<ApiResponse<void>>(
      `/api/servers/${serverId}/files/write`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: normalizedPath, content }),
      },
    );
  },

  updatePermissions: async (serverId: string, path: string, mode: number) => {
    const normalizedPath = normalizePath(path);
    return fetchJson<ApiResponse<void>>(
      `/api/servers/${serverId}/files/permissions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: normalizedPath, mode }),
      },
    );
  },

  remove: async (serverId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    return fetchJson<ApiResponse<void>>(
      `/api/servers/${serverId}/files/delete?path=${encodeURIComponent(normalizedPath)}`,
      { method: 'DELETE' },
    );
  },

  compress: async (
    serverId: string,
    payload: { paths: string[]; archiveName: string },
  ) => {
    const normalizedPaths = payload.paths.map((p) => normalizePath(p));
    const data = await fetchJson<ApiResponse<{ archivePath?: string }>>(
      `/api/servers/${serverId}/files/compress`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, paths: normalizedPaths }),
      },
    );
    return data.data;
  },

  decompress: async (
    serverId: string,
    payload: { archivePath: string; targetPath: string },
  ) => {
    const normalizedArchive = normalizePath(payload.archivePath);
    const normalizedTarget = normalizePath(payload.targetPath);
    return fetchJson<ApiResponse<void>>(
      `/api/servers/${serverId}/files/decompress`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath: normalizedArchive, targetPath: normalizedTarget }),
      },
    );
  },

  rename: async (serverId: string, from: string, to: string) => {
    const normalizedFrom = normalizePath(from);
    const normalizedTo = normalizePath(to);
    return fetchJson<ApiResponse<void>>(
      `/api/servers/${serverId}/files/rename`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: normalizedFrom, to: normalizedTo }),
      },
    );
  },

  listArchiveContents: async (serverId: string, archivePath: string) => {
    const data = await fetchJson<ApiResponse<Array<{ name: string; size: number; isDirectory: boolean; modified?: string }>>>(
      `/api/servers/${serverId}/files/archive-contents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath: normalizePath(archivePath) }),
      },
    );
    return data.data ?? [];
  },
};
