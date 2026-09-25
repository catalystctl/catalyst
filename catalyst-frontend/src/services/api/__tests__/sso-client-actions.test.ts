/**
 * SSO client-action wiring — better-auth 1.7.
 *
 * Generic OAuth/OIDC providers (WHMCS/Paymenter) must go through the core
 * client actions `signIn.social` and `linkSocial`. The removed plugin
 * endpoints (`signIn.oauth2`, `oauth2.link`) silently 404 at runtime, so a
 * missing mock member fails this suite too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  signInSocial: vi.fn(),
  linkSocial: vi.fn(),
}));

vi.mock('../../authClient', () => ({
  authClient: {
    signIn: { social: mocks.signInSocial },
    linkSocial: mocks.linkSocial,
  },
}));

import { authApi } from '../auth';
import { profileApi } from '../profile';

describe('generic OAuth client actions', () => {
  beforeEach(() => {
    mocks.signInSocial.mockReset();
    mocks.linkSocial.mockReset();
  });

  it('signInWithProvider posts to the core sign-in.social action', async () => {
    mocks.signInSocial.mockResolvedValue({ data: {} });

    await authApi.signInWithProvider('whmcs');

    expect(mocks.signInSocial).toHaveBeenCalledWith({
      provider: 'whmcs',
      callbackURL: `${window.location.origin}/servers`,
    });
  });

  it('signInWithProvider rejects an unsafe provider redirect scheme', async () => {
    mocks.signInSocial.mockResolvedValue({
      data: { redirect: true, url: 'javascript:alert(1)' },
    });

    await expect(authApi.signInWithProvider('whmcs')).rejects.toThrow('Untrusted redirect URL');
  });

  it('linkSso posts to the core linkSocial action', async () => {
    mocks.linkSocial.mockResolvedValue({ data: {} });

    await profileApi.linkSso('paymenter');

    expect(mocks.linkSocial).toHaveBeenCalledWith({
      provider: 'paymenter',
      callbackURL: `${window.location.origin}/profile`,
    });
  });
});
