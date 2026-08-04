'use client'

import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import clsx from 'clsx'
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { create } from 'zustand'

import { Tag } from '@/components/ui/tag'
import { siteConfig } from '@/data/site'

const languageNames: Record<string, string> = {
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
  css: 'CSS',
  html: 'HTML',
  js: 'JavaScript',
  ts: 'TypeScript',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  jsonc: 'JSONC',
  md: 'Markdown',
  markdown: 'Markdown',
  mdx: 'MDX',
  yaml: 'YAML',
  yml: 'YAML',
  php: 'PHP',
  python: 'Python',
  ruby: 'Ruby',
  go: 'Go',
}

function getPanelTitle({
  title,
  language,
}: {
  title?: string
  language?: string
}) {
  if (title) {
    return title
  }
  if (language && language in languageNames) {
    return languageNames[language]
  }
  if (language) {
    return language.toUpperCase()
  }
  return 'Code'
}

function ClipboardIcon(props: ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" {...props}>
      <path
        strokeWidth="0"
        d="M5.5 13.5v-5a2 2 0 0 1 2-2l.447-.894A2 2 0 0 1 9.737 4.5h.527a2 2 0 0 1 1.789 1.106l.447.894a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2Z"
      />
      <path
        fill="none"
        strokeLinejoin="round"
        d="M12.5 6.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2m5 0-.447-.894a2 2 0 0 0-1.79-1.106h-.527a2 2 0 0 0-1.789 1.106L7.5 6.5m5 0-1 1h-3l-1-1"
      />
    </svg>
  )
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    await window.navigator.clipboard.writeText(value)
    return true
  } catch {
    // Clipboard access can be unavailable in embedded or non-secure previews.
    // Keep copy functional there using the browser's legacy selection path.
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    try {
      return document.execCommand('copy')
    } finally {
      textarea.remove()
    }
  }
}

function CopyButton({ code }: { code: string }) {
  const [copyCount, setCopyCount] = useState(0)
  const copied = copyCount > 0

  useEffect(() => {
    if (copyCount > 0) {
      const timeout = setTimeout(() => setCopyCount(0), 1000)
      return () => {
        clearTimeout(timeout)
      }
    }
  }, [copyCount])

  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy code'}
      title={copied ? 'Copied' : 'Copy'}
      className="group/button relative inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
      onClick={() => {
        void writeClipboardText(code).then((wasCopied) => {
          if (wasCopied) setCopyCount((count) => count + 1)
        })
      }}
    >
      <span
        aria-hidden={copied}
        className={clsx('pointer-events-none transition duration-200', copied && '-translate-y-1 opacity-0')}
      >
        <ClipboardIcon className="h-[15px] w-[15px] fill-transparent stroke-current" />
      </span>
      <span
        aria-hidden={!copied}
        className={clsx(
          'pointer-events-none absolute inset-0 flex items-center justify-center text-accent transition duration-200',
          !copied && 'translate-y-1 opacity-0',
        )}
      >
        ✓
      </span>
    </button>
  )
}

function CodeActions({ code }: { code: string }) {
  const repositoryUrl = siteConfig.repoUrl || siteConfig.links.find((link) => link.label.toLowerCase() === 'github')?.href

  function reportCode() {
    if (!repositoryUrl) return
    try {
      const url = new URL(`${repositoryUrl.replace(/\/$/, '')}/issues/new`)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return
      url.searchParams.set('title', 'Docs: incorrect code sample')
      url.searchParams.set('body', `Page: ${window.location.href}\n\nCode sample:\n\n\`\`\`\n${code}\n\`\`\``)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      // A malformed optional repository URL should not break code samples.
    }
  }

  function askAssistant() {
    window.dispatchEvent(new CustomEvent('thally:ask-assistant', {
      detail: { prompt: `Explain this code sample and check it for mistakes:\n\n\`\`\`\n${code}\n\`\`\`` },
    }))
  }

  return (
    <span className="ml-auto flex items-center gap-0.5">
      <button type="button" onClick={reportCode} disabled={!repositoryUrl} className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35" aria-label="Report incorrect code" title="Report incorrect code">
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2L8.2 3z"/><path d="M12 7.5V13" strokeLinecap="round"/><path d="M12 16.2v.1" strokeLinecap="round" strokeWidth="2.2"/></svg>
      </button>
      <CopyButton code={code} />
      <button type="button" onClick={askAssistant} className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-white/60 transition hover:bg-white/10 hover:text-white" aria-label="Ask assistant about this code" title="Ask Assistant">
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5l1.8 4.9 4.9 1.8-4.9 1.8L12 16.9l-1.8-4.9-4.9-1.8 4.9-1.8L12 3.5z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/></svg>
      </button>
    </span>
  )
}

function CodePanelHeader({ tag, label, code }: { tag?: string; label?: string; code: string }) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-white/10 px-3.5">
      {tag && (
        <div className="flex">
          <Tag variant="small">{tag}</Tag>
        </div>
      )}
      {tag && label && (
        <span className="h-0.5 w-0.5 rounded-full bg-zinc-500" />
      )}
      {label && (
        <span className="font-mono text-[0.74rem] text-white/60">{label}</span>
      )}
      <CodeActions code={code} />
    </div>
  )
}

function getRenderableChildren(children: ReactNode) {
  return Children.toArray(children).filter((child) => {
    if (child === null || typeof child === 'undefined') {
      return false
    }
    if (typeof child === 'boolean') {
      return false
    }
    if (typeof child === 'string') {
      return child.trim().length > 0
    }
    return true
  })
}

/** Find the compiler's source-code payload through MDX/client wrappers. */
function findCodePayload(node: ReactNode): string | undefined {
  if (!isValidElement(node)) return undefined
  const props = node.props as { code?: unknown; children?: ReactNode }
  if (typeof props.code === 'string' && props.code.length > 0) return props.code
  for (const child of Children.toArray(props.children)) {
    const nested = findCodePayload(child)
    if (nested) return nested
  }
  return undefined
}

function CodePanel({
  children,
  tag,
  label,
  code,
  language,
  wrap,
  hasGroupHeader,
}: {
  children: ReactNode
  tag?: string
  label?: string
  code?: string
  language?: string
  wrap?: boolean
  hasGroupHeader?: boolean
}) {
  const renderableChildren = getRenderableChildren(children)
  if (!renderableChildren.length) {
    return null
  }

  const primaryChild = renderableChildren[0]
  const content =
    renderableChildren.length === 1 ? primaryChild : <>{renderableChildren}</>

  function getLanguageClassName() {
    const probe = renderableChildren.find((child) => isValidElement(child))
    if (!probe) return ''
    const className = (probe.props as { className?: string }).className ?? ''
    const match = className.match(/language-[\w-]+/)
    return match?.[0] ?? ''
  }

  const languageClass = getLanguageClassName()

  let resolvedTag = tag
  let resolvedLabel = label
  let resolvedCode = code
  let resolvedWrap = wrap

  const referenceElement = renderableChildren.find((child) =>
    isValidElement(child),
  )

  if (referenceElement) {
    const props = referenceElement.props as {
      tag?: string
      label?: string
      code?: string
      wrap?: boolean | string
    }
    resolvedTag = props.tag ?? resolvedTag
    resolvedLabel = props.label ?? resolvedLabel
    resolvedCode = props.code ?? resolvedCode
    // MDX may serialize the boolean fence flag as an empty-string attribute.
    resolvedWrap = resolvedWrap ?? (props.wrap === '' ? true : Boolean(props.wrap))
  } else if (!resolvedCode) {
    const extractedText = renderableChildren
      .map((child) => (typeof child === 'string' ? child : ''))
      .join('')
      .trim()
    if (extractedText) {
      resolvedCode = extractedText
    }
  }

  // Client-component serialization may place the compiler-added `code` prop
  // one wrapper below the direct child. Search recursively before treating the
  // block as malformed; a bad authoring example should never take the entire
  // pre-rendered documentation site offline.
  resolvedCode = resolvedCode ?? findCodePayload(content) ?? ''

  return (
    <div className="group">
      {hasGroupHeader ? (
        <span className="absolute right-3 top-[7px] z-10">
          <CodeActions code={resolvedCode} />
        </span>
      ) : (
        <CodePanelHeader
          tag={resolvedTag}
          label={resolvedLabel ?? getPanelTitle({ language })}
          code={resolvedCode}
        />
      )}
      <div className="relative">
        <pre
          className={clsx(
            'p-4 font-mono text-[0.82rem] leading-[1.65] text-white',
            resolvedWrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto',
            languageClass,
          )}
          suppressHydrationWarning
        >
          {content}
        </pre>
      </div>
    </div>
  )
}

function CodeGroupHeader({
  title,
  children,
  selectedIndex,
}: {
  title?: string
  children: React.ReactNode
  selectedIndex: number
}) {
  const hasTabs = Children.count(children) > 1

  if (!title && !hasTabs) {
    return null
  }

  return (
    <div className="flex min-h-10 flex-wrap items-start gap-x-4 border-b border-white/10 px-4 pr-24">
      {title && (
        <p className="mr-auto pt-3 text-xs font-semibold text-white">
          {title}
        </p>
      )}
      {hasTabs && (
        <TabList className="-mb-px flex gap-4 text-xs font-medium">
          {Children.map(children, (child, childIndex) => (
            <Tab
              className={clsx(
                'border-b py-3 transition focus-visible:outline-none',
                childIndex === selectedIndex
                  ? 'border-accent text-accent'
                  : 'border-transparent text-white/55 hover:text-white',
              )}
            >
              {getPanelTitle(
                isValidElement(child)
                  ? (child.props as { title?: string })
                  : {},
              )}
            </Tab>
          ))}
        </TabList>
      )}
    </div>
  )
}

function CodeGroupPanels({
  children,
  ...props
}: ComponentPropsWithoutRef<typeof CodePanel>) {
  const hasTabs = Children.count(children) > 1

  if (hasTabs) {
    return (
      <TabPanels>
        {Children.map(children, (child) => (
          <TabPanel>
            <CodePanel {...props}>{child}</CodePanel>
          </TabPanel>
        ))}
      </TabPanels>
    )
  }

  return <CodePanel {...props}>{children}</CodePanel>
}

const usePreferredLanguageStore = create<{
  preferredLanguages: Array<string>
  addPreferredLanguage: (language: string) => void
}>()((set) => ({
  preferredLanguages: [],
  addPreferredLanguage: (language) =>
    set((state) => ({
      preferredLanguages: [
        ...state.preferredLanguages.filter(
          (preferredLanguage) => preferredLanguage !== language,
        ),
        language,
      ],
    })),
}))

function resolvePreferredLanguage(
  availableLanguages: Array<string>,
  preferredLanguages: Array<string>,
) {
  if (!availableLanguages.length) {
    return undefined
  }
  const languageSet = new Set(availableLanguages)
  for (let index = preferredLanguages.length - 1; index >= 0; index -= 1) {
    const candidate = preferredLanguages[index]
    if (languageSet.has(candidate)) {
      return candidate
    }
  }
  return availableLanguages[0]
}

function useTabGroupProps(availableLanguages: Array<string>) {
  const { preferredLanguages, addPreferredLanguage } = usePreferredLanguageStore()

  // Derive the selected tab from the shared preference store instead of
  // mirroring it into local state — selecting a language in one group
  // switches every group on the page.
  const preferredLanguage = resolvePreferredLanguage(availableLanguages, preferredLanguages)
  const preferredIndex = preferredLanguage ? availableLanguages.indexOf(preferredLanguage) : 0
  const selectedIndex = preferredIndex === -1 ? 0 : preferredIndex

  return {
    as: 'div' as const,
    selectedIndex,
    onChange: (newSelectedIndex: number) => {
      const language = availableLanguages[newSelectedIndex]
      if (language) {
        addPreferredLanguage(language)
      }
    },
  }
}

const CodeGroupContext = createContext(false)

export function CodeGroup({
  children,
  title,
  ...props
}: ComponentPropsWithoutRef<typeof CodeGroupPanels> & { title?: string }) {
  const languages = useMemo(
    () =>
    Children.map(children, (child) =>
      getPanelTitle(
        isValidElement(child) ? (child.props as { title?: string }) : {},
      ),
      ) ?? [],
    [children],
  )
  const tabGroupProps = useTabGroupProps(languages)
  const hasTabs = Children.count(children) > 1
  const hasGroupHeader = Boolean(title || hasTabs)

  const containerClassName =
    'thally-docs-code relative my-5 overflow-hidden rounded-[11px] border'
  const header = (
    <CodeGroupHeader title={title} selectedIndex={tabGroupProps.selectedIndex}>
      {children}
    </CodeGroupHeader>
  )
  const panels = <CodeGroupPanels {...props} hasGroupHeader={hasGroupHeader}>{children}</CodeGroupPanels>

  return (
    <CodeGroupContext.Provider value={true}>
      {hasTabs ? (
        <TabGroup {...tabGroupProps} className={containerClassName}>
          <div className="not-prose">
            {header}
            {panels}
          </div>
        </TabGroup>
      ) : (
        <div className={containerClassName}>
          <div className="not-prose">
            {header}
            {panels}
          </div>
        </div>
      )}
    </CodeGroupContext.Provider>
  )
}

export function Code({
  children,
  ...props
}: ComponentPropsWithoutRef<'code'>) {
  const isGrouped = useContext(CodeGroupContext)

  if (isGrouped) {
    if (typeof children !== 'string') {
      throw new Error(
        '`Code` children must be a string when nested inside a `CodeGroup`.',
      )
    }
    return (
      <code
        {...props}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: children }}
      />
    )
  }

  return <code {...props}>{children}</code>
}

export function Pre({
  children,
  ...props
}: ComponentPropsWithoutRef<typeof CodeGroup>) {
  const isGrouped = useContext(CodeGroupContext)

  if (isGrouped) {
    return children
  }

  return <CodeGroup {...props}>{children}</CodeGroup>
}
