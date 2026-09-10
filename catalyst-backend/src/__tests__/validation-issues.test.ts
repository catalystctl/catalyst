import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodIssues } from '../lib/validation';

function codesFor(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected the schema to reject the value');
  return formatZodIssues(result.error.issues);
}

describe('formatZodIssues', () => {
  it('uses code and params the client can translate', () => {
    const [issue] = codesFor(z.object({ engine: z.enum(['java', 'bedrock']) }), { engine: 'rust' });
    expect(issue.field).toBe('engine');
    expect(issue.code).toBe('VALIDATION_INVALID_VALUE');
    expect(typeof issue.message).toBe('string');
  });

  it('distinguishes string length from numeric bounds', () => {
    const [length] = codesFor(z.object({ password: z.string().min(8) }), { password: 'abc' });
    expect(length).toMatchObject({ field: 'password', code: 'VALIDATION_TOO_SHORT', params: { min: 8 } });

    const [lengthMax] = codesFor(z.object({ password: z.string().max(12) }), { password: 'abcdefghijklmnop' });
    expect(lengthMax).toMatchObject({ code: 'VALIDATION_TOO_LONG', params: { max: 12 } });

    // Numeric bounds must not be described in characters.
    const [bound] = codesFor(z.object({ memoryMb: z.number().min(512) }), { memoryMb: 256 });
    expect(bound).toMatchObject({ field: 'memoryMb', code: 'VALIDATION_TOO_SMALL', params: { min: 512 } });

    const [boundMax] = codesFor(z.object({ cpu: z.number().max(4) }), { cpu: 8 });
    expect(boundMax).toMatchObject({ code: 'VALIDATION_TOO_BIG', params: { max: 4 } });
  });

  it('keeps the field path for nested objects', () => {
    const issues = codesFor(
      z.object({ resources: z.object({ memoryMb: z.number().min(512) }) }),
      { resources: { memoryMb: 1 } },
    );
    expect(issues[0].field).toBe('resources.memoryMb');
  });
});
