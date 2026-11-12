/**
 * The MCP servers page: what it renders, and how a staged edit reaches the file.
 *
 * The staged list is written as one `servers` value rather than as a sequence of
 * per-field edits. A path-addressed edit per leaf would arrive at the Host one at
 * a time, and the Host's reconcile is a whole-list operation — so a save that
 * added a server and renamed another would be observed halfway through. One write
 * makes a save atomic from the Host's point of view, which is what lets the file
 * be rewritten in a single pass.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import { EXPRESSION_KEY_SEPARATOR, MARKER_FIELD, SETTINGS_MARKER } from '../contract.js'
import { parseServerSnippet } from './server-snippet.js'
import type { SnippetIssue } from './server-snippet.js'

/**
 * One path-addressed settings edit, as the wire carries it.
 *
 * Declared here rather than imported from the Host's settings package: the client
 * bundle purity gate forbids a value or type import across the face boundary, and
 * this shape is the transport contract both sides already agree on.
 */
export type SettingsEdit =
  | { op: 'set', path: string[], value: unknown }
  | { op: 'unset', path: string[] }

/** One registered settings namespace, as the describe answer reports it. */
interface NamespaceView {
  /** Entry id of the Host plugin row the namespace belongs to. */
  ns: string
  /** The namespace's current form values. */
  value?: unknown
  /** Serialized schemastery envelope (`schema.toJSON()`). */
  schema?: unknown
}

/** One MCP server as the page stages it. */
export interface ServerDraft {
  /** Row id in the patch file. */
  id: string
  /** Namespace of the model-facing tool names. */
  serverName: string
  /** Transport discriminator. */
  transport: 'stdio' | 'streamable-http'
  /** stdio: executable. */
  command: string
  /** stdio: arguments, one per line. */
  args: string[]
  /** stdio: working directory; empty means the launcher's. */
  cwd: string
  /** stdio: environment entries, as key/value rows. */
  env: Array<[string, string]>
  /** streamable-http: endpoint URL. */
  url: string
  /** streamable-http: headers, as key/value rows. */
  headers: Array<[string, string]>
  /** Per-call timeout; empty means the plugin default. */
  toolCallTimeoutMs: string
  /** Fail activation when the first connection fails. */
  failOnStartupError: boolean
  /** Whether the server and its tools are active. */
  enabled: boolean
  /** `!!js` leaves, as a path plus its expression source. */
  raw: Array<[string[], string]>
  /** Config keys the editor has no control for, carried through a save verbatim. */
  extra: Record<string, unknown>
  /** Whether this row was created here (`managed`) or written by hand (`external`). */
  origin: 'managed' | 'external'
}

/** What the page renders. */
export interface McpServersState {
  /** Whether the Host serves this entry's form at all. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether staged edits differ from what the Host holds. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land. */
  failed: boolean
  /** Absolute path of the patch file that will be written. */
  patchFile: string
  /** Whether edits made outside this page are picked up. */
  watchFile: boolean
  /** Rows this page may change. */
  managed: ServerDraft[]
  /** Rows written by hand; shown, never rewritten. */
  external: ServerDraft[]
  /** The staged rows, in file order, across both origins. */
  rows: ServerDraft[]
  /** Index into {@link rows} of the row being edited, or -1. */
  editing: number
}

/** The face the page's slot registration injects. */
export interface McpServersFace {
  /** Snapshot store bound by the renderer as `useMcpServers`. */
  hooks: { mcpServers: McpSnapshotStore }
  /** Replace the staged list; the caller has already applied its own edit. */
  stage: (rows: ServerDraft[]) => void
  /** Add the servers a pasted configuration declares; returns why it was refused. */
  add: (snippet: string) => SnippetIssue | undefined
  /** Remove the row at `index`; a hand-written row cannot be removed from here. */
  remove: (index: number) => void
  /** Replace the row at `index`. */
  replace: (index: number, row: ServerDraft) => void
  /** Stage a row's enabled state; the change is persisted by {@link save}. */
  setEnabled: (index: number, enabled: boolean) => void
  /** Flip a row's enabled state, or set it when `enabled` is supplied. */
  toggleEnabled: (index: number, enabled?: boolean) => void
  /** Begin editing the row at `index`, or stop when it is already open. */
  toggleEdit: (index: number) => void
  /** Write the staged list to the patch file. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** The snapshot store the registration exposes. */
export interface McpSnapshotStore {
  /** @returns the current state. */
  getSnapshot: () => McpServersState
  /** @param listener - called after each change. @returns the disposer. */
  subscribe: (listener: () => void) => () => void
  /** Publish a new state. */
  set: (state: McpServersState) => void
}

/** The plugin config keys this page reads through the shared settings form. */
interface McpConfig {
  /** Identifies this plugin's namespace in the describe answer. */
  settingsMarker?: string
  /** Path of the patch file the Host will write. */
  patchFile?: string
  /** Whether the Host watches the file for outside edits. */
  watchFile?: boolean
  /** The server list. */
  servers?: StagedServer[]
}

/** One server as it rides in the plugin config. */
interface StagedServer {
  id?: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
  /** Whether the server is enabled; absent means enabled. */
  enabled?: boolean
  raw?: Array<[string[], string]>
  extra?: Record<string, unknown>
}

/** Read a config row into the shape the page edits. */
function toDraft(server: StagedServer & { origin?: 'managed' | 'external' }): ServerDraft {
  return {
    id: server.id ?? '',
    serverName: server.serverName ?? '',
    transport: server.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: server.command ?? '',
    args: server.args ?? [],
    cwd: server.cwd ?? '',
    env: Object.entries(server.env ?? {}),
    url: server.url ?? '',
    headers: Object.entries(server.headers ?? {}),
    toolCallTimeoutMs: server.toolCallTimeoutMs === undefined ? '' : String(server.toolCallTimeoutMs),
    failOnStartupError: server.failOnStartupError ?? false,
    enabled: server.enabled !== false,
    raw: (server.raw ?? []).map(([path, source]) => [[...path], source]),
    extra: { ...(server.extra ?? {}) },
    origin: server.origin ?? 'managed',
  }
}

/** Write a row back into the config shape, dropping what the transport ignores. */
function toStaged(draft: ServerDraft): StagedServer {
  const server: StagedServer = {
    serverName: draft.serverName.trim(),
    transport: draft.transport,
  }
  if (draft.id.trim() !== '') server.id = draft.id.trim()
  if (draft.transport === 'stdio') {
    if (draft.command !== '') server.command = draft.command
    const args = draft.args.map(arg => arg.trim()).filter(arg => arg !== '')
    if (args.length > 0) server.args = args
    if (draft.cwd.trim() !== '') server.cwd = draft.cwd.trim()
    const env = Object.fromEntries(draft.env.filter(([key]) => key.trim() !== ''))
    if (Object.keys(env).length > 0) server.env = env
  } else {
    if (draft.url.trim() !== '') server.url = draft.url.trim()
    const headers = Object.fromEntries(draft.headers.filter(([key]) => key.trim() !== ''))
    if (Object.keys(headers).length > 0) server.headers = headers
  }
  const timeout = draft.toolCallTimeoutMs.trim()
  if (timeout !== '' && Number.isFinite(Number(timeout))) server.toolCallTimeoutMs = Number(timeout)
  if (draft.failOnStartupError) server.failOnStartupError = true
  server.enabled = draft.enabled
  if (draft.raw.length > 0) server.raw = draft.raw.map(([path, source]) => [[...path], source])
  if (Object.keys(draft.extra).length > 0) server.extra = { ...draft.extra }
  return server
}

/**
 * Find this plugin's own settings namespace among every registered one.
 *
 * A profile chooses the entry id for this plugin's row, and the browser has no
 * way to learn that id — the client boot graph carries package names, not loader
 * ids. So the Host publishes {@link SETTINGS_MARKER} as an ordinary form value,
 * and the page takes the namespace whose values carry it.
 *
 * The value is used rather than the schema's root metadata because the Host
 * rebuilds the form schema field by field, dropping the root's metadata; a field
 * value survives that projection.
 *
 * @param ctx - the browser plugin context.
 * @returns the entry id, or undefined while the row is absent or unserved.
 */
export function findNamespace(ctx: ClientContext): string | undefined {
  const snapshot = ctx.configForms?.describe?.()?.getSnapshot()
  for (const view of (snapshot?.view?.namespaces ?? []) as readonly NamespaceView[]) {
    const value = view.value as Record<string, unknown> | undefined
    if (value?.[MARKER_FIELD] === SETTINGS_MARKER) return view.ns
  }
  return undefined
}

/** Rehydrate a JSON-valued config field the wire delivered. */
function serversOf(value: unknown): StagedServer[] {
  const section = value as McpConfig | undefined
  return Array.isArray(section?.servers) ? section.servers : []
}

/** The staged list the Host currently holds, as drafts. */
function holdRows(scope: SettingsFormScope<McpConfig>): ServerDraft[] {
  return serversOf(scope.getSnapshot().value).map(toDraft)
}

/**
 * A server list in one canonical shape, for "did anything change?".
 *
 * Comparing the raw wire value with the staged value would answer a different
 * question: the Host publishes `raw: []` and key order it chose, while the page
 * omits empty optional fields and writes its own order. Normalizing both sides
 * through {@link toDraft} — and dropping `origin`, which is not an edit — makes
 * the answer about values instead of spelling.
 */
function editableShape(rows: readonly ServerDraft[]): string {
  return JSON.stringify(rows.map((row) => {
    const { origin: _origin, ...editable } = row
    return editable
  }))
}

/**
 * Bridge the shared settings form for this plugin's entry onto the page.
 *
 * The page reads the Host's value on every publish and writes the whole list on
 * save, so an external change to the patch file (which the Host mirrors into the
 * config) appears without a reload.
 */
export class McpServersController {
  private rows: ServerDraft[] = []
  private editing = -1
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private state: McpServersState

  /**
   * @param scope - the bound settings form for this plugin's entry.
   * @param ctx - the browser plugin context, read for the patch file path.
   */
  constructor(
    private readonly scope: SettingsFormScope<McpConfig>,
    private readonly ctx: ClientContext,
  ) {
    this.rows = holdRows(scope)
    this.state = this.project()
    this.unsubscribe = scope.subscribe(() => { this.adopt() })
  }

  /** Release the form subscription. */
  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /** @returns the current page state. */
  getSnapshot(): McpServersState {
    return this.state
  }

  /**
   * Observe state changes.
   * @param listener - called after each change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The face the slot registration injects. */
  inject(): McpServersFace {
    return {
      hooks: { mcpServers: { getSnapshot: () => this.state, subscribe: (l) => this.subscribe(l), set: () => {} } },
      stage: (rows) => { this.rows = rows; this.publish() },
      add: (snippet) => {
        const taken = new Set(this.rows.map(row => row.id).filter(id => id !== ''))
        const parsed = parseServerSnippet(snippet, taken)
        if ('issue' in parsed) return parsed.issue
        this.rows = [...this.rows, ...parsed.rows]
        this.publish()
        return undefined
      },
      remove: (index) => {
        const row = this.rows[index]
        if (row === undefined || row.origin === 'external') return
        this.rows = this.rows.filter((_row, at) => at !== index)
        if (this.editing >= this.rows.length) this.editing = -1
        this.publish()
      },
      replace: (index, row) => {
        this.rows = this.rows.map((existing, at) => at === index ? row : existing)
        this.publish()
      },
      setEnabled: (index, enabled) => { this.setEnabledAt(index, enabled) },
      toggleEnabled: (index, enabled) => {
        const row = this.rows[index]
        if (row === undefined) return
        this.setEnabledAt(index, enabled ?? !row.enabled)
      },
      toggleEdit: (index) => {
        this.editing = this.editing === index ? -1 : index
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        this.rows = holdRows(this.scope)
        this.editing = -1
        this.publish()
      },
    }
  }

  /** Replace one row's enabled state without duplicating the list mapping. */
  private setEnabledAt(index: number, enabled: boolean): void {
    this.rows = this.rows.map((existing, at) => at === index ? { ...existing, enabled } : existing)
    this.publish()
  }

  /** Write the staged list, then re-read whatever the Host accepted. */
  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (!snapshot.writable || this.state.saving) return
    this.state = { ...this.state, saving: true, failed: false }
    this.publish()
    try {
      // `expressions` mirrors the staged rows' `!!js` leaves. The Host writes
      // rows from that field when it has an entry for a server, so leaving it
      // stale would let an older source win over an expression the page holds —
      // including one that arrived with a pasted configuration.
      const expressions: Record<string, string> = {}
      for (const row of this.rows) {
        if (row.id === '') continue
        for (const [path, source] of row.raw) {
          if (path.length === 0 || source.trim() === '') continue
          expressions[[row.id, ...path].join(EXPRESSION_KEY_SEPARATOR)] = source
        }
      }
      const ops: SettingsEdit[] = [
        { op: 'set', path: ['servers'], value: this.rows.map(toStaged) },
        { op: 'set', path: ['expressions'], value: expressions },
      ]
      const landed = await this.scope.mutate(ops, snapshot.revision)
      if (!landed) {
        this.state = { ...this.state, saving: false, failed: true }
        this.publish()
        return
      }
      this.adopt()
      this.editing = -1
    } catch {
      this.state = { ...this.state, failed: true }
    }
    this.state = { ...this.state, saving: false }
    this.publish()
  }

  /** Take up the Host's value when it moved underneath a staged edit. */
  private adopt(): void {
    if (this.state.saving) return
    this.rows = holdRows(this.scope)
    this.publish()
  }

  private project(): McpServersState {
    const snapshot = this.scope.getSnapshot()
    const section = snapshot.value as McpConfig | undefined
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: editableShape(serversOf(snapshot.value).map(toDraft)) !== editableShape(this.rows),
      saving: false,
      failed: false,
      patchFile: section?.patchFile ?? '',
      watchFile: section?.watchFile !== false,
      managed: this.rows.filter(row => row.origin !== 'external'),
      external: this.rows.filter(row => row.origin === 'external'),
      rows: this.rows,
      editing: this.editing,
    }
  }

  private publish(): void {
    this.state = this.project()
    this.ctx.logger.debug('mcp-settings: page state %s rows', String(this.rows.length))
    for (const listener of this.listeners) listener()
  }
}
