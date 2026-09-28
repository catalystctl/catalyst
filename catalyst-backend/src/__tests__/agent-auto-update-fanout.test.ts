/**
 * Regression: the panel used to push `update_agent` to every outdated node.
 * `checkAgentUpdate` must now stop at a node the admin has not approved, and
 * still send the command for one that is approved.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';

vi.mock('../services/auto-updater', () => ({
	getCurrentVersion: () => '1.0.0',
}));

import { WebSocketGateway } from '../websocket/gateway.js';
import { invalidateNodeAutoUpdateCache } from '../services/node-update-policy';

let locationId: string;
let manualNodeId: string;
let autoNodeId: string;

const loggerStub = {
	child: () => loggerStub,
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
} as any;

beforeAll(async () => {
	const location = await prisma.location.create({
		data: { name: `agent-fanout-loc-${nanoid(8)}` },
	});
	locationId = location.id;

	const manual = await prisma.node.create({
		data: {
			name: `agent-fanout-manual-${nanoid(8)}`,
			locationId,
			hostname: 'manual.example.com',
			publicAddress: '10.1.1.1',
			secret: `secret-${nanoid(16)}`,
			maxMemoryMb: 2048,
			maxCpuCores: 2,
			autoUpdateEnabled: false,
		},
	});
	manualNodeId = manual.id;

	const auto = await prisma.node.create({
		data: {
			name: `agent-fanout-auto-${nanoid(8)}`,
			locationId,
			hostname: 'auto.example.com',
			publicAddress: '10.1.1.2',
			secret: `secret-${nanoid(16)}`,
			maxMemoryMb: 2048,
			maxCpuCores: 2,
			autoUpdateEnabled: true,
		},
	});
	autoNodeId = auto.id;
});

afterAll(async () => {
	invalidateNodeAutoUpdateCache(manualNodeId);
	invalidateNodeAutoUpdateCache(autoNodeId);
	await prisma.node.deleteMany({ where: { id: { in: [manualNodeId, autoNodeId] } } });
	await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

function makeGateway() {
	const gw = new WebSocketGateway(prisma as any, loggerStub);
	const sent: unknown[] = [];
	gw.sendToAgent = (async (_nodeId: string, message: unknown) => {
		sent.push(message);
		return true;
	}) as any;
	return { gw, sent };
}

describe('checkAgentUpdate honours the per-node opt-in', () => {
	it('never sends update_agent to a node that is not approved', async () => {
		const { gw, sent } = makeGateway();
		await (gw as any).checkAgentUpdate(manualNodeId, '0.9.0');
		expect(sent).toEqual([]);
		expect((gw as any).agentUpdateSent.has(manualNodeId)).toBe(false);
		gw.destroy();
	});

	it('sends update_agent to an approved node that is behind', async () => {
		const { gw, sent } = makeGateway();
		await (gw as any).checkAgentUpdate(autoNodeId, '0.9.0');
		expect(sent).toEqual([{ type: 'update_agent', targetVersion: '1.0.0' }]);
		expect((gw as any).agentUpdateSent.get(autoNodeId)).toBe('1.0.0');
		gw.destroy();
	});

	it('leaves up-to-date approved nodes alone', async () => {
		const { gw, sent } = makeGateway();
		await (gw as any).checkAgentUpdate(autoNodeId, '1.0.0');
		expect(sent).toEqual([]);
		gw.destroy();
	});
});
