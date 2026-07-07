'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copy-to-clipboard button with a transient "Copied!" success indication. */
export function CopyButton({
  value,
  className,
  disabled,
  iconClassName = 'h-3 w-3',
}: {
  value: string
  className?: string
  disabled?: boolean
  iconClassName?: string
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        // clipboard unavailable (non-secure context) — fail silently
      })
  }

  return (
    <button type="button" disabled={disabled} onClick={handleCopy} className={className} aria-label={copied ? 'Copied' : 'Copy'}>
      {copied ? <Check className={`${iconClassName} text-green-500`} /> : <Copy className={iconClassName} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}
