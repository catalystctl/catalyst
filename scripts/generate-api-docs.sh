#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCS_DIR="$ROOT_DIR/docs/api"
OPENAPI_URL="${OPENAPI_URL:-http://localhost:3000/docs/json}"

mkdir -p "$DOCS_DIR"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to fetch OpenAPI JSON" >&2
  exit 1
fi

OPENAPI_JSON="$DOCS_DIR/openapi.json"
API_MD="$DOCS_DIR/API.md"

curl -sS "$OPENAPI_URL" -o "$OPENAPI_JSON"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to render Markdown" >&2
  exit 1
fi

DOCS_DIR="$DOCS_DIR" bun <<'NODE'
const fs = require('fs');
const path = require('path');

const docsDir = path.resolve(process.env.DOCS_DIR || path.resolve(process.cwd(), 'docs/api'));
const repoRoot = path.resolve(docsDir, '..', '..');
const backendRoot = path.join(repoRoot, 'catalyst-backend');
const openapiPath = path.join(docsDir, 'openapi.json');
const apiMdPath = path.join(docsDir, 'API.md');

const raw = fs.readFileSync(openapiPath, 'utf8');
const spec = JSON.parse(raw);

const title = spec?.info?.title || 'API Documentation';
const description = spec?.info?.description || '';
const version = spec?.info?.version || '';
const servers = Array.isArray(spec.servers) ? spec.servers : [];
const paths = spec.paths || {};

const readFileSafe = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
};

const normalizePath = (value) => {
  if (!value) return '/';
  if (value === '/') return '/';
  return value.replace(/\/+$/, '');
};

const joinPaths = (prefix, routePath) => {
  const cleanPrefix = (prefix || '').replace(/\/+$/, '');
  const cleanRoute = routePath === '/' ? '' : routePath;
  const combined = `${cleanPrefix}${cleanRoute.startsWith('/') ? cleanRoute : `/${cleanRoute}`}`;
  return normalizePath(combined === '' ? '/' : combined);
};

const parseTypeLiteral = (literal) => {
  const fields = [];
  const fieldRegex = /([A-Za-z0-9_]+)\s*(\?)?\s*:\s*([^;\n,}]+)/g;
  let match;
  while ((match = fieldRegex.exec(literal)) !== null) {
    fields.push({
      name: match[1],
      optional: Boolean(match[2]),
      type: match[3].trim(),
    });
  }
  return fields;
};

const parseDestructuredNames = (chunk, kind) => {
  const names = [];
  const regex = new RegExp(`const\\s+\\{([^}]+)\\}\\s*=\\s*request\\.${kind}\\s+as`, 'g');
  let match;
  while ((match = regex.exec(chunk)) !== null) {
    const content = match[1];
    content.split(',').forEach((raw) => {
      const cleaned = raw.trim();
      if (!cleaned) return;
      const name = cleaned.split(/[:=]/)[0].trim();
      if (name) names.push(name);
    });
  }
  return names;
};

const extractFields = (chunk, kind) => {
  const results = [];
  const typeLiteralRegex = new RegExp(`request\\.${kind}\\s+as\\s+\\{([\\s\\S]*?)\\}`, 'g');
  let match;
  while ((match = typeLiteralRegex.exec(chunk)) !== null) {
    results.push(...parseTypeLiteral(match[1]));
  }
  const typeNames = new Set(results.map((field) => field.name));
  const destructured = parseDestructuredNames(chunk, kind);
  destructured.forEach((name) => {
    if (!typeNames.has(name)) {
      results.push({ name, optional: true, type: 'unknown' });
    }
  });
  return results;
};

const collectRouteChunks = (content) => {
  const regex = /app\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
  const matches = Array.from(content.matchAll(regex));
  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index || content.length) : content.length;
    return {
      method: match[1],
      path: match[3],
      chunk: content.slice(start, end),
    };
  });
};

const mergeFields = (target, fields) => {
  fields.forEach((field) => {
    if (!target.some((existing) => existing.name === field.name)) {
      target.push(field);
    }
  });
};

const inferredByRoute = new Map();

const addInferred = (key, fields) => {
  if (!fields.params.length && !fields.query.length && !fields.body.length) return;
  if (!inferredByRoute.has(key)) {
    inferredByRoute.set(key, { params: [], query: [], body: [] });
  }
  const existing = inferredByRoute.get(key);
  mergeFields(existing.params, fields.params);
  mergeFields(existing.query, fields.query);
  mergeFields(existing.body, fields.body);
};

const indexPath = path.join(backendRoot, 'src/index.ts');
const indexSource = readFileSafe(indexPath);
const importRegex = /import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+['"`](\.\/routes\/[^'"`]+)['"`]/g;
const registerRegex = /app\.register\(\s*([A-Za-z0-9_]+)(?:(?!app\.register\().)*?prefix:\s*['"`]([^'"`]+)['"`]/gs;

const routeImports = new Map();
let match;
while ((match = importRegex.exec(indexSource)) !== null) {
  routeImports.set(match[1], match[2]);
}

const routePrefixes = new Map();
while ((match = registerRegex.exec(indexSource)) !== null) {
  routePrefixes.set(match[1], match[2]);
}

const routeFiles = Array.from(routeImports.entries()).map(([name, relPath]) => {
  const normalized = relPath.replace('./', '');
  const withExtension = path.extname(normalized) ? normalized : `${normalized}.ts`;
  return {
    name,
    path: path.join(backendRoot, 'src', withExtension),
    prefix: routePrefixes.get(name) || '',
  };
});

routeFiles.push({
  name: 'index',
  path: indexPath,
  prefix: '',
});

routeFiles.forEach((routeFile) => {
  const source = readFileSafe(routeFile.path);
  if (!source) return;
  const chunks = collectRouteChunks(source);
  chunks.forEach((chunkInfo) => {
    const fullPath = joinPaths(routeFile.prefix, chunkInfo.path);
    const key = `${chunkInfo.method.toUpperCase()} ${fullPath}`;
    const fields = {
      params: extractFields(chunkInfo.chunk, 'params'),
      query: extractFields(chunkInfo.chunk, 'query'),
      body: extractFields(chunkInfo.chunk, 'body'),
    };
    addInferred(key, fields);
  });
});

const lines = [];
lines.push(`# ${title}`);
if (description) lines.push(`\\n${description}`);
if (version) lines.push(`\\n**Version:** ${version}`);
lines.push(`\\n_Inferred request fields are extracted from route handler typings and may omit implicit or dynamic values._`);

if (servers.length) {
  lines.push('\\n## Servers');
  servers.forEach((server) => {
    lines.push(`- ${server.url}${server.description ? ` - ${server.description}` : ''}`);
  });
}

lines.push('\\n## Endpoints');
const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
Object.keys(paths).sort().forEach((route) => {
  const routeItem = paths[route] || {};
  methods.forEach((method) => {
    const op = routeItem[method];
    if (!op) return;
    const summary = op.summary || op.operationId || '';
    const normalizedRoute = normalizePath(route);
    const key = `${method.toUpperCase()} ${normalizedRoute}`;
    lines.push(`\\n### ${method.toUpperCase()} ${route}${summary ? ` - ${summary}` : ''}`);
    if (op.description) lines.push(`\\n${op.description}`);
    if (op.parameters && op.parameters.length) {
      lines.push('\\n**Parameters**');
      op.parameters.forEach((param) => {
        const required = param.required ? ' (required)' : '';
        lines.push(`- ${param.name} (${param.in})${required}${param.schema?.type ? `: ${param.schema.type}` : ''}`);
      });
    }
    if (op.requestBody) {
      lines.push('\\n**Request**');
      const content = op.requestBody.content || {};
      Object.keys(content).forEach((contentType) => {
        lines.push(`- ${contentType}`);
      });
    }
    const inferred = inferredByRoute.get(key);
    if (inferred) {
      lines.push('\\n**Inferred Request Fields**');
      if (inferred.params.length) {
        lines.push('- params:');
        inferred.params.forEach((field) => {
          lines.push(`  - ${field.name}${field.optional ? '?' : ''}: ${field.type}`);
        });
      }
      if (inferred.query.length) {
        lines.push('- query:');
        inferred.query.forEach((field) => {
          lines.push(`  - ${field.name}${field.optional ? '?' : ''}: ${field.type}`);
        });
      }
      if (inferred.body.length) {
        lines.push('- body:');
        inferred.body.forEach((field) => {
          lines.push(`  - ${field.name}${field.optional ? '?' : ''}: ${field.type}`);
        });
      }
    } else if (routeItem && Object.keys(routeItem).length > 0) {
      lines.push('\\n**Inferred Request Fields**');
      lines.push('- params: none');
      lines.push('- query: none');
      lines.push('- body: none');
    }
    if (op.responses) {
      lines.push('\\n**Responses**');
      Object.keys(op.responses).forEach((code) => {
        const response = op.responses[code] || {};
        lines.push(`- ${code}${response.description ? `: ${response.description}` : ''}`);
      });
    }
  });
});

fs.writeFileSync(apiMdPath, lines.join('\\n'), 'utf8');
NODE

echo "Wrote $OPENAPI_JSON"
echo "Wrote $API_MD"
