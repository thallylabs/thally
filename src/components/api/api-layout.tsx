import { ContentStack } from '@/components/layout/sections'
import { Feedback } from '@/components/docs/feedback'

interface ApiLayoutProps {
  children: React.ReactNode
}

export function ApiLayout({ children }: ApiLayoutProps) {
  return (
    <article className="flex-1">
      <ContentStack>{children}</ContentStack>
      <div className="mt-10">
        <Feedback />
      </div>
    </article>
  )
}

