import type { DocEntry } from '@/data/docs'
import { CopyPageButton } from '@/components/docs/copy-page-button'

interface DocHeaderProps {
  doc: DocEntry
}

export function DocHeader({ doc }: DocHeaderProps) {
  return (
    <header className="thally-docs-header mb-9 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="font-heading text-[2.05rem] font-extrabold leading-[1.12] tracking-[-0.03em] text-foreground">
            {doc.title}
          </h1>
          <p className="mt-3.5 max-w-[62ch] text-[1.05rem] leading-[1.65] text-foreground/75">{doc.description}</p>
        </div>
        <CopyPageButton />
      </div>
    </header>
  )
}
