/** Shared API-reference shell, including the same feedback paths as prose docs. */

import { ContentStack } from '@/components/layout/sections'
import { Feedback } from '@/components/docs/feedback'
import { getFeedbackConfig } from '@/data/docs'
import { getRequestCloudSiteConfig, getRequestOrigin } from '@/lib/cloud-link/request'
import { resolveSiteConfig } from '@/lib/site-config'

interface ApiLayoutProps {
  children: React.ReactNode
}

export async function ApiLayout({ children }: ApiLayoutProps) {
  const origin = await getRequestOrigin()
  const [cloud, effectiveSite] = await Promise.all([
    getRequestCloudSiteConfig(),
    resolveSiteConfig(origin),
  ])
  const settings = cloud?.siteConfig.portable.feedback
  const feedbackConfig = getFeedbackConfig()
  const hasThumbsRating = cloud ? Boolean(settings?.thumbsRating) : true
  const showFeedback = cloud
    ? Boolean(hasThumbsRating || settings?.issueReporting)
    : true
  return (
    <article className="thally-docs-api flex-1">
      <ContentStack>{children}</ContentStack>
      {showFeedback ? (
        <div className="mt-10">
          <Feedback
            endpoint={feedbackConfig.endpoint ?? '/api/feedback'}
            repoUrl={effectiveSite.repoUrl}
            thumbsRating={hasThumbsRating}
            pageFeedback={hasThumbsRating && Boolean(settings?.pageFeedback)}
            issueReporting={Boolean(settings?.issueReporting)}
          />
        </div>
      ) : null}
    </article>
  )
}
