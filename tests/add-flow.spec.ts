/**
 * The add-a-server path, from a pasted configuration to the YAML it produces.
 *
 * `snippet.spec.ts` covers parsing; this closes the loop through the page's
 * controller and the Host's list normalization, so a regression in the handoff
 * between the two — a `!!js` leaf staged as a literal, or an unexposed config key
 * dropped on the way — fails here rather than in the running app.
 */

import { describe, expect, it, vi } from 'vitest'
import { McpServersController } from '../src/client/mcp-servers-controller.js'
import { SNIPPET_EXAMPLE } from '../src/client/server-snippet.js'
import { normalizeList, type McpServerInput } from '../src/index.js'
import { applyServerList, parsePatchFile } from '../src/patch-store.js'

/** A settings form the controller can read and write, with no Host behind it. */
function harness(initial: unknown[] = []) {
  let value: { servers: unknown[], expressions?: Record<string, string> } = { servers: initial }
  let revision = 0
  const listeners = new Set<() => void>()
  const writes: unknown[][] = []
  const expressionWrites: Array<Record<string, string> | undefined> = []
  const scope = {
    getSnapshot: () => ({
      status: 'ready' as const,
      value,
      base: undefined,
      user: undefined,
      writable: true,
      revision,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate: async (ops: ReadonlyArray<{ op: string, path: readonly string[], value?: unknown }>) => {
      for (const op of ops) {
        if (op.op !== 'set') continue
        if (op.path[0] === 'servers') value = { ...value, servers: op.value as unknown[] }
        if (op.path[0] === 'expressions') value = { ...value, expressions: op.value as Record<string, string> }
      }
      revision += 1
      writes.push(value.servers)
      expressionWrites.push(value.expressions)
      for (const listener of listeners) listener()
      return true
    },
  }
  const ctx = { logger: { debug: () => {} } }
  const controller = new McpServersController(scope as never, ctx as never)
  return { controller, face: controller.inject(), writes, expressionWrites }
}

/** Write the list a save produced into an empty patch file and return its YAML. */
function yamlOf(staged: unknown[]): string {
  const loaded = parsePatchFile('/tmp/cordis.patch.yml', '', false)
  applyServerList(loaded, normalizeList(staged as McpServerInput[]))
  return loaded.document.toString()
}

/** Wait for the controller's fire-and-forget save to reach the form. */
async function settle(writes: unknown[][]): Promise<unknown[]> {
  await vi.waitFor(() => { expect(writes).toHaveLength(1) })
  return writes[0]!
}

describe('adding a server by pasting a configuration', () => {
  it('stages the pasted row, marks the page dirty, and saves it', async () => {
    const { face, writes, expressionWrites } = harness()
    expect(face.add(SNIPPET_EXAMPLE)).toBeUndefined()
    expect(face.hooks.mcpServers.getSnapshot().dirty).toBe(true)
    expect(face.hooks.mcpServers.getSnapshot().rows.map(row => row.id)).toEqual(['mcp-example'])

    face.save()
    const staged = await settle(writes)
    const yaml = yamlOf(staged)
    expect(yaml).toContain('id: mcp-example')
    expect(yaml).toContain('@deepseek-ai/dsh-mcp-client')
    expect(yaml).toContain('command: example-mcp-server')
    expect(yaml).toContain('- --stdio')
    // The whole point: the expression reaches the file as an expression.
    expect(yaml).toContain('cwd: !!js process.cwd()')
    // ...and the Host's `expressions` field records the same source, so a later
    // save cannot restore a stale value over it.
    expect(expressionWrites[0]).toEqual({ 'mcp-example\u0000cwd': 'process.cwd()' })
  })

  it('is clean when the Host-spelled list means the same values', () => {
    // The Host publishes `raw: []` and its own key order; the page stages neither.
    // That spelling difference is not an edit, so Save must stay disabled.
    const { face } = harness([
      { id: 'mcp-a', serverName: 'a', transport: 'stdio', raw: [], command: 'run', extra: {} },
    ])
    expect(face.hooks.mcpServers.getSnapshot().dirty).toBe(false)
  })

  it('keeps config keys and expressions the editor does not show', async () => {
    const { face, writes } = harness()
    face.add([
      '- insert:',
      '    - id: mcp-extra',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: extra',
      '        transport: stdio',
      '        command: run',
      '        maxInstructionBytes: 65536',
      '        reconnect:',
      '          enabled: false',
      '          maxAttempts: 3',
      '        budget: !!js 1024 * 64',
    ].join('\n'))
    face.save()
    const yaml = yamlOf(await settle(writes))
    expect(yaml).toContain('maxInstructionBytes: 65536')
    expect(yaml).toContain('enabled: false')
    expect(yaml).toContain('maxAttempts: 3')
    expect(yaml).toContain('budget: !!js 1024 * 64')
  })

  it('refuses a second paste that reuses a staged entry id', () => {
    const { face } = harness()
    expect(face.add(SNIPPET_EXAMPLE)).toBeUndefined()
    const issue = face.add(SNIPPET_EXAMPLE)
    expect(issue?.code).toBe('duplicate')
    // The refused paste is not staged.
    expect(face.hooks.mcpServers.getSnapshot().rows).toHaveLength(1)
  })

  it('leaves the staged list alone when the paste is malformed', () => {
    const { face } = harness([{ id: 'mcp-existing', serverName: 'existing', transport: 'stdio', command: 'run' }])
    const issue = face.add('not: [a patch')
    expect(issue?.code).toBe('yaml')
    expect(face.hooks.mcpServers.getSnapshot().rows.map(row => row.id)).toEqual(['mcp-existing'])
  })
})
