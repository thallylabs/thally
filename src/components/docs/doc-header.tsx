import type { DocEntry } from '@/data/docs'
import { CopyPageButton } from '@/components/docs/copy-page-button'

interface DocHeaderProps {
  doc: DocEntry
  /** Category eyebrow above the title — the page's nearest navigation group. */
  eyebrow?: string | null
}

export function DocHeader({ doc, eyebrow }: DocHeaderProps) {
  return (
    <header className="thally-docs-header">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {eyebrow ? (
            <p className="thally-docs-eyebrow mb-2.5 text-[0.82rem] font-semibold text-accent">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-heading text-[2.25rem] font-bold leading-[1.15] tracking-[-0.03em] text-foreground">
            {doc.title}
          </h1>
          <p className="mt-3.5 max-w-[60ch] text-[1.1rem] leading-[1.6] text-foreground/80">{doc.description}</p>
        </div>
        <CopyPageButton />
      </div>
    </header>
  )
}
