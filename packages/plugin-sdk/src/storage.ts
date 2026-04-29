import type { PluginCollectionAPI, PluginCollectionOptions } from './types';

export interface TypedCollection<T> {
  find(filter?: any, options?: PluginCollectionOptions): Promise<T[]>;
  findOne(filter: any): Promise<T | null>;
  insert(doc: Omit<T, '_id' | '_createdAt' | '_updatedAt'>): Promise<T & { _id: string; _createdAt: string; _updatedAt: string }>;
  update(filter: any, update: any): Promise<number>;
  delete(filter: any): Promise<number>;
  count(filter?: any): Promise<number>;
}

export function createTypedCollection<T>(
  name: string,
  rawCollection: PluginCollectionAPI,
): TypedCollection<T> {
  return {
    async find(filter, options) {
      return rawCollection.find(filter, options) as Promise<T[]>;
    },
    async findOne(filter) {
      return rawCollection.findOne(filter) as Promise<T | null>;
    },
    async insert(doc) {
      return rawCollection.insert(doc) as Promise<any>;
    },
    async update(filter, update) {
      return rawCollection.update(filter, update);
    },
    async delete(filter) {
      return rawCollection.delete(filter);
    },
    async count(filter) {
      return rawCollection.count(filter);
    },
  };
}
