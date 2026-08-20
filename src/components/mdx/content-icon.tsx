/** Safe, predictable Lucide icon rendering for documentation content. */
import {
  AlertCircle, ArrowRight, Bell, BookOpen, Bot, Box, Check, CheckCircle, CircleHelp,
  Clipboard, Cloud, Code2, Database, ExternalLink, File, Folder, Github, Globe,
  Grid3X3, Heart, Info, Key, Lightbulb, Link2, Lock, Mail, Menu, MessageSquare,
  Package, PartyPopper, Plus, RefreshCw, Search, Send, Settings, Shield, Sparkles,
  Star, Terminal, Trash2, TriangleAlert, Twitter, User, Users, Wand2, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type ContentIconTone = 'neutral' | 'accent'

const iconMap: Record<string, LucideIcon> = {
  alert: AlertCircle, 'alert-circle': AlertCircle, arrow: ArrowRight, 'arrow-right': ArrowRight,
  bell: Bell, book: BookOpen, 'book-open': BookOpen, bot: Bot, box: Box, check: Check,
  'check-circle': CheckCircle, help: CircleHelp, clipboard: Clipboard, cloud: Cloud,
  code: Code2, 'code-simple': Code2, database: Database, external: ExternalLink,
  'external-link': ExternalLink, file: File, folder: Folder, github: Github, globe: Globe,
  grid: Grid3X3, 'grid-round': Grid3X3, heart: Heart, info: Info, key: Key,
  'key-round': Key, lightbulb: Lightbulb, link: Link2, 'link-simple': Link2, lock: Lock, envelope: Mail,
  mail: Mail, menu: Menu, message: MessageSquare, package: Package, 'party-horn': PartyPopper,
  plus: Plus, 'refresh-cw': RefreshCw, search: Search, telegram: Send, send: Send, settings: Settings, shield: Shield,
  sparkles: Sparkles, star: Star, terminal: Terminal, twitter: Twitter, 'x-twitter': Twitter,
  'trash-2': Trash2, 'triangle-alert': TriangleAlert, user: User, users: Users, wand: Wand2, wrench: Wrench, zap: Zap,
}

export interface IconProps {
  icon?: string
  src?: string
  iconType?: 'regular' | 'solid' | 'outline'
  className?: string
  color?: string
  size?: number | string
  'data-content-icon-tone'?: ContentIconTone | 'site'
}

function safeIconSource(src: string): boolean {
  return (src.startsWith('/') && !src.startsWith('//') && !src.includes('\\')) || /^https:\/\//i.test(src)
}

/** Render an allowlisted icon; unknown names use a neutral help glyph. */
export function Icon({ icon, src, iconType = 'outline', className, color, size, 'data-content-icon-tone': tone }: IconProps) {
  if (src && safeIconSource(src)) {
    const resolvedSize = size ?? 20
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authored icon sources are not constrained to a Next image loader.
      <img src={src} alt="" aria-hidden="true" width={resolvedSize} height={resolvedSize} className={cn('h-5 w-5 object-contain', className)} />
    )
  }

  const normalizedIcon = icon?.toLowerCase() ?? ''
  const Component = iconMap[normalizedIcon] ?? CircleHelp
  return (
    <Component
      className={cn('h-5 w-5 text-accent', iconType === 'solid' && 'fill-current', className)}
      color={color}
      size={size}
      strokeWidth={iconType === 'solid' ? 1.75 : 2}
      aria-hidden="true"
      data-content-icon-tone={tone}
      data-icon-name={iconMap[normalizedIcon] ? normalizedIcon : 'unknown'}
    />
  )
}
