import { createAuthClient } from 'better-auth/client';
import {
  inferAdditionalFields,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

const envBaseURL = import.meta.env.VITE_BETTER_AUTH_URL || import.meta.env.VITE_API_URL || '';
const baseURL = import.meta.env.DEV ? '' : envBaseURL || (typeof window !== 'undefined' ? window.location.origin : '');

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
  credentials: 'include',
  plugins: [
    twoFactorClient(),
    passkeyClient(),
    // better-auth 1.7: generic OAuth endpoints (/sign-in/oauth2, /oauth2/link)
    // are core client actions; genericOAuthClient was removed upstream.
    inferAdditionalFields({
      user: {
        username: {
          type: 'string',
          required: true,
        },
      },
    }),
  ],
});
