/**
 * Per-server enable/disable: the switch's state rides on the Loader row's
 * `disabled` key, not inside the MCP client configuration.
 */

import { describe, expect, it, vi } from 'vitest'
import { McpServersController } from '../src/client/mcp-servers-controller.js'
import { parseServerSnippet } from '../src/client/server-snippet.js'
import { normalizeList, type McpServerInput } from '../src/index.js'
import { applyServerList, parsePatchFile, readSettings } from '../src/patch-store.js'

const FILE = `- insert:
    - id: mcp-on
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: on
        transport: stdio
        command: run-on

    - id: mcp-off
      name: '@deepseek-ai/dsh-mcp-client'
      disabled: true
      config:
        serverName: off
        transport: stdio
        command: run-off
`

function load(text = FILE) {
  return parsePatchFile('/tmp/cordis.patch.yml', text, true)
}

function yamlOf(staged: unknown[]): string {
  const loaded = parsePatchFile('/tmp/cordis.patch.yml', '', false)
  applyServerList(loaded, normalizeList(staged as McpServerInput[]))
  return loaded.document.toString()
}

function harness(initial: unknown[]) {
  let value: { servers: unknown[], expressions?: Record<string, string> } = { servers: initial }
  let revision = 0
  const listeners = new Set<() => void>()
  const writes: unknown[][] = []
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
      for (const listener of listeners) listener()
      return true
    },
  }
  const controller = new McpServersController(scope as never, { logger: { debug: () => {} } } as never)
  return { face: controller.inject(), writes }
}

describe('enabling and disabling servers', () => {
  it('reads the Loader row disabled flag into the draft state', () => {
    const { servers } = readSettings(load().document)
    expect(servers.map(server => [server.id, server.enabled])).toEqual([
      ['mcp-on', true],
      ['mcp-off', false],
    ])
  })

  it('writes disabled at the row level and round-trips the switch', () => {
    const loaded = load()
    const servers = readSettings(loaded.document).servers
    servers[0]!.enabled = false
    servers[1]!.enabled = true
    applyServerList(loaded, servers)
    const out = loaded.document.toString()
    expect(out).toContain('disabled: true')
    expect(out).not.toMatch(/config:\n(?:.*\n)*?        disabled:/)
    expect(readSettings(load(out).document).servers.map(server => server.enabled)).toEqual([false, true])

    // Reapplying the same state is byte-stable, including a row that was
    // already disabled and an explicit `disabled: false` that was preserved.
    const twice = load(out)
    applyServerList(twice, readSettings(twice.document).servers)
    expect(twice.document.toString()).toBe(out)
  })

  it('parses a pasted disabled row', () => {
    const result = parseServerSnippet([
      '- insert:',
      '    - id: mcp-pasted',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      disabled: true',
      '      config: { serverName: pasted, transport: stdio, command: run }',
    ].join('\n'), new Set())
    expect('rows' in result && result.rows[0]?.enabled).toBe(false)
  })

  it('stages a switch flip and persists it on save', async () => {
    const { face, writes } = harness([{ id: 'mcp-a', serverName: 'a', transport: 'stdio', command: 'run', enabled: true }])
    face.toggleEnabled(0)
    expect(face.hooks.mcpServers.getSnapshot().rows[0]?.enabled).toBe(false)
    expect(face.hooks.mcpServers.getSnapshot().dirty).toBe(true)
    face.save()
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    expect(yamlOf(writes[0]!)).toContain('disabled: true')
  })
})
