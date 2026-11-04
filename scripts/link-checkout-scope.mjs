/**
 * Link the `@deepseek-ai` scope from a DSH source checkout.
 *
 * The installed harness does not ship every package a client plugin compiles
 * against — the static client libraries (`ui-slots`, `ui-primitives`,
 * `client-store`) reach the browser through the frontend's platform module table
 * and have no package of their own on disk. A checkout builds all of them, so
 * type-checking a client plugin means resolving the whole scope from one tree.
 *
 * Mixing trees is what to avoid: a `declare module` augmentation only merges with
 * declarations written in the augmented module itself, so pulling some packages
 * from a checkout and others from an install silently drops every service merge
 * (`ctx.slots`, `ctx.configForms`) and the slot and locale tables with them.
 *
 * Usage: node scripts/link-checkout-scope.mjs [--checkout <dir>]
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODULES = join(HERE, 'node_modules', '@deepseek-ai')

const index = process.argv.indexOf('--checkout')
const CHECKOUT = resolve(index >= 0 && process.argv[index + 1] !== undefined
  ? process.argv[index + 1]
  : process.env['DSH_CHECKOUT'] ?? '/mnt/data/projects/deepseek-harness')

/** Directories that hold one workspace package each. */
const GROUPS = [
  'vendor', 'packages', 'packages/client', 'packages/api', 'packages/boot', 'packages/core',
  'packages/llm', 'packages/host', 'packages/mcp', 'packages/settings', 'packages/subagent',
  'packages/tools', 'packages/typert', 'packages/util', 'packages/workflow', 'packages/guard',
  'packages/preset', 'packages/experimental', 'packages/acp', 'packages/context', 'packages/fs',
  'packages/session', 'packages/storage', 'packages/sandbox', 'packages/shell', 'packages/skill',
  'packages/plan', 'packages/compaction', 'packages/deliverables', 'packages/document',
  'packages/feedback', 'packages/identity', 'packages/interaction', 'packages/jobs',
  'packages/lsp', 'packages/ptc-runtime', 'packages/schedule', 'packages/sdk', 'packages/spill',
  'packages/ssh', 'packages/terminal', 'packages/todo', 'packages/webhook', 'packages/browser-use',
  'packages/computer-use', 'packages/attachment', 'packages/agent',
]

mkdirSync(MODULES, { recursive: true })
const linked = []
const skipped = []

/** Toolchain binaries a package manager would normally create. */
const BINS = join(HERE, 'node_modules', '.bin')

/** Link one package directory under its manifest name. */
function linkPackage(dir) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const name = manifest.name
  if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) return
  if (manifest.private === true) { skipped.push(`${name} (private)`); return }
  if (!existsSync(join(dir, 'lib/index.js')) && !existsSync(join(dir, 'lib/types/index.d.ts'))) {
    skipped.push(`${name} (not built)`)
    return
  }
  const target = join(MODULES, name.slice('@deepseek-ai/'.length))
  rmSync(target, { recursive: true, force: true })
  symlinkSync(dir, target, 'dir')
  linked.push(name)
}

for (const group of GROUPS) {
  const root = join(CHECKOUT, group)
  if (!existsSync(root)) continue
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) linkPackage(join(root, entry.name))
  }
}

// Linking directories does not run a package's own bin setup, so the toolchain
// binaries are linked here too; otherwise `pnpm run build` has no `tsdown` to run.
mkdirSync(BINS, { recursive: true })
for (const [name, target] of [['tsc', 'typescript/bin/tsc'], ['tsdown', 'tsdown/dist/run.mjs'],
  ['vitest', 'vitest/vitest.mjs']]) {
  const from = join(HERE, 'node_modules', ...target.split('/'))
  if (!existsSync(from)) continue
  const to = join(BINS, name)
  rmSync(to, { recursive: true, force: true })
  symlinkSync(from, to, 'file')
}

process.stdout.write(`linked ${linked.length} checkout packages into node_modules/@deepseek-ai\n`)
if (skipped.length > 0) process.stdout.write(`skipped: ${skipped.join(', ')}\n`)
