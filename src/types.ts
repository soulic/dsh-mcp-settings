/**
 * The `cordis.patch.yml` dialect this plugin edits.
 *
 * A patch file is a YAML sequence of patch objects: `insert` lists that declare
 * rows, and id-targeted overrides. `!!js` scalars are expressions the Loader
 * evaluates at entry activation, so a value the user typed as an expression
 * must stay an expression across a rewrite.
 */

/** One MCP server, as the Settings page and the patch file both express it. */
export interface McpServer {
  /**
   * Loader entry id of the row that declares this server. Derived from
   * `serverName` for servers this plugin creates; never invented for a row the
   * user wrote by hand, so external rows stay addressable exactly as authored.
   */
  id: string
  /** Namespace of the model-facing tool names (`mcp__<serverName>__<tool>`). */
  serverName: string
  /** Transport discriminator, mirroring `@deepseek-ai/dsh-mcp-client`'s config. */
  transport: 'stdio' | 'streamable-http'
  /** stdio: executable to launch. */
  command?: string
  /** stdio: arguments, each either a literal or a `!!js` expression. */
  args?: string[]
  /** stdio: working directory, literal or expression. */
  cwd?: string
  /** stdio: extra environment variables. */
  env?: Record<string, string>
  /** streamable-http: endpoint URL, literal or expression. */
  url?: string
  /** streamable-http: extra request headers. */
  headers?: Record<string, string>
  /** Per-call timeout in milliseconds. */
  toolCallTimeoutMs?: number
  /** Whether a failed initial connection rejects plugin activation. */
  failOnStartupError?: boolean
  /**
   * Config leaves of this server that are `!!js` expressions rather than
   * literals: each entry is a config path relative to the row's `config` object
   * followed by the expression source, for example
   * `[['cwd', 'process.cwd()']]` or `[['env', 'GITHUB_TOKEN', 'process.env.GITHUB_TOKEN']]`.
   *
   * The path and its source travel together because a staged row owns both: a
   * Settings form field is a plain string and cannot carry the tag, so an
   * expression that was only listed by path would be lost the next time the row
   * was rebuilt.
   */
  raw?: Array<[path: string[], source: string]>
  /**
   * Config keys the editor has no control for, kept verbatim under the row's
   * `config` so a save cannot drop them — `maxInstructionBytes`, a newer MCP
   * client key, or a `reconnect` policy. Paths in {@link raw} that start with
   * one of these keys are restored here.
   */
  extra?: Record<string, unknown>
  /**
   * Whether the loader row is enabled. Disabling a row keeps its configuration
   * in the patch file but stops the MCP client from starting it, so all of that
   * server's tools disappear from the model until it is enabled again.
   *
   * Absent means enabled. In YAML this is persisted as the Loader's row-level
   * `disabled: true`, not as an MCP-client config key.
   */
  enabled?: boolean
  /**
   * Who declared this row. `managed` rows were created by this plugin and may
   * be rewritten or deleted from here; `external` rows were authored by hand
   * and are shown read-only, so a hand-written row is never clobbered.
   */
  origin: 'managed' | 'external'
}

/** The layout a Settings form stages into and reads back. */
export interface McpSettings {
  /** Every server the patch file declares, in file order. */
  servers: McpServer[]
}

/** A parsed patch file plus the YAML document it came from. */
export interface LoadedPatchFile {
  /** Absolute path of the file that was read. */
  readonly path: string
  /** `false` when the file does not exist yet; a rewrite creates it. */
  readonly exists: boolean
  /** File text before any edit, for rollback. */
  readonly before: string
  /** The YAML document, preserving comments, blank lines, and anchors. */
  readonly document: PatchDocument
}

/** The slice of the `yaml` document API this module uses. */
export interface PatchDocument {
  contents: unknown
  errors: readonly Error[]
  createNode(value: unknown): unknown
  getIn(path: readonly (string | number)[]): unknown
  setIn(path: readonly (string | number)[], value: unknown): void
  deleteIn(path: readonly (string | number)[]): void
  clone(): PatchDocument
  toString(): string
}

/** Text a patch file holds when it declares nothing. */
export const EMPTY_PATCH_FILE = '[]\n'

/**
 * Config keys both halves know: the Host projects them into named server fields,
 * and the page gives each one a control.
 *
 * A key outside this list is still part of the row and is carried in
 * {@link McpServer.extra} rather than dropped, so editing a server here cannot
 * silently remove a setting this version does not expose.
 */
export const EDITOR_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'serverName', 'transport', 'command', 'args', 'cwd', 'env', 'url', 'headers',
  'toolCallTimeoutMs', 'failOnStartupError',
])

/** A `!!js` expression, as `entryListSchema` materializes it. */
export interface JsExpression {
  __jsExpr: string
}

/** Whether a parsed YAML value is an unresolved `!!js` expression node. */
function isJsExpression(value: unknown): value is JsExpression {
  if (typeof value !== 'object' || value === null) return false
  const entries = Object.entries(value)
  return entries.length === 1 && entries[0]![0] === '__jsExpr' && typeof entries[0]![1] === 'string'
}

/** Whether a value is a plain mapping, not an array or a scalars. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { isJsExpression, isMapping }
