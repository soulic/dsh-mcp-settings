/**
 * Parse a pasted MCP configuration into the page's draft shape.
 *
 * The page adds a server by accepting the same YAML a person would write in
 * `cordis.patch.yml`, rather than by asking for a dozen form fields. Three
 * spellings are accepted, because all three are things a person reasonably
 * copies from a working file:
 *
 * ```yaml
 * - insert:
 *     - id: mcp-example
 *       name: '@deepseek-ai/dsh-mcp-client'
 *       config: { … }
 * ```
 *
 * ```yaml
 * - id: mcp-example
 *   name: '@deepseek-ai/dsh-mcp-client'
 *   config: { … }
 * ```
 *
 * ```yaml
 * id: mcp-example
 * name: '@deepseek-ai/dsh-mcp-client'
 * config: { … }
 * ```
 *
 * One or several rows may be pasted at once. A `!!js` leaf is recorded as an
 * expression path plus its source, exactly as the Host does when it reads the
 * file, so a pasted `cwd: !!js process.cwd()` stays an expression all the way to
 * the write instead of becoming the literal string `process.cwd()`.
 */

import { MCP_CLIENT_NAME } from '../contract.js'
import { isMap, isSeq, parseDocument, readYamlNode } from '../yaml.js'
import type { YAMLMap } from '../yaml.js'
import { EDITOR_CONFIG_KEYS, isMapping } from '../types.js'
import type { ServerDraft } from './mcp-servers-controller.js'

/** The example the paste box shows, and the shape a pasted fragment should have. */
export const SNIPPET_EXAMPLE = `- insert:
    - id: mcp-example
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: example
        transport: stdio
        command: example-mcp-server
        args: [--stdio]
        cwd: !!js process.cwd()
`

/**
 * Why a pasted configuration was refused.
 *
 * Codes rather than sentences: the page owns the copy and is bilingual, while
 * `detail` carries the one value or parser message worth naming.
 */
export type SnippetIssueCode =
  | 'empty'
  | 'yaml'
  | 'shape'
  | 'notMcp'
  | 'missingConfig'
  | 'missingServerName'
  | 'badServerName'
  | 'missingTransport'
  | 'badTransport'
  | 'missingCommand'
  | 'missingUrl'
  | 'duplicate'

/** A refused paste: what went wrong, and the value or message that shows it. */
export interface SnippetIssue {
  /** Machine-readable reason. */
  code: SnippetIssueCode
  /** Row id, server name, transport, or parser message, depending on `code`. */
  detail: string
}

/** Either the parsed rows or the reason they were refused. */
export type SnippetResult = { rows: ServerDraft[] } | { issue: SnippetIssue }

/** A scalar string as `YAMLMap.get()` returns it, or undefined for anything else. */
function scalarOf(node: unknown): string | undefined {
  return typeof node === 'string' ? node : undefined
}

/** Whether a row names the MCP client plugin this page manages. */
function isMcpRow(name: string): boolean {
  return name === MCP_CLIENT_NAME || name.startsWith(`${MCP_CLIENT_NAME}/`)
}

/**
 * Collect the row mappings a pasted fragment declares.
 *
 * @param contents - the document root.
 * @returns the rows, or `undefined` when the fragment is not row-shaped.
 */
function rowNodesOf(contents: unknown): YAMLMap[] | undefined {
  const rows: YAMLMap[] = []
  const takeInsert = (item: YAMLMap): boolean => {
    const insert = item.get('insert', true)
    if (insert === undefined) return false
    if (!isSeq(insert)) return false
    for (const row of insert.items) {
      if (!isMap(row)) return false
      rows.push(row)
    }
    return true
  }

  if (isMap(contents)) {
    if (takeInsert(contents)) return rows
    // A lone row pasted without its leading `-`.
    if (contents.get('name', true) !== undefined || contents.get('config', true) !== undefined) {
      return [contents]
    }
    return undefined
  }
  if (!isSeq(contents)) return undefined

  for (const item of contents.items) {
    if (!isMap(item)) return undefined
    if (takeInsert(item)) continue
    // A bare row in a list, without the `insert:` wrapper.
    if (item.get('name', true) !== undefined || item.get('config', true) !== undefined) {
      rows.push(item)
      continue
    }
    return undefined
  }
  return rows
}

/** Derive an id for a row pasted without one, avoiding ids already in use. */
function deriveId(serverName: string, taken: ReadonlySet<string>): string {
  const slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server'
  const base = `mcp-${slug}`
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`
    if (!taken.has(candidate)) return candidate
  }
}

/** A YAML scalar as the string the MCP client's schema expects. */
function stringOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/** The readable strings of a YAML `env:`/`headers:` mapping. */
function pairsOf(value: unknown): Array<[string, string]> {
  if (!isMapping(value)) return []
  const pairs: Array<[string, string]> = []
  for (const [key, entry] of Object.entries(value)) {
    const text = stringOf(entry)
    if (text !== undefined) pairs.push([key, text])
  }
  return pairs
}

/** Read one row mapping into a draft, or say why it is not one. */
function draftOf(node: YAMLMap, taken: Set<string>): { draft: ServerDraft } | { issue: SnippetIssue } {
  const id = scalarOf(node.get('id'))?.trim() ?? ''
  const named = scalarOf(node.get('name'))?.trim() ?? ''
  if (!isMcpRow(named)) return { issue: { code: 'notMcp', detail: id === '' ? named : id } }

  const configNode = node.get('config', true)
  if (!isMap(configNode)) return { issue: { code: 'missingConfig', detail: id } }
  const raw: Array<[string[], string]> = []
  const value = readYamlNode(configNode, [], raw)
  const config = isMapping(value) ? value : {}

  const declaredName = config['serverName']
  if (typeof declaredName !== 'string' || declaredName.trim() === '') {
    return { issue: { code: 'missingServerName', detail: id } }
  }
  const serverName = declaredName.trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    return { issue: { code: 'badServerName', detail: serverName } }
  }

  const declaredTransport = config['transport']
  if (declaredTransport === undefined || declaredTransport === null || declaredTransport === '') {
    return { issue: { code: 'missingTransport', detail: id } }
  }
  if (declaredTransport !== 'stdio' && declaredTransport !== 'streamable-http') {
    return { issue: { code: 'badTransport', detail: String(declaredTransport) } }
  }
  const transport: ServerDraft['transport'] = declaredTransport

  const command = typeof config['command'] === 'string' ? config['command'] : ''
  const url = typeof config['url'] === 'string' ? config['url'] : ''
  if (transport === 'stdio' && command.trim() === '') return { issue: { code: 'missingCommand', detail: serverName } }
  if (transport === 'streamable-http' && url.trim() === '') return { issue: { code: 'missingUrl', detail: serverName } }

  const entryId = id === '' ? deriveId(serverName, taken) : id
  if (taken.has(entryId)) return { issue: { code: 'duplicate', detail: entryId } }
  taken.add(entryId)

  const declaredArgs = config['args']
  const args = Array.isArray(declaredArgs)
    ? declaredArgs.map(stringOf).filter((argument): argument is string => argument !== undefined)
    : []
  const declaredTimeout = config['toolCallTimeoutMs']
  const timeout = typeof declaredTimeout === 'number' && Number.isFinite(declaredTimeout)
    ? String(declaredTimeout)
    : typeof declaredTimeout === 'string' && declaredTimeout.trim() !== '' && Number.isFinite(Number(declaredTimeout))
      ? String(Number(declaredTimeout))
      : ''

  // Everything this page has no control for stays under `config` verbatim. The
  // expression leaves among them are already in `raw`, so they come back on the
  // write even though they are not part of `extra`.
  const extra: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(config)) {
    if (!EDITOR_CONFIG_KEYS.has(key) && entry !== undefined) extra[key] = entry
  }

  return {
    draft: {
      id: entryId,
      serverName,
      transport,
      command,
      args,
      cwd: typeof config['cwd'] === 'string' ? config['cwd'] : '',
      env: pairsOf(config['env']),
      url,
      headers: pairsOf(config['headers']),
      toolCallTimeoutMs: timeout,
      failOnStartupError: config['failOnStartupError'] === true,
      enabled: node.get('disabled') !== true,
      raw,
      extra,
      origin: 'managed',
    },
  }
}

/**
 * Parse a pasted configuration into drafts the page can stage.
 *
 * @param text - the pasted YAML.
 * @param taken - row ids already staged or declared; derived ids avoid them.
 * @returns the drafts, or the first reason the paste was refused.
 */
export function parseServerSnippet(text: string, taken: ReadonlySet<string>): SnippetResult {
  if (text.trim() === '') return { issue: { code: 'empty', detail: '' } }
  const document = parseDocument(text)
  const parseError = document.errors[0]
  if (parseError !== undefined) return { issue: { code: 'yaml', detail: parseError.message } }
  const nodes = rowNodesOf(document.contents)
  if (nodes === undefined || nodes.length === 0) return { issue: { code: 'shape', detail: '' } }

  const used = new Set(taken)
  const rows: ServerDraft[] = []
  for (const node of nodes) {
    const parsed = draftOf(node, used)
    if ('issue' in parsed) return parsed
    rows.push(parsed.draft)
  }
  return { rows }
}
