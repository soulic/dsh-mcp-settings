/**
 * End-to-end tests for the host half.
 *
 * These drive the built plugin the way a running harness does: `apply()` is
 * called with a real Cordis context over a real patch file, and the file is read
 * back afterwards. That covers the paths unit tests cannot — the reconcile loop,
 * validation, the file lock, and the atomic write.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, normalizeList, type Config, type McpServerInput } from '../src/index.js'
import { MCP_CLIENT_NAME } from '../src/patch-store.js'

/** Minimal Cordis context: only what the plugin reads, plus event delivery. */
function fakeContext(settings?: { update: (ns: string, patch: object) => Promise<void> }) {
  const logged: string[] = []
  const effects: Array<() => void> = []
  const handlers = new Map<string, Array<(...args: never[]) => void>>()
  return {
    logged,
    ctx: {
      fiber: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (format: string, ...args: unknown[]) => { logged.push(`${format} ${args.join(' ')}`) },
      },
      effect: (run: () => unknown) => {
        const disposer = run()
        if (typeof disposer === 'function') effects.push(disposer as () => void)
        return () => {}
      },
      on: (event: string, handler: (...args: never[]) => void) => {
        const list = handlers.get(event) ?? []
        list.push(handler)
        handlers.set(event, list)
        return () => {}
      },
      get: (name: string) => (name === 'settings' ? settings : undefined),
      emit: () => {},
    },
    /** Deliver one Loader event, the way a save does. */
    fire: (event: string) => { for (const handler of handlers.get(event) ?? []) handler() },
    disposeAll: () => { for (const effect of effects.reverse()) effect() },
  }
}

let dir: string
let patchFile: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-mcp-settings-'))
  patchFile = join(dir, 'cordis.patch.yml')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Wrap a value the way the Loader hands a volatile field to a plugin. */
function live<T>(value: T): { get: () => T } {
  return { get: () => value }
}

/** Run `apply` to completion against the fixture file. */
async function run(
  config: Partial<Config>,
  settings?: { update: (ns: string, patch: object) => Promise<void> },
): Promise<ReturnType<typeof fakeContext>> {
  const harness = fakeContext(settings)
  await apply(harness.ctx as never, {
    patchFile: live(patchFile),
    watchFile: live(false),
    servers: live([]),
    ...config,
  })
  harness.disposeAll()
  return harness
}

describe('apply', () => {
  it('creates the file and its first row', async () => {
    await run({
      servers: live([{ serverName: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'server-github'] }]),
    })
    const text = await readFile(patchFile, 'utf8')
    expect(text).toContain('id: mcp-github')
    expect(text).toContain(MCP_CLIENT_NAME)
    expect(text).toContain('command: npx')
    expect(text).toContain('- -y')
  })

  it('adds a server without disturbing a hand-written row or its comments', async () => {
    await writeFile(patchFile, [
      '# keep this note',
      '- insert:',
      "    - id: mcp-example",
      `      name: '${MCP_CLIENT_NAME}'`,
      '      config:',
      '        serverName: example',
      '        transport: stdio',
      '        command: example',
      '        cwd: !!js process.cwd()',
      '',
    ].join('\n'))

    await run({
      servers: live([
        { id: 'mcp-example', serverName: 'example', transport: 'stdio', command: 'example' },
        { serverName: 'web', transport: 'streamable-http', url: 'http://localhost:3000/mcp' },
      ]),
      // The expression rides in the config field, which is where a staging round
      // trip keeps it.
      expressions: live({ 'mcp-example\u0000cwd': 'process.cwd()' }),
    })

    const text = await readFile(patchFile, 'utf8')
    expect(text).toContain('# keep this note')
    expect(text).toContain('cwd: !!js process.cwd()')
    expect(text).toContain('id: mcp-web')
    expect(text.match(/id: mcp-example/g)).toHaveLength(1)
  })

  it('keeps config keys the Settings form does not expose', async () => {
    await run({
      servers: live([{
        serverName: 'extra',
        transport: 'stdio',
        command: 'run',
        extra: { maxInstructionBytes: 65536, reconnect: { enabled: false, maxAttempts: 3 } },
      }]),
    })
    const text = await readFile(patchFile, 'utf8')
    expect(text).toContain('maxInstructionBytes: 65536')
    expect(text).toContain('enabled: false')
    expect(text).toContain('maxAttempts: 3')
  })

  it('removes a server when a save drops it from the staged list', async () => {
    // Removal is a save, not a boot: a boot that stages nothing over a file full
    // of rows must publish those rows rather than delete them.
    let staged: McpServerInput[] = [{ serverName: 'gone', transport: 'stdio', command: 'x' }]
    const harness = fakeContext()
    await apply(harness.ctx as never, {
      patchFile: live(patchFile),
      watchFile: live(false),
      servers: { get: () => staged },
    })
    expect(await readFile(patchFile, 'utf8')).toContain('id: mcp-gone')

    staged = []
    harness.fire('loader/volatile-update')
    await vi.waitFor(async () => {
      const text = await readFile(patchFile, 'utf8')
      expect(text).not.toContain('mcp-gone')
      expect(text.trim()).toBe('[]')
    })
    harness.disposeAll()
  })

  it('rejects a bad server before touching the file', async () => {
    // A configuration error is the profile's to report, not something to log and
    // carry on from: activation fails and the file keeps its previous content.
    await expect(run({ servers: live([{ serverName: 'bad name', transport: 'stdio', command: 'x' }]) }))
      .rejects.toThrow(/must match/)
    await expect(readFile(patchFile, 'utf8')).rejects.toThrow()
  })

  it('rejects a duplicate entry id rather than writing a partial list', async () => {
    await expect(run({
      servers: live([
        { serverName: 'a', transport: 'stdio', command: 'x', id: 'same' },
        { serverName: 'b', transport: 'stdio', command: 'y', id: 'same' },
      ]),
    })).rejects.toThrow(/share the entry id/)
  })

  it('leaves the file untouched when nothing changed', async () => {
    await run({ servers: live([{ serverName: 'stable', transport: 'stdio', command: 'run' }]) })
    const first = await readFile(patchFile, 'utf8')
    await run({ servers: live([{ id: 'mcp-stable', serverName: 'stable', transport: 'stdio', command: 'run' }]) })
    expect(await readFile(patchFile, 'utf8')).toBe(first)
  })

  it('is idempotent across repeated runs', async () => {
    const config: Partial<Config> = {
      servers: live([{ serverName: 'once', transport: 'stdio', command: 'run', args: ['a', 'b'] } satisfies McpServerInput]),
    }
    await run(config)
    const first = await readFile(patchFile, 'utf8')
    await run(config)
    await run(config)
    expect(await readFile(patchFile, 'utf8')).toBe(first)
  })

  it('mirrors the file\'s rows into the settings form on boot', async () => {
    // The page derives its list from the settings form, so a boot that read rows
    // the form has never seen must publish them: otherwise the page shows an
    // empty list while the file declares servers. This is the first-run state the
    // README documents — no `servers` staged, a file full of hand-written rows.
    await writeFile(patchFile, [
      '- insert:',
      "    - id: mcp-example",
      `      name: '${MCP_CLIENT_NAME}'`,
      '      config:',
      '        serverName: example',
      '        transport: stdio',
      '        command: example',
      '        cwd: !!js process.cwd()',
      '',
    ].join('\n'))

    const updates: Array<{ ns: string, patch: object }> = []
    await run({ servers: live([]) }, {
      update: async (ns, patch) => { updates.push({ ns, patch }) },
    })

    // Seeding is deferred until the fiber is active: doing it inside `apply`
    // deadlocks the profile reconcile that the settings write triggers.
    await vi.waitFor(() => { expect(updates).toHaveLength(1) })
    const mirrored = updates[0]?.patch as { servers: Array<{ id: string }>, expressions: Record<string, string> }
    expect(mirrored.servers.map(server => server.id)).toEqual(['mcp-example'])
    expect(mirrored.expressions).toMatchObject({ 'mcp-example\u0000cwd': 'process.cwd()' })
  })

  it('does not republish rows the settings form already holds', async () => {
    // A boot with the file's list already staged must not write the form back:
    // that would bump its revision on every start.
    const staged = [{ id: 'mcp-example', serverName: 'example', transport: 'stdio' as const, command: 'example' }]
    await run({ servers: live(staged) })

    const updates: Array<{ ns: string, patch: object }> = []
    await run({ servers: live(staged) }, {
      update: async (ns, patch) => { updates.push({ ns, patch }) },
    })

    expect(updates).toHaveLength(0)
  })
})

describe('normalizeList', () => {
  it('derives ids in list order', () => {
    const servers = normalizeList([
      { serverName: 'one', transport: 'stdio', command: 'a' },
      { serverName: 'one', transport: 'stdio', command: 'b' },
    ])
    expect(servers.map(server => server.id)).toEqual(['mcp-one', 'mcp-one-2'])
  })
})
