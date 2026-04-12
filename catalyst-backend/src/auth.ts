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

// The passkey plugin pulls in @simplewebauthn/server internal types that TypeScript
// cannot name when inferring the return type of betterAuth(). Using satisfies to
// capture the full inferred type without requiring portable type names.
const _auth = betterAuth({
  appName: "Catalyst",
  baseURL: baseUrl,
  secret: authSecret as string,
  user: {
    additionalFields: {
      username: { type: "string", required: true, unique: true },
    },
  },
  session: {
    additionalFields: {
      ipAddress: { type: "string", required: false },
      userAgent: { type: "string", required: false },
      csrfToken: { type: "string", required: false },
    },
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60 * 1000, // 5 minutes
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
      const content = {
        subject: "Reset your Catalyst password",
        html: `<p>Hello ${user.name},</p><p>Reset your password: <a href="${url}">${url}</a></p>`,
        text: `Reset your password: ${url}`,
      };
      await sendEmail({ to: user.email, ...content });
    },
    sendVerificationEmail: async ({ user, url }) => {
      const { sendEmail } = await import("./services/mailer");
      await sendEmail({
        to: user.email,
        subject: "Verify your Catalyst email",
        html: `<p>Hello ${user.name},</p><p>Please verify your email address by clicking the link below:</p><p><a href="${url}">${url}</a></p>`,
        text: `Verify your email: ${url}`,
      });
    },
    autoSignIn: false,
  },
  plugins: [
    bearer({
      requireSignature: true,
    }),
    twoFactor({
      issuer: "Catalyst",
      skipVerificationOnEnable: true,
    }),
    jwtPlugin(),
    admin({
      roles: (() => {
        const base = createAccessControl({
          user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
          session: ["list", "revoke", "delete"],
        });
        return {
          administrator: base.newRole({
            user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
            session: ["list", "revoke", "delete"],
          }),
          user: base.newRole({
            user: [],
            session: [],
          }),
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
      config: [
        {
          providerId: "whmcs",
          clientId: process.env.WHMCS_OIDC_CLIENT_ID || "",
          clientSecret: process.env.WHMCS_OIDC_CLIENT_SECRET || "",
          discoveryUrl: process.env.WHMCS_OIDC_DISCOVERY_URL || "",
        },
        {
          providerId: "paymenter",
          clientId: process.env.PAYMENTER_OIDC_CLIENT_ID || "",
          clientSecret: process.env.PAYMENTER_OIDC_CLIENT_SECRET || "",
          discoveryUrl: process.env.PAYMENTER_OIDC_DISCOVERY_URL || "",
        },
      ].filter((provider) => provider.clientId && provider.clientSecret && provider.discoveryUrl),
    }),
  ],
});
export const auth = _auth;
