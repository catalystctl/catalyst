import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db";
import { auth } from "../auth";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { captureSystemError } from "../services/error-logger";
import { withRegistrationBypass } from "../lib/registration-gate.js";
import { invalidateConfig } from "../lib/config-cache.js";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";
import { formatZodIssues } from "../lib/validation";
import {
	applySetupEnvVars,
	getEnvRestartStatus,
	getSetupEnvVars,
} from "../services/env-settings";

const setupSchema = z.object({
	email: z.string().email("Invalid email format"),
	username: z.string().min(2).max(32),
	password: z.string().min(8, "Password must be at least 8 characters"),
	panelName: z.string().min(1).max(50).default("Catalyst"),
	primaryColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
		.default("#c48d5a"),
	secondaryColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
		.default("#5ac4c2"),
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
		.default("#5a5cc4"),
	defaultTheme: z.enum(["light", "dark"]).default("dark"),
	logoUrl: z.string().optional(),
	metadata: z.record(z.string(), z.any()).default({}),
	// Critical environment variables captured during first-run setup. Only
	// keys flagged `setup` in the env registry are honored (see
	// applySetupEnvVars) — this endpoint is unauthenticated.
	environment: z.record(z.string(), z.string()).optional(),
});

// Helper to forward auth headers (set-cookie, set-auth-token) from better-auth
// to the Fastify reply.  Must use getSetCookie() when available because
// Headers.get("set-cookie") returns a comma-separated string which browsers
// cannot parse.
function forwardAuthHeaders(response: any, reply: FastifyReply) {
	const headers = "headers" in response ? response.headers : null;
	if (!headers) return;

	// Forward bearer token (fallback when cookies are blocked by proxies)
	const tokenHeader = headers.get?.("set-auth-token");
	if (tokenHeader) {
		reply.header("set-auth-token", tokenHeader);
		reply.header("Access-Control-Expose-Headers", "set-auth-token");
	}

	// Prefer getSetCookie() (Node 18+ / undici) — returns an array of individual cookies
	const rawSetCookie =
		typeof (headers as any).getSetCookie === "function"
			? (headers as any).getSetCookie()
			: headers.get?.("set-cookie");

	if (!rawSetCookie) return;

	const cookies: string[] = Array.isArray(rawSetCookie)
		? rawSetCookie
		: [rawSetCookie];

	for (const cookie of cookies) {
		reply.header("set-cookie", cookie);
	}
}

// F23: best-effort broadcasts once setup finalizes, so already-open admin
// sessions pick up the new branding/settings and the first admin user.
// Payload shapes mirror the corresponding admin-route broadcasts.
function emitSetupCompletedEvents(
	app: FastifyInstance,
	adminUser: {
		id: string;
		email: string;
		username: string;
		createdAt: Date;
		updatedAt: Date;
		roles: { id: string; name: string }[];
	} | null,
): void {
	try {
		const gw = (app as any).wsGateway;
		if (!gw?.pushToAdminSubscribers) return;
		const timestamp = new Date().toISOString();
		gw.pushToAdminSubscribers("system_settings_updated", {
			type: "system_settings_updated",
			timestamp,
		});
		gw.pushToAdminSubscribers("theme_settings_updated", {
			type: "theme_settings_updated",
			timestamp,
		});
		if (adminUser) {
			gw.pushToAdminSubscribers("user_created", {
				type: "user_created",
				user: adminUser,
				createdBy: adminUser.id,
				timestamp,
			});
		}
	} catch { /* best-effort */ }
}

export async function setupRoutes(app: FastifyInstance) {
	const getHeaders = (request: FastifyRequest) =>
		fromNodeHeaders(
			request.headers as Record<string, string | string[] | undefined>,
		);

	// SECURITY: persistent setup-completion flag. The historical guard was the
	// live count of users holding the "Administrator" role — which re-arms the
	// unauthenticated wizard whenever the last admin disappears (admin
	// self-delete via /api/auth/profile/delete, admin deletion by a user with
	// user.delete, or DB maintenance), letting an unauthenticated attacker
	// mint themselves a fresh administrator. A dedicated SystemSetting row
	// (same pattern as the "security" settings row) survives those events.
	const isSetupCompleted = async (): Promise<boolean> => {
		try {
			const row = await prisma.systemSetting.findUnique({
				where: { id: "setup" },
				select: { updatedAt: true, createdAt: true },
			});
			return Boolean(row);
		} catch {
			// Fail closed: if the settings table is unreadable, treat setup as done.
			return true;
		}
	};

	// The flag row is written exactly once per install (markSetupCompleted
	// below) and never deleted by the panel, so "installed" is a one-way
	// ratchet and is cached in-process. Only the "installed" answer is
	// cached — "setup required" always re-queries, so a fresh install flips
	// to the wizard the moment setup completes (markSetupCompleted sets the
	// cache directly, and workers that never saw a request have no cache to
	// be stale). The TTL is a backstop for out-of-band DB surgery.
	const SETUP_INSTALLED_CACHE_MS = 60_000;
	let setupInstalledUntil = 0;
	const rememberSetupInstalled = () => {
		setupInstalledUntil = Date.now() + SETUP_INSTALLED_CACHE_MS;
	};
	const markSetupCompleted = async (): Promise<void> => {
		await prisma.systemSetting.upsert({
			where: { id: "setup" },
			create: { id: "setup" },
			update: {},
		});
		rememberSetupInstalled();
	};

	// ── Check if setup is needed ───────────────────────────────────────
	app.get(
		"/status",
		async (_request: FastifyRequest, reply: FastifyReply) => {
			// This answer flips from true to false exactly once (when setup
			// completes). A browser or CDN replaying a cached "setupRequired:
			// true" would strand an installed panel on the wizard until it
			// expires — never let it be stored.
			reply.header("Cache-Control", "no-store");
			// Cached "installed" answer — see the ratchet note above.
			if (Date.now() < setupInstalledUntil) {
				return reply.send({ setupRequired: false });
			}
			// SECURITY: once setup has completed (flag row exists), the wizard is
			// closed permanently regardless of the live user/admin counts.
			if (await isSetupCompleted()) {
				rememberSetupInstalled();
				return reply.send({ setupRequired: false });
			}
			const userCount = await prisma.user.count();
			if (userCount > 0) {
				// Installs older than the flag row never had it written. Backfill
				// now so a later account deletion cannot re-arm the wizard.
				await markSetupCompleted().catch(() => {});
				// The count itself is definitive — remember even if the
				// backfill write failed.
				rememberSetupInstalled();
				return reply.send({ setupRequired: false });
			}
			// The flag row is missing AND there are no users. If any other settings
			// row exists, this panel has run before (first setup writes the
			// "security" row) — its data is intact but the flag was lost, e.g. a
			// restore or an interrupted upgrade. Never send an installed panel
			// back to the wizard; close it and backfill instead.
			const hasInstallEvidence =
				(await prisma.systemSetting.count()) > 0 ||
				(await prisma.role.count()) > 0 ||
				(await prisma.server.count()) > 0;
			if (hasInstallEvidence) {
				_request.log.warn(
					"Setup flag missing on an installed panel — backfilling setup:completed",
				);
				await markSetupCompleted().catch(() => {});
				rememberSetupInstalled();
				return reply.send({ setupRequired: false });
			}
			return reply.send({ setupRequired: true });
		},
	);

	// ── Environment variables captured during setup ────────────────────
	// Unauthenticated (setup runs before any account exists), so this exposes
	// only the registry entries explicitly flagged `setup` — never secrets.
	app.get(
		"/environment",
		async (_request: FastifyRequest, reply: FastifyReply) => {
			reply.header("Cache-Control", "no-store");
			return reply.send({ success: true, data: getSetupEnvVars() });
		},
	);

	// ── Complete initial setup ─────────────────────────────────────────
	//
	// Idempotency guard: if a user already exists but has no admin role
	// (e.g. a previous attempt crashed after user creation but before
	// role assignment), we finish the setup instead of returning 409.
	// This prevents users from being stranded on a half-completed install.
	async function ensureSetupComplete(
		reply: FastifyReply,
		parsed: z.infer<typeof setupSchema>,
		existingUser: any,
	) {
		const {
			panelName,
			primaryColor,
			secondaryColor,
			accentColor,
			defaultTheme,
			logoUrl,
			metadata: rawMetadata,
		} = parsed;
		const metadata = rawMetadata as any;

		// 1. Ensure roles exist
		const adminRole = await prisma.role.upsert({
			where: { name: "Administrator" },
			update: {
				description: "Full system access",
				permissions: ["*"],
			},
			create: {
				name: "Administrator",
				description: "Full system access",
				permissions: ["*"],
			},
		});

		await prisma.role.upsert({
			where: { name: "User" },
			update: {
				description: "Standard user access",
				permissions: [
					"server.read",
					"server.start",
					"server.stop",
					"file.read",
					"file.write",
					"console.read",
					"console.write",
				],
			},
			create: {
				name: "User",
				description: "Standard user access",
				permissions: [
					"server.read",
					"server.start",
					"server.stop",
					"file.read",
					"file.write",
					"console.read",
					"console.write",
				],
			},
		});

		// 2. Ensure user has admin role and is verified
		const userRecord = await prisma.user.findUnique({
			where: { id: existingUser.id },
			include: { roles: true },
		});

		if (userRecord) {
			const hasAdminRole = userRecord.roles.some(
				(r) => r.name === "Administrator",
			);
			if (!hasAdminRole || userRecord.role !== "administrator") {
				await prisma.user.update({
					where: { id: existingUser.id },
					data: {
						role: "administrator",
						roles: { connect: { id: adminRole.id } },
						emailVerified: true,
					},
				});
			}
		}

		// 3. Ensure theme settings exist
		await prisma.themeSettings.upsert({
			where: { id: "default" },
			update: {
				panelName,
				primaryColor,
				secondaryColor,
				accentColor,
				defaultTheme,
				logoUrl: logoUrl || null,
				metadata,
			},
			create: {
				id: "default",
				panelName,
				primaryColor,
				secondaryColor,
				accentColor,
				defaultTheme,
				logoUrl: logoUrl || null,
				metadata,
			},
		});

		// Disable open self-registration after first setup (admins re-enable via security settings).
		await prisma.systemSetting.upsert({
			where: { id: "security" },
			create: { id: "security", registrationEnabled: false },
			update: { registrationEnabled: false },
		});
		// SECURITY: recovery completions must persist the setup-completed flag too,
		// otherwise a legacy install (no flag yet) that recovers a half-created
		// admin re-arms the wizard the moment that admin is deleted.
		await markSetupCompleted();

		// 4. Fetch full user record and return success
		const fullUser = await prisma.user.findUnique({
			where: { id: existingUser.id },
			include: { roles: true },
		});

		if (!fullUser) {
			return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to retrieve user record during setup recovery");
		}

		// F23: settings/branding changed and the admin was (re)provisioned.
		emitSetupCompletedEvents(app, {
			id: fullUser.id,
			email: fullUser.email,
			username: fullUser.username,
			createdAt: fullUser.createdAt,
			updatedAt: fullUser.updatedAt,
			roles: fullUser.roles.map((r) => ({ id: r.id, name: r.name })),
		});

		const envStatus = await getEnvRestartStatus();
		return reply.send({
			success: true,
			data: {
				id: fullUser.id,
				email: fullUser.email,
				username: fullUser.username,
				name: fullUser.name,
				firstName: fullUser.firstName,
				lastName: fullUser.lastName,
				image: fullUser.image,
				role: fullUser.roles[0]?.name || "Administrator",
				permissions: fullUser.roles.flatMap((r) => r.permissions),
				createdAt: fullUser.createdAt,
				panelName,
				environmentRestartRequired: envStatus.restartRequired,
			},
		});
	}

	app.post(
		"/complete",
		{
			config: {
				rateLimit: { max: 5, timeWindow: "1 minute" },
			},
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			// 1. Ensure no users exist yet
			//
			// SECURITY: the persistent completion flag is the primary guard — if
			// setup ever ran, the wizard stays closed even when the last admin
			// account is later deleted (which would previously re-arm the
			// unauthenticated admin-creation path below).
			if (await isSetupCompleted()) {
				return apiError(reply, 409, ErrorCodes.SETUP_ALREADY_COMPLETED, "Setup has already been completed");
			}

			// The admin-count gate is a secondary check covering installs that
			// predate the flag row: if any administrator currently exists, setup
			// is complete.
			let userCount = await prisma.user.count();
			let adminCount = await prisma.user.count({
				where: { roles: { some: { name: "Administrator" } } },
			});

			if (adminCount > 0) {
				// Backfill the flag so the wizard cannot be re-armed later if all
				// admins are deleted after this point.
				await markSetupCompleted().catch(() => {});
				return apiError(reply, 409, ErrorCodes.SETUP_ALREADY_COMPLETED, "Setup has already been completed");
			}

			// 2. Validate request body
			const parsed = setupSchema.safeParse(request.body);
			if (!parsed.success) {
				return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Validation failed", {
					details: formatZodIssues(parsed.error.issues),
				});
			}

			// Persist the environment variables captured by the wizard. Restricted
			// to the `setup` registry keys; they need a restart to take effect, so
			// the response tells the client whether to show the reboot prompt.
			// Best-effort: a missing EnvSetting table or a bad value must never
			// block first-run setup from completing.
			try {
				await applySetupEnvVars(parsed.data.environment ?? {});
			} catch (envError) {
				request.log.warn(
					{ error: envError },
					"Setup environment capture failed — continuing setup",
				);
			}

			// 3. Partial setup recovery — an administrator-capable account may
			// already exist (e.g. a previous attempt crashed after user creation
			// but before role assignment). Finish its setup instead of rejecting,
			// but only when it is the account named in this setup request.
			//
			// SECURITY: this branch runs on a panel that has users but no
			// administrator. Promotion must never be grantable to an
			// unauthenticated caller who merely knows an email address —
			// require proof of control of the named account (its current
			// password) before elevating it. A single generic error is returned
			// whether or not the email exists, so this endpoint cannot be used
			// to enumerate accounts.
			if (adminCount === 0 && userCount > 0) {
				const namedUser = await prisma.user.findUnique({
					where: { email: parsed.data.email },
				});
				if (!namedUser) {
					// Same status as the wrong-password path — a 400-vs-403 split
					// here would be an account-enumeration oracle.
					return apiError(reply, 403, ErrorCodes.SETUP_OPERATOR_VERIFICATION_FAILED, "Setup cannot be completed: verify the operator account credentials");
				}
				// Verify the caller controls this account via its existing password.
				try {
					const verify = await auth.api.signInEmail({
						headers: getHeaders(request),
						body: { email: parsed.data.email, password: parsed.data.password },
					});
					if (!verify?.user || (verify as any).user?.id !== namedUser.id) {
						return apiError(reply, 403, ErrorCodes.SETUP_OPERATOR_VERIFICATION_FAILED, "Setup cannot be completed: verify the operator account credentials");
					}
				} catch {
					return apiError(reply, 403, ErrorCodes.SETUP_OPERATOR_VERIFICATION_FAILED, "Setup cannot be completed: verify the operator account credentials");
				}
				return ensureSetupComplete(reply, parsed.data, namedUser);
			}

			const {
				email,
				username,
				password,
				panelName,
				primaryColor,
				secondaryColor,
				accentColor,
				defaultTheme,
				logoUrl,
				metadata: rawMetadata,
			} = parsed.data;
			const metadata = rawMetadata as any;

			// Serialize concurrent setup attempts with a Postgres advisory lock so
			// two racing requests cannot both pass the "no admin" check and create
			// two administrator accounts. (The ::text cast is required: Prisma v7
			// cannot deserialize the bare function's void result column.)
			await prisma.$queryRaw`SELECT pg_advisory_lock(7274483)::text`;
			try {
				// Re-check under the lock: another request may have won the race.
				adminCount = await prisma.user.count({
					where: { roles: { some: { name: "Administrator" } } },
				});
				userCount = await prisma.user.count();
				if (adminCount > 0) {
					return apiError(reply, 409, ErrorCodes.SETUP_ALREADY_COMPLETED, "Setup has already been completed");
				}
				if (userCount > 0) {
					const namedUser = await prisma.user.findUnique({
						where: { email: parsed.data.email },
					});
					if (!namedUser) {
						// Same status as the wrong-password path — a 400-vs-403 split
						// here would be an account-enumeration oracle.
						return apiError(reply, 403, ErrorCodes.SETUP_OPERATOR_VERIFICATION_FAILED, "Setup cannot be completed: verify the operator account credentials");
					}
					// SECURITY: same proof-of-control requirement as the pre-lock
					// recovery branch — see the detailed comment there.
					try {
						const verify = await auth.api.signInEmail({
							headers: getHeaders(request),
							body: { email: parsed.data.email, password: parsed.data.password },
						});
						if (!verify?.user || (verify as any).user?.id !== namedUser.id) {
							return apiError(reply, 403, ErrorCodes.SETUP_OPERATOR_VERIFICATION_FAILED, "Setup cannot be completed: verify the operator account credentials");
						}
					} catch {
						return apiError(reply, 403, ErrorCodes.SETUP_OPERATOR_VERIFICATION_FAILED, "Setup cannot be completed: verify the operator account credentials");
					}
					return ensureSetupComplete(reply, parsed.data, namedUser);
				}

				try {
				// 4. Create Administrator role
				const adminRole = await prisma.role.upsert({
					where: { name: "Administrator" },
					update: {
						description: "Full system access",
						permissions: ["*"],
					},
					create: {
						name: "Administrator",
						description: "Full system access",
						permissions: ["*"],
					},
				});

				// 5. Create User role
				await prisma.role.upsert({
					where: { name: "User" },
					update: {
						description: "Standard user access",
						permissions: [
							"server.read",
							"server.start",
							"server.stop",
							"file.read",
							"file.write",
							"console.read",
							"console.write",
						],
					},
					create: {
						name: "User",
						description: "Standard user access",
						permissions: [
							"server.read",
							"server.start",
							"server.stop",
							"file.read",
							"file.write",
							"console.read",
							"console.write",
						],
					},
				});

				// 6. Create the admin user via better-auth
				const response = await withRegistrationBypass(() =>
					auth.api.signUpEmail({
						headers: getHeaders(request),
						body: { email, password, name: username, username } as any,
						returnHeaders: true,
					}),
				);

				const data =
					"headers" in response && response.response
						? response.response
						: response;
				const user = (data as any)?.user;
				if (!user) {
					return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to create admin user");
				}

				// 7. Assign Administrator role and mark email as verified
				// (the initial admin bypasses email verification — no mailer is
				// configured yet during first-time setup).
				await prisma.user.update({
					where: { id: user.id },
					data: {
						role: "administrator",
						roles: { connect: { id: adminRole.id } },
						emailVerified: true,
					},
				});

				// 8. Upsert theme settings
				await prisma.themeSettings.upsert({
					where: { id: "default" },
					update: {
						panelName,
						primaryColor,
						secondaryColor,
						accentColor,
						defaultTheme,
						logoUrl: logoUrl || null,
						metadata,
					},
					create: {
						id: "default",
						panelName,
						primaryColor,
						secondaryColor,
						accentColor,
						defaultTheme,
						logoUrl: logoUrl || null,
						metadata,
					},
				});
				// Theme settings are cached for the public endpoint — evict.
				await invalidateConfig("theme_default").catch(() => {});

				// Disable open self-registration after first setup completes.
				// Admins can re-enable via security settings or REGISTRATION_ENABLED=true.
				await prisma.systemSetting.upsert({
					where: { id: "security" },
					create: { id: "security", registrationEnabled: false },
					update: { registrationEnabled: false },
				});

				// 9. Persist the setup-completed flag — permanently closes the
				// unauthenticated setup wizard, even if every administrator is
				// later deleted (see the isSetupCompleted guard on POST /complete).
				await markSetupCompleted();

				// 10. Forward auth headers (set-cookie) so user is immediately logged in
				forwardAuthHeaders(response, reply);

				// 10. Fetch full user record and return success
				const fullUser = await prisma.user.findUnique({
					where: { id: user.id },
					include: { roles: true },
				});

				if (!fullUser) {
					return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "Failed to retrieve user record after creation");
				}

				// F23: notify any already-open admin sessions (best-effort).
				emitSetupCompletedEvents(app, {
					id: fullUser.id,
					email: fullUser.email,
					username: fullUser.username,
					createdAt: fullUser.createdAt,
					updatedAt: fullUser.updatedAt,
					roles: fullUser.roles.map((r) => ({ id: r.id, name: r.name })),
				});

				const envStatus = await getEnvRestartStatus();
				return reply.send({
					success: true,
					data: {
						id: fullUser.id,
						email: fullUser.email,
						username: fullUser.username,
						name: fullUser.name,
						firstName: fullUser.firstName,
						lastName: fullUser.lastName,
						image: fullUser.image,
						role: fullUser.roles[0]?.name || "Administrator",
						permissions: fullUser.roles.flatMap((r) => r.permissions),
						createdAt: fullUser.createdAt,
						panelName,
						environmentRestartRequired: envStatus.restartRequired,
					},
				});
				} catch (error: any) {
					captureSystemError({
						level: "error",
						component: "SetupRoutes",
						message: error?.message || "Setup failed",
						stack: error?.stack,
						metadata: { context: "setup" },
					}).catch(() => {});
					request.log.error({ error }, "Setup failed");
					return apiError(reply, 500, ErrorCodes.INTERNAL_ERROR, "An unexpected error occurred during setup");
				}
			} finally {
				await prisma
					.$queryRaw`SELECT pg_advisory_unlock(7274483)`
					.catch(() => {});
			}		},
	);
}
