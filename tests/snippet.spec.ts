/**
 * Pasting a configuration is how a server is added now.
 *
 * The parser is the only place that turns YAML text into a staged server, so
 * these tests pin the shapes a person copies out of a real patch file — the
 * `- insert:` wrapper, bare rows, several rows at once — and the one thing that
 * cannot survive a naive parse: a `!!js` leaf must stay an expression, not
 * become the literal text `process.cwd()`.
 */

import { describe, expect, it } from 'vitest'
import { parseServerSnippet, SNIPPET_EXAMPLE } from '../src/client/server-snippet.js'
import type { ServerDraft } from '../src/client/mcp-servers-controller.js'

/** Parse or fail the test with the refusal reason. */
function parse(text: string, taken: string[] = []): ServerDraft[] {
  const result = parseServerSnippet(text, new Set(taken))
  if (!('rows' in result)) throw new Error(`refused: ${result.issue.code} ${result.issue.detail}`)
  return result.rows
}

/** The first row, which is all most tests need. */
function first(text: string, taken: string[] = []): ServerDraft {
  const [row] = parse(text, taken)
  if (row === undefined) throw new Error('no rows')
  return row
}

describe('pasting the documented snippet', () => {
  it('reads the wrapper, the fields, and the expression', () => {
    const row = first(SNIPPET_EXAMPLE)
    expect(row).toMatchObject({
      id: 'mcp-example',
      serverName: 'example',
      transport: 'stdio',
      command: 'example-mcp-server',
      args: ['--stdio'],
      // The expression replaces the literal value; its source rides beside it.
      cwd: '',
      toolCallTimeoutMs: '',
      failOnStartupError: false,
      origin: 'managed',
      extra: {},
    })
    expect(row.raw).toEqual([[['cwd'], 'process.cwd()']])
  })

  it('accepts the exact text when pasted with a trailing tab', () => {
    const pasted = [
      '- insert:',
      '    - id: mcp-example',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config:',
      '        serverName: example',
      '        transport: stdio',
      '        command: example-mcp-server',
      '        args: [--stdio]',
      '        cwd: !!js process.cwd()\t',
    ].join('\n')
    expect(first(pasted).raw).toEqual([[['cwd'], 'process.cwd()']])
  })
})

describe('accepted input shapes', () => {
  it('reads a bare list of rows without the insert wrapper', () => {
    const rows = parse([
      '- id: mcp-a',
      "  name: '@deepseek-ai/dsh-mcp-client'",
      '  config:',
      '    serverName: a',
      '    transport: stdio',
      '    command: run-a',
      '- id: mcp-b',
      "  name: '@deepseek-ai/dsh-mcp-client'",
      '  config:',
      '    serverName: b',
      '    transport: streamable-http',
      '    url: http://localhost:3000/mcp',
    ].join('\n'))
    expect(rows.map(row => [row.id, row.transport])).toEqual([
      ['mcp-a', 'stdio'],
      ['mcp-b', 'streamable-http'],
    ])
  })

  it('reads a lone row pasted without its leading dash', () => {
    const row = first([
      'id: mcp-lone',
      "name: '@deepseek-ai/dsh-mcp-client'",
      'config:',
      '  serverName: lone',
      '  transport: stdio',
      '  command: run',
    ].join('\n'))
    expect(row.id).toBe('mcp-lone')
  })

  it('reads several rows from one insert list', () => {
    const rows = parse([
      '- insert:',
      '    - id: mcp-a',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config: { serverName: a, transport: stdio, command: run-a }',
      '    - id: mcp-b',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config: { serverName: b, transport: stdio, command: run-b }',
    ].join('\n'))
    expect(rows.map(row => row.id)).toEqual(['mcp-a', 'mcp-b'])
  })

  it('derives an id when the row declares none, avoiding staged ids', () => {
    const row = first([
      "name: '@deepseek-ai/dsh-mcp-client'",
      'config: { serverName: github, transport: stdio, command: npx }',
    ].join('\n'), ['mcp-github'])
    expect(row.id).toBe('mcp-github-2')
  })
})

describe('scalar values', () => {
  it('writes env and args as the strings the MCP client schema expects', () => {
    const row = first([
      "name: '@deepseek-ai/dsh-mcp-client'",
      'config:',
      '  serverName: scalars',
      '  transport: stdio',
      '  command: run',
      '  args: [1, true, text]',
      '  env:',
      '    PORT: 3000',
      '    DEBUG: true',
    ].join('\n'))
    expect(row.args).toEqual(['1', 'true', 'text'])
    expect(row.env).toEqual([['PORT', '3000'], ['DEBUG', 'true']])
  })
})

describe('fields the editor does not show', () => {
  it('keeps them in extra instead of dropping them', () => {
    const row = first([
      "name: '@deepseek-ai/dsh-mcp-client'",
      'config:',
      '  serverName: extra',
      '  transport: stdio',
      '  command: run',
      '  maxInstructionBytes: 65536',
      '  reconnect:',
      '    enabled: false',
      '    maxAttempts: 3',
    ].join('\n'))
    expect(row.extra).toEqual({
      maxInstructionBytes: 65536,
      reconnect: { enabled: false, maxAttempts: 3 },
    })
  })

  it('keeps an expression inside an unexposed key', () => {
    const row = first([
      "name: '@deepseek-ai/dsh-mcp-client'",
      'config:',
      '  serverName: extra',
      '  transport: stdio',
      '  command: run',
      '  maxInstructionBytes: !!js 1024 * 64',
      '  env:',
      '    TOKEN: !!js process.env.TOKEN',
    ].join('\n'))
    expect(row.extra).toEqual({})
    expect(row.env).toEqual([])
    expect(row.raw).toEqual([
      [['maxInstructionBytes'], '1024 * 64'],
      [['env', 'TOKEN'], 'process.env.TOKEN'],
    ])
  })
})

describe('refusals', () => {
  it('calls out an empty paste', () => {
    const result = parseServerSnippet('   \n', new Set())
    expect('issue' in result && result.issue.code).toBe('empty')
  })

  it('calls out invalid YAML with the parser message', () => {
    const result = parseServerSnippet('- insert: [', new Set())
    expect('issue' in result && result.issue.code).toBe('yaml')
    expect('issue' in result && result.issue.detail).not.toBe('')
  })

  it('refuses text that is neither a patch nor a row', () => {
    const result = parseServerSnippet('foo: bar', new Set())
    expect('issue' in result && result.issue.code).toBe('shape')
  })

  it('refuses a row for another plugin', () => {
    const result = parseServerSnippet([
      '- id: other',
      "  name: '@deepseek-ai/dsh-client-ui-settings'",
      '  config: { serverName: other }',
    ].join('\n'), new Set())
    expect('issue' in result && result.issue.code).toBe('notMcp')
  })

  it('refuses a duplicate id, staged or inside the paste', () => {
    const pasted = [
      "name: '@deepseek-ai/dsh-mcp-client'",
      'id: mcp-taken',
      'config: { serverName: taken, transport: stdio, command: run }',
    ].join('\n')
    const staged = parseServerSnippet(pasted, new Set(['mcp-taken']))
    expect('issue' in staged && staged.issue.code).toBe('duplicate')

    const twice = parseServerSnippet([
      '- insert:',
      '    - id: mcp-same',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config: { serverName: same, transport: stdio, command: run }',
      '    - id: mcp-same',
      "      name: '@deepseek-ai/dsh-mcp-client'",
      '      config: { serverName: same2, transport: stdio, command: run }',
    ].join('\n'), new Set())
    expect('issue' in twice && twice.issue.code).toBe('duplicate')
  })

  it('refuses what the MCP client itself would refuse', () => {
    expect(() => parse("name: '@deepseek-ai/dsh-mcp-client'\nconfig: { serverName: 'bad name', transport: stdio, command: run }"))
      .toThrow(/badServerName/)
    expect(() => parse("name: '@deepseek-ai/dsh-mcp-client'\nconfig: { serverName: a, transport: stdio }"))
      .toThrow(/missingCommand/)
    expect(() => parse("name: '@deepseek-ai/dsh-mcp-client'\nconfig: { serverName: a, transport: streamable-http }"))
      .toThrow(/missingUrl/)
    expect(() => parse("name: '@deepseek-ai/dsh-mcp-client'\nconfig: { serverName: a, transport: web, command: run }"))
      .toThrow(/badTransport/)
    expect(() => parse("name: '@deepseek-ai/dsh-mcp-client'\nconfig: { transport: stdio, command: run }"))
      .toThrow(/missingServerName/)
    expect(() => parse("name: '@deepseek-ai/dsh-mcp-client'\nconfig: { serverName: a, command: run }"))
      .toThrow(/missingTransport/)
  })
})
