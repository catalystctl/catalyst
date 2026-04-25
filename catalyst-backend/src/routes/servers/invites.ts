import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { DEFAULT_PERMISSION_PRESETS, INVITE_EXPIRY_DAYS, auth, canAccessServer, captureSystemError, hasNodeAccess, nanoid, renderInviteEmail, revokeSftpTokensForUser, sendEmail } from './_helpers.js';

export async function serverInvitesRoutes(app: FastifyInstance) {
  app.get(
    "/:serverId/permissions",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Check if user has access - owner, admin, or node-assigned user
      if (!(await canAccessServer(userId, server))) {
        const access = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId, serverId } },
        });
        if (!access) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      // Get all access entries for this server
      const permissions = await prisma.serverAccess.findMany({
        where: { serverId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
            },
          },
        },
      });

      reply.send({ success: true, data: permissions, presets: DEFAULT_PERMISSION_PRESETS });
    }
  );

  // List pending server invites
  app.get(
    "/:serverId/invites",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, ownerId: true, nodeId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: { serverId, userId, permissions: { has: "server.read" } },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
        }
      }

      const invites = await prisma.serverAccessInvite.findMany({
        where: { serverId, cancelledAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });

      reply.send({ success: true, data: invites });
    }
  );

  // Create invite
  app.post(
    "/:serverId/invites",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { email, permissions } = request.body as {
        email?: string;
        permissions?: string[];
      };

      if (!email || !permissions || permissions.length === 0) {
        return reply.status(400).send({ error: "Email and permissions are required" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const normalizedEmail = email.toLowerCase();
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        const existingAccess = await prisma.serverAccess.findUnique({
          where: { userId_serverId: { userId: existingUser.id, serverId } },
        });
        if (existingAccess) {
          return reply.status(409).send({ error: "User already has access" });
        }
      }

      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const sanitizedPermissions = permissions.map((entry) => entry.trim()).filter(Boolean);
      if (sanitizedPermissions.length === 0) {
        return reply.status(400).send({ error: "Permissions cannot be empty" });
      }
      const invite = await prisma.serverAccessInvite.create({
        data: {
          serverId,
          email: normalizedEmail,
          token,
          permissions: sanitizedPermissions,
          invitedByUserId: userId,
          expiresAt,
        },
      });

      const inviteUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/invites/${token}`;
      try {
        const emailContent = await renderInviteEmail({
          serverName: server.name,
          inviteUrl,
          expiresAt,
        });
        await sendEmail({
          to: normalizedEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      } catch (emailErr: any) {
        // Log but don't fail — the invite is already in the DB
        captureSystemError({
          level: 'warn',
          component: 'ServerRoutes',
          message: `Failed to send invite email: ${emailErr?.message || String(emailErr)}`,
          stack: emailErr?.stack,
        }).catch(() => {});
        app.log.warn(emailErr, "Failed to send invite email");
      }

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.invite",
          resource: "server",
          resourceId: serverId,
          details: { email: normalizedEmail, permissions: sanitizedPermissions },
        },
      });

      reply.status(201).send({ success: true, data: invite });
    }
  );

  // Cancel invite
  app.delete(
    "/:serverId/invites/:inviteId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, inviteId } = request.params as { serverId: string; inviteId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const invite = await prisma.serverAccessInvite.findFirst({
        where: { id: inviteId, serverId },
      });

      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      await prisma.serverAccessInvite.update({
        where: { id: inviteId },
        data: { cancelledAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.invite.cancel",
          resource: "server",
          resourceId: serverId,
          details: { email: invite.email },
        },
      });

      reply.send({ success: true });
    }
  );

  const acceptInviteForUser = async (args: {
    userId: string;
    token: string;
    reply: FastifyReply;
    invite?: { id: string; serverId: string; email: string; permissions: string[]; cancelledAt?: Date | null; acceptedAt?: Date | null; expiresAt: Date };
  }) => {
    const invite =
      args.invite ??
      (await prisma.serverAccessInvite.findUnique({ where: { token: args.token } }));
    if (!invite) {
      args.reply.status(404).send({ error: "Invite not found" });
      return null;
    }

    if (invite.cancelledAt || invite.acceptedAt) {
      args.reply.status(409).send({ error: "Invite no longer active" });
      return null;
    }

    if (invite.expiresAt <= new Date()) {
      args.reply.status(410).send({ error: "Invite expired" });
      return null;
    }

    const user = await prisma.user.findUnique({ where: { id: args.userId } });
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      args.reply.status(403).send({ error: "Invite not valid for this account" });
      return null;
    }

    await prisma.$transaction(async (tx) => {
      await tx.serverAccess.upsert({
        where: { userId_serverId: { userId: args.userId, serverId: invite.serverId } },
        create: {
          userId: args.userId,
          serverId: invite.serverId,
          permissions: invite.permissions,
        },
        update: {
          permissions: invite.permissions,
        },
      });
      await tx.serverAccessInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: args.userId,
        action: "server.invite.accept",
        resource: "server",
        resourceId: invite.serverId,
        details: { email: invite.email },
      },
    });

    return invite;
  };

  // Accept invite (authenticated)
  app.post(
    "/invites/accept",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { token } = request.body as { token?: string };

      if (!token) {
        return reply.status(400).send({ error: "Missing token" });
      }

      const invite = await acceptInviteForUser({ userId, token, reply });
      if (!invite) {
        return;
      }

      reply.send({ success: true });
    }
  );

  // Accept invite + register
  app.post(
    "/invites/register",
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token, username, password } = request.body as {
        token?: string;
        username?: string;
        password?: string;
      };

      if (!token || !username || !password) {
        return reply.status(400).send({ error: "Missing token, username, or password" });
      }

      if (password.length < 8) {
        return reply.status(400).send({ error: "Password must be at least 8 characters" });
      }

      const invite = await prisma.serverAccessInvite.findUnique({ where: { token } });
      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      if (invite.cancelledAt || invite.acceptedAt) {
        return reply.status(409).send({ error: "Invite no longer active" });
      }

      if (invite.expiresAt <= new Date()) {
        return reply.status(410).send({ error: "Invite expired" });
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email: invite.email }, { username }] },
      });
      if (existing) {
        return reply.status(409).send({ error: "Email or username already in use" });
      }

      const signUpResponse = await auth.api.signUpEmail({
        headers: new Headers({
          origin: request.headers.origin || request.headers.host || "http://localhost:3000",
        }),
        body: {
          email: invite.email,
          password,
          name: username,
          username,
        } as any,
        returnHeaders: true,
      });

      const signUpUser =
        "headers" in signUpResponse && signUpResponse.response
          ? signUpResponse.response.user
          : (signUpResponse as any)?.user;
      if (!signUpUser) {
        return reply.status(400).send({ error: "Registration failed" });
      }

      const accepted = await acceptInviteForUser({ userId: signUpUser.id, token, reply, invite });
      if (!accepted) {
        return;
      }

      const roles = await prisma.role.findMany({
        where: { users: { some: { id: signUpUser.id } } },
        select: { permissions: true },
      });
      const permissions = roles.flatMap((role) => role.permissions);

      const tokenValue =
        "headers" in signUpResponse ? signUpResponse.headers.get("set-auth-token") : null;
      if (tokenValue) {
        reply.header("set-auth-token", tokenValue);
        reply.header("Access-Control-Expose-Headers", "set-auth-token");
      }

      reply.send({
        success: true,
        data: {
          userId: signUpUser.id,
          email: signUpUser.email,
          username: signUpUser.username ?? username,
          permissions,
          token: tokenValue ?? null,
        },
      });
    }
  );

  // Invite preview (for invite signup flow)
  app.get(
    "/invites/:token",
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };
      if (!token) {
        return reply.status(400).send({ error: "Missing token" });
      }

      const invite = await prisma.serverAccessInvite.findUnique({
        where: { token },
        include: {
          server: { select: { name: true } },
        },
      });

      if (!invite) {
        return reply.status(404).send({ error: "Invite not found" });
      }

      if (invite.cancelledAt || invite.acceptedAt) {
        return reply.status(409).send({ error: "Invite no longer active" });
      }

      if (invite.expiresAt <= new Date()) {
        return reply.status(410).send({ error: "Invite expired" });
      }

      reply.send({
        success: true,
        data: {
          email: invite.email,
          serverName: invite.server.name,
          permissions: invite.permissions,
          expiresAt: invite.expiresAt,
        },
      });
    }
  );

  // Add or update server access
  app.post(
    "/:serverId/access",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const { targetUserId, permissions } = request.body as {
        targetUserId?: string;
        permissions?: string[];
      };

      if (!targetUserId || !permissions || permissions.length === 0) {
        return reply.status(400).send({ error: "targetUserId and permissions are required" });
      }

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (targetUserId === server.ownerId) {
        return reply.status(409).send({ error: "Owner permissions cannot be edited" });
      }

      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        return reply.status(404).send({ error: "User not found" });
      }

      const sanitizedPermissions = permissions.map((entry) => entry.trim()).filter(Boolean);
      if (sanitizedPermissions.length === 0) {
        return reply.status(400).send({ error: "Permissions cannot be empty" });
      }

      const access = await prisma.serverAccess.upsert({
        where: { userId_serverId: { userId: targetUserId, serverId } },
        create: { userId: targetUserId, serverId, permissions: sanitizedPermissions },
        update: { permissions: sanitizedPermissions },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.access.update",
          resource: "server",
          resourceId: serverId,
          details: { targetUserId, permissions: sanitizedPermissions },
        },
      });

      reply.send({ success: true, data: access });

      // Broadcast server_updated event (access change)
      const wsGatewayAccessUpdated = (app as any).wsGateway;
      if (wsGatewayAccessUpdated?.pushToAdminSubscribers) {
        wsGatewayAccessUpdated.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'access_updated',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Remove server access
  app.delete(
    "/:serverId/access/:targetUserId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId, targetUserId } = request.params as {
        serverId: string;
        targetUserId: string;
      };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        select: { ownerId: true },
      });

      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (server.ownerId !== userId) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (targetUserId === server.ownerId) {
        return reply.status(409).send({ error: "Owner access cannot be removed" });
      }

      await prisma.serverAccess.delete({
        where: { userId_serverId: { userId: targetUserId, serverId } },
      });

      // Instantly revoke SFTP tokens for the removed user on this server
      revokeSftpTokensForUser(targetUserId, serverId);

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.access.remove",
          resource: "server",
          resourceId: serverId,
          details: { targetUserId },
        },
      });

      reply.send({ success: true });

      // Broadcast server_updated event (access removed)
      const wsGatewayAccessRemoved = (app as any).wsGateway;
      if (wsGatewayAccessRemoved?.pushToAdminSubscribers) {
        wsGatewayAccessRemoved.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'access_removed',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // List server databases
}
