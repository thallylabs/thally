'use client'

/** Loads the optional AI assistant only after its live availability is known. */

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

const LazyDocsChat = dynamic(
  () => import('./docs-chat').then((module) => module.DocsChat),
  { ssr: false },
)

interface DocsChatLoaderProps {
  label?: string
  icon?: string
}

interface ChatStatus {
  show: boolean
  label?: string
  icon?: string
}

/**
 * Keep React Markdown and the chat UI out of the initial documentation bundle.
 * Disabled sites download no assistant code at all.
 */
export function DocsChatLoader({ label, icon }: DocsChatLoaderProps) {
  const [status, setStatus] = useState<ChatStatus | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/chat-status', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: ChatStatus | null) => {
        if (value?.show === true) setStatus(value)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  if (!status) return null
  return (
    <LazyDocsChat
      label={status.label ?? label}
      icon={status.icon ?? icon}
      skipStatusCheck
    />
  )
}
