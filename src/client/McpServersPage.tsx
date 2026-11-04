/**
 * The MCP servers page.
 *
 * One card per server: the stdio or HTTP fields, its tool-name namespace, and
 * whether it was written here or by hand. A hand-written row is shown with its
 * fields but cannot be edited or removed from this page, because the plugin only
 * owns the rows it created — editing a row a person authored in YAML would make
 * the file and the page disagree about who is authoritative.
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `main` SlotMap entry behind PropsRuntime<'main'>.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ServerDraft } from './mcp-servers-controller.js'
import type { McpServersFace } from './mcp-servers-controller.js'
import type { McpServersLocaleKey } from './locales.js'
import { SNIPPET_EXAMPLE } from './server-snippet.js'
import type { SnippetIssue } from './server-snippet.js'

/** Props the renderer binds for the MCP servers page. */
export type McpServersProps =
  PropsRuntime<'main'>
  & PropsLocale<'settings.mcpServers'>
  & InjectFace<McpServersFace>

/** One labelled text control. */
function Field(props: {
  id: string
  label: string
  value: string
  hint?: string
  mono?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="mcp-field" htmlFor={props.id}>
      <span className="mcp-field-label">{props.label}</span>
      <input
        id={props.id}
        className={props.mono === true ? 'mcp-input mcp-mono' : 'mcp-input'}
        type="text"
        value={props.value}
        disabled={props.disabled === true}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => { props.onChange(event.target.value) }}
      />
      {props.hint === undefined ? null : <span className="mcp-hint">{props.hint}</span>}
    </label>
  )
}

/** A list of strings edited as one item per line. */
function Lines(props: {
  id: string
  label: string
  value: string[]
  hint: string
  disabled?: boolean
  onChange: (value: string[]) => void
}) {
  return (
    <label className="mcp-field" htmlFor={props.id}>
      <span className="mcp-field-label">{props.label}</span>
      <textarea
        id={props.id}
        className="mcp-input mcp-mono"
        rows={Math.max(2, props.value.length)}
        value={props.value.join('\n')}
        disabled={props.disabled === true}
        spellCheck={false}
        onChange={(event) => { props.onChange(event.target.value.split('\n')) }}
      />
      <span className="mcp-hint">{props.hint}</span>
    </label>
  )
}

/** Key/value rows, edited as `KEY=value` lines. */
function Pairs(props: {
  id: string
  label: string
  value: Array<[string, string]>
  hint: string
  disabled?: boolean
  onChange: (value: Array<[string, string]>) => void
}) {
  return (
    <label className="mcp-field" htmlFor={props.id}>
      <span className="mcp-field-label">{props.label}</span>
      <textarea
        id={props.id}
        className="mcp-input mcp-mono"
        rows={Math.max(2, props.value.length)}
        value={props.value.map(([key, entry]) => `${key}=${entry}`).join('\n')}
        disabled={props.disabled === true}
        spellCheck={false}
        onChange={(event) => {
          props.onChange(event.target.value.split('\n').map((line) => {
            const at = line.indexOf('=')
            return at < 0 ? [line, ''] as [string, string] : [line.slice(0, at), line.slice(at + 1)] as [string, string]
          }))
        }}
      />
      <span className="mcp-hint">{props.hint}</span>
    </label>
  )
}

/** Every `!!js` expression the row carries, as `path = source` lines. */
function Expressions(props: {
  id: string
  value: Array<[string[], string]>
  label: string
  hint: string
  disabled?: boolean
  onChange: (value: Array<[string[], string]>) => void
}) {
  return (
    <label className="mcp-field" htmlFor={props.id}>
      <span className="mcp-field-label">{props.label}</span>
      <textarea
        id={props.id}
        className="mcp-input mcp-mono"
        rows={Math.max(2, props.value.length)}
        value={props.value.map(([path, source]) => `${path.join('.')} = ${source}`).join('\n')}
        disabled={props.disabled === true}
        spellCheck={false}
        onChange={(event) => {
          props.onChange(event.target.value.split('\n').map((line) => {
            const at = line.indexOf('=')
            if (at < 0) return [line.trim().split('.').filter(Boolean), ''] as [string[], string]
            return [
              line.slice(0, at).trim().split('.').filter(Boolean),
              line.slice(at + 1).trim(),
            ] as [string[], string]
          }))
        }}
      />
      <span className="mcp-hint">{props.hint}</span>
    </label>
  )
}

/** One server's editable fields, for the row currently open. */
function Editor(props: {
  row: ServerDraft
  index: number
  disabled: boolean
  t: McpServersProps['t']
  onChange: (row: ServerDraft) => void
}) {
  const { row, t, disabled } = props
  const id = (name: string) => `mcp-${String(props.index)}-${name}`
  const patch = (change: Partial<ServerDraft>): void => { props.onChange({ ...row, ...change }) }
  return (
    <div className="mcp-editor">
      <div className="mcp-grid">
        <Field
          id={id('serverName')}
          label={t('serverName')}
          hint={t('serverNameHint')}
          mono
          disabled={disabled}
          value={row.serverName}
          onChange={(serverName) => { patch({ serverName }) }}
        />
        <Field
          id={id('id')}
          label={t('entryId')}
          hint={t('entryIdHint')}
          mono
          disabled={disabled}
          value={row.id}
          onChange={(value) => { patch({ id: value }) }}
        />
      </div>
      <label className="mcp-field" htmlFor={id('transport')}>
        <span className="mcp-field-label">{t('transport')}</span>
        <select
          id={id('transport')}
          className="mcp-input"
          value={row.transport}
          disabled={disabled}
          onChange={(event) => {
            patch({ transport: event.target.value === 'streamable-http' ? 'streamable-http' : 'stdio' })
          }}
        >
          <option value="stdio">{t('transportStdio')}</option>
          <option value="streamable-http">{t('transportHttp')}</option>
        </select>
      </label>
      {row.transport === 'stdio'
        ? (
          <>
            <Field
              id={id('command')} label={t('command')} hint={t('commandHint')} mono disabled={disabled}
              value={row.command} onChange={(command) => { patch({ command }) }}
            />
            <Lines
              id={id('args')} label={t('args')} hint={t('argsHint')} disabled={disabled}
              value={row.args} onChange={(args) => { patch({ args }) }}
            />
            <Field
              id={id('cwd')} label={t('cwd')} hint={t('cwdHint')} mono disabled={disabled}
              value={row.cwd} onChange={(cwd) => { patch({ cwd }) }}
            />
            <Pairs
              id={id('env')} label={t('env')} hint={t('envHint')} disabled={disabled}
              value={row.env} onChange={(env) => { patch({ env }) }}
            />
          </>
          )
        : (
          <>
            <Field
              id={id('url')} label={t('url')} hint={t('urlHint')} mono disabled={disabled}
              value={row.url} onChange={(url) => { patch({ url }) }}
            />
            <Pairs
              id={id('headers')} label={t('headers')} hint={t('headersHint')} disabled={disabled}
              value={row.headers} onChange={(headers) => { patch({ headers }) }}
            />
          </>
          )}
      <div className="mcp-grid">
        <Field
          id={id('timeout')} label={t('timeout')} hint={t('timeoutHint')} mono disabled={disabled}
          value={row.toolCallTimeoutMs}
          onChange={(toolCallTimeoutMs) => { patch({ toolCallTimeoutMs }) }}
        />
        <label className="mcp-field mcp-check" htmlFor={id('fail')}>
          <input
            id={id('fail')}
            type="checkbox"
            checked={row.failOnStartupError}
            disabled={disabled}
            onChange={(event) => { patch({ failOnStartupError: event.target.checked }) }}
          />
          <span>{t('failOnStartupError')}</span>
          <span className="mcp-hint">{t('failOnStartupErrorHint')}</span>
        </label>
      </div>
      <Expressions
        id={id('raw')} label={t('expressions')} hint={t('expressionsHint')} disabled={disabled}
        value={row.raw} onChange={(raw) => { patch({ raw }) }}
      />
      {Object.keys(row.extra).length === 0
        ? null
        : (
          <p className="mcp-hint">
            {t('keptFields')}
            <code className="mcp-mono">{Object.keys(row.extra).join(', ')}</code>
          </p>
          )}
    </div>
  )
}

/** One row's collapsed summary. */
function summaryOf(row: ServerDraft): string {
  if (row.transport === 'stdio') {
    const args = row.args.filter(arg => arg !== '').join(' ')
    return args === '' ? row.command : `${row.command} ${args}`
  }
  return row.url
}

/** Turn a refused paste into page copy. */
function issueMessage(issue: SnippetIssue, t: McpServersProps['t']): string {
  switch (issue.code) {
    case 'empty': return t('pasteEmpty')
    case 'yaml': return `${t('pasteBadYaml')}${issue.detail}`
    case 'shape': return t('pasteBadShape')
    case 'notMcp': return `${t('pasteNotMcp')}${issue.detail}`
    case 'missingConfig': return `${t('pasteMissingConfig')}${issue.detail}`
    case 'missingServerName': return `${t('pasteMissingServerName')}${issue.detail}`
    case 'badServerName': return `${t('pasteBadServerName')}${issue.detail}`
    case 'missingTransport': return `${t('pasteMissingTransport')}${issue.detail}`
    case 'badTransport': return `${t('pasteBadTransport')}${issue.detail}`
    case 'missingCommand': return `${t('pasteMissingCommand')}${issue.detail}`
    case 'missingUrl': return `${t('pasteMissingUrl')}${issue.detail}`
    case 'duplicate': return `${t('pasteDuplicate')}${issue.detail}`
    default: return t('pasteBadShape')
  }
}

/**
 * Render the MCP servers page.
 * @param props - locale copy, the staged state, and the page's actions.
 * @returns the page.
 */
export function McpServersPage(props: McpServersProps) {
  const { t } = props
  const state = props.useMcpServers(snapshot => snapshot)
  const [confirming, setConfirming] = useState<number>(-1)
  // The add flow is a paste box, not a blank row of fields: a configuration is
  // easier to copy from a working file than to retype field by field.
  const [pasting, setPasting] = useState(false)
  const [snippet, setSnippet] = useState('')
  const [issue, setIssue] = useState<SnippetIssue | undefined>(undefined)

  if (!state.available) {
    return <p className="mcp-note">{t('unavailable')}</p>
  }

  const rows = state.rows
  const closePaste = (): void => { setPasting(false); setIssue(undefined) }
  const openPaste = (): void => { setSnippet(''); setIssue(undefined); setPasting(true) }
  const submitPaste = (): void => {
    const problem = props.add(snippet)
    if (problem !== undefined) {
      setIssue(problem)
      return
    }
    closePaste()
    setSnippet('')
  }
  return (
    <div className="mcp-page">
      <div className="mcp-scroll">
        <div className="mcp-content">
          <header className="mcp-header">
            <h1 className="mcp-title">{t('title')}</h1>
            <p className="mcp-note">
              {t('intro')}
              {state.patchFile === '' ? null : <code className="mcp-path">{state.patchFile}</code>}
            </p>
            {state.watchFile ? null : <p className="mcp-note">{t('watchOff')}</p>}
          </header>

          {rows.length === 0 ? <p className="mcp-empty">{t('empty')}</p> : null}

          <ul className="mcp-list">
            {rows.map((row, index) => {
              const open = state.editing === index
              const external = row.origin === 'external'
              return (
                <li className="mcp-card" key={`${row.id}-${String(index)}`}>
                  <div className="mcp-card-head">
                    <div className="mcp-card-title">
                      <span className="mcp-mono">{row.serverName === '' ? t('newServer') : row.serverName}</span>
                      <span className="mcp-tag">{row.transport === 'stdio' ? t('transportStdio') : t('transportHttp')}</span>
                      {external ? <span className="mcp-tag mcp-tag-quiet">{t('externalTag')}</span> : null}
                    </div>
                    <div className="mcp-card-actions">
                      <button
                        type="button" className="mcp-button"
                        disabled={external || state.saving}
                        onClick={() => { props.toggleEdit(index) }}
                      >
                        {open ? t('close') : t('edit')}
                      </button>
                      <button
                        type="button" className="mcp-button mcp-button-danger"
                        disabled={external || state.saving}
                        onClick={() => {
                          if (confirming === index) {
                            props.remove(index)
                            setConfirming(-1)
                            return
                          }
                          setConfirming(index)
                        }}
                      >
                        {confirming === index ? t('confirmRemove') : t('remove')}
                      </button>
                    </div>
                  </div>
                  {external ? <p className="mcp-hint">{t('externalHint')}</p> : null}
                  {open
                    ? (
                      <Editor
                        row={row}
                        index={index}
                        disabled={external || state.saving}
                        t={t}
                        onChange={(next) => { props.replace(index, next) }}
                      />
                      )
                    : <p className="mcp-summary mcp-mono">{summaryOf(row)}</p>}
                </li>
              )
            })}
          </ul>

          {pasting
            ? (
              <section className="mcp-paste">
                <label className="mcp-field" htmlFor="mcp-paste-config">
                  <span className="mcp-field-label">{t('pasteLabel')}</span>
                  <textarea
                    id="mcp-paste-config"
                    className="mcp-input mcp-mono mcp-paste-input"
                    rows={10}
                    value={snippet}
                    placeholder={SNIPPET_EXAMPLE}
                    spellCheck={false}
                    autoFocus
                    onChange={(event) => {
                      setSnippet(event.target.value)
                      if (issue !== undefined) setIssue(undefined)
                    }}
                  />
                  <span className="mcp-hint">{t('pasteHint')}</span>
                </label>
                {issue === undefined ? null : <p className="mcp-error">{issueMessage(issue, t)}</p>}
                <div className="mcp-paste-actions">
                  <button type="button" className="mcp-button" onClick={closePaste}>
                    {t('pasteCancel')}
                  </button>
                  <button
                    type="button" className="mcp-button mcp-button-primary"
                    disabled={snippet.trim() === '' || state.saving}
                    onClick={submitPaste}
                  >
                    {t('pasteAdd')}
                  </button>
                </div>
              </section>
              )
            : null}

          <div className="mcp-footer">
            <button
              type="button" className="mcp-button"
              disabled={!state.writable || state.saving || pasting}
              onClick={openPaste}
            >
              {t('add')}
            </button>
            <div className="mcp-footer-right">
              {state.failed ? <span className="mcp-error">{t('saveFailed')}</span> : null}
              <button
                type="button" className="mcp-button"
                disabled={!state.dirty || state.saving}
                onClick={() => { props.discard() }}
              >
                {t('discard')}
              </button>
              <button
                type="button" className="mcp-button mcp-button-primary"
                disabled={!state.dirty || !state.writable || state.saving}
                onClick={() => { props.save() }}
              >
                {state.saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
