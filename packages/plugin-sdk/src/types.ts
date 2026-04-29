// Re-exported types from catalyst-backend plugin system
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  catalystVersion: string;
  permissions: string[];
  backend?: { entry: string };
  frontend?: { entry: string };
  dependencies?: Record<string, string>;
  config?: Record<string, any>;
  events?: Record<string, { payload: Record<string, any>; description?: string }>;
  storageEngine?: 'legacy' | 'dedicated';
  runtime?: 'legacy' | 'isolated';
}

export interface PluginLifecycle {
  onLoad?(context: any): Promise<void> | void;
  onEnable?(context: any): Promise<void> | void;
  onDisable?(context: any): Promise<void> | void;
  onUnload?(context: any): Promise<void> | void;
}

export interface PluginCollectionAPI {
  find(filter?: any, options?: PluginCollectionOptions): Promise<any[]>;
  findOne(filter: any): Promise<any | null>;
  insert(doc: any): Promise<any>;
  update(filter: any, update: any): Promise<number>;
  delete(filter: any): Promise<number>;
  count(filter?: any): Promise<number>;
}

export interface PluginCollectionOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  projection?: Record<string, 0 | 1>;
}

export type PluginRouteHandler = (request: any, reply: any) => Promise<any> | any;
export type PluginMiddlewareHandler = (request: any, reply: any, done: (err?: Error) => void) => Promise<void> | void;
export type PluginWebSocketHandler = (data: any, clientId?: string) => Promise<void> | void;
export type PluginTaskHandler = () => Promise<void> | void;
export type PluginEventHandler = (data: any) => Promise<void> | void;
