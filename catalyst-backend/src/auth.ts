import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, bearer, twoFactor, jwt as jwtPlugin, genericOAuth, createAccessControl, apiKey } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { prisma } from "./db";

const baseUrl = process.env.BETTER_AUTH_URL || process.env.BACKEND_EXTERNAL_ADDRESS || "http://localhost:3000";
const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret && process.env.NODE_ENV !== "test") {
  throw new Error("BETTER_AUTH_SECRET is required");
}

export const auth = betterAuth({
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
    process.env.CORS_ORIGIN, 
    ...(process.env.NODE_ENV !== 'production' ? ["http://localhost:5173"] : []),
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
    apiKey({
      defaultPrefix: "catalyst_",
      enableSessionForAPIKeys: true, // Auto-create session from API key
      apiKeyHeaders: ["x-api-key", "authorization"], // Support both headers
      enableMetadata: true, // Allow storing nodeId in metadata
      rateLimit: {
        enabled: true,
        maxRequests: 100,
        timeWindow: 60000, // 1 minute
      },
    }),
    admin({
      roles: (() => {
        const base = createAccessControl({
          user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
          session: ["list", "revoke", "delete"],
        });
        return {
          admin: base.newRole({
            user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
            session: ["list", "revoke", "delete"],
          }),
          user: base.newRole({
            user: [],
            session: [],
          }),
          administrator: base.newRole({
            user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
            session: ["list", "revoke", "delete"],
          }),
        };
      })(),
      adminRoles: ["administrator"],
    }),
    passkey({
      origin: [
        baseUrl,
        process.env.FRONTEND_URL, 
        process.env.CORS_ORIGIN, 
        ...(process.env.NODE_ENV !== 'production' ? ["http://localhost:5173"] : []),
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
