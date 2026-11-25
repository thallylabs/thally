import { Fragment } from 'react'
import { inlineCodeParts, linkedTitleParts } from '@/lib/inline-code'

/**
 * A title string with its `code` spans rendered as code, as Mintlify does for
 * Step and Accordion titles and the page description. Everything else stays
 * text; ids and outlines read `plainInlineText` of the same string.
 */
export function InlineCodeText({ children }: { children: string }) {
  return (
    <>
      {inlineCodeParts(children).map((part, index) =>
        part.code ? <code key={index}>{part.text}</code> : <Fragment key={index}>{part.text}</Fragment>,
      )}
    </>
  )
}

/** Text and `code` runs of a title, each code run wrapped as code. */
function inlineRuns(parts: Array<{ text: string; code: boolean }>) {
  return parts.map((part, index) =>
    part.code ? <code key={index}>{part.text}</code> : <Fragment key={index}>{part.text}</Fragment>)
}

/**
 * A `<Step>` title with its `code` spans rendered as code and its Markdown
 * links (`[label](url)`) rendered as links. The links are plain anchors, so the
 * page's prose styles and keyboard focus apply as they do to a link in the
 * body; the weight is the title's own at every title size. Ids, outlines and
 * search read `plainLinkedTitle` of the same string.
 */
export function LinkedTitleText({ children }: { children: string }) {
  return (
    <>
      {linkedTitleParts(children).map((part, index) =>
        'href' in part
          ? <a key={index} href={part.href} className="[font-weight:inherit]">{inlineRuns(part.parts)}</a>
          : part.code ? <code key={index}>{part.text}</code> : <Fragment key={index}>{part.text}</Fragment>,
      )}
    </>
  )
}
