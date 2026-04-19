import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db";
import { auth } from "../auth";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";

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

// Helper to forward set-cookie headers from better-auth to Fastify reply
function forwardAuthHeaders(response: any, reply: FastifyReply) {
	const cookieHeader =
		"headers" in response ? response.headers?.get?.("set-cookie") : null;
	if (cookieHeader) {
		if (Array.isArray(cookieHeader)) {
			cookieHeader.forEach((cookie: string) =>
				reply.header("set-cookie", cookie),
			);
		} else {
			reply.header("set-cookie", cookieHeader);
		}
	}
}

export async function setupRoutes(app: FastifyInstance) {
	const getHeaders = (request: FastifyRequest) =>
		fromNodeHeaders(
			request.headers as Record<string, string | string[] | undefined>,
		);

	// ── Check if setup is needed ─────────────────────────────────────────
	app.get("/status", async (_request: FastifyRequest, reply: FastifyReply) => {
		const userCount = await prisma.user.count();
		return reply.send({ setupRequired: userCount === 0 });
	});

	// ── Complete initial setup ───────────────────────────────────────────
	app.post(
		"/complete",
		async (request: FastifyRequest, reply: FastifyReply) => {
			// 1. Ensure no users exist yet
			const userCount = await prisma.user.count();
			if (userCount > 0) {
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
				// 3. Create Administrator role
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

				// 4. Create User role
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

				// 5. Create the admin user via better-auth
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

				// 6. Assign Administrator role
				await prisma.user.update({
					where: { id: user.id },
					data: {
						role: "administrator",
						roles: { connect: { id: adminRole.id } },
					},
				});

				// 7. Upsert theme settings
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

				// 8. Forward auth headers (set-cookie) so user is immediately logged in
				forwardAuthHeaders(response, reply);

				// 9. Return success
				return reply.send({
					success: true,
					data: {
						userId: user.id,
						email: user.email,
						username: (user as any).username ?? username,
						role: "Administrator",
						permissions: ["*"],
						panelName,
					},
				});
			} catch (error: any) {
				request.log.error({ error }, "Setup failed");
				return reply.status(500).send({
					error: "An unexpected error occurred during setup",
				});
			}
		},
	);
}
