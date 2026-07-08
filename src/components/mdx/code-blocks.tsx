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

const languageNames: Record<string, string> = {
  js: 'JavaScript',
  ts: 'TypeScript',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
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
      className={clsx(
        'group/button absolute top-3.5 right-4 overflow-hidden rounded-full py-1 pr-3 pl-2 text-2xs font-medium opacity-0 backdrop-blur-sm transition group-hover:opacity-100 focus-visible:opacity-100',
        copied
          ? 'bg-accent/10 ring-1 ring-accent/20 ring-inset'
          : 'bg-white/5 hover:bg-white/10 dark:bg-white/10 dark:hover:bg-white/5',
      )}
      onClick={() => {
        window.navigator.clipboard.writeText(code).then(() => {
          setCopyCount((count) => count + 1)
        })
      }}
    >
      <span
        aria-hidden={copied}
        className={clsx(
          'pointer-events-none flex items-center gap-0.5 text-zinc-400 transition duration-300',
          copied && '-translate-y-1.5 opacity-0',
        )}
      >
        <ClipboardIcon className="h-5 w-5 fill-zinc-500/20 stroke-zinc-500 transition-colors group-hover/button:stroke-zinc-400" />
        Copy
      </span>
      <span
        aria-hidden={!copied}
        className={clsx(
          'pointer-events-none absolute inset-0 flex items-center justify-center text-accent transition duration-300',
          !copied && 'translate-y-1.5 opacity-0',
        )}
      >
        Copied!
      </span>
    </button>
  )
}

function CodePanelHeader({ tag, label }: { tag?: string; label?: string }) {
  if (!tag && !label) {
    return null
  }

  return (
    <div className="flex h-9 items-center gap-2 border-y border-t-transparent border-b-white/10 bg-white/5 bg-zinc-900 px-4 dark:border-b-white/10 dark:bg-white/[0.04]">
      {tag && (
        <div className="flex">
          <Tag variant="small">{tag}</Tag>
        </div>
      )}
      {tag && label && (
        <span className="h-0.5 w-0.5 rounded-full bg-zinc-500" />
      )}
      {label && (
        <span className="font-mono text-xs text-zinc-400">{label}</span>
      )}
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

function CodePanel({
  children,
  tag,
  label,
  code,
  wrap,
}: {
  children: ReactNode
  tag?: string
  label?: string
  code?: string
  wrap?: boolean
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

  if (!resolvedCode) {
    throw new Error(
      '`CodePanel` requires a `code` prop, or a child with a `code` prop.',
    )
  }

  return (
    <div className="group dark:bg-black/20">
      <CodePanelHeader tag={resolvedTag} label={resolvedLabel} />
      <div className="relative">
        <pre
          className={clsx(
            'p-4 text-xs text-white',
            resolvedWrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto',
            languageClass,
          )}
          suppressHydrationWarning
        >
          {content}
        </pre>
        <CopyButton code={resolvedCode} />
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
    <div className="flex min-h-[calc(3rem+1px)] flex-wrap items-start gap-x-4 border-b border-zinc-700 bg-zinc-800 px-4 dark:border-white/10 dark:bg-white/[0.04]">
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
                  : 'border-transparent text-zinc-400 hover:text-zinc-300',
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
  title = 'Code',
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

  const containerClassName =
    'my-6 overflow-hidden rounded-2xl bg-zinc-900 shadow-md dark:bg-[#0a0c12] dark:shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)]'
  const header = (
    <CodeGroupHeader title={title} selectedIndex={tabGroupProps.selectedIndex}>
      {children}
    </CodeGroupHeader>
  )
  const panels = <CodeGroupPanels {...props}>{children}</CodeGroupPanels>

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

