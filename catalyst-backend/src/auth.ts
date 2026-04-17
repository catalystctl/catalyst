import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, bearer, twoFactor, jwt as jwtPlugin, genericOAuth, createAccessControl } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prisma } from "./db";

const baseUrl = process.env.BETTER_AUTH_URL || process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000";
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

// The passkey plugin pulls in @simplewebauthn/server internal types that TypeScript
// cannot name when inferring the return type of betterAuth(). Using satisfies to
// capture the full inferred type without requiring portable type names.
export type AuthInstance = ReturnType<typeof betterAuth>;

/**
 * Mutable auth instance — null until initAuth() is called.
 * ES module `import { auth }` creates a live binding, so all consumers
 * see the value set by initAuth().
 */
export let auth: AuthInstance = null as unknown as AuthInstance;

/**
 * Initialize the auth instance. Must be called after OIDC env vars have
 * been bootstrapped from the database (in index.ts startup).
 */
export function initAuth() {
  auth = betterAuth({
    appName: process.env.APP_NAME || "Catalyst",
    baseURL: baseUrl,
    secret: authSecret as string,
    user: {
      additionalFields: {
        username: { type: "string", required: true, unique: true },
      },
    },
    session: {
      additionalFields: {
        // Note: ipAddress and userAgent are built-in session fields in better-auth.
        // Defining them here would cause Prisma migration conflicts.
        csrfToken: { type: "string", required: false },
      },
      cookieCache: {
        enabled: false,
        maxAge: 5 * 60, // 5 minutes (better-auth uses seconds, not milliseconds)
      },
      cookie: {
        attributes: {
          sameSite: 'Strict',
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          path: '/',
        }
      }
    },
    trustedOrigins: [
      baseUrl,
      process.env.FRONTEND_URL,
      ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : []),
      ...(process.env.NODE_ENV !== 'production'
        ? ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"]
        : []),
    ].filter((origin): origin is string => Boolean(origin)),
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        const { sendEmail } = await import("./services/mailer");
        const panelName = (await prisma.themeSettings.findUnique({ where: { id: 'default' } }))?.panelName || process.env.APP_NAME || 'Catalyst';
        const content = {
          subject: `Reset your ${panelName} password`,
          html: `<p>Hello ${user.name},</p><p>Reset your password: <a href="${url}">${url}</a></p>`,
          text: `Reset your password: ${url}`,
        };
        await sendEmail({ to: user.email, ...content });
      },
      sendVerificationEmail: async ({ user, url }) => {
        const { sendEmail } = await import("./services/mailer");
        const panelName = (await prisma.themeSettings.findUnique({ where: { id: 'default' } }))?.panelName || process.env.APP_NAME || 'Catalyst';
        await sendEmail({
          to: user.email,
          subject: `Verify your ${panelName} email`,
          html: `<p>Hello ${user.name},</p><p>Please verify your email address by clicking the link below:</p><p><a href="${url}">${url}</a></p>`,
          text: `Verify your email: ${url}`,
        });
      },
      // autoSignIn defaults to true.  The custom /register route pre-checks
      // for duplicate emails/usernames (returns 409) before calling signUpEmail,
      // so email enumeration via the frontend is already prevented.
      // Setting autoSignIn to false would prevent session creation on register.
    },
    plugins: [
      bearer({
        requireSignature: true,
      }),
      twoFactor({
        issuer: process.env.APP_NAME || "Catalyst",
        // skipVerificationOnEnable intentionally omitted — requiring TOTP
        // verification during enrollment ensures the user can actually generate
        // valid codes before 2FA is activated (prevents lockout).
      }),
      jwtPlugin(),
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
        origin: [
          baseUrl,
          process.env.FRONTEND_URL,
          ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : []),
          ...(process.env.NODE_ENV !== 'production'
            ? ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"]
            : []),
        ].filter((origin): origin is string => Boolean(origin)),
        rpID: process.env.PASSKEY_RP_ID || undefined,
        advanced: {
          webAuthnChallengeCookie: "better-auth-passkey",
        },
      }),
      genericOAuth({
        config: buildOAuthConfig(),
      }),
    ],
  }) as AuthInstance;
}
