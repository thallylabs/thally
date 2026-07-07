'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isDark = resolvedTheme === 'dark'
  const icon = !mounted ? <span className="h-4 w-4" aria-hidden /> : isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />

  return (
    <Button
      variant="ghost"
      size="icon"
      className="border border-border/70 text-foreground"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      {icon}
    </Button>
  )
}

