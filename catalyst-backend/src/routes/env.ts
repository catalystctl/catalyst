/**
 * Admin environment-variable routes (mounted at /api/admin/environment).
 *
 * Reads list every registered variable with its effective value, where it came
 * from, and whether it differs from the value the running panel booted with.
 * Writes persist a database override; the panel then asks the operator to
 * restart for changes that need it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ErrorCodes } from "../shared-types";
import { apiError } from "../lib/http-error";
import { hasGrant } from "../lib/permissions";
import { createAuditLog } from "../middleware/audit";
import {
	EnvValidationError,
	getEnvOverview,
	getEnvRestartStatus,
	resetEnvSetting,
	updateEnvSettings,
} from "../services/env-settings";
import { panelRestartStrategy, schedulePanelRestart } from "../lib/panel-restart";

const RESTART_PERMISSION = "admin.write";

export async function envRoutes(app: FastifyInstance): Promise<void> {
	const authenticate = (app as any).authenticate;

	const checkPerm = (request: FastifyRequest, permission: string): boolean => {
		const perms: string[] = (request as any).user?.permissions ?? [];
		return hasGrant(perms, permission);
	};

	const requireRead = (request: FastifyRequest, reply: FastifyReply): boolean => {
		if (!checkPerm(request, "admin.read")) {
			apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Admin read permission required");
			return false;
		}
		return true;
	};

	const requireWrite = (request: FastifyRequest, reply: FastifyReply): boolean => {
		if (!checkPerm(request, RESTART_PERMISSION)) {
			apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Admin write permission required");
			return false;
		}
		return true;
	};

	app.get("/", { schema: { summary: "Get environment settings overview", tags: ["Admin", "Environment"], response: { 200: { type: "object", additionalProperties: true } } }, preHandler: authenticate }, async (request, reply) => {
		if (!requireRead(request, reply)) return;
		const overview = await getEnvOverview();
		return reply.send({ success: true, data: overview });
	});

	app.get("/restart-status", { schema: { summary: "Get panel restart status", tags: ["Admin", "Environment"], response: { 200: { type: "object", additionalProperties: true } } }, preHandler: authenticate }, async (request, reply) => {
		if (!requireRead(request, reply)) return;
		const status = await getEnvRestartStatus();
		return reply.send({
			success: true,
			data: { ...status, strategy: panelRestartStrategy() },
		});
	});

	app.put("/", { schema: { summary: "Update environment overrides", tags: ["Admin", "Environment"], body: { type: "object", required: ["values"], properties: { values: { type: "object", additionalProperties: { type: ["string", "null"] } } } }, response: { 200: { type: "object", additionalProperties: true }, 400: { type: "object", additionalProperties: true } } }, preHandler: authenticate }, async (request, reply) => {
		if (!requireWrite(request, reply)) return;
		const body = request.body as { values?: Record<string, string | null> } | undefined;
		const values = body?.values;
		if (!values || typeof values !== "object" || Array.isArray(values)) {
			return apiError(
				reply,
				400,
				ErrorCodes.VALIDATION_ERROR,
				"Expected a `values` object of environment overrides",
			);
		}
		try {
			const overview = await updateEnvSettings(values);
			await createAuditLog((request as any).user.userId, {
				request,
				action: "environment.settings.update",
				resource: "system",
				details: { keys: Object.keys(values) },
			});
			const wsGateway = (app as any).wsGateway;
			try {
				wsGateway?.pushToAdminSubscribers("env_settings_updated", {
					keys: Object.keys(values),
				});
			} catch {
				/* WS push is best-effort */
			}
			return reply.send({ success: true, data: overview });
		} catch (error) {
			if (error instanceof EnvValidationError) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, error.message, {
					params: { key: error.key },
				});
			}
			throw error;
		}
	});

	app.delete("/:key", { schema: { summary: "Reset an environment override", tags: ["Admin", "Environment"], params: { type: "object", required: ["key"], properties: { key: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true }, 400: { type: "object", additionalProperties: true } } }, preHandler: authenticate }, async (request, reply) => {
		if (!requireWrite(request, reply)) return;
		const { key } = request.params as { key: string };
		try {
			const overview = await resetEnvSetting(key);
			await createAuditLog((request as any).user.userId, {
				request,
				action: "environment.settings.reset",
				resource: "system",
				details: { key },
			});
			// Sibling of PUT: a reset changes effective values the same way.
			try {
				(app as any).wsGateway?.pushToAdminSubscribers("env_settings_updated", {
					type: "env_settings_updated",
					keys: [key],
					action: "reset",
					updatedBy: (request as any).user.userId,
					timestamp: new Date().toISOString(),
				});
			} catch {
				/* WS push is best-effort */
			}
			return reply.send({ success: true, data: overview });
		} catch (error) {
			if (error instanceof EnvValidationError) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, error.message, {
					params: { key: error.key },
				});
			}
			throw error;
		}
	});

	app.post("/restart", { schema: { summary: "Schedule a panel restart", tags: ["Admin", "Environment"], response: { 200: { type: "object", additionalProperties: true } } }, preHandler: authenticate }, async (request, reply) => {
		if (!requireWrite(request, reply)) return;
		const strategy = panelRestartStrategy();
		await createAuditLog((request as any).user.userId, {
			request,
			action: "environment.panel.restart",
			resource: "system",
			details: { strategy },
		});
		schedulePanelRestart();
		// Sibling of PUT: tell admin viewers the env set changed (the panel is
		// about to drop every stream connection anyway).
		try {
			(app as any).wsGateway?.pushToAdminSubscribers("env_settings_updated", {
				type: "env_settings_updated",
				keys: [],
				action: "restart_scheduled",
				updatedBy: (request as any).user.userId,
				timestamp: new Date().toISOString(),
			});
		} catch {
			/* WS push is best-effort */
		}
		return reply.send({
			success: true,
			data: {
				restarting: true,
				strategy,
				message:
					strategy === "standalone"
						? "The panel process is stopping. Start it again to apply the changes."
						: "The panel is restarting. This page will reconnect automatically.",
			},
		});
	});
}
