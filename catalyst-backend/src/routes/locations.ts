import { prisma } from "../db.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasPermission } from "../lib/permissions";
import { serialize } from "../utils/serialize";

const ensurePermission = async (
	userId: string,
	reply: FastifyReply,
	requiredPermission: string,
) => {
	const has = await hasPermission(prisma, userId, requiredPermission);
	if (!has) {
		reply.status(403).send({ error: "Insufficient permissions" });
		return false;
	}
	return true;
};

const ensureAdmin = async (userId: string, reply: FastifyReply) => {
	const roles = await prisma.role.findMany({
		where: { users: { some: { id: userId } } },
		select: { permissions: true, name: true },
	});
	const permissions = roles.flatMap((role) => role.permissions);
	const isAdmin =
		permissions.includes("*") ||
		permissions.includes("admin.write") ||
		roles.some((role) => role.name.toLowerCase() === "administrator");
	if (!isAdmin) {
		reply.status(403).send({ error: "Admin access required" });
		return false;
	}
	return true;
};

export async function locationRoutes(app: FastifyInstance) {
	// List all locations (with node count)
	app.get(
		"/",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				request.user.userId,
				reply,
				"admin.read",
			);
			if (!has) return;

			const locations = await prisma.location.findMany({
				orderBy: { name: "asc" },
				include: {
					_count: {
						select: { nodes: true },
					},
				},
			});

			const data = locations.map((location) => ({
				...location,
				nodeCount: location._count.nodes,
			}));

			reply.send({ success: true, data });
		},
	);

	// Get single location (with nodes)
	app.get(
		"/:locationId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				request.user.userId,
				reply,
				"admin.read",
			);
			if (!has) return;

			const { locationId } = request.params as { locationId: string };

			const location = await prisma.location.findUnique({
				where: { id: locationId },
				include: {
					nodes: {
						orderBy: { name: "asc" },
					},
				},
			});

			if (!location) {
				return reply.status(404).send({ error: "Location not found" });
			}

			reply.send(serialize({ success: true, data: location }));
		},
	);

	// Create location (admin only)
	app.post(
		"/",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!(await ensureAdmin(request.user.userId, reply))) return;

			const { name, description } = request.body as {
				name: string;
				description?: string;
			};

			if (!name || !name.trim()) {
				return reply.status(400).send({ error: "Location name is required" });
			}

			const existing = await prisma.location.findUnique({
				where: { name: name.trim() },
			});

			if (existing) {
				return reply
					.status(409)
					.send({ error: "A location with this name already exists" });
			}

			const location = await prisma.location.create({
				data: {
					name: name.trim(),
					description: description?.trim() || null,
				},
			});

			reply.status(201).send({ success: true, data: location });
		},
	);

	// Update location (admin only)
	app.put(
		"/:locationId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!(await ensureAdmin(request.user.userId, reply))) return;

			const { locationId } = request.params as { locationId: string };
			const { name, description } = request.body as {
				name?: string;
				description?: string;
			};

			const location = await prisma.location.findUnique({
				where: { id: locationId },
			});

			if (!location) {
				return reply.status(404).send({ error: "Location not found" });
			}

			if (name !== undefined && name.trim()) {
				const existing = await prisma.location.findFirst({
					where: { name: name.trim(), id: { not: locationId } },
				});
				if (existing) {
					return reply
						.status(409)
						.send({ error: "A location with this name already exists" });
				}
			}

			const updateData: Record<string, unknown> = {};
			if (name !== undefined) updateData.name = name.trim();
			if (description !== undefined)
				updateData.description = description?.trim() || null;

			const updated = await prisma.location.update({
				where: { id: locationId },
				data: updateData,
			});

			reply.send({ success: true, data: updated });
		},
	);

	// Delete location (admin only)
	app.delete(
		"/:locationId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (!(await ensureAdmin(request.user.userId, reply))) return;

			const { locationId } = request.params as { locationId: string };

			const location = await prisma.location.findUnique({
				where: { id: locationId },
				include: {
					_count: { select: { nodes: true } },
				},
			});

			if (!location) {
				return reply.status(404).send({ error: "Location not found" });
			}

			if (location._count.nodes > 0) {
				return reply.status(409).send({
					error:
						"Cannot delete location with existing nodes. Reassign or delete all nodes in this location first.",
				});
			}

			await prisma.location.delete({
				where: { id: locationId },
			});

			reply.send({ success: true });
		},
	);
}
