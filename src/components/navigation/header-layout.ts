/** Shared, deterministic header policy keeps rendered rows and sticky offsets in sync. */

/** Give every tab collection the full shell width, independent of brand or action length. */
export function getHeaderNavigationLayout(display: 'tabs' | 'dropdown', itemCount: number): 'none' | 'stacked' {
  if (display !== 'tabs' || itemCount === 0) return 'none'
  return 'stacked'
}
