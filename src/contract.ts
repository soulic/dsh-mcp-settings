/**
 * The contract between the two halves.
 *
 * The page cannot know which loader entry id a profile gave this plugin, and the
 * settings wire addresses a form by exactly that id. So the Host publishes a
 * marker as an ordinary form value, and the page looks for the namespace that
 * carries it. A field-level value is used rather than the root schema's
 * description because the Host rebuilds the form schema field by field and drops
 * the root's metadata on the way.
 */

/** Form field whose value identifies this plugin's settings namespace. */
export const MARKER_FIELD = 'settingsMarker'

/** Value that field always carries. */
export const SETTINGS_MARKER = 'dsh-mcp-settings'

/**
 * Separator in the `expressions` form field's `<server id>\0<config path>` keys.
 *
 * NUL cannot appear in a loader id or a YAML key, so one flat string map can
 * address an expression leaf without ambiguity.
 */
export const EXPRESSION_KEY_SEPARATOR = '\u0000'

/**
 * The loader row name that declares one MCP server connection.
 *
 * Shared by both halves: the Host recognizes such a row in the patch file, and
 * the page accepts the same name when a configuration is pasted in.
 */
export const MCP_CLIENT_NAME = '@deepseek-ai/dsh-mcp-client'
