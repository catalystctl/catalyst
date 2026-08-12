/**
 * Nested document path helpers for plugin collection filters/updates.
 * Supports Mongo-style dotted paths (`sla.resolutionBreached`).
 */

/** Read a value from a document by top-level or dotted path. */
export function getByPath(doc: any, path: string): unknown {
  if (!doc || typeof doc !== 'object') return undefined;
  if (!path.includes('.')) return doc[path];
  const parts = path.split('.');
  let cur: any = doc;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Set a value on a document by top-level or dotted path (mutates). */
export function setByPath(doc: any, path: string, value: unknown): void {
  if (!path.includes('.')) {
    doc[path] = value;
    return;
  }
  const parts = path.split('.');
  let cur: any = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] === null || cur[part] === undefined || typeof cur[part] !== 'object' || Array.isArray(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Delete a value on a document by top-level or dotted path (mutates). */
export function unsetByPath(doc: any, path: string): void {
  if (!path.includes('.')) {
    delete doc[path];
    return;
  }
  const parts = path.split('.');
  let cur: any = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return;
    cur = cur[parts[i]];
  }
  if (cur && typeof cur === 'object') {
    delete cur[parts[parts.length - 1]];
  }
}

/**
 * Mongo-style filter matcher with dotted path support and $or/$and.
 * Shared by legacy JSON-array collections and dedicated row storage.
 */
export function matchFilter(doc: any, filter: any): boolean {
  if (!filter || typeof filter !== 'object') return true;

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') {
      if (!Array.isArray(value) || !(value as any[]).some((sub) => matchFilter(doc, sub))) {
        return false;
      }
      continue;
    }
    if (key === '$and') {
      if (!Array.isArray(value) || !(value as any[]).every((sub) => matchFilter(doc, sub))) {
        return false;
      }
      continue;
    }

    const docValue = getByPath(doc, key);

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const op = value as Record<string, any>;
      // Treat as comparison operators only when keys look like $ops
      const opKeys = Object.keys(op);
      const isOperatorObject = opKeys.length > 0 && opKeys.every((k) => k.startsWith('$'));
      if (isOperatorObject) {
        if (op.$eq !== undefined && docValue !== op.$eq) return false;
        if (op.$ne !== undefined && docValue === op.$ne) return false;
        if (op.$gt !== undefined && !(docValue as any > op.$gt)) return false;
        if (op.$gte !== undefined && !(docValue as any >= op.$gte)) return false;
        if (op.$lt !== undefined && !(docValue as any < op.$lt)) return false;
        if (op.$lte !== undefined && !(docValue as any <= op.$lte)) return false;
        if (op.$in !== undefined && !Array.isArray(op.$in)) return false;
        if (op.$in !== undefined && !(op.$in as any[]).includes(docValue)) return false;
        if (op.$nin !== undefined && !Array.isArray(op.$nin)) return false;
        if (op.$nin !== undefined && (op.$nin as any[]).includes(docValue)) return false;
        if (op.$exists !== undefined) {
          const exists = docValue !== undefined && docValue !== null;
          if (op.$exists !== exists) return false;
        }
        if (op.$regex !== undefined) {
          const regex =
            typeof op.$regex === 'string' ? new RegExp(op.$regex, op.$flags || '') : op.$regex;
          if (!regex.test(String(docValue ?? ''))) return false;
        }
        continue;
      }
    }

    // Equality (incl. nested objects by reference/value strict equality)
    if (docValue !== value) return false;
  }

  return true;
}

/**
 * Apply a Mongo-style update document to a target object (mutates).
 * Supports $set/$unset/$inc/$push/$pull and bare-object-as-$set.
 * Dotted paths in $set/$unset/$inc are applied via setByPath.
 */
export function applyUpdateOperators(target: any, updateData: any): void {
  if (!updateData || typeof updateData !== 'object') return;

  const hasOps =
    updateData.$set ||
    updateData.$unset ||
    updateData.$inc ||
    updateData.$push ||
    updateData.$pull;

  if (updateData.$set && typeof updateData.$set === 'object') {
    for (const [key, value] of Object.entries(updateData.$set)) {
      setByPath(target, key, value);
    }
  }
  if (updateData.$unset && typeof updateData.$unset === 'object') {
    for (const key of Object.keys(updateData.$unset)) {
      unsetByPath(target, key);
    }
  }
  if (updateData.$inc && typeof updateData.$inc === 'object') {
    for (const [key, value] of Object.entries(updateData.$inc)) {
      const current = getByPath(target, key);
      setByPath(target, key, ((typeof current === 'number' ? current : 0) as number) + (value as number));
    }
  }
  if (updateData.$push && typeof updateData.$push === 'object') {
    for (const [key, value] of Object.entries(updateData.$push)) {
      const current = getByPath(target, key);
      const arr = Array.isArray(current) ? current : [];
      arr.push(value);
      setByPath(target, key, arr);
    }
  }
  if (updateData.$pull && typeof updateData.$pull === 'object') {
    for (const [key, value] of Object.entries(updateData.$pull)) {
      const current = getByPath(target, key);
      if (!Array.isArray(current)) continue;
      if (typeof value === 'object' && value !== null) {
        setByPath(
          target,
          key,
          current.filter((item: any) => !matchFilter(item, value)),
        );
      } else {
        setByPath(
          target,
          key,
          current.filter((item: any) => item !== value),
        );
      }
    }
  }

  if (!hasOps) {
    // Bare object treated as $set (top-level keys only — callers should use $set for nested)
    for (const [key, value] of Object.entries(updateData)) {
      if (key.startsWith('$')) continue;
      setByPath(target, key, value);
    }
  }
}
