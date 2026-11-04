/**
 * Decorative occupant for the MCP servers sidebar entry.
 *
 * The sidebar owns the button, its accessible label, the selected state, and the
 * tooltip; the registrant supplies only the glyph at the edge the row asks for.
 */
import { IconApiOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the API glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share: the requested edge and selection state.
 * @returns decorative API icon.
 */
export function McpServersIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconApiOutlineRegular size={size} />
}
