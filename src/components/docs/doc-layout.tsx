/** Documentation page shell and its configurable reader feedback surfaces. */

import type { DocEntry, NavContext } from '@/data/docs'
import { getBreadcrumbs, getNavCategory, getPrevNextLinks, getFeedbackConfig } from '@/data/docs'
import { DocBreadcrumbs } from '@/components/docs/doc-breadcrumbs'
import { DocHeader } from '@/components/docs/doc-header'
import { DocPagination } from '@/components/docs/doc-pagination'
import { EditOnGithub } from '@/components/docs/edit-on-github'
import { Feedback } from '@/components/docs/feedback'
import { ReportAnIssue } from '@/components/docs/report-an-issue'
import { TableOfContents } from '@/components/docs/table-of-contents'
import { ContentStack, DetailColumn, MainColumns } from '@/components/layout/sections'
import { Prose } from '@/components/mdx/prose'
import { getManagedSiteConfigSnapshot } from '@/lib/cloud-link/client'
import { getBuildContentControls } from '@/lib/cloud-link/content-controls'
import { resolveBuildSiteConfig } from '@/lib/site-config'
import { localeDirection } from '@/lib/i18n/config'
import { PagePanelSlot, PageSlotsProvider } from '@/components/mdx/page-slots'

interface DocLayoutProps {
  doc: DocEntry
  locale?: string
  navigation?: Pick<NavContext, 'prev' | 'next' | 'breadcrumb'>
  children: React.ReactNode
}

function DocLayoutContent({ doc, locale = 'en', navigation, children }: DocLayoutProps) {
  const { prev, next, breadcrumb: breadcrumbs } = navigation ?? {
    ...getPrevNextLinks(doc.href),
    breadcrumb: getBreadcrumbs(doc.href),
  }
  const eyebrow = getNavCategory(doc.href)
  const mode = doc.mode ?? 'default'
  const feedbackConfig = getFeedbackConfig()
  // Managed releases already carry an immutable, release-scoped settings
  // snapshot. Reading it here keeps article rendering deterministic and
  // cacheable; live settings changes take effect with the next atomic release.
  const cloud = getManagedSiteConfigSnapshot()
  const contentControls = getBuildContentControls()
  const effectiveSite = resolveBuildSiteConfig()
  const cloudFeedback = cloud?.siteConfig.portable.feedback
  const hasThumbsRating = cloud ? Boolean(cloudFeedback?.thumbsRating) : true
  const hasIssueReporting = cloud ? Boolean(cloudFeedback?.issueReporting) : true
  const showFeedback = cloud
    ? Boolean(
        hasThumbsRating || cloudFeedback?.editSuggestions || cloudFeedback?.issueReporting,
      )
    : true
  const feedback = showFeedback ? (
    <Feedback
      endpoint={feedbackConfig.endpoint ?? '/api/feedback'}
      pageId={doc.id}
      repoUrl={effectiveSite.repoUrl}
      thumbsRating={hasThumbsRating}
      pageFeedback={hasThumbsRating && Boolean(cloudFeedback?.pageFeedback)}
      editSuggestions={Boolean(cloudFeedback?.editSuggestions)}
      issueReporting={Boolean(cloudFeedback?.issueReporting)}
    />
  ) : null
  const pageSourceActions = effectiveSite.repoUrl && !effectiveSite.repoUrl.includes('your-org') ? (
    <div className="flex flex-col items-start gap-1.5">
      <EditOnGithub
        pageId={doc.id}
        repoUrl={effectiveSite.repoUrl}
        label="Edit this page"
        className="text-sm leading-6 text-foreground/55"
      />
      {hasIssueReporting ? (
        <ReportAnIssue
          pagePath={doc.href}
          repoUrl={effectiveSite.repoUrl}
          className="text-sm leading-6 text-foreground/55"
        />
      ) : null}
    </div>
  ) : null
  const pageActionsRail = pageSourceActions ? (
    <div className="mt-5 border-t border-border pt-4">{pageSourceActions}</div>
  ) : null

  // custom mode: render children directly, no shell chrome
  if (mode === 'custom') {
    return (
      <div lang={locale} dir={localeDirection(locale)}>
        {children}
      </div>
    )
  }

  // home mode: a landing moment — no breadcrumbs, header, or TOC. The page's
  // own <Hero> and card grid carry the art direction; only the "next" link
  // remains at the foot to keep readers moving into the docs.
  if (mode === 'home') {
    return (
      <article className="thally-docs-article flex-1" lang={locale} dir={localeDirection(locale)}>
        <div className="space-y-16">
          <Prose className="thally-docs-hero max-w-none">{children}</Prose>
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
      <article className="thally-docs-article mx-auto w-full max-w-2xl" lang={locale} dir={localeDirection(locale)}>
        <ContentStack>
          <div className="not-prose space-y-4">
            {contentControls.showBreadcrumbs ? <DocBreadcrumbs items={breadcrumbs} /> : null}
            <DocHeader doc={doc} eyebrow={eyebrow} showCopyPage={contentControls.showCopyPage} />
          </div>
          <Prose className="flex-auto w-full">{children}</Prose>
          <div className="not-prose space-y-6">
            {feedback}
            {pageSourceActions}
            <DocPagination prev={prev} next={next} />
          </div>
        </ContentStack>
      </article>
    )
  }

  // wide mode: no TOC column, full-width content
  if (mode === 'wide') {
    return (
      <article className="thally-docs-article flex-1" lang={locale} dir={localeDirection(locale)}>
        <ContentStack>
          <div className="not-prose space-y-4">
            {contentControls.showBreadcrumbs ? <DocBreadcrumbs items={breadcrumbs} /> : null}
            <DocHeader doc={doc} eyebrow={eyebrow} showCopyPage={contentControls.showCopyPage} />
          </div>
          <Prose className="flex-auto w-full">{children}</Prose>
          <div className="not-prose space-y-6">
            {feedback}
            {pageSourceActions}
            <DocPagination prev={prev} next={next} />
          </div>
        </ContentStack>
      </article>
    )
  }

  // default: two-column with TOC
  return (
    <MainColumns>
      <article className="thally-docs-article flex-1" lang={locale} dir={localeDirection(locale)}>
        <ContentStack>
          <div className="not-prose space-y-4">
            {contentControls.showBreadcrumbs ? <DocBreadcrumbs items={breadcrumbs} /> : null}
            <DocHeader doc={doc} eyebrow={eyebrow} showCopyPage={contentControls.showCopyPage} />
          </div>
          <Prose className="flex-auto w-full">{children}</Prose>
          <div className="not-prose space-y-6">
            {feedback}
            <DocPagination prev={prev} next={next} />
          </div>
        </ContentStack>
      </article>
      <DetailColumn>
        <PagePanelSlot
          fallback={contentControls.showTableOfContents ? <TableOfContents /> : null}
          footer={pageActionsRail}
        />
      </DetailColumn>
    </MainColumns>
  )
}

/** Render a documentation page with page-scoped MDX coordination. */
export function DocLayout(props: DocLayoutProps) {
  return (
    <PageSlotsProvider>
      <DocLayoutContent {...props} />
    </PageSlotsProvider>
  )
}
