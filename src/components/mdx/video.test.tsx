/** Regression tests for Video URL-to-embed mapping and its YouTube aliases. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LiteYouTubeEmbed, Video, YouTube } from './video'

describe('Video', () => {
  it('maps a youtu.be URL to the privacy-enhanced YouTube embed', () => {
    const html = renderToStaticMarkup(<Video src="https://youtu.be/dQw4w9WgXcQ" />)
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(html).toContain('loading="lazy"')
  })

  it('maps a vimeo.com URL to the Vimeo player embed', () => {
    const html = renderToStaticMarkup(<Video src="https://vimeo.com/76979871" />)
    expect(html).toContain('src="https://player.vimeo.com/video/76979871"')
  })

  it('renders a plain .mp4 src as a native video element', () => {
    const html = renderToStaticMarkup(<Video src="https://example.com/clip.mp4" />)
    expect(html).toContain('<video')
    expect(html).toContain('controls=""')
    expect(html).toContain('src="https://example.com/clip.mp4"')
  })

  it('aliases YouTube and LiteYouTubeEmbed to a Video embed by id', () => {
    const youtube = renderToStaticMarkup(<YouTube id="dQw4w9WgXcQ" />)
    const lite = renderToStaticMarkup(<LiteYouTubeEmbed id="dQw4w9WgXcQ" />)
    expect(youtube).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(lite).toBe(youtube)
  })
})
