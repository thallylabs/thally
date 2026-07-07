import { ImageResponse } from 'next/og'
import { siteConfig } from '@/data/site'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  const accent = siteConfig.brand.light.accent

  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="18"
          height="14"
          viewBox="0 0 14 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 2C0 0.895 0.895 0 2 0H5C8.314 0 11 2.686 11 6C11 9.314 8.314 12 5 12H2C0.895 12 0 11.105 0 10V2Z"
            fill="white"
          />
          <circle cx="13" cy="6" r="3" fill="white" />
        </svg>
      </div>
    ),
    { ...size },
  )
}
