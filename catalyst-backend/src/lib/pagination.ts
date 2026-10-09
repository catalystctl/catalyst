/**
 * Standardized pagination utilities for Catalyst API.
 *
 * All list endpoints should follow this pattern:
 * - Query params: `page` (default 1) and `limit` (default 50, max 100)
 * - For nested relations: `relationPage` and `relationLimit` (same defaults/caps)
 * - Response includes: `pagination: { page, limit, total, totalPages }` (optional key if not paginated)
 * - Responses always wrapped with serialize() to handle BigInt and _count serialization
 *
 * Usage:
 *   const { pageNumber, pageSize, skip } = parsePaginationParams(request);
 *   const [items, total] = await Promise.all([
 *     prisma.model.findMany({ where, skip, take: pageSize }),
 *     prisma.model.count({ where }),
 *   ]);
 *   reply.send(serialize({
 *     items,
 *     pagination: buildPaginationMeta(pageNumber, pageSize, total),
 *   }));
 */

export interface PaginationParams {
  pageNumber: number;
  pageSize: number;
  skip: number;
  paginated: boolean;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Parse pagination query parameters with standard defaults and caps.
 * @param page Query param 'page', defaults to 1
 * @param limit Query param 'limit', defaults to 50, max 100
 * @returns Pagination object with skip offset for Prisma take/skip
 */
export function parsePaginationParams(
  page?: string | number,
  limit?: string | number
): PaginationParams {
  const paginated = page !== undefined || limit !== undefined;
  const pageNumber = Math.max(1, Number(page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(limit ?? 50) || 50));
  const skip = (pageNumber - 1) * pageSize;

  return { pageNumber, pageSize, skip, paginated };
}

/**
 * Parse pagination for nested relations (e.g. role users, server grants).
 * Uses relationPage/relationLimit query params to avoid collision with top-level pagination.
 * @param relationPage Query param 'relationPage', defaults to 1
 * @param relationLimit Query param 'relationLimit', defaults to 50, max 100
 * @returns Pagination object with skip offset for Prisma take/skip
 */
export function parseNestedPaginationParams(
  relationPage?: string | number,
  relationLimit?: string | number
): PaginationParams {
  const paginated = relationPage !== undefined || relationLimit !== undefined;
  const pageNumber = Math.max(1, Number(relationPage ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(relationLimit ?? 50) || 50));
  const skip = (pageNumber - 1) * pageSize;

  return { pageNumber, pageSize, skip, paginated };
}

/**
 * Build standardized pagination metadata for response.
 * Include this in the response only when pagination was requested.
 * @param pageNumber Current page (1-indexed)
 * @param pageSize Items per page (items returned in this response)
 * @param total Total items in result set
 * @returns Pagination metadata object
 */
export function buildPaginationMeta(
  pageNumber: number,
  pageSize: number,
  total: number
): PaginationMeta {
  return {
    page: pageNumber,
    limit: pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
