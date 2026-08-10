/**
 * Normalize a server-relative file path.
 * - Collapses `.` segments
 * - Resolves `..` within the virtual root (never escapes above `/`)
 * - Converts backslashes to forward slashes
 *
 * Examples:
 *   normalizePath('/a/../b')  → '/b'
 *   normalizePath('../x')    → '/x'  (escaped segments dropped)
 *   normalizePath('/a/./b')  → '/a/b'
 */
export const normalizePath = (value: string) => {
  if (!value) return '/';
  const replaced = value.replace(/\\/g, '/').trim();
  if (!replaced) return '/';

  const stack: string[] = [];
  for (const part of replaced.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      // Drop parent segment when possible; never allow escaping root.
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }

  return `/${stack.join('/')}`;
};

export const joinPath = (base: string, segment: string) => {
  const normalizedBase = normalizePath(base);
  const normalizedSegment = segment.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedSegment) return normalizedBase;
  if (normalizedBase === '/') return normalizePath(`/${normalizedSegment}`);
  return normalizePath(`${normalizedBase}/${normalizedSegment}`);
};

export const splitPath = (value: string) => normalizePath(value).split('/').filter(Boolean);

export const getParentPath = (value: string) => {
  const parts = splitPath(value);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
};

export const buildBreadcrumbs = (value: string) => {
  const segments = splitPath(value);
  const breadcrumbs: Array<{ name: string; path: string }> = [];
  let current = '/';
  segments.forEach((segment) => {
    current = joinPath(current, segment);
    breadcrumbs.push({ name: segment, path: current });
  });
  return breadcrumbs;
};
