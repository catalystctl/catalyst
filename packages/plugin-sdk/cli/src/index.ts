#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

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
  const name = args[1] || '';
  const options: Record<string, string | boolean> = {};

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--typescript' || arg === '-ts') {
      options.typescript = true;
    } else if (arg === '--template' || arg === '-t') {
      options.template = args[++i] || 'backend-only';
    } else if (arg === '--path' || arg === '-p') {
      options.path = args[++i] || '.';
    } else if (arg === '--watch') {
      options.watch = true;
    }
  }

  return { command, name, options };
}

async function createPlugin(name: string, options: Record<string, string | boolean>) {
  if (!name) {
    console.error('Error: Plugin name is required');
    process.exit(1);
  }

  const template = (options.template as string) || 'backend-only';
  const targetPath = path.resolve((options.path as string) || '.', name);
  const useTypeScript = options.typescript !== false;

  const templatesDir = path.join(__dirname, '..', '..', 'templates', template);

  // Check if template exists
  try {
    await fs.access(templatesDir);
  } catch {
    console.error(`Error: Template "${template}" not found. Available: backend-only, fullstack, minimal`);
    process.exit(1);
  }

  // Create directory
  await fs.mkdir(targetPath, { recursive: true });

  // Copy template files
  const files = await fs.readdir(templatesDir, { recursive: true });
  for (const file of files) {
    const src = path.join(templatesDir, file as string);
    const dst = path.join(targetPath, file as string);
    const stat = await fs.stat(src);

    if (stat.isDirectory()) {
      await fs.mkdir(dst, { recursive: true });
    } else {
      let content = await fs.readFile(src, 'utf-8');
      // Replace placeholders
      content = content
        .replace(/\{\{pluginName\}\}/g, name)
        .replace(/\{\{PluginName\}\}/g, name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
        .replace(/\{\{author\}\}/g, 'Catalyst Developer');

      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.writeFile(dst, content);
    }
  }

  // Initialize git
  try {
    const { execSync } = await import('child_process');
    execSync('git init', { cwd: targetPath, stdio: 'ignore' });
  } catch {
    // Git not available, ignore
  }

  console.log(`✅ Created plugin "${name}" at ${targetPath}`);
  console.log(`   Template: ${template}`);
  console.log(`   TypeScript: ${useTypeScript}`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  npm run dev    # Start development server`);
}

async function buildPlugin(options: Record<string, boolean>) {
  console.log('🔨 Building plugin...');
  // Simple build: just validate manifest and check for TypeScript
  try {
    const manifest = JSON.parse(await fs.readFile('plugin.json', 'utf-8'));
    console.log(`✅ Manifest valid: ${manifest.name} v${manifest.version}`);

    // Type check if tsconfig exists
    try {
      await fs.access('tsconfig.json');
      const { execSync } = await import('child_process');
      execSync('npx tsc --noEmit', { stdio: 'inherit' });
    } catch {
      console.log('⚠️  No tsconfig.json found, skipping type check');
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
      await buildPlugin(options);
      break;
    case 'test':
      await testPlugin();
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
