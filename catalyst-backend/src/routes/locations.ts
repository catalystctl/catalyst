import { prisma } from "../db.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasAnyPermission } from "../lib/permissions";
import { serialize } from "../utils/serialize";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";

// Catalog permission, or the admin-write / super-admin path that previously
// gated these routes. admin.read is intentionally not enough to mutate.
const ensureAnyPermission = async (
	userId: string,
	reply: FastifyReply,
	required: string[],
) => {
	const has = await hasAnyPermission(prisma, userId, required);
	if (!has) {
		apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
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
			const has = await ensureAnyPermission(request.user.userId, reply, [
				"location.read",
				"admin.read",
				"admin.write",
			]);
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
			// location.read is the catalog read. admin.read stays so existing
			// admin panels keep working, but it must not receive node secrets
			// (those require node.read, and the node routes omit `secret`).
			const has = await ensureAnyPermission(request.user.userId, reply, [
				"location.read",
				"admin.read",
				"admin.write",
			]);
			if (!has) return;

			const { locationId } = request.params as { locationId: string };

			const location = await prisma.location.findUnique({
				where: { id: locationId },
				include: {
					nodes: {
						orderBy: { name: "asc" },
						omit: { secret: true },
					},
				},
			});

			if (!location) {
				return apiError(reply, 404, ErrorCodes.LOCATION_NOT_FOUND, "Location not found");
			}

			reply.send(serialize({ success: true, data: location }));
		},
	);

	// Create location (admin only)
	app.post(
		"/",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (
				!(await ensureAnyPermission(request.user.userId, reply, [
					"location.create",
					"admin.write",
				]))
			)
				return;

			const { name, description } = request.body as {
				name: string;
				description?: string;
			};

			if (!name || !name.trim()) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Location name is required");
			}

			const existing = await prisma.location.findUnique({
				where: { name: name.trim() },
			});

			if (existing) {
				return apiError(reply, 409, ErrorCodes.LOCATION_NAME_TAKEN, "A location with this name already exists");
			}

			const location = await prisma.location.create({
				data: {
					name: name.trim(),
					description: description?.trim() || null,
				},
			});

			reply.status(201).send({ success: true, data: location });

			// Broadcast location_created event
			const wsGatewayLocationCreated = (app as any).wsGateway;
			if (wsGatewayLocationCreated?.pushToAdminSubscribers) {
				wsGatewayLocationCreated.pushToAdminSubscribers('location_created', {
					type: 'location_created',
					locationId: location.id,
					locationName: location.name,
					createdBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Update location (admin only)
	app.put(
		"/:locationId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (
				!(await ensureAnyPermission(request.user.userId, reply, [
					"location.update",
					"admin.write",
				]))
			)
				return;

			const { locationId } = request.params as { locationId: string };
			const { name, description } = request.body as {
				name?: string;
				description?: string;
			};

			const location = await prisma.location.findUnique({
				where: { id: locationId },
			});

			if (!location) {
				return apiError(reply, 404, ErrorCodes.LOCATION_NOT_FOUND, "Location not found");
			}

			if (name !== undefined && name.trim()) {
				const existing = await prisma.location.findFirst({
					where: { name: name.trim(), id: { not: locationId } },
				});
				if (existing) {
					return apiError(reply, 409, ErrorCodes.LOCATION_NAME_TAKEN, "A location with this name already exists");
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

			// Broadcast location_updated event
			const wsGatewayLocationUpdated = (app as any).wsGateway;
			if (wsGatewayLocationUpdated?.pushToAdminSubscribers) {
				wsGatewayLocationUpdated.pushToAdminSubscribers('location_updated', {
					type: 'location_updated',
					locationId,
					updatedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Delete location (admin only)
	app.delete(
		"/:locationId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			if (
				!(await ensureAnyPermission(request.user.userId, reply, [
					"location.delete",
					"admin.write",
				]))
			)
				return;

			const { locationId } = request.params as { locationId: string };

			const location = await prisma.location.findUnique({
				where: { id: locationId },
				include: {
					_count: { select: { nodes: true } },
				},
			});

			if (!location) {
				return apiError(reply, 404, ErrorCodes.LOCATION_NOT_FOUND, "Location not found");
			}

			if (location._count.nodes > 0) {
				return apiError(
					reply,
					409,
					ErrorCodes.LOCATION_IN_USE,
					"Cannot delete location with existing nodes. Reassign or delete all nodes in this location first.",
				);
			}

			await prisma.location.delete({
				where: { id: locationId },
			});

			// Broadcast location_deleted event
			const wsGatewayLocationDeleted = (app as any).wsGateway;
			if (wsGatewayLocationDeleted?.pushToAdminSubscribers) {
				wsGatewayLocationDeleted.pushToAdminSubscribers('location_deleted', {
					type: 'location_deleted',
					locationId,
					locationName: location.name,
					deletedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}

			reply.send({ success: true });
		},
	);
}
