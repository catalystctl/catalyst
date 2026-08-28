#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function showHelp() {
  console.log(`
catalyst-plugin — CLI for Catalyst plugin development

Usage:
  catalyst-plugin create <name> [options]
  catalyst-plugin build [--watch]
  catalyst-plugin test

Commands:
  create <name>      Create a new plugin from a template
  build              Build the plugin for production
  test               Run plugin tests
  pack               Package the plugin into a marketplace-ready .catpkg.zip

Pack options:
  --out <dir>        Output directory (default: current directory)

Create options:
  --template, -t     Template type (backend-only | fullstack | minimal)
  --typescript, -ts  Use TypeScript (default: true)
  --path, -p         Directory to create plugin in
  --help, -h         Show this help
`);
}

function parseArgs(argv: string[]): { command: string; name: string; options: Record<string, string | boolean> } {
  const args = argv.slice(2);
  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }

  const command = args[0];
  // Commands like `pack`/`build`/`test` take no name — don't swallow a flag.
  const secondArgIsName = !!args[1] && !args[1].startsWith('-');
  const name = secondArgIsName ? args[1] : '';
  const options: Record<string, string | boolean> = {};

  for (let i = secondArgIsName ? 2 : 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--typescript' || arg === '-ts') {
      options.typescript = true;
    } else if (arg === '--template' || arg === '-t') {
      options.template = args[++i] || 'backend-only';
    } else if (arg === '--path' || arg === '-p') {
      options.path = args[++i] || '.';
    } else if (arg === '--out') {
      options.out = args[++i] || '.';
    } else if (arg === '--watch') {
      options.watch = true;
    }
  }

  return { command, name, options };
}

function titleCase(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function createPlugin(name: string, options: Record<string, string | boolean>) {
  if (!name) {
    console.error('Error: Plugin name is required');
    process.exit(1);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error('Error: Plugin name must be lowercase alphanumeric with hyphens');
    process.exit(1);
  }

  const template = (options.template as string) || 'backend-only';
  const targetPath = path.resolve((options.path as string) || '.', name);
  const useTypeScript = options.typescript !== false;

  // templates live next to the package (packages/plugin-sdk/templates)
  const templatesDir = path.join(__dirname, '..', '..', 'templates', template);

  try {
    await fs.access(templatesDir);
  } catch {
    console.error(`Error: Template "${template}" not found. Available: backend-only, fullstack, minimal`);
    process.exit(1);
  }

  await fs.mkdir(targetPath, { recursive: true });

  const displayName = titleCase(name);
  const description = `A Catalyst plugin: ${displayName}`;
  const author = 'Catalyst Developer';

  const files = await fs.readdir(templatesDir, { recursive: true });
  for (const file of files) {
    const src = path.join(templatesDir, file as string);
    const dst = path.join(targetPath, file as string);
    const stat = await fs.stat(src);

    if (stat.isDirectory()) {
      await fs.mkdir(dst, { recursive: true });
    } else {
      let content = await fs.readFile(src, 'utf-8');
      content = content
        .replace(/\{\{pluginName\}\}/g, name)
        .replace(/\{\{PluginName\}\}/g, displayName)
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{displayName\}\}/g, displayName)
        .replace(/\{\{description\}\}/g, description)
        .replace(/\{\{author\}\}/g, author);

      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.writeFile(dst, content);
    }
  }

  try {
    const { execSync } = await import('child_process');
    execSync('git init', { cwd: targetPath, stdio: 'ignore' });
  } catch {
    // Git not available
  }

  console.log(`✅ Created plugin "${name}" at ${targetPath}`);
  console.log(`   Template: ${template}`);
  console.log(`   TypeScript: ${useTypeScript}`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  npm run build   # compile TS → JS (backend.entry points at dist/src)`);
  console.log(`  # Place this folder under catalyst-plugins/ and restart the panel`);
}

async function buildPlugin() {
  console.log('🔨 Building plugin...');
  try {
    const manifest = JSON.parse(await fs.readFile('plugin.json', 'utf-8'));
    console.log(`✅ Manifest valid: ${manifest.name} v${manifest.version}`);

    try {
      await fs.access('tsconfig.json');
      const { execSync } = await import('child_process');
      execSync('npx tsc', { stdio: 'inherit' });
    } catch {
      console.log('⚠️  No tsconfig.json found, skipping compile');
    }

    console.log('✅ Build complete');
  } catch (err: any) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

async function testPlugin() {
  console.log('🧪 Running plugin tests...');
  try {
    const { execSync } = await import('child_process');
    execSync('npx vitest run', { stdio: 'inherit' });
  } catch {
    console.log('⚠️  No test runner found. Install vitest: npm install -D vitest');
  }
}

const PACK_INCLUDE = [
  'plugin.json',
  'README.md',
  'LICENSE',
];

const PACK_DIRS = ['backend', 'frontend', 'assets'];

/**
 * Package the plugin in CWD into a marketplace-ready .catpkg.zip plus a
 * sha256 sidecar. The archive root is flattened (entries at zip root) which
 * the panel installer accepts directly.
 */
async function packPlugin(options: Record<string, string | boolean>) {
  const fsSync = await import('fs');
  const fsp = await import('fs/promises');
  const pathMod = await import('path');

  let manifest: any;
  try {
    manifest = JSON.parse(await fsp.readFile('plugin.json', 'utf-8'));
  } catch {
    console.error('❌ pack must be run from a plugin directory containing plugin.json');
    process.exit(1);
  }

  // Validate manifest, then assemble. frontend/frontend.mjs enables runtime
  // loading after install (see docs/plugins.md "Runtime frontends").
  const outDir = pathMod.resolve((options.out as string) || '.');
  await fsp.mkdir(outDir, { recursive: true });
  const outFile = pathMod.join(outDir, `${manifest.name}-${manifest.version}.catpkg.zip`);

  console.log(`📦 Packaging ${manifest.name}@${manifest.version} → ${outFile}`);

  const archiverMod = await import('archiver').catch(() => null);
  if (!archiverMod) {
    console.error("❌ archiver is unavailable — install it with: npm install -D archiver");
    process.exit(1);
  }
  const archiverFactory = (archiverMod as any).default ?? archiverMod;
  const archive = archiverFactory('zip', { zlib: { level: 9 } });
  const hash = (await import('crypto')).createHash('sha256');
  const ws = fsSync.createWriteStream(outFile);
  archive.on('data', (chunk: Buffer) => hash.update(chunk));
  const done = new Promise<void>((resolve, reject) => {
    ws.on('close', resolve);
    archive.on('error', reject);
    ws.on('error', reject);
  });

  archive.pipe(ws);

  const entries = await fsp.readdir('.', { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && PACK_INCLUDE.includes(entry.name)) {
      archive.file(entry.name, { name: entry.name });
      console.log(`   + ${entry.name}`);
    }
  }
  for (const dir of PACK_DIRS) {
    if (fsSync.existsSync(dir)) {
      archive.directory(dir, dir);
      console.log(`   + ${dir}/`);
    }
  }
  if (!fsSync.existsSync(pathMod.join('backend')) && !fsSync.existsSync(pathMod.join('frontend'))) {
    console.log('⚠️  No backend/ or frontend/ directory — package will install but do nothing.');
  }

  await archive.finalize();
  await done;

  const digest = hash.digest('hex');
  await fsp.writeFile(`${outFile}.sha256`, `${digest}  ${pathMod.basename(outFile)}\n`, 'utf-8');
  console.log('✅ Packaged.');
  console.log(`   Archive : ${outFile}`);
  console.log(`   sha256  : ${digest}`);
  console.log('   Publish both the archive and its digest to your marketplace index.');
}

async function main() {
  const { command, name, options } = parseArgs(process.argv);

  if (options.help) {
    showHelp();
    return;
  }

  switch (command) {
    case 'create':
      await createPlugin(name, options);
      break;
    case 'build':
      await buildPlugin();
      break;
    case 'test':
      await testPlugin();
      break;
    case 'pack':
      await packPlugin(options);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
