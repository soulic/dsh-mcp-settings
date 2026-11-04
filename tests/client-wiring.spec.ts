/**
 * Wiring tests for the browser half of the standalone page.
 *
 * The page is two registrations that must agree: a `main` key and the
 * `sidebar.panellist` id that selects it. Both are gated on the Host serving
 * this plugin's settings namespace, because the renderer caches an entry's
 * inject face for the entry's lifetime — registering before the namespace
 * exists would cache the "unavailable" face forever.
 */

import { describe, expect, it, vi } from 'vitest'
import { MARKER_FIELD, SETTINGS_MARKER } from '../src/contract.js'
import { apply, NS, PANEL_ID } from '../src/client/index.js'
import type { McpServersFace } from '../src/client/mcp-servers-controller.js'

// The sidebar glyph pulls the harness's React primitives package; the wiring
// test never renders it, so a stub keeps this file free of the UI dependency.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconApiOutlineRegular: () => null,
}))

/** One namespace row, as the settings describe answer reports it. */
interface NamespaceRow {
  ns: string
  value: Record<string, unknown>
}

/** One recorded slot registration. */
interface Registration {
  slot: string
  options: Record<string, unknown>
}

/** A browser context with the services `apply()` touches, and no renderer. */
function harness() {
  let namespaces: NamespaceRow[] = []
  const describeListeners = new Set<() => void>()
  const registrations: Registration[] = []
  const injections = new Map<string, () => () => void>()
  const asked = new Set<string>()

  const describe = {
    getSnapshot: () => ({
      status: 'ready' as const,
      view: { namespaces, writable: true, hasDocument: true },
      error: null,
    }),
    subscribe: (listener: () => void) => {
      describeListeners.add(listener)
      return () => { describeListeners.delete(listener) }
    },
    ensure: async () => {},
    acceptView: () => {},
  }

  /** A ready form for one entry id. */
  function form(ns: string) {
    return {
      getSnapshot: () => ({
        status: 'ready' as const,
        value: {
          [MARKER_FIELD]: SETTINGS_MARKER,
          patchFile: `/tmp/${ns}.yml`,
          servers: [],
        },
        writable: true,
        revision: 0,
      }),
      subscribe: () => () => {},
      mutate: async () => true,
    }
  }

  const ctx = {
    logger: { debug: () => {} },
    locale: {
      bind: () => (key: string) => key,
      register: () => () => {},
    },
    configForms: {
      describe: () => describe,
      get: (ns: string) => { asked.add(ns); return form(ns) },
    },
    slots: {
      inject: (slot: string, callback: () => () => void) => {
        injections.set(slot, callback)
        return () => {}
      },
      register: (options: Record<string, unknown>) => {
        registrations.push({ slot: String(options['name']), options })
        return () => {}
      },
    },
    effect: (run: () => unknown) => { run(); return () => {} },
  }

  return {
    ctx,
    injections,
    registrations,
    asked,
    /** Publish one served namespace, as the describe mirror would after a read. */
    serve: (ns: string) => {
      namespaces = [{ ns, value: { [MARKER_FIELD]: SETTINGS_MARKER } }]
      for (const listener of describeListeners) listener()
    },
  }
}

describe('the page registers as a sidebar-selected main panel', () => {
  it('waits for the settings namespace before registering either half', () => {
    const { ctx, injections, registrations, serve } = harness()
    apply(ctx as never)

    // The slots exist (the harness declares them), but the page does not yet.
    expect(injections.has('main')).toBe(true)
    expect(injections.has('sidebar.panellist')).toBe(true)
    expect(injections.has('settings.plugins.tab')).toBe(false)

    injections.get('main')?.()
    injections.get('sidebar.panellist')?.()
    expect(registrations).toEqual([])

    serve('mcp-page-row')
    expect(registrations.map(registration => registration.slot)).toEqual(['main', 'sidebar.panellist'])
  })

  it('pairs the sidebar row and the panel by one id', () => {
    const { ctx, injections, registrations, serve } = harness()
    apply(ctx as never)
    injections.get('main')?.()
    injections.get('sidebar.panellist')?.()
    serve('mcp-page-row')

    const main = registrations.find(registration => registration.slot === 'main')
    const sidebar = registrations.find(registration => registration.slot === 'sidebar.panellist')
    expect(main?.options).toMatchObject({ key: PANEL_ID, locale: NS })
    expect(sidebar?.options).toMatchObject({ id: PANEL_ID, order: 20, locale: NS })
    expect((sidebar?.options['label'] as () => string)()).toBe('title')
  })

  it('binds the cached inject face to the served form', () => {
    const { ctx, injections, registrations, serve } = harness()
    apply(ctx as never)
    injections.get('main')?.()
    injections.get('sidebar.panellist')?.()
    serve('mcp-page-row')

    const main = registrations.find(registration => registration.slot === 'main')
    const face = (main?.options['inject'] as () => McpServersFace)()
    const state = face.hooks.mcpServers.getSnapshot()
    expect(state.available).toBe(true)
    expect(state.patchFile).toBe('/tmp/mcp-page-row.yml')
    expect(state.rows).toEqual([])
  })
})
