import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, bearer, twoFactor, jwt as jwtPlugin, genericOAuth, createAccessControl } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prisma } from "./db";
import { captureSystemError } from "./services/error-logger";

const baseUrl = process.env.BETTER_AUTH_URL || process.env.PUBLIC_URL || process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000";
const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret && process.env.NODE_ENV !== "test") {
  throw new Error("BETTER_AUTH_SECRET is required");
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
          secure: process.env.NODE_ENV !== 'development' && process.env.COOKIE_SECURE !== 'false',
          httpOnly: true,
          path: '/',
        }
      }
    },
    trustedOrigins: buildTrustedOrigins(),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
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
