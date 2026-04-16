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

// Helper for authenticated file download using native fetch
async function downloadFile(
  url: string,
  params?: Record<string, string | number | boolean | undefined | null>,
): Promise<Blob> {
  let fetchUrl = url;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) fetchUrl += `?${queryString}`;
  }

  const response = await fetch(fetchUrl, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.blob();
}

// Helper for authenticated file upload using native fetch
async function uploadFile(
  url: string,
  body: FormData,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export const filesApi = {
  list: async (serverId: string, path = '/') => {
    const normalizedPath = normalizePath(path);
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files?path=${encodeURIComponent(normalizedPath)}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<FileListingPayload>>;
    })();
    return normalizeListing(data.data, normalizedPath);
  },
  download: async (serverId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    return downloadFile(`/api/servers/${serverId}/files/download`, { path: normalizedPath });
  },
  readText: async (serverId: string, path: string) => {
    const blob = await filesApi.download(serverId, path);
    return blob.text();
  },
  upload: async (serverId: string, path: string, files: File[]) => {
    const normalizedPath = normalizePath(path);
    await Promise.all(
      files.map((file) => {
        const formData = new FormData();
        formData.append('path', normalizedPath);
        formData.append('file', file);
        return uploadFile(`/api/servers/${serverId}/files/upload`, formData);
      }),
    );
  },
  create: async (
    serverId: string,
    payload: { path: string; isDirectory: boolean; content?: string },
  ) => {
    const normalizedPath = normalizePath(payload.path);
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/create`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, path: normalizedPath }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<void>>;
    })();
    return data;
  },
  write: async (serverId: string, path: string, content: string) => {
    const normalizedPath = normalizePath(path);
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/write`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: normalizedPath, content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<void>>;
    })();
    return data;
  },
  updatePermissions: async (serverId: string, path: string, mode: number) => {
    const normalizedPath = normalizePath(path);
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/permissions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: normalizedPath, mode }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<void>>;
    })();
    return data;
  },
  remove: async (serverId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/delete?path=${encodeURIComponent(normalizedPath)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<void>>;
    })();
    return data;
  },
  compress: async (
    serverId: string,
    payload: { paths: string[]; archiveName: string },
  ) => {
    const normalizedPaths = payload.paths.map((p) => normalizePath(p));
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/compress`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, paths: normalizedPaths }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<{ archivePath?: string }>>;
    })();
    return data.data;
  },
  decompress: async (
    serverId: string,
    payload: { archivePath: string; targetPath: string },
  ) => {
    const normalizedArchive = normalizePath(payload.archivePath);
    const normalizedTarget = normalizePath(payload.targetPath);
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/decompress`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath: normalizedArchive, targetPath: normalizedTarget }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<void>>;
    })();
    return data;
  },
  rename: async (serverId: string, from: string, to: string) => {
    const normalizedFrom = normalizePath(from);
    const normalizedTo = normalizePath(to);
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/rename`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: normalizedFrom, to: normalizedTo }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<void>>;
    })();
    return data;
  },
  listArchiveContents: async (serverId: string, archivePath: string) => {
    const data = await (async () => {
      const res = await fetch(`/api/servers/${serverId}/files/archive-contents`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivePath: normalizePath(archivePath) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<ApiResponse<Array<{ name: string; size: number; isDirectory: boolean; modified?: string }>>>;
    })();
    return data.data ?? [];
  },
};
