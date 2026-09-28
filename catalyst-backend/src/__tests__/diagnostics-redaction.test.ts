import { describe, it, expect } from "vitest";
import {
	redactEnvContent,
	redactEnvVar,
	redactHosts,
	redactLogText,
	redactValue,
	isSensitiveEnvKey,
} from "../lib/secret-redaction.js";

describe("diagnostics redaction", () => {
	it("redacts secret env values but keeps routing config readable", () => {
		const env = [
			"# panel config",
			"PUBLIC_URL=https://panel.example.com",
			"BETTER_AUTH_URL=https://panel.example.com",
			"POSTGRES_PASSWORD=sup3rs3cret",
			"BETTER_AUTH_SECRET=abcdef",
			"API_KEY_SECRET=uvwxyz",
			"DATABASE_URL=postgresql://catalyst:pw@postgres:5432/catalyst_db",
			"REDIS_PASSWORD=redis-pw",
			"LICENSE_KEY=CAT-1234-5678",
			"REDIS_URL=redis://:redis-pw@redis:6379",
			"LOG_LEVEL=info",
		].join("\n");

		const out = redactEnvContent(env, "standard");
		expect(out).toContain("PUBLIC_URL=https://panel.example.com");
		expect(out).toContain("BETTER_AUTH_URL=https://panel.example.com");
		expect(out).toContain("LOG_LEVEL=info");
		expect(out).toContain("# panel config");
		expect(out).toContain("POSTGRES_PASSWORD=[REDACTED]");
		expect(out).toContain("BETTER_AUTH_SECRET=[REDACTED]");
		expect(out).toContain("API_KEY_SECRET=[REDACTED]");
		expect(out).toContain("DATABASE_URL=[REDACTED]");
		expect(out).toContain("REDIS_PASSWORD=[REDACTED]");
		expect(out).toContain("LICENSE_KEY=[REDACTED]");
		expect(out).toContain("REDIS_URL=[REDACTED]");
		expect(out).not.toContain("sup3rs3cret");
		expect(out).not.toContain("CAT-1234-5678");
	});

	it("keeps IPs in standard mode and masks them in strict mode", () => {
		const line = '{"level":30,"msg":"connect 10.0.0.5 gaming.example.com"}';
		expect(redactLogText(line, "standard")).toContain("10.0.0.5");
		expect(redactLogText(line, "standard")).toContain("gaming.example.com");

		const strict = redactLogText(line, "strict");
		expect(strict).toContain("[IP_REDACTED]");
		expect(strict).toContain("[HOST_REDACTED]");
		expect(strict).not.toContain("10.0.0.5");
		expect(strict).not.toContain("gaming.example.com");
	});

	it("does not mangle filenames while masking hosts", () => {
		const out = redactHosts("loaded config.json and server.properties from /srv/app");
		expect(out).toContain("config.json");
		expect(out).toContain("server.properties");
	});

	it("never mistakes timestamps for IPv6 addresses", () => {
		const line = "2026-01-01T12:30:45.123Z player joined at 09:15:00";
		expect(redactHosts(line)).toBe(line);
	});

	it("masks full, compressed and bracketed IPv6 forms", () => {
		expect(redactHosts("fe80::1")).toContain("[IP_REDACTED]");
		expect(redactHosts("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toContain("[IP_REDACTED]");
		expect(redactHosts("[::1]:3000")).toContain("[IP_REDACTED]");
	});

	it("redacts serialized key/value secrets inside log lines", () => {
		const line =
			'{"req":{"headers":{"authorization":"Bearer abcdefghijklmnop","cookie":"session=1"}},"body":{"password":"hunter2","ok":"visible"}}';
		const out = redactLogText(line, "standard");
		expect(out).not.toContain("abcdefghijklmnop");
		expect(out).not.toContain("hunter2");
		expect(out).not.toContain("session=1");
		expect(out).toContain("visible");
	});

	it("redacts query-string secrets without stripping the path", () => {
		const out = redactLogText("GET /api/deploy?apiKey=catalyst_abc123&x=1", "standard");
		expect(out).toContain("/api/deploy");
		expect(out).not.toContain("catalyst_abc123");
	});

	it("classifies env keys precisely", () => {
		expect(isSensitiveEnvKey("POSTGRES_PASSWORD")).toBe(true);
		expect(isSensitiveEnvKey("WEBHOOK_SECRET")).toBe(true);
		expect(isSensitiveEnvKey("BACKUP_S3_ACCESS_KEY")).toBe(true);
		expect(isSensitiveEnvKey("SENTRY_DSN")).toBe(true);
		expect(isSensitiveEnvKey("REDIS_URL")).toBe(true);
		expect(isSensitiveEnvKey("BETTER_AUTH_URL")).toBe(false);
		expect(isSensitiveEnvKey("PUBLIC_URL")).toBe(false);
		expect(isSensitiveEnvKey("APP_NAME")).toBe(false);
		expect(isSensitiveEnvKey("LOG_LEVEL")).toBe(false);
	});

	it("redactEnvVar falls back to text scrubbing for non-secret keys", () => {
		expect(redactEnvVar("WEBHOOK_SECRET", "abc")).toBe("[REDACTED]");
		expect(redactEnvVar("PUBLIC_URL", "https://panel.example.com", "standard")).toBe(
			"https://panel.example.com",
		);
	});

	it("redactValue masks hosts deeply only in strict mode", () => {
		const payload = {
			server: { host: "10.1.2.3", name: "node-a" },
			token: "abcdef",
		};
		const standard = redactValue(payload, "standard") as Record<string, any>;
		expect(standard.token).toBe("[REDACTED]");
		expect(standard.server.host).toBe("10.1.2.3");

		const strict = redactValue(payload, "strict") as Record<string, any>;
		expect(strict.token).toBe("[REDACTED]");
		expect(strict.server.host).toBe("[IP_REDACTED]");
	});
});
