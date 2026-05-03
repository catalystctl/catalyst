/**
 * Serialize Prisma responses for Fastify v5
 * Fixes serialization issues with BigInt, _count, and nested relations
 */
export function serialize<T>(data: T): any {
  return JSON.parse(
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ),
    (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    }
  );
}
