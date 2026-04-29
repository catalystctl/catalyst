import { z } from 'zod';

export interface ConfigFieldDef {
  type: 'string' | 'number' | 'boolean' | 'select' | 'text' | 'password' | 'object' | 'array';
  default?: any;
  description?: string;
  required?: boolean;
  enum?: any[];
  min?: number;
  max?: number;
  options?: { label: string; value: string | number }[];
}

export function defineConfig<T extends Record<string, ConfigFieldDef>>(schema: T) {
  return schema;
}

export function configField(def: ConfigFieldDef): ConfigFieldDef {
  return def;
}

export function createConfigSchema(definitions: Record<string, ConfigFieldDef>): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, def] of Object.entries(definitions)) {
    let schema: z.ZodTypeAny;
    switch (def.type) {
      case 'string':
      case 'text':
      case 'password':
        schema = z.string();
        break;
      case 'number':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'select':
        if (def.enum) {
          schema = z.enum(def.enum as [string, ...string[]]);
        } else if (def.options) {
          schema = z.string();
        } else {
          schema = z.string();
        }
        break;
      case 'object':
        schema = z.record(z.any());
        break;
      case 'array':
        schema = z.array(z.any());
        break;
      default:
        schema = z.any();
    }
    if (def.default !== undefined) {
      schema = (schema as any).default(def.default);
    } else if (!def.required) {
      schema = schema.optional();
    }
    if (def.type === 'string' && def.min !== undefined) {
      schema = (schema as z.ZodString).min(def.min);
    }
    if (def.type === 'string' && def.max !== undefined) {
      schema = (schema as z.ZodString).max(def.max);
    }
    shape[key] = schema;
  }
  return z.object(shape);
}
