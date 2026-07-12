/**
 * Cloud services entry point — the ONLY module the engine's bridge
 * (`@/lib/cloud-bridge`) imports from this subtree.
 *
 * This directory holds the Thally Cloud feature tier (Track, AI answers,
 * analytics). The OSS distribution ships this file as the no-op stub below and
 * nothing else from src/cloud/, which makes every engine surface degrade to
 * its free-tier state (locked admin panels, hidden chat widget, silent
 * analytics no-op). See notes/thally-architecture-plan.md §3–4.
 *
 * OSS stub (the whole file):
 *
 *   import type { CloudServices } from '@/lib/cloud-bridge/types'
 *   export const cloudServices: CloudServices | null = null
 */

import type { CloudServices } from '@/lib/cloud-bridge/types'
import {
  handleWebhook,
  githubAppStatus,
  githubAppBegin,
  githubAppDisconnect,
  handleGithubAppCallback,
  handleAgentFix,
  getTrackedRepoStatuses,
} from '@/cloud/track/handlers'
import { getDocsTasks } from '@/cloud/track/tasks'
import { handleChat, isChatConfigured } from '@/cloud/ai/chat-handler'
import { getContentGaps } from '@/cloud/ai/chat-insights'
import { trackAnalyticsEvent, aggregateAnalytics } from '@/cloud/analytics/store'

export const cloudServices: CloudServices | null = {
  track: {
    handleWebhook,
    githubAppStatus,
    githubAppBegin,
    githubAppDisconnect,
    handleGithubAppCallback,
    handleAgentFix,
    getDocsTasks,
    getTrackedRepoStatuses,
  },
  ai: {
    handleChat,
    isChatConfigured,
    getContentGaps,
  },
  analytics: {
    trackEvent: trackAnalyticsEvent,
    aggregate: aggregateAnalytics,
  },
}
