import { layout } from '@/config/layout'
import { cn } from '@/lib/utils'

interface WrapperProps {
  children: React.ReactNode
  className?: string
}

export function PageContainer({ children, className }: WrapperProps) {
  return (
    <div className={cn('mx-auto w-full', layout.pagePadding, layout.pageWidth, className)}>
      {children}
    </div>
  )
}

export function SectionStack({ children, className }: WrapperProps) {
  return <div className={cn('flex flex-col', layout.pageGap, className)}>{children}</div>
}

export function ContentStack({ children, className }: WrapperProps) {
  return <div className={cn('flex flex-col', layout.contentGap, className)}>{children}</div>
}

export function Panel({ children, className }: WrapperProps) {
  return <div className={cn(layout.panel, 'p-6', className)}>{children}</div>
}

export function MutedPanel({ children, className }: WrapperProps) {
  return <div className={cn(layout.panelMuted, 'p-5', className)}>{children}</div>
}

export function MainColumns({ children, className }: WrapperProps) {
  return (
    <div
      className={cn(
        'grid gap-12 lg:grid-cols-[minmax(0,1fr)_260px]',
        layout.columnGap,
        className,
      )}
    >
      {children}
    </div>
  )
}

export function DetailColumn({ children, className }: WrapperProps) {
  return <div className={cn('hidden lg:block', className)}>{children}</div>
}

