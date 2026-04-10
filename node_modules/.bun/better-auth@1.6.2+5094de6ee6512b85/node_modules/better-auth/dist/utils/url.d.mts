import { BaseURLConfig, DynamicBaseURLConfig } from "@better-auth/core";

//#region src/utils/url.d.ts
declare function getBaseURL(url?: string, path?: string, request?: Request, loadEnv?: boolean, trustedProxyHeaders?: boolean | undefined): string | undefined;
declare function getOrigin(url: string): string | null;
declare function getProtocol(url: string): string | null;
declare function getHost(url: string): string | null;
/**
 * Checks if the baseURL config is a dynamic config object
 */
declare function isDynamicBaseURLConfig(config: BaseURLConfig | undefined): config is DynamicBaseURLConfig;
/**
 * Extracts the host from the request headers.
 * Tries x-forwarded-host first (for proxy setups), then falls back to host header.
 *
 * @param request The incoming request
 * @returns The host string or null if not found
 */
declare function getHostFromRequest(request: Request): string | null;
/**
 * Extracts the protocol from the request headers.
 * Tries x-forwarded-proto first (for proxy setups), then infers from request URL.
 *
 * @param request The incoming request
 * @param configProtocol Protocol override from config
 * @returns The protocol ("http" or "https")
 */
declare function getProtocolFromRequest(request: Request, configProtocol?: "http" | "https" | "auto" | undefined): "http" | "https";
/**
 * Matches a hostname against a host pattern.
 * Supports wildcard patterns like `*.vercel.app` or `preview-*.myapp.com`.
 *
 * @param host The hostname to test (e.g., "myapp.com", "preview-123.vercel.app")
 * @param pattern The host pattern (e.g., "myapp.com", "*.vercel.app")
 * @returns {boolean} true if the host matches the pattern, false otherwise.
 *
 * @example
 * ```ts
 * matchesHostPattern("myapp.com", "myapp.com") // true
 * matchesHostPattern("preview-123.vercel.app", "*.vercel.app") // true
 * matchesHostPattern("preview-123.myapp.com", "preview-*.myapp.com") // true
 * matchesHostPattern("evil.com", "myapp.com") // false
 * ```
 */
declare const matchesHostPattern: (host: string, pattern: string) => boolean;
/**
 * Resolves the base URL from a dynamic config based on the incoming request.
 * Validates the derived host against the allowedHosts allowlist.
 *
 * @param config The dynamic base URL config
 * @param request The incoming request
 * @param basePath The base path to append
 * @returns The resolved base URL with path
 * @throws BetterAuthError if host is not in allowedHosts and no fallback is set
 */
declare function resolveDynamicBaseURL(config: DynamicBaseURLConfig, request: Request, basePath: string): string;
/**
 * Resolves the base URL from any config type (static string or dynamic object).
 * This is the main entry point for base URL resolution.
 *
 * @param config The base URL config (string or object)
 * @param basePath The base path to append
 * @param request Optional request for dynamic resolution
 * @param loadEnv Whether to load from environment variables
 * @param trustedProxyHeaders Whether to trust proxy headers (for legacy behavior)
 * @returns The resolved base URL with path
 */
declare function resolveBaseURL(config: BaseURLConfig | undefined, basePath: string, request?: Request, loadEnv?: boolean, trustedProxyHeaders?: boolean): string | undefined;
//#endregion
export { getBaseURL, getHost, getHostFromRequest, getOrigin, getProtocol, getProtocolFromRequest, isDynamicBaseURLConfig, matchesHostPattern, resolveBaseURL, resolveDynamicBaseURL };