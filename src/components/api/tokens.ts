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

