/** HTML-side audience gates for Mintlify-compatible authored MDX. */

import { Fragment, type ReactNode } from 'react'

export interface VisibilityProps {
  for: 'humans' | 'agents'
  children?: ReactNode
}

/** Render content intended for browser readers; agent projections filter at the content graph. */
export function Visibility({ for: audience, children }: VisibilityProps) {
  return audience === 'humans' ? <Fragment>{children}</Fragment> : null
}

/** Convenience wrapper equivalent to `<Visibility for="humans">`. */
export function Human({ children }: { children?: ReactNode }) {
  return <Fragment>{children}</Fragment>
}

/** Agent-only content is emitted by machine projections and omitted from HTML. */
export function Agent({ children }: { children?: ReactNode }) {
  void children
  return null
}
