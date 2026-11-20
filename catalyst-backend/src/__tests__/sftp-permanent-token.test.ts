/**
 * Permanent SFTP tokens (Admin > Security opt-in).
 *
 * The raw token is persisted encrypted, validated by hash across panel
 * restarts, and can be revoked. The mailer module is mocked so the test does
 * not flip the panel-wide security row other test files share.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { sftpRoutes } from '../routes/sftp.js';
import {
	getPermanentSftpToken,
	validateSftpTokenAsync,
} from '../services/sftp-token-manager.js';

const { settingState } = vi.hoisted(() => ({
	settingState: { enabled: true },
}));

vi.mock('../services/mailer.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../services/mailer.js')>();
	return {
		...actual,
		getSecuritySettings: async () => ({
			...actual.DEFAULT_SECURITY_SETTINGS,
			sftpPermanentTokensEnabled: settingState.enabled,
		}),
	};
});

const testName = `sftp-perm-${nanoid(8)}`;
let app: FastifyInstance;
let ownerId: string;
let outsiderId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let currentUserId: string;

function buildApp() {
	const instance = Fastify({ logger: false });
	instance.decorate('authenticate', async (request: any) => {
		request.user = {
			userId: currentUserId,
			email: `${testName}@example.com`,
			username: testName,
			permissions: ['file.read', 'file.write', 'server.update'],
		};
	});
	instance.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);
	return instance;
}

describe('permanent SFTP tokens', () => {
	beforeAll(async () => {
		const owner = await prisma.user.create({
			data: {
				email: `${testName}-owner@example.com`,
				username: `sftpperm${nanoid(5)}`,
				name: 'SFTP permanent owner',
				emailVerified: true,
			},
		});
		ownerId = owner.id;
		const outsider = await prisma.user.create({
			data: {
				email: `${testName}-outsider@example.com`,
				username: `sftppermout${nanoid(5)}`,
				name: 'SFTP permanent outsider',
				emailVerified: true,
			},
		});
		outsiderId = outsider.id;

		const location = await prisma.location.create({
			data: { name: `${testName}-location` },
		});
		locationId = location.id;

		const node = await prisma.node.create({
			data: {
				name: `${testName}-node`,
				locationId,
				hostname: 'sftp-perm.example.com',
				publicAddress: '10.99.0.11',
				secret: `sftp-perm-${nanoid(16)}`,
				maxMemoryMb: 1_000_000,
				maxCpuCores: 1024,
				isOnline: true,
			},
		});
		nodeId = node.id;

		const template = await prisma.serverTemplate.create({
			data: {
				name: `${testName}-template`,
				author: 'Test',
				version: '1.0.0',
				image: 'alpine:latest',
				images: [{ name: 'main', image: 'alpine:latest' }],
				startup: 'echo template',
				stopCommand: 'stop',
				supportedPorts: [25565],
				variables: [],
				allocatedMemoryMb: 1024,
				allocatedCpuCores: 1,
			},
		});
		templateId = template.id;

		const server = await prisma.server.create({
			data: {
				name: `${testName}-server`,
				uuid: `uuid-${nanoid(12)}`,
				templateId,
				nodeId,
				locationId,
				ownerId,
				allocatedMemoryMb: 1024,
				allocatedCpuCores: 1,
				allocatedDiskMb: 10240,
				primaryPort: 25576,
				networkMode: 'bridge',
				environment: {},
			},
		});
		serverId = server.id;

		currentUserId = ownerId;
		app = buildApp();
		await app.register(sftpRoutes);
	});

	afterAll(async () => {
		if (app) await app.close();
		if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
		if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
		if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
		if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
		if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
		if (outsiderId) await prisma.user.delete({ where: { id: outsiderId } }).catch(() => {});
	});

	it('mints, persists, lists and rotates a permanent token', async () => {
		currentUserId = ownerId;
		settingState.enabled = true;

		const first = await app.inject({
			method: 'POST',
			url: '/api/sftp/permanent-token',
			payload: { serverId },
		});
		expect(first.statusCode).toBe(200);
		const firstToken = (first.json() as any).data.token as string;
		expect(firstToken.startsWith('sftp_perm_')).toBe(true);

		expect(await validateSftpTokenAsync(firstToken, serverId)).toEqual({
			userId: ownerId,
			serverId,
		});
		expect(await getPermanentSftpToken(ownerId, serverId)).toMatchObject({
			token: firstToken,
		});

		const listed = await app.inject({
			method: 'GET',
			url: `/api/sftp/tokens?serverId=${serverId}`,
		});
		expect(listed.statusCode).toBe(200);
		const row = (listed.json() as any).data.find(
			(entry: any) => entry.permanent && entry.userId === ownerId,
		);
		expect(row).toMatchObject({ permanent: true, expiresAt: null, token: firstToken });

		const info = await app.inject({
			method: 'GET',
			url: `/api/sftp/connection-info?serverId=${serverId}`,
		});
		expect(info.statusCode).toBe(200);
		const infoBody = (info.json() as any).data;
		expect(infoBody.permanentTokensEnabled).toBe(true);
		expect(infoBody.permanentToken).toMatchObject({
			userId: ownerId,
			token: firstToken,
		});

		const second = await app.inject({
			method: 'POST',
			url: '/api/sftp/permanent-token',
			payload: { serverId },
		});
		expect(second.statusCode).toBe(200);
		const secondToken = (second.json() as any).data.token as string;
		expect(secondToken).not.toBe(firstToken);
		expect(await validateSftpTokenAsync(firstToken, serverId)).toBeNull();
		expect(await validateSftpTokenAsync(secondToken, serverId)).toEqual({
			userId: ownerId,
			serverId,
		});
	});

	it('is gated by the admin setting and by server access', async () => {
		settingState.enabled = false;
		currentUserId = ownerId;

		const disabled = await app.inject({
			method: 'POST',
			url: '/api/sftp/permanent-token',
			payload: { serverId },
		});
		expect(disabled.statusCode).toBe(403);
		expect((disabled.json() as any).code).toBe('SFTP_PERMANENT_TOKENS_DISABLED');

		// An existing token is inert while the setting is off.
		const existing = await prisma.sftpPermanentToken.findFirst({ where: { serverId } });
		expect(existing).not.toBeNull();
		expect(
			await validateSftpTokenAsync((await getPermanentSftpToken(ownerId, serverId))!.token!, serverId),
		).toBeNull();

		settingState.enabled = true;
		currentUserId = outsiderId;
		const forbidden = await app.inject({
			method: 'POST',
			url: '/api/sftp/permanent-token',
			payload: { serverId },
		});
		expect(forbidden.statusCode).toBe(403);

		// The permanent token list is not exposed to outsiders either.
		const outsiderList = await app.inject({
			method: 'GET',
			url: `/api/sftp/tokens?serverId=${serverId}`,
		});
		expect(outsiderList.statusCode).toBe(403);

		currentUserId = ownerId;
	});

	it('revokes the permanent token through the session revoke endpoint', async () => {
		const before = await getPermanentSftpToken(ownerId, serverId);
		expect(before?.token).toBeTruthy();

		const revoked = await app.inject({
			method: 'DELETE',
			url: `/api/sftp/tokens/${ownerId}?serverId=${serverId}`,
		});
		expect(revoked.statusCode).toBe(200);
		expect(await getPermanentSftpToken(ownerId, serverId)).toBeNull();
		expect(await validateSftpTokenAsync(before!.token!, serverId)).toBeNull();
	});
});
