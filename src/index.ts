/**
 * MCP server settings for DSH, host half.
 *
 * The profile's patch file is the source of truth: one `@deepseek-ai/dsh-mcp-client`
 * row per server, exactly as a hand-written configuration would declare it. This
 * plugin is the editor for those rows. It reads them out of the file into its own
 * Settings form, and writes the form's staged list back as rows — so the Web UI
 * and the YAML stay one configuration rather than two.
 *
 * Nothing here re-applies its own write. A profile launched by `dsh` already
 * watches the patch file it booted from and reconciles the root Include on every
 * change, so a new row activates, and a removed row retires, without a restart.
 *
 * @module dsh-mcp-settings
 */

import { watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: declaration-merges `ctx.loader` and its `loader/volatile-update`
// event, which is how a committed settings write reaches this plugin.
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the `settings/updated` event this plugin listens to, declared by
// the settings service's own Events merge.
import type {} from '@deepseek-ai/dsh-settings'
import {
  applyServerList, deriveId, readSettings, withPatchFile, writePatchFile,
} from './patch-store.js'
import { EXPRESSION_KEY_SEPARATOR, MARKER_FIELD, SETTINGS_MARKER } from './contract.js'
import type { McpServer } from './types.js'

export type { LoadedPatchFile, McpServer, McpSettings } from './types.js'
export {
  MCP_CLIENT_NAME, MANAGED_ID_PREFIX, applyServerList, deriveId, isManagedId, readPatchFile,
  readSettings, stageExpressions, withPatchFile, writePatchFile,
} from './patch-store.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-settings'

/**
 * The Loader's volatile-config event.
 *
 * A Loader older than this plugin does not declare the key at all, so the name is
 * spelled as a value and the handler is typed here rather than at the call site.
 * Where the event never fires, `settings/updated` is what reports a landed save.
 */
const VOLATILE_UPDATE = 'loader/volatile-update'

/**
 * The settings commit event. Also spelled as a value for the same reason as
 * {@link VOLATILE_UPDATE}: the harness renamed the settings events, and a plugin
 * that only needs "a save landed" should not have to pick a side.
 */
const SETTINGS_UPDATED = 'settings/updated'

/** Registers one listener by name, for an event the installed harness may not declare. */
type NamedListenerRegistrar = (
  event: string,
  listener: (...args: never[]) => void,
) => () => void

/** Config of one MCP server, as the Settings form stages it. */
export interface McpServerInput {
  /** Stable row id; derived from `serverName` when absent. */
  id?: string
  /** Namespace of the model-facing tool names. */
  serverName: string
  /** Transport discriminator. */
  transport: 'stdio' | 'streamable-http'
  /** stdio: executable to launch. */
  command?: string
  /** stdio: arguments. */
  args?: string[]
  /** stdio: working directory. */
  cwd?: string
  /** stdio: extra environment variables. */
  env?: Record<string, string>
  /** streamable-http: endpoint URL. */
  url?: string
  /** streamable-http: request headers. */
  headers?: Record<string, string>
  /** Per-call timeout in milliseconds. */
  toolCallTimeoutMs?: number
  /** Whether a failed initial connection rejects activation. */
  failOnStartupError?: boolean
  /**
   * Whether the server is enabled. Disabled servers keep their configuration in
   * the patch file but their loader row is not started, so their tools are not
   * offered to the model.
   */
  enabled?: boolean
  /**
   * Convenience for programmatic callers: a reconnect policy, stored in
   * {@link extra} under `reconnect` like any other key the page does not expose.
   */
  reconnect?: {
    enabled?: boolean
    initialDelayMs?: number
    maxDelayMs?: number
    maxAttempts?: number
  }
  /**
   * Config leaves that are `!!js` expressions rather than literals: a config path
   * relative to the row's `config` object, then the expression source.
   */
  raw?: Array<[path: string[], source: string]>
  /**
   * Config keys the page has no control for, kept verbatim under the row's
   * `config`. A pasted configuration may carry `maxInstructionBytes`, a
   * `reconnect` policy, or a key a newer MCP client adds; dropping them on a save
   * would quietly change the server.
   */
  extra?: Record<string, unknown>
}

/**
 * A live configuration field. The Settings form writes these and the running
 * fiber reads the committed value without a remount.
 */
interface Volatile<T> {
  /** The committed value. */
  get: () => T
}

/** Plugin configuration. */
export interface Config {
  /**
   * Absolute path of the patch file this plugin edits. Defaults to the Harness
   * home's `cordis.patch.yml`, which is the layer a `dsh` run already watches
   * and which applies to every profile on the machine.
   */
  patchFile?: Volatile<string | undefined>
  /** Whether to notice edits made to the file outside this plugin. */
  watchFile?: Volatile<boolean | undefined>
  /**
   * The staged server list. Read from the patch file when the profile carries no
   * override, and written back to the file whenever it changes.
   */
  servers?: Volatile<McpServerInput[] | undefined>
  /**
   * Which leaves of which server hold a `!!js` expression, as
   * `<server id>\0<config path joined with \0>` to the expression source.
   *
   * This exists because the Settings form stages plain values: a save replaces
   * the server list wholesale, dropping any field the schema does not declare,
   * so an expression recorded only inside a server entry would not survive one.
   * Keeping the sources in their own field lets the Host put them back when it
   * writes the row.
   */
  expressions?: Volatile<Record<string, string> | undefined>
  /**
   * Identifies this plugin's settings form among every namespace the Host serves.
   *
   * The settings wire addresses a form by the profile's loader entry id, which
   * the browser half has no way to learn — the client boot graph carries package
   * names, not loader ids. Publishing a constant as an ordinary form value gives
   * the page something it can search for, and it survives the Host's schema
   * projection, which rebuilds the form field by field.
   */
  settingsMarker?: Volatile<string | undefined>
}

/**
 * The configuration schema.
 *
 * It must be exported: the settings service derives this plugin's form from the
 * schema its row declares, so a plugin without one has no editable
 * configuration at all. Every field the page writes is `.volatile()`, which is
 * what marks it live.
 */
export const Config = z.object({
  patchFile: z.string().description('Absolute path of the patch file to edit.').volatile(),
  watchFile: z.boolean().default(true).description('Follow edits made to that file elsewhere.').volatile(),
  servers: z.array(z.any()).default([]).description('The MCP servers this profile declares.').volatile(),
  expressions: z.dict(String).default({}).description('!!js expression sources, kept beside the list.')
    .hidden().volatile(),
  // Hidden from the form, but present in every describe answer: this is how the
  // page finds the namespace whose values it renders.
  settingsMarker: z.string().default(SETTINGS_MARKER).hidden().volatile(),
})

/** Default to the Harness home the launcher itself uses. */
function defaultHome(): string {
  return process.env['DSH_HOME']?.trim() || join(homedir(), '.dsh')
}

/** A server with the fields the file needs, defaults resolved. */
export function normalize(input: McpServerInput, taken: ReadonlySet<string>): McpServer {
  const serverName = input.serverName.trim()
  const id = input.id?.trim() || deriveId(serverName, taken)
  const server: McpServer = {
    id,
    serverName,
    transport: input.transport,
    raw: input.raw ?? [],
    enabled: input.enabled ?? true,
    origin: 'managed',
  }
  if (input.transport === 'stdio') {
    if (input.command !== undefined && input.command !== '') server.command = input.command
    if (input.args !== undefined && input.args.length > 0) server.args = [...input.args]
    if (input.cwd !== undefined && input.cwd !== '') server.cwd = input.cwd
    if (input.env !== undefined && Object.keys(input.env).length > 0) server.env = { ...input.env }
  } else {
    if (input.url !== undefined && input.url !== '') server.url = input.url
    if (input.headers !== undefined && Object.keys(input.headers).length > 0) {
      server.headers = { ...input.headers }
    }
  }
  if (input.toolCallTimeoutMs !== undefined) server.toolCallTimeoutMs = input.toolCallTimeoutMs
  if (input.failOnStartupError !== undefined) server.failOnStartupError = input.failOnStartupError
  if (input.extra !== undefined && Object.keys(input.extra).length > 0) {
    server.extra = { ...input.extra }
  }
  if (input.reconnect !== undefined && Object.keys(input.reconnect).length > 0) {
    server.extra = { ...server.extra, reconnect: { ...input.reconnect } }
  }
  return server
}

/**
 * Reject a staged server the MCP client's own config schema would reject.
 *
 * Failing here keeps a bad value out of the file: the row would otherwise land
 * and only fail when the loader tried to activate it.
 *
 * @param server - the normalized server.
 * @throws {Error} when a required field is missing or a namespace is malformed.
 */
export function validate(server: McpServer): void {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.serverName)) {
    throw new Error(`MCP serverName "${server.serverName}" must match [A-Za-z0-9_-]{1,32}`)
  }
  if (server.transport === 'stdio' && (server.command === undefined || server.command === '')) {
    throw new Error(`MCP server "${server.serverName}" needs a command for the stdio transport`)
  }
  if (server.transport === 'streamable-http' && (server.url === undefined || server.url === '')) {
    throw new Error(`MCP server "${server.serverName}" needs a url for the streamable-http transport`)
  }
  for (const [path] of server.raw ?? []) {
    if (path.length === 0) throw new Error(`MCP server "${server.serverName}" has an empty expression path`)
  }
}

/** Normalize a whole staged list, rejecting duplicate ids and invalid rows. */
export function normalizeList(inputs: readonly McpServerInput[]): McpServer[] {
  const taken = new Set<string>()
  const servers: McpServer[] = []
  for (const input of inputs) {
    const server = normalize(input, taken)
    validate(server)
    if (taken.has(server.id)) throw new Error(`two MCP servers share the entry id "${server.id}"`)
    taken.add(server.id)
    servers.push(server)
  }
  return servers
}

/**
 * Record every `!!js` expression a row carries, keyed for the config field.
 *
 * The form stages a server list as plain values, so the sources ride in their own
 * map; a save that dropped them would write `!!js` leaves as literals.
 *
 * @param servers - the servers as the file holds them.
 * @returns expression source per `<server id>\0<config path joined with \0>`.
 */
export function expressionsOf(servers: readonly McpServer[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const server of servers) {
    for (const [path, source] of server.raw ?? []) {
      out[[server.id, ...path].join(EXPRESSION_KEY_SEPARATOR)] = source
    }
  }
  return out
}

/**
 * Restore the expression leaves a staged row lost on the way through the form.
 *
 * A staging round trip carries plain values only, so every expression source the
 * config field records for this server is put back. The field is the authority
 * rather than the file, because the first write happens on an empty file: there
 * is nothing to preserve from, and the sources are all that say a leaf is an
 * expression at all.
 *
 * @param server - the staged server.
 * @param sources - expression sources from the config field.
 * @returns the server with its `raw` list restored.
 */
function restoreExpressions(server: McpServer, sources: Readonly<Record<string, string>>): McpServer {
  const prefix = `${server.id}${EXPRESSION_KEY_SEPARATOR}`
  const raw: Array<[string[], string]> = []
  for (const [key, source] of Object.entries(sources)) {
    if (!key.startsWith(prefix) || source.trim() === '') continue
    const path = key.slice(prefix.length).split(EXPRESSION_KEY_SEPARATOR)
    if (path.length > 0 && path[0] !== '') raw.push([path, source])
  }
  return raw.length === 0 ? server : { ...server, raw }
}

/** The identity of a server list, for deciding whether anything actually changed. */
export function listSignature(servers: readonly McpServer[]): string {
  return JSON.stringify(servers.map(server => [
    server.id, server.serverName, server.transport, server.command, server.args, server.cwd,
    server.env, server.url, server.headers, server.toolCallTimeoutMs, server.failOnStartupError,
    server.enabled ?? true, server.raw, server.extra,
  ]))
}

/** Drop the origin marker before a row is staged back into the settings form. */
function stripOrigin(server: McpServer): McpServerInput {
  const { origin: _origin, ...rest } = server
  return rest
}

/** The part of a patch file this plugin owns: its path and the stagers above it. */
export interface Reconciler {
  /** Read the file's current rows. */
  read(): Promise<{ servers: McpServer[] }>
  /** Write a staged list into the file, leaving rows this plugin does not own alone. */
  write(servers: readonly McpServer[]): Promise<void>
}

/**
 * Build the file-facing half of the plugin.
 *
 * @param patchFile - absolute path of the patch file to edit.
 * @returns a reader and writer bound to that file.
 */
export function createReconciler(patchFile: string): Reconciler {
  const profileDir = dirname(patchFile)
  return {
    async read() {
      return withPatchFile(profileDir, patchFile, loaded => ({ servers: readSettings(loaded.document).servers }))
    },
    async write(servers) {
      await withPatchFile(profileDir, patchFile, async (loaded) => {
        const before = loaded.document.toString()
        applyServerList(loaded, servers)
        if (loaded.document.toString() !== before) await writePatchFile(loaded)
      })
    },
  }
}

/**
 * Reconcile the staged server list into the patch file, and keep the two in step.
 *
 * @param ctx - plugin context, for diagnostics and the optional settings service.
 * @param config - the resolved plugin configuration.
 * @returns fulfillment once the first reconciliation settled.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const declaredFile = config.patchFile?.get()?.trim()
  const patchFile = declaredFile === undefined || declaredFile === '' ? join(defaultHome(), 'cordis.patch.yml') : declaredFile
  const watchFile = config.watchFile?.get() ?? true
  const reconciler = createReconciler(patchFile)

  /**
   * The profile's loader entry id, which is what the settings wire addresses a
   * form by. The plugin's own name is only a fallback: a profile is free to give
   * the row any id, and writing to the wrong namespace leaves the page empty
   * while every step reports success.
   */
  // `entry.id` is the loader's tree-scoped id (`include:<row>` for a patched row);
  // the settings wire keys its forms by the row's declared id, `options.id`.
  const entryId = ctx.fiber.entry?.options?.id ?? name

  /**
   * Signature of the list the file held when it was last read back into the form.
   * `undefined` means "the current file contents have not reached the form".
   */
  let mirrored: string | undefined
  /** Signature of the list this plugin last wrote into the file. */
  let written: string | undefined
  /**
   * Whether the form has been seeded from the file at least once.
   *
   * Saves are only honoured after that, so an activation can never be mistaken for
   * a save. Without this, a boot whose staged list is empty writes an empty list
   * over a file full of servers — deleting configuration nobody removed.
   */
  let seeded = false

  let queue: Promise<void> = Promise.resolve()
  let queued = false

  /** Serialize reconciliations; a change arriving mid-write re-runs once after it. */
  const schedule = (task: () => Promise<void>): void => {
    if (queued) return
    queued = true
    queue = queue.then(async () => {
      queued = false
      try {
        await task()
      } catch (error) {
        ctx.logger.error('mcp-settings: %s', error instanceof Error ? error.message : String(error))
      }
    })
  }

  /** Push the staged settings list into the file. */
  const stageToFile = async (): Promise<void> => {
    // A change that arrives before the form was seeded is part of starting up,
    // not a save; the boot path decides what to do with it.
    if (!seeded) return
    const staged = normalizeList(config.servers?.get() ?? [])
    const stagedSignature = listSignature(staged)
    const { servers: current } = await reconciler.read()
    if (stagedSignature === listSignature(current)) return
    // The form still holds the list this plugin published from the file: the
    // event is this plugin's own mirror echoing back, not a save.
    if (stagedSignature === mirrored) return
    const sources = config.expressions?.get() ?? {}
    await reconciler.write(staged.map(server => restoreExpressions(server, sources)))
    written = listSignature(await reconciler.read().then(found => found.servers))
    mirrored = written
  }

  /**
   * Publish the file's rows into the settings form.
   *
   * `written` only suppresses the mirror for a row a save just wrote, which is an
   * echo rather than news; `mirrored` suppresses publishing the same list twice.
   */
  const fileToSettings = async (): Promise<void> => {
    const { servers } = await reconciler.read()
    const found = listSignature(servers)
    if (found === written || found === mirrored) return
    const settings = ctx.get('settings')
    if (settings === undefined) return
    // Marked before the write: the volatile event this write causes must see the
    // list as already published, not as a fresh edit to push back into the file.
    mirrored = found
    await settings.update(entryId, {
      servers: servers.map(stripOrigin),
      expressions: expressionsOf(servers),
    })
  }

  /**
   * Seed the form from the file, survive a busy settings document, and mark the
   * plugin ready for saves.
   *
   * The mirror leaves the process through the settings service and the profile's
   * config editor, which holds a short-lived file lock. Another writer holding it
   * must not decide whether this entry activates: the file half is ready either
   * way, so a failed mirror is logged and retried instead of failing the plugin.
   */
  const seedFromFile = async (): Promise<void> => {
    try {
      await fileToSettings()
      seeded = true
    } catch (error) {
      ctx.logger.warn('mcp-settings: could not publish %s into the settings form: %s',
        patchFile, error instanceof Error ? error.message : String(error))
      for (const delayMs of [250, 1_000, 4_000]) {
        const retry = setTimeout(() => {
          schedule(async () => {
            try {
              await fileToSettings()
              seeded = true
            } catch (cause) {
              ctx.logger.warn('mcp-settings: retry failed: %s', cause instanceof Error ? cause.message : String(cause))
            }
          })
        }, delayMs)
        retry.unref()
      }
    }
  }

  /**
   * Bring the file and the form into step at activation, without ever destroying
   * a row.
   *
   * Three cases, in order:
   * 1. The profile's staged list already matches the file — nothing to do.
   * 2. The profile stages servers (a saved form, or an explicit config) — that
   *    list is the intent, so it is written.
   * 3. The profile stages nothing but the file has rows — the form is seeded
   *    from the file after activation. Writing here would delete every server
   *    the user has.
   */
  const boot = async (): Promise<void> => {
    const staged = normalizeList(config.servers?.get() ?? [])
    const { servers: current } = await reconciler.read()
    const stagedSignature = listSignature(staged)
    const currentSignature = listSignature(current)
    if (stagedSignature === currentSignature) {
      mirrored = currentSignature
      seeded = true
      return
    }
    if (staged.length > 0) {
      const sources = config.expressions?.get() ?? {}
      try {
        await reconciler.write(staged.map(server => restoreExpressions(server, sources)))
        written = listSignature(await reconciler.read().then(found => found.servers))
        mirrored = written
        seeded = true
        return
      } catch (error) {
        // A lock another writer holds must not decide whether this entry
        // activates; the deferred seed publishes the file and a later save can
        // reapply the staged list.
        ctx.logger.warn('mcp-settings: could not write %s at startup: %s',
          patchFile, error instanceof Error ? error.message : String(error))
      }
    }
    // Case 3: the form has nothing staged but the file has rows. Seeding is
    // deferred until this fiber is active — see the note at the call site.
  }

  await boot()

  // Publishing the file into the form must NOT happen inside `apply`.
  //
  // A settings write reconciles the profile, and that reconcile waits for the
  // fibers it touches — including this one, which is still activating because
  // `apply` has not resolved. Doing it here is a startup deadlock, observed as a
  // stuck `package.json.lock` and an entry that never activates, so the page's
  // namespace never appears. Deferring until after activation breaks the cycle;
  // the page picks the resulting revision up on its own.
  if (!seeded) {
    const timer = setTimeout(() => { void seedFromFile() }, 0)
    timer.unref()
  }

  // A settings write reaches this plugin through whichever of these the running
  // Loader offers: `loader/volatile-update` commits volatile config into the live
  // fiber, and `settings/updated` reports the commit itself. Both may fire for one
  // save, and the reconciliation is idempotent.
  const onNamed = ctx.on.bind(ctx) as unknown as NamedListenerRegistrar
  ctx.effect(() => onNamed(VOLATILE_UPDATE, () => { schedule(stageToFile) }), 'mcp-settings.volatile')
  ctx.effect(
    () => onNamed(SETTINGS_UPDATED, (ns: string) => { if (ns === entryId) schedule(stageToFile) }),
    'mcp-settings.settings',
  )

  if (watchFile) {
    ctx.effect(() => {
      let watcher: FSWatcher | undefined
      let timer: NodeJS.Timeout | undefined
      try {
        watcher = watch(patchFile, () => {
          if (timer !== undefined) clearTimeout(timer)
          // Editors write in several steps; settle before reading.
          timer = setTimeout(() => { schedule(async () => { await fileToSettings(); seeded = true }) }, 150)
          timer.unref()
        })
      } catch (error) {
        // A missing file is the normal first-run state: the first write creates it.
        ctx.logger.debug('mcp-settings: not watching %s (%s)', patchFile,
          error instanceof Error ? error.message : String(error))
      }
      return () => {
        if (timer !== undefined) clearTimeout(timer)
        watcher?.close()
      }
    }, 'mcp-settings.watch')
  }
}
