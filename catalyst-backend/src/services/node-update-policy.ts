/**
 * Which nodes are allowed to update their agent automatically.
 *
 * The panel used to push `update_agent` to every node whose agent version
 * trailed the panel's, so a single bad release rolled out everywhere at once.
 * Automatic updates are now opt-in per node (`Node.autoUpdateEnabled`); any
 * other node is updated on demand from Admin > System.
 *
 * `checkAgentUpdate` runs on every health report, so the flag is cached
 * briefly instead of hitting the database each time.
 */
import { prisma } from '../db.js';

const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { enabled: boolean; expiresAt: number }>();

/** Drop a node's cached flag after an admin changes it. */
export function invalidateNodeAutoUpdateCache(nodeId?: string): void {
	if (nodeId) {
		cache.delete(nodeId);
	} else {
		cache.clear();
	}
}

/** True when the admin approved automatic agent updates for this node. */
export async function isNodeAutoUpdateEnabled(nodeId: string): Promise<boolean> {
	const hit = cache.get(nodeId);
	if (hit && hit.expiresAt > Date.now()) return hit.enabled;

	const node = await prisma.node.findUnique({
		where: { id: nodeId },
		select: { autoUpdateEnabled: true },
	});
	const enabled = node?.autoUpdateEnabled === true;
	cache.set(nodeId, { enabled, expiresAt: Date.now() + CACHE_TTL_MS });
	return enabled;
}
