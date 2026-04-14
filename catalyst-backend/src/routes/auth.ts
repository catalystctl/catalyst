import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { auth } from "../auth";
import { fromNodeHeaders } from "better-auth/node";
import { logAuthAttempt } from "../middleware/audit";
import { serialize } from '../utils/serialize';
import {
  bruteForceProtection,
  handleFailedLogin,
  handleSuccessfulLogin,
} from "../middleware/brute-force";
import {
  passwordSchema,
  validateRequestBody,
  userRegistrationSchema,
  userLoginSchema,
  passwordChangeSchema,
} from "../lib/validation";

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

  // ── Register ─────────────────────────────────────────────────────────
  app.post(
    "/register",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Validate all registration fields using the pre-built schema
      const regValidation = userRegistrationSchema.safeParse(request.body);
      if (!regValidation.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: regValidation.error.issues.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      const { email, username, password } = regValidation.data;

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

      // Send welcome email (non-blocking)
      try {
        const { sendEmail } = await import('../services/mailer');
        const panelName = (await import('../db').then(m => m.prisma.themeSettings.findUnique({ where: { id: 'default' } })))?.panelName || process.env.APP_NAME || 'Catalyst';
        await sendEmail({
          to: email,
          subject: `Welcome to ${panelName}`,
          html: `<p>Welcome to ${panelName}, ${username}!</p><p>Your account has been created successfully.</p><p>You can now log in and start managing your servers.</p>`,
          text: `Welcome to ${panelName}, ${username}! Your account has been created successfully.`,
        });
      } catch (emailErr) {
        // Log but don't fail registration
        console.error('Failed to send welcome email:', emailErr);
      }

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
      // Validate login fields using the pre-built schema
      const loginValidation = userLoginSchema.safeParse(request.body);
      if (!loginValidation.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: loginValidation.error.issues.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      const { email, password } = loginValidation.data;
      const normalizedEmail = email;

      // Always check brute-force protection before any user lookup to prevent
      // email enumeration via timing differences and to rate-limit unknown emails.
      await bruteForceProtection(prisma, normalizedEmail, request);

      // Resolve the actual email (case-insensitive lookup)
      const userRecord = await prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      });

      if (!userRecord) {
        // Perform a constant-time dummy hash so the response latency is
        // indistinguishable from a real password check.  This closes the
        // timing side-channel that would otherwise let an attacker enumerate
        // valid accounts.
        try {
          const crypto = await import('crypto');
          crypto.scryptSync(password, 'dummy-salt-no-account', 64);
        } catch { /* swallow – only purpose is to burn CPU time */ }

        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers["user-agent"]);
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      try {

        const response = await auth.api.signInEmail({
          headers: getHeaders(request),
          body: {
            email: userRecord.email,
            password,
            rememberMe: loginValidation.data.rememberMe,
          },
          returnHeaders: true,
        });

        const data = extractResponseData(response);

        // 2FA redirect
        if (data?.twoFactorRedirect) {
          await logAuthAttempt(normalizedEmail, true, request.ip, request.headers["user-agent"]);
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

        // Handle successful login - reset failed attempts
        await handleSuccessfulLogin(prisma, user.id);
        await logAuthAttempt(normalizedEmail, true, request.ip, request.headers["user-agent"]);

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
        // Handle failed login - increment counter and apply lockout
        await handleFailedLogin(prisma, request);
        await logAuthAttempt(normalizedEmail, false, request.ip, request.headers["user-agent"]);

        // Always return the same generic error regardless of failure reason.
        // Returning 423 "Account locked" or any specific message would let an
        // attacker confirm the account exists.  The brute-force lockout still
        // works server-side — we just don't tell the caller about it.
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
          roles: { select: { name: true, permissions: true } },
        },
      });

      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }

      reply.send({
        success: true,
        data: {
          id: user.id, email: user.email, username: user.username,
          role: user.roles[0]?.name || 'user',
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
      // Validate password change using the pre-built schema
      const changeValidation = passwordChangeSchema.safeParse(request.body);
      if (!changeValidation.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: changeValidation.error.issues.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }
      const { currentPassword, newPassword, revokeOtherSessions } = changeValidation.data;

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

      // Validate password complexity
      const passwordValidation = passwordSchema.safeParse(password);
      if (!passwordValidation.success) {
        return reply.status(400).send({
          error: 'Password does not meet requirements',
          details: passwordValidation.error.issues.map(err => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        });
      }

      try {
        await auth.api.resetPassword({
          body: { token, newPassword: password },
        });
        reply.send({ success: true, message: "Password has been reset successfully" });
      } catch (error: any) {
        // Sanitize error message — never forward better-auth internals to the
        // client as they may reveal whether a token maps to a real account.
        app.log.warn({ error: error?.message }, "Password reset failed");
        reply.status(400).send({ error: "Failed to reset password. The link may be invalid or expired." });
      }
    }
  );
}
