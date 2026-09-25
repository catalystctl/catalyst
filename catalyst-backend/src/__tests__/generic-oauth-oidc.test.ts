/**
 * Generic OIDC sign-in regression — better-auth 1.7.
 *
 * better-auth 1.6 exposed genericOAuth through plugin-specific endpoints
 * (/sign-in/oauth2, /oauth2/link). 1.7 removed both and routes generic
 * providers through the core endpoints (/sign-in/social, /link-social).
 * This test drives the exact provider config the app builds
 * (`buildOAuthConfig`) against an OIDC discovery document and asserts that
 * sign-in resolves to the discovered authorization endpoint.
 */
import 'dotenv/config';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { buildOAuthConfig } from '../auth';

const OIDC_ENV = {
  WHMCS_OIDC_CLIENT_ID: 'whmcs-client',
  WHMCS_OIDC_CLIENT_SECRET: 'whmcs-secret',
  WHMCS_OIDC_DISCOVERY_URL: 'https://idp.example.com/.well-known/openid-configuration',
} as const;

const DISCOVERY = {
  issuer: 'https://idp.example.com',
  authorization_endpoint: 'https://idp.example.com/authorize',
  token_endpoint: 'https://idp.example.com/token',
  userinfo_endpoint: 'https://idp.example.com/userinfo',
  jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
  id_token_signing_alg_values_supported: ['RS256'],
};

const savedEnv: Record<string, string | undefined> = {};

describe('generic OIDC sign-in (better-auth 1.7 core endpoints)', () => {
  beforeEach(() => {
    for (const key of Object.keys(OIDC_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = OIDC_ENV[key as keyof typeof OIDC_ENV];
    }
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(DISCOVERY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(OIDC_ENV)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('buildOAuthConfig keeps a fully configured OIDC provider', () => {
    const config = buildOAuthConfig();
    expect(config).toHaveLength(1);
    expect(config[0]).toMatchObject({
      providerId: 'whmcs',
      clientId: 'whmcs-client',
      discoveryUrl: OIDC_ENV.WHMCS_OIDC_DISCOVERY_URL,
    });
  });

  it('signIn.social resolves a generic provider to its discovered authorization URL', async () => {
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'vitest-generic-oidc-secret',
      database: memoryAdapter({}),
      plugins: [genericOAuth({ config: buildOAuthConfig() })],
    });

    const result = await auth.api.signInSocial({
      body: {
        provider: 'whmcs',
        callbackURL: 'http://localhost:5173/servers',
      },
    });

    expect(result.redirect).toBe(true);
    const url = new URL(result.url!);
    expect(`${url.origin}${url.pathname}`).toBe(DISCOVERY.authorization_endpoint);
    expect(url.searchParams.get('client_id')).toBe('whmcs-client');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
