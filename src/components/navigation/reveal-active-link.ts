/** Scroll the sidebar so the current page's link is visible when it sits outside the scroll area. */
export function revealActiveLink(nav: HTMLElement | null): void {
  const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]')
  if (!nav || !link) return
  const area = nav.getBoundingClientRect()
  const box = link.getBoundingClientRect()
  if (box.top >= area.top && box.bottom <= area.bottom) return
  // Centre the link by moving only the sidebar: scrollIntoView would also scroll every ancestor, the page itself included.
  nav.scrollTop += (box.top - area.top) - (area.height - box.height) / 2
}
