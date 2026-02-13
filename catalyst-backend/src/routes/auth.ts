import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { auth } from "../auth";
import { fromNodeHeaders } from "better-auth/node";
import { logAuthAttempt } from "../middleware/audit";
import { getSecuritySettings } from "../services/mailer";
import { serialize } from '../utils/serialize';

// Helper to forward response headers (set-auth-token, set-cookie) from better-auth to Fastify reply
function forwardAuthHeaders(response: any, reply: FastifyReply) {
  const tokenHeader = "headers" in response ? response.headers?.get?.("set-auth-token") : null;
  const cookieHeader = "headers" in response ? response.headers?.get?.("set-cookie") : null;
  if (tokenHeader) {
    reply.header("set-auth-token", tokenHeader);
    reply.header("Access-Control-Expose-Headers", "set-auth-token");
  }
  if (cookieHeader) {
    if (Array.isArray(cookieHeader)) {
      cookieHeader.forEach((cookie: string) => reply.header("set-cookie", cookie));
    } else {
      reply.header("set-cookie", cookieHeader);
    }
  }
  return tokenHeader;
}

// Extract the data payload from a better-auth response (handles both wrapped and unwrapped)
function extractResponseData(response: any) {
  return "headers" in response && response.response ? response.response : response;
}

export async function authRoutes(app: FastifyInstance) {
  const loadUserPermissions = async (userId: string) => {
    const roles = await prisma.role.findMany({
      where: { users: { some: { id: userId } } },
      select: { permissions: true },
    });
    return roles.flatMap((role) => role.permissions);
  };

  // Helper to get the request headers in the format better-auth expects
  const getHeaders = (request: FastifyRequest) =>
    fromNodeHeaders(request.headers as Record<string, string | string[] | undefined>);

  // ── Lockout helpers ──────────────────────────────────────────────────
  async function checkLockout(email: string, ip: string) {
    const settings = await getSecuritySettings();
    if (settings.lockoutMaxAttempts <= 0 || settings.lockoutWindowMinutes <= 0 || settings.lockoutDurationMinutes <= 0) {
      throw Object.assign(new Error("Security settings invalid"), { statusCode: 500 });
    }
    const windowMs = settings.lockoutWindowMinutes * 60 * 1000;
    const now = new Date();
    const lockout = await prisma.authLockout.findUnique({
      where: { email_ipAddress: { email, ipAddress: ip } },
    });
    if (lockout?.lockedUntil && lockout.lockedUntil > now) {
      throw Object.assign(new Error("Account temporarily locked"), { statusCode: 429 });
    }
    // Reset window if expired
    if (lockout && lockout.firstFailedAt && now.getTime() - lockout.firstFailedAt.getTime() > windowMs) {
      await prisma.authLockout.update({
        where: { id: lockout.id },
        data: { failureCount: 1, firstFailedAt: now, lastFailedAt: now, lockedUntil: null },
      });
    }
    return settings;
  }

  async function clearLockout(email: string, ip: string) {
    await prisma.authLockout.deleteMany({ where: { email, ipAddress: ip } });
  }

  async function recordFailure(email: string, ip: string, userAgent: string | undefined, settings: any) {
    const now = new Date();
    const windowMs = settings.lockoutWindowMinutes * 60 * 1000;
    const updated = await prisma.authLockout.upsert({
      where: { email_ipAddress: { email, ipAddress: ip } },
      create: {
        email, ipAddress: ip, userAgent,
        failureCount: 1, firstFailedAt: now, lastFailedAt: now, lockedUntil: null,
      },
      update: { failureCount: { increment: 1 }, lastFailedAt: now },
    });
    // Reset window if expired
    if (updated.firstFailedAt && now.getTime() - updated.firstFailedAt.getTime() > windowMs) {
      await prisma.authLockout.update({
        where: { id: updated.id },
        data: { failureCount: 1, firstFailedAt: now, lastFailedAt: now, lockedUntil: null },
      });
      return false;
    }
    if (updated.failureCount >= settings.lockoutMaxAttempts) {
      await prisma.authLockout.update({
        where: { id: updated.id },
        data: { lockedUntil: new Date(now.getTime() + settings.lockoutDurationMinutes * 60 * 1000) },
      });
      return true; // locked
    }
    return false;
  }

  // ── Register ─────────────────────────────────────────────────────────
  app.post(
    "/register",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, username, password } = request.body as {
        email: string; username: string; password: string;
      };

      if (!email || !username || !password) {
        return reply.status(400).send({ error: "Missing required fields: email, username, password" });
      }
      if (password.length < 8) {
        return reply.status(400).send({ error: "Password must be at least 8 characters" });
      }

      const existing = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });
      if (existing) {
        return reply.status(409).send({ error: "Email or username already in use" });
      }

      const response = await auth.api.signUpEmail({
        headers: getHeaders(request),
        body: { email, password, name: username, username } as any,
        returnHeaders: true,
      });

      const data = extractResponseData(response);
      const user = data?.user;
      if (!user) {
        return reply.status(400).send({ error: "Registration failed" });
      }

      const tokenHeader = forwardAuthHeaders(response, reply);
      const permissions = await loadUserPermissions(user.id);

      reply.send({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          username: user.username ?? username,
          permissions,
          token: tokenHeader ?? null,
        },
      });
    }
  );

  // ── Login ────────────────────────────────────────────────────────────
  app.post(
    "/login",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email, password } = request.body as { email: string; password: string };

      if (!email || !password) {
        return reply.status(400).send({ error: "Missing email or password" });
      }

      const normalizedEmail = email.trim().toLowerCase();
      let settings: any;
      try {
        settings = await checkLockout(normalizedEmail, request.ip);
      } catch (err: any) {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers['user-agent']);
        return reply.status(err.statusCode || 500).send({ error: err.message });
      }

      // Resolve the actual email (case-insensitive lookup)
      const userRecord = await prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      });

      if (!userRecord) {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers["user-agent"]);
        await recordFailure(normalizedEmail, request.ip, request.headers["user-agent"], settings);
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      try {
        const response = await auth.api.signInEmail({
          headers: getHeaders(request),
          body: {
            email: userRecord.email,
            password,
            rememberMe: (request.body as any)?.rememberMe,
          },
          returnHeaders: true,
        });

        const data = extractResponseData(response);

        // 2FA redirect
        if (data?.twoFactorRedirect) {
          await logAuthAttempt(normalizedEmail, true, request.ip, request.headers["user-agent"]);
          await clearLockout(normalizedEmail, request.ip);
          const tokenHeader = forwardAuthHeaders(response, reply);
          return reply.status(202).send({
            success: false,
            data: { twoFactorRequired: true, token: tokenHeader ?? null },
          });
        }

        const user = data?.user;
        if (!user) {
          const errorCode = data?.code || data?.error?.code;
          if (errorCode === "PASSKEY_REQUIRED") {
            return reply.status(403).send({ error: "Passkey required", code: "PASSKEY_REQUIRED" });
          }
          throw new Error(data?.error?.message || data?.error || "Invalid credentials");
        }

        await logAuthAttempt(normalizedEmail, true, request.ip, request.headers["user-agent"]);
        await clearLockout(normalizedEmail, request.ip);

        const tokenHeader = forwardAuthHeaders(response, reply);
        const permissions = await loadUserPermissions(user.id);

        reply.send({
          success: true,
          data: {
            userId: user.id,
            email: user.email,
            username: user.username ?? userRecord.username,
            permissions,
            token: tokenHeader ?? null,
          },
        });
      } catch (err: any) {
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers["user-agent"]);
        const locked = await recordFailure(normalizedEmail, request.ip, request.headers["user-agent"], settings);
        if (locked) {
          return reply.status(429).send({ error: "Account temporarily locked" });
        }
        return reply.status(401).send({ error: "Invalid credentials" });
      }
    }
  );

  // ── Get current user ─────────────────────────────────────────────────
  app.get(
    "/me",
    { onRequest: [app.authenticate], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: {
          id: true, email: true, username: true, createdAt: true,
          roles: { select: { permissions: true } },
        },
      });

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      reply.send({
        success: true,
        data: {
          id: user.id, email: user.email, username: user.username,
          permissions: user.roles.flatMap((role) => role.permissions),
          createdAt: user.createdAt,
        },
      });
    }
  );

  // ── Profile summary ──────────────────────────────────────────────────
  app.get(
    "/profile",
    { onRequest: [app.authenticate], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userRecord = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: {
          id: true, email: true, username: true, twoFactorEnabled: true, createdAt: true,
          accounts: { select: { id: true, providerId: true, accountId: true, createdAt: true, updatedAt: true } },
        },
      });

      if (!userRecord) {
        return reply.status(404).send({ error: "User not found" });
      }

      reply.send({
        success: true,
        data: {
          id: userRecord.id, email: userRecord.email, username: userRecord.username,
          twoFactorEnabled: userRecord.twoFactorEnabled,
          hasPassword: userRecord.accounts.some((a) => a.providerId === "credential"),
          createdAt: userRecord.createdAt,
          accounts: userRecord.accounts,
        },
      });
    }
  );

  // ── Change password ──────────────────────────────────────────────────
  app.post(
    "/profile/change-password",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { currentPassword, newPassword, revokeOtherSessions } = request.body as {
        currentPassword: string; newPassword: string; revokeOtherSessions?: boolean;
      };

      if (!currentPassword || !newPassword) {
        return reply.status(400).send({ error: "Missing current or new password" });
      }

      const response = await auth.api.changePassword({
        headers: getHeaders(request),
        body: { currentPassword, newPassword, revokeOtherSessions },
        returnHeaders: true,
      });

      forwardAuthHeaders(response, reply);
      reply.send({ success: true, data: extractResponseData(response) });
    }
  );

  // ── Set password (for SSO-only accounts) ─────────────────────────────
  app.post(
    "/profile/set-password",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { newPassword } = request.body as { newPassword: string };
      if (!newPassword) {
        return reply.status(400).send({ error: "Missing new password" });
      }

      const response = await auth.api.setPassword({
        headers: getHeaders(request),
        body: { newPassword },
      });

      reply.send(serialize({ success: true, data: response }));
    }
  );

  // ── Two-factor status ────────────────────────────────────────────────
  app.get(
    "/profile/two-factor",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userRecord = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { twoFactorEnabled: true },
      });
      if (!userRecord) {
        return reply.status(404).send({ error: "User not found" });
      }
      reply.send(serialize({ success: true, data: userRecord }));
    }
  );

  // ── Enable 2FA ───────────────────────────────────────────────────────
  app.post(
    "/profile/two-factor/enable",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { password } = request.body as { password: string };
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const response = await auth.api.enableTwoFactor({
        headers: getHeaders(request),
        body: { password },
        returnHeaders: true,
      });
      forwardAuthHeaders(response, reply);
      reply.send({ success: true, data: extractResponseData(response) });
    }
  );

  // ── Disable 2FA ──────────────────────────────────────────────────────
  app.post(
    "/profile/two-factor/disable",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { password } = request.body as { password: string };
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const response = await auth.api.disableTwoFactor({
        headers: getHeaders(request),
        body: { password },
        returnHeaders: true,
      });
      forwardAuthHeaders(response, reply);
      reply.send({ success: true, data: extractResponseData(response) });
    }
  );

  // ── Generate backup codes ────────────────────────────────────────────
  app.post(
    "/profile/two-factor/generate-backup-codes",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { password } = request.body as { password: string };
      if (!password) {
        return reply.status(400).send({ error: "Password is required" });
      }
      const response = await auth.api.generateBackupCodes({
        headers: getHeaders(request),
        body: { password },
        returnHeaders: true,
      });
      forwardAuthHeaders(response, reply);
      reply.send({ success: true, data: extractResponseData(response) });
    }
  );

  // ── Passkey management ───────────────────────────────────────────────
  app.get(
    "/profile/passkeys",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const response = await auth.api.listPasskeys({
        headers: getHeaders(request),
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  app.post(
    "/profile/passkeys",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, authenticatorAttachment } = request.body as {
        name?: string; authenticatorAttachment?: "platform" | "cross-platform";
      };
      const response = await auth.api.generatePasskeyRegistrationOptions({
        headers: getHeaders(request),
        query: {
          ...(name ? { name } : {}),
          ...(authenticatorAttachment ? { authenticatorAttachment } : {}),
        },
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  app.post(
    "/profile/passkeys/verify",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { response: credentialResponse, name } = request.body as {
        response: Record<string, any>; name?: string;
      };
      if (!credentialResponse) {
        return reply.status(400).send({ error: "Missing passkey response" });
      }
      const response = await auth.api.verifyPasskeyRegistration({
        headers: getHeaders(request),
        body: { response: credentialResponse, ...(name ? { name } : {}) },
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  app.delete(
    "/profile/passkeys/:id",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const response = await auth.api.deletePasskey({
        headers: getHeaders(request),
        body: { id },
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  app.patch(
    "/profile/passkeys/:id",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name } = request.body as { name: string };
      if (!name) {
        return reply.status(400).send({ error: "Missing name" });
      }
      const response = await auth.api.updatePasskey({
        headers: getHeaders(request),
        body: { id, name },
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  // ── SSO account management ───────────────────────────────────────────
  app.get(
    "/profile/sso/accounts",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accounts = await auth.api.listUserAccounts({
        headers: getHeaders(request),
      });
      reply.send(serialize({ success: true, data: accounts }));
    }
  );

  app.post(
    "/profile/sso/link",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId } = request.body as { providerId: string };
      if (!providerId) {
        return reply.status(400).send({ error: "Missing providerId" });
      }
      const response = await auth.api.oAuth2LinkAccount({
        headers: getHeaders(request),
        body: {
          providerId,
          callbackURL: `${process.env.FRONTEND_URL || "http://localhost:5173"}/profile`,
        },
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  app.post(
    "/profile/sso/unlink",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { providerId, accountId } = request.body as {
        providerId: string; accountId?: string;
      };
      if (!providerId) {
        return reply.status(400).send({ error: "Missing providerId" });
      }
      const response = await auth.api.unlinkAccount({
        headers: getHeaders(request),
        body: { providerId, accountId },
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  // ── Forgot password ──────────────────────────────────────────────────
  app.post(
    "/forgot-password",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { email } = request.body as { email: string };
      if (!email || !email.trim()) {
        return reply.status(400).send({ error: "Email is required" });
      }

      const normalizedEmail = email.trim().toLowerCase();

      try {
        const redirectUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password`;
        await auth.api.requestPasswordReset({
          body: { email: normalizedEmail, redirectTo: redirectUrl },
        });
      } catch (error: any) {
        // Log but don't expose to prevent email enumeration
        app.log.warn({ error: error.message }, "Password reset request failed");
      }

      // Always return success to prevent email enumeration
      reply.send({ success: true, message: "If an account exists, a reset link has been sent" });
    }
  );

  // ── Validate reset token ─────────────────────────────────────────────
  app.get(
    "/reset-password/validate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.query as { token?: string };
      if (!token) {
        return reply.status(400).send({ error: "Token is required", valid: false });
      }

      try {
        // Attempt a dry-run reset via better-auth; if it doesn't throw, the token is valid.
        // better-auth stores tokens in the verification table; we validate through its API.
        const verification = await prisma.verification.findFirst({
          where: { value: token, expiresAt: { gt: new Date() } },
        });
        reply.send({ success: Boolean(verification), valid: Boolean(verification), ...(verification ? {} : { error: "Invalid or expired token" }) });
      } catch {
        reply.send({ success: false, valid: false, error: "Invalid or expired token" });
      }
    }
  );

  // ── Reset password with token ────────────────────────────────────────
  app.post(
    "/reset-password",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token, password } = request.body as { token: string; password: string };
      if (!token || !password) {
        return reply.status(400).send({ error: "Token and password are required" });
      }
      if (password.length < 8) {
        return reply.status(400).send({ error: "Password must be at least 8 characters" });
      }

      try {
        await auth.api.resetPassword({
          body: { token, newPassword: password },
        });
        reply.send({ success: true, message: "Password has been reset successfully" });
      } catch (error: any) {
        reply.status(400).send({ error: error?.message || "Failed to reset password" });
      }
    }
  );
}
