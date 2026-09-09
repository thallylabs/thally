/**
 * Semantic MDX callouts shared by every standalone and managed Thally site.
 *
 * Each callout type carries exactly one hue. The fill, border, icon, title,
 * single-line text, links, and inline code all derive from that hue in
 * `src/styles/docs-handoff.css` (`--co`), so nothing here hand-picks a tint.
 * The component decides three things only: the intent (type), the layout
 * (a single line takes the hue; a titled or multi-block body stays in ink),
 * and whether an author supplied a custom hue.
 *
 * Authors choose intent through the MDX aliases (`<Note>`, `<Tip>`, ...) or
 * the generic `<Callout icon color colorDark>`. Custom colours are validated
 * before they reach an inline style: only plain CSS colour literals pass, so
 * migrated content can never smuggle arbitrary CSS into the page.
 */

import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react'
import { Icon as ContentIcon } from '@/components/mdx/content-icon'
import { cn } from '@/lib/utils'

export type NoteType = 'note' | 'tip' | 'info' | 'warning' | 'check' | 'danger'

export interface NoteProps {
  /**
   * Intent. Accepts the six tones plus the migration aliases `success` and
   * `error`, case-insensitively. Anything else falls back to inference from
   * the wording, exactly like an untyped callout.
   */
  type?: string
  title?: ReactNode
  /** Allowlisted icon name (see `content-icon.tsx`); replaces the type glyph. */
  icon?: string
  /** One CSS colour literal that drives fill, border, icon, and text. */
  color?: string
  /** Optional dark-theme colour; without it `color` is used in both themes. */
  colorDark?: string
  className?: string
  children: ReactNode
}

/**
 * Migrated content spells tones in several ways (`success`, `Error`, padded
 * values). The map is prototype-free so attribute values such as
 * `constructor` cannot resolve to an inherited member.
 */
const noteTypeAliases: Record<string, NoteType> = Object.assign(Object.create(null), {
  note: 'note',
  tip: 'tip',
  info: 'info',
  warning: 'warning',
  check: 'check',
  success: 'check',
  danger: 'danger',
  error: 'danger',
})

/** Map an authored `type` value onto a tone, or nothing when it is unknown. */
export function resolveNoteType(value: unknown): NoteType | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  return noteTypeAliases[value.trim().toLowerCase()]
}

interface ToneGlyph {
  /** Path data from the design handoff (Lucide-style, 24 viewBox). */
  paths: Array<string>
  strokeWidth: number
  /** Whether the glyph sits inside the shared 9px ring. */
  hasRing: boolean
}

/**
 * Type glyphs from the design handoff. They are inlined rather than pulled
 * from lucide-react so the strokes match the approved reference across every
 * scaffolded site; the ring and stroke weights are the handoff's, not Lucide's.
 */
const toneGlyphs: Record<NoteType, ToneGlyph> = {
  note: { paths: ['M12 8h.01M11 12h1v4h1'], strokeWidth: 1.8, hasRing: true },
  tip: {
    paths: ['M9 18h6M10 21h4M12 3a6 6 0 0 1 3.5 10.9c-.6.5-1 1.1-1 1.9v.2h-5v-.2c0-.8-.4-1.4-1-1.9A6 6 0 0 1 12 3z'],
    strokeWidth: 1.8,
    hasRing: false,
  },
  check: { paths: ['M20 6L9 17l-5-5'], strokeWidth: 2, hasRing: false },
  warning: { paths: ['M12 3l10 18H2L12 3zM12 10v4M12 17.5v.1'], strokeWidth: 1.8, hasRing: false },
  danger: { paths: ['M12 7.5V13M12 16.5v.1'], strokeWidth: 1.8, hasRing: true },
  info: { paths: ['M12 11v5M12 8v.1'], strokeWidth: 1.8, hasRing: true },
}

function ToneIcon({ type }: { type: NoteType }) {
  const glyph = toneGlyphs[type]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={glyph.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="thally-callout-icon"
    >
      {glyph.hasRing ? <circle cx="12" cy="12" r="9" /> : null}
      {glyph.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/**
 * Colour literals an author may pass. Hex, named colours, and the functional
 * notations are enough for documentation; anything else (url(), var(),
 * expressions, semicolons) is dropped so the value can be placed in a style
 * attribute without becoming an injection surface.
 */
const SAFE_COLOR_PATTERN =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{3,24}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([\w\s.,%/-]*\))$/i

/**
 * Words the pattern's keyword branch would accept but which are not usable
 * hues: CSS-wide keywords make the custom property invalid, `none` breaks
 * color-mix, and `currentcolor` would tint the surface with the page ink.
 */
const REJECTED_COLOR_KEYWORDS = new Set([
  'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none', 'currentcolor', 'transparent',
])

/** Return the colour when it is a plain CSS colour literal, otherwise nothing. */
export function safeCalloutColor(value?: string): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || !SAFE_COLOR_PATTERN.test(trimmed) || REJECTED_COLOR_KEYWORDS.has(trimmed.toLowerCase())) {
    return undefined
  }
  return trimmed
}

const DANGER_KEYWORDS = ['never expose', 'never share', 'keep your key', 'abuse', 'loss of funds', 'secure']
const WARNING_KEYWORDS = ['warning', 'caution', 'be careful', '注意', '小心']

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join(' ')
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    if (props?.children) {
      return extractText(props.children)
    }
  }
  return ''
}

/**
 * Untyped generic callouts (migrated `<Callout>` without a `type`) still get
 * a meaningful tone from their wording so a security warning never renders
 * as neutral information.
 */
function resolveTypeFromContent(children: ReactNode): NoteType {
  const normalized = extractText(children).toLowerCase()
  if (!normalized) {
    return 'info'
  }
  if (DANGER_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return 'danger'
  }
  if (WARNING_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return 'warning'
  }
  return 'info'
}

/**
 * Elements that start a new block. MDX emits these (as plain tag names) for
 * block-authored content; inline-authored content only ever contains text and
 * phrasing elements, some of which are mapped to components such as `Code`.
 */
const BLOCK_TAGS = new Set([
  'p', 'div', 'ul', 'ol', 'li', 'dl', 'pre', 'blockquote', 'table', 'figure', 'img', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'aside', 'details',
])

/**
 * A callout is a single line when it holds one run of text and nothing else.
 * MDX hands us one paragraph element for block authoring, or a mix of strings
 * and phrasing elements for inline authoring; both read as one sentence that
 * takes the hue. Anything with several blocks, a block element, or no text at
 * all (a lone component) is a body and stays in ink for readability.
 */
export function isSingleLine(children: ReactNode): boolean {
  let significant = 0
  let hasText = false
  let hasParagraph = false
  let hasBlock = false
  Children.forEach(children, (child) => {
    if (child === null || child === undefined || typeof child === 'boolean') {
      return
    }
    if (typeof child === 'string' || typeof child === 'number') {
      if (typeof child === 'string' && child.trim() === '') {
        return
      }
      significant += 1
      hasText = true
      return
    }
    significant += 1
    if (isValidElement(child) && typeof child.type === 'string') {
      if (child.type === 'p') {
        hasParagraph = true
      } else if (BLOCK_TAGS.has(child.type)) {
        hasBlock = true
      }
    }
  })
  if (significant === 0 || hasBlock) {
    return false
  }
  if (hasParagraph) {
    return significant === 1
  }
  return hasText
}

/**
 * Render one callout. Tone precedence is the authored `type` (normalised
 * through the alias map), then `custom` when a colour is supplied, then a
 * tone inferred from the wording. Layout is `titled` when a title is given,
 * `solo` for a single line of text, otherwise `body`. The stylesheet keys
 * every colour decision off the resulting data attributes.
 */
export function Note({ type, title, icon, color, colorDark, className, children }: NoteProps) {
  const customColor = safeCalloutColor(color)
  const customDarkColor = safeCalloutColor(colorDark)
  const hasCustomColor = Boolean(customColor || customDarkColor)
  const resolvedType = resolveNoteType(type)
  const tone = resolvedType ?? (hasCustomColor ? 'custom' : resolveTypeFromContent(children))
  const layout = title ? 'titled' : isSingleLine(children) ? 'solo' : 'body'

  // Both theme slots are always filled so a type's own dark hue can never
  // leak into a callout the author coloured for one theme only.
  const style = hasCustomColor
    ? ({
        '--co-light': customColor ?? customDarkColor,
        '--co-dark': customDarkColor ?? customColor,
      } as CSSProperties)
    : undefined

  return (
    <aside
      data-callout={tone}
      data-callout-layout={layout}
      data-callout-color={hasCustomColor ? 'custom' : undefined}
      className={cn('thally-callout not-prose', className)}
      style={style}
    >
      {icon ? (
        <ContentIcon icon={icon} className="thally-callout-icon" />
      ) : (
        <ToneIcon type={resolvedType ?? (tone === 'custom' ? 'note' : tone)} />
      )}
      <div className="thally-callout-content">
        {title ? <div className="thally-callout-title">{title}</div> : null}
        {children}
      </div>
    </aside>
  )
}
