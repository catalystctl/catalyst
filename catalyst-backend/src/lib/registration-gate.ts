/**
 * Open self-registration gate helpers.
 *
 * Public /register and better-auth /sign-up/email are blocked when
 * security.registrationEnabled is false. Admin-created users and
 * invite-based registration still call signUpEmail internally — wrap those
 * call sites with withRegistrationBypass so the before-hook allows them.
 */

let bypassDepth = 0;

export function isRegistrationBypassed(): boolean {
  return bypassDepth > 0;
}

export async function withRegistrationBypass<T>(fn: () => Promise<T>): Promise<T> {
  bypassDepth += 1;
  try {
    return await fn();
  } finally {
    bypassDepth -= 1;
  }
}
