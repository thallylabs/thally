/** Accessible focus and background management for the admin mobile drawer. */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(drawer: HTMLElement): Array<HTMLElement> {
  return Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  )
}

/** Keep Tab and Escape behavior inside an open modal navigation drawer. */
export function handleMobileDrawerKeyDown(
  event: KeyboardEvent,
  drawer: HTMLElement,
  onDismiss: () => void,
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    onDismiss()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = focusableElements(drawer)
  if (focusable.length === 0) {
    event.preventDefault()
    drawer.focus()
    return
  }
  const first = focusable[0]
  const last = focusable.at(-1)!
  const active = drawer.ownerDocument.activeElement
  if (event.shiftKey && (active === first || !drawer.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Activate modal-drawer semantics and return an exact restoration function.
 * Existing page state is preserved so nested shells and host applications are
 * not left inert or scroll-locked after navigation.
 */
export function activateMobileDrawer(
  drawer: HTMLElement,
  background: HTMLElement,
  opener: HTMLElement,
  onDismiss: () => void,
): () => void {
  const document = drawer.ownerDocument
  const priorInert = background.inert
  const priorAriaHidden = background.getAttribute('aria-hidden')
  const priorOverflow = document.body.style.overflow
  const onKeyDown = (event: KeyboardEvent) => {
    handleMobileDrawerKeyDown(event, drawer, onDismiss)
  }

  background.inert = true
  background.setAttribute('aria-hidden', 'true')
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeyDown)
  const entry = drawer.querySelector<HTMLElement>('[data-drawer-entry]')
  ;(entry ?? focusableElements(drawer)[0] ?? drawer).focus()

  return () => {
    document.removeEventListener('keydown', onKeyDown)
    background.inert = priorInert
    if (priorAriaHidden === null) background.removeAttribute('aria-hidden')
    else background.setAttribute('aria-hidden', priorAriaHidden)
    document.body.style.overflow = priorOverflow
    opener.focus()
  }
}
