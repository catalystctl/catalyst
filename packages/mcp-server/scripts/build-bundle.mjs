import { build } from "esbuild";
import { chmod, stat } from "node:fs/promises";

// Single-file bundle for GitHub Releases. tsc output needs node_modules at
// runtime; this file has the SDK and zod inlined so Node 20+ is enough.
// The entry shebang is preserved by esbuild, so no banner is added.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/catalyst-mcp.mjs",
  minify: true,
});

await chmod("dist/catalyst-mcp.mjs", 0o755);
const { size } = await stat("dist/catalyst-mcp.mjs");
console.log(`bundled dist/catalyst-mcp.mjs (${(size / 1024).toFixed(1)} KiB)`);
