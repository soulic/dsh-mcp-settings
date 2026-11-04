/**
 * Build configuration for the two halves of this plugin.
 *
 * The Host half is an ordinary ESM module. The browser half is not: the client
 * module system fetches `lib/client.js` and evaluates it as a *lazy-CJS factory*
 * that registers itself on the page's module loader, so the artifact has to be
 * CommonJS wrapped in a `load({ id, factory })` handoff, and every specifier the
 * page's platform table answers for must stay a `require()` instead of being
 * inlined. The harness keeps that preset inside its own repository
 * (`packages/client/tsdown.client.ts`) and does not publish it, so the contract is
 * restated here — see README.md, "Building".
 *
 * Both halves are bundled from `src`, not from emitted JavaScript, so there is no
 * intermediate build for relative imports to survive. The Host half imports
 * `@deepseek-ai/*` services that MUST be the running host's own instances, so
 * those stay external and resolve from the profile that loads this plugin; only
 * identity-free libraries (`js-yaml`, `yaml`) are inlined.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type UserConfig } from 'tsdown'

/** Package id stamped into the loader handoff and onto injected styles. */
const ID = 'dsh-mcp-settings'

const require = createRequire(import.meta.url)

/**
 * `yaml`'s browser build.
 *
 * The package lists a `node` export condition before its browser `default`, so a
 * bundle that resolves with Node conditions inlines the Node build — whose
 * `require('process')` and `require('buffer')` the page's module table cannot
 * answer. The browser build has the same API without those imports.
 */
const YAML_BROWSER = join(dirname(require.resolve('yaml/package.json')), 'browser/index.js')

/**
 * Services and helpers the running harness provides. Kept external so a plugin
 * shares the host's service instances instead of bundling a second copy.
 */
const HOST_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-util-values',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-mcp-client',
]

/** Pure libraries with no runtime identity to share: safe, and useful, to inline. */
const HOST_INLINE = ['js-yaml', 'yaml']

/** Specifiers the page's platform seed table answers for. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const isHostExternal = (specifier: string): boolean =>
  HOST_EXTERNAL.some(name => specifier === name || specifier.startsWith(`${name}/`))
  && !HOST_INLINE.includes(specifier)

/** The Host half: plain ESM. */
const host: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: false,
  deps: {
    neverBundle: isHostExternal,
    alwaysBundle: (specifier: string) => !isHostExternal(specifier) && !specifier.startsWith('node:'),
  },
}

/** The browser half: a loader-registered lazy-CJS factory. */
const client: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    // A specifier the platform table answers stays a `require`; everything else
    // is inlined, because a `require()` the table cannot answer throws at boot.
    neverBundle: (specifier: string) => PLATFORM_MODULES.includes(specifier),
    alwaysBundle: (specifier: string) => !PLATFORM_MODULES.includes(specifier),
  },
  // The browser build of an inlined library, for the reason given at
  // YAML_BROWSER. `platform: 'browser'` alone does not redirect this package.
  alias: { yaml: YAML_BROWSER },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env['NODE_ENV'] ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env['NODE_ENV'] ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([host, client]) as UserConfig
