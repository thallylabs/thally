export const methodTokens: Record<
  string,
  {
    text: string
    bg: string
    ring: string
  }
> = {
  get: {
    text: 'text-accent',
    bg: 'bg-accent/10',
    ring: 'ring-accent/20',
  },
  post: {
    text: 'text-sky-500',
    bg: 'bg-sky-500/10',
    ring: 'ring-sky-500/20',
  },
  put: {
    text: 'text-amber-500',
    bg: 'bg-amber-500/10',
    ring: 'ring-amber-500/20',
  },
  patch: {
    text: 'text-blue-500',
    bg: 'bg-blue-500/10',
    ring: 'ring-blue-500/20',
  },
  delete: {
    text: 'text-rose-500',
    bg: 'bg-rose-500/10',
    ring: 'ring-rose-500/20',
  },
  options: {
    text: 'text-violet-500',
    bg: 'bg-violet-500/10',
    ring: 'ring-violet-500/20',
  },
  head: {
    text: 'text-zinc-500',
    bg: 'bg-zinc-500/10',
    ring: 'ring-zinc-500/20',
  },
  trace: {
    text: 'text-lime-500',
    bg: 'bg-lime-500/10',
    ring: 'ring-lime-500/20',
  },
}

export function getMethodToken(method: string) {
  const token = methodTokens[method.toLowerCase()]
  if (token) {
    return token
  }
  return {
    text: 'text-foreground',
    bg: 'bg-foreground/10',
    ring: 'ring-foreground/20',
  }
}

export function statusColorClass(code: string) {
  if (code.startsWith('2')) return 'text-green-600 dark:text-green-400'
  if (code.startsWith('3')) return 'text-sky-600 dark:text-sky-400'
  if (code.startsWith('4')) return 'text-amber-600 dark:text-amber-400'
  if (code.startsWith('5')) return 'text-rose-600 dark:text-rose-400'
  return 'text-foreground'
}

export function statusUnderlineClass(code: string) {
  if (code.startsWith('2')) return 'bg-green-500'
  if (code.startsWith('3')) return 'bg-sky-500'
  if (code.startsWith('4')) return 'bg-amber-500'
  if (code.startsWith('5')) return 'bg-rose-500'
  return 'bg-accent'
}
