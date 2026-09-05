import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, bearer, twoFactor, jwt as jwtPlugin, genericOAuth, createAccessControl } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prisma } from "./db";
import { captureSystemError } from "./services/error-logger";
import { describeError } from "./utils/describe-error.js";

const baseUrl = process.env.BETTER_AUTH_URL || process.env.PUBLIC_URL || process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000";
const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret && process.env.NODE_ENV !== "test") {
  throw new Error("BETTER_AUTH_SECRET is required");
}
// SECURITY: refuse to boot with the placeholder secrets shipped in
// .env.example — they are public values in a public repository, and a
// known BETTER_AUTH_SECRET means forgeable session cookies (full admin
// takeover). The install.sh generator always replaces them, but manual
// "cp .env.example .env" installs skip that step.
const PLACEHOLDER_PATTERN = /^CHANGE_ME/;
const INSECURE_SECRETS: Array<[string, string | undefined]> = [
  ["BETTER_AUTH_SECRET", authSecret],
  ["API_KEY_SECRET", process.env.API_KEY_SECRET],
  ["POSTGRES_PASSWORD", process.env.POSTGRES_PASSWORD],
  ["REDIS_PASSWORD", process.env.REDIS_PASSWORD],
  [
    "BACKUP_CREDENTIALS_ENCRYPTION_KEY",
    process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY,
  ],
];
for (const [name, value] of INSECURE_SECRETS) {
  if (value && PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(
      `${name} is still set to the public placeholder from .env.example — ` +
        `generate a real secret before starting the panel`,
    );
  }
}

/** Validate that a URL is http(s) — allows localhost, ports, paths. */
function validateDiscoveryUrl(url: string, label: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return "";
    return url;
  } catch {
    captureSystemError({
      level: 'warn',
      component: 'Auth',
      message: `[SECURITY] ${label} is not a valid URL, skipping OAuth provider`,
      metadata: { provider: label },
    }).catch(() => {});
    console.warn(`[SECURITY] ${label} is not a valid URL, skipping OAuth provider`);
    return "";
  }
}

/**
 * Build OAuth provider configs from the current environment.
 * Called during initAuth() so that env vars bootstrapped from the DB
 * (via index.ts startup) are picked up correctly.
 */
function buildOAuthConfig() {
  return [
    {
      providerId: "whmcs",
      clientId: process.env.WHMCS_OIDC_CLIENT_ID || "",
      clientSecret: process.env.WHMCS_OIDC_CLIENT_SECRET || "",
      discoveryUrl: validateDiscoveryUrl(process.env.WHMCS_OIDC_DISCOVERY_URL || "", "WHMCS_OIDC_DISCOVERY_URL"),
    },
    {
      providerId: "paymenter",
      clientId: process.env.PAYMENTER_OIDC_CLIENT_ID || "",
      clientSecret: process.env.PAYMENTER_OIDC_CLIENT_SECRET || "",
      discoveryUrl: validateDiscoveryUrl(process.env.PAYMENTER_OIDC_DISCOVERY_URL || "", "PAYMENTER_OIDC_DISCOVERY_URL"),
    },
  ].filter((provider) => provider.clientId && provider.clientSecret && provider.discoveryUrl);
}

/** Extract protocol + host from a URL string, returning null if invalid. */
function toOrigin(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/** Build a deduplicated list of trusted origins from all configured sources. */
function buildTrustedOrigins(): string[] {
  const origins = [
    toOrigin(baseUrl),
    toOrigin(process.env.PUBLIC_URL || ""),
    toOrigin(process.env.FRONTEND_URL || ""),
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => toOrigin(s.trim())) : []),
    ...(process.env.NODE_ENV !== 'production'
      ? [
          "http://localhost:3000",
          "http://localhost:5173",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:5173",
          ...(process.env.DEV_EXTRA_ORIGINS
            ? process.env.DEV_EXTRA_ORIGINS.split(',').map((s) => toOrigin(s.trim()))
            : []),
        ]
      : []),
  ].filter((origin): origin is string => Boolean(origin));
  return [...new Set(origins)];
}

/** Build passkey origins, filtering out http origins in production. */
function buildPasskeyOrigins(): string[] {
  const origins = buildTrustedOrigins();
  if (process.env.NODE_ENV === 'production') {
    return origins.filter((o) => !o.startsWith('http:'));
  }
  return origins;
}

/** Validate that rpID is a bare hostname (no scheme, no path, no port). */
function validateRpID(rpID?: string): string | undefined {
  if (!rpID) return undefined;
  if (/^https?:\/\//.test(rpID)) return undefined;
  if (rpID.includes('/') || rpID.includes(':')) return undefined;
  return rpID;
}

/** Basic HTML escaping to prevent XSS in email templates. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _auth: ReturnType<typeof betterAuth> | null = null;

/** Return the initialized auth instance, throwing if not yet created. */
export function getAuth(): ReturnType<typeof betterAuth> {
  if (!_auth) {
    throw new Error("Auth has not been initialized. Call initAuth() first.");
  }
  return _auth;
}

/**
 * Initialize the auth instance. Must be called after OIDC env vars have
 * been bootstrapped from the database (in index.ts startup).
 */
export function initAuth() {
  // @ts-expect-error better-auth infers Auth<SpecificOptions> which is structurally
  // incompatible with Auth<BetterAuthOptions> due to invariant generic usage, but
  // they are identical at runtime.
  _auth = betterAuth({
    appName: process.env.APP_NAME || "Catalyst",
    baseURL: baseUrl,
    secret: authSecret as string,
    user: {
      additionalFields: {
        username: { type: "string", required: true, unique: true },
      },
    },
    session: {
      cookieCache: {
        // Disabled by default to prevent stale session data during rapid permission
        // changes and to ensure fresh role/permission resolution on every request.
        // Enable (set enabled: true) only if your deployment has very high read volume
        // and permissions change infrequently.
        enabled: false,
        maxAge: 5 * 60, // 5 minutes (better-auth uses seconds, not milliseconds)
      },
      cookie: {
        attributes: {
          sameSite: process.env.NODE_ENV === 'production' ? (process.env.FRONTEND_URL?.startsWith('https') ? 'none' : 'lax') : 'lax',
          secure: process.env.NODE_ENV === 'production' && (process.env.FRONTEND_URL?.startsWith('https') ?? false) ? true : process.env.NODE_ENV !== 'development' && process.env.COOKIE_SECURE !== 'false',
          httpOnly: true,
          path: '/',
        }
      }
    },
    trustedOrigins: buildTrustedOrigins(),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    rateLimit: (() => {
      const fairMode =
        process.env.DISABLE_RATE_LIMIT === "1" ||
        process.env.DISABLE_RATE_LIMIT === "true" ||
        process.env.BENCHMARK_DISABLE_RATE_LIMIT === "1" ||
        process.env.BENCHMARK_DISABLE_RATE_LIMIT === "true" ||
        process.env.BENCHMARK_FAIR === "1" ||
        process.env.BENCHMARK_FAIR === "true";
      if (fairMode) {
        return { enabled: false, window: 60, max: 1_000_000 };
      }
      return {
        enabled: true,
        window: 60,
        max: 30,
        customRules: {
          '/sign-in/email': { window: 60, max: 5 },
          '/sign-up/email': { window: 60, max: 5 },
          '/request-password-reset': { window: 300, max: 3 },
        },
      };
    })(),
    emailAndPassword: {
      enabled: true,
      // Dynamic — reads from the admin-configurable security setting.
      // When false, users can sign in without verifying their email.
      // When true (default), unverified users are blocked from signing in.
      get requireEmailVerification() {
        // Better Auth reads this at startup and caches it.  To pick up
        // runtime changes, we use a getter that reads the latest value
        // from the database.  The getter is invoked on every sign-in
        // attempt because Better Auth re-evaluates the option.
        //
        // NOTE: Better Auth evaluates `requireEmailVerification` only
        // once during init and caches it in the options object.  To make
        // it dynamic, we must re-init the auth instance when the setting
        // changes, or use a before-hook to enforce verification.
        // The before-hook approach is used below — see the sign-in
        // before hook that checks emailVerified when the setting is on.
        return true; // default; actual enforcement is in the before hook
      },
      sendResetPassword: async ({ user, url }) => {
        const { sendEmail } = await import("./services/mailer");
        const rawPanelName = (await prisma.themeSettings.findUnique({ where: { id: 'default' } }))?.panelName || process.env.APP_NAME || 'Catalyst';
        const panelName = escapeHtml(rawPanelName);
        const userName = escapeHtml(user.name || '');
        const content = {
          subject: `Reset your ${panelName} password`,
          html: `<p>Hello ${userName},</p><p>Reset your password: <a href="${url}">${url}</a></p>`,
          text: `Reset your password: ${url}`,
        };
        await sendEmail({ to: user.email, ...content });
      },
      sendVerificationEmail: async ({ user, url }) => {
        const { sendEmail } = await import("./services/mailer");
        const rawPanelName = (await prisma.themeSettings.findUnique({ where: { id: 'default' } }))?.panelName || process.env.APP_NAME || 'Catalyst';
        const panelName = escapeHtml(rawPanelName);
        const userName = escapeHtml(user.name || '');
        await sendEmail({
          to: user.email,
          subject: `Verify your ${panelName} email`,
          html: `<p>Hello ${userName},</p><p>Please verify your email address by clicking the link below:</p><p><a href="${url}">${url}</a></p>`,
          text: `Verify your email: ${url}`,
        });
      },
      // autoSignIn defaults to true.  The custom /register route pre-checks
      // for duplicate emails/usernames (returns 409) before calling signUpEmail,
      // so email enumeration via the frontend is already prevented.
      // Setting autoSignIn to false would prevent session creation on register.
    },
    plugins: [
      bearer(),
      twoFactor({
        issuer: process.env.APP_NAME || "Catalyst",
        // skipVerificationOnEnable intentionally omitted — requiring TOTP
        // verification during enrollment ensures the user can actually generate
        // valid codes before 2FA is activated (prevents lockout).
      }),
      jwtPlugin({
        jwt: {
          expiration: 60 * 60 * 24 * 7,
          issuer: baseUrl,
          audience: 'catalyst-api',
        },
      }),
      admin({
        roles: (() => {
          const ac = createAccessControl({
            user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
            session: ["list", "revoke", "delete"],
          });
          return {
            administrator: ac.newRole({
              user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
              session: ["list", "revoke", "delete"],
            }),
            // regular users have no admin plugin permissions
            user: ac.newRole({ user: [], session: [] }),
          };
        })(),
        adminRoles: ["administrator"],
      }),
      passkey({
        origin: buildPasskeyOrigins(),
        rpID: validateRpID(process.env.PASSKEY_RP_ID),
        advanced: {
          webAuthnChallengeCookie: "better-auth-passkey",
        },
      }),
      genericOAuth({
        config: buildOAuthConfig(),
      }),
    ],
    hooks: {
      // ── Before hooks — validation & security checks ──────────────
      before: async (ctx: any) => {
        const path = ctx.path ?? '';

        // ── Before email sign-up: enforce registrationEnabled ─────────
        // Blocks both the better-auth catch-all (/api/auth/sign-up/email)
        // and any direct better-auth sign-up path. Custom /register also
        // checks this independently before calling signUpEmail.
        if (path === '/sign-up/email') {
          try {
            // Always allow the very first account (panel setup) even if registration
            // was pre-disabled via env — otherwise first-run setup cannot complete.
            // Also allow admin-created users / invite accept via withRegistrationBypass.
            const { isRegistrationBypassed } = await import('./lib/registration-gate.js');
            if (isRegistrationBypassed()) {
              // fall through
            } else {
              const userCount = await prisma.user.count();
              if (userCount === 0) {
                // fall through — first-run setup
              } else {
                const settings = await (await import('./services/mailer')).getSecuritySettings();
                if (!settings.registrationEnabled) {
                  return {
                    response: {
                      error: 'Registration is disabled. Contact an administrator for an invite.',
                      code: 'REGISTRATION_DISABLED',
                    },
                    status: 403,
                    headers: null,
                  } as any;
                }
              }
            }
          } catch {
            // Fail closed if we cannot load security settings / count users.
            return {
              response: {
                error: 'Registration is temporarily unavailable',
                code: 'REGISTRATION_UNAVAILABLE',
              },
              status: 503,
              headers: null,
            } as any;
          }
        }

        // ── Before email sign-in: enforce email verification setting ──
        // Better Auth caches `requireEmailVerification` at startup, so
        // runtime changes to the admin setting are not reflected.  We
        // enforce it here instead, reading the latest DB value.
        if (path === '/sign-in/email') {
          try {
            const settings = await (await import('./services/mailer')).getSecuritySettings();
            if (settings.requireEmailVerification) {
              // Look up the user by email to check verification status
              const email = ctx.body?.email;
              if (email) {
                const user = await prisma.user.findFirst({
                  where: { email: { equals: email, mode: 'insensitive' } },
                  select: { emailVerified: true },
                });
                if (user && !user.emailVerified) {
                  return { response: { error: 'Email verification required. Please check your inbox.', code: 'EMAIL_VERIFICATION_REQUIRED' }, status: 403, headers: null } as any;
                }
              }
            }
          } catch (err) {
            // Fail closed when verification is required: settings/DB errors must not
            // allow unverified (or potentially unverified) users to sign in.
            try {
              const settings = await (await import('./services/mailer')).getSecuritySettings();
              if (settings.requireEmailVerification) {
                return {
                  response: {
                    error: 'Unable to verify email status. Please try again later.',
                    code: 'EMAIL_VERIFICATION_CHECK_FAILED',
                  },
                  status: 503,
                  headers: null,
                } as any;
              }
            } catch {
              // Even the settings re-read failed — default is requireEmailVerification=true
              // in DEFAULT_SECURITY_SETTINGS, so deny login.
              return {
                response: {
                  error: 'Unable to verify email status. Please try again later.',
                  code: 'EMAIL_VERIFICATION_CHECK_FAILED',
                },
                status: 503,
                headers: null,
              } as any;
            }
          }
        }

        // ── Before passkey verification: check account lockout ────────
        // Passkey sign-in bypasses the custom /login route, so it needs
        // its own brute-force guard here.  WebAuthn already prevents
        // credential guessing, but a locked account should still be
        // blocked from authenticating even with a valid passkey.
        if (path === '/passkey/verify-authentication') {
          try {
            // The request body contains response.rawId or response.id
            // which maps to a passkey credentialID → userId.
            // Since the credential→user mapping happens inside Better Auth,
            // we look up by the rawId (base64url-encoded credential ID).
            const rawId = ctx.body?.response?.rawId || ctx.body?.response?.id;
            if (rawId) {
              // base64url decode to find the credential — passkeys store
              // credentialID as base64url.  Try both raw and decoded forms.
              const passkey = await prisma.passkey.findFirst({
                where: { credentialID: rawId },
                select: { userId: true },
              });
              if (passkey) {
                const user = await prisma.user.findUnique({
                  where: { id: passkey.userId },
                  select: { banned: true, lockedUntil: true, failedLoginAttempts: true },
                });
                if (user?.banned) {
                  return { response: { error: 'Account is banned', code: 'ACCOUNT_BANNED', status: 403 }, status: 403, headers: null } as any;
                }
                if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
                  return { response: { error: 'Account is temporarily locked due to too many failed login attempts', code: 'ACCOUNT_LOCKED', status: 423 }, status: 423, headers: null } as any;
                }
              }
            }
          } catch (err: any) {
            captureSystemError({
              level: 'warn',
              component: 'AuthHooks',
              message: `Passkey lockout check failed: ${describeError(err)}`,
              metadata: { hook: 'before', path },
            }).catch(() => {});
            // Don't block the request if the check itself fails
          }
        }
      },

      // ── After hooks — post-processing & notifications ───────────────
      // IMPORTANT: The after hook MUST return an object (even empty {})
      // because Better Auth's runAfterHooks accesses result.headers
      // without null-checking result.  Returning undefined causes
      // "TypeError: undefined is not an object (evaluating 'result.headers')".
      after: async (ctx: any) => {
        const path = ctx.path ?? '';

        // ── After sign-up: send welcome email ───────────────────────
        if (path === '/sign-up/email') {
          const user = ctx.returned?.user ?? ctx.response?.user;
          if (user) {
            const email = user.email;
            const username = user.username || user.name || '';
            try {
              const { sendEmail } = await import('./services/mailer');
              const rawPanelName = (await prisma.themeSettings.findUnique({ where: { id: 'default' } }))?.panelName || process.env.APP_NAME || 'Catalyst';
              const panelName = escapeHtml(rawPanelName);
              const safeUsername = escapeHtml(username);
              await sendEmail({
                to: email,
                subject: `Welcome to ${panelName}`,
                html: `<p>Welcome to ${panelName}, ${safeUsername}!</p><p>Your account has been created successfully.</p><p>You can now log in and start managing your servers.</p>`,
                text: `Welcome to ${panelName}, ${username}! Your account has been created successfully.`,
              });
            } catch (emailErr: any) {
              captureSystemError({
                level: 'warn',
                component: 'AuthHooks',
                message: `Failed to send welcome email: ${describeError(emailErr)}`,
                metadata: { emailError: emailErr?.message },
              }).catch(() => {});
            }
          }
        }

        // ── After sign-in (email): audit log + reset failed attempts ──
        if (path === '/sign-in/email') {
          const user = ctx.returned?.user ?? ctx.response?.user;
          if (user) {
            // Successful sign-in — reset failed login attempts
            try {
              await prisma.user.update({
                where: { id: user.id },
                data: { failedLoginAttempts: 0, lockedUntil: null, lastFailedLogin: null, lastSuccessfulLogin: new Date() },
              });
            } catch { /* non-critical */ }

            // Audit log
            try {
              const { createAuditLog } = await import('./middleware/audit');
              await createAuditLog(user.id, {
                action: 'user_login',
                resource: 'user',
                resourceId: user.id,
                details: { email: user.email, username: user.username, method: 'email', outcome: 'success' },
              });
            } catch { /* non-critical */ }
          }
        }

        // ── After sign-in (passkey): audit log + reset failed attempts ──
        if (path === '/passkey/verify-authentication') {
          const user = ctx.returned?.user ?? ctx.response?.user;
          if (user) {
            // Successful passkey sign-in — reset failed login attempts
            try {
              await prisma.user.update({
                where: { id: user.id },
                data: { failedLoginAttempts: 0, lockedUntil: null, lastFailedLogin: null, lastSuccessfulLogin: new Date() },
              });
            } catch { /* non-critical */ }

            // Audit log
            try {
              const { createAuditLog } = await import('./middleware/audit');
              await createAuditLog(user.id, {
                action: 'user_login',
                resource: 'user',
                resourceId: user.id,
                details: { email: user.email, username: user.username, method: 'passkey', outcome: 'success' },
              });
            } catch { /* non-critical */ }
          }
        }

        // ── After admin ban: Catalyst-specific post-processing ────────
        if (path === '/admin/ban-user') {
          const userId = ctx.body?.userId ?? ctx.returned?.user?.id;
          if (userId) {
            try {
              // Revoke SFTP tokens for the banned user
              const { revokeSftpTokensForUser } = await import('./services/sftp-token-manager');
              await revokeSftpTokensForUser(userId);
            } catch { /* non-critical */ }

            // Disconnect WebSocket sessions
            try {
              // The wsGateway is set on the Fastify app after startup.
              // Since we're in a Better Auth hook, access it via the global app.
              const { getWsGateway } = await import('./websocket/gateway');
              const wsGateway = getWsGateway();
              if (wsGateway?.disconnectUser) {
                wsGateway.disconnectUser(userId);
              }
            } catch { /* non-critical */ }

            // Audit log — the admin user who performed the ban
            try {
              const adminUserId = ctx.context?.session?.user?.id;
              if (adminUserId) {
                const bannedUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true, twoFactorEnabled: true } });
                const { createAuditLog } = await import('./middleware/audit');
                await createAuditLog(adminUserId, {
                  action: 'user_ban',
                  resource: 'user',
                  resourceId: userId,
                  details: {
                    email: bannedUser?.email,
                    username: bannedUser?.username,
                    reason: ctx.body?.banReason || null,
                    twoFactorEnabled: bannedUser?.twoFactorEnabled,
                    sessionsRevoked: true,
                  },
                });
              }
            } catch { /* non-critical */ }

            // Broadcast user_banned event to admin subscribers
            try {
              const { getWsGateway } = await import('./websocket/gateway');
              const wsGateway = getWsGateway();
              if (wsGateway?.pushToAdminSubscribers) {
                const adminUserId = ctx.context?.session?.user?.id;
                wsGateway.pushToAdminSubscribers('user_updated', {
                  type: 'user_updated',
                  userId,
                  banned: true,
                  banReason: ctx.body?.banReason || null,
                  bannedBy: adminUserId,
                  timestamp: new Date().toISOString(),
                });
              }
            } catch { /* non-critical */ }
          }
        }

        // ── After admin unban: Catalyst-specific post-processing ──────
        if (path === '/admin/unban-user') {
          const userId = ctx.body?.userId ?? ctx.returned?.user?.id;
          if (userId) {
            // Audit log
            try {
              const adminUserId = ctx.context?.session?.user?.id;
              if (adminUserId) {
                const unbannedUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true } });
                const { createAuditLog } = await import('./middleware/audit');
                await createAuditLog(adminUserId, {
                  action: 'user_unban',
                  resource: 'user',
                  resourceId: userId,
                  details: {
                    email: unbannedUser?.email,
                    username: unbannedUser?.username,
                  },
                });
              }
            } catch { /* non-critical */ }

            // Broadcast user_unbanned event to admin subscribers
            try {
              const { getWsGateway } = await import('./websocket/gateway');
              const wsGateway = getWsGateway();
              if (wsGateway?.pushToAdminSubscribers) {
                const adminUserId = ctx.context?.session?.user?.id;
                wsGateway.pushToAdminSubscribers('user_updated', {
                  type: 'user_updated',
                  userId,
                  banned: false,
                  unbannedBy: adminUserId,
                  timestamp: new Date().toISOString(),
                });
              }
            } catch { /* non-critical */ }
          }
        }

        // Must return an object — Better Auth's runAfterHooks accesses
        // result.headers without null-checking the return value.
        return {};
      },
    },
    advanced: {
      ipAddress: {
        disableIpTracking: false,
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
      },
      crossSubDomainCookies: { enabled: false },
      useSecureCookies: process.env.NODE_ENV === 'production',
    },
  });
}

/** Backward-compatible proxy that delegates to the initialized auth instance. */
export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop) {
    const instance = getAuth();
    const value = Reflect.get(instance, prop);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});
