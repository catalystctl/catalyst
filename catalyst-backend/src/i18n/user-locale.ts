import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';
import { readUserLocale, type SupportedLocale } from './locales.js';
import { getDefaultLocale } from '../services/localization.js';

/** Just the slice of the client these lookups need, so callers can inject theirs. */
type UserLookup = Pick<PrismaClient, 'user'>;

/**
 * Language for a server-rendered message (emails, alerts).
 *
 * A recipient's own choice wins; everyone else — including invite addresses
 * that do not have an account yet — gets the instance default the admin set.
 */
async function resolveRecipientLocale(preferences: unknown): Promise<SupportedLocale> {
  return readUserLocale(preferences) ?? (await getDefaultLocale());
}

/** Locale of the user a server-rendered message is addressed to. */
export async function localeForEmail(email: string, db: UserLookup = prisma): Promise<SupportedLocale> {
  const user = await db.user.findUnique({
    where: { email },
    select: { preferences: true },
  });
  return resolveRecipientLocale(user?.preferences);
}

/** Locale of a user by id. */
export async function localeForUser(userId: string, db: UserLookup = prisma): Promise<SupportedLocale> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  return resolveRecipientLocale(user?.preferences);
}
