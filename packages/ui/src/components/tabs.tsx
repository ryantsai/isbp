'use client';

import { motion } from 'motion/react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '../lib/utils';

const TabsValueContext = React.createContext<{ value?: string; id: string }>({ id: '' });

/** Radix tabs with an animated active indicator (shared layout animation). */
export function Tabs({
  className,
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value ?? internal;
  const id = React.useId();
  return (
    <TabsValueContext.Provider value={{ value: current, id }}>
      <TabsPrimitive.Root
        data-slot="tabs"
        value={current}
        onValueChange={(v) => {
          setInternal(v);
          onValueChange?.(v);
        }}
        className={cn('flex flex-col gap-4', className)}
        {...props}
      />
    </TabsValueContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex h-9 w-fit max-w-full items-center justify-start gap-1 overflow-x-auto border-b text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  value,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const ctx = React.use(TabsValueContext);
  const active = ctx.value === value;
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      value={value}
      className={cn(
        "relative inline-flex h-9 items-center justify-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      {active && (
        <motion.span
          layoutId={`tab-indicator-${ctx.id}`}
          className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none animate-in fade-in-0 duration-200', className)}
      {...props}
    />
  );
}
