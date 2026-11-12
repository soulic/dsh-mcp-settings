/**
 * Read and rewrite the MCP rows of a `cordis.patch.yml`.
 *
 * This is the whole persistence layer: the Settings page stages a complete
 * server list, {@link applyServerList} derives the difference against the rows
 * the file actually holds, and the file stays authoritative. Rows this plugin
 * did not create are never rewritten or deleted — they are reported as
 * `external` so the page can show them read-only.
 *
 * Every edit goes through a YAML document rather than a round-tripped object, so
 * comments, blank lines, key order, and `!!js` tags survive: reloading or saving
 * from the Settings page must not reformat a hand-maintained file.
 *
 * The plugin never re-applies its own write. A profile launched by `dsh` already
 * watches this file (and the profile patch) and reconciles the root Include on
 * every change, so writing the file is the whole update.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isPair, isScalar, isSeq, JS_TAG, parseDocument, readYamlNode, Scalar } from './yaml.js'
import type { YAMLMap, YAMLSeq, YamlNode } from './yaml.js'
import {
  EDITOR_CONFIG_KEYS, EMPTY_PATCH_FILE, isJsExpression, isMapping,
  type LoadedPatchFile, type McpServer, type McpSettings, type PatchDocument,
} from './types.js'
import { MCP_CLIENT_NAME } from './contract.js'

export { MCP_CLIENT_NAME }

/** Entry-id prefix this plugin uses for rows it creates. */
export const MANAGED_ID_PREFIX = 'mcp-'

/**
 * Parse a patch file's text into an editable document.
 *
 * @param path - absolute path the text came from, used only for diagnostics.
 * @param before - the file's current text.
 * @param exists - whether the file exists; `false` accepts empty text.
 * @returns the loaded document.
 * @throws {Error} when the text is not a YAML sequence of patch objects.
 */
export function parsePatchFile(path: string, before: string, exists: boolean): LoadedPatchFile {
  const document = parseDocument(before === '' && !exists ? EMPTY_PATCH_FILE : before)
  if (document.errors[0] !== undefined) {
    throw new Error(`patch file ${path} is not valid YAML: ${document.errors[0].message}`)
  }
  if (!isSeq(document.contents)) {
    throw new Error(`patch file ${path} must hold a YAML sequence of patch objects`)
  }
  document.contents.flow = false
  return { path, exists, before, document: document as unknown as PatchDocument }
}

/**
 * Read a patch file from disk.
 *
 * @param path - absolute path of the patch file.
 * @returns the parsed document; a missing file yields an empty sequence.
 */
export async function readPatchFile(path: string): Promise<LoadedPatchFile> {
  let before: string
  try {
    before = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return parsePatchFile(path, '', false)
  }
  return parsePatchFile(path, before, true)
}

/** One `insert` element, with the path needed to address it in the document. */
interface InsertedRow {
  /** Index of the enclosing patch object within the top-level sequence. */
  patchIndex: number
  /** Index of this row within that patch's `insert` array. */
  rowIndex: number
  /** The row node itself. */
  node: YAMLMap
}

/** The top-level patch sequence, or `undefined` when the root is not a sequence. */
function rootSeq(document: PatchDocument): YAMLSeq | undefined {
  const contents = document.contents
  return isSeq(contents) ? contents : undefined
}

/** A node's scalar string value, or `undefined` for a non-scalar or absent key. */
function scalarOf(node: unknown): string | undefined {
  // `YAMLMap.get()` unwraps a Scalar to its value and leaves collections as
  // nodes, so a string here is already the scalar this function is after.
  return typeof node === 'string' ? node : undefined
}

/** Every `insert` element of the top-level sequence, in document order. */
function insertedRows(document: PatchDocument): InsertedRow[] {
  const patches = rootSeq(document)
  if (patches === undefined) return []
  const rows: InsertedRow[] = []
  patches.items.forEach((patch, patchIndex) => {
    if (!isMap(patch)) return
    const insert = patch.get('insert')
    if (!isSeq(insert)) return
    insert.items.forEach((row, rowIndex) => {
      if (isMap(row)) rows.push({ patchIndex, rowIndex, node: row })
    })
  })
  return rows
}

/** Whether a row's `name` declares the MCP client plugin. */
function isMcpRow(name: string | undefined): boolean {
  if (name === undefined) return false
  return name === MCP_CLIENT_NAME || name.startsWith(`${MCP_CLIENT_NAME}/`)
}

/**
 * Read every MCP server the document declares, with its expression leaves.
 *
 * @param document - the parsed patch document.
 * @returns the settings payload the page renders and stages edits over.
 */
export function readSettings(document: PatchDocument): McpSettings {
  const servers: McpServer[] = []
  for (const { node } of insertedRows(document)) {
    if (!isMcpRow(scalarOf(node.get('name')))) continue
    const id = scalarOf(node.get('id'))
    if (id === undefined) continue
    servers.push(projectRow(id, node))
  }
  return { servers }
}

/** Read one row's `config` mapping into the wire shape, recording `!!js` leaves. */
function projectRow(id: string, row: YAMLMap): McpServer {
  const raw: Array<[string[], string]> = []
  const config = readYamlNode(row.get('config', true), [], raw)
  const mapping = isMapping(config) ? config : {}
  const transport = mapping['transport'] === 'streamable-http' ? 'streamable-http' : 'stdio'
  const declaredName = mapping['serverName']
  const serverName = typeof declaredName === 'string' ? declaredName : id
  // `disabled` is a Loader-row concern, not an MCP-client config field. Reading
  // it here keeps a row's enabled state in the same staged list as its fields.
  const server: McpServer = {
    id,
    serverName,
    transport,
    raw,
    enabled: row.get('disabled') !== true,
    origin: isManagedId(id) ? 'managed' : 'external',
  }

  if (transport === 'stdio') {
    if (typeof mapping['command'] === 'string') server.command = mapping['command']
    if (Array.isArray(mapping['args'])) server.args = mapping['args'].map(String)
    if (typeof mapping['cwd'] === 'string') server.cwd = mapping['cwd']
    if (isMapping(mapping['env'])) {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(mapping['env'])) if (typeof value === 'string') env[key] = value
      if (Object.keys(env).length > 0) server.env = env
    }
  } else {
    if (typeof mapping['url'] === 'string') server.url = mapping['url']
    if (isMapping(mapping['headers'])) {
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(mapping['headers'])) {
        if (typeof value === 'string') headers[key] = value
      }
      if (Object.keys(headers).length > 0) server.headers = headers
    }
  }

  if (typeof mapping['toolCallTimeoutMs'] === 'number') server.toolCallTimeoutMs = mapping['toolCallTimeoutMs']
  if (typeof mapping['failOnStartupError'] === 'boolean') {
    server.failOnStartupError = mapping['failOnStartupError']
  }
  // Everything the editor does not name — `reconnect`, `maxInstructionBytes`, a
  // key a newer MCP client adds — travels in `extra` so a save through the form
  // cannot drop it. The alternative, enumerating them here, is what made an
  // edit from the page silently delete `reconnect`.
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(mapping)) {
    if (!EDITOR_CONFIG_KEYS.has(key) && value !== undefined) extra[key] = value
  }
  if (Object.keys(extra).length > 0) server.extra = extra
  return server
}

/**
 * Derive the row id this plugin uses for a server it creates.
 *
 * @param serverName - the server's namespace.
 * @param taken - ids already present in the file.
 * @returns a unique id under {@link MANAGED_ID_PREFIX}.
 */
export function deriveId(serverName: string, taken: ReadonlySet<string>): string {
  const slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server'
  const base = `${MANAGED_ID_PREFIX}${slug}`
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Whether this plugin owns the row with the given id.
 *
 * Ownership is derived from the id rather than recorded in the row, because a
 * marker stored in the config would not survive the round trip through the
 * Settings form: the form stages plain values, and the Host's schema drops what
 * it did not declare. A row whose id follows this plugin's naming is one it
 * wrote, so it may be rewritten and removed; any other MCP row was authored by
 * hand and is left alone.
 *
 * @param id - the row's entry id, or `undefined` when it declares none.
 * @returns true when this plugin owns the row.
 */
export function isManagedId(id: string | undefined): boolean {
  return id !== undefined && id.startsWith(MANAGED_ID_PREFIX)
}

/**
 * Rewrite the file so it declares exactly the servers in `servers`.
 *
 * Rows this plugin does not own — anything outside {@link MANAGED_ID_PREFIX} —
 * are never touched. Every owned row is replaced by a freshly created one, so
 * removing a server removes its row, and the remaining rows keep their place in
 * the file.
 *
 * @param loaded - the document to edit in place.
 * @param servers - the desired servers, in order, with expressions resolved.
 */
export function applyServerList(
  loaded: LoadedPatchFile,
  servers: readonly McpServer[],
): void {
  const document = loaded.document
  const patches = rootSeq(document)
  if (patches === undefined) throw new Error('patch file root is not a sequence')

  // Every MCP row this plugin owns: rows the file declares that this plugin may
  // rewrite or remove. A hand-written row is off limits until the staged list
  // claims its id.
  //
  // Ids are read now, before anything mutates the document: replacing a row
  // detaches the node it replaced, so a reference held across the rewrite can no
  // longer be read.
  const claimed = new Set(servers.map(server => server.id))
  const owned: Array<{ patchIndex: number, rowIndex: number, node: YAMLMap, id: string | undefined }> = []
  for (const row of insertedRows(document)) {
    if (!isMcpRow(scalarOf(row.node.get('name')))) continue
    const id = scalarOf(row.node.get('id'))
    // A row is this plugin's either because its id follows the plugin's naming or
    // because the staged list claims exactly that id. A hand-written row the
    // staged list does not name is left alone.
    if (!isManagedId(id) && (id === undefined || !claimed.has(id))) continue
    owned.push({ ...row, id })
  }

  const dropped = owned.filter(row => row.id === undefined || !claimed.has(row.id))

  // Remove the dropped rows AND any patch object they leave empty. The two steps
  // are kept apart deliberately: splicing a whole patch object out shifts the
  // indices of the patches not yet visited, so removing rows and removing patches
  // in the same pass would delete the wrong patch.
  //
  // `deleteIn` is deliberately not used: it leaves a `null` in the sequence
  // instead of shortening it, which would put a stray entry in a hand-written
  // file.
  //
  // A comment above a removed patch object is kept: it documents the machine, not
  // the row.
  const commentAbove = (patch: unknown): void => {
    if (!isMap(patch)) return
    const comment = patch.commentBefore
    if (typeof comment === 'string' && comment !== '') patches.commentBefore = comment
  }
  const droppingPatches = [...new Set(dropped.map(row => row.patchIndex))]
    .sort((left, right) => right - left)
  for (const patchIndex of droppingPatches) {
    const insert = document.getIn([patchIndex, 'insert'])
    if (!isSeq(insert)) continue
    for (const rowIndex of dropped
      .filter(row => row.patchIndex === patchIndex)
      .map(row => row.rowIndex)
      .sort((left, right) => right - left)) {
      insert.items.splice(rowIndex, 1)
    }
  }
  for (const patchIndex of droppingPatches) {
    const patch = patches.items[patchIndex]
    if (!isMap(patch)) continue
    const insert = patch.get('insert')
    if (isSeq(insert) && insert.items.length > 0) continue
    commentAbove(patch)
    patches.items.splice(patchIndex, 1)
  }

  // Both removals shift the coordinates a surviving row was recorded under: a
  // patch object's position moves down by every patch removed before it, and a
  // row's position inside its own `insert` moves down by every row removed before
  // it there. Recomputing both is what makes the rewrite land on the row itself
  // instead of appending a duplicate beside it.
  const removedPatchesBefore = (patchIndex: number): number =>
    droppingPatches.filter(index => index < patchIndex).length
  const removedRowsBefore = (row: { patchIndex: number, rowIndex: number }): number =>
    dropped.filter(other => other.patchIndex === row.patchIndex && other.rowIndex < row.rowIndex).length

  // Rewrite each server the file already declares, in place: reusing the leaf
  // nodes it did not change is what keeps flow style, quoting, and folding
  // exactly as the file spelled them.
  const byId = new Map(owned.filter(row => row.id !== undefined).map(row => [row.id as string, row]))
  const append: McpServer[] = []
  for (const server of servers) {
    const row = byId.get(server.id)
    if (row === undefined) {
      append.push(server)
      continue
    }
    const patchIndex = row.patchIndex - removedPatchesBefore(row.patchIndex)
    const rowIndex = row.rowIndex - removedRowsBefore(row)
    document.setIn([patchIndex, 'insert', rowIndex], rowNode(document, server, sourceOf(row.node, server)))
  }
  if (append.length === 0) return

  // A server with no row yet is appended. With no patch object left there is
  // nothing to hang an `insert` on, so each row becomes its own patch object.
  if (patches.items.length === 0) {
    for (const server of append) {
      patches.add(document.createNode({ insert: [rowNode(document, server, undefined)] }) as YamlNode)
    }
    return
  }

  const lastPatch = patches.items.length - 1
  if (!isSeq(document.getIn([lastPatch, 'insert']))) {
    document.setIn([lastPatch, 'insert'], document.createNode([]))
  }
  const insertPath: [number, string] = [lastPatch, 'insert']
  for (const server of append) {
    const insert = document.getIn(insertPath)
    if (!isSeq(insert)) throw new Error('patch file insert is not a sequence')
    insert.add(rowNode(document, server, undefined))
  }
}

/**
 * The formatting a rebuild should reuse for one server's row.
 *
 * @param node - the row node the file already holds.
 * @param server - the staged server, whose `raw` paths name its expressions.
 * @returns the existing config node and the top-level keys that hold an expression.
 */
function sourceOf(node: YAMLMap, server: McpServer): MergeSource {
  const config = node.get('config', true)
  const raw = new Set((server.raw ?? []).map(([path]) => path[0] ?? ''))
  return { row: node, config: isMap(config) ? config : undefined, raw }
}

/**
 * Move a comment off a node that is about to be deleted onto its successor.
 *
 * `yaml` hangs a leading comment on the node that follows it, so deleting that
 * node would take a hand-written note with it — including the file's own header
 * when the first patch object goes.
 *
 * @param doomed - the node being removed, if it is one.
 * @param successor - the node that will take its place, if there is one.
 */
function rescueComment(doomed: unknown, successor: unknown): void {
  if (!isMap(doomed)) return
  const comment = doomed.commentBefore
  if (typeof comment !== 'string' || comment === '') return
  doomed.commentBefore = undefined
  if (isMap(successor)) {
    successor.commentBefore = successor.commentBefore === undefined || successor.commentBefore === null
      ? comment
      : `${comment}\n${String(successor.commentBefore)}`
  }
}

/**
 * Build one loader row for a server, as plain data.
 *
 * A `!!js` leaf is left as a {@link StagedExpression} placeholder, which
 * {@link rowNode} replaces with a tagged scalar before the node exists.
 */
function serverToRow(server: McpServer): Record<string, unknown> {
  // `extra` is config-relative to this row, so it is laid down first: the fields
  // the editor names below always win over a stale key of the same name.
  const config: Record<string, unknown> = { ...(server.extra ?? {}) }
  config['serverName'] = server.serverName
  config['transport'] = server.transport
  if (server.transport === 'stdio') {
    if (server.command !== undefined) config['command'] = server.command
    if (server.args !== undefined && server.args.length > 0) config['args'] = [...server.args]
    if (server.cwd !== undefined && server.cwd !== '') config['cwd'] = server.cwd
    if (server.env !== undefined && Object.keys(server.env).length > 0) config['env'] = { ...server.env }
  } else {
    if (server.url !== undefined) config['url'] = server.url
    if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
      config['headers'] = { ...server.headers }
    }
  }
  if (server.toolCallTimeoutMs !== undefined) config['toolCallTimeoutMs'] = server.toolCallTimeoutMs
  if (server.failOnStartupError !== undefined) config['failOnStartupError'] = server.failOnStartupError
  const row: Record<string, unknown> = { id: server.id, name: MCP_CLIENT_NAME, config }
  if (server.enabled === false) row['disabled'] = true
  return row
}

/** The row a rebuild should keep formatting from, when the same id already exists. */
interface MergeSource {
  /** The row node the file already holds. */
  readonly row: YAMLMap
  /** The row's existing `config` node. */
  readonly config: YAMLMap | undefined
  /** Config paths that are `!!js` expressions this rebuild has a source for. */
  readonly raw: ReadonlySet<string>
}

/** Build the row node a loader will read, with `!!js` leaves already tagged. */
function rowNode(document: PatchDocument, server: McpServer, source: MergeSource | undefined): YamlNode {
  const staged = serverToRow(stageExpressions(server))
  const config = staged['config'] as Record<string, unknown>
  const merged = source === undefined || source.config === undefined
    ? config
    : mergeConfig(document, config, source)
  const row: Record<string, unknown> = { id: server.id, name: MCP_CLIENT_NAME, config: merged }
  // The `name` value never changes, so the file's own spelling of it is kept
  // rather than re-emitted with this writer's quoting.
  if (source !== undefined && scalarOf(source.row.get('name')) === MCP_CLIENT_NAME) {
    const existingName = source.row.get('name', true)
    if (existingName !== undefined) row['name'] = existingName
  }
  // `disabled` is row-level Loader configuration, next to `config` rather than
  // inside it. Keep an existing `false` (or an expression the page cannot
  // evaluate) when the server is enabled; only a disabled server needs the key.
  if (server.enabled === false) {
    const existingDisabled = source?.row.get('disabled', true)
    row['disabled'] = sameData(existingDisabled, true) ? existingDisabled : true
  } else if (source !== undefined) {
    const existingDisabled = source.row.get('disabled', true)
    if (existingDisabled !== undefined && !sameData(existingDisabled, true)) row['disabled'] = existingDisabled
  }
  return document.createNode(stampExpressions(row) as Record<string, unknown>) as YamlNode
}

/**
 * Build a `config` node, reusing the scalar and collection nodes an unchanged
 * leaf already has.
 *
 * A rebuild is what makes add, edit, remove, and reorder one code path, but
 * recreating every leaf from data would silently reformat a hand-written file:
 * `[serve, --mcp]` becomes `[ serve, --mcp ]`, `'@scope/pkg'` loses its quotes,
 * and a folded block becomes one long line. Reusing the existing node for a leaf
 * this edit did not touch keeps the file's own spelling, while a leaf that did
 * change is rebuilt from its value.
 *
 * @param document - the owning document, for creating new nodes.
 * @param config - the staged config as plain data.
 * @param source - the existing row's node and its expression paths.
 * @returns the value to hand to `createNode()`.
 */
function mergeConfig(document: PatchDocument, config: Record<string, unknown>, source: MergeSource): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    const path = [key]
    const expression = source.raw.has(key)
    const existing = source.config?.get(key, true)
    // An expression this rebuild carries replaces whatever was there; an
    // unchanged leaf keeps its node, so nothing rewrites it.
    out[key] = !expression && existing !== undefined && !containsNode(value)
      ? reuseOrCreate(document, existing, value)
      : value
  }
  return out
}

/** Whether a staged value already contains a YAML node (a tagged scalar). */
function containsNode(value: unknown): boolean {
  if (isStagedExpression(value)) return true
  if (Array.isArray(value)) return value.some(containsNode)
  if (typeof value === 'object' && value !== null) return Object.values(value).some(containsNode)
  return false
}

/** Keep an existing node when it already spells the staged value. */
function reuseOrCreate(document: PatchDocument, existing: unknown, value: unknown): unknown {
  if (sameData(existing, value)) return existing
  if (Array.isArray(value) && isSeq(existing) && existing.items.length === value.length) {
    return value.map((item, index) => reuseOrCreate(document, existing.items[index], item))
  }
  if (isMapping(value) && isMap(existing)) {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      const existingNested = existing.get(key, true)
      out[key] = existingNested === undefined ? nested : reuseOrCreate(document, existingNested, nested)
    }
    return out
  }
  return value
}

/** Compare a node's plain value with staged data. */
function sameData(node: unknown, value: unknown): boolean {
  return isScalar(node) && node.value === value
}

/**
 * Replace every staged expression placeholder with a syntax-tagged scalar.
 *
 * The tag has to be on the value itself: `createNode()` walks plain data by
 * reference and does not consult the schema, so a placeholder object would
 * otherwise be serialized as an ordinary mapping.
 *
 * @param value - the staged value, rewritten in place.
 * @returns the same value with placeholders replaced.
 */
function stampExpressions(value: unknown): unknown {
  if (isStagedExpression(value)) {
    const scalar = new Scalar(value.expression)
    scalar.tag = JS_TAG
    return scalar
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) value[index] = stampExpressions(value[index])
    return value
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) record[key] = stampExpressions(record[key])
  }
  return value
}

/** A `!!js` leaf holding its expression source, ready to become a tagged scalar. */
interface StagedExpression {
  readonly expression: string
}

/** Whether a staged value is a `!!js` leaf. */
function isStagedExpression(value: unknown): value is StagedExpression {
  return typeof value === 'object' && value !== null && 'expression' in value
}

/**
 * Turn a server's `!!js` leaves into placeholders the row builder stamps.
 *
 * A form field is a plain string and cannot carry a tag, so a row's expressions
 * are staged as text beside the values they replace; this is where a path and
 * its source are recombined for the write.
 *
 * @param server - the server as staged.
 * @returns a detached copy whose expression leaves are placeholders.
 */
export function stageExpressions(server: McpServer): McpServer {
  const raw = server.raw ?? []
  if (raw.length === 0) return server
  const copy = structuredClone(server)
  for (const [path, source] of raw) {
    if (path.length === 0 || source.trim() === '') continue
    // The path is config-relative, and `serverToRow` is what places it under
    // `config`; stamping it here as well would add a stray top-level key.
    //
    // A key with no editor control lives in `extra`, which is already the row's
    // config slice; only an editor field is written on the server itself.
    const head = path[0]!
    if (EDITOR_CONFIG_KEYS.has(head)) {
      assignAt(copy as unknown as Record<string, unknown>, path, { expression: source })
    } else {
      const extra = copy.extra ?? {}
      copy.extra = extra
      assignAt(extra, path, { expression: source })
    }
  }
  return copy
}



/**
 * Convert every `!!js` sentinel in the document into a tagged scalar.
 *
 * The sentinel is `{ __jsExpr: '<source>' }`, the shape `entryListSchema`
 * produces when reading, so the read and write halves share one dialect. The
 * replacement happens on the containing pair: a `visit` mapping visitor may
 * rewrite a document in place but cannot return a substitute node.
 *
 * @param document - the document to retag in place.
 */
function retagExpressions(document: PatchDocument): void {
  const walk = (node: unknown): void => {
    const value = node as { items?: unknown[], value?: unknown } | null
    const items = value?.items
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (isMap(item as never) || isSeq(item as never)) { walk(item); continue }
      if (!isPair(item)) continue
      const nested = item.value
      if (isExpressionMap(nested)) {
        const scalar = new Scalar(nested.get('__jsExpr') as string)
        scalar.tag = 'tag:yaml.org,2002:js'
        item.value = scalar
        continue
      }
      walk(nested)
    }
  }
  walk(document.contents)
}

/** Whether a node is the `{ __jsExpr: '<source>' }` sentinel. */
function isExpressionMap(node: unknown): node is YAMLMap {
  if (!isMap(node)) return false
  if (node.items.length !== 1) return false
  return typeof node.get('__jsExpr') === 'string'
}

/** Assign a value at a nested path, creating intermediate mappings. */
function assignAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let cursor = target
  for (const key of path.slice(0, -1)) {
    const next = cursor[key]
    if (!isMapping(next)) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[path[path.length - 1]!] = value
}

/**
 * Write an edited document back atomically.
 *
 * @param loaded - the edited document.
 * @returns fulfillment after the file is replaced.
 */
export async function writePatchFile(loaded: LoadedPatchFile): Promise<void> {
  const text = loaded.document.toString()
  await writeFileAtomic(loaded.path, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600 })
}

/**
 * Run an operation with the patch file locked and freshly read.
 *
 * The lock is the profile directory's own lock file, matching the boot and
 * settings writers, so a concurrent profile operation cannot interleave with a
 * rewrite.
 *
 * @param profileDir - the profile directory whose lock serializes writers.
 * @param path - absolute patch file path.
 * @param operation - receives the freshly read document; its result is returned.
 * @returns whatever `operation` returned.
 */
export async function withPatchFile<T>(
  profileDir: string,
  path: string,
  operation: (loaded: LoadedPatchFile) => Promise<T> | T,
): Promise<T> {
  return withFileLock(join(profileDir, 'package.json'), async () => {
    const loaded = await readPatchFile(path)
    return operation(loaded)
  })
}
