/** Shared, deterministic header policy keeps rendered rows and sticky offsets in sync. */

/** Use the original single row through six tabs; the seventh starts a second row. */
export function getHeaderNavigationLayout(display: 'tabs' | 'dropdown', itemCount: number): 'none' | 'inline' | 'stacked' {
  if (display !== 'tabs' || itemCount === 0) return 'none'
  return itemCount >= 7 ? 'stacked' : 'inline'
}
