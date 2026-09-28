import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import extract from "extract-zip";
import { nanoid } from "nanoid";
import { prisma } from "../db.js";
import { adminRoutes } from "../routes/admin.js";
import { collectDiagnostics } from "../services/diagnostics/collect.js";
import type { CommandRunner } from "../services/diagnostics/panel-logs.js";

const SERVER_UUID = "11111111-1111-1111-1111-111111111111";

function fakeDeps(overrides: {
	nodeOnline?: boolean;
	serverLogRows?: Array<{ stream: string; data: string; timestamp: Date }>;
	envResponse?: { success: boolean; body?: Buffer; error?: string };
	systemErrors?: any[];
	nodeLogs?: unknown[];
} = {}) {
	const prismaStub = {
		systemError: {
			findMany: async () => overrides.systemErrors ?? [],
		},
		serverLog: {
			findMany: async () => overrides.serverLogRows ?? [],
		},
	} as any;

	const wsGateway = {
		requestFromAgent: async () => ({
			logs:
				overrides.nodeLogs ??
				[
					{
						timestamp: "2026-01-01T00:00:00.000Z",
						level: "error",
						target: "catalyst_agent::runtime",
						message: "container died at 10.0.0.9",
					},
				],
		}),
	};

	const fileTunnel = {
		queueRequest: async () =>
			overrides.envResponse ?? {
				requestId: "req-1",
				success: true,
				body: Buffer.from("PUBLIC_URL=https://panel.example.com\nSECRET_TOKEN=abc123\n"),
			},
	};

	const warn = () => {};

	return { prisma: prismaStub, wsGateway, fileTunnel, logger: { warn } };
}

const panelLogRunner: CommandRunner = async () => ({
	stdout:
		'2026-01-01T00:00:00.000Z {"level":30,"msg":"panel started","license_key":"CAT-9999","host":"10.0.0.9"}',
	stderr: "",
	exitCode: 0,
	truncated: false,
});

describe("collectDiagnostics", () => {
	it("bundles panel, error, node and server data with redaction", async () => {
		const deps = fakeDeps({
			systemErrors: [
				{
					id: "err-1",
					level: "error",
					component: "HTTP",
					message: "request failed from 10.0.0.7",
					stack: "at handler (/app/index.js:1:1)",
					metadata: { apiKey: "catalyst_secret", ip: "10.0.0.7" },
					requestId: null,
					userId: null,
					nodeId: "n1",
					resolved: false,
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
				},
			],
			serverLogRows: [
				{ stream: "stdout", data: "server online\n", timestamp: new Date("2026-01-01T00:00:00.000Z") },
			],
		});

		const { entries, manifest } = await collectDiagnostics(deps as any, {
			from: new Date("2025-12-31T00:00:00.000Z"),
			to: new Date("2026-01-01T00:00:00.000Z"),
			redaction: "standard",
			sections: new Set(["panel", "errors", "nodes", "servers", "env"] as const),
			nodes: [{ id: "n1", name: "Node One", online: true }],
			servers: [
				{ id: "s1", name: "Survival", uuid: SERVER_UUID, nodeId: "n1", includeEnv: true },
			],
			actor: { userId: "u1", username: "admin" },
			env: { NODE_ENV: "test", PUBLIC_URL: "https://panel.example.com", BETTER_AUTH_SECRET: "topsecret" },
			panelLogRunner,
		});

		const byPath = new Map(entries.map((entry) => [entry.path, String(entry.content)]));
		expect([...byPath.keys()].sort()).toEqual(
			[
				"README.txt",
				"manifest.json",
				"nodes/n1.log",
				"panel/environment.txt",
				"panel/logs.txt",
				"panel/system-errors.json",
				"servers/s1/.env",
				"servers/s1/console.log",
			].sort(),
		);

		// Panel logs: license key scrubbed, host kept in standard mode.
		expect(byPath.get("panel/logs.txt")).not.toContain("CAT-9999");
		expect(byPath.get("panel/logs.txt")).toContain("10.0.0.9");

		// Panel environment: secret redacted, routing config preserved.
		expect(byPath.get("panel/environment.txt")).not.toContain("topsecret");
		expect(byPath.get("panel/environment.txt")).toContain("PUBLIC_URL=https://panel.example.com");

		// System error metadata is deep-redacted by key.
		const errors = JSON.parse(byPath.get("panel/system-errors.json") ?? "{}");
		expect(errors.count).toBe(1);
		expect(errors.errors[0].metadata.apiKey).toBe("[REDACTED]");
		expect(errors.errors[0].metadata.ip).toBe("10.0.0.7");

		// Node + server logs present.
		expect(byPath.get("nodes/n1.log")).toContain("container died");
		expect(byPath.get("servers/s1/console.log")).toContain("server online");

		// Server .env: secret redacted, public URL preserved.
		expect(byPath.get("servers/s1/.env")).toContain("PUBLIC_URL=https://panel.example.com");
		expect(byPath.get("servers/s1/.env")).toContain("SECRET_TOKEN=[REDACTED]");
		expect(byPath.get("servers/s1/.env")).not.toContain("abc123");

		expect(manifest.sections.panelLogs?.lines).toBeGreaterThan(0);
		expect(manifest.sections.systemErrors?.count).toBe(1);
		expect(manifest.sections.nodes?.[0]).toMatchObject({ id: "n1", lines: 1 });
		expect(manifest.sections.servers?.[0]).toMatchObject({
			id: "s1",
			lines: 1,
			envIncluded: true,
		});
		expect(manifest.warnings).toEqual([]);
	});

	it("masks IPs and hostnames in strict mode", async () => {
		const deps = fakeDeps();
		const { entries } = await collectDiagnostics(deps as any, {
			from: new Date("2025-12-31T00:00:00.000Z"),
			to: new Date("2026-01-01T00:00:00.000Z"),
			redaction: "strict",
			sections: new Set(["panel", "nodes", "servers"] as const),
			nodes: [{ id: "n1", name: "Node One", online: true }],
			servers: [],
			actor: { userId: "u1" },
			env: {},
			panelLogRunner,
		});
		const byPath = new Map(entries.map((entry) => [entry.path, String(entry.content)]));
		expect(byPath.get("panel/logs.txt")).toContain("[IP_REDACTED]");
		expect(byPath.get("panel/logs.txt")).not.toContain("10.0.0.9");
		expect(byPath.get("nodes/n1.log")).toContain("[IP_REDACTED]");
	});

	it("drops node log entries outside the window returned by an older agent", async () => {
		const deps = fakeDeps({
			nodeLogs: [
				{
					timestamp: "2025-06-01T00:00:00.000Z",
					level: "info",
					target: "agent",
					message: "ancient line",
				},
				{
					timestamp: "2026-01-01T00:00:00.000Z",
					level: "info",
					target: "agent",
					message: "recent line",
				},
				{ level: "info", target: "agent", message: "line without timestamp" },
			],
		});
		const { entries, manifest } = await collectDiagnostics(deps as any, {
			from: new Date("2025-12-31T00:00:00.000Z"),
			to: new Date("2026-01-01T00:00:00.000Z"),
			redaction: "standard",
			sections: new Set(["nodes"] as const),
			nodes: [{ id: "n1", name: "Node One", online: true }],
			servers: [],
			actor: { userId: "u1" },
			env: {},
		});
		const nodeLog = String(entries.find((entry) => entry.path === "nodes/n1.log")?.content ?? "");
		expect(nodeLog).toContain("recent line");
		expect(nodeLog).not.toContain("ancient line");
		expect(nodeLog).toContain("line without timestamp");
		expect(manifest.sections.nodes?.[0]?.lines).toBe(2);
	});

	it("records offline nodes as warnings instead of failing", async () => {
		const deps = fakeDeps();
		const { entries, manifest } = await collectDiagnostics(deps as any, {
			from: new Date("2025-12-31T00:00:00.000Z"),
			to: new Date("2026-01-01T00:00:00.000Z"),
			redaction: "standard",
			sections: new Set(["nodes"] as const),
			nodes: [{ id: "n-off", name: "Offline Node", online: false }],
			servers: [],
			actor: { userId: "u1" },
			env: {},
		});
		expect(entries.some((entry) => entry.path === "nodes/n-off.log")).toBe(false);
		expect(manifest.sections.nodes?.[0]).toMatchObject({ id: "n-off", error: "node offline" });
		expect(manifest.warnings.join(" ")).toContain("Offline Node");
	});

	it("treats a missing server .env as normal, not an error", async () => {
		const deps = fakeDeps({
			envResponse: { success: false, error: "File not found" } as any,
		});
		const { entries, manifest } = await collectDiagnostics(deps as any, {
			from: new Date("2025-12-31T00:00:00.000Z"),
			to: new Date("2026-01-01T00:00:00.000Z"),
			redaction: "standard",
			sections: new Set(["servers", "env"] as const),
			nodes: [],
			servers: [
				{ id: "s1", name: "Survival", uuid: SERVER_UUID, nodeId: "n1", includeEnv: true },
			],
			actor: { userId: "u1" },
			env: {},
		});
		expect(entries.some((entry) => entry.path === "servers/s1/.env")).toBe(false);
		expect(manifest.sections.servers?.[0]?.envIncluded).toBe(false);
		expect(manifest.sections.servers?.[0]?.error).toBeUndefined();
		expect(manifest.warnings).toEqual([]);
	});

	it("skips the .env tunnel call when the node is known to be offline", async () => {
		let tunnelCalls = 0;
		const deps = fakeDeps();
		deps.fileTunnel.queueRequest = async () => {
			tunnelCalls += 1;
			throw new Error("should not be called");
		};
		const { manifest } = await collectDiagnostics(deps as any, {
			from: new Date("2025-12-31T00:00:00.000Z"),
			to: new Date("2026-01-01T00:00:00.000Z"),
			redaction: "standard",
			sections: new Set(["servers", "env"] as const),
			nodes: [],
			servers: [
				{
					id: "s1",
					name: "Survival",
					uuid: SERVER_UUID,
					nodeId: "n1",
					includeEnv: true,
					nodeOnline: false,
				},
			],
			actor: { userId: "u1" },
			env: {},
		});
		expect(tunnelCalls).toBe(0);
		expect(manifest.sections.servers?.[0]?.envIncluded).toBe(false);
		expect(manifest.warnings).toEqual([]);
	});
});

// ── HTTP route ──────────────────────────────────────────────────────────────

let testUserId: string;
const createdErrorIds: string[] = [];

function buildTestApp(perms: string[] = ["admin.read"]) {
	const app = Fastify({ logger: false });
	app.decorate("authenticate", async (request: any) => {
		request.user = { userId: testUserId, email: "t@t.com", username: "t", permissions: perms };
	});
	app.decorate("wsGateway", undefined as any);
	return app;
}

beforeAll(async () => {
	const user = await prisma.user.create({
		data: {
			email: `diag-${nanoid(6)}@t.com`,
			name: "diag test",
			username: `diag_${nanoid(6)}`,
			emailVerified: true,
		},
	});
	testUserId = user.id;
	const created = await prisma.systemError.create({
		data: {
			level: "error",
			component: "DiagnosticsTest",
			message: "diagnostics route fixture",
			createdAt: new Date(),
		},
	});
	createdErrorIds.push(created.id);
});

afterAll(async () => {
	await prisma.systemError.deleteMany({ where: { id: { in: createdErrorIds } } });
	await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
});

describe("GET /api/admin/diagnostics/export", () => {
	it("requires admin.read", async () => {
		const app = buildTestApp([]);
		await app.register(adminRoutes, { prefix: "/api/admin" });
		const res = await app.inject({ method: "GET", url: "/api/admin/diagnostics/export" });
		expect(res.statusCode).toBe(403);
		await app.close();
	});

	it("rejects an invalid redaction mode", async () => {
		const app = buildTestApp();
		await app.register(adminRoutes, { prefix: "/api/admin" });
		const res = await app.inject({
			method: "GET",
			url: "/api/admin/diagnostics/export?redaction=loud",
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it("rejects an unknown section", async () => {
		const app = buildTestApp();
		await app.register(adminRoutes, { prefix: "/api/admin" });
		const res = await app.inject({
			method: "GET",
			url: "/api/admin/diagnostics/export?sections=errors,banana",
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it("rejects unknown node ids before collecting", async () => {
		const app = buildTestApp();
		await app.register(adminRoutes, { prefix: "/api/admin" });
		const res = await app.inject({
			method: "GET",
			url: "/api/admin/diagnostics/export?sections=nodes&nodes=does-not-exist",
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it("streams a ZIP whose manifest lists the collected sections", async () => {
		const app = buildTestApp();
		await app.register(adminRoutes, { prefix: "/api/admin" });
		const res = await app.inject({
			method: "GET",
			url: "/api/admin/diagnostics/export?sections=errors&hours=24",
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers["content-type"]).toContain("application/zip");
		expect(String(res.headers["content-disposition"])).toContain("catalyst-diagnostics-");

		const tmp = await mkdtemp(path.join(os.tmpdir(), "catalyst-diag-test-"));
		try {
			const zipPath = path.join(tmp, "bundle.zip");
			await writeFile(zipPath, res.rawPayload);
			const outDir = path.join(tmp, "out");
			await mkdir(outDir);
			await extract(zipPath, { dir: outDir });

			const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
			expect(manifest.sections.systemErrors.count).toBeGreaterThanOrEqual(1);
			expect(manifest.redaction).toBe("standard");
			expect(manifest.window.hours).toBe(24);

			const readme = await readFile(path.join(outDir, "README.txt"), "utf8");
			expect(readme).toContain("Catalyst troubleshooting bundle");
		} finally {
			await rm(tmp, { recursive: true, force: true });
			await app.close();
		}
	});
});
