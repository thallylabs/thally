'use client'

/**
 * Runtime action bridge for documentation code samples and the navbar trigger.
 *
 * Code blocks can hydrate before the optional assistant chunk has loaded. This
 * provider owns the pending prompt at the documentation-layout boundary, so a
 * click is never lost during that loading window. It also keeps issue reports
 * aligned with the effective (including dashboard-updated) repository URL.
 */

import dynamic from 'next/dynamic'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { buildCodeReportUrl, createCodeAssistantPrompt } from '@/lib/code-actions'

const LazyDocsChat = dynamic(
  () => import('./docs-chat').then((module) => module.DocsChat),
  { ssr: false },
)

interface CodeActionsContextValue {
  canReportCode: boolean
  hasAssistantEntryPoint: boolean
  assistantLabel: string
  reportCode: (code: string) => void
  askAssistant: (code: string) => void
  openAssistant: () => void
}

const unavailableCodeActions: CodeActionsContextValue = {
  canReportCode: false,
  hasAssistantEntryPoint: false,
  assistantLabel: 'Ask AI',
  reportCode: () => {},
  askAssistant: () => {},
  openAssistant: () => {},
}

const CodeActionsContext = createContext<CodeActionsContextValue>(
  unavailableCodeActions,
)

interface ChatStatus {
  show: boolean
  label?: string
  icon?: string
  /** Opening questions derived from this site's navigation. */
  suggestions?: Array<string>
}

interface DocsCodeActionsProviderProps {
  children: ReactNode
  initialRepositoryUrl: string
  label?: string
  icon?: string
}

/**
 * Provide functional code-sample actions to every documentation route.
 *
 * Availability must be confirmed before exposing any assistant entry point.
 * Once available, selected prompts survive the lazy panel's loading window.
 */
export function DocsCodeActionsProvider({
  children,
  initialRepositoryUrl,
  label,
  icon,
}: DocsCodeActionsProviderProps) {
  const [repositoryUrl, setRepositoryUrl] = useState(initialRepositoryUrl)
  const [chatStatus, setChatStatus] = useState<ChatStatus>({ show: false })
  const [assistantPrompt, setAssistantPrompt] = useState<string | null>(null)
  const [assistantRequestId, setAssistantRequestId] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/chat-status', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: ChatStatus | null) => {
        if (value && typeof value.show === 'boolean') setChatStatus(value)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    fetch('/api/site-config')
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (typeof config?.repoUrl === 'string' && config.repoUrl.trim()) {
          setRepositoryUrl(config.repoUrl)
        }
      })
      .catch(() => {})
  }, [])

  const reportCode = useCallback((code: string) => {
    const url = buildCodeReportUrl({
      repositoryUrl,
      pageUrl: window.location.href,
      code,
    })
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [repositoryUrl])

  const requestAssistant = useCallback((prompt: string | null) => {
    if (!chatStatus.show) return
    setAssistantPrompt(prompt)
    // A monotonically increasing request id also reopens a panel after it was
    // closed with the same selected code still in state.
    setAssistantRequestId((requestId) => requestId + 1)
  }, [chatStatus.show])

  const askAssistant = useCallback((code: string) => {
    requestAssistant(createCodeAssistantPrompt(code))
  }, [requestAssistant])

  const openAssistant = useCallback(() => {
    requestAssistant(null)
  }, [requestAssistant])

  useEffect(() => {
    if (!chatStatus.show) return
    function handleAssistantShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        openAssistant()
      }
    }
    document.addEventListener('keydown', handleAssistantShortcut)
    return () => document.removeEventListener('keydown', handleAssistantShortcut)
  }, [chatStatus.show, openAssistant])

  const actions = useMemo<CodeActionsContextValue>(() => ({
    canReportCode: Boolean(buildCodeReportUrl({
      repositoryUrl,
      pageUrl: 'https://docs.example.com',
      code: '',
    })),
    // Pending, failed, and unavailable status checks all keep reader entry
    // points hidden; configuration instructions belong in the owner's admin.
    hasAssistantEntryPoint: chatStatus.show,
    assistantLabel: chatStatus?.label ?? label ?? 'Ask AI',
    reportCode,
    askAssistant,
    openAssistant,
  }), [askAssistant, chatStatus, label, openAssistant, reportCode, repositoryUrl])

  return (
    <CodeActionsContext.Provider value={actions}>
      {/* Share shell measurements with the sibling dock without adding a layout box. */}
      <div className="contents" data-docs-layout>
        {children}
        {chatStatus.show && assistantRequestId > 0 ? (
          <LazyDocsChat
            label={chatStatus.label ?? label}
            icon={chatStatus.icon ?? icon}
            enabled={chatStatus.show}
            starterSuggestions={chatStatus.suggestions}
            initialPrompt={assistantPrompt}
            openRequestId={assistantRequestId}
            skipStatusCheck
          />
        ) : null}
      </div>
    </CodeActionsContext.Provider>
  )
}

/** Read the documentation-layout actions from a rendered code sample. */
export function useDocsCodeActions(): CodeActionsContextValue {
  return useContext(CodeActionsContext)
}
