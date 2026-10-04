/** Scroll the sidebar so the current page's link is visible when it sits outside the scroll area. */
export function revealActiveLink(nav: HTMLElement | null): void {
  const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]')
  if (!nav || !link) return
  const area = nav.getBoundingClientRect()
  const box = link.getBoundingClientRect()
  if (box.top >= area.top && box.bottom <= area.bottom) return
  // Instant jump: no animation to suppress for reduced-motion readers and none on first load.
  link.scrollIntoView({ block: 'center', behavior: 'instant' })
}
