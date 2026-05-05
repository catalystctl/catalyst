import { prisma } from "../db.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasPermission } from "../lib/permissions";
import { serialize } from "../utils/serialize";
import { sanitizeStartupCommand } from "../utils/sanitize-startup";

const ensurePermission = async (
	prisma: any,
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

export async function templateRoutes(app: FastifyInstance) {
	// Using shared prisma instance from db.ts

	// List all templates
	app.get(
		"/",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				prisma,
				request.user.userId,
				reply,
				"template.read",
			);
			if (!has) return;
			const templates = await prisma.serverTemplate.findMany({
				orderBy: { createdAt: "desc" },
				include: {
					nest: {
						select: { id: true, name: true, icon: true },
					},
				},
			});

			reply.send({ success: true, data: templates });
		},
	);

	// Get template details
	app.get(
		"/:templateId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				prisma,
				request.user.userId,
				reply,
				"template.read",
			);
			if (!has) return;
			const { templateId } = request.params as { templateId: string };

			const template = await prisma.serverTemplate.findUnique({
				where: { id: templateId },
				include: {
					nest: {
						select: { id: true, name: true, icon: true },
					},
				},
			});

			if (!template) {
				return reply.status(404).send({ error: "Template not found" });
			}

			reply.send(serialize({ success: true, data: template }));
		},
	);

	// Create template (admin only)
	app.post(
		"/",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				prisma,
				request.user.userId,
				reply,
				"template.create",
			);
			if (!has) return;
			const {
				name,
				description,
				author,
				version,
				image,
				images,
				defaultImage,
				installImage,
				startup,
				stopCommand,
				sendSignalTo,
				variables,
				installScript,
				configFile,
				supportedPorts,
				allocatedMemoryMb,
				allocatedCpuCores,
				features,
				nestId,
				srvService,
				srvProtocol,
			} = request.body as {
				name: string;
				description?: string;
				author: string;
				version: string;
				image: string;
				images?: Array<{ name: string; label?: string; image: string }>;
				defaultImage?: string;
				installImage?: string;
				startup: string;
				stopCommand: string;
				sendSignalTo: "SIGTERM" | "SIGINT" | "SIGKILL";
				variables: any[];
				installScript?: string;
				configFile?: string;
				supportedPorts: number[];
				allocatedMemoryMb: number;
				allocatedCpuCores: number;
				features?: Record<string, any>;
				srvService?: string | null;
				srvProtocol?: string | null;
				nestId?: string | null;
			};

			const existing = await prisma.serverTemplate.findUnique({
				where: { name },
			});
			if (existing) {
				return reply.status(409).send({
					error: `A template named "${name}" already exists`,
				});
			}

			const template = await prisma.serverTemplate.create({
				data: {
					name,
					description,
					author,
					version,
					image,
					images: Array.isArray(images) ? images : [],
					defaultImage: defaultImage || null,
					installImage,
					startup,
					stopCommand,
					sendSignalTo,
					variables:
						typeof variables === "string"
							? JSON.parse(variables)
							: Array.isArray(variables)
								? variables
								: [],
					installScript,
					supportedPorts,
					allocatedMemoryMb,
					allocatedCpuCores,
					features: {
						...(features || {}),
						...(configFile ? { configFile } : {}),
					},
					nestId: nestId || null,
					srvService: srvService || null,
					srvProtocol: srvProtocol || 'tcp',
				},
				include: {
					nest: {
						select: { id: true, name: true, icon: true },
					},
				},
			});

			reply.status(201).send({ success: true, data: template });
			const wsGateway = (app as any).wsGateway;
			if (wsGateway?.pushToAdminSubscribers) {
				wsGateway.pushToAdminSubscribers("template_created", {
					type: "template_created",
					template,
					createdBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Update template
	app.put(
		"/:templateId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				prisma,
				request.user.userId,
				reply,
				"template.update",
			);
			if (!has) return;
			const { templateId } = request.params as { templateId: string };
			const { images, defaultImage } = request.body as {
				images?: Array<{ name: string; label?: string; image: string }>;
				defaultImage?: string;
			};

			const template = await prisma.serverTemplate.findUnique({
				where: { id: templateId },
			});

			if (!template) {
				return reply.status(404).send({ error: "Template not found" });
			}

			const {
				name,
				description,
				author,
				version,
				image,
				installImage,
				startup,
				stopCommand,
				sendSignalTo,
				variables,
				installScript,
				configFile,
				supportedPorts,
				allocatedMemoryMb,
				allocatedCpuCores,
				features,
				nestId,
				srvService,
				srvProtocol,
			} = request.body as {
				name?: string;
				description?: string;
				author?: string;
				version?: string;
				image?: string;
				installImage?: string;
				startup?: string;
				stopCommand?: string;
				sendSignalTo?: "SIGTERM" | "SIGINT" | "SIGKILL";
				variables?: any[];
				installScript?: string;
				configFile?: string;
				supportedPorts?: number[];
				allocatedMemoryMb?: number;
				allocatedCpuCores?: number;
				nestId?: string | null;
				features?: Record<string, any>;
				srvService?: string | null;
				srvProtocol?: string | null;
			};
			const nextData: Record<string, unknown> = {};
			if (name !== undefined) nextData.name = name;
			if (description !== undefined) nextData.description = description;
			if (author !== undefined) nextData.author = author;
			if (version !== undefined) nextData.version = version;
			if (image !== undefined) nextData.image = image;
			if (installImage !== undefined) nextData.installImage = installImage;
			if (startup !== undefined) nextData.startup = startup;
			if (stopCommand !== undefined) nextData.stopCommand = stopCommand;
			if (sendSignalTo !== undefined) nextData.sendSignalTo = sendSignalTo;
			if (variables !== undefined)
				nextData.variables =
					typeof variables === "string"
						? JSON.parse(variables)
						: Array.isArray(variables)
							? variables
							: [];
			if (installScript !== undefined) nextData.installScript = installScript;
			if (supportedPorts !== undefined)
				nextData.supportedPorts = supportedPorts;
			if (allocatedMemoryMb !== undefined)
				nextData.allocatedMemoryMb = allocatedMemoryMb;
			if (allocatedCpuCores !== undefined)
				nextData.allocatedCpuCores = allocatedCpuCores;
			if (features !== undefined) {
				nextData.features = {
					...features,
					...(configFile ? { configFile } : {}),
				};
			} else if (configFile !== undefined) {
				nextData.features = {
					...(template.features as Record<string, unknown>),
					configFile,
				};
			}
			if (images) {
				nextData.images = Array.isArray(images) ? images : [];
			}
			if (defaultImage !== undefined) {
				nextData.defaultImage = defaultImage || null;
			}
			if (nestId !== undefined) nextData.nestId = nestId || null;
			if (srvService !== undefined) nextData.srvService = srvService || null;
			if (srvProtocol !== undefined) nextData.srvProtocol = srvProtocol || 'tcp';

			const updated = await prisma.serverTemplate.update({
				where: { id: templateId },
				data: nextData as any,
				include: {
					nest: {
						select: { id: true, name: true, icon: true },
					},
				},
			});

			reply.send(serialize({ success: true, data: updated }));

			const wsGateway = (app as any).wsGateway;
			if (wsGateway?.pushToAdminSubscribers) {
				wsGateway.pushToAdminSubscribers("template_updated", {
					type: "template_updated",
					templateId,
					updatedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Delete template
	app.delete(
		"/:templateId",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				prisma,
				request.user.userId,
				reply,
				"template.delete",
			);
			if (!has) return;
			const { templateId } = request.params as { templateId: string };

			// Check if template is in use
			const inUse = await prisma.server.findFirst({
				where: { templateId },
			});

			if (inUse) {
				return reply.status(409).send({
					error: "Cannot delete template that is in use",
				});
			}

			await prisma.serverTemplate.delete({ where: { id: templateId } });

			reply.send({ success: true });
			const wsGateway = (app as any).wsGateway;
			if (wsGateway?.pushToAdminSubscribers) {
				wsGateway.pushToAdminSubscribers("template_deleted", {
					type: "template_deleted",
					templateId,
					deletedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);

	// Import Pterodactyl egg
	app.post(
		"/import-pterodactyl",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				prisma,
				request.user.userId,
				reply,
				"template.create",
			);
			if (!has) return;

			const egg = request.body as Record<string, any>;
			const { nestId } = request.body as { nestId?: string };

			// Validate required fields
			if (!egg?.name || typeof egg.name !== "string") {
				return reply
					.status(400)
					.send({ error: "Missing required field: name" });
			}
			if (!egg?.startup || typeof egg.startup !== "string") {
				return reply
					.status(400)
					.send({ error: "Missing required field: startup" });
			}
			// Accept images as string array (Pelican) or docker_images as Record (Pterodactyl export)
			const hasImages =
				(Array.isArray(egg.images) && egg.images.length > 0) ||
				(egg.docker_images && typeof egg.docker_images === "object" && Object.keys(egg.docker_images).length > 0);
			if (!hasImages) {
				return reply.status(400).send({
					error: "Missing required field: images (must be a non-empty array or docker_images object)",
				});
			}

			// Validate nestId if provided
			if (nestId) {
				const nest = await prisma.nest.findUnique({ where: { id: nestId } });
				if (!nest) {
					return reply.status(400).send({ error: "Nest not found" });
				}
			}

			// Check for name conflict
			const sanitizedName = egg.name.trim();
			const existing = await prisma.serverTemplate.findUnique({
				where: { name: sanitizedName },
			});
			if (existing) {
				return reply.status(409).send({
					error: `A template with the name '${sanitizedName}' already exists`,
				});
			}

			// Map Pterodactyl variables to Catalyst format
			const pteroVariables: any[] = Array.isArray(egg.variables)
				? egg.variables
				: [];
			const mappedVariables = pteroVariables.map((v: any) => ({
				name: v.env_variable || v.name,
				description: v.description || "",
				default: v.default_value ?? "",
				required: v.rules ? v.rules.includes("required") : false,
				input:
					v.field_type === "select"
						? "select"
						: v.field_type === "number"
							? "number"
							: "text",
				rules: v.rules
					? v.rules
							.split("|")
							.map((r: string) => r.trim())
							.filter(Boolean)
					: [],
			}));

			// Map images — handle both Pelican array format (egg.images) and Pterodactyl export format (egg.docker_images as Record)
			let mappedImages: Array<{ name: string; image: string }> = [];
			if (Array.isArray(egg.images)) {
				mappedImages = egg.images.map((img: string, i: number) => ({
					name: `image-${i}`,
					image: img,
				}));
			} else if (egg.docker_images && typeof egg.docker_images === "object") {
				mappedImages = Object.entries(egg.docker_images).map(([name, image]) => ({
					name,
					image: image as string,
				}));
			}

			// Build features from Pterodactyl egg data
			const eggFeatures: Record<string, any> = {};
			if (Array.isArray(egg.features)) {
				eggFeatures.pterodactylFeatures = egg.features;
			}
			// Parse startup detection — config.startup may be a JSON string or object
			if (egg.config?.startup) {
				try {
					const parsed = typeof egg.config.startup === "string"
						? JSON.parse(egg.config.startup)
						: egg.config.startup;
					if (parsed && typeof parsed === "object") {
						eggFeatures.startupDetection = parsed;
					}
				} catch { /* ignore */ }
			}
			if (egg.config?.logs) {
				try {
					const parsed = typeof egg.config.logs === "string"
						? JSON.parse(egg.config.logs)
						: egg.config.logs;
					if (parsed && typeof parsed === "object") {
						eggFeatures.logDetection = parsed;
					}
				} catch { /* ignore */ }
			}
			// Store Pterodactyl config file definitions for the config editor
			if (egg.config?.files) {
				try {
					const configFiles =
						typeof egg.config.files === "string"
							? JSON.parse(egg.config.files)
							: egg.config.files;
					if (typeof configFiles === "object" && configFiles !== null) {
						const keys = Object.keys(configFiles);
						if (keys.length > 0) {
							eggFeatures.pterodactylConfigFiles = configFiles;
							eggFeatures.configFile = keys[0];
							eggFeatures.configFiles = keys;
						}
					}
				} catch {
					/* ignore invalid config files */
				}
			}

			// Parse stop command — config.stop may be a JSON string or direct value
			const rawStop = (() => {
				if (egg.config?.stop) {
					if (typeof egg.config.stop === "string") {
						try { return JSON.parse(egg.config.stop); } catch { return egg.config.stop; }
					}
					return egg.config.stop;
				}
				return undefined;
			})();
			const stopSignalMap: Record<string, "SIGINT" | "SIGTERM" | "SIGKILL"> = {
				"^C": "SIGINT", "^c": "SIGINT", "^^C": "SIGINT",
				"^SIGKILL": "SIGKILL", "^X": "SIGKILL",
				"SIGINT": "SIGINT", "SIGTERM": "SIGTERM", "SIGKILL": "SIGKILL",
			};
			const resolvedStopSignal = rawStop ? (stopSignalMap[rawStop] || "SIGTERM") : "SIGTERM";
			const resolvedStopCommand = rawStop ? (stopSignalMap[rawStop] ? "" : rawStop.replace(/^\//, "")) : "stop";

			const template = await prisma.serverTemplate.create({
				data: {
					name: sanitizedName,
					description: egg.description || null,
					author: egg.author || "Pterodactyl Import",
					version: egg.meta?.version || "PTDL_v2",
					image: mappedImages[0]?.image || "",
					images: mappedImages,
					defaultImage: mappedImages[0]?.image || null,
					installImage: egg.scripts?.installation?.container || null,
					startup: sanitizeStartupCommand(egg.startup),
					stopCommand: resolvedStopCommand,
					sendSignalTo: resolvedStopSignal,
					variables: mappedVariables,
					installScript: egg.scripts?.installation?.script || null,
					supportedPorts: [25565],
					allocatedMemoryMb: 1024,
					allocatedCpuCores: 1,
					features: eggFeatures,
					nestId: nestId || null,
				},
				include: {
					nest: {
						select: { id: true, name: true, icon: true },
					},
				},
			});

			reply.status(201).send({ success: true, data: template });
			const wsGateway = (app as any).wsGateway;
			if (wsGateway?.pushToAdminSubscribers) {
				wsGateway.pushToAdminSubscribers("template_created", {
					type: "template_created",
					template,
					createdBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}
		},
	);
}
