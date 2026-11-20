/**
 * Template default disk allocation.
 *
 * The create wizard reads `ServerTemplate.allocatedDiskMb` to prefill the new
 * server's disk; the create/update routes must persist it (and default to the
 * historical 10 GiB when an older client omits it).
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { templateRoutes } from '../routes/templates.js';

const createdTemplateNames = new Set<string>();

function buildApp() {
	const app = Fastify({ logger: false });
	app.decorate('authenticate', async (request: any) => {
		request.user = {
			userId: 'template-disk-test-user',
			email: 'template-disk@example.com',
			username: 'template-disk',
			permissions: ['template.read', 'template.create', 'template.update', 'template.delete'],
		};
	});
	app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);
	return app;
}

function templatePayload(name: string, overrides: Record<string, unknown> = {}) {
	return {
		name,
		author: 'Disk test',
		version: '1.0.0',
		image: 'alpine:latest',
		startup: 'echo hello',
		stopCommand: 'stop',
		sendSignalTo: 'SIGTERM',
		variables: [],
		supportedPorts: [25565],
		allocatedMemoryMb: 1024,
		allocatedCpuCores: 1,
		...overrides,
	};
}

describe('template default disk allocation', () => {
	let app: FastifyInstance;

	beforeAll(async () => {
		app = buildApp();
		await app.register(templateRoutes, { prefix: '/api/templates' });
	});

	afterAll(async () => {
		if (createdTemplateNames.size > 0) {
			await prisma.serverTemplate.deleteMany({
				where: { name: { in: [...createdTemplateNames] } },
			});
		}
		await app.close();
	});

	it('persists a caller-supplied disk default on create and update', async () => {
		const name = `disk-template-${nanoid(8)}`;
		createdTemplateNames.add(name);

		const created = await app.inject({
			method: 'POST',
			url: '/api/templates',
			payload: templatePayload(name, { allocatedDiskMb: 15360 }),
		});
		expect(created.statusCode).toBe(201);
		const createdBody = created.json() as any;
		expect(createdBody.data.allocatedDiskMb).toBe(15360);

		const listed = await app.inject({ method: 'GET', url: '/api/templates' });
		expect(listed.statusCode).toBe(200);
		const listRow = (listed.json() as any).data.find((row: any) => row.id === createdBody.data.id);
		expect(listRow.allocatedDiskMb).toBe(15360);

		const updated = await app.inject({
			method: 'PUT',
			url: `/api/templates/${createdBody.data.id}`,
			payload: { allocatedDiskMb: 20480 },
		});
		expect(updated.statusCode).toBe(200);
		expect((updated.json() as any).data.allocatedDiskMb).toBe(20480);

		const stored = await prisma.serverTemplate.findUnique({
			where: { id: createdBody.data.id },
			select: { allocatedDiskMb: true },
		});
		expect(stored?.allocatedDiskMb).toBe(20480);
	});

	it('defaults older clients that omit the field to 10240 and clamps bad values', async () => {
		const name = `disk-default-${nanoid(8)}`;
		createdTemplateNames.add(name);

		const created = await app.inject({
			method: 'POST',
			url: '/api/templates',
			payload: templatePayload(name),
		});
		expect(created.statusCode).toBe(201);
		const body = created.json() as any;
		expect(body.data.allocatedDiskMb).toBe(10240);

		const tooSmall = await app.inject({
			method: 'PUT',
			url: `/api/templates/${body.data.id}`,
			payload: { allocatedDiskMb: 10 },
		});
		expect(tooSmall.statusCode).toBe(200);
		expect((tooSmall.json() as any).data.allocatedDiskMb).toBe(1024);
	});
});
