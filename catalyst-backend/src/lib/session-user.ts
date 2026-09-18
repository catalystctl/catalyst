import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../db';
import { auth } from '../auth';
import { resolveUserPermissions } from './permissions-catalog';

export interface ResolvedSessionUser {
  userId: string;
  email: string;
  username: string;
  permissions: string[];
}

/**
 * Resolve the caller's session without replying — the non-failing half of the
 * `authenticate` middleware. Used by the plugin route dispatcher for routes
 * registered with `config.auth: 'optional'`: a valid session populates
 * `request.user`, an absent/invalid one is silently skipped (the plugin
 * handler decides what an anonymous caller may do).
 */
export async function resolveSessionUser(request: FastifyRequest): Promise<ResolvedSessionUser | null> {
  let session: { user: { id: string } } | null = null;
  try {
    session = (await auth.api.getSession({
      headers: fromNodeHeaders(
        request.headers as Record<string, string | string[] | undefined>,
      ),
    })) as { user: { id: string } } | null;
  } catch {
    return null;
  }
  if (!session?.user?.id) return null;

  try {
    const account = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, username: true, banned: true, lockedUntil: true },
    });
    if (!account || account.banned) return null;
    if (account.lockedUntil && account.lockedUntil > new Date()) return null;

    let permissions: string[] = [];
    try {
      permissions = await resolveUserPermissions(session.user.id);
    } catch {
      // Mirror authenticate: unknown permissions rather than failed auth.
      permissions = [];
    }

    return {
      userId: session.user.id,
      email: account.email,
      username: account.username,
      permissions,
    };
  } catch {
    return null;
  }
}
