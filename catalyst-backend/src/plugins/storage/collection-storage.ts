import type { PrismaClient } from '@prisma/client';
import type { PluginCollectionAPI, PluginCollectionOptions } from '../types';
import { captureSystemError } from '../../services/error-logger';
import { randomBytes } from 'crypto';

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
      if (Object.keys(translated).length > 0) {
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
      let updated = { ...doc };

      if (updateData.$set) {
        Object.assign(updated, updateData.$set);
      }
      if (updateData.$unset) {
        for (const key of Object.keys(updateData.$unset)) {
          delete updated[key];
        }
      }
      if (updateData.$inc) {
        for (const [key, value] of Object.entries(updateData.$inc)) {
          updated[key] = (updated[key] || 0) + (value as number);
        }
      }
      if (updateData.$push) {
        for (const [key, value] of Object.entries(updateData.$push)) {
          if (!Array.isArray(updated[key])) updated[key] = [];
          updated[key].push(value);
        }
      }
      if (updateData.$pull) {
        for (const [key, value] of Object.entries(updateData.$pull)) {
          if (Array.isArray(updated[key])) {
            if (typeof value === 'object' && value !== null) {
              updated[key] = updated[key].filter((item: any) => !this.matchFilter(item, value));
            } else {
              updated[key] = updated[key].filter((item: any) => item !== value);
            }
          }
        }
      }

      if (!updateData.$set && !updateData.$unset && !updateData.$inc && !updateData.$push && !updateData.$pull) {
        Object.assign(updated, updateData);
      }

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

  private translateFilter(filter: any): any[] {
    const conditions: any[] = [];
    for (const [key, value] of Object.entries(filter)) {
      if (key === '$or' || key === '$and') continue;
      if (value !== null && typeof value === 'object' && !Array.isArray(value) && !('$regex' in value)) {
        continue;
      }
    }
    return conditions;
  }

  private needsClientSideFilter(filter: any): boolean {
    if (!filter) return false;
    for (const key of Object.keys(filter)) {
      if (key === '$or' || key === '$and') return true;
      const value = filter[key];
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return true;
      }
    }
    return false;
  }

  private matchFilter(doc: any, filter: any): boolean {
    if (!filter || typeof filter !== 'object') return true;

    for (const [key, value] of Object.entries(filter)) {
      if (key === '$or') {
        if (!Array.isArray(value) || !(value as any[]).some((sub) => this.matchFilter(doc, sub)))
          return false;
      } else if (key === '$and') {
        if (!Array.isArray(value) || !(value as any[]).every((sub) => this.matchFilter(doc, sub)))
          return false;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const op = value as Record<string, any>;
        const docValue = doc[key];
        if (op.$eq !== undefined && docValue !== op.$eq) return false;
        if (op.$ne !== undefined && docValue === op.$ne) return false;
        if (op.$gt !== undefined && !(docValue > op.$gt)) return false;
        if (op.$gte !== undefined && !(docValue >= op.$gte)) return false;
        if (op.$lt !== undefined && !(docValue < op.$lt)) return false;
        if (op.$lte !== undefined && !(docValue <= op.$lte)) return false;
        if (op.$in !== undefined && !Array.isArray(op.$in)) return false;
        if (op.$in !== undefined && !(op.$in as any[]).includes(docValue)) return false;
        if (op.$nin !== undefined && !Array.isArray(op.$nin)) return false;
        if (op.$nin !== undefined && (op.$nin as any[]).includes(docValue)) return false;
        if (op.$exists !== undefined) {
          const exists = docValue !== undefined && docValue !== null;
          if (op.$exists !== exists) return false;
        }
        if (op.$regex !== undefined) {
          const regex = typeof op.$regex === 'string' ? new RegExp(op.$regex, op.$flags || '') : op.$regex;
          if (!regex.test(String(docValue ?? ''))) return false;
        }
      } else {
        if (doc[key] !== value) return false;
      }
    }
    return true;
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
