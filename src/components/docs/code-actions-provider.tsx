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
 * The assistant remains lazily loaded, but a prompt selected before its status
 * request resolves is retained and applied as soon as the panel mounts.
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
    setAssistantPrompt(prompt)
    // A monotonically increasing request id also reopens a panel after it was
    // closed with the same selected code still in state.
    setAssistantRequestId((requestId) => requestId + 1)
  }, [])

  const askAssistant = useCallback((code: string) => {
    requestAssistant(createCodeAssistantPrompt(code))
  }, [requestAssistant])

  const openAssistant = useCallback(() => {
    requestAssistant(null)
  }, [requestAssistant])

  useEffect(() => {
    function handleAssistantShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        openAssistant()
      }
    }
    document.addEventListener('keydown', handleAssistantShortcut)
    return () => document.removeEventListener('keydown', handleAssistantShortcut)
  }, [openAssistant])

  const actions = useMemo<CodeActionsContextValue>(() => ({
    canReportCode: Boolean(buildCodeReportUrl({
      repositoryUrl,
      pageUrl: 'https://docs.example.com',
      code: '',
    })),
    // The navigation entry point is always available in a docs shell. When a
    // deployment has no AI service, its panel explains that state instead of
    // making the feature appear to have disappeared.
    hasAssistantEntryPoint: true,
    assistantLabel: chatStatus?.label ?? label ?? 'Ask AI',
    reportCode,
    askAssistant,
    openAssistant,
  }), [askAssistant, chatStatus, label, openAssistant, reportCode, repositoryUrl])

  return (
    <CodeActionsContext.Provider value={actions}>
      {children}
      {assistantRequestId > 0 ? (
        <LazyDocsChat
          label={chatStatus.label ?? label}
          icon={chatStatus.icon ?? icon}
          enabled={chatStatus.show}
          initialPrompt={assistantPrompt}
          openRequestId={assistantRequestId}
          skipStatusCheck
        />
      ) : null}
    </CodeActionsContext.Provider>
  )
}

/** Read the documentation-layout actions from a rendered code sample. */
export function useDocsCodeActions(): CodeActionsContextValue {
  return useContext(CodeActionsContext)
}
