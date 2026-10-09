import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
	getUpdateStatus,
	getUpdateState,
	performUpdate,
	checkForUpdate,
	applyAutoUpdateScheme,
} from '../services/auto-updater.js';
import {
	getAutoUpdateSettings,
	readStoredAutoUpdateSettings,
	updateAutoUpdateSettings,
	clampAutoUpdateInterval,
	DEFAULT_AUTO_UPDATE_INTERVAL_MS,
	MIN_AUTO_UPDATE_INTERVAL_MS,
	MAX_AUTO_UPDATE_INTERVAL_MS,
} from '../services/auto-update-settings.js';
import { createAuditLog } from '../middleware/audit.js';
import { hasGrant } from '../lib/permissions.js';
import { apiError } from '../lib/http-error.js';
import { ErrorCodes } from '../shared-types';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isCacheStale(status: ReturnType<typeof getUpdateStatus>): boolean {
	if (!status.lastCheckedAt) return true;
	return Date.now() - new Date(status.lastCheckedAt).getTime() > CACHE_TTL_MS;
}

export async function updateRoutes(app: FastifyInstance) {
	const authenticate = (app as any).authenticate;

	// hasGrant semantics: '*' / admin.write satisfy anything; admin.read
	// satisfies read-class requirements only.
	const checkPerm = (request: any, permission: string): boolean => {
		const perms: string[] = request.user?.permissions ?? [];
		return hasGrant(perms, permission);
	};

	// Get update status (admin read)
	app.get(
		'/status',
		{ schema: { summary: 'Get panel update status', tags: ['Update'], response: { 200: { type: 'object' }, 403: { type: 'object' } } }, preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'admin.read')) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin read permission required');
			}

			if (isCacheStale(getUpdateStatus())) {
				await checkForUpdate(app.log);
			}

			const status = getUpdateStatus();
			return reply.send({
				currentVersion: status.currentVersion,
				latestVersion: status.latestVersion,
				updateAvailable: status.updateAvailable,
				lastCheckedAt: status.lastCheckedAt,
				releaseUrl: status.releaseUrl,
				isDocker: status.isDocker,
				autoUpdateEnabled: status.autoUpdateEnabled,
				autoUpdateAutoTrigger: status.autoUpdateAutoTrigger,
				autoUpdateIntervalMs: status.autoUpdateIntervalMs,
				autoUpdatePolling: status.autoUpdatePolling,
			});
		},
	);

	// Read the stored update-automation settings (admin read). Unlike
	// /status these come straight from the database, so the panel can render
	// the editable controls without triggering a release check.
	app.get(
		'/settings',
		{ schema: { summary: 'Get automatic update settings', tags: ['Update'], response: { 200: { type: 'object' }, 403: { type: 'object' } } }, preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'admin.read')) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin read permission required');
			}

			const stored = await readStoredAutoUpdateSettings();
			const effective = await getAutoUpdateSettings();
			return reply.send({
				...effective,
				/** False when the row has never been written and env vars seeded it. */
				configured: stored !== null,
				limits: {
					minIntervalMs: MIN_AUTO_UPDATE_INTERVAL_MS,
					maxIntervalMs: MAX_AUTO_UPDATE_INTERVAL_MS,
					defaultIntervalMs: DEFAULT_AUTO_UPDATE_INTERVAL_MS,
				},
			});
		},
	);

	// Change the update-automation settings at runtime (admin only). Takes
	// effect immediately: the poller is restarted or stopped in this process
	// and the change is published so other workers drop their cached copy.
	app.put(
		'/settings',
     { schema: { summary: 'Update automatic update settings', tags: ['Update'], response: { 200: { type: 'object' }, 400: { type: 'object' }, 403: { type: 'object' } } }, preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'admin.write')) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin write permission required');
			}

			const body = (request.body ?? {}) as {
				enabled?: unknown;
				autoTrigger?: unknown;
				intervalMs?: unknown;
			};

			const current = await getAutoUpdateSettings();
			const enabled = body.enabled === undefined ? current.enabled : body.enabled;
			const autoTrigger =
				body.autoTrigger === undefined ? current.autoTrigger : body.autoTrigger;

			if (typeof enabled !== 'boolean' || typeof autoTrigger !== 'boolean') {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'enabled and autoTrigger must be booleans');
			}

			let intervalMs = current.intervalMs;
			if (body.intervalMs !== undefined) {
				if (typeof body.intervalMs !== 'number' || !Number.isFinite(body.intervalMs)) {
					return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'intervalMs must be a number');
				}
				if (body.intervalMs < MIN_AUTO_UPDATE_INTERVAL_MS || body.intervalMs > MAX_AUTO_UPDATE_INTERVAL_MS) {
					return apiError(
						reply,
						400,
						ErrorCodes.VALIDATION_ERROR,
						`intervalMs must be between ${MIN_AUTO_UPDATE_INTERVAL_MS} and ${MAX_AUTO_UPDATE_INTERVAL_MS}`,
					);
				}
				intervalMs = clampAutoUpdateInterval(body.intervalMs);
			}

			const saved = await updateAutoUpdateSettings({ enabled, autoTrigger, intervalMs });

			// Restart polling with the new cadence (or stop it) right away.
			const status = await applyAutoUpdateScheme(app.log);

			await createAuditLog(request.user.userId, {
				action: 'update.settings.update',
				resource: 'system',
				request,
				details: { ...saved },
			});

			try {
				(app as any).wsGateway?.pushToAdminSubscribers?.('system_settings_updated', {
					updatedBy: request.user.userId,
				});
			} catch {
				/* non-fatal */
			}

			return reply.send({
				...saved,
				configured: true,
				autoUpdatePolling: status.autoUpdatePolling,
			});
		},
	);

	// Force a release check now (update.trigger; admin.write/* still pass
	// via hasGrant implications).
	app.post(
		'/check',
		{ schema: { summary: 'Check for a panel update', tags: ['Update'], response: { 200: { type: 'object' }, 403: { type: 'object' } } }, preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'update.trigger')) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Update trigger permission required');
			}
			const status = await checkForUpdate(app.log);
			return reply.send({
				currentVersion: status.currentVersion,
				latestVersion: status.latestVersion,
				updateAvailable: status.updateAvailable,
				lastCheckedAt: status.lastCheckedAt,
				releaseUrl: status.releaseUrl,
				isDocker: status.isDocker,
			});
		},
	);

	// Trigger update (update.trigger; admin.write/* still pass via hasGrant
	// implications).
	app.post(
		'/trigger',
		{ schema: { summary: 'Trigger a panel update', tags: ['Update'], response: { 200: { type: 'object' }, 400: { type: 'object' }, 403: { type: 'object' } } }, preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'update.trigger')) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Update trigger permission required');
			}

			const result = await performUpdate(app.log);
			if (result.success) {
				return reply.send({
					success: true,
					message: result.message,
				});
			}
			return reply.status(400).send({
				success: false,
				message: result.message,
				code: ErrorCodes.UPDATE_FAILED,
			});
		},
	);

	// Live update progress (admin read) — polled by the frontend while an
	// update is running so users can see what the panel is doing.
	app.get(
		'/state',
		{ schema: { summary: 'Get live panel update state', tags: ['Update'], response: { 200: { type: 'object' }, 403: { type: 'object' } } }, preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'admin.read')) {
				return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin read permission required');
			}
			return reply.send(getUpdateState());
		},
	);
}
