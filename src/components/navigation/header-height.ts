/** Keep sticky rails and anchor offsets aligned when collection rows wrap or fonts load. */

/** Scope measurements to this docs shell and restore its CSS fallback on unmount. */
export function observeHeaderHeight(header: HTMLElement): () => void {
  const root = header.closest<HTMLElement>('.thally-docs-root')
  if (!root) return () => {}
  const previous = root.style.getPropertyValue('--docs-header-height')
  const updateHeight = () => {
    const height = header.getBoundingClientRect().height
    // Hidden or detached headers must not replace the server's useful fallback.
    if (height > 0) root.style.setProperty('--docs-header-height', `${height}px`)
  }
  updateHeight()
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight)
  observer?.observe(header)
  return () => {
    observer?.disconnect()
    if (previous) root.style.setProperty('--docs-header-height', previous)
    else root.style.removeProperty('--docs-header-height')
  }
}
