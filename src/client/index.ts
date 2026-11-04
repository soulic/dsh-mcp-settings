/**
 * MCP servers page, browser half.
 *
 * The page is a first-level panel: a `main` entry supplies the central column and
 * a matching `sidebar.panellist` entry gives it the sidebar row that selects it,
 * the same pairing the Plugins and Tasks pages use. It edits its own plugin
 * entry's configuration through the shared settings form, which is the only wire
 * surface a third-party plugin can reach without the harness's generated Remote
 * descriptors — and the Host half turns that config into rows in the patch file.
 *
 * The entry id is discovered from the settings describe answer rather than
 * assumed, because a profile chooses the id for this plugin's row.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Loaded from the module that
// LEAF-DECLARES it: a `declare module` augmentation merges with declarations
// written in the augmented module itself, never with a re-export, so importing
// the declaring package is what makes the merge visible here.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `main` keyed slot and its MainPanelId brand, leaf-declared by
// ui-layout (the package that owns the frame and the panel selection).
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the 'sidebar.panellist' SlotMap entry, leaf-declared here.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: the ctx.slots Context merge, leaf-declared by the renderer that
// owns the slot registry. Reached through the declaring package, not ui-slots.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.slots Context merge and the LocaleNamespaceMap table,
// both leaf-declared by this package.
import type { LocaleNamespaceMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { McpServersIcon } from './McpServersIcon.js'
import { McpServersPage } from './McpServersPage.js'
import { findNamespace, McpServersController } from './mcp-servers-controller.js'
import type { McpServersFace } from './mcp-servers-controller.js'
import { en, zh, type McpServersLocaleKey } from './locales.js'
import { STYLES } from './styles.js'

export type { McpServersFace, McpServersState, ServerDraft } from './mcp-servers-controller.js'
export type { McpServersLocaleKey } from './locales.js'
export { McpServersPage } from './McpServersPage.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP servers page copy. */
    'settings.mcpServers': McpServersLocaleKey
  }
}

/** Prove at compile time that this plugin's namespace joined the locale table. */
type RegisteredNamespace = 'settings.mcpServers' extends keyof LocaleNamespaceMap ? true : never
const registered: RegisteredNamespace = true
void registered

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.mcpServers'

/** The id shared by the sidebar row and the main panel it opens. */
export const PANEL_ID = 'mcp-servers' as MainPanelId

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the MCP servers panel and its sidebar row.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcp-settings: dictionaries')

  let current: { namespace: string, controller: McpServersController } | undefined
  const face = (namespace: string): McpServersFace => {
    if (current?.namespace !== namespace) {
      current?.controller.dispose()
      current = { namespace, controller: new McpServersController(ctx.configForms.get(namespace), ctx) }
    }
    return current.controller.inject()
  }

  ctx.effect(() => () => { current?.controller.dispose(); current = undefined }, 'mcp-settings: form')

  // The main panel and the sidebar row are two halves of one navigation entry:
  // the sidebar selects panels by id, and the frame dispatches `main` by key.
  // Both are injected against their declared slots, so a deployment without the
  // layout simply never mounts the page instead of failing boot.
  ctx.slots.inject('main', () => whenServed(ctx, namespace => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => face(namespace),
  }, McpServersPage)))

  ctx.slots.inject('sidebar.panellist', () => whenServed(ctx, () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    label: () => t('title'),
    locale: NS,
  }, McpServersIcon)))

  ctx.effect(() => () => { removeStyles() }, 'mcp-settings: styles')
  installStyles()
}

/**
 * Keep one contribution registered while the Host serves this plugin's settings
 * namespace, and re-register it when the profile's entry id changes.
 *
 * The page has nothing to read or write before that namespace exists, and the
 * renderer caches an entry's inject face for the entry's lifetime. Gating the
 * registration keeps that cached face from being the empty one; waiting until
 * the first render would leave the page stuck on "unavailable" whenever the
 * describe read had not settled yet.
 *
 * @param ctx - the browser plugin context.
 * @param register - registers the contribution for a namespace; returns its disposer.
 * @returns the disposer ending the watch and any live registration.
 */
function whenServed(ctx: ClientContext, register: (namespace: string) => () => void): () => void {
  const describe = ctx.configForms.describe()
  let namespace: string | undefined
  let dispose: (() => void) | undefined
  const sync = (): void => {
    const next = findNamespace(ctx)
    if (next === namespace) return
    dispose?.()
    dispose = undefined
    namespace = next
    if (next !== undefined) dispose = register(next)
  }
  const off = describe.subscribe(sync)
  void describe.ensure()
  sync()
  return () => {
    off()
    dispose?.()
    dispose = undefined
  }
}

/** Tag the page's stylesheet so a reload replaces it instead of stacking one. */
const STYLE_ID = 'dsh-mcp-settings'

/** Add this plugin's stylesheet to the document. */
function installStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset['plugin'] = 'dsh-mcp-settings'
  tag.dataset['pluginCss'] = STYLE_ID
  tag.textContent = STYLES
  document.head.appendChild(tag)
}

/** Remove this plugin's stylesheet, on unload. */
function removeStyles(): void {
  if (typeof document === 'undefined') return
  document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)?.remove()
}
