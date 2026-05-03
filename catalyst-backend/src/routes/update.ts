import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
	getUpdateStatus,
	performUpdate,
	checkForUpdate,
} from '../services/auto-updater.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isCacheStale(status: ReturnType<typeof getUpdateStatus>): boolean {
	if (!status.lastCheckedAt) return true;
	return Date.now() - new Date(status.lastCheckedAt).getTime() > CACHE_TTL_MS;
}

export async function updateRoutes(app: FastifyInstance) {
	const authenticate = (app as any).authenticate;

	const checkPerm = (request: any, permission: string): boolean => {
		const perms: string[] = request.user?.permissions ?? [];
		return perms.includes('*') || perms.includes(permission);
	};

	// Get update status (admin only)
	app.get(
		'/status',
		{ preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'admin.write')) {
				return reply.status(403).send({ error: 'Admin write permission required' });
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
			});
		},
	);

	// Trigger update (admin only)
	app.post(
		'/trigger',
		{ preHandler: [authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!checkPerm(request, 'admin.write')) {
				return reply.status(403).send({ error: 'Admin write permission required' });
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
			});
		},
	);
}
