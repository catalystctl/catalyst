import type { PrismaClient } from '@prisma/client';
import type { PluginCollectionAPI, PluginCollectionOptions } from '../types';
import { captureSystemError } from '../../services/error-logger';
import { randomBytes } from 'crypto';
import { matchFilter, applyUpdateOperators } from '../path-utils';

function generateId(): string {
  return Date.now().toString(36) + randomBytes(4).toString('hex');
}

/**
 * Collection storage backed by the PluginCollectionItem table.
 * Each document is a separate row, allowing indexing, pagination, and transactions.
 */
export class CollectionStorage implements PluginCollectionAPI {
  constructor(
    private prisma: PrismaClient,
    private pluginName: string,
    private collectionName: string,
  ) {}

  private get table() {
    return this.prisma.pluginCollectionItem;
  }

  async find(filter?: any, options?: PluginCollectionOptions): Promise<any[]> {
    const where: any = {
      pluginName: this.pluginName,
      collectionName: this.collectionName,
    };

    if (filter) {
      const translated = this.translateFilter(filter);
      if (translated.length > 0) {
        where.AND = translated;
      }
    }

    const orderBy: any = options?.sort
      ? Object.entries(options.sort).map(([field, dir]) => ({
          ...(field === 'createdAt' || field === 'updatedAt' || field === 'docId'
            ? { [field === 'createdAt' ? 'createdAt' : field === 'updatedAt' ? 'updatedAt' : 'docId']: dir === 1 ? 'asc' : 'desc' }
            : {}),
        })).filter(o => Object.keys(o).length > 0)
      : [{ createdAt: 'desc' as const }];

    const items = await this.table.findMany({
      where,
      orderBy: orderBy.length > 0 ? orderBy : [{ createdAt: 'desc' }],
      skip: options?.skip,
      take: options?.limit,
    });

    let docs = items.map(i => ({
      _id: i.docId,
      ...(i.document as any),
      _createdAt: i.createdAt.toISOString(),
      _updatedAt: i.updatedAt.toISOString(),
    }));

    if (options?.sort) {
      for (const [sortField, sortOrder] of Object.entries(options.sort)) {
        if (sortField !== 'createdAt' && sortField !== 'updatedAt' && sortField !== 'docId') {
          docs.sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];
            if ((aVal === null || aVal === undefined) && (bVal === null || bVal === undefined)) return 0;
            if (aVal === null || aVal === undefined) return sortOrder;
            if (bVal === null || bVal === undefined) return -sortOrder;
            return aVal < bVal ? -sortOrder : aVal > bVal ? sortOrder : 0;
          });
        }
      }
    }

    if (filter && this.needsClientSideFilter(filter)) {
      docs = docs.filter(d => this.matchFilter(d, filter));
    }

    if (options?.projection) {
      docs = docs.map(d => {
        const projected: any = { _id: d._id };
        for (const [field, include] of Object.entries(options.projection!)) {
          if (include && d[field] !== undefined) {
            projected[field] = d[field];
          }
        }
        return projected;
      });
    }

    return docs;
  }

  async findOne(filter: any): Promise<any | null> {
    const results = await this.find(filter, { limit: 1 });
    return results[0] || null;
  }

  async insert(doc: any): Promise<any> {
    const docId = generateId();
    const { _id, _createdAt, _updatedAt, ...document } = doc;

    const item = await this.table.create({
      data: {
        pluginName: this.pluginName,
        collectionName: this.collectionName,
        docId,
        document: document as any,
      },
    });

    return {
      _id: item.docId,
      ...(item.document as any),
      _createdAt: item.createdAt.toISOString(),
      _updatedAt: item.updatedAt.toISOString(),
    };
  }

  async update(filter: any, updateData: any): Promise<number> {
    const docs = await this.find(filter);
    let count = 0;

    for (const doc of docs) {
      const { _id } = doc;
      const updated = { ...doc };
      applyUpdateOperators(updated, updateData);

      const { _id: _i, _createdAt, _updatedAt, ...document } = updated;

      await this.table.updateMany({
        where: {
          pluginName: this.pluginName,
          collectionName: this.collectionName,
          docId: _id,
        },
        data: {
          document: document as any,
        },
      });
      count++;
    }

    return count;
  }

  async delete(filter: any): Promise<number> {
    const docs = await this.find(filter);
    if (docs.length === 0) return 0;

    const docIds = docs.map(d => d._id);
    const result = await this.table.deleteMany({
      where: {
        pluginName: this.pluginName,
        collectionName: this.collectionName,
        docId: { in: docIds },
      },
    });

    return result.count;
  }

  async count(filter?: any): Promise<number> {
    if (!filter) {
      return this.table.count({
        where: {
          pluginName: this.pluginName,
          collectionName: this.collectionName,
        },
      });
    }

    const docs = await this.find(filter);
    return docs.length;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Push simple equality / $in / $eq filters down to Postgres JSONB so find()
   * does not always full-scan the collection client-side.
   * Returns Prisma `AND` conditions (array). Complex ops fall through to
   * needsClientSideFilter + matchFilter.
   */
  private translateFilter(filter: any): any[] {
    const conditions: any[] = [];
    if (!filter || typeof filter !== 'object') return conditions;

    for (const [key, value] of Object.entries(filter)) {
      if (key === '$or' || key === '$and') continue;

      // docId is a first-class column
      if (key === '_id' || key === 'docId') {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          const op = value as Record<string, any>;
          if (op.$eq !== undefined && this.isJsonScalar(op.$eq)) {
            conditions.push({ docId: String(op.$eq) });
          } else if (Array.isArray(op.$in) && op.$in.every((v) => this.isJsonScalar(v))) {
            conditions.push({ docId: { in: op.$in.map(String) } });
          }
          continue;
        }
        if (this.isJsonScalar(value)) {
          conditions.push({ docId: String(value) });
        }
        continue;
      }

      // Equality on a JSON document field: document->>'key' = value
      if (this.isJsonScalar(value)) {
        conditions.push({
          document: { path: [key], equals: value as string | number | boolean },
        });
        continue;
      }

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const op = value as Record<string, any>;
        if (op.$eq !== undefined && this.isJsonScalar(op.$eq)) {
          conditions.push({
            document: { path: [key], equals: op.$eq as string | number | boolean },
          });
        } else if (Array.isArray(op.$in) && op.$in.every((v) => this.isJsonScalar(v))) {
          conditions.push({
            OR: op.$in.map((v: string | number | boolean) => ({
              document: { path: [key], equals: v },
            })),
          });
        }
        // $ne/$gt/$regex/etc. stay client-side
      }
    }
    return conditions;
  }

  private isJsonScalar(value: unknown): value is string | number | boolean {
    const t = typeof value;
    return t === 'string' || t === 'number' || t === 'boolean';
  }

  private needsClientSideFilter(filter: any): boolean {
    if (!filter) return false;
    for (const key of Object.keys(filter)) {
      if (key === '$or' || key === '$and') return true;
      const value = filter[key];
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const op = value as Record<string, any>;
        // $eq / $in on scalars are pushed down — no client filter needed for those alone
        const keys = Object.keys(op);
        const onlyPushdown =
          keys.length > 0 &&
          keys.every(
            (k) =>
              (k === '$eq' && this.isJsonScalar(op.$eq)) ||
              (k === '$in' && Array.isArray(op.$in) && op.$in.every((v: unknown) => this.isJsonScalar(v))),
          );
        if (onlyPushdown) continue;
        return true;
      }
    }
    return false;
  }

  private matchFilter(doc: any, filter: any): boolean {
    return matchFilter(doc, filter);
  }
}

/**
 * Factory for creating collection storage instances.
 */
export function createCollectionStorage(
  prisma: PrismaClient,
  pluginName: string,
): (name: string) => PluginCollectionAPI {
  return (name: string) => {
    return new CollectionStorage(prisma, pluginName, name);
  };
}
