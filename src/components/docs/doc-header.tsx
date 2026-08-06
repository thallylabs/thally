import type { DocEntry } from '@/data/docs'
import { CopyPageButton } from '@/components/docs/copy-page-button'

interface DocHeaderProps {
  doc: DocEntry
  /** Category eyebrow above the title — the page's nearest navigation group. */
  eyebrow?: string | null
}

export function DocHeader({ doc, eyebrow }: DocHeaderProps) {
  return (
    <header className="thally-docs-header space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {eyebrow ? (
            <p className="thally-docs-eyebrow mt-2 mb-3 text-sm font-bold text-accent">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-heading text-[2rem] font-medium leading-9 tracking-[-0.025em] text-foreground sm:text-4xl sm:leading-10">
            {doc.title}
          </h1>
          <p className="mt-4 max-w-[62ch] text-lg leading-7 text-foreground/70">{doc.description}</p>
        </div>
        <CopyPageButton />
      </div>
    </header>
  )
}
