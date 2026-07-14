import { ContentStack } from '@/components/layout/sections'
import { Feedback } from '@/components/docs/feedback'
import { getRequestCloudSiteConfig } from '@/lib/cloud-link/request'

interface ApiLayoutProps {
  children: React.ReactNode
}

export async function ApiLayout({ children }: ApiLayoutProps) {
  const cloud = await getRequestCloudSiteConfig()
  const settings = cloud?.siteConfig.portable.feedback
  const showFeedback = cloud ? Boolean(settings?.thumbsRating) : true
  return (
    <article className="flex-1">
      <ContentStack>{children}</ContentStack>
      {showFeedback ? (
        <div className="mt-10">
          <Feedback thumbsRating={cloud ? Boolean(settings?.thumbsRating) : true} />
        </div>
      ) : null}
    </article>
  )
}
