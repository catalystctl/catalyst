//#region src/utils/ip.d.ts
/**
 * Normalizes an IP address for consistent rate limiting.
 *
 * Features:
 * - Normalizes IPv6 to canonical lowercase form
 * - Converts IPv4-mapped IPv6 to IPv4
 * - Supports IPv6 subnet extraction
 * - Handles all edge cases (::1, ::, etc.)
 */
interface NormalizeIPOptions {
  /**
   * For IPv6 addresses, extract the subnet prefix instead of full address.
   * Common values: 32, 48, 64, 128 (default: 128 = full address)
   *
   * @default 128
   */
  ipv6Subnet?: 128 | 64 | 48 | 32;
}
/**
 * Checks if an IP is valid IPv4 or IPv6
 */
declare function isValidIP(ip: string): boolean;
/**
 * Normalizes an IP address (IPv4 or IPv6) for consistent rate limiting.
 *
 * @param ip - The IP address to normalize
 * @param options - Normalization options
 * @returns Normalized IP address
 *
 * @example
 * normalizeIP("2001:DB8::1")
 * // -> "2001:0db8:0000:0000:0000:0000:0000:0000"
 *
 * @example
 * normalizeIP("::ffff:192.0.2.1")
 * // -> "192.0.2.1" (converted to IPv4)
 *
 * @example
 * normalizeIP("2001:db8::1", { ipv6Subnet: 64 })
 * // -> "2001:0db8:0000:0000:0000:0000:0000:0000" (subnet /64)
 */
declare function normalizeIP(ip: string, options?: NormalizeIPOptions): string;
/**
 * Creates a rate limit key from IP and path
 * Uses a separator to prevent collision attacks
 *
 * @param ip - The IP address (should be normalized)
 * @param path - The request path
 * @returns Rate limit key
 */
declare function createRateLimitKey(ip: string, path: string): string;
//#endregion
export { createRateLimitKey, isValidIP, normalizeIP };