import esbuild from 'esbuild'
import { builtinModules } from 'node:module'

// The plugin shares the draft format with the CLI by bundling ../src/drafts.ts and what it
// imports. Node built-ins are marked external only so that an accidental import fails the
// mobile check below instead of being silently bundled.
const watch = process.argv.includes('--watch')
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  outfile: 'main.js',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  metafile: true,
})
if (watch) {
  await context.watch()
} else {
  const result = await context.rebuild()
  await context.dispose()
  // Obsidian on phones has no Node; any built-in that slipped into the bundle would crash there.
  const nodeImports = Object.values(result.metafile.outputs).flatMap((o) => o.imports)
    .filter((i) => i.external && i.path !== 'obsidian').map((i) => i.path)
  if (nodeImports.length) {
    console.error(`main.js imports ${[...new Set(nodeImports)].join(', ')}, which mobile Obsidian lacks`)
    process.exit(1)
  }
}
