/**
 * Automatic agent updates are opt-in per node. The gateway consults this on
 * every health report, so the contract is: default off, cached, and
 * invalidatable the moment an admin changes the selection.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import {
	invalidateNodeAutoUpdateCache,
	isNodeAutoUpdateEnabled,
} from '../services/node-update-policy';

let locationId: string;
let nodeId: string;

beforeAll(async () => {
	const location = await prisma.location.create({
		data: { name: `node-policy-loc-${nanoid(8)}` },
	});
	locationId = location.id;

	const node = await prisma.node.create({
		data: {
			name: `node-policy-${nanoid(8)}`,
			locationId,
			hostname: 'node-policy.example.com',
			publicAddress: '10.9.9.9',
			secret: `secret-${nanoid(16)}`,
			maxMemoryMb: 2048,
			maxCpuCores: 2,
		},
	});
	nodeId = node.id;
});

afterAll(async () => {
	invalidateNodeAutoUpdateCache(nodeId);
	await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
	await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('isNodeAutoUpdateEnabled', () => {
	it('defaults to false so a new node never updates itself', async () => {
		expect(await isNodeAutoUpdateEnabled(nodeId)).toBe(false);
	});

	it('returns true once the admin opts the node in and the cache is dropped', async () => {
		await prisma.node.update({ where: { id: nodeId }, data: { autoUpdateEnabled: true } });
		invalidateNodeAutoUpdateCache(nodeId);
		expect(await isNodeAutoUpdateEnabled(nodeId)).toBe(true);

		await prisma.node.update({ where: { id: nodeId }, data: { autoUpdateEnabled: false } });
		invalidateNodeAutoUpdateCache(nodeId);
		expect(await isNodeAutoUpdateEnabled(nodeId)).toBe(false);
	});

	it('treats a missing node as not approved', async () => {
		expect(await isNodeAutoUpdateEnabled('does-not-exist')).toBe(false);
	});
});
