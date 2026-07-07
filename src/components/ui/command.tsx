'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Command as CommandPrimitive } from 'cmdk'
import { X } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const Command = forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-2xl bg-background text-foreground shadow-2xl ring-1 ring-border',
        className,
      )}
      {...props}
    />
  )
})

export function CommandInput(props: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center border-b border-border px-3">
      <CommandPrimitive.Input
        className="flex-1 bg-transparent py-4 text-sm outline-none placeholder:text-foreground/50"
        {...props}
      />
    </div>
  )
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty className="py-6 text-center text-sm text-foreground/60" {...props} />
  )
}

export function CommandList(props: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className="max-h-[60vh] overflow-y-auto p-2" {...props} />
}

export function CommandGroup(props: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className="mb-2 rounded-xl bg-muted/40 p-2 text-xs text-foreground/60 [&_[cmdk-group-heading]]:mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide"
      {...props}
    />
  )
}

export function CommandItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground/90 data-[selected=true]:bg-background data-[selected=true]:text-foreground data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </CommandPrimitive.Item>
  )
}

interface CommandDialogProps extends Dialog.DialogProps {
  children: React.ReactNode
}

export function CommandDialog({ children, ...props }: CommandDialogProps) {
  return (
    <Dialog.Root {...props}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-0 top-24 z-50 mx-auto w-full max-w-xl px-4 outline-none">
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          {children}
          <Dialog.Close className="absolute right-6 top-4 text-foreground/50 transition hover:text-foreground">
            <span className="sr-only">Close</span>
            <X className="h-4 w-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

