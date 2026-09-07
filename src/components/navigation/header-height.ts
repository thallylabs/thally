/** Keep sticky rails and anchor offsets aligned when collection rows wrap or fonts load. */

/** Scope measurements to this docs shell and restore its CSS fallback on unmount. */
export function observeHeaderHeight(header: HTMLElement): () => void {
  const root = header.closest<HTMLElement>('.thally-docs-root')
  if (!root) return () => {}
  // The assistant dock is a sibling of SiteShell inside its action provider.
  // Publish to that shared scope too, without leaking measurements across pages.
  const scopes = [...new Set([root, header.closest<HTMLElement>('[data-docs-layout]')])]
    .filter((scope): scope is HTMLElement => scope !== null)
  const previous = scopes.map((scope) => scope.style.getPropertyValue('--docs-header-height'))
  const updateHeight = () => {
    const height = header.getBoundingClientRect().height
    // Hidden or detached headers must not replace the server's useful fallback.
    if (height > 0) {
      for (const scope of scopes) scope.style.setProperty('--docs-header-height', `${height}px`)
    }
  }
  updateHeight()
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight)
  observer?.observe(header)
  return () => {
    observer?.disconnect()
    scopes.forEach((scope, index) => {
      if (previous[index]) scope.style.setProperty('--docs-header-height', previous[index])
      else scope.style.removeProperty('--docs-header-height')
    })
  }
}
