/**
 * Patch-file fidelity tests.
 *
 * The whole point of this plugin is that a hand-maintained `cordis.patch.yml`
 * survives being edited from a UI. These tests pin that: comments, `!!js`
 * expressions, unrelated rows, and key order must come back unchanged, while the
 * MCP rows follow the staged list.
 */

import { describe, expect, it } from 'vitest'
import {
  applyServerList, deriveId, readSettings,
} from '../src/patch-store.js'
import { normalizeList } from '../src/index.js'
import { parsePatchFile } from '../src/patch-store.js'
import type { McpServer } from '../src/types.js'

/** A file shaped like the one this user already maintains. */
const EXISTING = `# My DSH patch layer.
# Keep the example server on this machine.
- insert:
    # The MCP bridge: one row per server.
    - id: mcp-example
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: example
        transport: stdio
        command: example
        args: [serve, --mcp]
        cwd: !!js process.cwd()

- id: some-unrelated-plugin
  config:
    keep: me

- insert:
    # Managed: the id follows this plugin's naming, so it may be rewritten.
    - id: mcp-memory-reference
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: reference_memory
        transport: stdio
        command: mcp-server-memory
        env:
          MEMORY_FILE_PATH: !!js process.env.MEMORY_FILE_PATH

    # Hand-written: a different id convention, so this row is never touched.
    - id: custom-memory
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: custom_memory
        transport: stdio
        command: my-memory-server
`

/** Parse a fixture. */
function load(text: string) {
  return parsePatchFile('/tmp/cordis.patch.yml', text, true)
}

/** The raw text of a document. */
function text(document: { toString(): string }): string {
  return document.toString()
}

describe('reading', () => {
  it('collects every MCP row and ignores unrelated ones', () => {
    const { servers } = readSettings(load(EXISTING).document)
    expect(servers.map(server => server.id)).toEqual(['mcp-example', 'mcp-memory-reference', 'custom-memory'])
  })

  it('reports which rows this plugin owns and which were written by hand', () => {
    const { servers } = readSettings(load(EXISTING).document)
    expect(servers.map(server => [server.id, server.origin])).toEqual([
      ['mcp-example', 'managed'],
      ['mcp-memory-reference', 'managed'],
      ['custom-memory', 'external'],
    ])
  })

  it('reads literals, lists, and expressions apart', () => {
    const [example, memory] = readSettings(load(EXISTING).document).servers
    expect(example).toMatchObject({
      serverName: 'example',
      transport: 'stdio',
      command: 'example',
      args: ['serve', '--mcp'],
    })
    // `cwd` is an expression, so it is not a literal value on the server; the
    // path and its source travel together instead.
    expect(example!.cwd).toBeUndefined()
    expect(example!.raw).toEqual([[['cwd'], 'process.cwd()']])
    expect(memory!.env).toBeUndefined()
    expect(memory!.raw).toEqual([[['env', 'MEMORY_FILE_PATH'], 'process.env.MEMORY_FILE_PATH']])
  })
})

describe('round trip', () => {
  it('keeps a save that changes nothing semantically faithful', () => {
    const loaded = load(EXISTING)
    const { servers } = readSettings(loaded.document)
    // The staged list is what the form holds; nothing is external here.
    applyServerList(loaded, servers)

    const out = text(loaded.document)
    // Every comment, every expression, and the unrelated plugin survive.
    expect(out).toContain('# My DSH patch layer.')
    expect(out).toContain('# Keep the example server on this machine.')
    expect(out).toContain('# The MCP bridge: one row per server.')
    expect(out).toContain('cwd: !!js process.cwd()')
    expect(out).toContain('MEMORY_FILE_PATH: !!js process.env.MEMORY_FILE_PATH')
    expect(out).toContain('id: some-unrelated-plugin')
    expect(out).toContain('keep: me')
    // Every server is still there exactly once, with its values intact.
    expect(out.match(/id: mcp-example/g)).toHaveLength(1)
    expect(out.match(/id: mcp-memory-reference/g)).toHaveLength(1)
    expect(out.match(/id: custom-memory/g)).toHaveLength(1)
    expect(readSettings(loaded.document).servers.map(server => server.id))
      .toEqual(['mcp-example', 'mcp-memory-reference', 'custom-memory'])
    // Re-reading and re-applying is stable: a second save is a no-op.
    const twice = load(out)
    applyServerList(twice, readSettings(twice.document).servers)
    expect(text(twice.document)).toBe(out)
  })
})

describe('config keys the editor does not expose', () => {
  const EXTRA = `- insert:
    - id: mcp-extra
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: extra
        transport: stdio
        command: run
        maxInstructionBytes: 65536
        reconnect:
          enabled: false
          maxAttempts: 3
        budget: !!js 1024 * 64
`

  it('reads them into extra and keeps expression leaves beside it', () => {
    const [server] = readSettings(load(EXTRA).document).servers
    expect(server!.extra).toEqual({
      maxInstructionBytes: 65536,
      reconnect: { enabled: false, maxAttempts: 3 },
    })
    expect(server!.raw).toEqual([[['budget'], '1024 * 64']])
  })

  it('writes them back unchanged, expression included', () => {
    const loaded = load(EXTRA)
    applyServerList(loaded, readSettings(loaded.document).servers)
    const out = text(loaded.document)
    expect(out).toContain('maxInstructionBytes: 65536')
    expect(out).toContain('enabled: false')
    expect(out).toContain('maxAttempts: 3')
    expect(out).toContain('budget: !!js 1024 * 64')
    // A second save is still a no-op: the extra data round-trips stably.
    const twice = load(out)
    applyServerList(twice, readSettings(twice.document).servers)
    expect(text(twice.document)).toBe(out)
  })
})

describe('adding', () => {
  it('appends a managed row and keeps every comment and expression', () => {
    const loaded = load(EXISTING)
    const added: McpServer = {
      id: 'mcp-github',
      serverName: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      raw: [[['env', 'GITHUB_TOKEN'], 'process.env.GITHUB_TOKEN']],
      origin: 'managed',
    }
    applyServerList(loaded, [...readSettings(loaded.document).servers, added])

    const out = text(loaded.document)
    expect(out).toContain('# My DSH patch layer.')
    expect(out).toContain('# The MCP bridge: one row per server.')
    expect(out).toContain('cwd: !!js process.cwd()')
    expect(out).toContain('MEMORY_FILE_PATH: !!js process.env.MEMORY_FILE_PATH')
    expect(out).toContain('id: some-unrelated-plugin')
    expect(out).toContain('keep: me')
    expect(out).toContain('id: mcp-github')
    expect(out).toContain('GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN')
    // The new row is readable back with the same shape it was staged as.
    const reread = readSettings(loaded.document).servers.find(server => server.id === 'mcp-github')
    expect(reread).toMatchObject({ serverName: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] })
    expect(reread!.raw).toEqual([[['env', 'GITHUB_TOKEN'], 'process.env.GITHUB_TOKEN']])
  })
})

describe('removing', () => {
  it('deletes the rows it owns and leaves every hand-written row alone', () => {
    const loaded = load(EXISTING)
    const { servers } = readSettings(loaded.document)
    applyServerList(loaded, [])
    const out = text(loaded.document)
    expect(out).not.toContain('id: mcp-example')
    expect(out).not.toContain('command: example')
    expect(out).not.toContain('id: mcp-memory-reference')
    expect(out).not.toContain('MEMORY_FILE_PATH')
    // A row with a different id convention is untouched, whatever it declares.
    expect(out).toContain('id: custom-memory')
    expect(out).toContain('command: my-memory-server')
    expect(out).toContain('id: some-unrelated-plugin')
    // Every comment survives, including the one above a removed row: it
    // documents the machine, not the row.
    expect(out).toContain('# My DSH patch layer.')
    expect(out).toContain('# Keep the example server on this machine.')
    expect(readSettings(loaded.document).servers.map(server => server.id)).toEqual(['custom-memory'])
    expect(servers).toHaveLength(3)
  })

  it('claims a hand-written row once the staged list carries its id', () => {
    const loaded = load(EXISTING)
    const handWritten = readSettings(loaded.document).servers.find(server => server.id === 'custom-memory')!
    applyServerList(loaded, [{ ...handWritten, command: 'renamed-binary' }])
    const out = text(loaded.document)
    expect(out).toContain('id: custom-memory')
    expect(out).toContain('command: renamed-binary')
    expect(out).not.toContain('command: my-memory-server')
  })

  it('does not leave an empty insert behind when the last server goes', () => {
    const loaded = load(`- insert:
    - id: mcp-only
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: only
        transport: stdio
        command: run
`)
    applyServerList(loaded, [])
    expect(text(loaded.document).trim()).toBe('[]')
  })
})

describe('editing', () => {
  it('rewrites a claimed row in place of the old one', () => {
    const loaded = load(EXISTING)
    const { servers } = readSettings(loaded.document)
    const example = servers.find(server => server.id === 'mcp-example')!
    const edited: McpServer = { ...example, command: 'example-next', origin: 'managed' }
    applyServerList(loaded, [edited])
    const out = text(loaded.document)
    expect(out).toContain('command: example-next')
    expect(out).not.toContain('command: example\n')
    // The expression on the same row is preserved rather than downgraded.
    expect(out).toContain('cwd: !!js process.cwd()')
  })

  it('keeps a URL row working for the http transport', () => {
    const loaded = load('[]\n')
    const server: McpServer = {
      id: 'mcp-web',
      serverName: 'web',
      transport: 'streamable-http',
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer literal' },
      origin: 'managed',
    }
    applyServerList(loaded, [server])
    const reread = readSettings(loaded.document).servers[0]!
    expect(reread).toMatchObject({
      serverName: 'web',
      transport: 'streamable-http',
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer literal' },
    })
  })
})

describe('file shapes', () => {
  it('creates a usable file from an empty one', () => {
    const loaded = load('[]\n')
    applyServerList(loaded, [{ id: 'mcp-a', serverName: 'a', transport: 'stdio', command: 'run-a', raw: [], origin: 'managed' }])
    const reread = readSettings(loaded.document)
    expect(reread.servers).toHaveLength(1)
    // `yaml` quotes the name because a leading `@` is a reserved indicator; both
    // forms parse to the same string.
    expect(text(loaded.document)).toContain('@deepseek-ai/dsh-mcp-client')
  })

  it('appends into the last existing patch object rather than a new one', () => {
    const loaded = load('- id: keep\n  config: { a: 1 }\n')
    applyServerList(loaded, [{ id: 'mcp-a', serverName: 'a', transport: 'stdio', command: 'x', raw: [], origin: 'managed' }])
    const out = text(loaded.document)
    expect(out.match(/- id: keep/g)).toHaveLength(1)
    expect(out).toContain('insert:')
    expect(out).toContain('id: keep')
    expect(readSettings(loaded.document).servers.map(server => server.id)).toEqual(['mcp-a'])
  })

  it('reads a patch file that only overrides an id', () => {
    const loaded = load("- id: mcp-a\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: a\n")
    // An override row is not an inserted row, so it declares no server to manage.
    expect(readSettings(loaded.document).servers).toHaveLength(0)
  })
})

describe('ids', () => {
  it('derives a stable, readable id', () => {
    expect(deriveId('github', new Set())).toBe('mcp-github')
    expect(deriveId('My Server!', new Set())).toBe('mcp-my-server')
    expect(deriveId('github', new Set(['mcp-github']))).toBe('mcp-github-2')
    expect(deriveId('///', new Set())).toBe('mcp-server')
  })
})

describe('validation', () => {
  it('rejects a namespace the MCP client would reject', () => {
    expect(() => normalizeList([{ serverName: 'bad name', transport: 'stdio', command: 'x' }]))
      .toThrow(/must match/)
  })

  it('requires the field each transport needs', () => {
    expect(() => normalizeList([{ serverName: 'a', transport: 'stdio' }])).toThrow(/needs a command/)
    expect(() => normalizeList([{ serverName: 'a', transport: 'streamable-http' }])).toThrow(/needs a url/)
  })

  it('refuses two servers that resolve to one id', () => {
    expect(() => normalizeList([
      { serverName: 'a', transport: 'stdio', command: 'x', id: 'same' },
      { serverName: 'b', transport: 'stdio', command: 'y', id: 'same' },
    ])).toThrow(/share the entry id/)
  })

  it('resolves defaults and drops empty optional fields', () => {
    const [server] = normalizeList([{ serverName: 'a', transport: 'stdio', command: 'x', cwd: '', args: [] }])
    expect(server).toMatchObject({ id: 'mcp-a', serverName: 'a', transport: 'stdio', command: 'x', origin: 'managed' })
    expect(server!.cwd).toBeUndefined()
    expect(server!.args).toBeUndefined()
  })
})
