import type { CatalystConfig } from "./config.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
}

export class CatalystApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "CatalystApiError";
    this.status = status;
    this.code = code;
  }
}

function buildUrl(apiBase: string, path: string, query?: RequestOptions["query"]): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${apiBase}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parsePayload(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.length > 8000 ? `${text.slice(0, 8000)}…[truncated]` : text;
  }
}

function unwrap(payload: unknown): unknown {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if ("data" in record && ("success" in record || Object.keys(record).length <= 3)) {
      return record.data ?? null;
    }
  }
  return payload;
}

export class CatalystClient {
  private config: CatalystConfig;

  constructor(config: CatalystConfig) {
    this.config = config;
  }

  async request<T = unknown>(options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 30_000,
    );
    try {
      const hasBody = options.body !== undefined;
      const res = await fetch(buildUrl(this.config.apiBase, options.path, options.query), {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const payload = await parsePayload(res);
      if (!res.ok) {
        const record =
          payload !== null && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : null;
        const message =
          (record?.error as string | undefined) ??
          (record?.message as string | undefined) ??
          `Request failed with HTTP ${res.status}`;
        const code = record?.code as string | undefined;
        throw new CatalystApiError(res.status, message, code);
      }
      return unwrap(payload) as T;
    } catch (error) {
      if (error instanceof CatalystApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request to ${options.path} timed out`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  get<T = unknown>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return this.request<T>({ method: "GET", path, query });
  }

  post<T = unknown>(path: string, body?: unknown, query?: RequestOptions["query"]): Promise<T> {
    return this.request<T>({ method: "POST", path, body: body ?? {}, query });
  }

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PUT", path, body: body ?? {} });
  }

  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", path, body: body ?? {} });
  }

  delete<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "DELETE", path, body });
  }

  async health(): Promise<unknown> {
    const res = await fetch(`${this.config.panelBase}/health`);
    return parsePayload(res);
  }
}

export function toJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
