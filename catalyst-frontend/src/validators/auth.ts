import type { TFunction } from 'i18next';
import { z } from 'zod';

/**
 * Auth form schemas. Messages are resolved from the `validation` namespace,
 * so each schema is a factory built from the active `t` and memoized per
 * form render (see `useMemo(() => createLoginSchema(t), [t])`).
 */
export function createLoginSchema(t: TFunction<'validation'>) {
  return z.object({
    email: z
      .string()
      .email(t('VALIDATION_INVALID_FORMAT', { ns: 'validation', format: 'email' })),
    password: z.string().min(8, t('VALIDATION_TOO_SMALL', { ns: 'validation', min: 8 })),
    rememberMe: z.boolean().optional(),
    allowPasskeyFallback: z.boolean().optional(),
  });
}

export type LoginSchema = z.infer<ReturnType<typeof createLoginSchema>>;

export function createRegisterSchema(t: TFunction<'validation'>) {
  return z.object({
    email: z
      .string()
      .email(t('VALIDATION_INVALID_FORMAT', { ns: 'validation', format: 'email' })),
    password: z
      .string()
      .min(8, t('VALIDATION_TOO_SMALL', { ns: 'validation', min: 8 }))
      .max(128, t('VALIDATION_TOO_BIG', { ns: 'validation', max: 128 }))
      .regex(/[A-Z]/, t('password.uppercase', { ns: 'validation' }))
      .regex(/[a-z]/, t('password.lowercase', { ns: 'validation' }))
      .regex(/[0-9]/, t('password.number', { ns: 'validation' }))
      .regex(/[^A-Za-z0-9]/, t('password.special', { ns: 'validation' })),
    username: z.string().min(3, t('VALIDATION_TOO_SMALL', { ns: 'validation', min: 3 })),
  });
}

export type RegisterSchema = z.infer<ReturnType<typeof createRegisterSchema>>;
