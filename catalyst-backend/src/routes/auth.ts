import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { AuthInstance } from "../auth";
import { captureSystemError } from "../services/error-logger";
import { fromNodeHeaders } from "better-auth/node";
import { logAuthAttempt } from "../middleware/audit";
import { serialize } from '../utils/serialize';
import { revokeSftpTokensForUser } from '../services/sftp-token-manager';
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
  // Lazy accessor — ensures we always get the initialized auth instance
  // (initAuth() runs after routes are registered but before any requests arrive)
  const getAuth = () => (app as any).auth as AuthInstance;

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

      const response = await getAuth().api.signUpEmail({
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

      // Fetch role + profile fields from DB (same rationale as login).
      const profile = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          name: true, firstName: true, lastName: true, image: true,
          roles: { select: { name: true } },
        },
      });

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
      } catch (emailErr: any) {
        // Log but don't fail registration
        captureSystemError({
          level: 'warn',
          component: 'AuthRoutes',
          message: `Failed to send welcome email: ${emailErr?.message || String(emailErr)}`,
          stack: emailErr?.stack,
          metadata: { emailError: emailErr?.message || String(emailErr) },
        }).catch(() => {});
        console.error('Failed to send welcome email:', emailErr);
      }

      reply.send({
        success: true,
        data: {
          userId: user.id,
          email: user.email,
          username: user.username ?? username,
          name: profile?.name ?? null,
          firstName: profile?.firstName ?? null,
          lastName: profile?.lastName ?? null,
          image: profile?.image ?? null,
          role: profile?.roles[0]?.name || 'user',
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

        const response = await getAuth().api.signInEmail({
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

        // Fetch role + profile fields from DB.  better-auth's signInEmail
        // response only includes fields it manages (id, email, username, …);
        // custom Prisma fields like firstName, lastName, image, and the
        // role (from the roles table) are NOT included.
        const profile = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            name: true, firstName: true, lastName: true, image: true,
            roles: { select: { name: true } },
          },
        });

        reply.send({
          success: true,
          data: {
            userId: user.id,
            email: user.email,
            username: user.username ?? userRecord.username,
            name: profile?.name ?? null,
            firstName: profile?.firstName ?? null,
            lastName: profile?.lastName ?? null,
            image: profile?.image ?? null,
            role: profile?.roles[0]?.name || 'user',
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
          id: true, email: true, username: true, name: true, firstName: true, lastName: true,
          image: true, createdAt: true,
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
          name: user.name, firstName: user.firstName, lastName: user.lastName,
          image: user.image,
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
          id: true, email: true, username: true, name: true, firstName: true, lastName: true,
          image: true, emailVerified: true, twoFactorEnabled: true, createdAt: true,
          failedLoginAttempts: true, lastFailedLogin: true, lastSuccessfulLogin: true,
          preferences: true,
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
          name: userRecord.name, firstName: userRecord.firstName, lastName: userRecord.lastName,
          image: userRecord.image, emailVerified: userRecord.emailVerified,
          twoFactorEnabled: userRecord.twoFactorEnabled,
          hasPassword: userRecord.accounts.some((a) => a.providerId === "credential"),
          createdAt: userRecord.createdAt,
          failedLoginAttempts: userRecord.failedLoginAttempts,
          lastFailedLogin: userRecord.lastFailedLogin,
          lastSuccessfulLogin: userRecord.lastSuccessfulLogin,
          preferences: userRecord.preferences,
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

      const response = await getAuth().api.changePassword({
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

      const response = await getAuth().api.setPassword({
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
      const response = await (getAuth().api as any).enableTwoFactor({
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
      const response = await (getAuth().api as any).disableTwoFactor({
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
      const response = await (getAuth().api as any).generateBackupCodes({
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
      const response = await (getAuth().api as any).listPasskeys({
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
      const response = await (getAuth().api as any).generatePasskeyRegistrationOptions({
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
      const response = await (getAuth().api as any).verifyPasskeyRegistration({
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
      const response = await (getAuth().api as any).deletePasskey({
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
      const response = await (getAuth().api as any).updatePasskey({
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
      const accounts = await getAuth().api.listUserAccounts({
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
      const response = await (getAuth().api as any).oAuth2LinkAccount({
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
      const response = await getAuth().api.unlinkAccount({
        headers: getHeaders(request),
        body: { providerId, accountId },
      });
      reply.send(serialize({ success: true, data: response }));
    }
  );

  // ── List active sessions ──────────────────────────────────────────
  app.get(
    "/profile/sessions",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const sessions = await prisma.session.findMany({
        where: { userId: request.user.userId },
        select: {
          id: true, expiresAt: true, createdAt: true, updatedAt: true,
          ipAddress: true, userAgent: true, token: true,
        },
        orderBy: { updatedAt: 'desc' },
      });
      reply.send(serialize({ success: true, data: sessions }));
    }
  );

  // ── Revoke a specific session ────────────────────────────────────────
  app.delete(
    "/profile/sessions/:id",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const session = await prisma.session.findFirst({
        where: { id, userId: request.user.userId },
      });
      if (!session) {
        return reply.status(404).send({ success: false, error: 'Session not found' });
      }
      await prisma.session.delete({ where: { id } });
      reply.send({ success: true, message: 'Session revoked' });
    }
  );

  // ── Revoke all other sessions ───────────────────────────────────────
  app.delete(
    "/profile/sessions",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Get the current session token from cookie
      const cookieHeader = request.headers.cookie || '';
      const sessionMatch = cookieHeader.match(/better-auth\.session_token=([^;]+)/);
      const currentToken = sessionMatch?.[1];

      const result = await prisma.session.deleteMany({
        where: {
          userId: request.user.userId,
          ...(currentToken ? { token: { not: currentToken } } : {}),
        },
      });
      reply.send(serialize({ success: true, message: `Revoked ${result.count} session(s)`, revoked: result.count }));
    }
  );

  // ── Update profile ──────────────────────────────────────────────────
  app.patch(
    "/profile",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, firstName, lastName } = request.body as {
        username?: string; firstName?: string; lastName?: string;
      };

      // Build update payload
      const data: Record<string, string> = {};
      if (firstName !== undefined) data.firstName = firstName;
      if (lastName !== undefined) data.lastName = lastName;
      if (username !== undefined) {
        if (!username || username.length < 2 || username.length > 32) {
          return reply.status(400).send({ error: 'Username must be 2-32 characters' });
        }
        // Check uniqueness
        const existing = await prisma.user.findFirst({ where: { username, id: { not: request.user.userId } } });
        if (existing) {
          return reply.status(409).send({ error: 'Username already taken' });
        }
        data.username = username;
      }

      if (Object.keys(data).length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      const user = await prisma.user.update({
        where: { id: request.user.userId },
        data,
        select: { id: true, username: true, firstName: true, lastName: true },
      });

      reply.send(serialize({ success: true, data: user }));
    }
  );

  // ── Update user preferences ─────────────────────────────────────────
  app.patch(
    "/profile/preferences",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const prefs = request.body as Record<string, unknown>;
      if (!prefs || typeof prefs !== 'object') {
        return reply.status(400).send({ error: 'Invalid preferences' });
      }
      await prisma.user.update({
        where: { id: request.user.userId },
        data: { preferences: prefs as any },
      });
      reply.send(serialize({ success: true }));
    }
  );

  // ── Avatar upload ───────────────────────────────────────────────────
  app.post(
    "/profile/avatar",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
      if (!allowedTypes.includes(data.mimetype)) {
        return reply.status(400).send({ error: 'Only JPEG, PNG, GIF, WebP, and SVG images are allowed' });
      }

      // Validate file size (max 2MB)
      const MAX_SIZE = 2 * 1024 * 1024;
      const buffer = await data.toBuffer();
      if (buffer.length > MAX_SIZE) {
        return reply.status(400).send({ error: 'Image must be under 2MB' });
      }

      // Store as data URI in the user record
      const ext = data.mimetype.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
      const base64 = buffer.toString('base64');
      const dataUri = `data:${data.mimetype};base64,${base64}`;

      await prisma.user.update({
        where: { id: request.user.userId },
        data: { image: dataUri },
      });

      reply.send(serialize({ success: true, data: { image: dataUri } }));
    }
  );

  // ── Remove avatar ───────────────────────────────────────────────────
  app.delete(
    "/profile/avatar",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await prisma.user.update({
        where: { id: request.user.userId },
        data: { image: null },
      });
      reply.send(serialize({ success: true, message: 'Avatar removed' }));
    }
  );

  // ── Resend email verification ────────────────────────────────────────
  app.post(
    "/profile/resend-verification",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { email: true, emailVerified: true },
      });
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }
      if (user.emailVerified) {
        return reply.send(serialize({ success: true, message: 'Email already verified' }));
      }
      try {
        // Use better-auth's built-in verification email sender which generates
        // a signed token and includes the proper verification URL.
        await getAuth().api.sendVerificationEmail({
          headers: getHeaders(request),
          body: { email: user.email },
        });
      } catch (baErr: any) {
        // Fallback: if better-auth's method fails (e.g. misconfigured), send
        // a generic email instructing the user to try again from settings.
        try {
          const { sendEmail } = await import('../services/mailer');
          const panelName = (await import('../db').then(m => m.prisma.themeSettings.findUnique({ where: { id: 'default' } })))?.panelName || process.env.APP_NAME || 'Catalyst';
          await sendEmail({
            to: user.email,
            subject: `Verify your ${panelName} email`,
            html: `<p>Hello,</p><p>Please log out and back in, then check your account settings to request a new verification email.</p>`,
            text: `Verify your email for ${panelName}.`,
          });
        } catch {
          // Swallow — don't expose internal errors to the client
        }
      }
      reply.send(serialize({ success: true, message: 'Verification email sent' }));
    }
  );

  // ── Personal audit log ──────────────────────────────────────────────
  app.get(
    "/profile/audit-log",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { limit = 50, offset = 0 } = request.query as { limit?: string; offset?: string };
      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { userId: request.user.userId },
          orderBy: { timestamp: 'desc' },
          take: Math.min(Number(limit) || 50, 200),
          skip: Number(offset) || 0,
          select: { id: true, action: true, resource: true, resourceId: true, details: true, timestamp: true },
        }),
        prisma.auditLog.count({ where: { userId: request.user.userId } }),
      ]);
      reply.send(serialize({ success: true, data: { logs, total } }));
    }
  );

  // ── Export account data (GDPR) ──────────────────────────────────────
  app.get(
    "/profile/export",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const [user, sessions, accounts, apiKeys, auditLogs, serverAccess] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, username: true, name: true, firstName: true, lastName: true, image: true, createdAt: true, updatedAt: true },
        }),
        prisma.session.findMany({
          where: { userId },
          select: { id: true, createdAt: true, updatedAt: true, ipAddress: true, userAgent: true },
        }),
        prisma.account.findMany({
          where: { userId },
          select: { id: true, providerId: true, accountId: true, createdAt: true },
        }),
        prisma.apikey.findMany({
          where: { userId },
          select: { id: true, name: true, prefix: true, createdAt: true, lastRequest: true, requestCount: true, expiresAt: true },
        }),
        prisma.auditLog.findMany({
          where: { userId },
          orderBy: { timestamp: 'desc' },
          select: { id: true, action: true, resource: true, resourceId: true, details: true, timestamp: true },
          take: 500,
        }),
        prisma.serverAccess.findMany({
          where: { userId },
          select: { id: true, serverId: true, permissions: true, createdAt: true },
        }),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        user,
        sessions: sessions.map(s => ({ ...s, id: undefined })), // don't expose session IDs
        accounts,
        apiKeys: apiKeys.map(k => ({ ...k, id: undefined })),
        auditLogs,
        serverAccess,
      };

      reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', 'attachment; filename="catalyst-account-export.json"')
        .send(JSON.stringify(exportData, null, 2));
    }
  );

  // ── User's API keys overview ────────────────────────────────────────
  app.get(
    "/profile/api-keys",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const keys = await prisma.apikey.findMany({
        where: { userId: request.user.userId },
        select: {
          id: true, name: true, prefix: true, start: true, enabled: true,
          allPermissions: true, permissions: true,
          lastRequest: true, requestCount: true, expiresAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      reply.send(serialize({ success: true, data: keys }));
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
        await getAuth().api.requestPasswordReset({
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

  // ── Delete own account ─────────────────────────────────────────────
  // Users can delete their own account if they don't own any servers.
  // Sub-users (no servers) can delete freely.
  app.post(
    "/profile/delete",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user.userId;
      const { confirm } = request.body as { confirm?: string };

      if (confirm !== "DELETE") {
        return reply.status(400).send({
          error: 'Confirmation required. Send { "confirm": "DELETE" } to proceed.',
        });
      }

      // Check for owned servers
      const ownedServers = await prisma.server.findMany({
        where: { ownerId: userId },
        select: { id: true, name: true },
      });

      if (ownedServers.length > 0) {
        return reply.status(409).send({
          error: `You own ${ownedServers.length} server(s). Transfer or delete them before deleting your account.`,
          ownedServers: ownedServers.map((s) => ({ id: s.id, name: s.name })),
        });
      }

      // Revoke all SFTP tokens
      revokeSftpTokensForUser(userId);

      // Disconnect WebSocket sessions
      const wsGateway = (app as any).wsGateway;
      if (wsGateway?.disconnectUser) {
        wsGateway.disconnectUser(userId);
      }

      // Invalidate all sessions (better-auth)
      try {
        await getAuth().api.signOut({
          headers: getHeaders(request),
        });
      } catch {
        // Session may already be invalid
      }

      // Delete the user
      await prisma.user.delete({ where: { id: userId } });

      // Fire webhook
      const webhookService: any = (app as any).webhookService;
      if (webhookService) {
        webhookService.userDeleted(userId, "", "self-deleted", userId).catch(() => {});
      }

      // Clear session cookie
      reply.header("set-cookie", "better-auth.session_token=; Max-Age=0; Path=/; SameSite=Strict; HttpOnly");
      reply.send({ success: true, message: "Account deleted" });
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
        await getAuth().api.resetPassword({
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
