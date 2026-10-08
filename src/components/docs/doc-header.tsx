import { getContextualOptions, type DocEntry } from '@/data/docs'
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
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="thally-docs-eyebrow mb-2.5 text-sm font-semibold leading-5 text-accent">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="break-words font-heading text-4xl font-semibold leading-10 tracking-[-0.025em] text-foreground">
            {doc.headingTitle ?? doc.title}
          </h1>
          {doc.description && doc.descriptionPlacement !== 'body' ? (
            <p className="mt-2 max-w-[58ch] text-lg leading-7 text-foreground/80">{doc.description}</p>
          ) : null}
        </div>
        {showCopyPage ? <CopyPageButton options={getContextualOptions()} /> : null}
      </div>
    </header>
  )
}
