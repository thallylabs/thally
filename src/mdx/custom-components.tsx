import type { MDXComponents } from 'mdx/types'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  THIS FILE IS YOURS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Register your own components here to use them in any `.mdx` page — no core
 *  files to touch, and nothing here is overwritten when you update Dox.
 *
 *  Anything you add is merged on top of Dox's built-in components, so you can:
 *    • add brand-new components (e.g. <PricingTable/>, <Roadmap/>), and
 *    • override a built-in by using the same key (e.g. `Note`, `Card`).
 *
 *  Example — a simple component you can use as `<Highlight>text</Highlight>`:
 *
 *    import type { ReactNode } from 'react'
 *
 *    function Highlight({ children }: { children: ReactNode }) {
 *      return (
 *        <mark className="rounded bg-accent/15 px-1 text-foreground">{children}</mark>
 *      )
 *    }
 *
 *    export const customComponents: MDXComponents = {
 *      Highlight,
 *    }
 *
 *  Components can be server or client components, import anything, and take
 *  props from MDX (`<PricingTable plan="pro" />`). See
 *  `src/components/mdx/rich-content.tsx` for how the built-ins are written.
 */
export const customComponents: MDXComponents = {
  // Add your components here, e.g.:
  // Highlight,
}
