import type { DocEntry } from '@/data/docs'
import { CopyPageButton } from '@/components/docs/copy-page-button'

interface DocHeaderProps {
  doc: DocEntry
  /** Category eyebrow above the title — the page's nearest navigation group. */
  eyebrow?: string | null
  showCopyPage?: boolean
}

export function DocHeader({ doc, eyebrow, showCopyPage = true }: DocHeaderProps) {
  return (
    <header className="thally-docs-header">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {eyebrow ? (
            <p className="thally-docs-eyebrow mb-2.5 text-sm font-semibold leading-5 text-accent">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-heading text-4xl font-semibold leading-10 tracking-[-0.025em] text-foreground">
            {doc.title}
          </h1>
          <p className="mt-2 max-w-[58ch] text-lg leading-7 text-foreground/80">{doc.description}</p>
        </div>
        {showCopyPage ? <CopyPageButton /> : null}
      </div>
    </header>
  )
}
