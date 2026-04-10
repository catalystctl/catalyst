import { isDevelopment, isTest } from "@better-auth/core/env";
import { isValidIP, normalizeIP } from "@better-auth/core/utils/ip";
//#region src/utils/get-request-ip.ts
const LOCALHOST_IP = "127.0.0.1";
function getIp(req, options) {
	if (options.advanced?.ipAddress?.disableIpTracking) return null;
	const headers = "headers" in req ? req.headers : req;
	const ipHeaders = options.advanced?.ipAddress?.ipAddressHeaders || ["x-forwarded-for"];
	for (const key of ipHeaders) {
		const value = "get" in headers ? headers.get(key) : headers[key];
		if (typeof value === "string") {
			const ip = value.split(",")[0].trim();
			if (isValidIP(ip)) return normalizeIP(ip, { ipv6Subnet: options.advanced?.ipAddress?.ipv6Subnet });
		}
	}
	if (isTest() || isDevelopment()) return LOCALHOST_IP;
	return null;
}
//#endregion
export { getIp };
