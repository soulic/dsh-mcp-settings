/**
 * Wiring tests for the links between the page and the Host.
 *
 * The page does not know its own profile entry id: it finds its settings
 * namespace by a marker the Host publishes as a form value, then reads that
 * namespace's form. The Host seeds that form from the file and writes the form
 * back on a save. Any of those links failing silently looks identical to the
 * user — an empty MCP servers page — or, worse, erases servers nobody removed.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Config, apply, type Config as PluginConfig, type McpServerInput } from '../src/index.js'
import { findNamespace } from '../src/client/mcp-servers-controller.js'
import { MARKER_FIELD, SETTINGS_MARKER } from '../src/contract.js'

/** A volatile config field, as the Loader hands it to a plugin. */
function live<T>(value: T): { get: () => T } {
  return { get: () => value }
}

/** A mutable staged value the test can change the way a save does. */
function box<T>(initial: T): { get: () => T, set: (next: T) => void } {
  let value = initial
  return { get: () => value, set: (next) => { value = next } }
}

/** The row the user maintains by hand. */
const USER_FILE = `- insert:
    - id: mcp-example
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: example
        transport: stdio
        command: example
        args: [serve, --mcp]
        cwd: !!js process.cwd()
`

describe('the page can find its own settings namespace', () => {
  it('publishes a marker field the describe answer carries', () => {
    const field = Config.dict?.[MARKER_FIELD]
    expect(field).toBeDefined()
    expect(field?.meta.default).toBe(SETTINGS_MARKER)
    // Hidden from the form: it is plumbing, not a setting.
    expect(field?.meta.hidden).toBe(true)
  })

  it('resolves the entry id from a describe answer shaped like the Host', () => {
    const ctx = {
      configForms: {
        describe: () => ({
          getSnapshot: () => ({
            status: 'ready',
            view: {
              writable: true,
              hasDocument: true,
              namespaces: [
                { ns: 'some-other-row', value: { servers: [] }, schema: { uid: 1, refs: { 1: { meta: {} } } } },
                { ns: 'mcp-page-row', value: { [MARKER_FIELD]: SETTINGS_MARKER, servers: [] } },
              ],
            },
          }),
        }),
      },
    }
    // The row id is the profile's choice, so it must be discovered, not assumed.
    expect(findNamespace(ctx as never)).toBe('mcp-page-row')
  })

  it('finds nothing when no namespace carries the marker', () => {
    const ctx = {
      configForms: {
        describe: () => ({
          getSnapshot: () => ({ status: 'ready', view: { writable: true, hasDocument: true, namespaces: [{ ns: 'x', value: {} }] } }),
        }),
      },
    }
    expect(findNamespace(ctx as never)).toBeUndefined()
  })
})

describe('the Host publishes the file into the page', () => {
  let dir: string
  let patchFile: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-wiring-'))
    patchFile = join(dir, 'cordis.patch.yml')
    await writeFile(patchFile, USER_FILE)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /**
   * A context that records settings writes and lets the test fire the Loader's
   * volatile-update event the way a save does.
   */
  function makeContext(entryId: string | undefined, servers: { get: () => McpServerInput[] }) {
    const updates: Array<{ ns: string, patch: Record<string, unknown> }> = []
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    const ctx = {
      // The loader's tree-scoped id is not the settings namespace; the declared
      // row id in `options` is.
      fiber: entryId === undefined ? {} : { entry: { id: `include:${entryId}`, options: { id: entryId } } },
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      effect: (run: () => unknown) => { run(); return () => {} },
      on: (event: string, handler: (...args: never[]) => void) => {
        const list = handlers.get(event) ?? []
        list.push(handler as never)
        handlers.set(event, list)
        return () => {}
      },
      emit: () => {},
      get: (key: string) => key === 'settings'
        ? {
            update: async (ns: string, patch: Record<string, unknown>) => { updates.push({ ns, patch }) },
          }
        : undefined,
    }
    return {
      ctx,
      updates,
      /** Fire one Loader event, as a save would. */
      fire: (event: string) => { for (const handler of handlers.get(event) ?? []) handler() },
      servers,
    }
  }

  /** Built per test: `patchFile` is assigned by the hook, not at module load. */
  const patchConfig = (): Partial<PluginConfig> => ({
    patchFile: live(patchFile),
    watchFile: live(false),
    servers: live([] as McpServerInput[]),
  })

  it('addresses the form by the row id the profile chose', async () => {
    const { ctx, updates } = makeContext('mcp-page-row', live([]))
    await apply(ctx as never, patchConfig())

    // Deferred until activation completes; a write inside `apply` deadlocks.
    await vi.waitFor(() => { expect(updates.map(update => update.ns)).toContain('mcp-page-row') })
    const first = updates.find(update => update.ns === 'mcp-page-row')
    expect(JSON.stringify(first?.patch)).toContain('example')
  })

  it('does not delete the row it just published', async () => {
    const { ctx, updates } = makeContext('mcp-page-row', live([]))
    await apply(ctx as never, patchConfig())

    // Let the deferred seed land, then give its volatile echo a chance to run.
    await vi.waitFor(() => { expect(updates).toHaveLength(1) })
    await new Promise(resolve => setTimeout(resolve, 20))

    // Staging an empty list on a boot where the form had not been seeded is
    // starting up, not "the user removed every server".
    expect(await readFile(patchFile, 'utf8')).toContain('mcp-example')
  })

  it('writes the file when a save changes the staged list', async () => {
    const staged = box<McpServerInput[]>([{ serverName: 'example', transport: 'stdio', command: 'example' }])
    const { ctx, fire } = makeContext('mcp-page-row', staged)
    await apply(ctx as never, {
      ...patchConfig(),
      servers: { get: staged.get },
    })

    // Drop the only server, as the page's Save does.
    staged.set([])
    fire('loader/volatile-update')
    await vi.waitFor(async () => {
      expect(await readFile(patchFile, 'utf8')).not.toContain('mcp-example')
    })
  })
})
