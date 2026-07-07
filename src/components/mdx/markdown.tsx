'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
  className?: string
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              className="font-medium text-accent underline decoration-dotted underline-offset-4 transition hover:text-accent/80"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export default Markdown
