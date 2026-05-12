import { prisma } from "../db.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasPermission } from "../lib/permissions";
import { serialize } from "../utils/serialize";
import { importPterodactylEgg as convertEgg, convertStartupCommand, convertInstallScript, parseStopCommand } from "../utils/egg-import";

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

/**
 * Import a single Pterodactyl egg into the database using the shared
 * egg-import utility for consistent conversion across all import paths.
 *
 * Shared between the single-egg and batch-egg import endpoints.
 */
async function importPterodactylEgg(
	egg: Record<string, any>,
	nestId: string | null,
	userId: string,
): Promise<{ status: "created" | "skipped" | "error"; name?: string; error?: string }> {
	try {
		// Use the shared egg-import utility for all conversions
		const converted = convertEgg(egg, { nestId });

		const sanitizedName = converted.name;
		if (!sanitizedName) {
			return { status: "error", error: "Missing name" };
		}

		// Skip if template with same name already exists
		const existing = await prisma.serverTemplate.findUnique({
			where: { name: sanitizedName },
		});
		if (existing) {
			return { status: "skipped", name: sanitizedName };
		}

		// Validate minimum fields
		if (!converted.startup) {
			return { status: "error", name: sanitizedName, error: "Missing startup" };
		}
		if (!converted.image) {
			return { status: "error", name: sanitizedName, error: "Missing images" };
		}

		// Determine nest — auto-create from egg category if no nestId provided
		let resolvedNestId = nestId;
		if (!resolvedNestId && egg._category) {
			const existingNest = await prisma.nest.findFirst({
				where: { name: egg._category },
			});
			if (existingNest) {
				resolvedNestId = existingNest.id;
			} else {
				const newNest = await prisma.nest.create({
					data: { name: egg._category },
				});
				resolvedNestId = newNest.id;
			}
		}

		const template = await prisma.serverTemplate.create({
			data: {
				name: sanitizedName,
				description: converted.description,
				author: converted.author,
				version: converted.version,
				image: converted.image,
				images: converted.images as any,
				defaultImage: converted.defaultImage,
				installImage: converted.installImage,
				installEntrypoint: converted.installEntrypoint,
				startup: converted.startup,
				stopCommand: converted.stopCommand,
				sendSignalTo: converted.sendSignalTo,
				variables: converted.variables as any,
				installScript: converted.installScript,
				supportedPorts: converted.supportedPorts,
				allocatedMemoryMb: converted.allocatedMemoryMb,
				allocatedCpuCores: converted.allocatedCpuCores,
				features: converted.features as any,
				nestId: resolvedNestId,
			},
		});

		return { status: "created", name: sanitizedName };
	} catch (err: any) {
		return { status: "error", name: (egg.name || "").trim(), error: err.message || "Unknown error" };
	}
}

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

			const { summary } = request.query as { summary?: string };

			if (summary === 'true') {
				// Lightweight list — excludes variables, installScript, features, images
				const templates = await prisma.serverTemplate.findMany({
					orderBy: { createdAt: "desc" },
					select: {
						id: true,
						name: true,
						description: true,
						author: true,
						version: true,
						image: true,
						defaultImage: true,
						installImage: true,
						installEntrypoint: true,
						startup: true,
						allocatedMemoryMb: true,
						allocatedCpuCores: true,
						nestId: true,
						srvService: true,
						srvProtocol: true,
						createdAt: true,
						nest: {
							select: { id: true, name: true, icon: true },
						},
					},
				});
				reply.send({ success: true, data: templates });
			} else {
				const templates = await prisma.serverTemplate.findMany({
					orderBy: { createdAt: "desc" },
					include: {
						nest: {
							select: { id: true, name: true, icon: true },
						},
					},
				});

				reply.send({ success: true, data: templates });
			}
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
				installEntrypoint,
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
				installEntrypoint?: string;
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
					installEntrypoint: installEntrypoint || "bash",
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
				installEntrypoint,
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
				installEntrypoint?: string;
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
			if (installEntrypoint !== undefined) nextData.installEntrypoint = installEntrypoint;
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

	// Import Pterodactyl egg (single)
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

			// Validate nestId if provided
			if (nestId) {
				const nest = await prisma.nest.findUnique({ where: { id: nestId } });
				if (!nest) {
					return reply.status(400).send({ error: "Nest not found" });
				}
			}

			const result = await importPterodactylEgg(egg, nestId || null, request.user.userId);

			if (result.status === "error") {
				if (result.error === "Missing name") {
					return reply.status(400).send({ error: "Missing required field: name" });
				}
				if (result.error === "Missing startup") {
					return reply.status(400).send({ error: "Missing required field: startup" });
				}
				if (result.error === "Missing images") {
					return reply.status(400).send({ error: "Missing required field: images" });
				}
				return reply.status(400).send({ error: result.error });
			}
			if (result.status === "skipped") {
				return reply.status(409).send({ error: `A template with the name '${result.name}' already exists` });
			}

			// Fetch the created template with nest for response
			const template = await prisma.serverTemplate.findUnique({
				where: { name: result.name! },
				include: { nest: { select: { id: true, name: true, icon: true } } },
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

	// Import all Pterodactyl game eggs from GitHub
	app.post(
		"/import-pterodactyl-batch",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const has = await ensurePermission(
				prisma,
				request.user.userId,
				reply,
				"template.create",
			);
			if (!has) return;

			const { nestId, repoUrl } = request.body as {
				nestId?: string;
				repoUrl?: string;
			};

			// Validate nestId if provided
			if (nestId) {
				const nest = await prisma.nest.findUnique({ where: { id: nestId } });
				if (!nest) {
					return reply.status(400).send({ error: "Nest not found" });
				}
			}

			const GITHUB_REPO = repoUrl || "pterodactyl/game-eggs";
			const BRANCH = "main";

			// 1. Fetch the repo tree
			request.log.info({ repo: GITHUB_REPO }, "Fetching Pterodactyl eggs repo tree");
			let treeEntries: Array<{ path: string }>;
			try {
				const treeRes = await fetch(
					`https://api.github.com/repos/${GITHUB_REPO}/git/trees/${BRANCH}?recursive=1`,
					{
						headers: {
							"User-Agent": "Catalyst-Panel",
							Accept: "application/vnd.github.v3+json",
						},
					},
				);
				if (!treeRes.ok) {
					throw new Error(`GitHub API returned ${treeRes.status}`);
				}
				const treeData = (await treeRes.json()) as any;
				treeEntries = (treeData.tree || [])
					.filter((t: any) => t.type === "blob" && t.path.endsWith(".json") && /egg[._-]/i.test(t.path));
			} catch (err: any) {
				request.log.error({ err }, "Failed to fetch Pterodactyl eggs repo tree");
				return reply.status(502).send({ error: `Failed to fetch egg list from GitHub: ${err.message}` });
			}

			request.log.info({ count: treeEntries.length }, "Found eggs in repo");

			// 2. Download and import each egg
			const results = {
				total: treeEntries.length,
				imported: 0,
				skipped: 0,
				errors: 0,
				errorDetails: [] as Array<{ name: string; error: string }>,
			};

			// Process eggs in batches of 5 to avoid overwhelming GitHub or the DB
			const BATCH_SIZE = 5;
			for (let i = 0; i < treeEntries.length; i += BATCH_SIZE) {
				const batch = treeEntries.slice(i, i + BATCH_SIZE);
				const batchResults = await Promise.all(
					batch.map(async (entry) => {
						const rawUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/${entry.path}`;
						try {
							const eggRes = await fetch(rawUrl, {
								headers: { "User-Agent": "Catalyst-Panel" },
							});
							if (!eggRes.ok) {
								throw new Error(`HTTP ${eggRes.status}`);
							}
							const eggData = await eggRes.json() as Record<string, any>;

							// Derive category from directory path for nest auto-creation
							const category = entry.path.split("/")[0]?.replace(/_/g, " ") || undefined;
							if (category && !eggData._category) {
								eggData._category = category;
							}

							return importPterodactylEgg(eggData, nestId || null, request.user.userId);
						} catch (err: any) {
							return { status: "error" as const, name: entry.path, error: err.message };
						}
					}),
				);

				for (const r of batchResults) {
					if (r.status === "created") results.imported++;
					else if (r.status === "skipped") results.skipped++;
					else {
						results.errors++;
						if (r.name) results.errorDetails.push({ name: r.name, error: r.error || "Unknown error" });
					}
				}
			}

			request.log.info(
				{ imported: results.imported, skipped: results.skipped, errors: results.errors },
				"Batch import complete",
			);

			// Invalidate template cache via WebSocket notification
			const wsGateway = (app as any).wsGateway;
			if (wsGateway?.pushToAdminSubscribers) {
				wsGateway.pushToAdminSubscribers("templates_batch_imported", {
					type: "templates_batch_imported",
					results,
					importedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}

			reply.send({ success: true, data: results });
		},
	);
}
