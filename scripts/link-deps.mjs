/**
 * Link this out-of-repo plugin's dependencies from an existing DSH installation
 * and a DSH source checkout.
 *
 * The package is developed outside the `deepseek-harness` pnpm workspace, so it
 * cannot resolve `@deepseek-ai/*` from a registry: those packages are published
 * as part of the harness. Instead of vendoring them, this script symlinks the
 * already-built copies that a real installation ships (the host half runs
 * against exactly those) and takes the build-time toolchain from a checkout.
 *
 * Usage:
 *   node scripts/link-deps.mjs [--dsh <install-dir>] [--checkout <dir>]
 *
 * Defaults come from `DSH_INSTALL` / `DSH_CHECKOUT`, then from the well-known
 * global-install and workspace locations. Missing optional packages are
 * reported, never fatal: the host half builds without the client half's deps.
 *
 * This mode reflects an INSTALL. Run `link-checkout-scope.mjs` afterwards to
 * type-check and build against a checkout: the two write the same
 * `node_modules/@deepseek-ai` scope, so whichever ran last wins, and only the
 * checkout has every package a client plugin compiles against.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = join(HERE, 'node_modules')

/** Read `--flag value` from argv. */
function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
}

const DSH_INSTALL = resolve(flag('dsh', process.env.DSH_INSTALL
  ?? '/home/soulic/.local/lib/node_modules/@deepseek-ai/dsh'))
const CHECKOUT = resolve(flag('checkout', process.env.DSH_CHECKOUT
  ?? '/mnt/data/projects/deepseek-harness'))

/** Package roots, most specific first: the install ships built `@deepseek-ai` rows. */
const SOURCES = [
  join(DSH_INSTALL, 'node_modules'),
  join(CHECKOUT, 'node_modules'),
]

/**
 * Toolchain packages that only a checkout has installed. The `@deepseek-ai`
 * runtime packages deliberately do NOT appear here: this plugin targets the
 * installed harness, and mixing a checkout's client types with an install's
 * runtime is how a contract drifts without anything failing to build.
 */
const FROM_CHECKOUT = new Set([
  'tsdown', 'typescript', 'vitest', 'js-yaml', 'yaml', 'lightningcss', 'rolldown',
  '@types/node', '@types/react', 'react', 'react-dom',
])

/** Every bare specifier this package imports at build or run time. */
const REQUIRED = [
  // Host half.
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-util-values',
  // Client half.
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-slots',
  // Toolchain.
  'js-yaml',
  'yaml',
  'react',
  'react-dom',
  '@types/react',
  '@types/node',
  'typescript',
  'tsdown',
  'vitest',
]

/** Workspace packages a checkout builds into `packages/<group>/<name>`, keyed by package name. */
function workspacePackage(name) {
  const short = name.replace(/^@deepseek-ai\//, '')
  const groups = ['client', 'llm', 'settings', 'boot', 'mcp', 'api', 'util', 'host', 'core', 'typert', 'tools', 'subagent', 'workflow', 'guard', 'preset']
  for (const group of groups) {
    const candidate = join(CHECKOUT, 'packages', group, short)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Locate one package. `node_modules` rows are looked up in the install (which
 * ships every built `@deepseek-ai` package) and in the checkout's root, while a
 * workspace package that only a checkout builds is resolved by path.
 */
function locate(name) {
  const order = FROM_CHECKOUT.has(name) ? [...SOURCES].reverse() : SOURCES
  for (const root of order) {
    const candidate = join(root, ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  const workspace = workspacePackage(name)
  if (workspace !== undefined) return workspace
  // A workspace package's own dependencies (react and its types among them) sit
  // beside the package that declares them, not at the checkout root.
  const short = name.replace(/^@deepseek-ai\//, '')
  for (const group of ['client', 'ui-primitives', 'ui-slots', 'locale', 'store']) {
    for (const owner of [`packages/${group}`, `packages/client/${short}`, `packages/client/${group}`]) {
      const candidate = join(CHECKOUT, owner, 'node_modules', ...name.split('/'))
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  return undefined
}

/** Create the parent directories and replace any previous link at `target`. */
function link(from, target) {
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  // Relative links keep the tree portable between machines.
  symlinkSync(from, target, 'dir')
}

mkdirSync(join(MODULES, '@deepseek-ai'), { recursive: true })

const missing = []
let linked = 0
for (const name of REQUIRED) {
  const from = locate(name)
  if (from === undefined) {
    missing.push(name)
    continue
  }
  link(from, join(MODULES, ...name.split('/')))
  linked += 1
}

// `js-yaml` and `yaml` are transitive dependencies of the boot packages. A
// plugin must not rely on a package it does not declare, so they are linked
// explicitly above; report whether the install even carries them.
const transitive = ['js-yaml', 'yaml'].filter(name => locate(name) === undefined)

// Linking directories does not run a package's own bin setup, so the toolchain
// binaries are linked here; otherwise `pnpm run build` has no `tsdown` to run.
const BINS = join(HERE, 'node_modules', '.bin')
mkdirSync(BINS, { recursive: true })
for (const [name, target] of [['tsc', 'typescript/bin/tsc'], ['tsdown', 'tsdown/dist/run.mjs'],
  ['vitest', 'vitest/vitest.mjs']]) {
  const from = join(MODULES, target)
  if (!existsSync(from)) continue
  link(from, join(BINS, name))
}

process.stdout.write(`linked ${linked}/${REQUIRED.length} packages into node_modules\n`)
process.stdout.write(`install:  ${DSH_INSTALL}\n`)
process.stdout.write(`checkout: ${CHECKOUT}\n`)
if (missing.length > 0) {
  process.stdout.write(`not found (optional unless imported): ${missing.join(', ')}\n`)
}
if (transitive.length > 0) {
  process.stdout.write(`WARNING: not shipped by the install either: ${transitive.join(', ')}\n`)
}
process.stdout.write(`dsh runtime packages available: ${readdirSync(join(DSH_INSTALL, 'node_modules/@deepseek-ai')).length}\n`)
process.stdout.write('next: node scripts/link-checkout-scope.mjs  (build against a source checkout)\n')
