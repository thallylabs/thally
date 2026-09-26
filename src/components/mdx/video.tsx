/**
 * Mintlify-parity video embed: `<Video src="https://youtu.be/…" />` or a
 * plain `.mp4` src. YouTube/Vimeo URLs render as a lazy 16:9 iframe styled
 * like `Frame`; `.mp4` renders a native `<video controls>`.
 */

interface VideoProps {
  src: string
  title?: string
}

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
    return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = url.pathname.startsWith('/embed/') ? url.pathname.slice('/embed/'.length) : url.searchParams.get('v')
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).pop()
    return id ? `https://player.vimeo.com/video/${id}` : null
  }
  return null
}

export function Video({ src, title = 'Embedded video' }: VideoProps) {
  if (/\.mp4(?:[?#]|$)/i.test(src)) {
    return <video controls src={src} className="my-6 w-full rounded-[11px] border border-border" />
  }
  return (
    <div className="my-6 aspect-video overflow-hidden rounded-[11px] border border-border">
      <iframe
        src={embedUrlFor(src) ?? src}
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
