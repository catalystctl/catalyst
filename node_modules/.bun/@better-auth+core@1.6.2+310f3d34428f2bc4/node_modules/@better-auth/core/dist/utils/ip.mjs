import * as z from "zod";
//#region src/utils/ip.ts
/**
* Checks if an IP is valid IPv4 or IPv6
*/
function isValidIP(ip) {
	return z.ipv4().safeParse(ip).success || z.ipv6().safeParse(ip).success;
}
/**
* Checks if an IP is IPv6
*/
function isIPv6(ip) {
	return z.ipv6().safeParse(ip).success;
}
/**
* Converts IPv4-mapped IPv6 address to IPv4
* e.g., "::ffff:192.0.2.1" -> "192.0.2.1"
*/
function extractIPv4FromMapped(ipv6) {
	const lower = ipv6.toLowerCase();
	if (lower.startsWith("::ffff:")) {
		const ipv4Part = lower.substring(7);
		if (z.ipv4().safeParse(ipv4Part).success) return ipv4Part;
	}
	const parts = ipv6.split(":");
	if (parts.length === 7 && parts[5]?.toLowerCase() === "ffff") {
		const ipv4Part = parts[6];
		if (ipv4Part && z.ipv4().safeParse(ipv4Part).success) return ipv4Part;
	}
	if (lower.includes("::ffff:") || lower.includes(":ffff:")) {
		const groups = expandIPv6(ipv6);
		if (groups.length === 8 && groups[0] === "0000" && groups[1] === "0000" && groups[2] === "0000" && groups[3] === "0000" && groups[4] === "0000" && groups[5] === "ffff" && groups[6] && groups[7]) return `${Number.parseInt(groups[6].substring(0, 2), 16)}.${Number.parseInt(groups[6].substring(2, 4), 16)}.${Number.parseInt(groups[7].substring(0, 2), 16)}.${Number.parseInt(groups[7].substring(2, 4), 16)}`;
	}
	return null;
}
/**
* Expands a compressed IPv6 address to full form
* e.g., "2001:db8::1" -> ["2001", "0db8", "0000", "0000", "0000", "0000", "0000", "0001"]
*/
function expandIPv6(ipv6) {
	if (ipv6.includes("::")) {
		const sides = ipv6.split("::");
		const left = sides[0] ? sides[0].split(":") : [];
		const right = sides[1] ? sides[1].split(":") : [];
		const missingGroups = 8 - left.length - right.length;
		const zeros = Array(missingGroups).fill("0000");
		const paddedLeft = left.map((g) => g.padStart(4, "0"));
		const paddedRight = right.map((g) => g.padStart(4, "0"));
		return [
			...paddedLeft,
			...zeros,
			...paddedRight
		];
	}
	return ipv6.split(":").map((g) => g.padStart(4, "0"));
}
/**
* Normalizes an IPv6 address to canonical form
* e.g., "2001:DB8::1" -> "2001:0db8:0000:0000:0000:0000:0000:0001"
*/
function normalizeIPv6(ipv6, subnetPrefix) {
	const groups = expandIPv6(ipv6);
	if (subnetPrefix && subnetPrefix < 128) {
		let bitsRemaining = subnetPrefix;
		return groups.map((group) => {
			if (bitsRemaining <= 0) return "0000";
			if (bitsRemaining >= 16) {
				bitsRemaining -= 16;
				return group;
			}
			const masked = Number.parseInt(group, 16) & (65535 << 16 - bitsRemaining & 65535);
			bitsRemaining = 0;
			return masked.toString(16).padStart(4, "0");
		}).join(":").toLowerCase();
	}
	return groups.join(":").toLowerCase();
}
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
function normalizeIP(ip, options = {}) {
	if (z.ipv4().safeParse(ip).success) return ip.toLowerCase();
	if (!isIPv6(ip)) return ip.toLowerCase();
	const ipv4 = extractIPv4FromMapped(ip);
	if (ipv4) return ipv4.toLowerCase();
	return normalizeIPv6(ip, options.ipv6Subnet || 64);
}
/**
* Creates a rate limit key from IP and path
* Uses a separator to prevent collision attacks
*
* @param ip - The IP address (should be normalized)
* @param path - The request path
* @returns Rate limit key
*/
function createRateLimitKey(ip, path) {
	return `${ip}|${path}`;
}
//#endregion
export { createRateLimitKey, isValidIP, normalizeIP };
