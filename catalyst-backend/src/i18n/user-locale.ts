import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';
import { DEFAULT_LOCALE, resolveUserLocale, type SupportedLocale } from './locales.js';

/** Just the slice of the client these lookups need, so callers can inject theirs. */
type UserLookup = Pick<PrismaClient, 'user'>;

/**
 * Locale of the user a server-rendered message is addressed to (emails,
 * alerts). Unknown recipients (invite addresses that do not have an account
 * yet) and users without a saved preference fall back to the default locale.
 */
export async function localeForEmail(email: string, db: UserLookup = prisma): Promise<SupportedLocale> {
  const user = await db.user.findUnique({
    where: { email },
    select: { preferences: true },
  });
  return user ? resolveUserLocale(user.preferences) : DEFAULT_LOCALE;
}

/** Locale of a user by id; falls back to the default locale when unknown. */
export async function localeForUser(userId: string, db: UserLookup = prisma): Promise<SupportedLocale> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  return user ? resolveUserLocale(user.preferences) : DEFAULT_LOCALE;
}
