/**
 * Mintlify-parity video embed: `<Video src="https://youtu.be/…" />` or a
 * plain `.mp4` src. YouTube/Vimeo URLs render as a lazy 16:9 iframe styled
 * like `Frame`; `.mp4` renders a native `<video controls>`.
 */

interface VideoProps {
  src: string
  title?: string
}

const VIDEO_ID = /^[\w-]{1,64}$/

/** Resolve a YouTube or Vimeo URL (or a bare YouTube id) to its embed URL. */
function embedUrlFor(src: string): string | null {
  if (/^[\w-]{11}$/.test(src)) return `https://www.youtube-nocookie.com/embed/${src}`
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1)
    return VIDEO_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = url.pathname.startsWith('/embed/') ? url.pathname.slice('/embed/'.length) : url.searchParams.get('v')
    return id && VIDEO_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).pop()
    return id && VIDEO_ID.test(id) ? `https://player.vimeo.com/video/${id}` : null
  }
  return null
}

/** Only a web URL or a site path may become an iframe source; `javascript:` and `data:` URLs run in the embedding page's origin. */
function isEmbeddableSource(src: string): boolean {
  return /^https?:\/\//i.test(src) || (src.startsWith('/') && !src.startsWith('//'))
}

export function Video({ src, title = 'Embedded video' }: VideoProps) {
  if (/\.mp4(?:[?#]|$)/i.test(src)) {
    return <video controls src={src} className="my-6 w-full rounded-[11px] border border-border" />
  }
  const embedUrl = embedUrlFor(src) ?? (isEmbeddableSource(src) ? src : null)
  // Never drop the video silently: show what was authored as text when it
  // cannot be embedded safely.
  if (!embedUrl) return <code>{src}</code>
  return (
    <div className="my-6 aspect-video overflow-hidden rounded-[11px] border border-border">
      <iframe
        src={embedUrl}
        title={title}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
      />
    </div>
  )
}

/** Mintlify's `<YouTube id="…" />` and `react-lite-youtube-embed`'s `<LiteYouTubeEmbed id="…" />`. */
export function YouTube({ id, title }: { id: string; title?: string }) {
  return <Video src={`https://www.youtube.com/watch?v=${id}`} title={title} />
}

export const LiteYouTubeEmbed = YouTube
