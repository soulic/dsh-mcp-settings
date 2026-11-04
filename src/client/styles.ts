/**
 * MCP servers page styles.
 *
 * Shipped as a string rather than a `.css` file because this package is built
 * outside the harness workspace, where the client-bundle preset that compiles and
 * injects stylesheets is not available. The page injects it once under a tagged
 * `<style>` element, so a hot reload replaces the sheet instead of stacking one.
 *
 * Every selector is namespaced `mcp-` and the sheet sets no global rules: the page
 * is a first-level main panel and must not restyle the frame around it.
 */

/** The page's stylesheet. */
export const STYLES = `
.mcp-page { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0;
  overflow: hidden; }
.mcp-scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.mcp-content { box-sizing: border-box; display: flex; flex-direction: column; gap: 16px;
  width: 100%; max-width: 960px; margin: 0 auto;
  padding: 28px clamp(24px, 4vw, 48px) 48px; }
[data-platform='darwin'] .mcp-content { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.mcp-title { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
.mcp-header { display: flex; flex-direction: column; gap: 8px; }
.mcp-note { margin: 0; color: var(--dsh-text-secondary, #8b8b8b); font-size: 13px; line-height: 1.6; }
.mcp-path { margin-left: 6px; padding: 2px 6px; border-radius: 4px; font-size: 12px;
  background: var(--dsh-surface-sunken, rgba(127, 127, 127, 0.12)); }
.mcp-empty { margin: 0; padding: 24px; border-radius: 8px; text-align: center; font-size: 13px;
  color: var(--dsh-text-secondary, #8b8b8b); border: 1px dashed var(--dsh-border, rgba(127, 127, 127, 0.3)); }
.mcp-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.mcp-card { padding: 12px 14px; border-radius: 8px; display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--dsh-border, rgba(127, 127, 127, 0.24));
  background: var(--dsh-surface, transparent); }
.mcp-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mcp-card-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mcp-card-actions { display: flex; gap: 6px; flex-shrink: 0; }
.mcp-tag { padding: 1px 6px; border-radius: 999px; font-size: 11px; white-space: nowrap;
  background: var(--dsh-surface-sunken, rgba(127, 127, 127, 0.14)); }
.mcp-tag-quiet { opacity: 0.7; }
.mcp-summary { margin: 0; font-size: 12px; overflow-wrap: anywhere;
  color: var(--dsh-text-secondary, #8b8b8b); }
.mcp-editor { display: flex; flex-direction: column; gap: 10px; }
.mcp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.mcp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mcp-field-label { font-size: 12px; font-weight: 500; }
.mcp-check { flex-direction: row; align-items: center; gap: 6px; font-size: 13px; flex-wrap: wrap; }
.mcp-input { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; font: inherit; font-size: 13px;
  color: inherit; background: var(--dsh-surface-sunken, rgba(127, 127, 127, 0.08));
  border: 1px solid var(--dsh-border, rgba(127, 127, 127, 0.3)); }
.mcp-input:disabled { opacity: 0.6; cursor: not-allowed; }
.mcp-input:focus-visible { outline: 2px solid var(--dsh-focus, #4c8dff); outline-offset: 1px; }
.mcp-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.mcp-hint { font-size: 11px; line-height: 1.5; color: var(--dsh-text-secondary, #8b8b8b); }
.mcp-error { font-size: 12px; color: var(--dsh-danger, #e5484d); white-space: pre-wrap; overflow-wrap: anywhere; }
.mcp-paste { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; border-radius: 8px;
  border: 1px dashed var(--dsh-border, rgba(127, 127, 127, 0.4));
  background: var(--dsh-surface-sunken, rgba(127, 127, 127, 0.06)); }
.mcp-paste-input { resize: vertical; min-height: 160px; line-height: 1.5; }
.mcp-paste-actions { display: flex; justify-content: flex-end; gap: 8px; }
.mcp-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mcp-footer-right { display: flex; align-items: center; gap: 8px; }
.mcp-button { padding: 5px 12px; border-radius: 6px; font: inherit; font-size: 13px; cursor: pointer;
  color: inherit; background: var(--dsh-surface-sunken, rgba(127, 127, 127, 0.12));
  border: 1px solid var(--dsh-border, rgba(127, 127, 127, 0.3)); }
.mcp-button:hover:not(:disabled) { background: var(--dsh-surface-hover, rgba(127, 127, 127, 0.2)); }
.mcp-button:disabled { opacity: 0.5; cursor: not-allowed; }
.mcp-button:focus-visible { outline: 2px solid var(--dsh-focus, #4c8dff); outline-offset: 1px; }
.mcp-button-primary { font-weight: 500;
  background: var(--dsh-accent, #3b6fe0); border-color: var(--dsh-accent, #3b6fe0); color: #fff; }
.mcp-button-danger { color: var(--dsh-danger, #e5484d); }
`
