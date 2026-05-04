import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db";
import { auth } from "../auth";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { captureSystemError } from "../services/error-logger";

const setupSchema = z.object({
	email: z.string().email("Invalid email format"),
	username: z.string().min(2).max(32),
	password: z.string().min(8, "Password must be at least 8 characters"),
	panelName: z.string().min(1).max(50).default("Catalyst"),
	primaryColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
		.default("#0d9488"),
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color")
		.default("#06b6d4"),
	defaultTheme: z.enum(["light", "dark"]).default("dark"),
	logoUrl: z.string().optional(),
});

// Helper to forward set-cookie headers from better-auth to Fastify reply.
// Must use getSetCookie() when available because Headers.get("set-cookie")
// returns a comma-separated string which browsers cannot parse.
function forwardAuthHeaders(response: any, reply: FastifyReply) {
	const headers = "headers" in response ? response.headers : null;
	if (!headers) return;

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

export async function setupRoutes(app: FastifyInstance) {
	const getHeaders = (request: FastifyRequest) =>
		fromNodeHeaders(
			request.headers as Record<string, string | string[] | undefined>,
		);

	// ── Check if setup is needed ───────────────────────────────────────
	app.get(
		"/status",
		async (_request: FastifyRequest, reply: FastifyReply) => {
			const userCount = await prisma.user.count();
			return reply.send({ setupRequired: userCount === 0 });
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
			email,
			username,
			panelName,
			primaryColor,
			accentColor,
			defaultTheme,
			logoUrl,
		} = parsed;

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
				accentColor,
				defaultTheme,
				logoUrl: logoUrl || null,
			},
			create: {
				id: "default",
				panelName,
				primaryColor,
				accentColor,
				defaultTheme,
				logoUrl: logoUrl || null,
			},
		});

		// 4. Fetch full user record and return success
		const fullUser = await prisma.user.findUnique({
			where: { id: existingUser.id },
			include: { roles: true },
		});

		if (!fullUser) {
			return reply.status(500).send({
				error: "Failed to retrieve user record during setup recovery",
			});
		}

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
			},
		});
	}

	app.post(
		"/complete",
		async (request: FastifyRequest, reply: FastifyReply) => {
			// 1. Ensure no users exist yet
			const userCount = await prisma.user.count();
			const existingUser =
				userCount > 0
					? await prisma.user.findFirst({
							include: { roles: true },
					  })
					: null;

			// If a user exists but has no admin role, the previous attempt
			// partially failed. Finish the setup instead of rejecting.
			const isFullySetUp =
				existingUser?.roles.some(
					(r) => r.name === "Administrator",
				) ?? false;

			if (userCount > 0 && isFullySetUp) {
				return reply.status(409).send({
					error: "Setup has already been completed",
				});
			}

			// 2. Validate request body
			const parsed = setupSchema.safeParse(request.body);
			if (!parsed.success) {
				return reply.status(400).send({
					error: "Validation failed",
					details: parsed.error.issues.map((err) => ({
						field: err.path.join("."),
						message: err.message,
					})),
				});
			}

			// 3. Partial setup recovery — user exists but wasn't fully configured
			if (existingUser && !isFullySetUp) {
				return ensureSetupComplete(reply, parsed.data, existingUser);
			}

			const {
				email,
				username,
				password,
				panelName,
				primaryColor,
				accentColor,
				defaultTheme,
				logoUrl,
			} = parsed.data;

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
				const response = await auth.api.signUpEmail({
					headers: getHeaders(request),
					body: { email, password, name: username, username } as any,
					returnHeaders: true,
				});

				const data =
					"headers" in response && response.response
						? response.response
						: response;
				const user = (data as any)?.user;
				if (!user) {
					return reply.status(500).send({
						error: "Failed to create admin user",
					});
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
						accentColor,
						defaultTheme,
						logoUrl: logoUrl || null,
					},
					create: {
						id: "default",
						panelName,
						primaryColor,
						accentColor,
						defaultTheme,
						logoUrl: logoUrl || null,
					},
				});

				// 9. Forward auth headers (set-cookie) so user is immediately logged in
				forwardAuthHeaders(response, reply);

				// 10. Fetch full user record and return success
				const fullUser = await prisma.user.findUnique({
					where: { id: user.id },
					include: { roles: true },
				});

				if (!fullUser) {
					return reply.status(500).send({
						error: "Failed to retrieve user record after creation",
					});
				}

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
				return reply.status(500).send({
					error: "An unexpected error occurred during setup",
				});
			}
		},
	);
}
