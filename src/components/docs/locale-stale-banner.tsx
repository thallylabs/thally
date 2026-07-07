import { Clock } from 'lucide-react'

interface LocaleStaleBannerProps {
  primaryHref: string
}

export function LocaleStaleBanner({ primaryHref }: LocaleStaleBannerProps) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-800/50 dark:bg-yellow-900/20 dark:text-yellow-300">
      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        This translation may be outdated.{' '}
        <a href={primaryHref} className="font-medium underline underline-offset-2 hover:no-underline">
          View original →
        </a>
      </p>
    </div>
  )
}
