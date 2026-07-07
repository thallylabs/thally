'use client'

import Link from 'next/link'
import { parseAsStringEnum, useQueryState } from 'nuqs'
import type { ApiNavigationGroup } from '@/data/api-reference'
import { getMethodToken } from '@/components/api/tokens'
import { cn } from '@/lib/utils'

const HTTP_METHODS = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]
const methodFilterParser = parseAsStringEnum<HttpMethod>([...HTTP_METHODS]).withDefault('ALL')

interface OperationNavProps {
  navigation: Array<ApiNavigationGroup>
  activeOperationId: string
  variant?: 'sidebar' | 'drawer'
  className?: string
}

export function OperationNav({ navigation, activeOperationId, variant = 'sidebar', className }: OperationNavProps) {
  const [methodFilter, setMethodFilter] = useQueryState('method', methodFilterParser)

  const operations = navigation.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      group: group.title,
    })),
  )

  const filteredOperations =
    methodFilter === 'ALL' ? operations : operations.filter((operation) => operation.method === methodFilter)

  const methods: Array<HttpMethod> = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  const isDrawer = variant === 'drawer'

  return (
    <div
      className={cn(
        'space-y-4 rounded-2xl border border-border/40 p-3 sm:space-y-5 sm:p-4',
        isDrawer ? 'bg-transparent shadow-none' : 'bg-background/70 shadow-sm',
        className,
      )}
    >
      <div className="space-y-2 sm:space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-foreground/50 sm:text-xs">Filter by method</p>
          {isDrawer ? <span className="text-[10px] uppercase text-foreground/50 sm:text-[11px]">Filters</span> : null}
        </div>
        <div className={cn('flex flex-wrap gap-1.5 sm:gap-2', isDrawer && 'overflow-x-auto')}>
          {methods.map((method) => {
            const token = getMethodToken(method === 'ALL' ? '' : method)
            const active = methodFilter === method
            return (
              <button
                key={method}
                type="button"
                onClick={() => setMethodFilter(method)}
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition sm:px-3 sm:text-xs',
                  active ? `${token.bg} ${token.text}` : 'bg-muted/20 text-foreground/70 hover:bg-muted/50',
                )}
              >
                {method}
              </button>
            )
          })}
        </div>
      </div>
      <div className="space-y-2 sm:space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-foreground/50 sm:text-xs">Operations</p>
        <div className={cn('space-y-1', isDrawer ? 'max-h-[320px] overflow-y-auto pr-2' : 'max-h-[60vh] overflow-y-auto pr-1')}>
          {filteredOperations.map((operation) => {
            const active = operation.id === activeOperationId
            const token = getMethodToken(operation.method)
            return (
              <Link
                key={operation.id}
                href={operation.href}
                className={cn(
                  'block rounded-xl border border-border/30 p-2.5 transition hover:border-border/80 sm:p-3',
                  active ? 'bg-muted/50' : 'bg-transparent',
                )}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest sm:px-2 sm:text-[10px]', token.bg, token.text)}>
                      {operation.method}
                    </span>
                    <p className="break-words text-xs font-semibold text-foreground sm:text-sm">{operation.title}</p>
                  </div>
                  <p className="break-all text-[10px] text-foreground/60 sm:text-xs">{operation.path}</p>
                </div>
              </Link>
            )
          })}
          {!filteredOperations.length ? <p className="text-[10px] text-foreground/50 sm:text-xs">No operations match this method.</p> : null}
        </div>
      </div>
    </div>
  )
}

