import type { DocEntry } from '@/data/docs'
import { getBreadcrumbs, getPrevNextLinks, getFeedbackConfig } from '@/data/docs'
import { DocBreadcrumbs } from '@/components/docs/doc-breadcrumbs'
import { DocHeader } from '@/components/docs/doc-header'
import { DocPagination } from '@/components/docs/doc-pagination'
import { EditOnGithub } from '@/components/docs/edit-on-github'
import { Feedback } from '@/components/docs/feedback'
import { TableOfContents } from '@/components/docs/table-of-contents'
import { ContentStack, DetailColumn, MainColumns } from '@/components/layout/sections'
import { Prose } from '@/components/mdx/prose'
import { getRequestCloudSiteConfig, getRequestOrigin } from '@/lib/cloud-link/request'
import { resolveSiteConfig } from '@/lib/site-config'

interface DocLayoutProps {
  doc: DocEntry
  children: React.ReactNode
}

export async function DocLayout({ doc, children }: DocLayoutProps) {
  const { prev, next } = getPrevNextLinks(doc.href)
  const breadcrumbs = getBreadcrumbs(doc.href)
  const mode = doc.mode ?? 'default'
  const feedbackConfig = getFeedbackConfig()
  const origin = await getRequestOrigin()
  const [cloud, effectiveSite] = await Promise.all([
    getRequestCloudSiteConfig(),
    resolveSiteConfig(origin),
  ])
  const cloudFeedback = cloud?.siteConfig.portable.feedback
  const showFeedback = cloud
    ? Boolean(
        cloudFeedback?.thumbsRating ||
          cloudFeedback?.pageFeedback ||
          cloudFeedback?.editSuggestions ||
          cloudFeedback?.issueReporting,
      )
    : true
  const feedback = showFeedback ? (
    <Feedback
      endpoint={feedbackConfig.endpoint ?? '/api/feedback'}
      pageId={doc.id}
      repoUrl={effectiveSite.repoUrl}
      thumbsRating={cloud ? Boolean(cloudFeedback?.thumbsRating) : true}
      pageFeedback={Boolean(cloudFeedback?.pageFeedback)}
      editSuggestions={Boolean(cloudFeedback?.editSuggestions)}
      issueReporting={Boolean(cloudFeedback?.issueReporting)}
    />
  ) : null

  // custom mode: render children directly, no shell chrome
  if (mode === 'custom') {
    return <>{children}</>
  }

  // home mode: a landing moment — no breadcrumbs, header, or TOC. The page's
  // own <Hero> and card grid carry the art direction; only the "next" link
  // remains at the foot to keep readers moving into the docs.
  if (mode === 'home') {
    return (
      <article className="flex-1">
        <div className="space-y-16">
          <Prose className="max-w-none">{children}</Prose>
          <div className="not-prose">
            <DocPagination prev={prev} next={next} />
          </div>
        </div>
      </article>
    )
  }

  // center mode: single centered column, no sidebar-style TOC
  if (mode === 'center') {
    return (
      <article className="mx-auto w-full max-w-2xl">
        <ContentStack>
          <div className="not-prose space-y-4">
            <DocBreadcrumbs items={breadcrumbs} />
            <DocHeader doc={doc} />
          </div>
          <Prose className="flex-auto w-full">{children}</Prose>
          <div className="not-prose space-y-6">
            {feedback}
            <EditOnGithub pageId={doc.id} />
            <DocPagination prev={prev} next={next} />
          </div>
        </ContentStack>
      </article>
    )
  }

  // wide mode: no TOC column, full-width content
  if (mode === 'wide') {
    return (
      <article className="flex-1">
        <ContentStack>
          <div className="not-prose space-y-4">
            <DocBreadcrumbs items={breadcrumbs} />
            <DocHeader doc={doc} />
          </div>
          <Prose className="flex-auto w-full">{children}</Prose>
          <div className="not-prose space-y-6">
            {feedback}
            <EditOnGithub pageId={doc.id} />
            <DocPagination prev={prev} next={next} />
          </div>
        </ContentStack>
      </article>
    )
  }

  // default: two-column with TOC
  return (
    <MainColumns>
      <article className="flex-1">
        <ContentStack>
          <div className="not-prose space-y-4">
            <DocBreadcrumbs items={breadcrumbs} />
            <DocHeader doc={doc} />
          </div>
          <Prose className="flex-auto w-full">{children}</Prose>
          <div className="not-prose space-y-6">
            {feedback}
            <EditOnGithub pageId={doc.id} />
            <DocPagination prev={prev} next={next} />
          </div>
        </ContentStack>
      </article>
      <DetailColumn>
        <TableOfContents />
      </DetailColumn>
    </MainColumns>
  )
}
