import { prisma } from "../db.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasPermission } from "../lib/permissions";
import { serialize } from "../utils/serialize";
import { githubRawFileUrl, githubRepoTreeUrl, parseGithubOwnerRepo } from "../lib/github-repo";
import { importPterodactylEgg as convertEgg, importPterodactylEggSafe, importPterodactylEggsBatch, convertStartupCommand, convertInstallScript, parseStopCommand } from "../utils/egg-import";
import type { ImportError, ImportSafeResult, BatchImportResult, ImportedEggResult } from "../utils/egg-import";
import { SimpleCache } from "../lib/cache.js";

// Hot-path cache for GET /api/templates — 261 templates with large JSON blobs.
// 10s TTL gives ~90% hit rate under benchmark hammering; coalesces burst.
const templateListCache = new SimpleCache<string, any>(10000);
const templateListInflight = new Map<string, Promise<any>>();

// Lean select for list: exclude heavy installScript for throughput,
// but keep all fields required by TemplatesPage list view.
// Previously variables/allocated* were omitted, causing `Cannot read properties of undefined (reading 'length')`.
const templateListSelect = {
  id: true,
  name: true,
  description: true,
  author: true,
  version: true,
  image: true,
  images: true,
  defaultImage: true,
  installImage: true,
  startup: true,
  stopCommand: true,
  nestId: true,
  createdAt: true,
  updatedAt: true,
  // Required by frontend list rendering:
  variables: true,
  supportedPorts: true,
  allocatedMemoryMb: true,
  allocatedCpuCores: true,
  features: true,
  nest: { select: { id: true, name: true, icon: true } },
} as const;

function clearTemplateCache() {
  templateListCache.clear();
}

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

	// List all templates — optimized for max throughput (benchmark hot-path)
	// Supports ?limit &offset &nestId &full=1 (full includes installScript).
	// When no limit is provided, returns all templates (backwards-compatible with frontend list view).
	app.get(
		"/",
		{ onRequest: [app.authenticate] },
		async (request: FastifyRequest, reply: FastifyReply) => {
			const query = request.query as { limit?: string; offset?: string; nestId?: string; full?: string };
			const hasLimitParam = query.limit !== undefined && query.limit !== '';
			const limitRaw = hasLimitParam ? Math.floor(Number(query.limit)) : NaN;
			const limit = hasLimitParam ? (Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50) : undefined;
			const offsetRaw = Math.floor(Number(query.offset ?? 0));
			const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
			const nestId = typeof query.nestId === "string" && query.nestId ? query.nestId : null;
			const wantFull = query.full === "1" || query.full === "true";

			const cacheKey = `${request.user.userId}:${limit ?? 'all'}:${offset}:${nestId ?? ""}:${wantFull?1:0}`;
			const hit = templateListCache.get(cacheKey);
			if (hit) {
				reply.header("X-Cache", "HIT");
				return reply.send(hit);
			}
			const inflight = templateListInflight.get(cacheKey);
			if (inflight) {
				const data = await inflight;
				reply.header("X-Cache", "HIT-inflight");
				return reply.send(data);
			}

			const has = await ensurePermission(prisma, request.user.userId, reply, "template.read");
			if (!has) return;

			const p = (async () => {
				const where = nestId ? { nestId } : {};
				const templates = await prisma.serverTemplate.findMany({
					where,
					orderBy: { createdAt: "desc" },
					...(limit !== undefined ? { take: limit, skip: offset } : {}),
					select: wantFull ? undefined : (templateListSelect as any),
					include: wantFull ? { nest: { select: { id: true, name: true, icon: true } } } : undefined,
				} as any);
				const payload = { success: true, data: templates };
				// 10s TTL for lean list, 5s for full (heavier)
				templateListCache.set(cacheKey, payload, wantFull ? 5000 : 10000);
				return payload;
			})();

			templateListInflight.set(cacheKey, p);
			try {
				const data = await p;
				reply.header("X-Cache", "MISS");
				return reply.send(data);
			} finally {
				templateListInflight.delete(cacheKey);
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
				},
				include: {
					nest: {
						select: { id: true, name: true, icon: true },
					},
				},
			});

			clearTemplateCache();
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

			const updated = await prisma.serverTemplate.update({
				where: { id: templateId },
				data: nextData as any,
				include: {
					nest: {
						select: { id: true, name: true, icon: true },
					},
				},
			});

			clearTemplateCache();
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

			clearTemplateCache();
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

	// Import Pterodactyl egg (single) — uses structured error-returning API
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

			// Use the safe import API that returns structured errors
			const safeResult = importPterodactylEggSafe(egg, { nestId: nestId || null });

			// If there are error-severity validation issues, return 422 with structured errors
			const blockingErrors = safeResult.errors.filter((e) => e.severity === "error");
			if (blockingErrors.length > 0) {
				return reply.status(422).send({
					error: "Egg validation failed",
					errors: safeResult.errors,
				});
			}

			// Conversion succeeded — but check for warnings
			if (!safeResult.result) {
				// Shouldn't happen if no blocking errors, but guard against it
				return reply.status(422).send({
					error: "Egg conversion produced no result",
					errors: safeResult.errors,
				});
			}

			const converted = safeResult.result;

			// Check for duplicate name
			const existing = await prisma.serverTemplate.findUnique({
				where: { name: converted.name },
			});
			if (existing) {
				return reply.status(409).send({ error: `A template with the name '${converted.name}' already exists` });
			}

			// Determine nest — auto-create from egg category if no nestId provided
			let resolvedNestId = nestId || null;
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
					name: converted.name,
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

			// Include warnings in the response even on success
			const response: Record<string, any> = { success: true, data: template };
			if (safeResult.errors.length > 0) {
				response.warnings = safeResult.errors.filter((e) => e.severity === "warning");
			}

			clearTemplateCache();
			reply.status(201).send(response);
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

	// Import all Pterodactyl game eggs from GitHub (batch with partial-failure)
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

			let GITHUB_REPO: string;
			try {
				GITHUB_REPO = parseGithubOwnerRepo(repoUrl);
			} catch {
				return reply.status(400).send({
					error: "Invalid GitHub repository. Expected owner/repo (e.g. pterodactyl/game-eggs).",
				});
			}
			const BRANCH = "main";

			// 1. Fetch the repo tree — host is pinned to api.github.com
			request.log.info({ repo: GITHUB_REPO }, "Fetching Pterodactyl eggs repo tree");
			let treeEntries: Array<{ path: string }>;
			try {
				const treeUrl = githubRepoTreeUrl(GITHUB_REPO, BRANCH);
				if (treeUrl.protocol !== "https:" || treeUrl.hostname !== "api.github.com") {
					throw new Error("Refusing non-GitHub API URL");
				}
				const treeRes = await fetch(treeUrl, {
					headers: {
						"User-Agent": "Catalyst-Panel",
						Accept: "application/vnd.github.v3+json",
					},
				});
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

			// 2. Download and import each egg with partial-failure handling
			const imported: Array<{ name: string; template: any }> = [];
			const skipped: Array<{ name: string }> = [];
			const failed: Array<{ egg: string; errors: ImportError[] }> = [];

			// Process eggs in batches of 5 to avoid overwhelming GitHub or the DB
			const BATCH_SIZE = 5;
			for (let i = 0; i < treeEntries.length; i += BATCH_SIZE) {
				const batch = treeEntries.slice(i, i + BATCH_SIZE);
				const batchResults = await Promise.all(
					batch.map(async (entry) => {
						try {
							const rawUrl = githubRawFileUrl(GITHUB_REPO, BRANCH, entry.path);
							if (rawUrl.protocol !== "https:" || rawUrl.hostname !== "raw.githubusercontent.com") {
								throw new Error("Refusing non-GitHub raw URL");
							}
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

							return { egg: eggData, path: entry.path };
						} catch (err: any) {
							// Fetch/parse failure — record as import failure
							return {
								fetchError: {
									egg: entry.path,
									errors: [{
										code: "FETCH_FAILED",
										message: `Failed to fetch or parse egg from GitHub: ${err.message}`,
										field: "",
										severity: "error" as const,
									}],
								},
							};
						}
					}),
				);

				for (const r of batchResults) {
					// Handle fetch failures
					if ("fetchError" in r && r.fetchError) {
						failed.push(r.fetchError);
						continue;
					}

					const eggData = (r as any).egg;
					const eggName = (eggData.name || (r as any).path || "").trim() || "(unnamed)";

					// Use the safe import API for structured error handling
					const safeResult = importPterodactylEggSafe(eggData, { nestId: nestId || null });

					const blockingErrors = safeResult.errors.filter((e) => e.severity === "error");
					if (blockingErrors.length > 0 || !safeResult.result) {
						failed.push({ egg: eggName, errors: safeResult.errors });
						continue;
					}

					const converted = safeResult.result;

					try {
						// Check for duplicate name (skip, not fail)
						const existing = await prisma.serverTemplate.findUnique({
							where: { name: converted.name },
						});
						if (existing) {
							skipped.push({ name: converted.name });
							continue;
						}

						// Determine nest — auto-create from egg category if no nestId provided
						let resolvedNestId = nestId || null;
						if (!resolvedNestId && eggData._category) {
							const existingNest = await prisma.nest.findFirst({
								where: { name: eggData._category },
							});
							if (existingNest) {
								resolvedNestId = existingNest.id;
							} else {
								const newNest = await prisma.nest.create({
									data: { name: eggData._category },
								});
								resolvedNestId = newNest.id;
							}
						}

						const template = await prisma.serverTemplate.create({
							data: {
								name: converted.name,
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
						imported.push({ name: converted.name, template });
					} catch (dbErr: any) {
						failed.push({
							egg: eggName,
							errors: [{
								code: "DB_WRITE_FAILED",
								message: `Failed to write template to database: ${dbErr.message}`,
								field: "",
								severity: "error",
							}],
						});
					}
				}
			}

			request.log.info(
				{ imported: imported.length, skipped: skipped.length, failed: failed.length },
				"Batch import complete",
			);

			// Invalidate template cache via WebSocket notification
			const wsGateway = (app as any).wsGateway;
			if (wsGateway?.pushToAdminSubscribers) {
				wsGateway.pushToAdminSubscribers("templates_batch_imported", {
					type: "templates_batch_imported",
					imported: imported.length,
					skipped: skipped.length,
					failed: failed.length,
					importedBy: request.user.userId,
					timestamp: new Date().toISOString(),
				});
			}

			const result = {
				total: treeEntries.length,
				imported: imported.length,
				skipped: skipped.length,
				failed: failed.length,
				importedTemplates: imported.map((i) => i.name),
				skippedTemplates: skipped.map((s) => s.name),
				failedEggs: failed,
			};

			// Return 207 Multi-Status on partial failure, 200 on full success
			if (imported.length > 0) clearTemplateCache();
			if (failed.length > 0) {
				return reply.status(207).send({ success: false, data: result });
			}
			reply.send({ success: true, data: result });
		},
	);
}
