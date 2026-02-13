import { createAuthClient } from 'better-auth/client';
import {
  genericOAuthClient,
  inferAdditionalFields,
  twoFactorClient,
  usernameClient,
} from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

const envBaseURL = import.meta.env.VITE_BETTER_AUTH_URL || import.meta.env.VITE_API_URL || '';
const baseURL = import.meta.env.DEV ? '' : envBaseURL || (typeof window !== 'undefined' ? window.location.origin : '');

console.log('[authClient] Initializing with baseURL:', baseURL, 'DEV:', import.meta.env.DEV);

export const authClient = createAuthClient({
  baseURL,
  basePath: '/api/auth',
  credentials: 'include',
  plugins: [
    twoFactorClient(),
    passkeyClient(),
    genericOAuthClient(),
    usernameClient(),
    inferAdditionalFields({
      user: {
        fields: {
          username: { type: 'string', required: true },
        },
      },
    }),
  ],
});

console.log('[authClient] authClient.signIn.email:', typeof authClient.signIn?.email);
