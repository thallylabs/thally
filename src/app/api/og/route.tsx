import { ImageResponse } from 'next/og'
import { type NextRequest } from 'next/server'
import { siteConfig } from '@/data/site'
import { resolveOgConfig } from '@/lib/og'
import { getBrandAsset } from '@/lib/admin/settings'

// Node (not edge) so it can read the admin-uploaded logo from F1.
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const title = searchParams.get('title') || `${siteConfig.name} Documentation`
  const rawDescription = searchParams.get('description') || siteConfig.description
  const description = rawDescription.length > 120 ? `${rawDescription.slice(0, 117)}...` : rawDescription
  const group = searchParams.get('group') || ''

  const og = resolveOgConfig(searchParams.get('accent') || undefined)
  // Admin-uploaded logo first, then the bundled default mark (public/brand —
  // the dark variant, since the OG canvas uses the dark brand surface). The
  // bundled mark is square, so it can carry an explicit width (Satori cannot
  // compute `width: auto`); admin uploads keep auto width via height only.
  let logoUri = await getBrandAsset('logo')
  let logoIsSquareDefault = false
  if (!logoUri) {
    try {
      const { readFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const png = await readFile(join(process.cwd(), 'public', 'brand', 'thally-logo-dark.png'))
      logoUri = `data:image/png;base64,${png.toString('base64')}`
      logoIsSquareDefault = true
    } catch {
      // No bundled mark — the lettered fallback below renders instead
    }
  }

  // Fetch the font from Google Fonts at the edge
  let fontData: ArrayBuffer | null = null
  try {
    const fontUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(og.fontFamily)}:wght@${og.fontWeight}&display=swap`
    const cssRes = await fetch(fontUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    })
    const css = await cssRes.text()
    const fontFileUrl = css.match(/src:\s*url\(([^)]+)\)/)?.[1]
    if (fontFileUrl) {
      const fontRes = await fetch(fontFileUrl)
      fontData = await fontRes.arrayBuffer()
    }
  } catch {
    // Font fetch failed — Satori will use its default sans-serif
  }

  const fonts: Array<{ name: string; data: ArrayBuffer; weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style: 'normal' | 'italic' }> = []
  if (fontData) {
    fonts.push({
      name: og.fontFamily,
      data: fontData,
      weight: Number(og.fontWeight) as 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900,
      style: 'normal',
    })
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: `linear-gradient(135deg, ${og.backgroundStart} 0%, ${og.backgroundEnd} 100%)`,
          fontFamily: fontData ? og.fontFamily : 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: `linear-gradient(90deg, ${og.accent}, ${og.accent}88, ${og.accent}44)`,
          }}
        />

        {/* Decorative orb — top right */}
        <div
          style={{
            position: 'absolute',
            top: '-80px',
            right: '-60px',
            width: '320px',
            height: '320px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${og.accent}18 0%, transparent 70%)`,
          }}
        />

        {/* Decorative orb — bottom left */}
        <div
          style={{
            position: 'absolute',
            bottom: '-100px',
            left: '-80px',
            width: '400px',
            height: '400px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${og.accent}10 0%, transparent 70%)`,
          }}
        />

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
            padding: '60px 64px 40px',
          }}
        >
          {group ? (
            <div
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: og.groupColor,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '16px',
              }}
            >
              {group}
            </div>
          ) : null}

          <div
            style={{
              fontSize: title.length > 40 ? '48px' : '56px',
              fontWeight: Number(og.fontWeight),
              color: og.titleColor,
              lineHeight: 1.15,
              marginBottom: '20px',
              maxWidth: '900px',
            }}
          >
            {title}
          </div>

          {description ? (
            <div
              style={{
                fontSize: '22px',
                color: og.descriptionColor,
                lineHeight: 1.5,
                maxWidth: '800px',
              }}
            >
              {description}
            </div>
          ) : null}
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 64px',
            borderTop: `1px solid ${og.accent}22`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            {/* Admin logo / bundled default mark, or a lettered fallback */}
            {logoUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUri}
                alt=""
                height={32}
                {...(logoIsSquareDefault ? { width: 32 } : {})}
                style={{ height: '32px', width: logoIsSquareDefault ? '32px' : 'auto' }}
              />
            ) : (
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: og.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: og.backgroundStart,
                }}
              >
                {og.logoText.charAt(0).toUpperCase()}
              </div>
            )}
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: og.titleColor,
              }}
            >
              {og.logoText}
            </div>
          </div>

          <div
            style={{
              fontSize: '16px',
              color: og.descriptionColor,
            }}
          >
            {og.domain}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      ...(fonts.length > 0 ? { fonts } : {}),
      headers: { 'cache-control': 'public, max-age=3600, s-maxage=3600' },
    },
  )
}
