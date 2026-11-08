/** Shared API-reference shell, including the same feedback paths as prose docs. */

import { ContentStack } from '@/components/layout/sections'
import { Feedback } from '@/components/docs/feedback'
import { getFeedbackConfig } from '@/data/docs'
import { isCloudAccessConfiguredEdge } from '@/lib/cloud-link/edge'
import { getRequestCloudSiteConfig, getRequestOrigin } from '@/lib/cloud-link/request'
import { resolveSiteConfig } from '@/lib/site-config'

interface ApiLayoutProps {
  children: React.ReactNode
}

export async function ApiLayout({ children }: ApiLayoutProps) {
  // Without a Cloud link there are no live settings to read, and the origin would be read from request headers, which no
  // prerendered page may do (the page would be left out of the build and answer 500).
  const linked = isCloudAccessConfiguredEdge()
  const origin = linked ? await getRequestOrigin() : undefined
  const [cloud, effectiveSite] = await Promise.all([
    linked ? getRequestCloudSiteConfig() : null,
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
