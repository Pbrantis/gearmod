// Bundles bench/servers/gearmod-index.ts into apps/desktop/.bench/, next to the app's node_modules, so better-sqlite3
// and the tree-sitter grammars resolve from there. Run it again after changing the index.
//   node bench/build.mjs
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = join(here, '..', 'apps', 'desktop')
// esbuild comes with vite, which the app already uses
const esbuild = createRequire(createRequire(join(desktop, 'package.json')).resolve('vite/package.json'))('esbuild')

await esbuild.build({
  entryPoints: [join(here, 'servers', 'gearmod-index.ts')],
  outfile: join(desktop, '.bench', 'gearmod-index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info'
})
