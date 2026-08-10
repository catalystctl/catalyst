#!/usr/bin/env node
/**
 * Post-process tsc ESM output so Node can resolve relative imports.
 *
 * tsconfig uses moduleResolution=bundler, which allows extensionless
 * relative imports in TypeScript. Plain Node ESM (`"type": "module"`)
 * requires explicit .js extensions at runtime. Without this pass the
 * production image crashes immediately after dotenv loads:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/dist/db'
 *
 * This rewrites only relative specifiers (./ and ../). Package imports
 * are left untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, "..", "dist");

if (!fs.existsSync(distRoot)) {
	console.error(`fix-esm-extensions: dist not found at ${distRoot}`);
	process.exit(1);
}

const EXT_OK = /\.(js|mjs|cjs|json|node)(\?|$)/;

function rewriteSpecifier(spec) {
	if (!spec.startsWith("./") && !spec.startsWith("../")) return spec;
	if (EXT_OK.test(spec)) return spec;
	return `${spec}.js`;
}

function transform(source) {
	let out = source;
	// import/export ... from '...'
	out = out.replace(
		/((?:import|export)\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?|export\s+\*\s+from\s+)(['"])(\.[^'"]+)\2/g,
		(match, prefix, quote, spec) => {
			const next = rewriteSpecifier(spec);
			return next === spec ? match : `${prefix}${quote}${next}${quote}`;
		},
	);
	// side-effect import './x'
	out = out.replace(
		/(import\s+)(['"])(\.[^'"]+)\2/g,
		(match, prefix, quote, spec) => {
			const next = rewriteSpecifier(spec);
			return next === spec ? match : `${prefix}${quote}${next}${quote}`;
		},
	);
	// dynamic import('./x')
	out = out.replace(
		/(import\s*\(\s*)(['"])(\.[^'"]+)\2(\s*\))/g,
		(match, prefix, quote, spec, suffix) => {
			const next = rewriteSpecifier(spec);
			return next === spec ? match : `${prefix}${quote}${next}${quote}${suffix}`;
		},
	);
	// export * as foo from './x' already covered by first pattern via export
	return out;
}

function walk(dir) {
	let changedFiles = 0;
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			changedFiles += walk(full);
			continue;
		}
		if (!ent.name.endsWith(".js")) continue;
		const before = fs.readFileSync(full, "utf8");
		const after = transform(before);
		if (after !== before) {
			fs.writeFileSync(full, after);
			changedFiles += 1;
		}
	}
	return changedFiles;
}

const n = walk(distRoot);
console.log(`fix-esm-extensions: rewrote ${n} file(s) under dist/`);
