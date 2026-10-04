'use client'

/** Registers an Update's tags with the page and hides it when the reader's tag filter excludes it. */

import { type ReactNode, useEffect } from 'react'
import { usePageSlotsOptional } from '@/components/mdx/page-slots'
import { matchesSelectedTags, shouldRevealForHash } from '@/lib/update-filters'

interface UpdateArticleProps {
  id?: string
  className: string
  tags: ReadonlyArray<string>
  children: ReactNode
}

export function UpdateArticle({ id, className, tags, children }: UpdateArticleProps) {
  const slots = usePageSlotsOptional()
  const registerTags = slots?.registerTags
  const key = tags.join('\u0000')

  // Untagged entries register too, so they hide only while a valid filter is active.
  useEffect(() => {
    if (!registerTags) return
    return registerTags(key ? key.split('\u0000') : [])
  }, [registerTags, key])

  const clearTags = slots?.clearTags
  const hidden = slots ? !matchesSelectedTags(tags, slots.selectedTags) : false

  // A link to an Update the filter hides (on load or via hashchange) clears the filter and scrolls to it.
  useEffect(() => {
    if (!clearTags) return
    const reveal = () => {
      if (!shouldRevealForHash(window.location.hash, id, hidden)) return
      clearTags()
      requestAnimationFrame(() => document.getElementById(id as string)?.scrollIntoView())
    }
    reveal()
    window.addEventListener('hashchange', reveal)
    return () => window.removeEventListener('hashchange', reveal)
  }, [clearTags, hidden, id])

  return (
    <article id={id} className={className} hidden={hidden}>
      {children}
    </article>
  )
}
